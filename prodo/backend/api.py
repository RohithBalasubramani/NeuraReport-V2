# mypy: ignore-errors
from __future__ import annotations

import logging
import os
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

# Load environment variables FIRST, before any backend imports.
# env_loader uses only stdlib — safe for early import.
import sys as _sys
from backend.app.utils import load_env_file as _load_env_file

_loaded_from = _load_env_file()
if _loaded_from:
    print(f"[ENV] Loaded from: {_loaded_from}", file=_sys.stderr)
if os.environ.get("NEURA_DEBUG", "").lower() in {"1", "true", "yes"}:
    print(f"[ENV] NEURA_DEBUG={os.environ.get('NEURA_DEBUG')}", file=_sys.stderr)

# Silence noisy deprecations from dependencies during import/test
warnings.filterwarnings("ignore", message=".*on_event is deprecated.*", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*Support for class-based `config` is deprecated.*", category=DeprecationWarning)
warnings.filterwarnings("ignore", message=".*SwigPy.*has no __module__ attribute", category=DeprecationWarning)

from fastapi import FastAPI, UploadFile


from backend.app.services.config import UploadsStaticFiles

from backend.app.utils import EventBus, logging_middleware, metrics_middleware
from backend.app.api.middleware import add_exception_handlers
from backend.app.api.middleware import add_middlewares  # ARCH-EXC-002
from backend.app.api.router import register_routes  # ARCH-EXC-002
from backend.app.services.legacy_services import (
    _run_report_job_sync as _run_report_job_sync,
    _run_report_with_email as _run_report_with_email,
    _schedule_report_job as _schedule_report_job,
    scheduler_runner as report_scheduler_runner,
)
from backend.app.services.legacy_services import JobRunTracker as JobRunTracker

import backend.app.services.legacy_services as report_service

from backend.app.services.config import get_settings, log_settings
from backend.app.services.config import init_auth_db
from backend.app.services.db.engine import dispose_engine

from backend.app.services.scheduler import ReportScheduler
from backend.app.services.scheduler import start_recovery_daemon, stop_recovery_daemon
from backend.app.services.config import mark_incomplete_jobs_failed
from backend.app.services.agents import agent_service_v2
from backend.app.services.agents import agent_task_worker

def _configure_error_log_handler(target_logger: logging.Logger | None = None) -> Path | None:
    """
    Attach a file handler that records backend errors for desktop/frontend debugging.
    Path defaults to backend/logs/backend_errors.log but can be overridden via NEURA_ERROR_LOG.

    The handler is attached to the ``neura`` and ``backend`` top-level logger
    namespaces (which cover all application loggers) as well as the root logger
    as a fallback.  This avoids relying solely on root-logger propagation, which
    can be disrupted by uvicorn's logging dictConfig.
    """
    log_target = os.getenv("NEURA_ERROR_LOG")
    if log_target:
        log_file = Path(log_target).expanduser()
    else:
        backend_dir = Path(__file__).resolve().parent
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_file = logs_dir / "backend_errors.log"

    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.touch(exist_ok=True)

    abs_log_file = str(log_file.resolve())

    try:
        handler = logging.FileHandler(log_file, encoding="utf-8")
    except OSError:
        return None

    handler.setLevel(logging.ERROR)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))

    # Attach only to the root logger.  All child loggers (neura.*, backend.*,
    # uvicorn.*, etc.) propagate to root by default, so a single handler here
    # captures everything without duplicate entries.
    root = target_logger or logging.getLogger()
    root_attached = any(
        isinstance(h, logging.FileHandler)
        and os.path.abspath(getattr(h, "baseFilename", "")) == abs_log_file
        for h in root.handlers
    )
    if not root_attached:
        root.addHandler(handler)

    return log_file


def _configure_llm_log_handler() -> Path | None:
    """Configure a dedicated log file for LLM calls and outputs."""
    log_target = os.getenv("NEURA_LLM_LOG")
    if log_target:
        log_file = Path(log_target).expanduser()
    else:
        backend_dir = Path(__file__).resolve().parent
        logs_dir = backend_dir / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_file = logs_dir / "llm.log"

    log_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.touch(exist_ok=True)
    abs_log_file = str(log_file.resolve())

    try:
        handler = logging.FileHandler(log_file, encoding="utf-8")
    except OSError:
        return None

    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))

    llm_logger = logging.getLogger("neura.llm")
    llm_logger.setLevel(logging.DEBUG)
    already_attached = any(
        isinstance(h, logging.FileHandler)
        and os.path.abspath(getattr(h, "baseFilename", "")) == abs_log_file
        for h in llm_logger.handlers
    )
    if not already_attached:
        llm_logger.addHandler(handler)

    return log_file


# ---------- App & CORS ----------
logger = logging.getLogger("neura.api")
EVENT_BUS = EventBus(middlewares=[logging_middleware(logger), metrics_middleware(logger)])
SETTINGS = get_settings()
log_settings(logger, SETTINGS)
ERROR_LOG_PATH: Path | None = None
SCHEDULER: ReportScheduler | None = None
SCHEDULER_DISABLED = os.getenv("NEURA_SCHEDULER_DISABLED", "false").lower() == "true"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ERROR_LOG_PATH, SCHEDULER

    if not ERROR_LOG_PATH:
        ERROR_LOG_PATH = _configure_error_log_handler(logging.getLogger())
        if ERROR_LOG_PATH:
            logger.info("error_log_configured", extra={"event": "error_log_configured", "path": str(ERROR_LOG_PATH)})

    llm_log_path = _configure_llm_log_handler()
    if llm_log_path:
        logger.info("llm_log_configured", extra={"event": "llm_log_configured", "path": str(llm_log_path)})

    try:
        await init_auth_db()
    except Exception as exc:
        logger.info("auth_db_init_skipped", extra={"event": "auth_db_init_skipped", "error": str(exc)})

    # Prune stale template/connection entries whose directories no longer exist on disk
    try:
        from backend.app.repositories import state_store
        _upload_root = os.getenv("UPLOAD_ROOT", "backend/uploads")
        _excel_root = os.getenv("EXCEL_UPLOAD_ROOT", "backend/uploads_excel")
        pruned_tpl = state_store.prune_stale_templates(_upload_root, _excel_root) if hasattr(state_store, 'prune_stale_templates') else 0
        pruned_conn = state_store.prune_stale_connections() if hasattr(state_store, 'prune_stale_connections') else 0
        if pruned_tpl:
            logger.info("stale_templates_pruned", extra={"event": "stale_templates_pruned", "count": pruned_tpl})
        if pruned_conn:
            logger.info("stale_connections_pruned", extra={"event": "stale_connections_pruned", "count": pruned_conn})
    except Exception as exc:
        logger.warning("stale_prune_failed", extra={"event": "stale_prune_failed", "error": str(exc)})

    # Seed sample data for new installations
    seed_enabled = os.getenv("NEURA_SEED_DATA", "true").lower() in {"1", "true", "yes"}
    if seed_enabled:
        try:
            from backend.app.services.config import seed_all
            await seed_all()
        except Exception as exc:
            logger.warning("seed_data_failed", extra={"event": "seed_data_failed", "error": str(exc)})

    if not SCHEDULER_DISABLED and SCHEDULER is None:
        poll_seconds = max(int(os.getenv("NEURA_SCHEDULER_INTERVAL", "60") or "60"), 15)
        SCHEDULER = ReportScheduler(_scheduler_runner, poll_seconds=poll_seconds)
    if SCHEDULER and not SCHEDULER_DISABLED:
        await SCHEDULER.start()

    recover_jobs = os.getenv("NEURA_RECOVER_JOBS_ON_STARTUP", "true").lower() in {"1", "true", "yes"}
    if recover_jobs:
        try:
            recovered = report_service.recover_report_jobs()
            if recovered:
                logger.info(
                    "report_jobs_recovered",
                    extra={"event": "report_jobs_recovered", "count": recovered},
                )
        except Exception as exc:
            logger.warning(
                "report_job_recovery_failed",
                extra={"event": "report_job_recovery_failed", "error": str(exc)},
            )
        try:
            updated = mark_incomplete_jobs_failed(skip_types={"run_report"})
            if updated:
                logger.info(
                    "background_jobs_marked_failed",
                    extra={"event": "background_jobs_marked_failed", "count": updated},
                )
        except Exception as exc:
            logger.warning(
                "background_job_cleanup_failed",
                extra={"event": "background_job_cleanup_failed", "error": str(exc)},
            )

    # Agent task recovery and worker startup (Trade-off 1 + 3)
    agent_worker_disabled = os.getenv("NEURA_AGENT_WORKER_DISABLED", "false").lower() == "true"
    try:
        recovered = agent_service_v2.recover_stale_tasks()
        if recovered:
            logger.info(
                "agent_tasks_recovered",
                extra={"event": "agent_tasks_recovered", "count": recovered},
            )
    except Exception as exc:
        logger.warning(
            "agent_task_recovery_failed",
            extra={"event": "agent_task_recovery_failed", "error": str(exc)},
        )

    if not agent_worker_disabled:
        agent_task_worker.start()

    # Start recovery daemon for stale job detection, DLQ migration,
    # webhook delivery, and idempotency key cleanup.
    recovery_disabled = os.getenv("NEURA_RECOVERY_DAEMON_DISABLED", "false").lower() == "true"
    if not recovery_disabled:
        try:
            from backend.app.services.legacy_services import reschedule_job
            start_recovery_daemon(reschedule_callback=reschedule_job)
            logger.info("recovery_daemon_started", extra={"event": "recovery_daemon_started"})
        except Exception as exc:
            logger.warning("recovery_daemon_start_failed", extra={"event": "recovery_daemon_start_failed", "error": str(exc)})

    # Start hydration daemon — pre-builds widget data cache on state changes
    try:
        from backend.app.services.hydration_daemon import hydration_daemon
        await hydration_daemon.start()
    except Exception as exc:
        logger.warning("hydration_daemon_start_failed", extra={"event": "hydration_daemon_start_failed", "error": str(exc)})

    # Start widget data daemon — pre-computes column stats, temporal, batches, problems
    try:
        from backend.app.services.widget_data_daemon import widget_data_daemon
        await widget_data_daemon.start()
    except Exception as exc:
        logger.warning("widget_data_daemon_start_failed", extra={"event": "widget_data_daemon_start_failed", "error": str(exc)})

    yield

    # Shutdown: stop each component with individual error handling so that
    # a failure in one does not prevent cleanup of the others.
    try:
        from backend.app.services.widget_data_daemon import widget_data_daemon as _wdd
        await _wdd.stop()
    except Exception as exc:
        logger.warning("widget_data_daemon_stop_failed", extra={"error": str(exc)})

    try:
        from backend.app.services.hydration_daemon import hydration_daemon as _hd
        await _hd.stop()
    except Exception as exc:
        logger.warning("hydration_daemon_stop_failed", extra={"error": str(exc)})

    try:
        stop_recovery_daemon(timeout_seconds=5)
    except Exception as exc:
        logger.warning("recovery_daemon_stop_failed", extra={"error": str(exc)})

    if agent_task_worker.is_running:
        try:
            agent_task_worker.stop()
        except Exception as exc:
            logger.warning("agent_worker_stop_failed", extra={"error": str(exc)})

    try:
        from backend.app.services.agents import _AGENT_EXECUTOR
        _AGENT_EXECUTOR.shutdown(wait=False, cancel_futures=True)
    except Exception as exc:
        logger.warning("agent_executor_shutdown_failed", extra={"error": str(exc)})

    if SCHEDULER and not SCHEDULER_DISABLED:
        try:
            await SCHEDULER.stop()
        except Exception as exc:
            logger.warning("scheduler_stop_failed", extra={"error": str(exc)})

    try:
        await dispose_engine()
    except Exception as exc:
        logger.warning("db_engine_dispose_failed", extra={"error": str(exc)})


app = FastAPI(
    title=SETTINGS.api_title,
    version=SETTINGS.api_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)
add_middlewares(app, SETTINGS)
add_exception_handlers(app)


# ---------- Static upload root ----------
APP_DIR = Path(__file__).parent.resolve()
UPLOAD_ROOT = SETTINGS.uploads_root
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
EXCEL_UPLOAD_ROOT = SETTINGS.excel_uploads_root
EXCEL_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
UPLOAD_ROOT_BASE = UPLOAD_ROOT.resolve()
EXCEL_UPLOAD_ROOT_BASE = EXCEL_UPLOAD_ROOT.resolve()
_UPLOAD_KIND_BASES: dict[str, tuple[Path, str]] = {
    "pdf": (UPLOAD_ROOT_BASE, "/uploads"),
    "excel": (EXCEL_UPLOAD_ROOT_BASE, "/excel-uploads"),
}
APP_VERSION = SETTINGS.version
APP_COMMIT = SETTINGS.commit


app.mount("/uploads", UploadsStaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")
app.mount("/excel-uploads", UploadsStaticFiles(directory=str(EXCEL_UPLOAD_ROOT)), name="excel-uploads")

# Register all API routes from consolidated router
register_routes(app)

def _scheduler_runner(payload: dict, kind: str, *, job_tracker: JobRunTracker | None = None) -> dict:
    return report_scheduler_runner(payload, kind, job_tracker=job_tracker)


# ---------------------------------------------------------------------------
# Compatibility exports (tests + legacy backend/legacy override hooks)
# ---------------------------------------------------------------------------
from fastapi import HTTPException

from backend.app.repositories import resolve_db_path as resolve_db_path
from backend.app.repositories import verify_sqlite as verify_sqlite
from backend.app.services.contract_builder import build_or_load_contract_v2 as build_or_load_contract_v2
from backend.app.services.workflow_jobs_excel import (
    build_generator_assets_from_payload as build_generator_assets_from_payload,
)
from backend.app.services.mapping_service import run_llm_call_3 as run_llm_call_3
from backend.app.services.mapping_service import get_parent_child_info as get_parent_child_info
from backend.app.services.infra_services import rasterize_html_to_png as rasterize_html_to_png
from backend.app.services.infra_services import save_png as save_png
from backend.app.services.reports import html_file_to_docx as html_file_to_docx
from backend.app.services.reports import html_file_to_xlsx as html_file_to_xlsx
from backend.app.repositories import state_store as state_store
from backend.app.services.templates import pdf_page_count as pdf_page_count
from backend.app.services.templates import pdf_to_pngs as pdf_to_pngs
from backend.app.services.templates import render_html_to_png as render_html_to_png
from backend.app.services.templates import render_panel_preview as render_panel_preview
from backend.app.services.templates import request_fix_html as request_fix_html
from backend.app.services.templates import request_initial_html as request_initial_html
from backend.app.services.templates import save_html as save_html
from backend.app.services.templates import get_layout_hints as get_layout_hints
from backend.app.services.infra_services import validate_contract_schema as validate_contract_schema
from backend.app.services.infra_services import write_artifact_manifest as write_artifact_manifest
from backend.app.services.legacy_services import verify_template as _verify_template_service
from backend.app.services.legacy_services import compute_db_signature as compute_db_signature
from backend.app.services.legacy_services import _mapping_preview_pipeline as _mapping_preview_pipeline


def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _db_path_from_payload_or_default(conn_id: str | None):
    """
    Legacy override hook used by src/utils/connection_utils.py.

    Returns ConnectionRef for both SQLite and PostgreSQL connections.
    """
    from backend.app.services.legacy_services import ConnectionRef, _resolve_ref_for_conn_id

    if conn_id:
        # Try ConnectionRef first (handles both SQLite and PostgreSQL)
        ref = _resolve_ref_for_conn_id(conn_id)
        if ref is not None:
            return ref

        secrets = state_store.get_connection_secrets(conn_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=conn_id)
        record = state_store.get_connection_record(conn_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=conn_id)
        try:
            path = resolve_db_path(connection_id=conn_id, db_url=None, db_path=None)
            return ConnectionRef(db_type="sqlite", db_path=path, connection_id=conn_id)
        except Exception:
            pass

    last_used = state_store.get_last_used()
    if last_used.get("connection_id"):
        connection_id = str(last_used["connection_id"])
        ref = _resolve_ref_for_conn_id(connection_id)
        if ref is not None:
            return ref
        secrets = state_store.get_connection_secrets(connection_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=connection_id)
        record = state_store.get_connection_record(connection_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=connection_id)

    env_db = os.getenv("NR_DEFAULT_DB") or os.getenv("DB_PATH")
    if env_db:
        return Path(env_db)

    latest = state_store.get_latest_connection()
    if latest and latest.get("database_path"):
        return Path(latest["database_path"])

    raise _http_error(
        400,
        "db_missing",
        "No database configured. Connect once or set NR_DEFAULT_DB/DB_PATH env.",
    )


async def verify_template(file: UploadFile, connection_id: str | None, request, refine_iters: int = 0, page: int = 0):
    """
    Async wrapper for the sync verify pipeline to support tests calling it via `await`.
    """
    return _verify_template_service(file=file, connection_id=connection_id, request=request, refine_iters=refine_iters, page=page)
