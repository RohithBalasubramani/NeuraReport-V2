from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import inspect
import ipaddress
import json
import logging
import os
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from apscheduler.executors.asyncio import AsyncIOExecutor
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from backend.app.repositories import state_store
# JobRunTracker, _build_job_steps, _step_progress_from_steps defined above in this file
from backend.app.schemas import RunPayload
from backend.app.common import get_state_store

logger = logging.getLogger("neura.scheduler")

# Compute the system's local timezone explicitly.  In PyInstaller frozen
# builds, APScheduler's get_localzone() may fail and silently fall back to
# UTC.  Using a fixed-offset timezone avoids this completely.
_LOCAL_TZ = datetime.now(timezone.utc).astimezone().tzinfo
logger.info("scheduler_timezone", extra={"event": "scheduler_timezone", "tz": str(_LOCAL_TZ)})
_MISFIRE_GRACE_SECONDS_RAW = os.getenv("NEURA_SCHEDULER_MISFIRE_GRACE_SECONDS", "3600")
try:
    _MISFIRE_GRACE_SECONDS = int(_MISFIRE_GRACE_SECONDS_RAW)
except (TypeError, ValueError):
    _MISFIRE_GRACE_SECONDS = 3600
if _MISFIRE_GRACE_SECONDS <= 0:
    _MISFIRE_GRACE_SECONDS = None

def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        value = datetime.fromisoformat(ts)
    except ValueError:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _compute_dynamic_dates(frequency: str) -> tuple[str, str]:
    """Compute dynamic start/end date strings based on schedule frequency.

    - daily:   yesterday → today
    - weekly:  7 days ago → today
    - monthly: 30 days ago → today
    """
    today = _now_utc().date()
    freq = (frequency or "daily").strip().lower()
    if freq == "weekly":
        start = today - timedelta(days=7)
    elif freq == "monthly":
        start = today - timedelta(days=30)
    else:  # daily (default)
        start = today - timedelta(days=1)
    return start.isoformat(), today.isoformat()

def _next_run_datetime(schedule: dict, baseline: datetime) -> datetime:
    minutes = schedule.get("interval_minutes") or 0
    minutes = max(int(minutes), 1)
    return baseline + timedelta(minutes=minutes)

def _schedule_signature(schedule: dict) -> str:
    parts = [
        str(schedule.get("interval_minutes") or ""),
        str(schedule.get("start_date") or ""),
        str(schedule.get("end_date") or ""),
        "1" if schedule.get("active", True) else "0",
        str(schedule.get("run_time") or ""),
        str(schedule.get("frequency") or ""),
    ]
    return "|".join(parts)

def _parse_run_time(run_time: str | None) -> tuple[int, int] | None:
    """Parse 'HH:MM' string into (hour, minute) or None."""
    if not run_time:
        return None
    try:
        parts = run_time.strip().split(":")
        h, m = int(parts[0]), int(parts[1])
        if 0 <= h <= 23 and 0 <= m <= 59:
            return (h, m)
    except (ValueError, IndexError):
        pass
    return None

def _build_cron_trigger(
    frequency: str, hour: int, minute: int,
    start_date: datetime | None, end_date: datetime | None,
) -> CronTrigger:
    """Build a CronTrigger for the given frequency and time-of-day.

    run_time is stored as UTC (the frontend converts local time to UTC before
    sending), so we always use ``timezone.utc`` so the job fires at the correct
    wall-clock moment regardless of the server's system timezone.
    """
    kwargs: dict = {"hour": hour, "minute": minute, "timezone": timezone.utc}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date

    if frequency == "weekly":
        kwargs["day_of_week"] = "mon"
    elif frequency == "monthly":
        kwargs["day"] = 1
    # daily (default): runs every day at the specified time — no extra args needed

    return CronTrigger(**kwargs)

def _scheduler_db_url() -> str:
    override = os.getenv("NEURA_SCHEDULER_DB_PATH")
    if override:
        path = Path(override).expanduser()
    else:
        state_db = os.getenv("NEURA_STATE_DB_PATH")
        if state_db:
            path = Path(state_db).expanduser()
        else:
            base_dir = getattr(state_store, "_base_dir", Path(__file__).resolve().parents[3] / "state")
            path = Path(base_dir) / "scheduler.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"

class ReportScheduler:
    def __init__(
        self,
        runner: Callable[..., dict],
        *,
        poll_seconds: int = 60,
    ) -> None:
        """Initialize the report scheduler."""
        self._runner = runner
        self._poll_seconds = max(poll_seconds, 5)
        self._sync_job_id = "schedule-sync"
        # Backwards-compatible state expected by legacy tests.
        self._task: asyncio.Task | None = None
        self._inflight: set[str] = set()
        self._scheduler = AsyncIOScheduler(
            executors={"default": AsyncIOExecutor()},
            timezone=_LOCAL_TZ,
        )

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        if not self._scheduler.running:
            self._scheduler.start()
        await self._sync_from_store()
        self._task = asyncio.create_task(self._sync_loop(), name="nr-schedule-sync")
        logger.info("scheduler_started", extra={"event": "scheduler_started"})

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        if self._scheduler.running:
            self._scheduler.shutdown(wait=False)
        logger.info("scheduler_stopped", extra={"event": "scheduler_stopped"})

    async def refresh(self) -> None:
        """Refresh scheduler jobs from persisted schedules."""
        await self._sync_from_store()

    async def _sync_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._poll_seconds)
                await self._sync_from_store()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduler_sync_failed", extra={"event": "scheduler_sync_failed"})

    async def _dispatch_due_jobs(self) -> None:
        """
        Legacy dispatcher used by older tests and compatibility code.

        APScheduler handles scheduling in production, but tests expect a polling
        dispatcher that inspects `next_run_at` and `interval_minutes`.
        """
        now = _now_utc()
        schedules = state_store.list_schedules() or []
        for schedule in schedules:
            schedule_id = str(schedule.get("id") or "").strip()
            if not schedule_id:
                continue
            if not schedule.get("active", True):
                continue
            if schedule_id in self._inflight:
                continue

            start_date = _parse_iso(schedule.get("start_date"))
            if start_date and now < start_date:
                continue
            end_date = _parse_iso(schedule.get("end_date"))
            if end_date and now > end_date:
                continue

            next_run_at = _parse_iso(schedule.get("next_run_at"))
            if next_run_at and next_run_at > now:
                continue

            # Due now (no next_run_at => run immediately).
            self._inflight.add(schedule_id)

            async def _run_and_release(sched: dict = schedule, sid: str = schedule_id) -> None:
                try:
                    await self._run_schedule(sched)
                finally:
                    self._inflight.discard(sid)

            asyncio.create_task(_run_and_release())

    async def _sync_from_store(self) -> None:
        schedules = state_store.list_schedules()
        schedule_ids: set[str] = set()

        for schedule in schedules:
            schedule_id = schedule.get("id")
            if not schedule_id:
                continue
            schedule_ids.add(schedule_id)
            if not schedule.get("active", True):
                self._remove_job(schedule_id)
                continue

            interval_minutes = max(int(schedule.get("interval_minutes") or 0), 1)
            start_date = _parse_iso(schedule.get("start_date"))
            end_date = _parse_iso(schedule.get("end_date"))
            signature = _schedule_signature(schedule)

            job = self._scheduler.get_job(schedule_id)
            if job and job.kwargs.get("schedule_sig") == signature:
                continue
            if job:
                self._remove_job(schedule_id)

            run_time = _parse_run_time(schedule.get("run_time"))
            if run_time:
                frequency = str(schedule.get("frequency") or "daily").strip().lower()
                trigger = _build_cron_trigger(
                    frequency, run_time[0], run_time[1],
                    start_date, end_date,
                )
            else:
                trigger = IntervalTrigger(
                    minutes=interval_minutes,
                    start_date=start_date,
                    end_date=end_date,
                    timezone=timezone.utc,
                )
            job = self._scheduler.add_job(
                self._run_schedule,
                trigger=trigger,
                id=schedule_id,
                kwargs={"schedule_id": schedule_id, "schedule_sig": signature},
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=_MISFIRE_GRACE_SECONDS,
            )

            if job.next_run_time:
                state_store.update_schedule(
                    schedule_id,
                    next_run_at=job.next_run_time.astimezone(timezone.utc).isoformat(),
                )

        # Remove any orphaned jobs
        for job in self._scheduler.get_jobs():
            if job.id == self._sync_job_id:
                continue
            if job.id not in schedule_ids:
                self._remove_job(job.id)

    def _remove_job(self, job_id: str) -> None:
        try:
            self._scheduler.remove_job(job_id)
        except Exception:
            pass

    async def _run_schedule(self, schedule_id: str | dict, schedule_sig: str | None = None) -> None:
        schedule: dict | None
        if isinstance(schedule_id, dict):
            schedule = schedule_id
            schedule_id = str(schedule.get("id") or "")
        else:
            schedule = state_store.get_schedule(schedule_id)
        if not schedule or not schedule.get("active", True):
            return

        started = _now_utc()
        correlation_id = f"sched-{schedule_id or 'job'}-{started.timestamp():.0f}"
        job_tracker: JobRunTracker | None = None
        try:
            # Dynamic date range based on frequency (daily=yesterday→today, weekly=7d, monthly=30d)
            frequency = str(schedule.get("frequency") or "daily").strip().lower()
            dyn_start, dyn_end = _compute_dynamic_dates(frequency)

            payload = {
                "template_id": schedule.get("template_id"),
                "connection_id": schedule.get("connection_id"),
                "start_date": dyn_start,
                "end_date": dyn_end,
                "batch_ids": schedule.get("batch_ids") or None,
                "key_values": schedule.get("key_values") or None,
                "docx": bool(schedule.get("docx")),
                "xlsx": bool(schedule.get("xlsx")),
                "email_recipients": schedule.get("email_recipients") or None,
                "email_subject": schedule.get("email_subject")
                or f"[Scheduled] {schedule.get('template_name') or schedule.get('template_id')}",
                "email_message": schedule.get("email_message")
                or (
                    f"Scheduled run '{schedule.get('name')}' completed.\n"
                    f"Window: {dyn_start} - {dyn_end}."
                ),
                "schedule_id": schedule_id,
                "schedule_name": schedule.get("name"),
            }
            kind = schedule.get("template_kind") or "pdf"
            try:
                run_payload = RunPayload(**payload)
            except Exception:
                run_payload = None
            if run_payload is not None:
                steps = _build_job_steps(run_payload, kind=kind)
                meta = {
                    "start_date": payload.get("start_date"),
                    "end_date": payload.get("end_date"),
                    "schedule_id": schedule_id,
                    "schedule_name": schedule.get("name"),
                    "docx": bool(payload.get("docx")),
                    "xlsx": bool(payload.get("xlsx")),
                    "payload": payload,
                }
                job_record = state_store.create_job(
                    job_type="run_report",
                    template_id=run_payload.template_id,
                    connection_id=run_payload.connection_id,
                    template_name=schedule.get("template_name") or run_payload.template_id,
                    template_kind=kind,
                    schedule_id=schedule_id,
                    correlation_id=correlation_id,
                    steps=steps,
                    meta=meta,
                )
                step_progress = _step_progress_from_steps(steps)
                job_tracker = JobRunTracker(
                    job_record.get("id"),
                    correlation_id=correlation_id,
                    step_progress=step_progress,
                )
                job_tracker.start()
            runner = self._runner
            if inspect.iscoroutinefunction(runner):
                result = await runner(payload, kind, job_tracker=job_tracker)
            else:
                result = await asyncio.to_thread(runner, payload, kind, job_tracker=job_tracker)
            if inspect.isawaitable(result):
                result = await result
        except Exception as exc:
            finished = _now_utc()
            next_run = _next_run_datetime(schedule, finished).isoformat()
            state_store.record_schedule_run(
                schedule_id,
                started_at=started.isoformat(),
                finished_at=finished.isoformat(),
                status="failed",
                next_run_at=next_run,
                error="Scheduled report generation failed",
                artifacts=None,
            )
            logger.exception(
                "schedule_run_failed",
                extra={
                    "event": "schedule_run_failed",
                    "schedule_id": schedule_id,
                },
            )
            if job_tracker:
                job_tracker.fail("Scheduled report generation failed")
        else:
            finished = _now_utc()
            next_run = _next_run_datetime(schedule, finished).isoformat()
            artifacts = {
                "html_url": result.get("html_url"),
                "pdf_url": result.get("pdf_url"),
                "docx_url": result.get("docx_url"),
                "xlsx_url": result.get("xlsx_url"),
            }
            state_store.record_schedule_run(
                schedule_id,
                started_at=started.isoformat(),
                finished_at=finished.isoformat(),
                status="success",
                next_run_at=next_run,
                error=None,
                artifacts=artifacts,
            )
            logger.info(
                "schedule_run_complete",
                extra={
                    "event": "schedule_run_complete",
                    "schedule_id": schedule_id,
                    "html": artifacts.get("html_url"),
                    "pdf": artifacts.get("pdf_url"),
                },
            )
            if job_tracker:
                job_tracker.succeed(result)

"""
Error classification for job retry logic.

Determines whether errors are retriable (transient) or permanent.
This allows the job system to automatically retry transient failures
while immediately failing on permanent errors.
"""

import logging
import re
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger("neura.jobs.error_classifier")

class ErrorCategory(str, Enum):
    """Categories of errors for classification."""

    TRANSIENT = "transient"      # Temporary failure, should retry
    PERMANENT = "permanent"      # Will never succeed, don't retry
    RESOURCE = "resource"        # Resource exhaustion, retry with backoff
    TIMEOUT = "timeout"          # Operation timed out, may retry
    UNKNOWN = "unknown"          # Unknown error, default to retry

@dataclass
class ClassifiedError:
    """Result of error classification."""

    category: ErrorCategory
    is_retriable: bool
    original_message: str
    normalized_message: str
    suggested_backoff_multiplier: float = 1.0

class ErrorClassifier:
    """
    Classify errors as retriable or permanent.

    Uses pattern matching to identify common error types and determine
    whether they should be retried.
    """

    # Errors that are definitely retriable (transient failures)
    # NOTE: Order matters! More specific patterns should come before generic ones.
    TRANSIENT_PATTERNS = [
        # Rate limiting (check first, before "try again" pattern)
        (r"rate limit", ErrorCategory.RESOURCE),
        (r"throttl", ErrorCategory.RESOURCE),
        (r"429", ErrorCategory.RESOURCE),

        # Network/connection issues
        (r"connection refused", ErrorCategory.TRANSIENT),
        (r"connection reset", ErrorCategory.TRANSIENT),
        (r"connection timed out", ErrorCategory.TIMEOUT),
        (r"timeout", ErrorCategory.TIMEOUT),
        (r"temporary failure", ErrorCategory.TRANSIENT),
        (r"temporarily unavailable", ErrorCategory.TRANSIENT),
        (r"try again", ErrorCategory.TRANSIENT),
        (r"service unavailable", ErrorCategory.TRANSIENT),
        (r"503", ErrorCategory.TRANSIENT),
        (r"502", ErrorCategory.TRANSIENT),
        (r"504", ErrorCategory.TRANSIENT),

        # Database issues
        (r"database is locked", ErrorCategory.RESOURCE),
        (r"too many connections", ErrorCategory.RESOURCE),
        (r"deadlock", ErrorCategory.TRANSIENT),
        (r"lock wait timeout", ErrorCategory.TIMEOUT),
        (r"template lock", ErrorCategory.TRANSIENT),
        (r"file lock.*could not be acquired", ErrorCategory.TRANSIENT),
        (r"could not connect to server", ErrorCategory.TRANSIENT),

        # Browser/rendering issues (often transient)
        (r"playwright", ErrorCategory.TRANSIENT),
        (r"chromium", ErrorCategory.TRANSIENT),
        (r"browser.*closed", ErrorCategory.TRANSIENT),
        (r"target.*closed", ErrorCategory.TRANSIENT),
        (r"page crashed", ErrorCategory.TRANSIENT),

        # File system issues (often transient)
        (r"resource temporarily unavailable", ErrorCategory.RESOURCE),
        (r"no space left", ErrorCategory.RESOURCE),
        (r"disk quota", ErrorCategory.RESOURCE),
    ]

    # Errors that are definitely permanent (will never succeed)
    PERMANENT_PATTERNS = [
        # Not found errors
        (r"template not found", ErrorCategory.PERMANENT),
        (r"template_id.*not found", ErrorCategory.PERMANENT),
        (r"contract missing", ErrorCategory.PERMANENT),
        (r"connection not found", ErrorCategory.PERMANENT),
        (r"file not found", ErrorCategory.PERMANENT),
        (r"does not exist", ErrorCategory.PERMANENT),

        # Authentication/authorization
        (r"authentication failed", ErrorCategory.PERMANENT),
        (r"permission denied", ErrorCategory.PERMANENT),
        (r"unauthorized", ErrorCategory.PERMANENT),
        (r"forbidden", ErrorCategory.PERMANENT),
        (r"401", ErrorCategory.PERMANENT),
        (r"403", ErrorCategory.PERMANENT),

        # Validation errors
        (r"invalid template", ErrorCategory.PERMANENT),
        (r"invalid.*id", ErrorCategory.PERMANENT),
        (r"validation.*failed", ErrorCategory.PERMANENT),
        (r"schema.*invalid", ErrorCategory.PERMANENT),
        (r"malformed", ErrorCategory.PERMANENT),

        # Configuration errors
        (r"missing required", ErrorCategory.PERMANENT),
        (r"configuration error", ErrorCategory.PERMANENT),

        # Report pipeline failures (structurally permanent)
        (r"report generation failed", ErrorCategory.PERMANENT),
        (r"failed to load.*table", ErrorCategory.PERMANENT),
        (r"table.*not found", ErrorCategory.PERMANENT),
        (r"tables not found", ErrorCategory.PERMANENT),
        (r"no such table", ErrorCategory.PERMANENT),
        (r"relation.*does not exist", ErrorCategory.PERMANENT),
        (r"unknown column", ErrorCategory.PERMANENT),
        (r"no data returned", ErrorCategory.PERMANENT),
    ]

    @classmethod
    def classify(cls, error: str | Exception) -> ClassifiedError:
        """Classify an error as retriable or permanent."""
        if isinstance(error, Exception):
            error_str = str(error)
            error_type = type(error).__name__
        else:
            error_str = str(error)
            error_type = None

        error_lower = error_str.lower()

        # Check permanent patterns first (they take precedence)
        for pattern, category in cls.PERMANENT_PATTERNS:
            if re.search(pattern, error_lower):
                return ClassifiedError(
                    category=category,
                    is_retriable=False,
                    original_message=error_str,
                    normalized_message=f"[{category.value}] {error_str}",
                    suggested_backoff_multiplier=1.0,
                )

        # Check transient patterns
        for pattern, category in cls.TRANSIENT_PATTERNS:
            if re.search(pattern, error_lower):
                # Resource exhaustion errors should use longer backoff
                multiplier = 2.0 if category == ErrorCategory.RESOURCE else 1.0
                return ClassifiedError(
                    category=category,
                    is_retriable=True,
                    original_message=error_str,
                    normalized_message=f"[{category.value}] {error_str}",
                    suggested_backoff_multiplier=multiplier,
                )

        # Check for TimeoutError exception type
        if error_type and "timeout" in error_type.lower():
            return ClassifiedError(
                category=ErrorCategory.TIMEOUT,
                is_retriable=True,
                original_message=error_str,
                normalized_message=f"[{ErrorCategory.TIMEOUT.value}] {error_str}",
                suggested_backoff_multiplier=1.0,
            )

        # Try agent-based classification for unknown errors
        agent_result = cls._classify_unknown_with_agent(error_str, error_type)
        if agent_result is not None:
            return agent_result

        # Default: unknown errors are retriable (optimistic)
        logger.info(
            "error_classification_unknown",
            extra={
                "error_message": error_str[:200],
                "error_type": error_type,
                "decision": "retriable",
            }
        )

        return ClassifiedError(
            category=ErrorCategory.UNKNOWN,
            is_retriable=True,  # Optimistic default
            original_message=error_str,
            normalized_message=f"[unknown] {error_str}",
            suggested_backoff_multiplier=1.0,
        )

    @classmethod
    def _classify_unknown_with_agent(cls, error_msg: str, error_type: str | None) -> ClassifiedError | None:
        """Use LLM to classify errors that don't match known patterns.

        Returns ClassifiedError on success, None on failure (caller uses default).
        """
        try:
            from backend.app.services.llm import get_llm_client, _extract_response_text
            from backend.app.services.infra_services import extract_json_from_llm_response

            client = get_llm_client()
            prompt = (
                f"Classify this error as 'transient' (retry may help) or 'permanent' (needs human fix):\n"
                f"Error type: {error_type or 'unknown'}\n"
                f"Error message: {error_msg[:500]}\n\n"
                'Return ONLY JSON: {"classification": "transient" or "permanent", "reason": "brief reason"}'
            )
            resp = client.complete(
                messages=[{"role": "user", "content": prompt}],
                description="error_agent_classify",
                max_tokens=200,
            )
            text = _extract_response_text(resp)
            parsed = extract_json_from_llm_response(text)
            classification = str(parsed.get("classification", "")).lower()

            if classification == "permanent":
                category = ErrorCategory.PERMANENT
                is_retriable = False
            elif classification == "transient":
                category = ErrorCategory.TRANSIENT
                is_retriable = True
            else:
                return None  # Ambiguous — fall back to default

            reason = parsed.get("reason", "")
            logger.info(
                "error_agent_classified",
                extra={"classification": classification, "reason": reason, "error": error_msg[:200]},
            )

            return ClassifiedError(
                category=category,
                is_retriable=is_retriable,
                original_message=error_msg,
                normalized_message=f"[agent:{classification}] {error_msg}",
                suggested_backoff_multiplier=1.0,
            )
        except Exception:
            logger.debug("error_agent_classify_failed", exc_info=True)
            return None

    @classmethod
    def is_retriable(cls, error: str | Exception) -> bool:
        """Quick check if an error is retriable."""
        return cls.classify(error).is_retriable

    @classmethod
    def get_backoff_multiplier(cls, error: str | Exception) -> float:
        """Get the suggested backoff multiplier for an error."""
        return cls.classify(error).suggested_backoff_multiplier

def is_retriable_error(error: str | Exception) -> bool:
    """Convenience function to check if an error is retriable."""
    return ErrorClassifier.is_retriable(error)

def classify_error(error: str | Exception) -> ClassifiedError:
    """Convenience function to classify an error."""
    return ErrorClassifier.classify(error)

"""
Job Recovery Daemon

Background service that:
1. Finds and recovers orphaned jobs (running jobs with stale heartbeats)
2. Re-queues jobs that are ready for retry
3. Delivers pending webhook notifications

This daemon ensures job durability across server restarts and worker failures.
"""

import logging
import os
import random
import threading
from datetime import datetime, timezone
from typing import Callable, Optional

logger = logging.getLogger("neura.jobs.recovery")

class JobRecoveryDaemon:
    """
    Background daemon for job recovery and maintenance.

    Runs periodically to:
    - Detect and recover stale running jobs
    - Re-queue jobs that have waited long enough for retry
    - Deliver pending webhook notifications

    The daemon is designed to be fault-tolerant and will continue
    operating even if individual recovery operations fail.
    """

    DEFAULT_POLL_INTERVAL_SECONDS = 30
    DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 120

    def __init__(
        self,
        poll_interval_seconds: int | None = None,
        heartbeat_timeout_seconds: int | None = None,
        reschedule_callback: Optional[Callable[[str], None]] = None,
    ):
        """Initialize the recovery daemon."""
        self.poll_interval_seconds = poll_interval_seconds or int(
            os.getenv("NEURA_RECOVERY_POLL_INTERVAL", str(self.DEFAULT_POLL_INTERVAL_SECONDS))
        )
        self.heartbeat_timeout_seconds = heartbeat_timeout_seconds or int(
            os.getenv("NEURA_HEARTBEAT_TIMEOUT", str(self.DEFAULT_HEARTBEAT_TIMEOUT_SECONDS))
        )
        self.reschedule_callback = reschedule_callback

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Statistics
        self._stats = {
            "stale_jobs_recovered": 0,
            "jobs_requeued": 0,
            "jobs_moved_to_dlq": 0,
            "webhooks_sent": 0,
            "idempotency_keys_cleaned": 0,
            "errors": 0,
            "last_run_at": None,
            "runs": 0,
        }

    @property
    def is_running(self) -> bool:
        """Check if the daemon is currently running."""
        return self._running and self._thread is not None and self._thread.is_alive()

    @property
    def stats(self) -> dict:
        """Get daemon statistics."""
        return dict(self._stats)

    def start(self) -> bool:
        """Start the recovery daemon in a background thread."""
        if self.is_running:
            logger.warning("recovery_daemon_already_running")
            return False

        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop,
            name="JobRecoveryDaemon",
            daemon=True,
        )
        self._thread.start()
        logger.info("recovery_daemon_started", extra={"poll_interval": self.poll_interval_seconds})
        return True

    def stop(self, timeout_seconds: float = 10) -> bool:
        """Stop the recovery daemon."""
        if not self._running:
            return True

        logger.info("recovery_daemon_stopping")
        self._running = False
        self._stop_event.set()

        if self._thread is not None:
            self._thread.join(timeout=timeout_seconds)
            if self._thread.is_alive():
                logger.warning("recovery_daemon_stop_timeout")
                return False

        logger.info("recovery_daemon_stopped", extra={"stats": self._stats})
        return True

    def _run_loop(self) -> None:
        """Main daemon loop - runs in background thread."""
        logger.info("recovery_daemon_loop_started")

        while self._running and not self._stop_event.is_set():
            try:
                self._run_recovery_cycle()
            except Exception:
                self._stats["errors"] += 1
                logger.exception("recovery_daemon_cycle_error")

            # Wait for next cycle or stop signal (with jitter to prevent thundering herd)
            jitter = random.uniform(0, self.poll_interval_seconds * 0.2)
            self._stop_event.wait(timeout=self.poll_interval_seconds + jitter)

        logger.info("recovery_daemon_loop_exited")

    def _run_recovery_cycle(self) -> None:
        """Run a single recovery cycle."""
        from backend.app.repositories import state_store

        self._stats["runs"] += 1
        self._stats["last_run_at"] = datetime.now(timezone.utc).isoformat()

        # Step 1: Recover stale running jobs
        self._recover_stale_jobs(state_store)

        # Step 2: Re-queue jobs ready for retry
        self._requeue_retry_jobs(state_store)

        # Step 3: Send pending webhooks
        self._send_pending_webhooks(state_store)

        # Step 4: Clean expired idempotency keys
        self._clean_idempotency_keys(state_store)

        # Step 5: Move permanently failed jobs to DLQ
        self._move_failed_to_dlq(state_store)

    def _recover_stale_jobs(self, state_store) -> None:
        """Find and recover jobs that have stale heartbeats."""
        try:
            stale_jobs = state_store.find_stale_running_jobs(
                heartbeat_timeout_seconds=self.heartbeat_timeout_seconds
            )

            for job in stale_jobs:
                job_id = job.get("id")
                retry_count = job.get("retry_count") or 0
                max_retries = job.get("max_retries") or 3

                logger.info(
                    "recovering_stale_job",
                    extra={
                        "job_id": job_id,
                        "retry_count": retry_count,
                        "max_retries": max_retries,
                        "last_heartbeat": job.get("last_heartbeat_at"),
                    }
                )

                if retry_count < max_retries:
                    # Mark for retry
                    state_store.mark_job_for_retry(
                        job_id,
                        reason="Worker heartbeat timeout - job may have crashed",
                        is_retriable=True,
                    )
                    self._stats["stale_jobs_recovered"] += 1
                else:
                    # Max retries exceeded, mark as permanently failed
                    state_store.record_job_completion(
                        job_id,
                        status="failed",
                        error="Worker died and max retries exceeded",
                    )
                    logger.warning(
                        "stale_job_permanently_failed",
                        extra={"job_id": job_id, "retry_count": retry_count}
                    )

        except Exception:
            self._stats["errors"] += 1
            logger.exception("recover_stale_jobs_error")

    def _requeue_retry_jobs(self, state_store) -> None:
        """Re-queue jobs that are ready for retry."""
        try:
            retry_jobs = state_store.find_jobs_ready_for_retry()

            for job in retry_jobs:
                job_id = job.get("id")

                logger.info(
                    "requeuing_job_for_retry",
                    extra={
                        "job_id": job_id,
                        "retry_count": job.get("retry_count"),
                        "retry_at": job.get("retry_at"),
                    }
                )

                # Move job back to queued state
                state_store.requeue_job_for_retry(job_id)
                self._stats["jobs_requeued"] += 1

                # Trigger re-execution if callback is provided
                if self.reschedule_callback:
                    try:
                        self.reschedule_callback(job_id)
                    except Exception:
                        logger.exception(
                            "reschedule_callback_error",
                            extra={"job_id": job_id}
                        )

        except Exception:
            self._stats["errors"] += 1
            logger.exception("requeue_retry_jobs_error")

    def _send_pending_webhooks(self, state_store) -> None:
        """Send webhook notifications for completed jobs."""
        try:
            # send_job_webhook_sync defined in this file

            pending_jobs = state_store.get_jobs_pending_webhook()

            for job in pending_jobs:
                job_id = job.get("id")
                webhook_url = job.get("webhook_url")

                if not webhook_url:
                    continue

                logger.info(
                    "sending_pending_webhook",
                    extra={
                        "job_id": job_id,
                        "status": job.get("status"),
                    }
                )

                try:
                    result = send_job_webhook_sync(job)

                    if result.success:
                        state_store.mark_webhook_sent(job_id)
                        self._stats["webhooks_sent"] += 1
                    else:
                        logger.warning(
                            "webhook_delivery_failed_in_daemon",
                            extra={
                                "job_id": job_id,
                                "error": result.error,
                                "attempts": result.attempts,
                            }
                        )
                except Exception:
                    logger.exception(
                        "webhook_send_error",
                        extra={"job_id": job_id}
                    )

        except Exception:
            self._stats["errors"] += 1
            logger.exception("send_pending_webhooks_error")

    def _clean_idempotency_keys(self, state_store) -> None:
        """Clean up expired idempotency keys."""
        try:
            cleaned = state_store.clean_expired_idempotency_keys()
            self._stats["idempotency_keys_cleaned"] += cleaned

            if cleaned > 0:
                logger.info(
                    "cleaned_expired_idempotency_keys",
                    extra={"count": cleaned}
                )

        except Exception:
            self._stats["errors"] += 1
            logger.exception("clean_idempotency_keys_error")

    def _move_failed_to_dlq(self, state_store) -> None:
        """
        Move permanently failed jobs to the Dead Letter Queue.

        Jobs are moved to DLQ when:
        - Status is 'failed'
        - Max retries exceeded (retry_count >= max_retries)
        - Not already in DLQ (no dead_letter_at timestamp)
        """
        try:
            # Get all jobs
            all_jobs = state_store.list_jobs(
                statuses=["failed"],
                limit=0,  # No limit - get all
            )

            for job in all_jobs:
                job_id = job.get("id")

                # Skip if already in DLQ
                dead_letter_at = job.get("dead_letter_at") or job.get("deadLetterAt")
                if dead_letter_at:
                    continue

                retry_count = job.get("retry_count", job.get("retryCount", 0)) or 0
                max_retries = job.get("max_retries", job.get("maxRetries", 3)) or 3

                # Only move to DLQ if retries exhausted
                if retry_count >= max_retries:
                    logger.info(
                        "moving_job_to_dlq",
                        extra={
                            "job_id": job_id,
                            "retry_count": retry_count,
                            "max_retries": max_retries,
                            "error": job.get("error"),
                        }
                    )

                    # Build failure history from job error
                    failure_history = [{
                        "attempt": retry_count,
                        "error": job.get("error") or "Unknown error",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "category": "exhausted",
                    }]

                    state_store.move_job_to_dlq(job_id, failure_history)
                    self._stats["jobs_moved_to_dlq"] += 1

        except Exception:
            self._stats["errors"] += 1
            logger.exception("move_failed_to_dlq_error")

# Module-level singleton
_daemon: Optional[JobRecoveryDaemon] = None
_daemon_lock = threading.Lock()

def get_recovery_daemon() -> JobRecoveryDaemon:
    """Get the singleton recovery daemon instance."""
    global _daemon
    if _daemon is None:
        with _daemon_lock:
            if _daemon is None:
                _daemon = JobRecoveryDaemon()
    return _daemon

def start_recovery_daemon(
    reschedule_callback: Optional[Callable[[str], None]] = None,
) -> bool:
    """Start the recovery daemon (if not already running)."""
    daemon = get_recovery_daemon()
    if reschedule_callback:
        daemon.reschedule_callback = reschedule_callback
    return daemon.start()

def stop_recovery_daemon(timeout_seconds: float = 10) -> bool:
    """Stop the recovery daemon."""
    daemon = get_recovery_daemon()
    return daemon.stop(timeout_seconds)

def is_recovery_daemon_running() -> bool:
    """Check if the recovery daemon is running."""
    return get_recovery_daemon().is_running

def get_recovery_daemon_stats() -> dict:
    """Get recovery daemon statistics."""
    return get_recovery_daemon().stats

import importlib
import logging
from typing import Any, Iterable, Mapping, Optional

from backend.app.repositories import state_store as state_store_module
from backend.app.schemas import RunPayload
from backend.app.utils import normalize_email_targets

logger = logging.getLogger("backend.legacy.services.report_service")

def get_state_store():
    try:
        api_mod = importlib.import_module("backend.api")
        return getattr(api_mod, "state_store", state_store_module)
    except Exception:
        return state_store_module

DEFAULT_JOB_STEP_PROGRESS = {
    "dataLoad": 5.0,
    "contractCheck": 15.0,
    "renderPdf": 60.0,
    "renderDocx": 75.0,
    "renderXlsx": 85.0,
    "finalize": 95.0,
    "email": 100.0,
}

def _build_job_steps(payload: RunPayload, *, kind: str) -> list[dict[str, str]]:
    steps: list[dict[str, str]] = [
        {"name": "dataLoad", "label": "Load database"},
        {"name": "contractCheck", "label": "Prepare contract"},
        {"name": "renderPdf", "label": "Render PDF"},
    ]
    docx_requested = bool(payload.docx)
    if docx_requested:
        steps.append({"name": "renderDocx", "label": "Render DOCX"})
    if kind == "excel" or bool(payload.xlsx):
        steps.append({"name": "renderXlsx", "label": "Render XLSX"})
    steps.append({"name": "finalize", "label": "Finalize artifacts"})
    if normalize_email_targets(payload.email_recipients):
        steps.append({"name": "email", "label": "Send email"})
    return steps

def _step_progress_from_steps(steps: Iterable[Mapping[str, Any]]) -> dict[str, float]:
    progress: dict[str, float] = {}
    for step in steps:
        name = str(step.get("name") or "").strip()
        if not name:
            continue
        progress[name] = DEFAULT_JOB_STEP_PROGRESS.get(name, 0.0)
    return progress

class JobRunTracker:
    def __init__(
        self,
        job_id: str | None,
        *,
        correlation_id: str | None = None,
        step_progress: Optional[Mapping[str, float]] = None,
    ) -> None:
        self.job_id = job_id
        self.correlation_id = correlation_id
        self.step_progress = {k: float(v) for k, v in (step_progress or {}).items()}
        self._step_names = set(self.step_progress.keys()) if self.step_progress else None

    def _should_track(self, name: str) -> bool:
        if not name:
            return False
        if self._step_names is None:
            return True
        return name in self._step_names

    def has_step(self, name: str) -> bool:
        return self._should_track(name)

    def start(self) -> None:
        if not self.job_id:
            return
        try:
            get_state_store().record_job_start(self.job_id)
        except Exception:
            logger.exception(
                "job_start_record_failed",
                extra={
                    "event": "job_start_record_failed",
                    "job_id": self.job_id,
                    "correlation_id": self.correlation_id,
                },
            )

    def progress(self, value: float) -> None:
        if not self.job_id:
            return
        try:
            get_state_store().record_job_progress(self.job_id, value)
        except Exception:
            logger.exception(
                "job_progress_record_failed",
                extra={
                    "event": "job_progress_record_failed",
                    "job_id": self.job_id,
                    "correlation_id": self.correlation_id,
                },
            )

    def _record_step(
        self,
        name: str,
        status: str,
        *,
        error: Optional[str] = None,
        progress: Optional[float] = None,
        label: Optional[str] = None,
    ) -> None:
        if not self.job_id or not self._should_track(name):
            return
        try:
            get_state_store().record_job_step(
                self.job_id,
                name,
                status=status,
                error=error,
                progress=progress,
                label=label,
            )
        except Exception:
            logger.exception(
                "job_step_record_failed",
                extra={
                    "event": "job_step_record_failed",
                    "job_id": self.job_id,
                    "step": name,
                    "correlation_id": self.correlation_id,
                },
            )

    def step_running(self, name: str, *, label: Optional[str] = None) -> None:
        self._record_step(name, "running", label=label)

    def step_succeeded(self, name: str, *, progress: Optional[float] = None) -> None:
        progress_value = progress if progress is not None else self.step_progress.get(name)
        self._record_step(name, "succeeded")
        if progress_value is not None:
            self.progress(progress_value)

    def step_failed(self, name: str, error: str) -> None:
        self._record_step(name, "failed", error=str(error))

    def succeed(self, result: Optional[Mapping[str, Any]]) -> None:
        if not self.job_id:
            return
        self.progress(100.0)
        try:
            get_state_store().record_job_completion(self.job_id, status="succeeded", error=None, result=result)
        except Exception:
            logger.exception(
                "job_completion_record_failed",
                extra={
                    "event": "job_completion_record_failed",
                    "job_id": self.job_id,
                    "correlation_id": self.correlation_id,
                },
            )

    def fail(self, error: str, *, status: str = "failed") -> None:
        if not self.job_id:
            return
        try:
            get_state_store().record_job_completion(self.job_id, status=status, error=str(error), result=None)
        except Exception:
            logger.exception(
                "job_completion_record_failed",
                extra={
                    "event": "job_completion_record_failed",
                    "job_id": self.job_id,
                    "correlation_id": self.correlation_id,
                },
            )

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False

@dataclass
class WebhookPayload:
    """Payload structure for webhook notifications."""
    job_id: str
    status: str
    template_id: Optional[str]
    template_name: Optional[str]
    artifacts: Optional[Dict[str, Any]]
    error: Optional[str]
    completed_at: Optional[str]
    event_type: str = "job.completed"
    retry_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event": self.event_type,
            "job_id": self.job_id,
            "status": self.status,
            "template_id": self.template_id,
            "template_name": self.template_name,
            "artifacts": self.artifacts,
            "error": self.error,
            "completed_at": self.completed_at,
            "retry_count": self.retry_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

@dataclass
class WebhookResult:
    """Result of webhook delivery attempt."""

    success: bool
    status_code: Optional[int]
    attempts: int
    error: Optional[str]
    response_body: Optional[str] = None

class WebhookService:
    """
    Service for delivering webhook notifications.

    Features:
    - HMAC-SHA256 signature for payload verification
    - Retry with exponential backoff
    - Configurable timeout and retry settings
    """

    # Default configuration
    DEFAULT_TIMEOUT_SECONDS = 10
    DEFAULT_MAX_RETRIES = 3
    DEFAULT_INITIAL_BACKOFF_SECONDS = 1

    # Environment-based secret for signing (can be overridden per-job)
    DEFAULT_WEBHOOK_SECRET = os.getenv("NEURA_WEBHOOK_SECRET", "neura-default-webhook-secret")

    # Private/loopback networks that must not be used as webhook targets
    _BLOCKED_NETWORKS = [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("172.16.0.0/12"),
        ipaddress.ip_network("192.168.0.0/16"),
        ipaddress.ip_network("127.0.0.0/8"),
        ipaddress.ip_network("169.254.0.0/16"),
        ipaddress.ip_network("::1/128"),
        ipaddress.ip_network("fc00::/7"),
        ipaddress.ip_network("fe80::/10"),
    ]

    def __init__(
        self,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        initial_backoff_seconds: float = DEFAULT_INITIAL_BACKOFF_SECONDS,
    ):
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.initial_backoff_seconds = initial_backoff_seconds

        # Production guard: ensure webhook secret is set in production
        settings = get_settings()
        if self.DEFAULT_WEBHOOK_SECRET == "neura-default-webhook-secret":
            if settings.debug_mode:
                logger.warning(
                    "webhook_secret_default",
                    extra={"event": "webhook_secret_default"},
                )
            else:
                raise RuntimeError(
                    "NEURA_WEBHOOK_SECRET must be set to a strong secret in production "
                    "(debug_mode is off). Set NEURA_DEBUG=true to bypass for local development."
                )

    @classmethod
    def _validate_webhook_url(cls, url: str) -> None:
        """Validate webhook URL to prevent SSRF attacks.

        Rejects private/loopback IPs, non-HTTP(S) schemes, and bare IPs
        that resolve to internal networks.
        """
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Webhook URL must use http or https scheme, got {parsed.scheme!r}")

        hostname = parsed.hostname
        if not hostname:
            raise ValueError("Webhook URL has no hostname")

        # Check if hostname is an IP address in a blocked range
        try:
            addr = ipaddress.ip_address(hostname)
            for network in cls._BLOCKED_NETWORKS:
                if addr in network:
                    raise ValueError("Webhook URL must not target private/loopback addresses")
        except ValueError as ve:
            if "private" in str(ve).lower() or "loopback" in str(ve).lower() or "must not" in str(ve):
                raise
            # hostname is not an IP literal — that's fine, allow DNS names
            pass

        # Block well-known cloud metadata endpoints
        if hostname in ("metadata.google.internal", "metadata.google.com", "169.254.169.254"):
            raise ValueError("Webhook URL must not target cloud metadata services")

        # Resolve DNS to prevent DNS rebinding attacks
        import socket
        port = parsed.port
        try:
            addr_infos = socket.getaddrinfo(hostname, port or 443, proto=socket.IPPROTO_TCP)
            for family, _, _, _, sockaddr in addr_infos:
                ip = ipaddress.ip_address(sockaddr[0])
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    raise ValueError(f"Webhook URL resolves to blocked IP range")
        except socket.gaierror as e:
            raise ValueError(f"Cannot resolve webhook hostname") from e

    def compute_signature(self, payload: Dict[str, Any], secret: str) -> str:
        """Compute HMAC-SHA256 signature for webhook payload."""
        payload_bytes = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        signature = hmac.new(
            secret.encode("utf-8"),
            payload_bytes,
            hashlib.sha256
        ).hexdigest()
        return signature

    def build_headers(self, payload: Dict[str, Any], secret: str) -> Dict[str, str]:
        """Build HTTP headers for webhook request."""
        signature = self.compute_signature(payload, secret)
        return {
            "Content-Type": "application/json",
            "User-Agent": "NeuraReport-Webhook/1.0",
            "X-NeuraReport-Event": "job.completed",
            "X-NeuraReport-Signature": f"sha256={signature}",
            "X-NeuraReport-Delivery": datetime.now(timezone.utc).isoformat(),
        }

    async def deliver(
        self,
        webhook_url: str,
        payload: WebhookPayload,
        secret: Optional[str] = None,
    ) -> WebhookResult:
        """Deliver webhook notification with retry."""
        if not HTTPX_AVAILABLE:
            logger.warning("webhook_delivery_skipped", extra={"reason": "httpx not installed"})
            return WebhookResult(
                success=False,
                status_code=None,
                attempts=0,
                error="httpx library not installed",
            )

        if not webhook_url:
            return WebhookResult(
                success=False,
                status_code=None,
                attempts=0,
                error="No webhook URL configured",
            )

        # SSRF protection: validate URL before making any request
        try:
            self._validate_webhook_url(webhook_url)
        except ValueError as ve:
            logger.warning("webhook_url_rejected", extra={"reason": str(ve), "url": webhook_url[:100]})
            return WebhookResult(
                success=False,
                status_code=None,
                attempts=0,
                error=f"Invalid webhook URL: {ve}",
            )

        secret = secret or self.DEFAULT_WEBHOOK_SECRET
        if secret == "neura-default-webhook-secret":
            logger.warning(
                "webhook_using_default_secret",
                extra={"hint": "Set NEURA_WEBHOOK_SECRET env var for production use"},
            )
        payload_dict = payload.to_dict()
        headers = self.build_headers(payload_dict, secret)

        last_error: Optional[str] = None
        last_status: Optional[int] = None

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                    response = await client.post(
                        webhook_url,
                        json=payload_dict,
                        headers=headers,
                    )

                last_status = response.status_code

                if response.status_code < 400:
                    logger.info(
                        "webhook_delivery_success",
                        extra={
                            "job_id": payload.job_id,
                            "webhook_url": webhook_url[:100],
                            "status_code": response.status_code,
                            "attempt": attempt + 1,
                        }
                    )
                    return WebhookResult(
                        success=True,
                        status_code=response.status_code,
                        attempts=attempt + 1,
                        error=None,
                        response_body=response.text[:500] if response.text else None,
                    )

                # Server error (5xx) - retry
                if response.status_code >= 500:
                    last_error = f"Server error: {response.status_code}"
                    logger.warning(
                        "webhook_delivery_server_error",
                        extra={
                            "job_id": payload.job_id,
                            "status_code": response.status_code,
                            "attempt": attempt + 1,
                        }
                    )
                else:
                    # Client error (4xx) - don't retry
                    last_error = f"Client error: {response.status_code}"
                    logger.warning(
                        "webhook_delivery_client_error",
                        extra={
                            "job_id": payload.job_id,
                            "status_code": response.status_code,
                            "response": response.text[:200] if response.text else None,
                        }
                    )
                    return WebhookResult(
                        success=False,
                        status_code=response.status_code,
                        attempts=attempt + 1,
                        error=last_error,
                        response_body=response.text[:500] if response.text else None,
                    )

            except httpx.TimeoutException as e:
                last_error = "Timeout during webhook delivery"
                logger.warning(
                    "webhook_delivery_timeout",
                    extra={
                        "job_id": payload.job_id,
                        "attempt": attempt + 1,
                    }
                )

            except httpx.RequestError as e:
                last_error = "Request error during webhook delivery"
                logger.warning(
                    "webhook_delivery_error",
                    extra={
                        "job_id": payload.job_id,
                        "attempt": attempt + 1,
                        "error_type": type(e).__name__,
                    }
                )

            except Exception as e:
                last_error = "Unexpected error during webhook delivery"
                logger.exception(
                    "webhook_delivery_unexpected_error",
                    extra={
                        "job_id": payload.job_id,
                        "attempt": attempt + 1,
                    }
                )

            # Calculate backoff for next retry
            if attempt < self.max_retries - 1:
                backoff = self.initial_backoff_seconds * (2 ** attempt)
                await asyncio.sleep(backoff)

        # All retries exhausted
        logger.error(
            "webhook_delivery_failed",
            extra={
                "job_id": payload.job_id,
                "webhook_url": webhook_url[:100],
                "attempts": self.max_retries,
                "last_error": last_error,
            }
        )

        return WebhookResult(
            success=False,
            status_code=last_status,
            attempts=self.max_retries,
            error=last_error,
        )

    def deliver_sync(
        self,
        webhook_url: str,
        payload: WebhookPayload,
        secret: Optional[str] = None,
    ) -> WebhookResult:
        """Synchronous wrapper for webhook delivery."""
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(
                asyncio.run, self.deliver(webhook_url, payload, secret)
            ).result()

# Singleton instance
_webhook_service: Optional[WebhookService] = None

def get_webhook_service() -> WebhookService:
    """Get the singleton webhook service instance."""
    global _webhook_service
    if _webhook_service is None:
        try:
            _webhook_service = WebhookService()
        except RuntimeError:
            logger.error(
                "webhook_service_init_failed",
                extra={"event": "webhook_service_init_failed"},
            )
            raise
    return _webhook_service

async def send_job_webhook(
    job: Dict[str, Any],
    webhook_url: Optional[str] = None,
    webhook_secret: Optional[str] = None,
) -> WebhookResult:
    """Convenience function to send webhook notification for a job."""
    url = webhook_url or job.get("webhookUrl") or job.get("webhook_url")
    secret = webhook_secret or job.get("webhook_secret")

    if not url:
        return WebhookResult(
            success=True,  # No webhook configured is not an error
            status_code=None,
            attempts=0,
            error=None,
        )

    payload = WebhookPayload(
        job_id=job.get("id") or job.get("job_id") or "",
        status=job.get("status") or "",
        template_id=job.get("templateId") or job.get("template_id"),
        template_name=job.get("templateName") or job.get("template_name"),
        artifacts=job.get("result", {}).get("artifacts", {}),
        error=job.get("error"),
        completed_at=job.get("finishedAt") or job.get("finished_at"),
        retry_count=job.get("retryCount") or job.get("retry_count") or 0,
    )

    service = get_webhook_service()
    return await service.deliver(url, payload, secret)

def send_job_webhook_sync(
    job: Dict[str, Any],
    webhook_url: Optional[str] = None,
    webhook_secret: Optional[str] = None,
) -> WebhookResult:
    """Synchronous version of send_job_webhook."""
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(
            asyncio.run, send_job_webhook(job, webhook_url, webhook_secret)
        ).result()
