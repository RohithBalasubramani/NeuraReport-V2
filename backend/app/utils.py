from __future__ import annotations

"""Merged app utils module."""

"""Core utilities: Result type, event bus, pipeline runner, strategies, env loader, filesystem, job status.
"""

from dataclasses import dataclass
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol
from typing import Any, Dict, Optional
from typing import Awaitable, Callable, Generic, List, Optional, Protocol, TypeVar
from typing import Callable, Dict, Generic, Optional, TypeVar
from typing import Callable, Generic, Optional, TypeVar, Union, Awaitable
from typing import Iterator
import contextlib
import json
import logging
import os
import tempfile
import time

# ────────────────────────────────────────────────────────────
# Originally: result.py
# ────────────────────────────────────────────────────────────

T = TypeVar("T")
E = TypeVar("E")
U = TypeVar("U")

def _maybe_await(value: Union[Awaitable[T], T]) -> Awaitable[T]:
    if hasattr(value, "__await__"):
        return value  # type: ignore[return-value]

    async def _wrap() -> T:
        return value  # type: ignore[return-value]

    return _wrap()

@dataclass(frozen=True)
class Result(Generic[T, E]):
    value: Optional[T] = None
    error: Optional[E] = None

    @property
    def is_ok(self) -> bool:
        return self.error is None

    @property
    def is_err(self) -> bool:
        return self.error is not None

    def unwrap(self) -> T:
        if self.error is not None:
            raise RuntimeError(f"Tried to unwrap Err result: {self.error}")
        return self.value  # type: ignore[return-value]

    def unwrap_err(self) -> E:
        if self.error is None:
            raise RuntimeError("Tried to unwrap_err on Ok result")
        return self.error

    def map(self, fn: Callable[[T], U]) -> "Result[U, E]":
        if self.is_err:
            return Result(error=self.error)
        return ok(fn(self.value))  # type: ignore[arg-type]

    def bind(self, fn: Callable[[T], "Result[U, E]"]) -> "Result[U, E]":
        if self.is_err:
            return Result(error=self.error)
        return fn(self.value)  # type: ignore[arg-type]

    async def bind_async(self, fn: Callable[[T], Awaitable["Result[U, E]"]]) -> "Result[U, E]":
        if self.is_err:
            return Result(error=self.error)
        return await fn(self.value)  # type: ignore[arg-type]

    def map_err(self, fn: Callable[[E], U]) -> "Result[T, U]":
        if self.is_ok:
            return Result(value=self.value)
        return err(fn(self.error))  # type: ignore[arg-type]

    def unwrap_or(self, default: T) -> T:
        return self.value if self.error is None else default

    def tap(self, fn: Callable[[T], None]) -> "Result[T, E]":
        if self.is_ok:
            fn(self.value)  # type: ignore[arg-type]
        return self

    async def tap_async(self, fn: Callable[[T], Awaitable[None]]) -> "Result[T, E]":
        if self.is_ok:
            await _maybe_await(fn(self.value))  # type: ignore[arg-type]
        return self

def ok(value: T) -> Result[T, E]:
    return Result(value=value, error=None)

def err(error: E) -> Result[T, E]:
    return Result(value=None, error=error)

# ────────────────────────────────────────────────────────────
# Originally: event_bus.py
# ────────────────────────────────────────────────────────────

@dataclass
class Event:
    name: str
    payload: Dict[str, Any] = field(default_factory=dict)
    correlation_id: Optional[str] = None
    timestamp: float = field(default_factory=lambda: time.time())

class EventHandler(Protocol):
    def __call__(self, event: Event) -> Awaitable[None] | None: ...

class EventMiddleware(Protocol):
    def __call__(self, event: Event, call_next: Callable[[Event], Awaitable[None]]) -> Awaitable[None]: ...

class EventBus:
    def __init__(self, *, middlewares: Optional[List[EventMiddleware]] = None) -> None:
        self._handlers: Dict[str, List[EventHandler]] = {}
        self._middlewares = list(middlewares or [])

    def subscribe(self, event_name: str, handler: EventHandler) -> None:
        self._handlers.setdefault(event_name, []).append(handler)

    async def publish(self, event: Event) -> None:
        async def _dispatch(ev: Event) -> None:
            handlers = list(self._handlers.get(ev.name, []))
            for handler in handlers:
                await _maybe_await(handler(ev))

        async def _run_middleware(index: int, ev: Event) -> None:
            if index >= len(self._middlewares):
                await _dispatch(ev)
                return
            middleware = self._middlewares[index]
            await middleware(ev, lambda e=ev: _run_middleware(index + 1, e))

        await _run_middleware(0, event)

class NullEventBus(EventBus):
    async def publish(self, event: Event) -> None:  # type: ignore[override]
        return None

    def subscribe(self, event_name: str, handler: EventHandler) -> None:  # type: ignore[override]
        return None

def logging_middleware(logger: logging.Logger) -> EventMiddleware:
    async def _middleware(event: Event, call_next: Callable[[Event], Awaitable[None]]) -> None:
        logger.info(
            "event_bus_publish",
            extra={
                "event": event.name,
                "payload_keys": list(event.payload.keys()),
                "correlation_id": event.correlation_id,
                "ts": event.timestamp,
            },
        )
        await call_next(event)

    return _middleware

def metrics_middleware(logger: logging.Logger) -> EventMiddleware:
    async def _middleware(event: Event, call_next: Callable[[Event], Awaitable[None]]) -> None:
        started = time.time()
        try:
            await call_next(event)
        finally:
            elapsed_ms = int((time.time() - started) * 1000)
            logger.info(
                "event_bus_metric",
                extra={
                    "event": event.name,
                    "elapsed_ms": elapsed_ms,
                    "correlation_id": event.correlation_id,
                },
            )

    return _middleware

# ────────────────────────────────────────────────────────────
# Originally: pipeline.py
# ────────────────────────────────────────────────────────────

Ctx = TypeVar("Ctx")
ErrType = TypeVar("ErrType")

class PipelineStepFn(Protocol[Ctx, ErrType]):
    def __call__(self, ctx: Ctx) -> Result[Ctx, ErrType] | Awaitable[Result[Ctx, ErrType]]: ...

GuardFn = Callable[[Ctx], bool]

@dataclass
class PipelineStep(Generic[Ctx, ErrType]):
    name: str
    fn: PipelineStepFn[Ctx, ErrType]
    guard: GuardFn[Ctx] = lambda ctx: True

class PipelineRunner(Generic[Ctx, ErrType]):
    def __init__(
        self,
        steps: List[PipelineStep[Ctx, ErrType]],
        *,
        bus: Optional[EventBus] = None,
        logger: Optional[logging.Logger] = None,
        correlation_id: Optional[str] = None,
    ) -> None:
        self.steps = steps
        self.bus = bus or NullEventBus()
        self.logger = logger or logging.getLogger("neura.pipeline")
        self.correlation_id = correlation_id

    async def run(self, ctx: Ctx) -> Result[Ctx, ErrType]:
        current = ok(ctx)
        for step in self.steps:
            if not step.guard(ctx):
                continue
            await self._emit(f"pipeline.{step.name}.start", {"ctx_type": type(ctx).__name__})
            try:
                current = await _maybe_await(step.fn(current.unwrap()))
            except Exception as exc:  # guard against unexpected failures
                self.logger.exception(
                    "pipeline_step_failed",
                    extra={
                        "event": "pipeline_step_failed",
                        "step": step.name,
                        "correlation_id": self.correlation_id,
                    },
                )
                return err(exc)  # type: ignore[arg-type]

            if current.is_err:
                await self._emit(
                    f"pipeline.{step.name}.error",
                    {
                        "ctx_type": type(ctx).__name__,
                        "error": str(current.unwrap_err()),
                    },
                )
                return current

            ctx = current.unwrap()
            await self._emit(f"pipeline.{step.name}.ok", {"ctx_type": type(ctx).__name__})

        await self._emit("pipeline.complete", {"ctx_type": type(ctx).__name__})
        return current

    async def _emit(self, name: str, payload: dict) -> None:
        await self.bus.publish(Event(name=name, payload=payload, correlation_id=self.correlation_id))

# ────────────────────────────────────────────────────────────
# Originally: strategies.py
# ────────────────────────────────────────────────────────────

S = TypeVar("S")

class StrategyRegistry(Generic[S]):
    def __init__(self, *, default_factory: Optional[Callable[[], S]] = None) -> None:
        self._registry: Dict[str, S] = {}
        self._default_factory = default_factory

    def register(self, name: str, strategy: S) -> None:
        self._registry[name] = strategy

    def get(self, name: str) -> Optional[S]:
        return self._registry.get(name)

    def resolve(self, name: str) -> S:
        if name in self._registry:
            return self._registry[name]
        if self._default_factory:
            return self._default_factory()
        raise KeyError(f"No strategy registered for '{name}'")

# ────────────────────────────────────────────────────────────
# Originally: env_loader.py
# ────────────────────────────────────────────────────────────

logger = logging.getLogger("neura.env")

def _iter_candidate_paths() -> Iterator[Path]:
    """
    Yield possible .env files from highest to lowest priority.

    Precedence:
    1. NEURA_ENV_FILE (absolute or relative)
    2. Repository root .env (sibling of backend/)
    3. backend/.env (created by scripts/setup.ps1)
    """
    env_override = os.getenv("NEURA_ENV_FILE")
    if env_override:
        yield Path(env_override).expanduser()

    backend_dir = Path(__file__).resolve().parents[1]
    repo_root = backend_dir.parent
    yield repo_root / ".env"
    yield backend_dir / ".env"

def _strip_quotes(value: str) -> str:
    if not value:
        return value
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value

def load_env_file() -> Path | None:
    """
    Load KEY=VALUE pairs from the first existing candidate .env file.
    Existing environment variables are never overridden.
    """
    for candidate in _iter_candidate_paths():
        try:
            resolved = candidate if candidate.is_absolute() else (Path.cwd() / candidate)
            if not resolved.exists():
                continue
            _apply_env_file(resolved)
            logger.info("loaded_env_file", extra={"event": "loaded_env_file", "path": str(resolved)})
            return resolved
        except PermissionError:
            logger.warning(
                "env_file_permission_denied",
                extra={"event": "env_file_permission_denied", "path": str(candidate)},
            )
        except UnicodeDecodeError as e:
            logger.warning(
                "env_file_encoding_error",
                extra={"event": "env_file_encoding_error", "path": str(candidate), "detail": str(e)},
            )
        except (ValueError, SyntaxError) as e:
            logger.warning(
                "env_file_parse_error",
                extra={"event": "env_file_parse_error", "path": str(candidate), "detail": str(e)},
            )
        except Exception:  # pragma: no cover - defensive fallback
            logger.exception(
                "env_file_load_failed",
                extra={"event": "env_file_load_failed", "path": str(candidate)},
            )
    return None

def _apply_env_file(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    for line_num, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        try:
            key, value = line.split("=", 1)
            key = key.strip()
            value = _strip_quotes(value.strip())
            if not key or key.startswith("#"):
                continue
            os.environ.setdefault(key, value)
        except Exception as e:
            logger.warning(
                "env_file_bad_line",
                extra={"event": "env_file_bad_line", "path": str(path), "line": line_num, "detail": str(e)},
            )

# ────────────────────────────────────────────────────────────
# Originally: fs.py
# ────────────────────────────────────────────────────────────

logger = logging.getLogger("neura.fs")

def _maybe_fail(step: str | None) -> None:
    fail_after = os.getenv("NEURA_FAIL_AFTER_STEP")
    if step and fail_after and fail_after.strip().lower() == step.strip().lower():
        raise RuntimeError(f"Simulated failure after step '{step}'")

def write_text_atomic(path: Path, data: str | bytes, *, encoding: str = "utf-8", step: str | None = None) -> None:
    """
    Persist text to `path` atomically:
      1. Write to a temp file within the same directory.
      2. Flush + fsync to guarantee contents on disk.
      3. Replace the target path.
    """
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    binary = isinstance(data, (bytes, bytearray))
    try:
        if binary:
            with os.fdopen(fd, "wb") as tmp_file:
                tmp_file.write(data)  # type: ignore[arg-type]
                tmp_file.flush()
                with contextlib.suppress(OSError):
                    os.fsync(tmp_file.fileno())
        else:
            with os.fdopen(fd, "w", encoding=encoding, newline="") as tmp_file:
                tmp_file.write(data)  # type: ignore[arg-type]
                tmp_file.flush()
                with contextlib.suppress(OSError):
                    os.fsync(tmp_file.fileno())
        _maybe_fail(step)
        tmp_path.replace(path)
    except Exception:
        logger.exception("atomic_write_failed", extra={"path": str(path)})
        raise
    finally:
        with contextlib.suppress(FileNotFoundError):
            tmp_path.unlink()

def write_json_atomic(
    path: Path,
    payload: Any,
    *,
    encoding: str = "utf-8",
    indent: int | None = 2,
    ensure_ascii: bool = False,
    sort_keys: bool = False,
    step: str | None = None,
) -> None:
    """
    Serialize payload to JSON and write atomically.
    Mirrors json.dumps kwargs with sensible defaults for readability.
    """
    data = json.dumps(
        payload,
        indent=indent,
        ensure_ascii=ensure_ascii,
        sort_keys=sort_keys,
        default=str,
    )
    write_text_atomic(path, data, encoding=encoding, step=step)

# ────────────────────────────────────────────────────────────
# Originally: job_status.py
# ────────────────────────────────────────────────────────────

# Canonical status values - use these constants for comparisons
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_CANCELLING = "cancelling"
STATUS_PENDING_RETRY = "pending_retry"  # Job failed but will be retried

# All valid terminal statuses (job is done, no more updates expected)
TERMINAL_STATUSES = frozenset({STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED})

# All valid active statuses (job may still update)
ACTIVE_STATUSES = frozenset({STATUS_QUEUED, STATUS_RUNNING, STATUS_CANCELLING, STATUS_PENDING_RETRY})

# Statuses that indicate the job will be retried
RETRY_STATUSES = frozenset({STATUS_PENDING_RETRY})

def normalize_job_status(status: Optional[str]) -> str:
    """Normalize job status to consistent canonical values."""
    value = (status or "").strip().lower()

    # Map to canonical 'succeeded'
    if value in {"succeeded", "success", "done", "completed"}:
        return STATUS_SUCCEEDED

    # Map to canonical 'queued'
    if value in {"queued", "pending", "waiting"}:
        return STATUS_QUEUED

    # Map to canonical 'running'
    if value in {"running", "in_progress", "started", "processing"}:
        return STATUS_RUNNING

    # Map to canonical 'failed'
    if value in {"failed", "error", "errored"}:
        return STATUS_FAILED

    # Map to canonical 'cancelled'
    if value in {"cancelled", "canceled"}:
        return STATUS_CANCELLED

    # Preserve 'cancelling' as-is
    if value == "cancelling":
        return STATUS_CANCELLING

    # Map to canonical 'pending_retry'
    if value in {"pending_retry", "retry_pending", "retry_scheduled", "awaiting_retry"}:
        return STATUS_PENDING_RETRY

    # Default to queued for unknown/empty statuses
    return STATUS_QUEUED

def normalize_job(job: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Normalize a job record for consistent API responses."""
    if not job:
        return job

    normalized = dict(job)

    # Normalize status field
    if "status" in normalized:
        normalized["status"] = normalize_job_status(normalized["status"])
    elif "state" in normalized:
        # Some older records use 'state' instead of 'status'
        normalized["status"] = normalize_job_status(normalized["state"])

    return normalized

def is_terminal_status(status: Optional[str]) -> bool:
    """Check if a status indicates the job is complete (no more updates)."""
    return normalize_job_status(status) in TERMINAL_STATUSES

def is_active_status(status: Optional[str]) -> bool:
    """Check if a status indicates the job may still be updated."""
    return normalize_job_status(status) in ACTIVE_STATUSES

def is_pending_retry(status: Optional[str]) -> bool:
    """Check if a status indicates the job is waiting for retry."""
    return normalize_job_status(status) in RETRY_STATUSES

def can_retry(job: Optional[Dict[str, Any]]) -> bool:
    """Check if a job can be retried."""
    if not job:
        return False

    status = normalize_job_status(job.get("status"))
    if status != STATUS_FAILED:
        return False

    # Check retry count vs max retries
    retry_count = job.get("retryCount") or job.get("retry_count") or 0
    max_retries = job.get("maxRetries") or job.get("max_retries") or 3

    return retry_count < max_retries

"""Security utilities: errors, SQL safety, SSRF guard, validation, email utils.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, List, Optional, TypeVar, Union
from typing import Iterable, Optional
from typing import Optional
from urllib.parse import urlparse
import ipaddress
import logging
import re
import socket
import unicodedata

# ────────────────────────────────────────────────────────────
# Originally: errors.py
# ────────────────────────────────────────────────────────────

class AppError(Exception):
    def __init__(self, *, code: str, message: str, status_code: int = 400, detail: str | None = None) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail
        super().__init__(message)

@dataclass
class DomainError(AppError):
    """
    Base domain error to keep HTTP concerns at the edge while providing typed failures.
    """

    code: str
    message: str
    status_code: int = 400
    detail: Optional[str] = None

    def __post_init__(self) -> None:
        super().__init__(code=self.code, message=self.message, status_code=self.status_code, detail=self.detail)

# ────────────────────────────────────────────────────────────
# Originally: sql_safety.py
# ────────────────────────────────────────────────────────────

WRITE_KEYWORDS = (
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "REPLACE",
    "MERGE",
    "GRANT",
    "REVOKE",
    "COMMENT",
    "RENAME",
    "VACUUM",
    "ATTACH",
    "DETACH",
)

WRITE_PATTERN = re.compile(r"\b(" + "|".join(WRITE_KEYWORDS) + r")\b", re.IGNORECASE)

def _strip_literals_and_comments(sql: str) -> str:
    """Remove string literals and comments for safer keyword scanning."""
    if not sql:
        return ""

    out = []
    in_single = False
    in_double = False
    in_line_comment = False
    in_block_comment = False
    i = 0

    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                out.append(" ")
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                out.append(" ")
                continue
            i += 1
            continue

        if not in_single and not in_double:
            if ch == "-" and nxt == "-":
                in_line_comment = True
                i += 2
                continue
            if ch == "/" and nxt == "*":
                in_block_comment = True
                i += 2
                continue

        if not in_double and ch == "'":
            if in_single and nxt == "'":
                # Escaped single quote ('') inside single-quoted string — skip both
                out.append(" ")
                out.append(" ")
                i += 2
                continue
            in_single = not in_single
            out.append(" ")
            i += 1
            continue

        if not in_single and ch == '"':
            if in_double and nxt == '"':
                # Escaped double quote ("") inside double-quoted string — skip both
                out.append(" ")
                out.append(" ")
                i += 2
                continue
            in_double = not in_double
            out.append(" ")
            i += 1
            continue

        if in_single or in_double:
            out.append(" ")
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)

def get_write_operation(sql: str | None) -> str | None:
    """Return the first detected write operation keyword, if any."""
    cleaned = _strip_literals_and_comments(sql or "")
    match = WRITE_PATTERN.search(cleaned)
    return match.group(1).upper() if match else None

def is_select_or_with(sql: str | None) -> bool:
    cleaned = _strip_literals_and_comments(sql or "")
    leading = cleaned.lstrip().upper()
    if not (leading.startswith("SELECT") or leading.startswith("WITH")):
        return False
    # Reject if the query body contains write keywords (e.g. after a semicolon)
    if get_write_operation(sql) is not None:
        return False
    return True

# ────────────────────────────────────────────────────────────
# Originally: ssrf_guard.py
# ────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

# IP networks that must never be reached by outbound requests
_BLOCKED_NETWORKS = [
    # IPv4
    ipaddress.ip_network("0.0.0.0/8"),        # "This" network
    ipaddress.ip_network("10.0.0.0/8"),        # RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),     # Shared address space
    ipaddress.ip_network("127.0.0.0/8"),       # Loopback
    ipaddress.ip_network("169.254.0.0/16"),    # Link-local (AWS metadata)
    ipaddress.ip_network("172.16.0.0/12"),     # RFC 1918
    ipaddress.ip_network("192.0.0.0/24"),      # IETF protocol assignments
    ipaddress.ip_network("192.0.2.0/24"),      # TEST-NET-1
    ipaddress.ip_network("192.88.99.0/24"),    # 6to4 relay
    ipaddress.ip_network("192.168.0.0/16"),    # RFC 1918
    ipaddress.ip_network("198.18.0.0/15"),     # Benchmarking
    ipaddress.ip_network("198.51.100.0/24"),   # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),    # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),       # Multicast
    ipaddress.ip_network("240.0.0.0/4"),       # Reserved
    ipaddress.ip_network("255.255.255.255/32"),  # Broadcast
    # IPv6
    ipaddress.ip_network("::1/128"),           # Loopback
    ipaddress.ip_network("fc00::/7"),          # Unique local
    ipaddress.ip_network("fe80::/10"),         # Link-local
    ipaddress.ip_network("::ffff:0:0/96"),     # IPv4-mapped
]

_ALLOWED_SCHEMES = {"http", "https"}

class SSRFError(ValueError):
    """Raised when a URL fails SSRF validation."""

def _is_blocked_ip(ip_str: str) -> bool:
    """Check if an IP address falls within a blocked network."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # Unparseable → block
    return any(addr in net for net in _BLOCKED_NETWORKS)

def validate_url(
    url: str,
    *,
    allowed_schemes: set[str] | None = None,
    allow_private: bool = False,
) -> str:
    """Validate a URL is safe for server-side requests."""
    schemes = allowed_schemes or _ALLOWED_SCHEMES

    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise SSRFError(f"Invalid URL: {exc}") from exc

    if not parsed.scheme or parsed.scheme.lower() not in schemes:
        raise SSRFError(f"Scheme '{parsed.scheme}' not allowed (permitted: {', '.join(sorted(schemes))})")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFError("URL has no hostname")

    if allow_private:
        return url

    # Resolve hostname to IPs and check each one
    try:
        addrinfos = socket.getaddrinfo(hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError(f"DNS resolution failed for '{hostname}': {exc}") from exc

    if not addrinfos:
        raise SSRFError(f"No DNS results for '{hostname}'")

    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_blocked_ip(ip_str):
            raise SSRFError(
                f"URL resolves to blocked IP {ip_str} (hostname: {hostname})"
            )

    return url

def validate_hostname(
    hostname: str,
    port: int = 22,
    *,
    allow_private: bool = False,
) -> str:
    """Validate a hostname + port for non-HTTP protocols (e.g. SFTP)."""
    if not hostname or not hostname.strip():
        raise SSRFError("Empty hostname")

    if allow_private:
        return hostname

    # Check if hostname is already a literal IP
    try:
        if _is_blocked_ip(hostname):
            raise SSRFError(f"Blocked IP address: {hostname}")
        return hostname
    except ValueError:
        pass  # Not a literal IP — resolve via DNS

    try:
        addrinfos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SSRFError(f"DNS resolution failed for '{hostname}': {exc}") from exc

    if not addrinfos:
        raise SSRFError(f"No DNS results for '{hostname}'")

    for _family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if _is_blocked_ip(ip_str):
            raise SSRFError(
                f"Hostname resolves to blocked IP {ip_str} (hostname: {hostname})"
            )

    return hostname

# ────────────────────────────────────────────────────────────
# Originally: validation.py
# ────────────────────────────────────────────────────────────

T = TypeVar("T")

@dataclass
class ValidationResult:
    """Result of a validation operation."""
    valid: bool
    value: Any = None
    error: Optional[str] = None
    field: Optional[str] = None

    @staticmethod
    def success(value: Any = None) -> "ValidationResult":
        return ValidationResult(valid=True, value=value)

    @staticmethod
    def failure(error: str, field: Optional[str] = None) -> "ValidationResult":
        return ValidationResult(valid=False, error=error, field=field)

# Patterns for validation
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$")
SAFE_NAME_PATTERN = re.compile(r"^[\w\s\-\.()]{1,100}$", re.UNICODE)
SAFE_FILENAME_PATTERN = re.compile(r"^[\w\-\.()]+$", re.UNICODE)
EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$"
)
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE
)
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Dangerous path patterns to block
DANGEROUS_PATH_PATTERNS = [
    r"\.\.",  # Parent directory traversal
    r"^/",  # Absolute paths (Unix)
    r"^[A-Za-z]:",  # Absolute paths (Windows)
    r"~",  # Home directory expansion
    r"\$",  # Environment variable expansion
    r"%",  # Windows environment variables
    r"\x00",  # Null byte injection
]

# Common SQL injection patterns
SQL_INJECTION_PATTERNS = [
    r";\s*--",
    r";\s*drop\s",
    r";\s*delete\s",
    r";\s*update\s",
    r";\s*insert\s",
    r"union\s+select",
    r"or\s+1\s*=\s*1",
    r"'\s*or\s*'",
]

# Common XSS patterns
XSS_PATTERNS = [
    r"<script",
    r"javascript:",
    r"on\w+\s*=",
    r"<iframe",
    r"<object",
    r"<embed",
]

def is_safe_id(value: str) -> bool:
    """Check if a value is safe to use as an ID (alphanumeric with dashes/underscores)."""
    if not value or not isinstance(value, str):
        return False
    return bool(SAFE_ID_PATTERN.match(value))

def is_safe_name(value: str) -> bool:
    """Check if a value is safe to use as a display name."""
    if not value or not isinstance(value, str):
        return False
    return bool(SAFE_NAME_PATTERN.match(value)) and len(value) <= 100

def is_safe_filename(value: str) -> bool:
    """Check if a value is safe to use as a filename."""
    if not value or not isinstance(value, str):
        return False
    if not SAFE_FILENAME_PATTERN.match(value):
        return False
    # Block dangerous patterns
    for pattern in DANGEROUS_PATH_PATTERNS:
        if re.search(pattern, value):
            return False
    return True

def sanitize_id(value: str) -> str:
    """Sanitize a string to be safe for use as an ID."""
    if not value:
        return ""
    # Remove non-alphanumeric characters except dashes and underscores
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "", value)
    # Ensure it starts with alphanumeric
    sanitized = re.sub(r"^[^a-zA-Z0-9]+", "", sanitized)
    return sanitized[:63]  # Max 63 chars

def sanitize_filename(value: str) -> str:
    """Sanitize a string to be safe for use as a filename."""
    if not value:
        return ""
    # Remove path separators and dangerous characters
    sanitized = re.sub(r"[/\\:*?\"<>|]", "", value)
    # Remove parent directory traversal
    sanitized = sanitized.replace("..", "")
    # Remove leading/trailing dots and spaces
    sanitized = sanitized.strip(". ")
    # Ensure non-empty
    if not sanitized:
        return "unnamed"
    return sanitized[:255]  # Max 255 chars for most filesystems

def validate_path_safety(path: str | Path) -> tuple[bool, Optional[str]]:
    """
    Validate that a path is safe (no traversal attacks, etc).
    Returns (is_safe, error_message).
    """
    path_str = str(path)

    # Check for dangerous patterns
    for pattern in DANGEROUS_PATH_PATTERNS:
        if re.search(pattern, path_str):
            return False, f"Path contains disallowed pattern: {pattern}"

    # Check for null bytes
    if "\x00" in path_str:
        return False, "Path contains null byte"

    return True, None

def validate_file_extension(filename: str, allowed_extensions: list[str]) -> tuple[bool, Optional[str]]:
    """
    Validate that a file has an allowed extension.
    Returns (is_valid, error_message).
    """
    if not filename:
        return False, "Filename is required"

    ext = Path(filename).suffix.lower()
    if not ext:
        return False, "File must have an extension"

    # Normalize extensions (add leading dot if missing)
    allowed = [e.lower() if e.startswith(".") else f".{e.lower()}" for e in allowed_extensions]

    if ext not in allowed:
        return False, f"Invalid file type '{ext}'. Allowed: {', '.join(allowed)}"

    return True, None

def sanitize_sql_identifier(value: str) -> str:
    """
    Sanitize a SQL identifier (table/column name).
    Note: This is for display/logging only, not for building SQL queries.
    Use parameterized queries for actual SQL.
    """
    if not value:
        return ""
    # Remove all non-alphanumeric characters except underscore
    sanitized = re.sub(r"[^a-zA-Z0-9_]", "", value)
    return sanitized[:128]

def validate_json_string_length(value: str, max_length: int = 10000) -> tuple[bool, Optional[str]]:
    """Validate that a JSON string field is not too long."""
    if not value:
        return True, None
    if len(value) > max_length:
        return False, f"Value too long (max {max_length} characters)"
    return True, None

def is_valid_email(value: str) -> bool:
    """Check if a string is a valid email address."""
    if not value or not isinstance(value, str):
        return False
    return bool(EMAIL_PATTERN.match(value.strip()))

def is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID."""
    if not value or not isinstance(value, str):
        return False
    return bool(UUID_PATTERN.match(value.strip()))

def is_valid_slug(value: str) -> bool:
    """Check if a string is a valid URL slug."""
    if not value or not isinstance(value, str):
        return False
    return bool(SLUG_PATTERN.match(value.strip()))

def is_valid_url(value: str, require_https: bool = False) -> bool:
    """Check if a string is a valid URL."""
    if not value or not isinstance(value, str):
        return False

    try:
        parsed = urlparse(value.strip())
        if not parsed.scheme or not parsed.netloc:
            return False
        if require_https and parsed.scheme != "https":
            return False
        if parsed.scheme not in ("http", "https"):
            return False
        return True
    except Exception:
        return False

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]

def is_safe_external_url(url: str) -> tuple[bool, str | None]:
    """Validate that a URL is safe for server-side requests (anti-SSRF).

    Blocks:
    - Non-HTTP(S) schemes (file://, ftp://, etc.)
    - localhost, 127.0.0.0/8, ::1
    - Private networks (10.x, 172.16-31.x, 192.168.x)
    - Link-local / cloud metadata (169.254.x.x)
    - 0.0.0.0

    Returns (is_safe, error_message).
    """
    if not url or not isinstance(url, str):
        return False, "URL is required"

    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False, "Invalid URL"

    # Scheme check
    if parsed.scheme not in ("http", "https"):
        return False, f"Scheme '{parsed.scheme}' is not allowed; use http or https"

    hostname = parsed.hostname
    if not hostname:
        return False, "URL has no hostname"

    # Obvious hostname check
    if hostname in ("localhost", "0.0.0.0"):
        return False, f"Hostname '{hostname}' is not allowed"

    # Resolve hostname to IP and check against private ranges
    try:
        addr_infos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return False, f"Could not resolve hostname '{hostname}'"

    for family, _type, _proto, _canon, sockaddr in addr_infos:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue

        for network in _PRIVATE_NETWORKS:
            if ip in network:
                return False, f"URL resolves to private/reserved address ({ip_str})"

        # Also block unspecified address (0.0.0.0 / ::)
        if ip == ipaddress.ip_address("0.0.0.0") or ip == ipaddress.ip_address("::"):
            return False, "URL resolves to unspecified address"

    return True, None

def contains_sql_injection(value: str) -> bool:
    """Check if a string contains potential SQL injection patterns."""
    if not value:
        return False

    lower_value = value.lower()
    for pattern in SQL_INJECTION_PATTERNS:
        if re.search(pattern, lower_value, re.IGNORECASE):
            return True
    return False

_BLOCKED_SQL_KEYWORDS = re.compile(
    r"\b(DROP|ALTER|TRUNCATE|CREATE|INSERT|UPDATE|DELETE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|REPLACE|CALL)\b",
    re.IGNORECASE,
)

_SQL_LINE_COMMENT = re.compile(r"--[^\n]*")
_SQL_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)

def is_read_only_sql(query: str) -> tuple[bool, str | None]:
    """Check whether a SQL query is read-only (SELECT / WITH only).

    Returns (is_safe, error_message).
    Strips comments before analysis.  Blocks DDL, DML, and admin
    statements: DROP, ALTER, TRUNCATE, CREATE, INSERT, UPDATE, DELETE,
    GRANT, REVOKE, EXEC, EXECUTE, MERGE, REPLACE, CALL.
    """
    if not query or not query.strip():
        return False, "Query is empty"

    # Strip comments
    cleaned = _SQL_LINE_COMMENT.sub(" ", query)
    cleaned = _SQL_BLOCK_COMMENT.sub(" ", cleaned)
    cleaned = cleaned.strip()

    if not cleaned:
        return False, "Query is empty after removing comments"

    # Check first keyword
    first_word = cleaned.split()[0].upper()
    if first_word not in ("SELECT", "WITH"):
        return False, f"Only SELECT queries are allowed (got {first_word})"

    # Scan for blocked keywords anywhere (e.g. sub-statements)
    match = _BLOCKED_SQL_KEYWORDS.search(cleaned)
    if match:
        return False, f"Query contains blocked keyword: {match.group(0).upper()}"

    return True, None

def contains_xss(value: str) -> bool:
    """Check if a string contains potential XSS patterns."""
    if not value:
        return False

    lower_value = value.lower()
    for pattern in XSS_PATTERNS:
        if re.search(pattern, lower_value, re.IGNORECASE):
            return True
    return False

def sanitize_html(value: str) -> str:
    """Remove potentially dangerous HTML content."""
    if not value:
        return ""

    # Remove script tags and content
    result = re.sub(r"<script[^>]*>.*?</script>", "", value, flags=re.IGNORECASE | re.DOTALL)

    # Remove event handlers
    result = re.sub(r"\s*on\w+\s*=\s*[\"'][^\"']*[\"']", "", result, flags=re.IGNORECASE)

    # Remove javascript: URLs
    result = re.sub(r"javascript:", "", result, flags=re.IGNORECASE)

    return result

def normalize_string(value: str) -> str:
    """Normalize a string by removing control characters and normalizing unicode."""
    if not value:
        return ""

    # Normalize unicode
    normalized = unicodedata.normalize("NFC", value)

    # Remove control characters except newline and tab
    normalized = "".join(
        char for char in normalized
        if char == "\n" or char == "\t" or not unicodedata.category(char).startswith("C")
    )

    return normalized.strip()

def validate_numeric_range(
    value: Union[int, float],
    min_value: Optional[Union[int, float]] = None,
    max_value: Optional[Union[int, float]] = None,
    field_name: str = "value",
) -> tuple[bool, Optional[str]]:
    """Validate that a numeric value is within a range."""
    if min_value is not None and value < min_value:
        return False, f"{field_name} must be at least {min_value}"
    if max_value is not None and value > max_value:
        return False, f"{field_name} must be at most {max_value}"
    return True, None

def validate_date_string(
    value: str,
    formats: Optional[List[str]] = None,
) -> tuple[bool, Optional[datetime]]:
    """
    Validate that a string is a valid date.
    Returns (is_valid, parsed_datetime or None).
    """
    if not value:
        return False, None

    formats = formats or [
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S",
    ]

    for fmt in formats:
        try:
            parsed = datetime.strptime(value.strip(), fmt)
            return True, parsed
        except ValueError:
            continue

    return False, None

def validate_required_fields(
    data: dict,
    required_fields: List[str],
) -> tuple[bool, List[str]]:
    """
    Validate that all required fields are present and non-empty.
    Returns (is_valid, list of missing fields).
    """
    missing = []
    for field in required_fields:
        value = data.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(field)

    return len(missing) == 0, missing

def validate_field_type(
    value: Any,
    expected_type: type,
    field_name: str = "value",
) -> tuple[bool, Optional[str]]:
    """Validate that a value is of the expected type."""
    if not isinstance(value, expected_type):
        return False, f"{field_name} must be of type {expected_type.__name__}"
    return True, None

def truncate_string(value: str, max_length: int, suffix: str = "...") -> str:
    """Truncate a string to max length, adding suffix if truncated."""
    if not value or len(value) <= max_length:
        return value
    return value[:max_length - len(suffix)] + suffix

def generate_safe_id(value: str, max_length: int = 63) -> str:
    """Generate a safe ID from a string."""
    if not value:
        return ""

    # Normalize and lowercase
    safe = normalize_string(value).lower()

    # Replace spaces and special chars with hyphens
    safe = re.sub(r"[^a-z0-9]+", "-", safe)

    # Remove leading/trailing hyphens
    safe = safe.strip("-")

    # Ensure starts with alphanumeric
    if safe and not safe[0].isalnum():
        safe = "x" + safe

    return safe[:max_length]

class Validator:
    """
    Chainable validator for building complex validation rules.

    Usage:
        result = Validator(value).required().min_length(3).max_length(50).validate()
        if not result.valid:
            print(result.error)
    """

    def __init__(self, value: Any, field_name: str = "value"):
        self._value = value
        self._field = field_name
        self._errors: List[str] = []
        self._stop_on_first_error = False

    def stop_on_first_error(self) -> "Validator":
        """Stop validation after first error."""
        self._stop_on_first_error = True
        return self

    def _add_error(self, error: str) -> None:
        self._errors.append(error)

    def _should_continue(self) -> bool:
        return not self._stop_on_first_error or not self._errors

    def required(self, message: Optional[str] = None) -> "Validator":
        """Validate that the value is not None or empty."""
        if not self._should_continue():
            return self

        if self._value is None:
            self._add_error(message or f"{self._field} is required")
        elif isinstance(self._value, str) and not self._value.strip():
            self._add_error(message or f"{self._field} cannot be empty")

        return self

    def min_length(self, length: int, message: Optional[str] = None) -> "Validator":
        """Validate minimum length."""
        if not self._should_continue():
            return self

        if isinstance(self._value, (str, list, dict)) and len(self._value) < length:
            self._add_error(message or f"{self._field} must be at least {length} characters")

        return self

    def max_length(self, length: int, message: Optional[str] = None) -> "Validator":
        """Validate maximum length."""
        if not self._should_continue():
            return self

        if isinstance(self._value, (str, list, dict)) and len(self._value) > length:
            self._add_error(message or f"{self._field} must be at most {length} characters")

        return self

    def pattern(self, regex: str, message: Optional[str] = None) -> "Validator":
        """Validate against a regex pattern."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and not re.match(regex, self._value):
            self._add_error(message or f"{self._field} has invalid format")

        return self

    def email(self, message: Optional[str] = None) -> "Validator":
        """Validate as email address."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and not is_valid_email(self._value):
            self._add_error(message or f"{self._field} must be a valid email address")

        return self

    def url(self, require_https: bool = False, message: Optional[str] = None) -> "Validator":
        """Validate as URL."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and not is_valid_url(self._value, require_https):
            self._add_error(message or f"{self._field} must be a valid URL")

        return self

    def safe_id(self, message: Optional[str] = None) -> "Validator":
        """Validate as safe ID."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and not is_safe_id(self._value):
            self._add_error(message or f"{self._field} contains invalid characters")

        return self

    def no_sql_injection(self, message: Optional[str] = None) -> "Validator":
        """Validate against SQL injection patterns."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and contains_sql_injection(self._value):
            self._add_error(message or f"{self._field} contains potentially dangerous content")

        return self

    def no_xss(self, message: Optional[str] = None) -> "Validator":
        """Validate against XSS patterns."""
        if not self._should_continue():
            return self

        if isinstance(self._value, str) and contains_xss(self._value):
            self._add_error(message or f"{self._field} contains potentially dangerous content")

        return self

    def custom(self, validator: Callable[[Any], bool], message: str) -> "Validator":
        """Apply a custom validation function."""
        if not self._should_continue():
            return self

        if not validator(self._value):
            self._add_error(message)

        return self

    def validate(self) -> ValidationResult:
        """Execute validation and return result."""
        if self._errors:
            return ValidationResult.failure(
                error="; ".join(self._errors),
                field=self._field,
            )
        return ValidationResult.success(value=self._value)

# ────────────────────────────────────────────────────────────
# Originally: email_utils.py
# ────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)

# Control characters that MUST NOT appear in email addresses.
# Newlines (\r, \n) would enable SMTP header injection; NUL bytes cause
# truncation in C-backed mailers.
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")

# RFC 5321 §4.5.3.1 — maximum lengths
_MAX_EMAIL_TOTAL_LENGTH = 254
_MAX_LOCAL_PART_LENGTH = 64

# Absolute upper-bound — any input producing more candidates is truncated
# with a warning.  Callers may pass a lower limit via *max_recipients*.
MAX_RECIPIENTS_HARD_LIMIT = 500

def _is_valid_email_strict(addr: str) -> bool:
    """Format check *and* RFC 5321 length enforcement."""
    if len(addr) > _MAX_EMAIL_TOTAL_LENGTH:
        return False
    at_pos = addr.find("@")
    if at_pos < 0:
        return False
    if at_pos > _MAX_LOCAL_PART_LENGTH:
        return False
    return is_valid_email(addr)

def normalize_email_targets(
    raw: Optional[Iterable[str] | str],
    *,
    max_recipients: int = MAX_RECIPIENTS_HARD_LIMIT,
    validate: bool = True,
    rejected: Optional[list[str]] = None,
) -> list[str]:
    """Normalise, validate, and deduplicate email recipients.

    Parameters
    ----------
    raw:
        ``None``, a single comma/semicolon-delimited string, or an iterable
        of individual address strings.
    max_recipients:
        Upper bound on the number of addresses returned.  Silently truncates
        (with a WARNING log) when exceeded.  Capped internally at
        ``MAX_RECIPIENTS_HARD_LIMIT``.
    validate:
        When ``True`` (default), each candidate is checked with
        ``is_valid_email``; invalid entries are dropped and logged.
        Set to ``False`` only in migration / legacy-compat code paths.
    rejected:
        Optional mutable list.  If provided, every dropped candidate is
        appended here so that the caller can surface feedback.

    Returns
    -------
    list[str]
        De-duplicated list of normalised (and optionally validated) email
        addresses, with original casing preserved (first occurrence wins).
    """
    if raw is None:
        return []

    # 1. Flatten input --------------------------------------------------
    candidates: list[str]
    if isinstance(raw, str):
        candidates = [piece for piece in re.split(r"[;,]", raw) if piece is not None]
    else:
        candidates = list(raw)

    # 2. Clamp max_recipients to hard limit ----------------------------
    effective_limit = min(max(max_recipients, 1), MAX_RECIPIENTS_HARD_LIMIT)

    # 3. Normalise, validate, deduplicate ------------------------------
    normalised: list[str] = []
    seen: set[str] = set()

    for value in candidates:
        text = _CONTROL_CHAR_RE.sub("", str(value or "")).strip()
        if not text:
            continue

        lower = text.lower()
        if lower in seen:
            continue

        if validate and not _is_valid_email_strict(text):
            logger.warning(
                "email_target_rejected",
                extra={"address": _redact_email(text), "reason": "invalid_format"},
            )
            if rejected is not None:
                rejected.append(text)
            continue

        seen.add(lower)
        normalised.append(text)

    # 4. Enforce recipient cap -----------------------------------------
    if len(normalised) > effective_limit:
        logger.warning(
            "email_recipients_truncated",
            extra={
                "original_count": len(normalised),
                "limit": effective_limit,
            },
        )
        normalised = normalised[:effective_limit]

    return normalised

def _redact_email(addr: str) -> str:
    """Redact the local-part of an email for safe logging.

    ``alice@example.com`` → ``a***e@example.com``
    Non-email strings are truncated to 20 chars.
    """
    if "@" in addr:
        local, domain = addr.rsplit("@", 1)
        if len(local) <= 2:
            return f"{'*' * len(local)}@{domain}"
        return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"
    return addr[:20] + ("…" if len(addr) > 20 else "")
