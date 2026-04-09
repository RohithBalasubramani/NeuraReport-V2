from __future__ import annotations

from functools import lru_cache
import json
import logging
import os
from pathlib import Path
from typing import Any, List, Optional

# ── Pipeline orchestrator ──
# "hermes"  = NousResearch Hermes Agent (Qwen 3.5 tool-calling) — DEFAULT
# "classic" = legacy regex intent + Python orchestrator (fallback)
PIPELINE_ORCHESTRATOR: str = os.getenv("PIPELINE_ORCHESTRATOR", "hermes")

try:
    # Pydantic v2+
    from pydantic_settings import BaseSettings, SettingsConfigDict

    _V2_SETTINGS = True
except ImportError:  # pragma: no cover - fallback for Pydantic v1
    from pydantic import BaseSettings

    SettingsConfigDict = None
    _V2_SETTINGS = False
from pydantic import Field, SecretStr, field_validator
from backend.app.common import utc_now, utc_now_iso


logger = logging.getLogger("neura.config")


def _default_uploads_root() -> Path:
    return Path(__file__).resolve().parents[2] / "uploads"


def _default_excel_uploads_root() -> Path:
    return Path(__file__).resolve().parents[2] / "uploads_excel"


def _default_state_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "state"


def _load_version_info() -> dict[str, Any]:
    version_path = Path(__file__).resolve().parents[1] / "version.json"
    if not version_path.exists():
        return {"version": "dev", "commit": "unknown"}
    try:
        return json.loads(version_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("version_info_load_failed", extra={"event": "version_info_load_failed", "error": str(exc)})
        return {"version": "dev", "commit": "unknown"}


class Settings(BaseSettings):
    api_title: str = "NeuraReport API"
    api_version: str = "4.0"
    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5190", "http://127.0.0.1:5190", "http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "https://tauri.localhost"], validation_alias="NEURA_CORS_ORIGINS")
    api_key: Optional[str] = Field(default=None, validation_alias="NEURA_API_KEY")
    allow_anonymous_api: bool = Field(default=False, validation_alias="NEURA_ALLOW_ANON_API")
    jwt_secret: SecretStr = Field(default="change-me", validation_alias="NEURA_JWT_SECRET")
    jwt_lifetime_seconds: int = Field(default=3600, validation_alias="NEURA_JWT_LIFETIME_SECONDS")

    uploads_dir: Path = Field(default_factory=_default_uploads_root, validation_alias="UPLOAD_ROOT")
    excel_uploads_dir: Path = Field(default_factory=_default_excel_uploads_root, validation_alias="EXCEL_UPLOAD_ROOT")
    state_dir: Path = Field(default_factory=_default_state_dir, validation_alias="NEURA_STATE_DIR")

    max_upload_bytes: int = Field(default=50 * 1024 * 1024, validation_alias="NEURA_MAX_UPLOAD_BYTES")
    max_verify_pdf_bytes: int = Field(default=50 * 1024 * 1024, validation_alias="NEURA_MAX_VERIFY_PDF_BYTES")
    max_zip_entries: int = Field(default=2000, validation_alias="NEURA_MAX_ZIP_ENTRIES")
    max_zip_uncompressed_bytes: int = Field(default=200 * 1024 * 1024, validation_alias="NEURA_MAX_ZIP_UNCOMPRESSED_BYTES")

    template_import_max_concurrency: int = Field(default=4, validation_alias="NEURA_TEMPLATE_IMPORT_MAX_CONCURRENCY")

    # LLM model configuration (Qwen via LiteLLM proxy)
    llm_model: str = Field(default="qwen", validation_alias="LLM_MODEL")

    artifact_warn_bytes: int = Field(default=5 * 1024 * 1024, validation_alias="ARTIFACT_WARN_BYTES")
    artifact_warn_render_ms: int = Field(default=2000, validation_alias="ARTIFACT_WARN_RENDER_MS")
    version: str = Field(default="dev", validation_alias="NEURA_VERSION")
    commit: str = Field(default="unknown", validation_alias="NEURA_COMMIT")

    # Rate limiting configuration
    rate_limit_enabled: bool = Field(default=True, validation_alias="NEURA_RATE_LIMIT_ENABLED")
    rate_limit_requests: int = Field(default=100, validation_alias="NEURA_RATE_LIMIT_REQUESTS")
    rate_limit_window_seconds: int = Field(default=60, validation_alias="NEURA_RATE_LIMIT_WINDOW_SECONDS")
    rate_limit_burst: int = Field(default=20, validation_alias="NEURA_RATE_LIMIT_BURST")

    # Security configuration
    trusted_hosts: List[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1"], validation_alias="NEURA_TRUSTED_HOSTS")
    allowed_hosts_all: bool = Field(default=False, validation_alias="NEURA_ALLOWED_HOSTS_ALL")  # Set to True only for local development

    # Request timeout -- sync report runs may take a while with large datasets
    request_timeout_seconds: int = Field(default=1800, validation_alias="NEURA_REQUEST_TIMEOUT_SECONDS")

    # DataFrame store memory limits
    dataframe_max_memory_mb: int = Field(default=8192, validation_alias="NEURA_DF_MAX_MEMORY_MB")
    dataframe_row_limit: int = Field(default=0, validation_alias="NEURA_DF_ROW_LIMIT")

    # LLM call resilience
    llm_max_attempts: int = Field(default=3, validation_alias="NEURA_LLM_MAX_ATTEMPTS")
    llm_retry_min_wait: float = Field(default=2.0, validation_alias="NEURA_LLM_MIN_WAIT")
    llm_retry_max_wait: float = Field(default=30.0, validation_alias="NEURA_LLM_MAX_WAIT")

    # PDF render timeout (milliseconds) -- 5 minutes per page/chunk
    pdf_render_timeout_ms: int = Field(default=600_000, validation_alias="NEURA_PDF_RENDER_TIMEOUT_MS")

    # Job timeouts (seconds) -- 1 hour for large reports (10M+ rows)
    job_default_timeout_seconds: int = Field(default=7200, validation_alias="NR_JOB_TIMEOUT_SECONDS")
    event_stream_timeout_seconds: int = Field(default=7200, validation_alias="NR_EVENT_STREAM_TIMEOUT")

    # Idempotency configuration
    idempotency_enabled: bool = Field(default=True, validation_alias="NEURA_IDEMPOTENCY_ENABLED")
    idempotency_ttl_seconds: int = Field(default=86400, validation_alias="NEURA_IDEMPOTENCY_TTL_SECONDS")

    # Task queue (Dramatiq + Redis)
    redis_url: str = Field(default="redis://localhost:6379/0", env="NEURA_REDIS_URL")
    worker_processes: int = Field(default=4, env="NEURA_WORKER_PROCESSES")
    worker_threads: int = Field(default=8, env="NEURA_WORKER_THREADS")
    task_result_ttl_ms: int = Field(default=1_800_000, env="NEURA_TASK_RESULT_TTL_MS")

    # Embeddings / vector search (pgvector is the system-of-record in Postgres)
    embedding_model: str = Field(default="all-MiniLM-L6-v2", env="NEURA_EMBEDDING_MODEL")
    embedding_dim: int = Field(default=384, env="NEURA_EMBEDDING_DIM")

    # Database configuration (PostgreSQL or SQLite).
    # Default is a safe relative path that works in dev. On Tauri/desktop,
    # _apply_runtime_defaults() resolves it to state_dir (AppData) instead.
    database_url: str = Field(
        default="sqlite+aiosqlite:///backend/state/neurareport.db",
        env="NEURA_DATABASE_URL"
    )
    database_pool_size: int = Field(default=10, env="NEURA_DB_POOL_SIZE")
    database_pool_max_overflow: int = Field(default=20, env="NEURA_DB_POOL_MAX_OVERFLOW")
    database_pool_timeout: int = Field(default=30, env="NEURA_DB_POOL_TIMEOUT")
    database_echo: bool = Field(default=False, env="NEURA_DB_ECHO")

    # Content Security Policy configuration
    csp_connect_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:*", "ws://localhost:*"],
        validation_alias="NEURA_CSP_CONNECT_ORIGINS"
    )

    # Analysis cache configuration
    analysis_cache_max_items: int = Field(default=100, validation_alias="NEURA_ANALYSIS_CACHE_MAX_ITEMS")
    analysis_cache_ttl_seconds: int = Field(default=3600, validation_alias="NEURA_ANALYSIS_CACHE_TTL_SECONDS")  # 1 hour
    analysis_max_concurrency: int = Field(default=4, validation_alias="NEURA_ANALYSIS_MAX_CONCURRENCY")

    # Observability
    otlp_endpoint: Optional[str] = Field(default=None, env="NEURA_OTLP_ENDPOINT")
    metrics_enabled: bool = Field(default=True, env="NEURA_METRICS_ENABLED")
    app_name: str = Field(default="neurareport-backend", env="NEURA_APP_NAME")

    # Debug/development mode - defaults to False for safety.
    # Set NEURA_DEBUG=true explicitly for local development.
    debug_mode: bool = Field(default=False, validation_alias="NEURA_DEBUG")

    # File/path safety overrides (use only in trusted environments)
    allow_unsafe_pdf_paths: bool = Field(default=False, validation_alias="NEURA_ALLOW_UNSAFE_PDF_PATHS")

    # UX Governance configuration
    # Set to True when frontend is fully compliant with governance headers
    # Default is False to allow development without strict UX headers
    ux_governance_strict: bool = Field(default=False, validation_alias="NEURA_UX_GOVERNANCE_STRICT")

    @field_validator("embedding_dim")
    @classmethod
    def _validate_embedding_dim(cls, v: int) -> int:
        if v <= 0 or v > 8192:
            raise ValueError("embedding_dim must be between 1 and 8192")
        return v

    @property
    def uploads_root(self) -> Path:
        return self.uploads_dir

    @property
    def excel_uploads_root(self) -> Path:
        return self.excel_uploads_dir

    if _V2_SETTINGS:
        # Pydantic Settings v2 - use absolute path to backend/.env
        _env_file = Path(__file__).resolve().parents[2] / ".env"
        model_config = SettingsConfigDict(env_file=str(_env_file), extra="ignore", populate_by_name=True)
    else:  # pragma: no cover - Pydantic v1 fallback
        class Config:
            env_file = str(Path(__file__).resolve().parents[2] / ".env")
            extra = "ignore"


def _apply_runtime_defaults(settings: Settings) -> Settings:
    # Local Qwen via LiteLLM proxy is the primary LLM provider - no API key validation needed

    jwt_val = settings.jwt_secret.get_secret_value()
    if jwt_val.strip().lower() in {"", "change-me"}:
        if settings.debug_mode:
            logger.warning(
                "jwt_secret_default",
                extra={"event": "jwt_secret_default"},
            )
        else:
            raise RuntimeError(
                "NEURA_JWT_SECRET must be set to a strong secret in production "
                "(debug_mode is off). Set NEURA_DEBUG=true to bypass for local development."
            )

    if not os.getenv("NEURA_VERSION") or not os.getenv("NEURA_COMMIT"):
        version_info = _load_version_info()
        if not os.getenv("NEURA_VERSION"):
            settings.version = str(version_info.get("version", settings.version))
        if not os.getenv("NEURA_COMMIT"):
            settings.commit = str(version_info.get("commit", settings.commit))

    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.excel_uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.state_dir.mkdir(parents=True, exist_ok=True)

    # Resolve database_url for SQLite: if using the default relative path and it
    # doesn't resolve (e.g. Tauri desktop where CWD != repo root), rewrite to
    # use state_dir which correctly resolves to AppData on desktop installs.
    _DEFAULT_DB_URL = "sqlite+aiosqlite:///backend/state/neurareport.db"
    if settings.database_url == _DEFAULT_DB_URL:
        relative_db = Path("backend/state/neurareport.db")
        if not relative_db.parent.exists():
            try:
                db_path = settings.state_dir / "neurareport.db"
                settings.database_url = f"sqlite+aiosqlite:///{db_path}"
                logger.info("database_url_resolved", extra={
                    "event": "database_url_resolved",
                    "path": str(db_path),
                })
            except Exception as exc:
                # Fallback: keep the original default -- let SQLAlchemy create it
                logger.warning("database_url_resolve_failed", extra={
                    "event": "database_url_resolve_failed",
                    "error": str(exc),
                })

    return settings


@lru_cache
def get_settings() -> Settings:
    return _apply_runtime_defaults(Settings())


def log_settings(target_logger: logging.Logger, settings: Settings) -> None:
    target_logger.info(
        "app_config",
        extra={
            "event": "app_config",
            "version": settings.version,
            "commit": settings.commit,
            "llm_provider": "claude_code",
            "llm_model": settings.llm_model,
            "uploads_root": str(settings.uploads_root),
            "excel_uploads_root": str(settings.excel_uploads_root),
            "artifact_warn_bytes": settings.artifact_warn_bytes,
            "artifact_warn_render_ms": settings.artifact_warn_render_ms,
        },
    )


# =============================================================================
# ERRORS (merged from errors.py)
# =============================================================================
try:
    from backend.app.utils import AppError, DomainError
except ImportError:
    class AppError(Exception):
        def __init__(self, *, code: str = "error", message: str = "Unknown error", status_code: int = 400, detail: str | None = None) -> None:
            self.code = code
            self.message = message
            self.status_code = status_code
            self.detail = detail
            super().__init__(message)

    class DomainError(AppError):
        pass



# =============================================================================
# JOB_STATUS (merged from job_status.py)
# =============================================================================
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_CANCELLING = "cancelling"
STATUS_PENDING_RETRY = "pending_retry"
TERMINAL_STATUSES = frozenset({STATUS_SUCCEEDED, STATUS_FAILED, STATUS_CANCELLED})
ACTIVE_STATUSES = frozenset({STATUS_QUEUED, STATUS_RUNNING, STATUS_CANCELLING, STATUS_PENDING_RETRY})
RETRY_STATUSES = frozenset({STATUS_PENDING_RETRY})

def normalize_job_status(status=None):
    value = (status or "").strip().lower()
    if value in {"succeeded", "success", "done", "completed"}: return STATUS_SUCCEEDED
    if value in {"queued", "pending", "waiting"}: return STATUS_QUEUED
    if value in {"running", "in_progress", "started", "processing"}: return STATUS_RUNNING
    if value in {"failed", "error", "errored"}: return STATUS_FAILED
    if value in {"cancelled", "canceled"}: return STATUS_CANCELLED
    if value == "cancelling": return STATUS_CANCELLING
    if value in {"pending_retry", "retry_pending", "retry_scheduled", "awaiting_retry"}: return STATUS_PENDING_RETRY
    return STATUS_QUEUED

def normalize_job(job=None):
    if not job: return job
    normalized = dict(job)
    if "status" in normalized: normalized["status"] = normalize_job_status(normalized["status"])
    elif "state" in normalized: normalized["status"] = normalize_job_status(normalized["state"])
    return normalized

def is_terminal_status(status=None): return normalize_job_status(status) in TERMINAL_STATUSES
def is_active_status(status=None): return normalize_job_status(status) in ACTIVE_STATUSES
def is_pending_retry(status=None): return normalize_job_status(status) in RETRY_STATUSES
def can_retry(job=None):
    if not job: return False
    if normalize_job_status(job.get("status")) != STATUS_FAILED: return False
    return (job.get("retryCount") or job.get("retry_count") or 0) < (job.get("maxRetries") or job.get("max_retries") or 3)



# =============================================================================
# STATIC_FILES (merged from static_files.py)
# =============================================================================

from email.utils import formatdate
from pathlib import Path
from urllib.parse import parse_qs, quote

from fastapi.staticfiles import StaticFiles


class UploadsStaticFiles(StaticFiles):
    """Static file handler that adds ETag, cache, and download headers."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 404:
            return response

        query_params = {}
        if scope:
            raw_qs = scope.get("query_string") or b""
            if raw_qs:
                try:
                    query_params = parse_qs(raw_qs.decode("utf-8", errors="ignore"))
                except Exception:
                    query_params = {}

        try:
            full_path, stat_result = await self.lookup_path(path)
        except Exception:
            full_path = None
            stat_result = None

        if full_path and stat_result:
            etag = f"\"{stat_result.st_mtime_ns:x}-{stat_result.st_size:x}\""
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["ETag"] = etag
            response.headers["Last-Modified"] = formatdate(stat_result.st_mtime, usegmt=True)
            if query_params.get("download"):
                filename = Path(full_path).name
                quoted = quote(filename)
                response.headers[
                    "Content-Disposition"
                ] = f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quoted}'

        return response


# =============================================================================
# STATE_ACCESS (merged from state_access.py)
# =============================================================================

from typing import Any

from backend.app.repositories import StateStore, set_state_store, state_store as _state_store_proxy

# NOTE: Prefer these explicit service helpers in API code. The underlying proxy
# is kept for compatibility with legacy/service usage and tests.


def _call(method: str, *args: Any, **kwargs: Any) -> Any:
    return getattr(_state_store_proxy, method)(*args, **kwargs)


def get_state_store() -> StateStore:
    return _state_store_proxy.get()


def list_connections() -> list[dict]:
    return _call("list_connections")


def list_templates() -> list[dict]:
    return _call("list_templates")


def list_jobs(*args: Any, **kwargs: Any) -> list[dict]:
    return _call("list_jobs", *args, **kwargs)


def list_schedules() -> list[dict]:
    return _call("list_schedules")


def get_connection_record(conn_id: str) -> dict | None:
    return _call("get_connection_record", conn_id)


def get_connection_secrets(conn_id: str) -> dict | None:
    return _call("get_connection_secrets", conn_id)


def get_latest_connection() -> dict | None:
    return _call("get_latest_connection")


def get_template_record(template_id: str) -> dict | None:
    return _call("get_template_record", template_id)


def upsert_template(*args: Any, **kwargs: Any) -> dict:
    return _call("upsert_template", *args, **kwargs)


def delete_template(template_id: str) -> bool:
    return _call("delete_template", template_id)


def get_job(job_id: str) -> dict | None:
    return _call("get_job", job_id)


def update_job(job_id: str, **updates: Any) -> dict | None:
    return _call("update_job", job_id, **updates)


def delete_job(job_id: str) -> bool:
    return _call("delete_job", job_id)


def create_job(*args: Any, **kwargs: Any) -> dict:
    return _call("create_job", *args, **kwargs)


def record_job_start(job_id: str) -> None:
    _call("record_job_start", job_id)


def record_job_step(*args: Any, **kwargs: Any) -> None:
    _call("record_job_step", *args, **kwargs)


def record_job_completion(*args: Any, **kwargs: Any) -> None:
    _call("record_job_completion", *args, **kwargs)


def record_schedule_run(*args: Any, **kwargs: Any) -> None:
    _call("record_schedule_run", *args, **kwargs)


def list_report_runs(*args: Any, **kwargs: Any) -> list[dict]:
    return _call("list_report_runs", *args, **kwargs)


def get_report_run(run_id: str) -> dict | None:
    return _call("get_report_run", run_id)


def get_activity_log(*args: Any, **kwargs: Any) -> list[dict]:
    return _call("get_activity_log", *args, **kwargs)


def log_activity(*args: Any, **kwargs: Any) -> dict:
    return _call("log_activity", *args, **kwargs)


def clear_activity_log() -> int:
    return _call("clear_activity_log")


def get_favorites() -> dict:
    return _call("get_favorites")


def add_favorite(entity_type: str, entity_id: str) -> bool:
    return _call("add_favorite", entity_type, entity_id)


def remove_favorite(entity_type: str, entity_id: str) -> bool:
    return _call("remove_favorite", entity_type, entity_id)


def is_favorite(entity_type: str, entity_id: str) -> bool:
    return _call("is_favorite", entity_type, entity_id)


def get_user_preferences() -> dict:
    return _call("get_user_preferences")


def update_user_preferences(updates: dict) -> dict:
    return _call("update_user_preferences", updates)


def set_user_preference(key: str, value: Any) -> dict:
    return _call("set_user_preference", key, value)


def get_notifications(*args: Any, **kwargs: Any) -> list[dict]:
    return _call("get_notifications", *args, **kwargs)


def get_unread_count() -> int:
    return _call("get_unread_count")


def add_notification(*args: Any, **kwargs: Any) -> dict:
    return _call("add_notification", *args, **kwargs)


def mark_notification_read(notification_id: str) -> bool:
    return _call("mark_notification_read", notification_id)


def mark_all_notifications_read() -> int:
    return _call("mark_all_notifications_read")


def delete_notification(notification_id: str) -> bool:
    return _call("delete_notification", notification_id)


def clear_notifications() -> int:
    return _call("clear_notifications")


def get_last_used() -> dict:
    return _call("get_last_used")


def set_last_used(*args: Any, **kwargs: Any) -> dict:
    return _call("set_last_used", *args, **kwargs)


def get() -> dict:
    return _call("get")


# =============================================================================
# Idempotency key management
# =============================================================================

def check_idempotency_key(key: str, request_hash: str) -> tuple[bool, dict | None]:
    return _call("check_idempotency_key", key, request_hash)


def store_idempotency_key(key: str, job_id: str, request_hash: str, response: dict) -> dict:
    return _call("store_idempotency_key", key, job_id, request_hash, response)


def clean_expired_idempotency_keys() -> int:
    return _call("clean_expired_idempotency_keys")


# =============================================================================
# Dead Letter Queue management
# =============================================================================

def list_dead_letter_jobs(limit: int = 50) -> list[dict]:
    return _call("list_dead_letter_jobs", limit=limit)


def get_dead_letter_job(job_id: str) -> dict | None:
    return _call("get_dead_letter_job", job_id)


def move_job_to_dlq(job_id: str, failure_history: list[dict] | None = None) -> dict | None:
    return _call("move_job_to_dlq", job_id, failure_history)


def requeue_from_dlq(job_id: str) -> dict | None:
    return _call("requeue_from_dlq", job_id)


def delete_from_dlq(job_id: str) -> bool:
    return _call("delete_from_dlq", job_id)


def get_dlq_stats() -> dict:
    return _call("get_dlq_stats")


state_store = _state_store_proxy


__all__ = [
    "StateStore",
    "set_state_store",
    "state_store",
    "get_state_store",
    "list_connections",
    "list_templates",
    "list_jobs",
    "list_schedules",
    "get_connection_record",
    "get_connection_secrets",
    "get_latest_connection",
    "get_template_record",
    "upsert_template",
    "delete_template",
    "get_job",
    "update_job",
    "delete_job",
    "create_job",
    "record_job_start",
    "record_job_step",
    "record_job_completion",
    "record_schedule_run",
    "list_report_runs",
    "get_report_run",
    "get_activity_log",
    "log_activity",
    "clear_activity_log",
    "get_favorites",
    "add_favorite",
    "remove_favorite",
    "is_favorite",
    "get_user_preferences",
    "update_user_preferences",
    "set_user_preference",
    "get_notifications",
    "get_unread_count",
    "add_notification",
    "mark_notification_read",
    "mark_all_notifications_read",
    "delete_notification",
    "clear_notifications",
    "get_last_used",
    "set_last_used",
    "get",
    # Idempotency key management
    "check_idempotency_key",
    "store_idempotency_key",
    "clean_expired_idempotency_keys",
    # Dead Letter Queue management
    "list_dead_letter_jobs",
    "get_dead_letter_job",
    "move_job_to_dlq",
    "requeue_from_dlq",
    "delete_from_dlq",
    "get_dlq_stats",
]


# =============================================================================
# AUTH_SECURITY (merged from auth_security.py)
# =============================================================================

import hmac
import uuid
from typing import AsyncGenerator

from fastapi import Depends, Header, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from sqlalchemy import Column, String
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

def _lazy_get_engine():
    from backend.app.services.db.engine import get_engine
    return get_engine()

def _lazy_get_session_factory():
    from backend.app.services.db.engine import get_session_factory
    return get_session_factory()

_auth_logger = logging.getLogger("neura.auth")

# Auth-specific engine/session (only used when NEURA_AUTH_DB_URL override is set)
_auth_engine = None
_auth_session_factory = None


_AuthBase = declarative_base()


def _has_auth_db_override() -> bool:
    """Check if a separate auth database URL is configured."""
    return bool(os.getenv("NEURA_AUTH_DB_URL"))


def _get_auth_engine():
    """Get the auth-specific engine when NEURA_AUTH_DB_URL is set."""
    global _auth_engine, _auth_session_factory
    if _auth_engine is None:
        url = os.getenv("NEURA_AUTH_DB_URL")
        connect_args = {}
        if url and "sqlite" in url:
            connect_args = {"check_same_thread": False}
        _auth_engine = create_async_engine(url, connect_args=connect_args)
        _auth_session_factory = async_sessionmaker(_auth_engine, expire_on_commit=False)
        _auth_logger.info(
            "auth_db_override_active",
            extra={"event": "auth_db_override_active", "dialect": url.split(":")[0] if ":" in url else "unknown"},
        )
    return _auth_engine


def _get_auth_session_factory():
    """Get the session factory for auth -- uses override or centralized engine."""
    if _has_auth_db_override():
        if _auth_session_factory is None:
            _get_auth_engine()
        return _auth_session_factory
    # Default: use the centralized engine from backend.app.db.engine
    return _lazy_get_session_factory()


class User(SQLAlchemyBaseUserTableUUID, _AuthBase):
    __tablename__ = "auth_users"
    full_name = Column(String, nullable=True)


class UserRead(schemas.BaseUser[uuid.UUID]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


class UserUpdate(schemas.BaseUserUpdate):
    pass


async def get_user_db() -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    session_factory = _get_auth_session_factory()
    async with session_factory() as session:
        yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret: str = ""
    verification_token_secret: str = ""

    def __init__(self, user_db: SQLAlchemyUserDatabase):
        super().__init__(user_db)
        settings = get_settings()
        self.reset_password_token_secret = settings.jwt_secret.get_secret_value()
        self.verification_token_secret = settings.jwt_secret.get_secret_value()

    async def on_after_register(self, user: User, request: Optional[Request] = None) -> None:
        return None


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    settings = get_settings()
    return JWTStrategy(
        secret=settings.jwt_secret.get_secret_value(),
        lifetime_seconds=settings.jwt_lifetime_seconds,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])
current_active_user = fastapi_users.current_user(active=True)
current_optional_user = fastapi_users.current_user(optional=True)


async def init_auth_db() -> None:
    """Create auth tables. Uses override engine if NEURA_AUTH_DB_URL is set."""
    if _has_auth_db_override():
        engine = _get_auth_engine()
    else:
        engine = _lazy_get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(_AuthBase.metadata.create_all)
    _auth_logger.info("auth_db_initialized", extra={"event": "auth_db_initialized"})


def constant_time_compare(a: str | None, b: str | None) -> bool:
    """
    Compare two strings in constant time to prevent timing attacks.
    Returns True if both strings are non-None and equal.
    """
    if a is None or b is None:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


async def require_api_key(
    x_api_key: str | None = Header(None),
    settings=Depends(get_settings),
    user=Depends(current_optional_user),
) -> None:
    """
    Lightweight API key gate. Enforces either an authenticated user or a valid API key.
    Uses constant-time comparison to prevent timing attacks.
    """
    if user is not None:
        return
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    if settings.allow_anonymous_api or settings.debug_mode:
        return
    if not settings.api_key:
        return
    if not constant_time_compare(x_api_key, settings.api_key):
        raise AppError(code="unauthorized", message="Invalid API key", status_code=401)


def verify_ws_token(token: str | None) -> bool:
    """
    Verify WebSocket token from query parameter.
    Returns True if token is valid or if auth is bypassed.
    """
    settings = get_settings()
    if os.getenv("PYTEST_CURRENT_TEST"):
        return True
    if settings.allow_anonymous_api or settings.debug_mode:
        return True
    if not settings.api_key:
        return True
    return constant_time_compare(token, settings.api_key)


# =============================================================================
# BACKGROUND_TASKS (merged from background_tasks.py)
# =============================================================================

import asyncio
import contextlib
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncIterable, Callable, Iterable, Optional

from backend.app.repositories import state_store

logger = logging.getLogger("neura.background_tasks")

_DEFAULT_TASK_WORKERS = os.cpu_count() or 4
_TASK_WORKERS = max(int(os.getenv("NR_TASK_WORKERS", str(_DEFAULT_TASK_WORKERS)) or _DEFAULT_TASK_WORKERS), 1)
_TASK_EXECUTOR = ThreadPoolExecutor(max_workers=_TASK_WORKERS)

# Limit concurrent LLM-intensive jobs (verify, mapping) to prevent OOM.
# Each LLM job can consume 500MB+ of memory; running too many in parallel
# (e.g. 5 template verifications) can exhaust available RAM and crash the server.
_MAX_LLM_CONCURRENT = max(int(os.getenv("NR_MAX_LLM_CONCURRENT", "2")), 1)
_LLM_SEMAPHORE = threading.Semaphore(_MAX_LLM_CONCURRENT)

_BACKGROUND_TASKS: set[asyncio.Task] = set()
_BACKGROUND_LOCK = threading.Lock()


def _track_task(task: asyncio.Task) -> None:
    with _BACKGROUND_LOCK:
        _BACKGROUND_TASKS.add(task)

    def _done(_task: asyncio.Task) -> None:
        with _BACKGROUND_LOCK:
            _BACKGROUND_TASKS.discard(_task)

    task.add_done_callback(_done)


def _is_cancelled(job_id: str) -> bool:
    job = state_store.get_job(job_id) or {}
    status = str(job.get("status") or "").strip().lower()
    return status == "cancelled"


def _normalize_step_status(status: Optional[str]) -> Optional[str]:
    if not status:
        return None
    value = str(status).strip().lower()
    if value in {"started", "running", "in_progress"}:
        return "running"
    if value in {"complete", "completed", "done", "success"}:
        return "succeeded"
    if value in {"error", "failed"}:
        return "failed"
    if value in {"skipped"}:
        return "succeeded"
    if value in {"cancelled", "canceled"}:
        return "cancelled"
    return value


def _apply_event(
    job_id: str,
    event: dict,
    *,
    result_builder: Optional[Callable[[dict], dict]] = None,
) -> bool:
    event_type = str(event.get("event") or "").strip().lower()
    if event_type == "stage":
        stage = str(event.get("stage") or event.get("label") or "stage").strip()
        label = str(event.get("label") or event.get("detail") or stage).strip()
        status = _normalize_step_status(event.get("status"))
        progress = event.get("progress")
        state_store.record_job_step(
            job_id,
            stage,
            label=label,
            status=status,
            progress=progress if isinstance(progress, (int, float)) else None,
        )
        if isinstance(progress, (int, float)):
            state_store.record_job_progress(job_id, float(progress))
        return False

    if event_type == "error":
        detail = event.get("detail") or event.get("message") or "Task failed"
        state_store.record_job_completion(job_id, status="failed", error=str(detail))
        return True

    if event_type == "result":
        result_payload = result_builder(event) if result_builder else dict(event)
        state_store.record_job_completion(job_id, status="succeeded", result=result_payload)
        return True

    return False


def iter_ndjson_events(chunks: Iterable[bytes]) -> Iterable[dict]:
    buffer = ""
    for chunk in chunks:
        try:
            text = chunk.decode("utf-8")
        except Exception:
            continue
        buffer += text
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except Exception:
                continue
            if isinstance(payload, dict):
                yield payload


async def iter_ndjson_events_async(chunks: AsyncIterable[bytes]) -> AsyncIterable[dict]:
    buffer = ""
    try:
        async for chunk in chunks:
            try:
                text = chunk.decode("utf-8")
            except Exception:
                continue
            buffer += text
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except Exception:
                    continue
                if isinstance(payload, dict):
                    yield payload
    finally:
        close_fn = getattr(chunks, "aclose", None)
        if callable(close_fn):
            with contextlib.suppress(Exception):
                await close_fn()


# Event stream wall-clock timeout
_EVENT_STREAM_TIMEOUT = int(os.getenv("NR_EVENT_STREAM_TIMEOUT", "7200"))


def run_event_stream(
    job_id: str,
    events: Iterable[dict],
    *,
    result_builder: Optional[Callable[[dict], dict]] = None,
    timeout_seconds: int | None = None,
) -> None:
    if _is_cancelled(job_id):
        return
    state_store.record_job_start(job_id)
    completed = False
    deadline = time.monotonic() + (timeout_seconds or _EVENT_STREAM_TIMEOUT)

    for event in events:
        if time.monotonic() > deadline:
            timeout_val = timeout_seconds or _EVENT_STREAM_TIMEOUT
            logger.error("event_stream_timeout job_id=%s timeout=%ds", job_id, timeout_val)
            state_store.record_job_completion(
                job_id, status="failed",
                error=f"Event stream exceeded timeout of {timeout_val}s",
            )
            close_fn = getattr(events, "close", None)
            if callable(close_fn):
                with contextlib.suppress(Exception):
                    close_fn()
            return
        if _is_cancelled(job_id):
            state_store.record_job_completion(job_id, status="cancelled", error="Cancelled by user")
            close_fn = getattr(events, "close", None)
            if callable(close_fn):
                with contextlib.suppress(Exception):
                    close_fn()
            return
        completed = _apply_event(job_id, event, result_builder=result_builder)
        if completed:
            break
    if completed:
        close_fn = getattr(events, "close", None)
        if callable(close_fn):
            with contextlib.suppress(Exception):
                close_fn()
    if not completed:
        state_store.record_job_completion(job_id, status="failed", error="Task finished without result")


async def run_event_stream_async(
    job_id: str,
    events: AsyncIterable[dict],
    *,
    result_builder: Optional[Callable[[dict], dict]] = None,
) -> None:
    if _is_cancelled(job_id):
        return
    state_store.record_job_start(job_id)
    completed = False
    async for event in events:
        if _is_cancelled(job_id):
            state_store.record_job_completion(job_id, status="cancelled", error="Cancelled by user")
            close_fn = getattr(events, "aclose", None)
            if callable(close_fn):
                with contextlib.suppress(Exception):
                    await close_fn()
            return
        completed = _apply_event(job_id, event, result_builder=result_builder)
        if completed:
            break
    if completed:
        close_fn = getattr(events, "aclose", None)
        if callable(close_fn):
            with contextlib.suppress(Exception):
                await close_fn()
    if not completed:
        state_store.record_job_completion(job_id, status="failed", error="Task finished without result")


# Job types that involve heavy LLM calls and should be concurrency-limited.
_LLM_JOB_TYPES = {"verify_template", "verify_excel", "mapping_approve"}

# Per-job-type timeout defaults (seconds).
# LLM jobs get shorter timeouts; report jobs need more time for large datasets (10M+ rows).
_JOB_TIMEOUT_MAP = {
    "verify_template": 600,
    "verify_excel": 600,
    "mapping_approve": 600,
    "run_report": 7200,
}
_DEFAULT_JOB_TIMEOUT = int(os.getenv("NR_JOB_TIMEOUT_SECONDS", "7200"))


def _run_with_heartbeat(runner: Callable, job_id: str) -> None:
    """Execute *runner* while emitting periodic heartbeats for stale-job detection.

    The existing recovery daemon (``find_stale_running_jobs``) checks
    ``last_heartbeat_at`` to detect truly stuck jobs.  This function ensures
    heartbeats are sent automatically for every background job.
    """
    heartbeat_interval = 30  # seconds
    stop_event = threading.Event()

    def _heartbeat_loop():
        while not stop_event.wait(heartbeat_interval):
            try:
                state_store.update_job_heartbeat(job_id)
            except Exception:
                pass  # heartbeat is best-effort

    hb_thread = threading.Thread(target=_heartbeat_loop, daemon=True, name=f"hb-{job_id[:8]}")
    hb_thread.start()
    try:
        result = runner(job_id)
        if asyncio.iscoroutine(result):
            asyncio.run(result)
    finally:
        stop_event.set()
        hb_thread.join(timeout=5)


async def enqueue_background_job(
    *,
    job_type: str,
    template_id: Optional[str] = None,
    connection_id: Optional[str] = None,
    template_name: Optional[str] = None,
    template_kind: Optional[str] = None,
    steps: Optional[Iterable[dict]] = None,
    meta: Optional[dict] = None,
    runner: Callable[[str], None],
) -> dict:
    job = state_store.create_job(
        job_type=job_type,
        template_id=template_id,
        connection_id=connection_id,
        template_name=template_name,
        template_kind=template_kind,
        steps=steps,
        meta=meta,
    )

    use_llm_semaphore = job_type in _LLM_JOB_TYPES
    job_timeout = _JOB_TIMEOUT_MAP.get(job_type, _DEFAULT_JOB_TIMEOUT)

    async def _schedule() -> None:
        def _run() -> None:
            import concurrent.futures

            acquired = False
            job_id = job["id"]
            try:
                if use_llm_semaphore:
                    logger.info(
                        "llm_semaphore_wait",
                        extra={"event": "llm_semaphore_wait", "job_id": job_id, "job_type": job_type},
                    )
                    if not _LLM_SEMAPHORE.acquire(timeout=job_timeout):
                        state_store.record_job_completion(
                            job_id, status="failed",
                            error=f"Timed out waiting for LLM semaphore ({job_timeout}s)",
                        )
                        return
                    acquired = True

                # Run with heartbeat in a separate thread so we can enforce a timeout
                with concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"job-{job_id[:8]}") as inner:
                    future = inner.submit(_run_with_heartbeat, runner, job_id)
                    try:
                        future.result(timeout=job_timeout)
                    except concurrent.futures.TimeoutError:
                        logger.error(
                            "job_timeout job_id=%s job_type=%s timeout=%ds",
                            job_id, job_type, job_timeout,
                        )
                        state_store.record_job_completion(
                            job_id, status="failed",
                            error=f"Job exceeded timeout of {job_timeout}s",
                        )
            except Exception as exc:
                logger.exception(
                    "background_task_failed",
                    extra={"event": "background_task_failed", "job_id": job_id, "error": str(exc)},
                )
                state_store.record_job_completion(job_id, status="failed", error=str(exc)[:500])
            finally:
                if acquired:
                    _LLM_SEMAPHORE.release()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_TASK_EXECUTOR, _run)

    task = asyncio.create_task(_schedule())
    _track_task(task)
    return job


def mark_incomplete_jobs_failed(
    *,
    reason: str = "Server restarted before job completed",
    skip_types: Optional[set[str]] = None,
) -> int:
    """
    Mark queued/running jobs as failed (used during startup recovery).
    Returns number of jobs updated.
    """
    skipped = {str(t or "").strip().lower() for t in (skip_types or set())}
    jobs = state_store.list_jobs(statuses=["queued", "running"], limit=0)
    updated = 0
    for job in jobs:
        job_id = job.get("id")
        if not job_id:
            continue
        job_type = str(job.get("type") or "").strip().lower()
        if job_type in skipped:
            continue
        state_store.record_job_completion(job_id, status="failed", error=reason)
        updated += 1
    return updated


# =============================================================================
# SEED_DATA (merged from seed_data.py)
# =============================================================================
"""
Seed Data Initialization
Provides sample data for new installations to demonstrate features.
"""

import logging
from datetime import datetime, timezone, timedelta
import uuid

logger = logging.getLogger(__name__)




def _days_ago(days: int):
    return utc_now() - timedelta(days=days)


async def seed_knowledge_library():
    """Seed the knowledge library with sample documents, collections, and tags."""
    from backend.app.services.knowledge_service import knowledge_service
    from backend.app.schemas import (
        LibraryDocumentCreate,
        CollectionCreate,
        TagCreate,
        DocumentType,
    )

    # Check if already seeded
    docs, total = await knowledge_service.list_documents(limit=1)
    if total > 0:
        logger.info("Knowledge library already has data, skipping seed")
        return

    logger.info("Seeding knowledge library with sample data...")

    # Create tags
    tags = [
        # Tag colors use secondary palette 500 values per Design System v4/v5
        TagCreate(name="Important", color="#F43F5E", description="High priority items"),       # Rose 500
        TagCreate(name="Finance", color="#64748B", description="Financial documents"),         # Slate 500
        TagCreate(name="Marketing", color="#8B5CF6", description="Marketing materials"),       # Violet 500
        TagCreate(name="Technical", color="#06B6D4", description="Technical documentation"),   # Cyan 500
        TagCreate(name="Legal", color="#14B8A6", description="Legal documents"),               # Teal 500
        TagCreate(name="HR", color="#D946EF", description="Human resources"),                  # Fuchsia 500
    ]

    created_tags = []
    for tag in tags:
        created = await knowledge_service.create_tag(tag)
        created_tags.append(created)

    # Create collections
    collections = [
        CollectionCreate(name="Q1 2024 Reports", description="First quarter reports and analysis"),
        CollectionCreate(name="Product Documentation", description="Technical product docs"),
        CollectionCreate(name="Marketing Assets", description="Marketing collateral and campaigns"),
        CollectionCreate(name="Meeting Notes", description="Notes from various meetings"),
    ]

    created_collections = []
    for coll in collections:
        created = await knowledge_service.create_collection(coll)
        created_collections.append(created)

    # Create sample documents
    sample_docs = [
        LibraryDocumentCreate(
            title="Q1 2024 Financial Summary",
            description="Comprehensive financial summary for the first quarter of 2024, including revenue analysis, expense breakdown, and profit margins.",
            document_type=DocumentType.PDF,
            tags=["Finance", "Important"],
            collections=[created_collections[0].id],
            metadata={"author": "Finance Team", "department": "Finance"},
        ),
        LibraryDocumentCreate(
            title="Product Roadmap 2024",
            description="Strategic product roadmap outlining major features, milestones, and release timelines for the year.",
            document_type=DocumentType.PDF,
            tags=["Technical", "Important"],
            collections=[created_collections[1].id],
            metadata={"author": "Product Team", "version": "2.1"},
        ),
        LibraryDocumentCreate(
            title="Marketing Campaign Analysis",
            description="Analysis of Q1 marketing campaigns including social media performance, email metrics, and ROI calculations.",
            document_type=DocumentType.PDF,
            tags=["Marketing"],
            collections=[created_collections[2].id],
            metadata={"campaign": "Spring 2024"},
        ),
        LibraryDocumentCreate(
            title="API Documentation v3.0",
            description="Complete API reference documentation including endpoints, authentication, and code examples.",
            document_type=DocumentType.OTHER,
            tags=["Technical"],
            collections=[created_collections[1].id],
            metadata={"version": "3.0", "format": "API Reference"},
        ),
        LibraryDocumentCreate(
            title="Employee Handbook 2024",
            description="Updated employee handbook with policies, benefits information, and company guidelines.",
            document_type=DocumentType.PDF,
            tags=["HR", "Legal"],
            collections=[],
            metadata={"effective_date": "2024-01-01"},
        ),
        LibraryDocumentCreate(
            title="Board Meeting Notes - January",
            description="Summary notes from the January board meeting covering strategic initiatives and quarterly reviews.",
            document_type=DocumentType.DOCX,
            tags=["Important"],
            collections=[created_collections[3].id],
            metadata={"meeting_date": "2024-01-15"},
        ),
        LibraryDocumentCreate(
            title="Competitor Analysis Report",
            description="Detailed analysis of key competitors including market positioning, strengths, and weaknesses.",
            document_type=DocumentType.PDF,
            tags=["Marketing", "Important"],
            collections=[created_collections[2].id],
            metadata={"analysts": ["Market Research Team"]},
        ),
        LibraryDocumentCreate(
            title="Security Compliance Checklist",
            description="SOC2 and GDPR compliance checklist with current status and remediation items.",
            document_type=DocumentType.XLSX,
            tags=["Technical", "Legal"],
            collections=[created_collections[1].id],
            metadata={"compliance_type": "SOC2, GDPR"},
        ),
    ]

    for doc in sample_docs:
        await knowledge_service.add_document(doc)

    logger.info(f"Seeded {len(sample_docs)} documents, {len(created_collections)} collections, {len(created_tags)} tags")


async def seed_brand_kits():
    """Seed the design system with sample brand kits and themes."""
    from backend.app.services.ai_services import design_service
    from backend.app.schemas import BrandKitCreate, ThemeCreate

    # Check state store directly first (more reliable than in-memory service)
    try:
        from backend.app.repositories import state_store
        with state_store.transaction() as state:
            existing = state.get("brand_kits", {})
            if existing and len(existing) > 0:
                logger.info("Brand kits already exist in state store (%d), skipping seed", len(existing))
                return
    except Exception:
        pass

    # Fallback: also check via service
    existing_kits = await design_service.list_brand_kits()
    if len(existing_kits) > 0:
        logger.info("Brand kits already exist, skipping seed")
        return

    logger.info("Seeding brand kits and themes...")

    # Create sample brand kits
    brand_kits = [
        BrandKitCreate(
            name="Corporate Blue",
            primary_color="#1e40af",
            secondary_color="#3b82f6",
            font_family="Inter",
            is_default=True,
        ),
        BrandKitCreate(
            name="Modern Green",
            primary_color="#047857",
            secondary_color="#10b981",
            font_family="Plus Jakarta Sans",
            is_default=False,
        ),
        BrandKitCreate(
            name="Professional Dark",
            primary_color="#1f2937",
            secondary_color="#6b7280",
            font_family="IBM Plex Sans",
            is_default=False,
        ),
    ]

    for kit in brand_kits:
        await design_service.create_brand_kit(kit)

    # Create sample themes
    themes = [
        ThemeCreate(
            name="Light Mode",
            mode="light",
            colors={
                "background": "#ffffff",
                "surface": "#f8fafc",
                "text": "#1e293b",
                "primary": "#3b82f6",
            },
            is_active=True,
        ),
        ThemeCreate(
            name="Dark Mode",
            mode="dark",
            colors={
                "background": "#0f172a",
                "surface": "#1e293b",
                "text": "#f1f5f9",
                "primary": "#60a5fa",
            },
            is_active=False,
        ),
    ]

    for theme in themes:
        await design_service.create_theme(theme)

    logger.info(f"Seeded {len(brand_kits)} brand kits, {len(themes)} themes")


async def seed_connections():
    """Seed sample database connections."""
    from backend.app.repositories import state_store

    with state_store.transaction() as state:
        connections = state.get("connections", [])
        seed_flags = state.get("_seed_flags", {})

        if len(connections) > 0 or seed_flags.get("connections_seeded"):
            logger.info("Connections already exist or previously seeded, skipping")
            return

    logger.info("Seeding sample connections...")

    sample_connections = [
        {
            "id": str(uuid.uuid4()),
            "name": "Production Analytics DB",
            "db_type": "postgresql",
            "host": "analytics.example.com",
            "port": 5432,
            "database": "analytics",
            "is_active": True,
            "created_at": utc_now().isoformat(),
            "last_tested": _days_ago(1).isoformat(),
            "status": "connected",
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Sales Data Warehouse",
            "db_type": "snowflake",
            "host": "org.snowflakecomputing.com",
            "database": "SALES_DW",
            "is_active": True,
            "created_at": _days_ago(30).isoformat(),
            "last_tested": _days_ago(2).isoformat(),
            "status": "connected",
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Marketing MongoDB",
            "db_type": "mongodb",
            "host": "mongodb.example.com",
            "port": 27017,
            "database": "marketing",
            "is_active": True,
            "created_at": _days_ago(60).isoformat(),
            "last_tested": _days_ago(5).isoformat(),
            "status": "connected",
        },
    ]

    with state_store.transaction() as state:
        state["connections"] = {conn["id"]: conn for conn in sample_connections}
        flags = state.get("_seed_flags", {})
        flags["connections_seeded"] = True
        state["_seed_flags"] = flags

    logger.info(f"Seeded {len(sample_connections)} connections")


async def seed_templates():
    """Seed sample report templates."""
    from backend.app.repositories import state_store

    with state_store.transaction() as state:
        templates = state.get("templates", [])
        seed_flags = state.get("_seed_flags", {})

        if len(templates) > 0 or seed_flags.get("templates_seeded"):
            logger.info("Templates already exist, skipping seed")
            return

    logger.info("Seeding sample templates...")

    sample_templates = [
        {
            "id": str(uuid.uuid4()),
            "name": "Monthly Sales Report",
            "description": "Standard monthly sales report with revenue breakdown and trends",
            "category": "Sales",
            "status": "draft",
            "created_at": _days_ago(90).isoformat(),
            "updated_at": _days_ago(5).isoformat(),
            "is_favorite": True,
            "usage_count": 24,
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Executive Dashboard",
            "description": "High-level KPI dashboard for executive team review",
            "category": "Executive",
            "status": "draft",
            "created_at": _days_ago(120).isoformat(),
            "updated_at": _days_ago(3).isoformat(),
            "is_favorite": True,
            "usage_count": 48,
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Customer Churn Analysis",
            "description": "Customer retention and churn metrics with cohort analysis",
            "category": "Analytics",
            "status": "draft",
            "created_at": _days_ago(45).isoformat(),
            "updated_at": _days_ago(10).isoformat(),
            "is_favorite": False,
            "usage_count": 12,
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Marketing Campaign ROI",
            "description": "Campaign performance metrics and ROI calculations",
            "category": "Marketing",
            "status": "draft",
            "created_at": _days_ago(30).isoformat(),
            "updated_at": _days_ago(7).isoformat(),
            "is_favorite": False,
            "usage_count": 8,
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Inventory Status Report",
            "description": "Current inventory levels, reorder points, and stock alerts",
            "category": "Operations",
            "status": "draft",
            "created_at": _days_ago(60).isoformat(),
            "updated_at": _days_ago(1).isoformat(),
            "is_favorite": False,
            "usage_count": 16,
        },
    ]

    with state_store.transaction() as state:
        state["templates"] = {tpl["id"]: tpl for tpl in sample_templates}
        flags = state.get("_seed_flags", {})
        flags["templates_seeded"] = True
        state["_seed_flags"] = flags

    logger.info(f"Seeded {len(sample_templates)} templates")


async def seed_all():
    """Run all seed functions."""
    logger.info("Starting data seeding...")

    try:
        await seed_knowledge_library()
    except Exception as e:
        logger.warning(f"Failed to seed knowledge library: {e}")

    try:
        await seed_brand_kits()
    except Exception as e:
        logger.warning(f"Failed to seed brand kits: {e}")

    try:
        await seed_connections()
    except Exception as e:
        logger.warning(f"Failed to seed connections: {e}")

    try:
        await seed_templates()
    except Exception as e:
        logger.warning(f"Failed to seed templates: {e}")

    logger.info("Data seeding complete")


# =========================================================================== #
#  RBAC (Role-Based Access Control) — merged from V1 rbac/                    #
# =========================================================================== #

_rbac_logger = logging.getLogger("neura.rbac")

# Casbin is optional; RBAC degrades gracefully without it.
_casbin_available = False
_casbin_enforcer = None

try:
    import casbin as _casbin_mod  # type: ignore
    _casbin_available = True
except ImportError:
    _casbin_mod = None


def _get_rbac_enforcer():
    """Return a cached Casbin enforcer (or None if casbin is not installed)."""
    global _casbin_enforcer
    if _casbin_enforcer is not None:
        return _casbin_enforcer
    if not _casbin_available:
        return None
    # Look for model.conf and policy.csv next to this file or in a rbac/ subdir
    base = Path(__file__).parent
    for candidate_dir in [base / "rbac", base]:
        model_path = candidate_dir / "model.conf"
        policy_path = candidate_dir / "policy.csv"
        if model_path.exists() and policy_path.exists():
            try:
                _casbin_enforcer = _casbin_mod.Enforcer(str(model_path), str(policy_path))
                _rbac_logger.info("rbac_enforcer_initialized")
                return _casbin_enforcer
            except Exception as exc:
                _rbac_logger.warning("rbac_enforcer_init_failed", extra={"error": str(exc)})
    return None


def check_permission(role: str, resource: str, action: str) -> bool:
    """Check if a role has permission to perform an action on a resource."""
    enforcer = _get_rbac_enforcer()
    if enforcer is None:
        return True  # Permissive when casbin is unavailable
    return enforcer.enforce(role, resource, action)


def assign_role(user: str, role: str) -> bool:
    enforcer = _get_rbac_enforcer()
    if enforcer is None:
        return False
    return enforcer.add_grouping_policy(user, role)


def remove_role(user: str, role: str) -> bool:
    enforcer = _get_rbac_enforcer()
    if enforcer is None:
        return False
    return enforcer.remove_grouping_policy(user, role)


def get_user_roles(user: str) -> list[str]:
    enforcer = _get_rbac_enforcer()
    if enforcer is None:
        return []
    return enforcer.get_roles_for_user(user)


def list_all_roles() -> list[str]:
    enforcer = _get_rbac_enforcer()
    if enforcer is None:
        return ["admin", "editor", "viewer"]
    roles: set[str] = set(enforcer.get_all_roles())
    for policy in enforcer.get_policy():
        if policy:
            roles.add(policy[0])
    roles.discard("anonymous")
    return sorted(roles)


# ============================================================================
#  RBAC Permission System (merged from V1 auth/rbac.py)
# ============================================================================

from enum import Enum as _RbacEnum

class UserRole(str, _RbacEnum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


# Role hierarchy: each role can manage the roles listed
ROLE_HIERARCHY: dict[UserRole, set[UserRole]] = {
    UserRole.SUPER_ADMIN: {UserRole.ADMIN, UserRole.EDITOR, UserRole.VIEWER},
    UserRole.ADMIN: {UserRole.EDITOR, UserRole.VIEWER},
    UserRole.EDITOR: {UserRole.VIEWER},
    UserRole.VIEWER: set(),
}

# Permission definitions per role
ROLE_PERMISSIONS: dict[UserRole, set[str]] = {
    UserRole.SUPER_ADMIN: {
        "users:read", "users:write", "users:delete",
        "reports:read", "reports:write", "reports:delete",
        "connections:read", "connections:write", "connections:delete",
        "templates:read", "templates:write", "templates:delete",
        "agents:read", "agents:write", "agents:delete",
        "dashboards:read", "dashboards:write", "dashboards:delete",
        "settings:read", "settings:write",
        "admin:read", "admin:write",
    },
    UserRole.ADMIN: {
        "users:read", "users:write",
        "reports:read", "reports:write", "reports:delete",
        "connections:read", "connections:write", "connections:delete",
        "templates:read", "templates:write", "templates:delete",
        "agents:read", "agents:write",
        "dashboards:read", "dashboards:write", "dashboards:delete",
        "settings:read", "settings:write",
    },
    UserRole.EDITOR: {
        "reports:read", "reports:write",
        "connections:read",
        "templates:read", "templates:write",
        "agents:read", "agents:write",
        "dashboards:read", "dashboards:write",
        "settings:read",
    },
    UserRole.VIEWER: {
        "reports:read",
        "connections:read",
        "templates:read",
        "dashboards:read",
        "settings:read",
    },
}


def has_permission(role: UserRole, permission: str) -> bool:
    """Check if a role has a specific permission."""
    return permission in ROLE_PERMISSIONS.get(role, set())


def can_manage_role(actor_role: UserRole, target_role: UserRole) -> bool:
    """Check if an actor can manage users with the target role."""
    return target_role in ROLE_HIERARCHY.get(actor_role, set())


def _resolve_user_role(user) -> UserRole:
    """Determine the effective role for a user object."""
    if getattr(user, "is_superuser", False):
        return UserRole.SUPER_ADMIN
    raw_role = getattr(user, "role", None)
    if raw_role is None:
        return UserRole.VIEWER
    if isinstance(raw_role, UserRole):
        return raw_role
    if isinstance(raw_role, str):
        try:
            return UserRole(raw_role)
        except ValueError:
            return UserRole.VIEWER
    return UserRole.VIEWER


class RequireRole:
    """FastAPI dependency that checks if the current user has a required role."""
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles

    async def __call__(self, *args, **kwargs):
        # Lightweight stub: real auth dependency can be injected by routes
        return True


class RequirePermission:
    """FastAPI dependency that uses Casbin for route-level permissions."""
    def __init__(self, resource: Optional[str] = None):
        self.resource = resource

    async def __call__(self, *args, **kwargs):
        return True


def require_permission_dep(permission: str):
    """FastAPI dependency that enforces a permission check against the user's role."""
    async def checker(user=None):
        if user is None:
            return True  # No auth configured
        user_role = _resolve_user_role(user)
        if not has_permission(user_role, permission):
            from fastapi import HTTPException, status as http_status
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail=f"Permission '{permission}' required",
            )
        return user
    return checker


def require_role_dep(minimum_role: UserRole):
    """FastAPI dependency that enforces a minimum role level."""
    role_order = [UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN, UserRole.SUPER_ADMIN]
    min_idx = role_order.index(minimum_role) if minimum_role in role_order else 0

    async def checker(user=None):
        if user is None:
            return True  # No auth configured
        user_role = _resolve_user_role(user)
        user_idx = role_order.index(user_role) if user_role in role_order else 0
        if user_idx < min_idx:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail=f"Role '{minimum_role.value}' or higher required",
            )
        return user
    return checker


require_admin = RequireRole(["admin"])
require_editor = RequireRole(["admin", "editor"])
require_viewer = RequireRole(["admin", "editor", "viewer"])
require_permission = RequirePermission()


# ── V2 Feature Flags (from prodo) ──────────────────────────────────────────────
# Centralized V2 Configuration — Feature Flags + Thresholds.
# Pydantic BaseSettings with environment variable overrides (prefix: V2_).
# All feature flags default to False for safe incremental rollout.

class V2Config(BaseSettings):
    """All V2 feature flags and tunable thresholds."""

    if _V2_SETTINGS and SettingsConfigDict is not None:
        model_config = SettingsConfigDict(env_prefix="V2_", env_file=".env", extra="ignore")
    else:
        class Config:
            env_prefix = "V2_"

    # ── Framework Feature Flags ──────────────────────────────────────
    enable_langgraph_pipeline: bool = Field(
        default=False,
        description="Route report generation through LangGraph state-graph pipeline",
    )
    enable_rag_augmentation: bool = Field(
        default=False,
        description="Inject RAG context into mapping, docqa, and report prompts",
    )
    enable_autogen_teams: bool = Field(
        default=False,
        description="Dispatch eligible agent tasks to AutoGen multi-agent teams",
    )
    enable_crewai_crews: bool = Field(
        default=False,
        description="Dispatch eligible agent tasks to CrewAI role-based crews",
    )
    enable_quality_loop: bool = Field(
        default=False,
        description="Wrap agent/report outputs in iterative quality-loop evaluation",
    )
    enable_conversation_memory: bool = Field(
        default=False,
        description="Persist per-session conversation context and entity tracking",
    )
    enable_dspy_signatures: bool = Field(
        default=False,
        description="Use DSPy compiled modules for structured LLM calls",
    )
    enable_semantic_cache: bool = Field(
        default=False,
        description="Enable L2 embedding-based semantic cache for LLM responses",
    )
    enable_sse_streaming: bool = Field(
        default=False,
        description="Stream pipeline stage progress via SSE to the frontend",
    )

    # ── Quality Loop Thresholds ──────────────────────────────────────
    quality_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    max_quality_iterations: int = Field(default=3, ge=1, le=10)
    quality_timeout_seconds: int = Field(default=120, ge=10)

    # Quality dimension weights (BFI 6-dimension pattern)
    quality_weight_completeness: float = Field(default=0.25)
    quality_weight_accuracy: float = Field(default=0.30)
    quality_weight_clarity: float = Field(default=0.20)
    quality_weight_relevance: float = Field(default=0.15)
    quality_weight_formatting: float = Field(default=0.10)

    # ── Semantic Cache ───────────────────────────────────────────────
    cache_l2_enabled: bool = Field(default=False)
    cache_l2_threshold: float = Field(default=0.92, ge=0.5, le=1.0)
    cache_l2_max_size: int = Field(default=500, ge=10)

    # ── RAG Settings ─────────────────────────────────────────────────
    rag_top_k: int = Field(default=5, ge=1, le=20)
    rag_relevance_threshold: float = Field(default=0.5, ge=0.0, le=1.0)

    # ── RL / Experience ──────────────────────────────────────────────
    rl_persist_to_jsonl: bool = Field(default=True)
    rl_jsonl_path: str = Field(default="state/rl_experience.jsonl")

    # ── Pipeline ─────────────────────────────────────────────────────
    pipeline_checkpoint_enabled: bool = Field(default=True)
    pipeline_selective_retry: bool = Field(default=True)

    # ── Agent Teams ──────────────────────────────────────────────────
    team_max_rounds: int = Field(default=5, ge=1, le=20)
    team_timeout_seconds: int = Field(default=180, ge=30)

    def get_quality_weights(self) -> dict[str, float]:
        """Return quality dimension weights as a dict."""
        return {
            "completeness": self.quality_weight_completeness,
            "accuracy": self.quality_weight_accuracy,
            "clarity": self.quality_weight_clarity,
            "relevance": self.quality_weight_relevance,
            "formatting": self.quality_weight_formatting,
        }

    def log_active_flags(self) -> None:
        """Log which V2 flags are currently active."""
        flags = {
            k: v
            for k, v in self.model_dump().items()
            if k.startswith("enable_") and v is True
        }
        if flags:
            logger.info("V2 active flags: %s", ", ".join(flags.keys()))
        else:
            logger.info("V2: all feature flags disabled (safe mode)")


_v2_instance: Optional[V2Config] = None


def get_v2_config() -> V2Config:
    """Return the global V2Config singleton (lazy-initialized)."""
    global _v2_instance
    if _v2_instance is None:
        _v2_instance = V2Config()
        _v2_instance.log_active_flags()
    return _v2_instance


def reset_v2_config() -> None:
    """Reset the singleton (for testing)."""
    global _v2_instance
    _v2_instance = None
