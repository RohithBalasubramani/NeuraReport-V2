from __future__ import annotations

"""Legacy services -- V1 production code consolidated into single module.

This file contains the complete legacy service layer from NeuraReport V1,
organized by original source file with section markers.
All intra-legacy imports removed (functions coexist in this file).
Sections ordered: foundations first, consumers last.
"""

# ── Standard library imports ──────────────────────────────────────────────
import asyncio
import concurrent.futures
import contextlib
import ctypes
import difflib
import hashlib
import importlib
import json
import logging
import os
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, Mapping, Optional, Sequence, Tuple

# ── Third-party imports ───────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict
from starlette.background import BackgroundTask

# ── Legacy router stub (endpoints are defined in routes_a.py) ────────────
router = APIRouter()

# ── V2 internal imports ───────────────────────────────────────────────────
from backend.app.services.config import get_settings
get_api_settings = get_settings  # alias used by template_service

# Repositories (DB access, state store, data loaders)
from backend.app.repositories import (
    resolve_db_path, resolve_connection_ref, save_connection, verify_sqlite,
    get_loader, get_postgres_loader, verify_postgres,
    state_store,
)
# sqlite_shim: V1 used this as sqlite3-compatible namespace.
# V2 has Row/connect in repositories directly.
import backend.app.repositories as _repo_mod
class _SqliteShimNS:
    Row = _repo_mod.Row
    connect = staticmethod(_repo_mod.connect)
sqlite_shim = _SqliteShimNS

# Templates (verify, service, catalog, layout)
from backend.app.services.templates import (
    TemplateImportError, TemplateService,
    build_unified_template_catalog,
    pdf_page_count, pdf_to_pngs, render_html_to_png, render_panel_preview,
    request_fix_html, request_initial_html, save_html,
    get_layout_hints,
    MODEL, get_openai_client,
)
from backend.app.services.workflow_jobs_excel import xlsx_to_html_preview

# Infrastructure services (locks, artifacts, utils)
from backend.app.services.infra_services import (
    TemplateLockError, acquire_template_lock, get_correlation_id,
    validate_contract_schema, validate_mapping_schema,
    write_artifact_manifest, write_json_atomic, write_text_atomic,
    call_chat_completion, strip_code_fences,
    create_zip_from_dir,
    extract_json_object,
    _fix_fixed_footers,
)
from backend.app.services.infra_services import load_manifest

# AI services (LLM prompts, recommendations)
from backend.app.services.ai_services import (
    recommend_templates_from_catalog,
    PROMPT_VERSION, PROMPT_VERSION_3_5, PROMPT_VERSION_4,
)

# Re-exports expected by routes
from backend.app.schemas import UnifiedChatPayload
from backend.app.services.scheduler import JobRunTracker

# Reports (render strategies, fill_and_print)
from backend.app.services.reports import (
    build_notification_strategy_registry, build_render_strategy_registry,
    ReportGenerate, ReportGenerateExcel,
    pdf_file_to_docx,
)

# Schemas
from backend.app.schemas import RunPayload

# Scheduler (job tracking)
from backend.app.services.scheduler import (
    DEFAULT_JOB_STEP_PROGRESS, JobRunTracker,
    _build_job_steps, _step_progress_from_steps,
    is_retriable_error,
)
# send_job_webhook_sync may not exist; lazy import it
def _get_send_job_webhook_sync():
    try:
        from backend.app.services.scheduler import send_job_webhook_sync as fn
        return fn
    except ImportError:
        return None

# Contract builder
from backend.app.services.contract_builder import (
    ContractBuilderError, build_or_load_contract_v2,
)

# Generator assets (excel workflow)
from backend.app.services.workflow_jobs_excel import (
    GeneratorAssetsError, build_generator_assets_from_payload,
)

# Mapping service -- lazy imports to avoid circular dependency
# (mapping_service.py imports get_loader_for_ref from this file)
def _lazy_mapping_service():
    import backend.app.services.mapping_service as m
    return m

class _MappingServiceProxy:
    """Lazy proxy to break circular import with mapping_service."""
    def __getattr__(self, name):
        return getattr(_lazy_mapping_service(), name)

_ms = _MappingServiceProxy()

# Re-export names at module level (resolved on first access)
class MappingInlineValidationError(RuntimeError): pass  # placeholder
class CorrectionsPreviewError(RuntimeError): pass  # placeholder

def _init_mapping_service_names():
    """Replace placeholders with real classes after import completes."""
    global MappingInlineValidationError, CorrectionsPreviewError
    global run_llm_call_3, approval_errors, get_parent_child_info
    global REPORT_SELECTED_VALUE, _compute_db_signature_impl, corrections_preview_fn
    try:
        m = _lazy_mapping_service()
        MappingInlineValidationError = m.MappingInlineValidationError
        CorrectionsPreviewError = m.CorrectionsPreviewError
        run_llm_call_3 = m.run_llm_call_3
        approval_errors = m.approval_errors
        get_parent_child_info = m.get_parent_child_info
        REPORT_SELECTED_VALUE = m.REPORT_SELECTED_VALUE
        _compute_db_signature_impl = m._compute_db_signature
        corrections_preview_fn = m.run_corrections_preview
    except Exception:
        pass

# These will be populated by _init_mapping_service_names() after module loads
run_llm_call_3 = None
approval_errors = None
get_parent_child_info = None
REPORT_SELECTED_VALUE = "LATER_SELECTED"
_compute_db_signature_impl = None
corrections_preview_fn = None

# Utilities
from backend.app.utils import (
    Event, EventBus, logging_middleware, metrics_middleware,
    is_safe_name, normalize_email_targets,
)

logger = logging.getLogger(__name__)



# ==============================================================================
# SECTION: CORE CONFIG
# ==============================================================================

SETTINGS = get_settings()
APP_VERSION = SETTINGS.version
APP_COMMIT = SETTINGS.commit

UPLOAD_ROOT: Path = SETTINGS.uploads_root
EXCEL_UPLOAD_ROOT: Path = SETTINGS.excel_uploads_root


def get_settings():
    return SETTINGS




# ==============================================================================
# SECTION: SCHEMAS: connection_schema
# ==============================================================================

class TestPayload(BaseModel):
    db_url: Optional[str] = None
    db_type: Optional[str] = None
    database: Optional[str] = None


class ConnectionUpsertPayload(BaseModel):
    id: Optional[str] = None
    name: str
    db_type: str
    db_url: Optional[str] = None
    database: Optional[str] = None
    status: Optional[str] = None
    latency_ms: Optional[float] = None
    tags: Optional[list[str]] = None




# ==============================================================================
# SECTION: SCHEMAS: report_schema
# ==============================================================================

class ScheduleCreatePayload(BaseModel):
    template_id: str
    connection_id: str
    start_date: str
    end_date: str
    key_values: Optional[dict[str, Any]] = None
    batch_ids: Optional[list[str]] = None
    docx: bool = False
    xlsx: bool = False
    email_recipients: Optional[list[str]] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    frequency: str = "daily"
    interval_minutes: Optional[int] = None
    run_time: Optional[str] = None  # HH:MM (24h) — time of day to run
    name: Optional[str] = None
    active: bool = True


class ScheduleUpdatePayload(BaseModel):
    """All fields optional for partial updates."""
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    key_values: Optional[dict[str, Any]] = None
    batch_ids: Optional[list[str]] = None
    docx: Optional[bool] = None
    xlsx: Optional[bool] = None
    email_recipients: Optional[list[str]] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    frequency: Optional[str] = None
    interval_minutes: Optional[int] = None
    run_time: Optional[str] = None  # HH:MM (24h) — time of day to run
    active: Optional[bool] = None




# ==============================================================================
# SECTION: SCHEMAS: template_schema
# ==============================================================================

class TemplateManualEditPayload(BaseModel):
    html: str


class TemplateAiEditPayload(BaseModel):
    instructions: str
    html: Optional[str] = None


class MappingPayload(BaseModel):
    mapping: dict[str, str]
    connection_id: Optional[str] = None
    user_values_text: Optional[str] = None
    user_instructions: Optional[str] = None
    dialect_hint: Optional[str] = None
    catalog_allowlist: Optional[list[str]] = None
    params_spec: Optional[list[str]] = None
    sample_params: Optional[dict[str, Any]] = None
    generator_dialect: Optional[str] = None
    force_generator_rebuild: bool = False
    keys: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")


class GeneratorAssetsPayload(BaseModel):
    step4_output: Optional[dict[str, Any]] = None
    contract: Optional[dict[str, Any]] = None
    overview_md: Optional[str] = None
    final_template_html: Optional[str] = None
    reference_pdf_image: Optional[str] = None
    catalog: Optional[list[str]] = None
    dialect: Optional[str] = "duckdb"
    params: Optional[list[str]] = None
    sample_params: Optional[dict[str, Any]] = None
    force_rebuild: bool = False
    key_tokens: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")


class CorrectionsPreviewPayload(BaseModel):
    user_input: Optional[str] = ""
    page: int = 1
    mapping_override: Optional[dict[str, Any]] = None
    sample_tokens: Optional[list[str]] = None
    model_selector: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class TemplateRecommendPayload(BaseModel):
    requirement: str
    kind: Optional[str] = None
    domain: Optional[str] = None
    kinds: Optional[list[str]] = None
    domains: Optional[list[str]] = None
    schema_snapshot: Optional[dict[str, Any]] = None
    tables: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")


class TemplateRecommendation(BaseModel):
    template: dict[str, Any]
    explanation: str
    score: float


class TemplateRecommendResponse(BaseModel):
    recommendations: list[TemplateRecommendation]


class LastUsedPayload(BaseModel):
    connection_id: Optional[str] = None
    template_id: Optional[str] = None


class TemplateUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    status: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class TemplateChatMessage(BaseModel):
    """A single message in the template editing chat conversation."""
    role: str  # 'user' | 'assistant'
    content: str


class TemplateChatPayload(BaseModel):
    """Payload for conversational template editing."""
    messages: list[TemplateChatMessage]
    html: Optional[str] = None  # Current HTML state (optional, uses saved if not provided)

    model_config = ConfigDict(extra="allow")


class TemplateChatResponse(BaseModel):
    """Response from conversational template editing."""
    message: str  # Assistant's response message
    ready_to_apply: bool  # Whether LLM has gathered enough info to apply changes
    proposed_changes: Optional[list[str]] = None  # List of proposed changes when ready
    updated_html: Optional[str] = None  # The updated HTML if ready_to_apply is True
    follow_up_questions: Optional[list[str]] = None  # Questions to ask user if not ready


class TemplateCreateFromChatPayload(BaseModel):
    """Payload for creating a template from a chat conversation."""
    name: str
    html: str
    kind: str = "pdf"




# ==============================================================================
# SECTION: UTILS: schedule_utils
# ==============================================================================

_SCHEDULE_INTERVALS = {
    "hourly": 60,
    "six_hours": 360,
    "daily": 1440,
    "weekly": 10080,
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def resolve_schedule_interval(frequency: str, override: Optional[int]) -> int:
    if override and override > 0:
        return max(int(override), 5)
    if not frequency:
        return 60
    key = frequency.strip().lower()
    return _SCHEDULE_INTERVALS.get(key, 60)


def clean_key_values(raw: Optional[Mapping[str, Any]]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    if isinstance(raw, Mapping):
        for token, value in raw.items():
            name = str(token or "").strip()
            if not name or value is None:
                continue
            cleaned[name] = value
    return cleaned




# ==============================================================================
# SECTION: UTILS: email_utils
# ==============================================================================





# ==============================================================================
# SECTION: UTILS: mapping_utils
# ==============================================================================

_MAPPING_KEYS_FILENAME = "mapping_keys.json"


def mapping_keys_path(template_dir: Path) -> Path:
    return template_dir / _MAPPING_KEYS_FILENAME


def normalize_key_tokens(raw: Iterable[str] | None) -> list[str]:
    if raw is None:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized


def load_mapping_keys(template_dir: Path) -> list[str]:
    path = mapping_keys_path(template_dir)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if isinstance(data, dict):
        raw_keys = data.get("keys")
    elif isinstance(data, list):
        raw_keys = data
    else:
        raw_keys = None
    return normalize_key_tokens(raw_keys if isinstance(raw_keys, Iterable) else None)


def write_mapping_keys(template_dir: Path, keys: Iterable[str]) -> list[str]:
    normalized = normalize_key_tokens(keys)
    path = mapping_keys_path(template_dir)
    payload = {
        "keys": normalized,
        "updated_at": int(time.time()),
    }
    write_json_atomic(path, payload, ensure_ascii=False, indent=2, step="mapping_keys")
    return normalized




# ==============================================================================
# SECTION: UTILS: template_utils
# ==============================================================================

UPLOAD_KIND_PREFIXES: dict[str, str] = {
    "pdf": "/uploads",
    "excel": "/excel-uploads",
}


def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _build_upload_kind_bases() -> dict[str, tuple[Path, str]]:
    return {
        "pdf": (UPLOAD_ROOT.resolve(), UPLOAD_KIND_PREFIXES["pdf"]),
        "excel": (EXCEL_UPLOAD_ROOT.resolve(), UPLOAD_KIND_PREFIXES["excel"]),
    }


def _get_upload_kind_bases() -> dict[str, tuple[Path, str]]:
    """
    Resolve upload roots dynamically so tests can monkeypatch backend.api.UPLOAD_ROOT / EXCEL_UPLOAD_ROOT.
    """
    bases = _build_upload_kind_bases()
    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        return bases
    pdf_root = getattr(api_mod, "UPLOAD_ROOT", bases["pdf"][0])
    excel_root = getattr(api_mod, "EXCEL_UPLOAD_ROOT", bases["excel"][0])
    try:
        bases["pdf"] = (Path(pdf_root).resolve(), UPLOAD_KIND_PREFIXES["pdf"])
    except Exception:
        pass
    try:
        bases["excel"] = (Path(excel_root).resolve(), UPLOAD_KIND_PREFIXES["excel"])
    except Exception:
        pass
    return bases


_UPLOAD_KIND_BASES: dict[str, tuple[Path, str]] = _build_upload_kind_bases()
_TEMPLATE_ID_SAFE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,180}$")


def normalize_template_id(template_id: str) -> str:
    raw = str(template_id or "").strip()
    candidate = raw.replace("\\", "/").split("/")[-1].strip()
    if not candidate or candidate in {".", ".."}:
        raise _http_error(400, "invalid_template_id", "Invalid template_id format")
    normalized = candidate.lower()
    if _TEMPLATE_ID_SAFE_RE.fullmatch(normalized):
        return normalized
    try:
        return str(uuid.UUID(candidate))
    except (ValueError, TypeError):
        raise _http_error(400, "invalid_template_id", "Invalid template_id format")


def template_dir(template_id: str, *, must_exist: bool = True, create: bool = False, kind: str = "pdf") -> Path:
    normalized_kind = (kind or "pdf").lower()
    bases = _get_upload_kind_bases()
    if normalized_kind not in bases:
        raise _http_error(400, "invalid_template_kind", f"Unsupported template kind: {kind}")

    base_dir = bases[normalized_kind][0]
    tid = normalize_template_id(template_id)

    tdir = (base_dir / tid).resolve()
    if base_dir not in tdir.parents:
        raise _http_error(400, "invalid_template_path", "Invalid template_id path")

    if must_exist and not tdir.exists():
        raise _http_error(404, "template_not_found", "template_id not found")

    if create:
        tdir.mkdir(parents=True, exist_ok=True)

    return tdir


def artifact_url(path: Path | None) -> Optional[str]:
    if path is None:
        return None
    try:
        resolved = path.resolve()
    except Exception:
        return None
    if not resolved.exists():
        return None
    for base_dir, prefix in _get_upload_kind_bases().values():
        try:
            rel = resolved.relative_to(base_dir)
        except ValueError:
            continue
        return f"{prefix}/{rel.as_posix()}"
    return None


def manifest_endpoint(template_id: str, kind: str = "pdf") -> str:
    return (
        f"/excel/{template_id}/artifacts/manifest"
        if (kind or "pdf").lower() == "excel"
        else f"/templates/{template_id}/artifacts/manifest"
    )


def find_reference_pdf(template_dir_path: Path) -> Optional[Path]:
    for name in ("source.pdf", "upload.pdf", "template.pdf", "report.pdf"):
        candidate = template_dir_path / name
        if candidate.exists():
            return candidate
    return None


def find_reference_png(template_dir_path: Path) -> Optional[Path]:
    for name in ("report_final.png", "reference_p1.png", "render_p1.png"):
        candidate = template_dir_path / name
        if candidate.exists():
            return candidate
    return None




# ==============================================================================
# SECTION: UTILS: connection_utils
# ==============================================================================

def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _state_store():
    return state_store


class ConnectionRef:
    """Connection reference that's backward-compatible with Path for SQLite.

    Wraps either a SQLite path or PostgreSQL URL so that callers that do
    ``ref.exists()`` or ``str(ref)`` continue to work, while PostgreSQL-
    aware callers can check ``ref.is_postgresql`` and use ``ref.connection_url``.
    """

    def __init__(
        self,
        db_type: str = "sqlite",
        db_path: Path | None = None,
        connection_url: str | None = None,
        connection_id: str | None = None,
    ):
        self.db_type = db_type
        self._db_path = Path(db_path) if db_path else None
        self.connection_url = connection_url
        self.connection_id = connection_id

    @property
    def is_postgresql(self) -> bool:
        return self.db_type in ("postgresql", "postgres")

    def exists(self) -> bool:
        if self.is_postgresql:
            return True  # PostgreSQL connections are verified at save time
        return self._db_path.exists() if self._db_path else False

    def __str__(self) -> str:
        if self.is_postgresql:
            return self.connection_url or f"postgresql://{self.connection_id}"
        return str(self._db_path) if self._db_path else ""

    def __fspath__(self) -> str:
        """Allow use as os.fspath() for SQLite connections."""
        if self.is_postgresql:
            raise TypeError(
                "PostgreSQL connections don't have filesystem paths. "
                "Use connection_url or get_loader_for_ref() instead."
            )
        return str(self._db_path) if self._db_path else ""

    def __repr__(self) -> str:
        if self.is_postgresql:
            return f"ConnectionRef(postgresql, url={self.connection_url!r}, id={self.connection_id!r})"
        return f"ConnectionRef(sqlite, path={self._db_path!r}, id={self.connection_id!r})"

    @property
    def name(self) -> str:
        if self.is_postgresql:
            parts = (self.connection_url or "").split("/")
            return parts[-1] if parts else "postgresql"
        return self._db_path.name if self._db_path else ""

    @property
    def parent(self) -> Path:
        if self._db_path:
            return self._db_path.parent
        return Path(".")

    # --- Convenience: allow Path(ref) for SQLite ---
    def resolve(self) -> Path:
        if self.is_postgresql:
            raise TypeError("PostgreSQL connections don't have filesystem paths.")
        return self._db_path.resolve() if self._db_path else Path(".").resolve()


def get_loader_for_ref(ref):
    """Get the appropriate DataFrame loader for any connection type.

    Returns SQLiteDataFrameLoader for SQLite, PostgresDataFrameLoader for PostgreSQL.
    Accepts ConnectionRef, Path, or str.
    """
    if isinstance(ref, ConnectionRef) and ref.is_postgresql:
        from backend.app.repositories.dataframes.postgres_loader import get_postgres_loader
        return get_postgres_loader(ref.connection_url)
    else:
        from backend.app.repositories.dataframes.sqlite_loader import get_loader
        path = ref._db_path if isinstance(ref, ConnectionRef) else Path(ref)
        return get_loader(path)


def verify_connection(ref) -> None:
    """Verify a connection reference (SQLite file or PostgreSQL URL)."""
    if isinstance(ref, ConnectionRef) and ref.is_postgresql:
        from backend.app.repositories.dataframes.postgres_loader import verify_postgres
        verify_postgres(ref.connection_url)
    else:
        from backend.app.repositories.connections.db_connection import verify_sqlite
        path = ref._db_path if isinstance(ref, ConnectionRef) else Path(ref)
        verify_sqlite(path)


def display_name_for_path(db_path, db_type: str = "sqlite") -> str:
    if isinstance(db_path, ConnectionRef):
        return db_path.name
    base = Path(db_path).name if db_path else ""
    if db_type.lower() == "sqlite":
        return base
    return f"{db_type}:{base}"


def _resolve_ref_for_conn_id(conn_id: str) -> ConnectionRef | None:
    """Try to resolve a connection_id to a ConnectionRef using the new ref system."""
    try:
        ref = resolve_connection_ref(conn_id)
        if ref["db_type"] in ("postgresql", "postgres"):
            return ConnectionRef(
                db_type="postgresql",
                connection_url=ref["connection_url"],
                connection_id=conn_id,
            )
        elif ref.get("db_path"):
            return ConnectionRef(
                db_type="sqlite",
                db_path=ref["db_path"],
                connection_id=conn_id,
            )
    except Exception:
        pass
    return None


def db_path_from_payload_or_default(conn_id: Optional[str]) -> ConnectionRef:
    """
    Resolve a connection reference using the same precedence as the legacy api.py helper.
    Returns ConnectionRef (backward-compatible with Path for SQLite connections).
    """
    resolve_db_path_fn = resolve_db_path
    try:
        api_mod = importlib.import_module("backend.api")
        override = getattr(api_mod, "_db_path_from_payload_or_default", None)
        if override and override is not db_path_from_payload_or_default:
            result = override(conn_id)
            if isinstance(result, ConnectionRef):
                return result
            return ConnectionRef(db_type="sqlite", db_path=result, connection_id=conn_id)
        resolve_db_path_fn = getattr(api_mod, "resolve_db_path", resolve_db_path)
    except Exception:
        pass

    if conn_id:
        # Try the new resolve_connection_ref first (handles both SQLite and PostgreSQL)
        ref = _resolve_ref_for_conn_id(conn_id)
        if ref is not None:
            return ref

        # Legacy fallback: check secrets/records for database_path
        secrets = _state_store().get_connection_secrets(conn_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=conn_id)
        record = _state_store().get_connection_record(conn_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=conn_id)
        try:
            path = resolve_db_path_fn(connection_id=conn_id, db_url=None, db_path=None)
            return ConnectionRef(db_type="sqlite", db_path=path, connection_id=conn_id)
        except Exception:
            pass

    last_used = _state_store().get_last_used()
    if last_used.get("connection_id"):
        lu_conn_id = last_used["connection_id"]
        ref = _resolve_ref_for_conn_id(lu_conn_id)
        if ref is not None:
            return ref
        secrets = _state_store().get_connection_secrets(lu_conn_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=lu_conn_id)
        record = _state_store().get_connection_record(lu_conn_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=lu_conn_id)

    env_db = os.getenv("NR_DEFAULT_DB") or os.getenv("DB_PATH")
    if env_db:
        return ConnectionRef(db_type="sqlite", db_path=Path(env_db))

    latest = _state_store().get_latest_connection()
    if latest and latest.get("database_path"):
        return ConnectionRef(db_type="sqlite", db_path=Path(latest["database_path"]))

    raise _http_error(
        400,
        "db_missing",
        "No database configured. Connect once or set NR_DEFAULT_DB/DB_PATH env.",
    )




# ==============================================================================
# SECTION: UTILS: health_utils
# ==============================================================================

def check_fs_writable(root: Path) -> tuple[bool, str]:
    try:
        marker = root / ".healthcheck"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(str(time.time()))
        marker.unlink(missing_ok=True)
        return True, "ok"
    except Exception as exc:
        return False, "filesystem_check_failed"


def check_clock() -> tuple[bool, str]:
    try:
        now = time.time()
        if now <= 0:
            return False, "invalid_time"
        return True, "ok"
    except Exception as exc:  # pragma: no cover
        return False, "clock_check_failed"


def check_external_head(url: str, api_key: str | None) -> tuple[bool, str]:
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, method="HEAD")
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # pragma: no cover - network path optional
            status = getattr(resp, "status", resp.getcode())
            ok = 200 <= status < 400
            return ok, f"status={status}"
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path optional
        if exc.code in {401, 403, 405}:
            return True, f"status={exc.code}"
        return False, f"status={exc.code}"
    except Exception as exc:  # pragma: no cover - network path optional
        return False, "external_check_failed"


def health_response(request: Request, checks: Dict[str, Tuple[bool, str]]) -> JSONResponse:
    status_ok = all(ok for ok, _ in checks.values())
    correlation_id = getattr(request.state, "correlation_id", None)
    payload = {
        "status": "ok" if status_ok else "error",
        "checks": {name: {"ok": ok, "detail": detail} for name, (ok, detail) in checks.items()},
        "version": APP_VERSION,
        "commit": APP_COMMIT,
        "correlation_id": correlation_id,
    }
    return JSONResponse(status_code=200 if status_ok else 503, content=payload)




# ==============================================================================
# SECTION: FILE SERVICE: helpers
# ==============================================================================

_DEFAULT_VERIFY_PDF_BYTES: int | None = None
_TEMPLATE_ID_SAFE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,180}$")


def format_bytes(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} bytes"
    value = num_bytes / 1024
    unit = "KiB"
    if value >= 1024:
        value /= 1024
        unit = "MiB"
        if value >= 1024:
            value /= 1024
            unit = "GiB"
    human = f"{value:.1f}".rstrip("0").rstrip(".")
    return f"{human} {unit}"


def resolve_pdf_upload_limit(default: int | None = _DEFAULT_VERIFY_PDF_BYTES) -> int | None:
    if default is None:
        default = int(get_settings().max_verify_pdf_bytes)
    if default <= 0:
        return None
    return default


MAX_VERIFY_PDF_BYTES = resolve_pdf_upload_limit()


def slugify_template_name(value: str | None) -> str:
    raw = str(value or "").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw).strip("-")
    return slug[:60].strip("-")


def template_id_exists(template_id: str, *, kind: str = "pdf") -> bool:
    try:
        template_dir(template_id, must_exist=True, create=False, kind=kind)
        return True
    except HTTPException:
        return False


def generate_template_id(base_name: str | None = None, *, kind: str = "pdf") -> str:
    slug = slugify_template_name(base_name)
    if not slug:
        slug = "template"
    for _ in range(10):
        suffix = uuid.uuid4().hex[:6]
        candidate = f"{slug}-{suffix}"
        if _TEMPLATE_ID_SAFE_RE.fullmatch(candidate) and not template_id_exists(candidate, kind=kind):
            return candidate
    fallback = f"{slug}-{uuid.uuid4().hex[:10]}"
    if _TEMPLATE_ID_SAFE_RE.fullmatch(fallback) and not template_id_exists(fallback, kind=kind):
        return fallback
    return uuid.uuid4().hex


def http_error(status_code: int, code: str, message: str, details: str | None = None) -> HTTPException:
    payload = {"status": "error", "code": code, "message": message}
    if details:
        payload["details"] = details
    return HTTPException(status_code=status_code, detail=payload)


def template_history_path(template_dir_path: Path) -> Path:
    return template_dir_path / "template_history.json"


def _truncate_history(entries: list[dict], limit: int = 2) -> list[dict]:
    if limit <= 0:
        return []
    if len(entries) <= limit:
        return entries
    return entries[-limit:]


def read_template_history(template_dir_path: Path) -> list[dict]:
    path = template_history_path(template_dir_path)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, list):
        return []
    cleaned = [entry for entry in raw if isinstance(entry, dict)]
    return _truncate_history(cleaned)


def append_template_history_entry(template_dir_path: Path, entry: dict) -> list[dict]:
    history = read_template_history(template_dir_path)
    history.append(entry)
    history = _truncate_history(history)
    write_json_atomic(
        template_history_path(template_dir_path),
        history,
        ensure_ascii=False,
        indent=2,
        step="template_history",
    )
    return history


def load_template_generator_summary(template_id: str) -> dict[str, Any]:
    record = state_store.get_template_record(template_id) or {}
    generator = record.get("generator") or {}
    raw_summary = generator.get("summary") or {}
    if isinstance(raw_summary, dict):
        return dict(raw_summary)
    return {}


def update_template_generator_summary_for_edit(
    template_id: str,
    *,
    edit_type: str,
    notes: str | None = None,
) -> dict[str, Any]:
    summary = load_template_generator_summary(template_id)
    now_iso = utcnow_iso()
    summary["lastEditType"] = edit_type
    summary["lastEditAt"] = now_iso
    if notes is not None:
        summary["lastEditNotes"] = notes
    state_store.update_template_generator(template_id, summary=summary)
    return summary


def normalize_artifact_map(artifacts: Mapping[str, Any] | None, artifact_url_fn: Callable[[Path | str | None], Optional[str]] = artifact_url) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if not artifacts:
        return normalized
    for name, raw in artifacts.items():
        url = None
        if isinstance(raw, Path):
            url = artifact_url_fn(raw)
        elif isinstance(raw, str):
            url = raw if raw.startswith("/") else artifact_url_fn(Path(raw))
        if url:
            normalized[str(name)] = url
    return normalized


def resolve_template_kind(template_id: str) -> str:
    pass  # UPLOAD_KIND_PREFIXES defined in this file

    record = state_store.get_template_record(template_id) or {}
    kind = str(record.get("kind") or "").lower()
    if kind in UPLOAD_KIND_PREFIXES:
        return kind
    normalized = normalize_template_id(template_id)
    tdir = template_dir(normalized, kind="excel", must_exist=False, create=False)
    return "excel" if tdir.exists() else "pdf"


def ensure_template_exists(template_id: str, *, kind: str = "pdf") -> Path:
    return template_dir(template_id, must_exist=True, create=False, kind=kind)




# ==============================================================================
# SECTION: FILE SERVICE: edit
# ==============================================================================

def _summarize_html_diff(before: str, after: str) -> str:
    before_lines = (before or "").splitlines()
    after_lines = (after or "").splitlines()
    matcher = difflib.SequenceMatcher(None, before_lines, after_lines, autojunk=False)
    added = 0
    removed = 0
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("replace", "delete"):
            removed += i2 - i1
        if tag in ("replace", "insert"):
            added += j2 - j1
    parts: list[str] = []
    if added:
        parts.append(f"+{added} line{'s' if added != 1 else ''}")
    if removed:
        parts.append(f"-{removed} line{'s' if removed != 1 else ''}")
    if not parts:
        return "no line changes"
    return ", ".join(parts)


def _snapshot_final_html(template_dir_path: Path, final_path: Path, base_path: Path) -> str:
    if final_path.exists():
        source_path = final_path
    elif base_path.exists():
        source_path = base_path
    else:
        raise http_error(
            404,
            "template_html_missing",
            "Template HTML not found (report_final.html or template_p1.html).",
        )

    current_html = source_path.read_text(encoding="utf-8", errors="ignore")

    if source_path is base_path and not final_path.exists():
        write_text_atomic(final_path, current_html, encoding="utf-8", step="template_edit_seed_final")

    prev_path = template_dir_path / "report_final_prev.html"
    write_text_atomic(prev_path, current_html, encoding="utf-8", step="template_edit_prev")
    return current_html


def _build_template_html_response(
    *,
    template_id: str,
    kind: str,
    html: str,
    source: str,
    template_dir_path: Path,
    history: Optional[list[dict]] = None,
    summary: Optional[Mapping[str, Any]] = None,
    ai_summary: Optional[list[str]] = None,
    correlation_id: str | None = None,
    diff_summary: str | None = None,
) -> dict:
    prev_path = template_dir_path / "report_final_prev.html"
    effective_history = history if history is not None else read_template_history(template_dir_path)
    summary_payload = dict(summary or {})
    metadata = {
        "lastEditType": summary_payload.get("lastEditType"),
        "lastEditAt": summary_payload.get("lastEditAt"),
        "lastEditNotes": summary_payload.get("lastEditNotes"),
        "historyCount": len(effective_history),
    }
    result: dict[str, Any] = {
        "status": "ok",
        "template_id": template_id,
        "kind": kind,
        "html": html,
        "source": source,
        "can_undo": prev_path.exists(),
        "metadata": metadata,
        "history": effective_history,
    }
    if diff_summary is not None:
        result["diff_summary"] = diff_summary
    if ai_summary:
        result["summary"] = ai_summary
    if correlation_id:
        result["correlation_id"] = correlation_id
    return result


def _resolve_template_html_paths(template_id: str, *, kind: str) -> tuple[Path, Path, Path, str]:
    template_dir_path = template_dir(template_id, kind=kind)
    final_path = template_dir_path / "report_final.html"
    base_path = template_dir_path / "template_p1.html"
    if final_path.exists():
        return template_dir_path, final_path, base_path, "report_final"
    if base_path.exists():
        return template_dir_path, final_path, base_path, "template_p1"
    raise http_error(
        404,
        "template_html_missing",
        "Template HTML not found (report_final.html or template_p1.html). Run template verification first.",
    )


def _run_template_edit_llm(template_html: str, instructions: str, kind: str = "pdf") -> tuple[str, list[str]]:
    if not instructions or not str(instructions).strip():
        raise http_error(400, "missing_instructions", "instructions is required for AI template edit.")
    from backend.app.services.ai_services import (
        TEMPLATE_EDIT_PROMPT_VERSION,
        build_template_edit_prompt,
    )

    prompt_payload = build_template_edit_prompt(template_html, instructions, kind=kind)
    messages = prompt_payload.get("messages") or []
    if not messages:
        raise http_error(500, "prompt_build_failed", "Failed to build template edit prompt.")
    try:
        client = get_openai_client()
    except Exception as exc:
        logger.exception("LLM client is unavailable")
        raise http_error(503, "llm_unavailable", "LLM client is unavailable")

    try:
        response = call_chat_completion(client, model=MODEL, messages=messages, description=TEMPLATE_EDIT_PROMPT_VERSION)
    except Exception as exc:
        logger.exception("Template edit LLM call failed")
        raise http_error(502, "llm_call_failed", "Template edit LLM call failed")

    raw_text = (response.choices[0].message.content or "").strip()
    payload = extract_json_object(raw_text)
    if payload is None:
        logger.error("LLM did not return valid JSON: %s", raw_text[:500])
        raise http_error(502, "llm_invalid_response", "LLM did not return valid JSON")

    if not isinstance(payload, dict):
        raise http_error(502, "llm_invalid_response", "LLM response was not a JSON object.")

    updated_html = payload.get("updated_html")
    if not isinstance(updated_html, str) or not updated_html.strip():
        raise http_error(502, "llm_invalid_response", "LLM response missing 'updated_html' string.")

    summary_raw = payload.get("summary")
    summary: list[str] = []
    if isinstance(summary_raw, list):
        for item in summary_raw:
            text = str(item).strip()
            if text:
                summary.append(text)
    elif isinstance(summary_raw, str):
        text = summary_raw.strip()
        if text:
            summary.append(text)

    return updated_html, summary


def get_template_html(template_id: str, request: Request):
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path, final_path, base_path, source = _resolve_template_html_paths(template_id, kind=template_kind)
    active_path = final_path if source == "report_final" else base_path
    html_text = active_path.read_text(encoding="utf-8", errors="ignore")
    history = read_template_history(template_dir_path)
    summary = load_template_generator_summary(template_id)
    return _build_template_html_response(
        template_id=template_id,
        kind=template_kind,
        html=html_text,
        source=source,
        template_dir_path=template_dir_path,
        history=history,
        summary=summary,
        correlation_id=correlation_id,
    )


def edit_template_manual(template_id: str, payload: TemplateManualEditPayload, request: Request):
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path, final_path, base_path, _ = _resolve_template_html_paths(template_id, kind=template_kind)
    try:
        lock_ctx = acquire_template_lock(template_dir_path, "template_edit_manual", correlation_id)
    except TemplateLockError:
        raise http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        current_html = _snapshot_final_html(template_dir_path, final_path, base_path)

        new_html = payload.html or ""
        write_text_atomic(final_path, new_html, encoding="utf-8", step="template_edit_manual")
        diff_summary = _summarize_html_diff(current_html, new_html)

        notes = "Manual HTML edit via template editor"
        summary = update_template_generator_summary_for_edit(template_id, edit_type="manual", notes=notes)
        history_entry = {"timestamp": summary.get("lastEditAt") or None, "type": "manual", "notes": notes}
        history = append_template_history_entry(template_dir_path, history_entry)

    return _build_template_html_response(
        template_id=template_id,
        kind=template_kind,
        html=new_html,
        source="report_final",
        template_dir_path=template_dir_path,
        history=history,
        summary=summary,
        correlation_id=correlation_id,
        diff_summary=diff_summary,
    )


def edit_template_ai(template_id: str, payload: TemplateAiEditPayload, request: Request):
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path, final_path, base_path, _ = _resolve_template_html_paths(template_id, kind=template_kind)
    try:
        lock_ctx = acquire_template_lock(template_dir_path, "template_edit_ai", correlation_id)
    except TemplateLockError:
        raise http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        current_html = _snapshot_final_html(template_dir_path, final_path, base_path)

        llm_input_html = payload.html.strip() if isinstance(payload.html, str) and payload.html.strip() else current_html
        updated_html, change_summary = _run_template_edit_llm(llm_input_html, payload.instructions or "", kind=template_kind)
        write_text_atomic(final_path, updated_html, encoding="utf-8", step="template_edit_ai")
        diff_summary = _summarize_html_diff(current_html, updated_html)

        notes = "AI-assisted HTML edit via template editor"
        summary = update_template_generator_summary_for_edit(template_id, edit_type="ai", notes=notes)
        history_entry = {
            "timestamp": summary.get("lastEditAt") or None,
            "type": "ai",
            "notes": notes,
            "instructions": payload.instructions or "",
            "summary": change_summary,
        }
        history = append_template_history_entry(template_dir_path, history_entry)

    return _build_template_html_response(
        template_id=template_id,
        kind=template_kind,
        html=updated_html,
        source="report_final",
        template_dir_path=template_dir_path,
        history=history,
        summary=summary,
        ai_summary=change_summary,
        correlation_id=correlation_id,
        diff_summary=diff_summary,
    )


def undo_last_template_edit(template_id: str, request: Request):
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path = template_dir(template_id, kind=template_kind)
    final_path = template_dir_path / "report_final.html"
    prev_path = template_dir_path / "report_final_prev.html"

    if not prev_path.exists() or not prev_path.is_file():
        raise http_error(400, "no_previous_version", "No previous template version found to undo.")
    if not final_path.exists() or not final_path.is_file():
        raise http_error(404, "template_html_missing", "Current template HTML not found for undo.")

    try:
        lock_ctx = acquire_template_lock(template_dir_path, "template_edit_undo", correlation_id)
    except TemplateLockError:
        raise http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        tmp_path = template_dir_path / "report_final_undo_tmp.html"
        tmp_path.unlink(missing_ok=True)

        current_html = final_path.read_text(encoding="utf-8", errors="ignore")
        try:
            final_path.rename(tmp_path)
            prev_path.rename(final_path)
            tmp_path.rename(prev_path)
        except Exception as exc:
            with contextlib.suppress(Exception):
                if tmp_path.exists() and not final_path.exists():
                    tmp_path.rename(final_path)
            logger.exception("Failed to restore previous template version")
            raise http_error(500, "undo_failed", "Failed to restore previous template version")

        restored_html = final_path.read_text(encoding="utf-8", errors="ignore")
        diff_summary = _summarize_html_diff(current_html, restored_html)

        notes = "Undo last template HTML edit"
        summary = update_template_generator_summary_for_edit(template_id, edit_type="undo", notes=notes)
        history_entry = {"timestamp": summary.get("lastEditAt") or None, "type": "undo", "notes": notes}
        history = append_template_history_entry(template_dir_path, history_entry)

    return _build_template_html_response(
        template_id=template_id,
        kind=template_kind,
        html=restored_html,
        source="report_final",
        template_dir_path=template_dir_path,
        history=history,
        summary=summary,
        correlation_id=correlation_id,
        diff_summary=diff_summary,
    )


def _run_template_chat_llm(template_html: str, conversation_history: list[dict], kind: str = "pdf") -> dict:
    """
    Run the conversational template editing LLM.

    Returns a dict with:
        - message: str
        - ready_to_apply: bool
        - proposed_changes: list[str] | None
        - follow_up_questions: list[str] | None
        - updated_html: str | None
    """
    from backend.app.services.ai_services import (
        TEMPLATE_CHAT_PROMPT_VERSION,
        build_template_chat_prompt,
    )

    prompt_payload = build_template_chat_prompt(template_html, conversation_history, kind=kind)
    messages = prompt_payload.get("messages") or []
    if not messages:
        raise http_error(500, "prompt_build_failed", "Failed to build template chat prompt.")

    try:
        client = get_openai_client()
    except Exception as exc:
        logger.exception("LLM client is unavailable")
        raise http_error(503, "llm_unavailable", "LLM client is unavailable")

    try:
        response = call_chat_completion(
            client, model=MODEL, messages=messages, description=TEMPLATE_CHAT_PROMPT_VERSION
        )
    except Exception as exc:
        logger.exception("Template chat LLM call failed")
        raise http_error(502, "llm_call_failed", "Template chat LLM call failed")

    raw_text = (response.choices[0].message.content or "").strip()
    payload = extract_json_object(raw_text)
    if payload is None:
        # If JSON parsing fails, return a friendly error response
        return {
            "message": "I apologize, but I encountered an issue processing your request. Could you please rephrase or try again?",
            "ready_to_apply": False,
            "proposed_changes": None,
            "follow_up_questions": ["Could you describe what changes you'd like to make to the template?"],
            "updated_html": None,
        }

    if not isinstance(payload, dict):
        return {
            "message": "I apologize, but I encountered an issue. Could you please try again?",
            "ready_to_apply": False,
            "proposed_changes": None,
            "follow_up_questions": None,
            "updated_html": None,
        }

    return {
        "message": payload.get("message", ""),
        "ready_to_apply": bool(payload.get("ready_to_apply", False)),
        "proposed_changes": payload.get("proposed_changes"),
        "follow_up_questions": payload.get("follow_up_questions"),
        "updated_html": payload.get("updated_html"),
    }


def chat_template_edit(template_id: str, payload: TemplateChatPayload, request: Request):
    """
    Handle a conversational template editing request.

    This endpoint maintains a conversation with the user to gather requirements
    before applying changes to the template. The LLM will ask clarifying questions
    if needed, and only apply changes when it has enough information.
    """
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path, final_path, base_path, _ = _resolve_template_html_paths(template_id, kind=template_kind)

    # Get current HTML - use provided HTML or load from disk
    if payload.html and payload.html.strip():
        current_html = payload.html.strip()
    else:
        active_path = final_path if final_path.exists() else base_path
        current_html = active_path.read_text(encoding="utf-8", errors="ignore")

    # Convert messages to the format expected by the prompt builder
    conversation_history = [
        {"role": msg.role, "content": msg.content}
        for msg in payload.messages
    ]

    # Call the LLM
    llm_response = _run_template_chat_llm(current_html, conversation_history, kind=template_kind)

    result = {
        "status": "ok",
        "template_id": template_id,
        "message": llm_response["message"],
        "ready_to_apply": llm_response["ready_to_apply"],
        "proposed_changes": llm_response.get("proposed_changes"),
        "follow_up_questions": llm_response.get("follow_up_questions"),
        "correlation_id": correlation_id,
    }

    # If ready to apply, include the updated HTML
    if llm_response["ready_to_apply"] and llm_response.get("updated_html"):
        result["updated_html"] = llm_response["updated_html"]

    return result


def apply_chat_template_edit(template_id: str, html: str, request: Request):
    """
    Apply the HTML changes from a chat conversation.

    This is called after the user confirms they want to apply the proposed changes.
    """
    template_kind = resolve_template_kind(template_id)
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    template_dir_path, final_path, base_path, _ = _resolve_template_html_paths(template_id, kind=template_kind)

    try:
        lock_ctx = acquire_template_lock(template_dir_path, "template_edit_chat_apply", correlation_id)
    except TemplateLockError:
        raise http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        current_html = _snapshot_final_html(template_dir_path, final_path, base_path)

        new_html = html or ""
        write_text_atomic(final_path, new_html, encoding="utf-8", step="template_edit_chat_apply")
        diff_summary = _summarize_html_diff(current_html, new_html)

        notes = "AI chat-assisted HTML edit via template editor"
        summary = update_template_generator_summary_for_edit(template_id, edit_type="chat", notes=notes)
        history_entry = {
            "timestamp": summary.get("lastEditAt") or None,
            "type": "chat",
            "notes": notes,
        }
        history = append_template_history_entry(template_dir_path, history_entry)

    return _build_template_html_response(
        template_id=template_id,
        kind=template_kind,
        html=new_html,
        source="report_final",
        template_dir_path=template_dir_path,
        history=history,
        summary=summary,
        correlation_id=correlation_id,
        diff_summary=diff_summary,
    )


def _convert_sample_pdf_to_b64(pdf_bytes: bytes) -> str | None:
    """Convert raw PDF bytes to a base64-encoded PNG of the first page."""
    import tempfile
    import base64

    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not available — cannot render sample PDF")
        return None

    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)

        doc = fitz.open(tmp_path)
        zoom = 300 / 72.0  # 300 DPI
        mat = fitz.Matrix(zoom, zoom)
        page = doc[0]
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        doc.close()
        tmp_path.unlink(missing_ok=True)

        return base64.b64encode(png_bytes).decode("utf-8")
    except Exception:
        logger.exception("Failed to convert sample PDF to image")
        return None


def _run_template_chat_create_llm(
    conversation_history: list[dict],
    current_html: str | None = None,
    sample_image_b64: str | None = None,
    kind: str = "pdf",
) -> dict:
    """
    Run the conversational template creation LLM.

    Returns same shape as _run_template_chat_llm.
    """
    from backend.app.services.ai_services import (
        TEMPLATE_CHAT_CREATE_PROMPT_VERSION,
        build_template_chat_create_prompt,
    )

    prompt_payload = build_template_chat_create_prompt(
        conversation_history, current_html, sample_image_b64=sample_image_b64, kind=kind,
    )
    messages = prompt_payload.get("messages") or []
    if not messages:
        raise http_error(500, "prompt_build_failed", "Failed to build template chat create prompt.")

    try:
        client = get_openai_client()
    except Exception:
        logger.exception("LLM client is unavailable")
        raise http_error(503, "llm_unavailable", "LLM client is unavailable")

    try:
        response = call_chat_completion(
            client, model=MODEL, messages=messages, description=TEMPLATE_CHAT_CREATE_PROMPT_VERSION
        )
    except Exception:
        logger.exception("Template chat create LLM call failed")
        raise http_error(502, "llm_call_failed", "Template chat create LLM call failed")

    raw_text = (response.choices[0].message.content or "").strip()
    payload = extract_json_object(raw_text)
    if not isinstance(payload, dict):
        # Log the raw text so we can debug JSON parse failures
        logger.warning(
            "template_chat_create_json_parse_failed",
            extra={
                "event": "template_chat_create_json_parse_failed",
                "raw_text_length": len(raw_text),
                "raw_text_preview": raw_text[:500],
            },
        )
        # Fallback: if the LLM returned plain text (not JSON), use it as the message
        # This is better than showing "I apologize" — the LLM's text is still useful
        if raw_text and len(raw_text) > 20:
            return {
                "message": raw_text,
                "ready_to_apply": False,
                "proposed_changes": None,
                "follow_up_questions": None,
                "updated_html": None,
            }
        return {
            "message": "I apologize, but I encountered an issue processing your request. Could you please rephrase or try again?",
            "ready_to_apply": False,
            "proposed_changes": None,
            "follow_up_questions": ["Could you describe what kind of report template you need?"],
            "updated_html": None,
        }

    return {
        "message": payload.get("message", ""),
        "ready_to_apply": bool(payload.get("ready_to_apply", False)),
        "proposed_changes": payload.get("proposed_changes"),
        "follow_up_questions": payload.get("follow_up_questions"),
        "updated_html": payload.get("updated_html"),
    }


def chat_template_create(
    payload: TemplateChatPayload,
    request: Request,
    sample_pdf_bytes: bytes | None = None,
    kind: str = "pdf",
):
    """
    Handle a conversational template creation request (no template_id needed).

    The LLM will guide the user through creating a template from scratch.
    Optionally accepts a sample PDF (as raw bytes) for visual reference.
    """
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()

    current_html = (payload.html or "").strip() or None

    conversation_history = [
        {"role": msg.role, "content": msg.content}
        for msg in payload.messages
    ]

    # Convert sample PDF to base64 image if provided
    sample_image_b64 = None
    if sample_pdf_bytes:
        sample_image_b64 = _convert_sample_pdf_to_b64(sample_pdf_bytes)

    llm_response = _run_template_chat_create_llm(
        conversation_history, current_html, sample_image_b64=sample_image_b64, kind=kind,
    )

    result = {
        "status": "ok",
        "message": llm_response["message"],
        "ready_to_apply": llm_response["ready_to_apply"],
        "proposed_changes": llm_response.get("proposed_changes"),
        "follow_up_questions": llm_response.get("follow_up_questions"),
        "correlation_id": correlation_id,
    }

    if llm_response["ready_to_apply"] and llm_response.get("updated_html"):
        result["updated_html"] = llm_response["updated_html"]

    return result


def _classify_tokens_from_html(html: str) -> dict:
    """Classify tokens in HTML as scalars, row_tokens, or totals by structure.

    Tokens inside <tbody> <tr> rows → row_tokens.
    Tokens inside <tfoot> or rows with "total"/"sum" → totals.
    Everything else → scalars.
    Also recognizes BLOCK_REPEAT markers.
    """
    import re as _re
    _TOKEN_RE = _re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")
    _TR_RE = _re.compile(r"<tr\b[^>]*>(.*?)</tr>", _re.IGNORECASE | _re.DOTALL)
    _THEAD_RE = _re.compile(r"<thead\b[^>]*>.*?</thead>", _re.IGNORECASE | _re.DOTALL)
    _TFOOT_RE = _re.compile(r"<tfoot\b[^>]*>(.*?)</tfoot>", _re.IGNORECASE | _re.DOTALL)
    _TABLE_RE = _re.compile(r"<table\b[^>]*>(.*?)</table>", _re.IGNORECASE | _re.DOTALL)
    _BLOCK_SECTION_RE = _re.compile(
        r"<!--\s*BEGIN:BLOCK_REPEAT\b.*?-->(.+?)<!--\s*END:BLOCK_REPEAT\s*-->",
        _re.IGNORECASE | _re.DOTALL,
    )

    tokens_found = sorted(set(_TOKEN_RE.findall(html)))
    if not tokens_found:
        return {"scalars": [], "row_tokens": [], "totals": []}

    totals_tokens: set[str] = set()
    table_row_tokens: set[str] = set()

    # tfoot → totals
    for tfoot_match in _TFOOT_RE.finditer(html):
        for tok in _TOKEN_RE.findall(tfoot_match.group(1)):
            totals_tokens.add(tok)

    # tbody rows (excluding thead, tfoot)
    for table_match in _TABLE_RE.finditer(html):
        body_html = _THEAD_RE.sub("", table_match.group(1))
        body_html = _TFOOT_RE.sub("", body_html)
        for tr_match in _TR_RE.finditer(body_html):
            row_text = tr_match.group(1)
            row_lower = row_text.lower()
            for tok in _TOKEN_RE.findall(row_text):
                if tok in totals_tokens:
                    continue
                if "total" in row_lower or "grand" in row_lower or "sum" in row_lower:
                    totals_tokens.add(tok)
                else:
                    table_row_tokens.add(tok)

    # BLOCK_REPEAT sections → row_tokens
    for block_match in _BLOCK_SECTION_RE.finditer(html):
        for tok in _TOKEN_RE.findall(block_match.group(1)):
            if tok not in totals_tokens:
                table_row_tokens.add(tok)

    scalars, row_tokens, totals = [], [], []
    for tok in tokens_found:
        if tok in totals_tokens:
            totals.append(tok)
        elif tok in table_row_tokens:
            row_tokens.append(tok)
        else:
            scalars.append(tok)

    return {"scalars": scalars, "row_tokens": row_tokens, "totals": totals}


def create_template_from_chat(payload: TemplateCreateFromChatPayload, request: Request):
    """
    Persist a template created from the chat conversation.

    Creates the template directory, writes the HTML, and registers it in state.
    """
    import re
    pass  # state_access: use state_store
    pass  # normalize_template_id defined in this file

    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()

    name = (payload.name or "").strip()
    if not name:
        raise http_error(400, "missing_name", "Template name is required.")

    html = payload.html or ""
    kind = (payload.kind or "pdf").lower()
    if kind not in ("pdf", "excel"):
        raise http_error(400, "invalid_kind", "kind must be 'pdf' or 'excel'.")

    # Slugify name to template_id
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not slug:
        slug = "chat-template"
    template_id = normalize_template_id(slug)

    # Create directory
    template_dir_path = template_dir(template_id, kind=kind, must_exist=False, create=True)

    final_path = template_dir_path / "report_final.html"
    write_text_atomic(final_path, html, encoding="utf-8", step="create_template_from_chat")

    # Also write template_p1.html so the mapping pipeline can find it
    # (mapping preview/approve expect template_p1.html from the verify step)
    p1_path = template_dir_path / "template_p1.html"
    if not p1_path.exists():
        write_text_atomic(p1_path, html, encoding="utf-8", step="create_template_from_chat_p1")

    # Extract tokens from the HTML for metadata
    import re as _re
    _TOKEN_RE = _re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")
    _BLOCK_RE = _re.compile(r"<!--\s*BEGIN:BLOCK_REPEAT\b", _re.IGNORECASE)
    tokens_found = sorted(set(_TOKEN_RE.findall(html)))
    has_block_repeat = bool(_BLOCK_RE.search(html))

    # Classify tokens by HTML structure (reusable function)
    schema_ext = _classify_tokens_from_html(html)
    scalars = schema_ext["scalars"]
    row_tokens = schema_ext["row_tokens"]
    totals = schema_ext["totals"]
    schema_path = template_dir_path / "schema_ext.json"
    write_json_atomic(schema_path, schema_ext, indent=2, ensure_ascii=False, step="create_template_schema_ext")

    # --- Build page_summary.txt for the contract builder ---
    page_summary_lines = [
        f"Template: {name}",
        f"Type: {kind}",
        f"Created from: AI chat conversation",
        f"Total tokens: {len(tokens_found)}",
        f"  Scalars: {', '.join(scalars[:20]) if scalars else '(none)'}",
        f"  Row tokens: {', '.join(row_tokens[:20]) if row_tokens else '(none)'}",
        f"  Totals: {', '.join(totals[:10]) if totals else '(none)'}",
        f"Has block repeat: {has_block_repeat}",
    ]
    page_summary_path = template_dir_path / "page_summary.txt"
    write_text_atomic(
        page_summary_path,
        "\n".join(page_summary_lines),
        encoding="utf-8",
        step="create_template_page_summary",
    )

    # Register in state
    state_store.upsert_template(
        template_id,
        name=name,
        status="draft",
        artifacts={},
        template_type=kind,
    )

    # Write initial history
    notes = "Template created from AI chat conversation"
    summary = update_template_generator_summary_for_edit(template_id, edit_type="chat", notes=notes)
    history_entry = {
        "timestamp": summary.get("lastEditAt"),
        "type": "chat",
        "notes": notes,
    }
    append_template_history_entry(template_dir_path, history_entry)

    return {
        "status": "ok",
        "template_id": template_id,
        "name": name,
        "kind": kind,
        "tokens": tokens_found,
        "has_block_repeat": has_block_repeat,
        "schema": schema_ext,
        "correlation_id": correlation_id,
    }




# ==============================================================================
# SECTION: FILE SERVICE: generator
# ==============================================================================

def _state_store():
    return state_store


def generator_assets(template_id: str, payload: GeneratorAssetsPayload, request: Request, *, kind: str = "pdf"):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    logger.info(
        "generator_assets_v1_start",
        extra={
            "event": "generator_assets_v1_start",
            "template_id": template_id,
            "correlation_id": correlation_id,
            "force_rebuild": bool(payload.force_rebuild),
            "template_kind": kind,
        },
    )

    resolved_kind = resolve_template_kind(template_id) if kind == "pdf" else kind
    template_dir_path = template_dir(template_id, kind=resolved_kind)
    require_contract_join = (resolved_kind or "pdf").lower() != "excel"
    base_template_path = template_dir_path / "template_p1.html"
    final_template_path = template_dir_path / "report_final.html"
    contract_path = template_dir_path / "contract.json"
    overview_path = template_dir_path / "overview.md"
    step5_path = template_dir_path / "step5_requirements.json"

    def _load_step4_payload() -> dict[str, Any]:
        contract_payload = payload.step4_output.get("contract") if payload.step4_output else None
        overview_md = payload.step4_output.get("overview_md") if payload.step4_output else None
        step5_requirements = payload.step4_output.get("step5_requirements") if payload.step4_output else None

        if contract_payload is None:
            if payload.contract is not None:
                contract_payload = payload.contract
            elif contract_path.exists():
                contract_payload = json.loads(contract_path.read_text(encoding="utf-8"))
        if contract_payload is None:
            raise HTTPException(status_code=422, detail="Contract payload is required to build generator assets.")

        if overview_md is None:
            if payload.overview_md is not None:
                overview_md = payload.overview_md
            elif overview_path.exists():
                overview_md = overview_path.read_text(encoding="utf-8")

        if step5_requirements is None:
            if step5_path.exists():
                try:
                    step5_requirements = json.loads(step5_path.read_text(encoding="utf-8"))
                except Exception:
                    step5_requirements = {}
            else:
                step5_requirements = {}

        return {
            "contract": contract_payload,
            "overview_md": overview_md,
            "step5_requirements": step5_requirements or {},
        }

    step4_output = payload.step4_output or _load_step4_payload()

    if payload.final_template_html is not None:
        final_template_html = payload.final_template_html
    else:
        source_path = final_template_path if final_template_path.exists() else base_template_path
        if not source_path.exists():
            raise HTTPException(status_code=422, detail="Template HTML not found. Run mapping approval first.")
        final_template_html = source_path.read_text(encoding="utf-8", errors="ignore")

    catalog_allowlist = payload.catalog or None
    params_spec = payload.params or None
    sample_params = payload.sample_params or None
    dialect = payload.dialect or payload.dialect_hint or "duckdb"
    incoming_key_tokens = payload.key_tokens

    try:
        lock_ctx = acquire_template_lock(template_dir_path, "generator_assets_v1", correlation_id)
    except TemplateLockError:
        raise http_error(status_code=409, code="template_locked", message="Template is currently processing another request.")

    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        api_mod = None
    builder = getattr(api_mod, "build_generator_assets_from_payload", build_generator_assets_from_payload)

    def event_stream():
        started = time.time()

        def emit(event: str, **data: Any) -> bytes:
            return (json.dumps({"event": event, **data}, ensure_ascii=False) + "\n").encode("utf-8")

        with lock_ctx:
            yield emit(
                "stage",
                stage="generator_assets_v1",
                status="start",
                progress=10,
                template_id=template_id,
                correlation_id=correlation_id,
            )
            try:
                result = builder(
                    template_dir=template_dir_path,
                    step4_output=step4_output,
                    final_template_html=final_template_html,
                    reference_pdf_image=payload.reference_pdf_image,
                    catalog_allowlist=catalog_allowlist,
                    dialect=dialect,
                    params_spec=params_spec,
                    sample_params=sample_params,
                    force_rebuild=payload.force_rebuild,
                    key_tokens=incoming_key_tokens,
                    require_contract_join=require_contract_join,
                )
            except GeneratorAssetsError as exc:
                logger.warning(
                    "generator_assets_v1_failed",
                    extra={"event": "generator_assets_v1_failed", "template_id": template_id, "correlation_id": correlation_id},
                )
                yield emit("error", stage="generator_assets_v1", detail="Generator assets failed", template_id=template_id)
                return
            except Exception as exc:
                logger.exception(
                    "generator_assets_v1_unexpected",
                    extra={"event": "generator_assets_v1_unexpected", "template_id": template_id, "correlation_id": correlation_id},
                )
                yield emit("error", stage="generator_assets_v1", detail="Generator assets failed", template_id=template_id)
                return

            artifacts_urls = normalize_artifact_map(result.get("artifacts"))
            yield emit(
                "stage",
                stage="generator_assets_v1",
                status="done",
                progress=90,
                template_id=template_id,
                correlation_id=correlation_id,
                invalid=result.get("invalid"),
                needs_user_fix=result.get("needs_user_fix") or [],
                dialect=result.get("dialect"),
                params=result.get("params"),
                summary=result.get("summary"),
                dry_run=result.get("dry_run"),
                cached=result.get("cached"),
                artifacts=artifacts_urls,
            )

            manifest = load_manifest(template_dir_path) or {}
            manifest_url = manifest_endpoint(template_id, kind=resolved_kind)

            existing_tpl = _state_store().get_template_record(template_id) or {}
            artifacts_payload = {
                "contract_url": artifacts_urls.get("contract"),
                "generator_sql_pack_url": artifacts_urls.get("sql_pack"),
                "generator_output_schemas_url": artifacts_urls.get("output_schemas"),
                "generator_assets_url": artifacts_urls.get("generator_assets"),
                "manifest_url": manifest_url,
            }
            _state_store().upsert_template(
                template_id,
                name=existing_tpl.get("name") or f"Template {template_id[:8]}",
                status=existing_tpl.get("status") or "approved",
                artifacts={k: v for k, v in artifacts_payload.items() if v},
                connection_id=existing_tpl.get("last_connection_id"),
                template_type=resolved_kind,
            )
            _state_store().update_template_generator(
                template_id,
                dialect=result.get("dialect"),
                params=result.get("params"),
                invalid=bool(result.get("invalid")),
                needs_user_fix=result.get("needs_user_fix") or [],
                summary=result.get("summary"),
                dry_run=result.get("dry_run"),
            )

            yield emit(
                "result",
                template_id=template_id,
                invalid=result.get("invalid"),
                needs_user_fix=result.get("needs_user_fix") or [],
                dialect=result.get("dialect"),
                params=result.get("params"),
                summary=result.get("summary"),
                dry_run=result.get("dry_run"),
                cached=result.get("cached"),
                artifacts=artifacts_urls,
                manifest=manifest,
                manifest_url=manifest_url,
            )

            logger.info(
                "generator_assets_v1_complete",
                extra={
                    "event": "generator_assets_v1_complete",
                    "template_id": template_id,
                    "invalid": result.get("invalid"),
                    "needs_user_fix": len(result.get("needs_user_fix") or []),
                    "correlation_id": correlation_id,
                    "elapsed_ms": int((time.time() - started) * 1000),
                },
            )

    headers = {"Content-Type": "application/x-ndjson"}
    return StreamingResponse(event_stream(), headers=headers, media_type="application/x-ndjson")




# ==============================================================================
# SECTION: FILE SERVICE: verify
# ==============================================================================

MAX_VERIFY_XLSX_BYTES: int = 50 * 1024 * 1024  # 50 MiB

logger = logging.getLogger(__name__)


def _stable_token_signature(token_name: str, html: str, offset: int = 0) -> str:
    """Stable hash: grid-normalized position + name + parent element."""
    idx = html.find('{' + token_name + '}')
    if idx < 0:
        idx = html.find('{{' + token_name + '}}')
    if idx < 0:
        return ""
    # Get parent element tag (look backward for nearest <tag)
    parent = 'body'
    for i in range(idx, max(idx - 200, 0), -1):
        if html[i] == '<' and i + 1 < len(html) and html[i + 1:i + 2].isalpha():
            end = html.find(' ', i + 1)
            end2 = html.find('>', i + 1)
            parent = html[i + 1:min(end, end2) if end > 0 else end2]
            break
    raw = f"{idx // 8 * 8}:{token_name}:{parent}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def verify_template(file: UploadFile, connection_id: str | None, request: Request, refine_iters: int = 0, page: int = 0):
    original_filename = getattr(file, "filename", "") or ""
    template_name_hint = Path(original_filename).stem if original_filename else ""
    tid = generate_template_id(template_name_hint, kind="pdf")
    tdir = template_dir(tid, must_exist=False, create=True)
    pdf_path = tdir / "source.pdf"
    html_path = tdir / "template_p1.html"

    request_state = getattr(request, "state", None)
    correlation_id = getattr(request_state, "correlation_id", None) or get_correlation_id()

    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        api_mod = None
    pdf_page_count_fn = getattr(api_mod, "pdf_page_count", pdf_page_count)
    pdf_to_pngs_fn = getattr(api_mod, "pdf_to_pngs", pdf_to_pngs)
    request_initial_html_fn = getattr(api_mod, "request_initial_html", request_initial_html)
    save_html_fn = getattr(api_mod, "save_html", save_html)
    render_html_to_png_fn = getattr(api_mod, "render_html_to_png", render_html_to_png)
    render_panel_preview_fn = getattr(api_mod, "render_panel_preview", render_panel_preview)
    request_fix_html_fn = getattr(api_mod, "request_fix_html", request_fix_html)
    write_artifact_manifest_fn = getattr(api_mod, "write_artifact_manifest", write_artifact_manifest)
    get_layout_hints_fn = getattr(api_mod, "get_layout_hints", get_layout_hints)
    state_store_ref = getattr(api_mod, "state_store", state_store)

    def event_stream():
        pipeline_started = time.time()
        failed_error: str | None = None

        def emit(event: str, **payload):
            data = {"event": event, **payload}
            return (json.dumps(data, ensure_ascii=False) + "\n").encode("utf-8")

        stage_timings: dict[str, float] = {}

        def start_stage(stage_key: str, label: str, progress: int | float, **payload: Any) -> bytes:
            stage_timings[stage_key] = time.time()
            event_payload: dict[str, Any] = {
                "stage": stage_key,
                "label": label,
                "status": "started",
                "progress": progress,
                "template_id": tid,
            }
            if payload:
                event_payload.update(payload)
            return emit("stage", **event_payload)

        def finish_stage(
            stage_key: str,
            label: str,
            *,
            progress: int | float | None = None,
            status: str = "complete",
            **payload: Any,
        ) -> bytes:
            started = stage_timings.pop(stage_key, None)
            elapsed_ms = int((time.time() - started) * 1000) if started else None
            event_payload: dict[str, Any] = {
                "stage": stage_key,
                "label": label,
                "status": status,
                "template_id": tid,
            }
            if progress is not None:
                event_payload["progress"] = progress
            if elapsed_ms is not None:
                event_payload["elapsed_ms"] = elapsed_ms
            if payload:
                event_payload.update(payload)
            return emit("stage", **event_payload)

        try:
            stage_key = "verify.upload_pdf"
            stage_label = "Uploading your PDF"
            yield start_stage(stage_key, stage_label, progress=5)
            total_bytes = 0
            try:
                tmp = tempfile.NamedTemporaryFile(
                    dir=str(tdir),
                    prefix="source.",
                    suffix=".pdf.tmp",
                    delete=False,
                )
                try:
                    with tmp:
                        limit_bytes = MAX_VERIFY_PDF_BYTES
                        while True:
                            chunk = file.file.read(1024 * 1024)
                            if not chunk:
                                break
                            total_bytes += len(chunk)
                            if limit_bytes is not None and total_bytes > limit_bytes:
                                raise RuntimeError(f"Uploaded PDF exceeds {format_bytes(limit_bytes)} limit.")
                            tmp.write(chunk)
                        tmp.flush()
                        with contextlib.suppress(OSError):
                            os.fsync(tmp.fileno())
                    Path(tmp.name).replace(pdf_path)
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        Path(tmp.name).unlink(missing_ok=True)
            except Exception as exc:
                logger.exception("verify_upload_pdf_failed")
                yield finish_stage(
                    stage_key,
                    stage_label,
                    progress=5,
                    status="error",
                    detail="File upload failed",
                    size_bytes=total_bytes or None,
                )
                raise
            else:
                # Detect page count and emit with the upload-complete event
                total_pages = 1
                try:
                    total_pages = pdf_page_count_fn(pdf_path)
                except Exception:
                    pass
                yield finish_stage(
                    stage_key, stage_label, progress=20,
                    size_bytes=total_bytes,
                    page_count=total_pages,
                    selected_page=page,
                )

            stage_key = "verify.render_reference_preview"
            stage_label = "Rendering a preview image"
            yield start_stage(stage_key, stage_label, progress=25, page=page, page_count=total_pages)
            png_path: Path | None = None
            layout_hints: dict[str, Any] | None = None
            try:
                ref_pngs = pdf_to_pngs_fn(pdf_path, tdir, dpi=int(os.getenv("PDF_DPI", "400")), page=page)
                if not ref_pngs:
                    raise RuntimeError("No pages rendered from PDF")
                png_path = ref_pngs[0]
                layout_hints = get_layout_hints_fn(pdf_path, page)
            except Exception as exc:
                logger.exception("verify_render_reference_preview_failed")
                yield finish_stage(stage_key, stage_label, progress=25, status="error", detail="Rendering preview failed")
                raise
            else:
                yield finish_stage(stage_key, stage_label, progress=60)

            stage_key = "verify.generate_html"
            stage_label = "Converting preview to HTML"
            yield start_stage(stage_key, stage_label, progress=70)
            try:
                initial_result = request_initial_html_fn(png_path, None, layout_hints=layout_hints, pdf_path=pdf_path, page_index=page)
                html_text = initial_result.html
                schema_payload = initial_result.schema or {}
                save_html_fn(html_path, html_text)
            except Exception as exc:
                logger.exception("verify_generate_html_failed")
                yield finish_stage(stage_key, stage_label, progress=70, status="error", detail="HTML generation failed")
                raise

            # Extract tokens and compute stable signatures
            _tok_re = re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")
            extracted_tokens = sorted(set(_tok_re.findall(html_text)))
            token_signatures: dict[str, str] = {}
            for tok in extracted_tokens:
                token_signatures[tok] = _stable_token_signature(tok, html_text, 0)

            schema_path = tdir / "schema_ext.json"

            # If LLM schema has no row_tokens (common with filled PDFs), use
            # structural HTML analysis to classify tokens by position in the DOM.
            if not schema_payload:
                schema_payload = {}
            if not schema_payload.get("row_tokens"):
                structural = _classify_tokens_from_html(html_text)
                if structural.get("row_tokens") or structural.get("totals"):
                    schema_payload = {**schema_payload, **structural}
                    logger.info("verify_schema_structural_fallback", extra={
                        "row_tokens": len(structural.get("row_tokens", [])),
                        "totals": len(structural.get("totals", [])),
                    })

            if schema_payload:
                try:
                    write_json_atomic(
                        schema_path,
                        schema_payload,
                        indent=2,
                        ensure_ascii=False,
                        step="verify_schema_ext",
                    )
                except Exception:
                    pass
            else:
                with contextlib.suppress(FileNotFoundError):
                    schema_path.unlink()

            yield finish_stage(stage_key, stage_label, progress=78)

            render_png_path = tdir / "render_p1.png"
            tight_render_png_path = render_png_path
            stage_key = "verify.render_html_preview"
            stage_label = "Rendering the HTML preview"
            yield start_stage(stage_key, stage_label, progress=80)
            try:
                render_html_to_png_fn(html_path, render_png_path)
                panel_png_path = render_png_path.with_name("render_p1_llm.png")
                render_panel_preview_fn(html_path, panel_png_path, fallback_png=render_png_path)
                tight_render_png_path = panel_png_path if panel_png_path.exists() else render_png_path
                yield finish_stage(stage_key, stage_label, progress=88)
            except Exception as exc:
                logger.exception("verify_render_html_preview_failed")
                yield finish_stage(stage_key, stage_label, progress=80, status="error", detail="HTML preview rendering failed")
                raise

            stage_key = "verify.refine_html_layout"
            stage_label = "Refining HTML layout fidelity..."
            max_fix_passes = int(os.getenv("MAX_FIX_PASSES", "1"))
            fix_enabled = os.getenv("VERIFY_FIX_HTML_ENABLED", "true").lower() not in {
                "false",
                "0",
            }

            yield start_stage(
                stage_key,
                stage_label,
                progress=90,
                max_fix_passes=max_fix_passes,
                fix_enabled=fix_enabled,
            )

            fix_result: Optional[dict[str, Any]] = None
            render_after_path: Optional[Path] = None
            render_after_full_path: Optional[Path] = None
            metrics_path: Optional[Path] = None
            fix_attempted = fix_enabled and max_fix_passes > 0

            if fix_attempted:
                try:
                    fix_result = request_fix_html_fn(
                        tdir,
                        html_path,
                        schema_path if schema_payload else None,
                        png_path,
                        tight_render_png_path,
                        0.0,
                    )
                except Exception:
                    pass
                else:
                    render_after_path = fix_result.get("render_after_path")
                    render_after_full_path = fix_result.get("render_after_full_path")
                    metrics_path = fix_result.get("metrics_path")

            yield finish_stage(
                stage_key,
                stage_label,
                progress=96,
                skipped=not fix_attempted,
                fix_attempted=fix_attempted,
                fix_accepted=bool(fix_result and fix_result.get("accepted")),
                render_after=artifact_url(render_after_path) if render_after_path else None,
                render_after_full=artifact_url(render_after_full_path) if render_after_full_path else None,
                metrics=artifact_url(metrics_path) if metrics_path else None,
            )

            schema_url = artifact_url(schema_path) if schema_payload else None
            render_url = artifact_url(tight_render_png_path)
            render_after_url = artifact_url(render_after_path) if render_after_path else None
            render_after_full_url = artifact_url(render_after_full_path) if render_after_full_path else None
            metrics_url = artifact_url(metrics_path) if metrics_path else None

            manifest_files: dict[str, Path] = {
                "source.pdf": pdf_path,
                "reference_p1.png": png_path,
                "template_p1.html": html_path,
                "render_p1.png": render_png_path,
            }
            if tight_render_png_path and tight_render_png_path.exists():
                manifest_files["render_p1_llm.png"] = tight_render_png_path
            if schema_payload:
                manifest_files["schema_ext.json"] = schema_path
            if render_after_path:
                manifest_files["render_p1_after.png"] = render_after_path
            if render_after_full_path:
                manifest_files["render_p1_after_full.png"] = render_after_full_path
            if metrics_path:
                manifest_files["fix_metrics.json"] = metrics_path

            stage_key = "verify.save_artifacts"
            stage_label = "Saving verification artifacts"
            yield start_stage(stage_key, stage_label, progress=97)
            try:
                write_artifact_manifest_fn(
                    tdir,
                    step="templates_verify",
                    files=manifest_files,
                    inputs=[str(pdf_path)],
                    correlation_id=correlation_id,
                )
            except Exception as exc:
                logger.exception("verify_save_artifacts_failed")
                yield finish_stage(stage_key, stage_label, progress=97, status="error", detail="Saving artifacts failed")
            else:
                yield finish_stage(
                    stage_key,
                    stage_label,
                    progress=99,
                    manifest_files=len(manifest_files),
                    schema_url=schema_url,
                    render_url=render_url,
                    render_after_url=render_after_url,
                    render_after_full_url=render_after_full_url,
                    metrics_url=metrics_url,
                )

            template_name = template_name_hint or f"Template {tid[:8]}"
            artifacts_for_state = {
                "template_html_url": artifact_url(html_path),
                "thumbnail_url": artifact_url(png_path),
                "pdf_url": artifact_url(pdf_path),
                "manifest_url": manifest_endpoint(tid, kind="pdf"),
            }
            if schema_url:
                artifacts_for_state["schema_ext_url"] = schema_url
            if render_url:
                artifacts_for_state["render_png_url"] = render_url
            if render_after_url:
                artifacts_for_state["render_after_png_url"] = render_after_url
            if render_after_full_url:
                artifacts_for_state["render_after_full_png_url"] = render_after_full_url
            if metrics_url:
                artifacts_for_state["fix_metrics_url"] = metrics_url

            state_store_ref.upsert_template(
                tid,
                name=template_name,
                status="draft",
                artifacts=artifacts_for_state,
                connection_id=connection_id or None,
                template_type="pdf",
            )
            state_store_ref.set_last_used(connection_id or None, tid)

            total_elapsed_ms = int((time.time() - pipeline_started) * 1000)
            yield emit(
                "result",
                stage="Verification complete.",
                progress=100,
                template_id=tid,
                schema=schema_payload,
                elapsed_ms=total_elapsed_ms,
                artifacts=artifacts_for_state,
                page_count=total_pages,
                selected_page=page,
                tokens=[{"name": t, "stable_signature": token_signatures.get(t, "")} for t in extracted_tokens],
                lineage={
                    "source_file": original_filename,
                    "extraction_method": "qwen_vision",
                    "transformations": ["pdf_to_png", "vision_ocr", "html_generation"],
                },
                token_signatures=token_signatures,
            )
        except Exception as e:
            logger.exception("verify_template_failed")
            failed_error = "Verification failed"
            yield emit(
                "error",
                stage="Verification failed.",
                detail="Verification failed",
                template_id=tid,
            )
        finally:
            with contextlib.suppress(Exception):
                file.file.close()
            if failed_error:
                try:
                    template_name = template_name_hint or f"Template {tid[:8]}"
                    state_store_ref.upsert_template(
                        tid,
                        name=template_name,
                        status="failed",
                        artifacts={},
                        connection_id=connection_id or None,
                        template_type="pdf",
                        description=failed_error,
                    )
                except Exception:
                    pass
                with contextlib.suppress(Exception):
                    shutil.rmtree(tdir, ignore_errors=True)

    headers = {"Content-Type": "application/x-ndjson"}
    return StreamingResponse(event_stream(), headers=headers, media_type="application/x-ndjson")


def verify_excel(file: UploadFile, request: Request, connection_id: str | None = None):
    template_kind = "excel"
    original_filename = getattr(file, "filename", "") or ""
    template_name_hint = Path(original_filename).stem if original_filename else ""
    tid = generate_template_id(template_name_hint or "Workbook", kind=template_kind)
    tdir = template_dir(tid, must_exist=False, create=True, kind=template_kind)
    xlsx_path = tdir / "source.xlsx"

    request_state = getattr(request, "state", None)
    correlation_id = getattr(request_state, "correlation_id", None) or get_correlation_id()

    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        api_mod = None
    write_artifact_manifest_fn = getattr(api_mod, "write_artifact_manifest", write_artifact_manifest)
    state_store_ref = getattr(api_mod, "state_store", state_store)

    def event_stream():
        pipeline_started = time.time()
        failed_error: str | None = None

        def emit(event: str, **payload):
            data = {"event": event, **payload}
            return (json.dumps(data, ensure_ascii=False) + "\n").encode("utf-8")

        stage_timings: dict[str, float] = {}

        def start_stage(stage_key: str, label: str, progress: int | float, **payload: Any) -> bytes:
            stage_timings[stage_key] = time.time()
            event_payload = {
                "stage": stage_key,
                "label": label,
                "status": "started",
                "progress": progress,
                "template_id": tid,
                "kind": template_kind,
            }
            if payload:
                event_payload.update(payload)
            return emit("stage", **event_payload)

        def finish_stage(
            stage_key: str,
            label: str,
            *,
            progress: int | float | None = None,
            status: str = "complete",
            **payload: Any,
        ) -> bytes:
            started = stage_timings.pop(stage_key, None)
            elapsed_ms = int((time.time() - started) * 1000) if started else None
            event_payload = {
                "stage": stage_key,
                "label": label,
                "status": status,
                "template_id": tid,
                "kind": template_kind,
            }
            if progress is not None:
                event_payload["progress"] = progress
            if elapsed_ms is not None:
                event_payload["elapsed_ms"] = elapsed_ms
            if payload:
                event_payload.update(payload)
            return emit("stage", **event_payload)

        try:
            stage_key = "excel.upload_file"
            stage_label = "Uploading your workbook"
            yield start_stage(stage_key, stage_label, progress=5)
            total_bytes = 0
            try:
                tmp = tempfile.NamedTemporaryFile(
                    dir=str(tdir),
                    prefix="source.",
                    suffix=".xlsx.tmp",
                    delete=False,
                )
                try:
                    with tmp:
                        while True:
                            chunk = file.file.read(1024 * 1024)
                            if not chunk:
                                break
                            total_bytes += len(chunk)
                            if total_bytes > MAX_VERIFY_XLSX_BYTES:
                                raise RuntimeError(f"Uploaded Excel file exceeds {format_bytes(MAX_VERIFY_XLSX_BYTES)} limit.")
                            tmp.write(chunk)
                        tmp.flush()
                        with contextlib.suppress(OSError):
                            os.fsync(tmp.fileno())
                    Path(tmp.name).replace(xlsx_path)
                finally:
                    with contextlib.suppress(FileNotFoundError):
                        Path(tmp.name).unlink(missing_ok=True)
            except Exception as exc:
                logger.exception("excel_upload_file_failed")
                yield finish_stage(stage_key, stage_label, progress=5, status="error", detail="File upload failed")
                raise
            else:
                yield finish_stage(stage_key, stage_label, progress=25, size_bytes=total_bytes)

            stage_key = "excel.generate_html"
            stage_label = "Building preview HTML"
            yield start_stage(stage_key, stage_label, progress=45)
            try:
                preview = xlsx_to_html_preview(xlsx_path, tdir)
                html_path = preview.html_path
                png_path = preview.png_path
            except Exception as exc:
                logger.exception("excel_generate_html_failed")
                yield finish_stage(stage_key, stage_label, progress=45, status="error", detail="HTML generation failed")
                raise
            else:
                yield finish_stage(stage_key, stage_label, progress=80)

            schema_path = tdir / "schema_ext.json"
            sample_rows_path = tdir / "sample_rows.json"
            reference_html_path = tdir / "reference_p1.html"
            reference_png_path = tdir / "reference_p1.png"
            manifest_files: dict[str, Path] = {"source.xlsx": xlsx_path, "template_p1.html": html_path}
            if png_path and png_path.exists():
                manifest_files[png_path.name] = png_path
            if reference_png_path.exists():
                manifest_files[reference_png_path.name] = reference_png_path
            if sample_rows_path.exists():
                manifest_files[sample_rows_path.name] = sample_rows_path
            if reference_html_path.exists():
                manifest_files[reference_html_path.name] = reference_html_path
            if schema_path.exists():
                manifest_files[schema_path.name] = schema_path

            stage_key = "excel.save_artifacts"
            stage_label = "Saving verification artifacts"
            yield start_stage(stage_key, stage_label, progress=90)
            try:
                write_artifact_manifest_fn(
                    tdir,
                    step="excel_verify",
                    files=manifest_files,
                    inputs=[str(xlsx_path)],
                    correlation_id=correlation_id,
                )
            except Exception as exc:
                logger.exception("excel_save_artifacts_failed")
                yield finish_stage(stage_key, stage_label, progress=90, status="error", detail="Saving artifacts failed")
                raise
            else:
                yield finish_stage(stage_key, stage_label, progress=96, manifest_files=len(manifest_files))

            manifest_url = manifest_endpoint(tid, kind=template_kind)
            html_url = artifact_url(html_path)
            png_url = artifact_url(png_path)
            xlsx_url = artifact_url(xlsx_path)
            sample_rows_url = artifact_url(sample_rows_path) if sample_rows_path.exists() else None
            reference_html_url = artifact_url(reference_html_path) if reference_html_path.exists() else None
            reference_png_url = artifact_url(reference_png_path) if reference_png_path.exists() else None
            schema_url = artifact_url(schema_path) if schema_path.exists() else None

            template_display_name = template_name_hint or "Workbook"
            state_store_ref.upsert_template(
                tid,
                name=template_display_name,
                status="draft",
                artifacts={
                    "template_html_url": html_url,
                    "thumbnail_url": png_url,
                    "xlsx_url": xlsx_url,
                    "manifest_url": manifest_url,
                    **({"sample_rows_url": sample_rows_url} if sample_rows_url else {}),
                    **({"reference_html_url": reference_html_url} if reference_html_url else {}),
                    **({"reference_png_url": reference_png_url} if reference_png_url else {}),
                    **({"schema_ext_url": schema_url} if schema_url else {}),
                },
                connection_id=connection_id or None,
                template_type=template_kind,
            )
            state_store_ref.set_last_used(connection_id or None, tid)

            total_elapsed_ms = int((time.time() - pipeline_started) * 1000)
            yield emit(
                "result",
                stage="Excel verification complete.",
                progress=100,
                template_id=tid,
                kind=template_kind,
                schema=None,
                elapsed_ms=total_elapsed_ms,
                artifacts={
                    "xlsx_url": xlsx_url,
                    "png_url": png_url,
                    "html_url": html_url,
                    "manifest_url": manifest_url,
                    **({"sample_rows_url": sample_rows_url} if sample_rows_url else {}),
                    **({"reference_html_url": reference_html_url} if reference_html_url else {}),
                    **({"reference_png_url": reference_png_url} if reference_png_url else {}),
                    **({"schema_ext_url": schema_url} if schema_url else {}),
                },
            )
        except Exception as exc:
            logger.exception("excel_verify_failed")
            failed_error = "Excel verification failed"
            yield emit(
                "error",
                stage="Excel verification failed.",
                detail="Excel verification failed",
                template_id=tid,
                kind=template_kind,
            )
        finally:
            file.file.close()
            if failed_error:
                try:
                    template_display_name = template_name_hint or "Workbook"
                    state_store_ref.upsert_template(
                        tid,
                        name=template_display_name,
                        status="failed",
                        artifacts={},
                        connection_id=connection_id or None,
                        template_type=template_kind,
                        description=failed_error,
                    )
                except Exception:
                    pass
                with contextlib.suppress(Exception):
                    shutil.rmtree(tdir, ignore_errors=True)

    headers = {"Content-Type": "application/x-ndjson"}
    return StreamingResponse(event_stream(), headers=headers, media_type="application/x-ndjson")




# ==============================================================================
# SECTION: MAPPING: helpers
# ==============================================================================

_TOKEN_RE = re.compile(r"^\s*\{\{?.+?\}?\}\s*$")
_PARAM_REF_RE = re.compile(r"^params\.[A-Za-z_][\w]*$")
_DIRECT_COLUMN_RE = re.compile(
    r'''
    ["`\[]?
    (?P<table>[A-Za-z_][\w]*)
    ["`\]]?
    \.
    ["`\[]?
    (?P<column>[A-Za-z_][\w]*)
    ["`\]]?
    ''',
    re.VERBOSE,
)
_REPORT_DATE_PREFIXES = {"from", "to", "start", "end", "begin", "finish", "through", "thru"}
_REPORT_DATE_KEYWORDS = {"date", "dt", "day", "period", "range", "time", "timestamp", "window", "month", "year"}


def http_error(status_code: int, code: str, message: str, details: str | None = None) -> HTTPException:
    payload: dict[str, Any] = {"status": "error", "code": code, "message": message}
    if details:
        payload["details"] = details
    return HTTPException(status_code=status_code, detail=payload)


def load_json_file(path: Path) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_mapping_step3(template_dir_path: Path) -> tuple[Optional[dict[str, Any]], Path]:
    mapping_path = template_dir_path / "mapping_step3.json"
    return load_json_file(mapping_path), mapping_path


def sha256_path(path: Path | None) -> Optional[str]:
    if path is None or not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_schema_ext(template_dir_path: Path) -> Optional[dict[str, Any]]:
    schema_path = template_dir_path / "schema_ext.json"
    if not schema_path.exists():
        return None
    try:
        return json.loads(schema_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_catalog_from_db(db_path) -> list[str]:
    catalog: list[str] = []
    try:
        loader = get_loader_for_ref(db_path)
        for table in loader.table_names():
            # Use PRAGMA to get column names without loading any data.
            if hasattr(loader, 'column_names'):
                col_names = loader.column_names(table)
            else:
                col_names = [c for c, _ in loader.table_info(table)]
            for col_name in col_names:
                col_name = str(col_name or "").strip()
                if col_name:
                    catalog.append(f"{table}.{col_name}")
    except Exception as exc:
        logger.exception(
            "catalog_build_failed",
            extra={"event": "catalog_build_failed", "db_path": str(db_path)},
            exc_info=exc,
        )
        return []
    return catalog


_SKIP_COLS = {"__rowid__", "rowid"}


def build_rich_catalog_from_db(db_path) -> dict[str, list[dict[str, Any]]]:
    """Return ``{table: [{column, type, sample}, ...]}`` for LLM consumption.

    Unlike :func:`build_catalog_from_db` which returns a flat list of
    ``table.column`` strings, this function provides column data-types and a
    representative sample value so the LLM can make better mapping decisions
    without needing to execute SQL.
    """
    result: dict[str, list[dict[str, Any]]] = {}
    try:
        loader = get_loader_for_ref(db_path)
        for table in loader.table_names():
            # Use PRAGMA for column metadata; only load a small sample for sample values.
            info = loader.pragma_table_info(table) if hasattr(loader, 'pragma_table_info') else []
            cols: list[dict[str, Any]] = []
            # Load just 5 rows for sample values instead of entire table
            sample_df = None
            try:
                import sqlite3 as _sqlite3
                with _sqlite3.connect(str(loader.db_path), timeout=30) as _con:
                    quoted = table.replace('"', '""')
                    import pandas as pd
                    sample_df = pd.read_sql_query(f'SELECT * FROM "{quoted}" LIMIT 5', _con)
            except Exception:
                pass
            for col_info in info:
                col_name = col_info.get("name", "")
                if not col_name or col_name.lower() in _SKIP_COLS:
                    continue
                declared = (col_info.get("type") or "TEXT").upper()
                col_type = "TEXT"
                if "INT" in declared: col_type = "INTEGER"
                elif "REAL" in declared or "FLOAT" in declared: col_type = "REAL"
                elif "DATE" in declared or "TIME" in declared: col_type = "DATETIME"
                sample = ""
                if sample_df is not None and col_name in sample_df.columns:
                    non_null = sample_df[col_name].dropna()
                    if not non_null.empty:
                        sample = str(non_null.iloc[0])[:80]
                cols.append({"column": col_name, "type": col_type, "sample": sample})
            result[table] = cols
    except Exception as exc:
        logger.exception(
            "rich_catalog_build_failed",
            extra={"event": "rich_catalog_build_failed", "db_path": str(db_path)},
            exc_info=exc,
        )
        return {}
    return result


def format_catalog_rich(rich_catalog: dict[str, list[dict[str, Any]]]) -> str:
    """Format the rich catalog as human-readable text for LLM prompts.

    Example output::

        TABLE: transactions (11 columns)
          - transactions.id (INTEGER) sample: '1'
          - transactions.transaction_date (TEXT) sample: '2026-02-01'
    """
    lines: list[str] = []
    for table, columns in rich_catalog.items():
        lines.append(f"TABLE: {table} ({len(columns)} columns)")
        for col_info in columns:
            col = col_info["column"]
            ctype = col_info.get("type", "TEXT")
            sample = col_info.get("sample", "")
            sample_part = f" sample: '{sample}'" if sample else ""
            lines.append(f"  - {table}.{col} ({ctype}){sample_part}")
        lines.append("")
    return "\n".join(lines)


def compute_db_signature(db_path) -> Optional[str]:
    # PostgreSQL connections don't have a file-based signature
    if hasattr(db_path, 'is_postgresql') and db_path.is_postgresql:
        import hashlib as _hashlib
        return _hashlib.md5((db_path.connection_url or "").encode()).hexdigest()[:16]
    try:
        return _compute_db_signature_impl(db_path)
    except Exception:
        logger.exception("db_signature_failed", extra={"event": "db_signature_failed", "db_path": str(db_path)})
        return None


def normalize_artifact_map(artifacts: Mapping[str, Any] | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    if not artifacts:
        return normalized
    for name, raw in artifacts.items():
        url: Optional[str] = None
        if isinstance(raw, Path):
            url = artifact_url(raw)
        elif isinstance(raw, str):
            url = raw if raw.startswith("/") else artifact_url(Path(raw))
        else:
            continue
        if url:
            normalized[str(name)] = url
    return normalized


def token_parts_for_report_filters(token: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(token or "").lower())
    return [part for part in normalized.split("_") if part]


def is_report_generator_date_token_label(token: str) -> bool:
    parts = token_parts_for_report_filters(token)
    if not parts:
        return False
    has_prefix = any(part in _REPORT_DATE_PREFIXES for part in parts)
    has_keyword = any(part in _REPORT_DATE_KEYWORDS for part in parts)
    if has_prefix and has_keyword:
        return True
    if parts[0] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[1:]):
        return True
    if parts[-1] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[:-1]):
        return True
    return False


def norm_placeholder(name: str) -> str:
    if _TOKEN_RE.match(name):
        return name.strip()
    core = name.strip().strip("{} ")
    return "{" + core + "}"


def normalize_mapping_for_autofill(mapping: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    for k, v in mapping.items():
        mapping_value = v
        if isinstance(mapping_value, str) and is_report_generator_date_token_label(k):
            normalized_value = mapping_value.strip()
            lowered = normalized_value.lower()
            if not normalized_value:
                mapping_value = ""
            elif _PARAM_REF_RE.match(normalized_value) or lowered.startswith("to be selected"):
                mapping_value = REPORT_SELECTED_VALUE
            elif lowered == "input_sample":
                mapping_value = "INPUT_SAMPLE"
        out.append({"header": k, "placeholder": norm_placeholder(k), "mapping": mapping_value})
    return out


def normalize_tokens_request(tokens: str | None, keys_available: list[str]) -> list[str]:
    if not tokens:
        return list(keys_available)
    requested = [token.strip() for token in str(tokens).split(",") if token.strip()]
    return [token for token in requested if token in keys_available]


def build_mapping_lookup(mapping_doc: list[dict[str, Any]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for entry in mapping_doc:
        if not isinstance(entry, dict):
            continue
        header = entry.get("header")
        mapping_value = entry.get("mapping")
        if isinstance(header, str) and isinstance(mapping_value, str):
            lookup[header] = mapping_value.strip()
    return lookup


def extract_contract_metadata(contract_data: dict[str, Any]) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    required: dict[str, str] = {}
    optional: dict[str, str] = {}
    date_columns: dict[str, str] = {}
    filters_section = contract_data.get("filters") or {}
    if isinstance(filters_section, dict):
        required_map = filters_section.get("required") or {}
        optional_map = filters_section.get("optional") or {}
        if isinstance(required_map, dict):
            for key, expr in required_map.items():
                if isinstance(key, str) and isinstance(expr, str):
                    required[key] = expr.strip()
        if isinstance(optional_map, dict):
            for key, expr in optional_map.items():
                if isinstance(key, str) and isinstance(expr, str):
                    optional[key] = expr.strip()
    date_columns_section = contract_data.get("date_columns") or {}
    if isinstance(date_columns_section, dict):
        for table_name, column_name in date_columns_section.items():
            if not isinstance(table_name, str) or not isinstance(column_name, str):
                continue
            table_clean = table_name.strip(' "`[]').lower()
            column_clean = column_name.strip(' "`[]')
            if table_clean and column_clean:
                date_columns[table_clean] = column_clean
    return required, optional, date_columns


def resolve_token_binding(
    token: str,
    mapping_lookup: Mapping[str, str],
    contract_filters_required: Mapping[str, str],
    contract_filters_optional: Mapping[str, str],
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    expr = mapping_lookup.get(token, "")
    match = _DIRECT_COLUMN_RE.match(expr)
    if match:
        table_raw = match.group("table")
        column_raw = match.group("column")
        table_clean = table_raw.strip(' "`[]') if isinstance(table_raw, str) else ""
        column_clean = column_raw.strip(' "`[]') if isinstance(column_raw, str) else ""
        if table_clean and column_clean:
            return table_clean, column_clean, "mapping"
    filter_expr = contract_filters_required.get(token) or contract_filters_optional.get(token)
    if isinstance(filter_expr, str):
        match_filter = _DIRECT_COLUMN_RE.match(filter_expr)
        if match_filter:
            table_raw = match_filter.group("table")
            column_raw = match_filter.group("column")
            table_clean = table_raw.strip(' "`[]') if isinstance(table_raw, str) else ""
            column_clean = column_raw.strip(' "`[]') if isinstance(column_raw, str) else ""
            if table_clean and column_clean:
                return table_clean, column_clean, "contract_filter"
    return None, None, None


def execute_token_query_df(
    db_path,
    *,
    token: str,
    table_clean: str,
    column_clean: str,
    date_column_name: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    limit_value: int,
) -> tuple[list[str], dict[str, Any]]:
    """DataFrame-based replacement for execute_token_query — no SQL."""
    debug_info: dict[str, Any] = {
        "table": table_clean,
        "column": column_clean,
        "date_column": date_column_name,
        "applied_date_filters": False,
        "fallback_used": False,
        "error": None,
        "row_count": 0,
        "mode": "dataframe",
    }

    try:
        loader = get_loader_for_ref(db_path)
        # Pre-filter at SQL level when date column is known to avoid
        # loading millions of rows just for distinct key values.
        if date_column_name and (start_date or end_date) and hasattr(loader, 'frame_date_filtered'):
            df = loader.frame_date_filtered(table_clean, date_column_name, start_date, end_date)
            debug_info["mode"] = "dataframe_sql_prefiltered"
        else:
            df = loader.frame(table_clean)
    except Exception as exc:
        debug_info["error"] = f"Failed to load table: {exc}"
        return [], debug_info

    if df is None or df.empty or column_clean not in df.columns:
        debug_info["error"] = f"Column '{column_clean}' not found in table '{table_clean}'"
        return [], debug_info

    # Filter non-null, non-empty values
    filtered = df[df[column_clean].notna()]
    filtered = filtered[filtered[column_clean].astype(str).str.strip() != ""]

    # Apply DataFrame-level date filter as safety net (handles timezone stripping, snap, etc.)
    if date_column_name and start_date and end_date and date_column_name in df.columns:
        try:
            from backend.app.services.reports import _coerce_datetime_series, _parse_date_like, _snap_end_of_day
            start_dt = _parse_date_like(start_date)
            end_dt = _parse_date_like(end_date)
            if start_dt and end_dt:
                end_dt = _snap_end_of_day(end_dt)
                dt_series = _coerce_datetime_series(filtered[date_column_name])
                mask = (dt_series >= start_dt) & (dt_series <= end_dt)
                date_filtered = filtered.loc[mask.fillna(False)]
                debug_info["applied_date_filters"] = True
                if not date_filtered.empty:
                    filtered = date_filtered
                else:
                    debug_info["fallback_used"] = True
        except Exception:
            pass

    # Get distinct values
    unique_vals = filtered[column_clean].drop_duplicates().sort_values()
    rows = [str(v) for v in unique_vals.head(limit_value)]
    debug_info["row_count"] = len(rows)
    return rows, debug_info


def execute_token_query(
    con,
    *,
    token: str,
    table_clean: str,
    column_clean: str,
    date_column_name: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    limit_value: int,
) -> tuple[list[str], dict[str, Any]]:
    quoted_table = f'"{table_clean}"'
    quoted_column = f'"{column_clean}"'
    base_conditions = [f"{quoted_column} IS NOT NULL", f"TRIM(CAST({quoted_column} AS TEXT)) <> ''"]
    conditions = list(base_conditions)
    params: list[str] = []
    ident_re = re.compile(r"^[A-Za-z_][\w]*$")
    if date_column_name and ident_re.match(date_column_name):
        quoted_date_column = f'"{date_column_name}"'
        if start_date and end_date:
            # Snap date-only end_date to end-of-day so "2025-10-04" includes the whole day
            _end = end_date
            if isinstance(_end, str) and len(_end.strip()) == 10:
                _end = _end.strip() + " 23:59:59"
            conditions.append(f"{quoted_date_column} BETWEEN ? AND ?")
            params.extend([start_date, _end])
        elif start_date:
            conditions.append(f"{quoted_date_column} >= ?")
            params.append(start_date)
        elif end_date:
            conditions.append(f"{quoted_date_column} <= ?")
            params.append(end_date)

    debug_info: dict[str, Any] = {
        "table": table_clean,
        "column": column_clean,
        "date_column": date_column_name,
        "applied_date_filters": len(params) > 0,
        "sql": None,
        "params": None,
        "fallback_used": False,
        "error": None,
        "row_count": 0,
    }

    def run_query(where_clause: str, query_params: list[str]) -> tuple[list[str], Optional[str]]:
        sql = (
            f"SELECT DISTINCT {quoted_column} AS value FROM {quoted_table} "
            f"WHERE {where_clause} ORDER BY {quoted_column} ASC LIMIT ?"
        )
        params_with_limit = tuple(list(query_params) + [limit_value])
        try:
            rows = [
                str(row["value"]) for row in con.execute(sql, params_with_limit) if row and row["value"] is not None
            ]
            return rows, None
        except Exception as exc:
            logger.warning("token_query_execution_failed", extra={"error": str(exc)})
            return [], "Query execution failed"

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    rows, error = run_query(where_clause, params)
    debug_info.update({"sql": where_clause, "params": params, "row_count": len(rows)})
    if error:
        debug_info["error"] = error
    if not rows and params:
        fallback_clause = " AND ".join(base_conditions)
        fallback_rows, fallback_error = run_query(fallback_clause, [])
        debug_info["fallback_used"] = True
        debug_info["fallback_sql"] = fallback_clause
        debug_info["fallback_error"] = fallback_error
        if fallback_rows:
            rows = fallback_rows
            debug_info["row_count"] = len(rows)
            debug_info["error"] = fallback_error
    return rows, debug_info


def write_debug_log(template_id: str, *, kind: str, event: str, payload: Mapping[str, Any]) -> None:
    try:
        tdir = template_dir(template_id, kind=kind, must_exist=False, create=True)
        debug_dir = tdir / "_debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        filename = debug_dir / f"{event}-{timestamp}-{uuid.uuid4().hex[:6]}.json"
        write_json_atomic(
            filename,
            {
                "event": event,
                "timestamp": timestamp,
                "template_id": template_id,
                "template_kind": kind,
                **{k: v for k, v in payload.items()},
            },
            ensure_ascii=False,
            indent=2,
            step="debug_log",
        )
    except Exception:
        logger.exception(
            "debug_log_write_failed",
            extra={"event": "debug_log_write_failed", "template_id": template_id, "template_kind": kind},
        )


__all__ = [
    "http_error",
    "load_json_file",
    "load_mapping_step3",
    "sha256_path",
    "sha256_text",
    "load_schema_ext",
    "build_catalog_from_db",
    "build_rich_catalog_from_db",
    "format_catalog_rich",
    "compute_db_signature",
    "normalize_artifact_map",
    "normalize_mapping_for_autofill",
    "normalize_tokens_request",
    "build_mapping_lookup",
    "extract_contract_metadata",
    "resolve_token_binding",
    "execute_token_query",
    "execute_token_query_df",
    "write_debug_log",
    "load_mapping_keys",
    "mapping_keys_path",
    "normalize_key_tokens",
    "write_mapping_keys",
    "template_dir",
    "artifact_url",
    "find_reference_pdf",
    "find_reference_png",
]




# ==============================================================================
# SECTION: MAPPING: approve
# ==============================================================================


# Aliases for mapping/helpers functions used with underscored names
_build_catalog_from_db = build_catalog_from_db
_load_mapping_step3 = load_mapping_step3
_load_schema_ext = load_schema_ext
_normalize_artifact_map = normalize_artifact_map
_normalize_mapping_for_autofill = normalize_mapping_for_autofill

def _build_df_generator_assets(
    *,
    template_dir: Path,
    contract_path: Path,
    mapping_path: Path,
    dialect: str = "duckdb",
    key_tokens: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Build generator assets for the DataFrame pipeline (no SQL).

    Reads the existing contract, validates it, derives output_schemas
    (header/row/totals token lists), and writes metadata files that the
    dry-run verifier and report runner use.
    """
    from backend.app.services.infra_services import (
        write_json_atomic,
        write_artifact_manifest,
    )
    from backend.app.services.workflow_jobs_excel import (
        _derive_output_schemas,
        _normalized_tokens,
    )

    # ── 1. Load contract ──
    if not contract_path.exists():
        raise RuntimeError("contract.json not found — run contract build first")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))

    # ── 2. Validate contract structure (skip JSON schema — it's SQL-era
    #    and rejects dict-typed row_computed ops that DataFrames use) ──
    issues: list[str] = []
    tokens = contract.get("tokens") or {}
    if not tokens:
        issues.append("contract missing 'tokens' section")
    elif not tokens.get("scalars") and not tokens.get("row_tokens"):
        issues.append("contract has no scalar or row tokens")

    # ── 3. Validate DataFrame-specific fields ──
    reshape_rules = contract.get("reshape_rules") or []
    row_computed = contract.get("row_computed") or {}
    totals_math = contract.get("totals_math") or {}
    formatters = contract.get("formatters") or {}
    mapping = contract.get("mapping") or {}

    if not reshape_rules and not row_computed and not mapping:
        issues.append("contract has no mapping, reshape_rules, or row_computed — report may be empty")

    for alias, op in row_computed.items():
        if isinstance(op, dict):
            op_type = op.get("op")
            if not op_type:
                issues.append(f"row_computed.{alias}: missing 'op' field")
        elif not isinstance(op, (str, int, float)):
            issues.append(f"row_computed.{alias}: unexpected type {type(op).__name__}")

    for alias, op in totals_math.items():
        if isinstance(op, dict):
            op_type = op.get("op")
            if not op_type:
                issues.append(f"totals_math.{alias}: missing 'op' field")

    # ── 4. Derive output_schemas ──
    output_schemas = _derive_output_schemas(contract)

    # ── 5. Extract params from mapping ──
    required_params: list[str] = []
    for token, source in mapping.items():
        if isinstance(source, str) and source.startswith("PARAM:"):
            param_name = source[len("PARAM:"):].strip()
            if param_name and param_name not in required_params:
                required_params.append(param_name)
        elif isinstance(source, str) and source.startswith("params."):
            param_name = source[len("params."):].strip()
            if param_name and param_name not in required_params:
                required_params.append(param_name)

    key_tokens_list = _normalized_tokens(key_tokens)
    for kt in key_tokens_list:
        if kt not in required_params:
            required_params.append(kt)

    params = {"required": required_params, "optional": []}

    # ── 6. Write artifacts ──
    generator_dir = template_dir / "generator"
    generator_dir.mkdir(parents=True, exist_ok=True)

    output_schemas_path = generator_dir / "output_schemas.json"
    write_json_atomic(output_schemas_path, output_schemas, indent=2, ensure_ascii=False, step="df_generator_output_schemas")

    meta = {
        "dialect": dialect,
        "mode": "dataframe",
        "entrypoints": {},
        "params": params,
        "needs_user_fix": issues,
        "invalid": bool(issues),
        "summary": {
            "scalars": len(output_schemas.get("header", [])),
            "row_tokens": len(output_schemas.get("rows", [])),
            "totals": len(output_schemas.get("totals", [])),
            "reshape_rules": len(reshape_rules),
            "row_computed": len(row_computed),
            "totals_math": len(totals_math),
            "formatters": len(formatters),
        },
        "key_tokens": key_tokens_list,
    }
    meta_path = generator_dir / "generator_assets.json"
    write_json_atomic(meta_path, meta, indent=2, ensure_ascii=False, step="df_generator_assets_meta")

    write_artifact_manifest(
        template_dir,
        step="df_generator_assets",
        files={
            "contract.json": contract_path,
            "output_schemas.json": output_schemas_path,
            "generator_assets.json": meta_path,
        },
        inputs=["df_generator_assets"],
        correlation_id=None,
    )

    return {
        "mode": "dataframe",
        "output_schemas_url": artifact_url(output_schemas_path),
        "generator_assets_url": artifact_url(meta_path),
        "scalars": meta["summary"]["scalars"],
        "row_tokens": meta["summary"]["row_tokens"],
        "totals": meta["summary"]["totals"],
        "reshape_rules": meta["summary"]["reshape_rules"],
        "row_computed": meta["summary"]["row_computed"],
        "needs_user_fix": issues,
    }


async def run_mapping_approve(
    template_id: str,
    payload: Any,
    request: Request,
    *,
    kind: str = "pdf",
):
    correlation_id = getattr(request.state, "correlation_id", None)
    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        api_mod = None
    contract_builder = getattr(api_mod, "build_or_load_contract_v2", build_or_load_contract_v2)
    generator_builder = getattr(api_mod, "build_generator_assets_from_payload", build_generator_assets_from_payload)
    render_html_fn = getattr(api_mod, "render_html_to_png", render_html_to_png)
    render_panel_fn = getattr(api_mod, "render_panel_preview", render_panel_preview)
    logger.info(
        "mapping_approve_start",
        extra={
            "event": "mapping_approve_start",
            "template_id": template_id,
            "connection_id": payload.connection_id,
            "mapping_size": len(payload.mapping or {}),
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )

    template_dir_path = template_dir(template_id, kind=kind)
    require_contract_join = (kind or "pdf").lower() != "excel"
    base_template_path = template_dir_path / "template_p1.html"
    final_html_path = template_dir_path / "report_final.html"
    mapping_path = template_dir_path / "mapping_pdf_labels.json"
    mapping_keys_file = mapping_keys_path(template_dir_path)
    incoming_keys = normalize_key_tokens(payload.keys)
    mapping_dict = payload.mapping or {}
    keys_clean = [key for key in incoming_keys if key in mapping_dict]

    try:
        db_path = db_path_from_payload_or_default(payload.connection_id)
        verify_sqlite(db_path)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("approve_db_validation_failed")
        raise _http_error(400, "db_invalid", "Invalid database reference")

    schema_ext = _load_schema_ext(template_dir_path) or {}
    auto_mapping_doc, _ = _load_mapping_step3(template_dir_path)
    auto_mapping_proposal = auto_mapping_doc or {}
    catalog = list(dict.fromkeys(_build_catalog_from_db(db_path)))
    db_sig = compute_db_signature(db_path)

    try:
        lock_ctx = acquire_template_lock(template_dir_path, "mapping_approve", correlation_id)
    except TemplateLockError:
        raise _http_error(
            status_code=409,
            code="template_locked",
            message="Template is currently processing another request.",
        )

    def event_stream():
        pipeline_started = time.time()
        nonlocal keys_clean

        def log_stage(stage_name: str, status: str, started: float) -> None:
            logger.info(
                "mapping_approve_stage",
                extra={
                    "event": "mapping_approve_stage",
                    "template_id": template_id,
                    "stage": stage_name,
                    "status": status,
                    "elapsed_ms": int((time.time() - started) * 1000),
                    "correlation_id": correlation_id,
                },
            )

        def emit(event: str, **payload_data: Any) -> bytes:
            data = {"event": event, **payload_data}
            return (json.dumps(data, ensure_ascii=False) + "\n").encode("utf-8")

        stage_timings: dict[str, float] = {}

        def start_stage(stage_key: str, label: str, progress: int | float, **payload_data: Any) -> bytes:
            stage_timings[stage_key] = time.time()
            payload = {"stage": stage_key, "label": label, "status": "started", "progress": progress, "template_id": template_id}
            payload.update(payload_data)
            return emit("stage", **payload)

        def finish_stage(
            stage_key: str,
            label: str,
            *,
            progress: int | float | None = None,
            status: str = "complete",
            **payload_data: Any,
        ) -> bytes:
            started = stage_timings.pop(stage_key, None)
            elapsed_ms = int((time.time() - started) * 1000) if started else None
            payload: dict[str, Any] = {"stage": stage_key, "label": label, "status": status, "template_id": template_id}
            if progress is not None:
                payload["progress"] = progress
            if elapsed_ms is not None:
                payload["elapsed_ms"] = elapsed_ms
            payload.update(payload_data)
            return emit("stage", **payload)

        contract_ready = False
        contract_stage_summary: dict[str, Any] | None = None
        generator_stage_summary: dict[str, Any] | None = None
        contract_result: dict[str, Any] = {}
        generator_result: dict[str, Any] | None = None
        generator_artifacts_urls: dict[str, str] = {}

        with lock_ctx:
            stage_key = "mapping.save"
            stage_label = "Saving mapping changes"
            stage_started = time.time()
            try:
                yield start_stage(stage_key, stage_label, progress=5)
                normalized_list = _normalize_mapping_for_autofill(payload.mapping)
                normalized_headers = {entry["header"] for entry in normalized_list}
                keys_clean = [key for key in keys_clean if key in normalized_headers]
                validate_mapping_schema(normalized_list)
                write_json_atomic(mapping_path, normalized_list, indent=2, ensure_ascii=False, step="mapping_save")
                keys_clean = write_mapping_keys(template_dir_path, keys_clean)
                manifest_files = {mapping_path.name: mapping_path}
                if mapping_keys_file.exists():
                    manifest_files[mapping_keys_file.name] = mapping_keys_file
                write_artifact_manifest(
                    template_dir_path,
                    step="mapping_save",
                    files=manifest_files,
                    inputs=[f"mapping_tokens={len(normalized_list)}", f"mapping_keys={len(keys_clean)}"],
                    correlation_id=correlation_id,
                )
                log_stage(stage_label, "ok", stage_started)
                yield finish_stage(stage_key, stage_label, progress=20, mapping_tokens=len(normalized_list))
            except Exception as exc:
                log_stage(stage_label, "error", stage_started)
                logger.exception(
                    "mapping_save_failed",
                    extra={"event": "mapping_save_failed", "template_id": template_id, "correlation_id": correlation_id},
                )
                yield finish_stage(stage_key, stage_label, progress=5, status="error", detail="Mapping save failed")
                yield emit("error", stage=stage_key, label=stage_label, detail="Mapping save failed", template_id=template_id)
                return

            stage_key = "mapping.prepare_template"
            stage_label = "Preparing template shell"
            stage_started = time.time()
            try:
                yield start_stage(stage_key, stage_label, progress=25)
                if not base_template_path.exists() and not final_html_path.exists():
                    raise FileNotFoundError("No template HTML found. Run /templates/verify or create via chat first.")
                if not final_html_path.exists():
                    pass  # _fix_fixed_footers imported at module top
                    final_html_path.write_text(
                        _fix_fixed_footers(base_template_path.read_text(encoding="utf-8", errors="ignore")),
                        encoding="utf-8",
                    )
                log_stage(stage_label, "ok", stage_started)
                yield finish_stage(stage_key, stage_label, progress=50)
            except Exception as exc:
                log_stage(stage_label, "error", stage_started)
                logger.exception(
                    "mapping_prepare_final_html_failed",
                    extra={
                        "event": "mapping_prepare_final_html_failed",
                        "template_id": template_id,
                        "correlation_id": correlation_id,
                    },
                )
                yield finish_stage(stage_key, stage_label, progress=25, status="error", detail="Template preparation failed")
                yield emit("error", stage=stage_key, label=stage_label, detail="Template preparation failed", template_id=template_id)
                return

            final_html_url = artifact_url(final_html_path)
            template_html_url = final_html_url or artifact_url(base_template_path)
            tokens_mapped = len(payload.mapping or {})

            stage_key = "contract_build_v2"
            stage_label = "Drafting contract package"
            stage_started = time.time()
            yield start_stage(
                stage_key,
                stage_label,
                progress=55,
                contract_ready=False,
                blueprint_ready=bool(auto_mapping_proposal),
                overview_md=None,
                cached=False,
                warnings=[],
                assumptions=[],
                validation={},
                prompt_version=PROMPT_VERSION_4,
            )
            try:
                final_html_text = final_html_path.read_text(encoding="utf-8", errors="ignore")
                contract_result = contract_builder(
                    template_dir=template_dir_path,
                    catalog=catalog,
                    final_template_html=final_html_text,
                    schema=schema_ext,
                    auto_mapping_proposal=auto_mapping_proposal,
                    mapping_override=payload.mapping,
                    user_instructions=payload.user_instructions or "",
                    dialect_hint=payload.dialect_hint,
                    db_signature=db_sig,
                    key_tokens=keys_clean,
                )
                contract_ready = True
                contract_artifacts_urls = _normalize_artifact_map(contract_result.get("artifacts"))
                contract_stage_summary = {
                    "stage": stage_key,
                    "status": "done",
                    "contract_ready": True,
                    "overview_md": contract_result.get("overview_md"),
                    "cached": contract_result.get("cached"),
                    "warnings": contract_result.get("warnings"),
                    "assumptions": contract_result.get("assumptions"),
                    "validation": contract_result.get("validation"),
                    "artifacts": contract_artifacts_urls,
                    "prompt_version": PROMPT_VERSION_4,
                }
                log_stage(stage_label, "ok", stage_started)
                yield finish_stage(
                    stage_key,
                    stage_label,
                    progress=75,
                    contract_ready=True,
                    overview_md=contract_result.get("overview_md"),
                    cached=contract_result.get("cached"),
                    warnings=contract_result.get("warnings"),
                    assumptions=contract_result.get("assumptions"),
                    validation=contract_result.get("validation"),
                    artifacts=contract_artifacts_urls,
                    prompt_version=PROMPT_VERSION_4,
                )
            except ContractBuilderError as exc:
                log_stage(stage_label, "error", stage_started)
                logger.exception(
                    "contract_build_failed",
                    extra={"event": "contract_build_failed", "template_id": template_id, "correlation_id": correlation_id},
                )
                yield finish_stage(
                    stage_key,
                    stage_label,
                    progress=55,
                    status="error",
                    detail="Contract build failed",
                    prompt_version=PROMPT_VERSION_4,
                )
                yield emit(
                    "error",
                    stage=stage_key,
                    label=stage_label,
                    detail="Contract build failed",
                    template_id=template_id,
                    prompt_version=PROMPT_VERSION_4,
                )
                return
            except Exception as exc:
                log_stage(stage_label, "error", stage_started)
                logger.exception(
                    "contract_build_failed",
                    extra={"event": "contract_build_failed", "template_id": template_id, "correlation_id": correlation_id},
                )
                yield finish_stage(
                    stage_key,
                    stage_label,
                    progress=55,
                    status="error",
                    detail="Contract build failed",
                    prompt_version=PROMPT_VERSION_4,
                )
                yield emit(
                    "error",
                    stage=stage_key,
                    label=stage_label,
                    detail="Contract build failed",
                    template_id=template_id,
                    prompt_version=PROMPT_VERSION_4,
                )
                return

            # Generator assets is a SEPARATE Hermes tool call (build_generator_assets).
            # Not bundled here — Hermes orchestrates each step independently.
            generator_stage_summary = {}
            generator_artifacts_urls = {}

            stage_key = "mapping.thumbnail"
            stage_label = "Capturing template thumbnail"
            stage_started = time.time()
            thumbnail_url = None
            try:
                yield start_stage(stage_key, stage_label, progress=95)
                thumb_path = final_html_path.parent / "report_final.png"
                render_html_fn(final_html_path, thumb_path)
                thumbnail_url = artifact_url(thumb_path)
                write_artifact_manifest(
                    template_dir_path,
                    step="mapping_thumbnail",
                    files={
                        "report_final.html": final_html_path,
                        "template_p1.html": base_template_path,
                        "report_final.png": thumb_path,
                    },
                    inputs=[str(mapping_path)],
                    correlation_id=correlation_id,
                )
                log_stage(stage_label, "ok", stage_started)
                yield finish_stage(stage_key, stage_label, progress=98, thumbnail_url=thumbnail_url)
            except Exception:
                log_stage(stage_label, "error", stage_started)
                yield finish_stage(stage_key, stage_label, progress=95, status="error")

            manifest_data = load_manifest(template_dir_path) or {}
            manifest_url = manifest_endpoint(template_id, kind=kind)
            page_summary_path = template_dir_path / "page_summary.txt"
            page_summary_url = artifact_url(page_summary_path)

            contract_artifacts = (
                contract_stage_summary.get("artifacts") if isinstance(contract_stage_summary, dict) else {}
            )
            generator_artifacts = (
                generator_stage_summary.get("artifacts") if isinstance(generator_stage_summary, dict) else {}
            )
            if not isinstance(generator_artifacts, dict):
                generator_artifacts = {}

            generator_contract_url = generator_artifacts.get("contract") or generator_artifacts.get("contract.json")
            contract_url = generator_contract_url or contract_artifacts.get("contract") or contract_artifacts.get("contract.json")

            # Fallback: if stage artifacts didn't report a contract URL but
            # contract.json exists on disk (e.g. fresh build path), derive the URL.
            if not contract_url:
                disk_contract = template_dir_path / "contract.json"
                if disk_contract.exists():
                    contract_url = artifact_url(disk_contract)

            # Also derive overview/step5 URLs from disk when stages didn't report them
            overview_url = contract_artifacts.get("overview")
            if not overview_url:
                disk_overview = template_dir_path / "overview.md"
                if disk_overview.exists():
                    overview_url = artifact_url(disk_overview)

            step5_url = contract_artifacts.get("step5_requirements")
            if not step5_url:
                disk_step5 = template_dir_path / "step5_requirements.json"
                if disk_step5.exists():
                    step5_url = artifact_url(disk_step5)

            artifacts_payload = {
                "template_html_url": template_html_url,
                "final_html_url": final_html_url,
                "thumbnail_url": thumbnail_url,
                "manifest_url": manifest_url,
                "page_summary_url": page_summary_url,
                "contract_url": contract_url,
                "overview_url": overview_url,
                "step5_requirements_url": step5_url,
                "generator_sql_pack_url": generator_artifacts.get("sql_pack"),
                "generator_output_schemas_url": generator_artifacts.get("output_schemas"),
                "generator_assets_url": generator_artifacts.get("generator_assets"),
                "mapping_keys_url": artifact_url(mapping_keys_file) if mapping_keys_file.exists() else None,
            }

            final_contract_ready = bool(contract_url)

            existing_tpl = state_store.get_template_record(template_id) or {}
            state_store.upsert_template(
                template_id,
                name=existing_tpl.get("name") or f"Template {template_id[:8]}",
                status="approved" if final_contract_ready else "pending",
                artifacts={k: v for k, v in artifacts_payload.items() if v},
                connection_id=payload.connection_id or existing_tpl.get("last_connection_id"),
                mapping_keys=keys_clean,
                template_type=kind,
            )

            if generator_result:
                state_store.update_template_generator(
                    template_id,
                    dialect=generator_result.get("dialect"),
                    params=generator_result.get("params"),
                    invalid=bool(generator_result.get("invalid")),
                    needs_user_fix=generator_result.get("needs_user_fix") or [],
                    summary=generator_result.get("summary"),
                    dry_run=generator_result.get("dry_run"),
                )

            state_store.set_last_used(payload.connection_id or existing_tpl.get("last_connection_id"), template_id)

            total_elapsed_ms = int((time.time() - pipeline_started) * 1000)
            contract_ready = final_contract_ready
            result_payload = {
                "stage": "Approval complete.",
                "progress": 100,
                "template_id": template_id,
                "saved": artifact_url(mapping_path),
                "final_html_path": str(final_html_path),
                "final_html_url": final_html_url,
                "template_html_url": template_html_url,
                "thumbnail_url": thumbnail_url,
                "contract_ready": contract_ready,
                "token_map_size": tokens_mapped,
                "user_values_supplied": bool((payload.user_values_text or "").strip()),
                "manifest": manifest_data,
                "manifest_url": manifest_url,
                "artifacts": {k: v for k, v in artifacts_payload.items() if v},
                "contract_stage": contract_stage_summary,
                "generator_stage": generator_stage_summary,
                "prompt_versions": {
                    "mapping": PROMPT_VERSION,
                    "corrections": PROMPT_VERSION_3_5,
                    "contract": PROMPT_VERSION_4,
                },
                "elapsed_ms": total_elapsed_ms,
                "keys": keys_clean,
                "keys_count": len(keys_clean),
            }
            yield emit("result", **result_payload)

            logger.info(
                "mapping_approve_complete",
                extra={
                    "event": "mapping_approve_complete",
                    "template_id": template_id,
                    "contract_ready": contract_ready,
                    "thumbnail_url": thumbnail_url,
                    "correlation_id": correlation_id,
                    "elapsed_ms": total_elapsed_ms,
                },
            )

    headers = {"Content-Type": "application/x-ndjson"}
    return StreamingResponse(event_stream(), headers=headers, media_type="application/x-ndjson")




# ==============================================================================
# SECTION: MAPPING: corrections
# ==============================================================================

def run_corrections_preview(
    template_id: str,
    payload: Any,
    request: Request,
    *,
    kind: str = "pdf",
):
    correlation_id = getattr(request.state, "correlation_id", None)
    logger.info(
        "corrections_preview_start",
        extra={
            "event": "corrections_preview_start",
            "template_id": template_id,
            "correlation_id": correlation_id,
            "template_kind": kind,
        },
    )

    template_dir_path = template_dir(template_id, kind=kind)
    template_html_path = template_dir_path / "template_p1.html"
    mapping_step3_path = template_dir_path / "mapping_step3.json"
    schema_ext_path = template_dir_path / "schema_ext.json"

    page_index = max(1, int(payload.page or 1))
    reference_png = template_dir_path / f"reference_p{page_index}.png"
    page_png_path = reference_png if reference_png.exists() else None

    def event_stream():
        started = time.time()

        def emit(event: str, **data: Any) -> bytes:
            return (json.dumps({"event": event, **data}, ensure_ascii=False) + "\n").encode("utf-8")

        yield emit(
            "stage",
            stage="corrections_preview",
            status="start",
            progress=10,
            template_id=template_id,
            correlation_id=correlation_id,
            prompt_version=PROMPT_VERSION_3_5,
        )
        try:
            try:
                lock_ctx = acquire_template_lock(
                    template_dir_path,
                    "mapping_corrections_preview",
                    correlation_id,
                )
            except TemplateLockError:
                yield emit(
                    "error",
                    stage="corrections_preview",
                    detail="Template is currently processing another request.",
                    template_id=template_id,
                )
                return
            with lock_ctx:
                result = corrections_preview_fn(
                    upload_dir=template_dir_path,
                    template_html_path=template_html_path,
                    mapping_step3_path=mapping_step3_path,
                    schema_ext_path=schema_ext_path,
                    user_input=payload.user_input or "",
                    page_png_path=page_png_path,
                    model_selector=payload.model_selector,
                    mapping_override=payload.mapping_override,
                    sample_tokens=payload.sample_tokens,
                )
        except CorrectionsPreviewError as exc:
            logger.warning(
                "corrections_preview_failed",
                extra={"event": "corrections_preview_failed", "template_id": template_id, "correlation_id": correlation_id},
            )
            yield emit("error", stage="corrections_preview", detail="Corrections preview failed", template_id=template_id)
            return
        except Exception as exc:
            logger.exception(
                "corrections_preview_unexpected",
                extra={
                    "event": "corrections_preview_unexpected",
                    "template_id": template_id,
                    "correlation_id": correlation_id,
                },
            )
            yield emit("error", stage="corrections_preview", detail="Corrections preview failed", template_id=template_id)
            return

        artifacts_raw = result.get("artifacts") or {}
        artifacts: dict[str, str] = {}
        for name, value in artifacts_raw.items():
            resolved: Optional[Path]
            if isinstance(value, Path):
                resolved = value
            else:
                try:
                    resolved = Path(value)
                except Exception:
                    resolved = None
            url = artifact_url(resolved)
            if url:
                artifacts[str(name)] = url

        template_html_url = artifacts.get("template_html")
        page_summary_url = artifacts.get("page_summary")
        if template_html_url or page_summary_url:
            existing_tpl = state_store.get_template_record(template_id) or {}
            artifacts_for_state: dict[str, str] = {}
            if template_html_url:
                artifacts_for_state["template_html_url"] = template_html_url
            if page_summary_url:
                artifacts_for_state["page_summary_url"] = page_summary_url
            if artifacts_for_state:
                existing_status = (existing_tpl.get("status") or "").lower()
                next_status = existing_tpl.get("status") or "mapping_corrections_previewed"
                if existing_status != "approved":
                    next_status = "mapping_corrections_previewed"
                state_store.upsert_template(
                    template_id,
                    name=existing_tpl.get("name") or f"Template {template_id[:8]}",
                    status=next_status,
                    artifacts=artifacts_for_state,
                    connection_id=existing_tpl.get("last_connection_id"),
                    template_type=kind,
                )

        yield emit(
            "stage",
            stage="corrections_preview",
            status="done",
            progress=90,
            template_id=template_id,
            correlation_id=correlation_id,
            cache_hit=bool(result.get("cache_hit")),
            prompt_version=PROMPT_VERSION_3_5,
        )

        yield emit(
            "result",
            template_id=template_id,
            summary=result.get("summary") or {},
            processed=result.get("processed") or {},
            artifacts=artifacts,
            cache_key=result.get("cache_key"),
            cache_hit=bool(result.get("cache_hit")),
            prompt_version=PROMPT_VERSION_3_5,
        )

        logger.info(
            "corrections_preview_complete",
            extra={
                "event": "corrections_preview_complete",
                "template_id": template_id,
                "elapsed_ms": int((time.time() - started) * 1000),
                "correlation_id": correlation_id,
            },
        )

    headers = {"Content-Type": "application/x-ndjson"}
    return StreamingResponse(event_stream(), headers=headers, media_type="application/x-ndjson")




# ==============================================================================
# SECTION: MAPPING: key_options
# ==============================================================================

def mapping_key_options(
    template_id: str,
    request: Request,
    connection_id: str | None = None,
    tokens: str | None = None,
    limit: int = 200,
    start_date: str | None = None,
    end_date: str | None = None,
    *,
    kind: str = "pdf",
    debug: bool = False,
):
    correlation_id = getattr(request.state, "correlation_id", None)
    logger.info(
        "mapping_key_options_start",
        extra={
            "event": "mapping_key_options_start",
            "template_id": template_id,
            "connection_id": connection_id,
            "tokens": tokens,
            "limit": limit,
            "start_date": start_date,
            "end_date": end_date,
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )

    def _resolve_connection_id(explicit_id: str | None) -> str | None:
        if explicit_id:
            explicit_id = str(explicit_id).strip()
            if explicit_id:
                return explicit_id
        try:
            record = state_store.get_template_record(template_id) or {}
        except Exception:
            record = {}
        last_conn = record.get("last_connection_id")
        if last_conn:
            return str(last_conn)
        last_used = state_store.get_last_used() or {}
        fallback_conn = last_used.get("connection_id")
        return str(fallback_conn) if fallback_conn else None

    effective_connection_id = _resolve_connection_id(connection_id)

    try:
        template_dir_path = template_dir(template_id, kind=kind)
    except Exception:
        # Template directory doesn't exist on disk — return empty keys
        # rather than a hard 404, since key options are optional.
        logger.info("mapping_key_options_no_dir", extra={"template_id": template_id, "kind": kind})
        return {"keys": {}}

    keys_available = load_mapping_keys(template_dir_path)
    if not keys_available:
        logger.info("mapping_key_options: no keys in mapping_keys.json for %s", template_id)
        return {"keys": {}}

    token_list = normalize_tokens_request(tokens, keys_available)
    if not token_list:
        logger.info("mapping_key_options: empty token_list for %s (keys_available=%s)", template_id, keys_available)
        return {"keys": {}}

    try:
        limit_value = int(limit)
    except (TypeError, ValueError):
        limit_value = 200
    limit_value = max(1, min(limit_value, 500))

    mapping_path = template_dir_path / "mapping_pdf_labels.json"
    if not mapping_path.exists():
        return {"keys": {}}
    try:
        mapping_doc = json.loads(mapping_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.exception("Failed to read mapping file")
        raise http_error(500, "mapping_load_failed", "Failed to read mapping file")

    if not isinstance(mapping_doc, list):
        raise http_error(500, "mapping_invalid", "Approved mapping is not in the expected format.")
    mapping_lookup = build_mapping_lookup(mapping_doc)

    contract_filters_required: dict[str, str] = {}
    contract_filters_optional: dict[str, str] = {}
    contract_date_columns: dict[str, str] = {}
    contract_join: dict[str, Any] = {}
    contract_path = template_dir_path / "contract.json"
    if contract_path.exists():
        try:
            contract_data = json.loads(contract_path.read_text(encoding="utf-8"))
        except Exception:
            contract_data = {}
        (
            contract_filters_required,
            contract_filters_optional,
            contract_date_columns,
        ) = extract_contract_metadata(contract_data)
        if isinstance(contract_data, dict):
            join_section = contract_data.get("join")
            if isinstance(join_section, dict):
                contract_join = join_section

    try:
        db_path = db_path_from_payload_or_default(effective_connection_id)
        verify_sqlite(db_path)
    except Exception as exc:
        logger.warning(
            "mapping_key_options_db_unavailable",
            extra={
                "event": "mapping_key_options_db_unavailable",
                "template_id": template_id,
                "connection_id": effective_connection_id,
                "error": str(exc),
                "correlation_id": correlation_id,
            },
        )
        return {"keys": {}}

    options: dict[str, list[str]] = {}
    debug_payload: dict[str, Any] = {
        "template_id": template_id,
        "connection_id": effective_connection_id,
        "db_path": str(db_path),
        "tokens_available": keys_available,
        "token_details": {},
    }

    # Optional local fallback DB for templates that ship auxiliary lookup tables
    # (e.g., runtime_machine_keys.db) alongside their artifacts.
    fallback_db_path = template_dir_path / "runtime_machine_keys.db"

    # DataFrame pipeline is the only mode
    _use_df = True

    with sqlite3.connect(str(db_path)) as con:
        con.row_factory = sqlite3.Row
        for token in token_list:
            table_clean, column_clean, binding_source = resolve_token_binding(
                token,
                mapping_lookup,
                contract_filters_required,
                contract_filters_optional,
            )
            if not table_clean or not column_clean:
                options[token] = []
                continue
            date_column_name = contract_date_columns.get(table_clean.lower())

            def _schema_machine_columns(connection):
                parent_table = str(contract_join.get("parent_table") or "").strip() or "neuract__RUNHOURS"
                if _use_df:
                    try:
                        pass  # get_loader_for_ref defined in this file
                        loader = get_loader_for_ref(db_path)
                        # Use pragma_table_info to get column names without loading all rows
                        info = loader.pragma_table_info(parent_table)
                        columns = [str(col["name"]) for col in info]
                    except Exception as exc:
                        logger.exception("_schema_machine_columns failed for table %s: %s", parent_table, exc)
                        return [], {"error": f"DataFrame schema query failed: {exc}", "table": parent_table}
                else:
                    try:
                        safe_table = parent_table.replace("'", "''")
                        pragma_rows = list(
                            connection.execute(f"PRAGMA table_info('{safe_table}')")
                        )
                        columns = [row[1] for row in pragma_rows if len(row) > 1]
                    except Exception as exc:  # pragma: no cover - defensive
                        return [], {"error": "Schema query failed", "table": parent_table}

                filtered = [col for col in columns if "hrs" in str(col or "").lower()]
                filtered.sort()
                limited = filtered[:limit_value]
                return limited, {
                    "table": parent_table,
                    "column_source": "schema_columns",
                    "row_count": len(limited),
                }

            def _run_query(connection, *, mark_fallback: bool = False, query_db_path=db_path):
                if _use_df:
                    rows_inner, debug_inner = execute_token_query_df(
                        query_db_path,
                        token=token,
                        table_clean=table_clean,
                        column_clean=column_clean,
                        date_column_name=date_column_name,
                        start_date=start_date,
                        end_date=end_date,
                        limit_value=limit_value,
                    )
                else:
                    rows_inner, debug_inner = execute_token_query(
                        connection,
                        token=token,
                        table_clean=table_clean,
                        column_clean=column_clean,
                        date_column_name=date_column_name,
                        start_date=start_date,
                        end_date=end_date,
                        limit_value=limit_value,
                    )
                if mark_fallback:
                    debug_inner["fallback_db"] = str(fallback_db_path)
                return rows_inner, debug_inner

            rows, token_debug = _run_query(con)

            def _fallback_schema_columns(con_ref):
                fallback_table = str(contract_join.get("parent_table") or "").strip()
                if not fallback_table:
                    fallback_table = "neuract__RUNHOURS"
                try:
                    safe_fallback_table = fallback_table.replace("'", "''")
                    pragma_rows = list(
                        con_ref.execute(f"PRAGMA table_info('{safe_fallback_table}')")
                    )
                    columns = [row[1] for row in pragma_rows if len(row) > 1]
                except Exception as exc:  # pragma: no cover - defensive
                    return [], {"fallback_error": "Fallback schema query failed", "fallback_table": fallback_table}

                filtered = [col for col in columns if "hrs" in str(col or "").lower()]
                filtered.sort()
                return filtered[:limit_value], {"fallback_table": fallback_table}

            needs_fallback = (
                not rows
                and fallback_db_path.exists()
                and isinstance(token_debug.get("error"), str)
                and "no such table" in token_debug["error"].lower()
            )
            if needs_fallback:
                with sqlite3.connect(str(fallback_db_path)) as fallback_con:
                    fallback_con.row_factory = sqlite3.Row
                    rows, token_debug = _run_query(fallback_con, mark_fallback=True, query_db_path=fallback_db_path)
            elif not rows and isinstance(token_debug.get("error"), str):
                err_text = token_debug.get("error", "").lower()
                if "no such table" in err_text or "no such column" in err_text:
                    fallback_rows, fallback_meta = _fallback_schema_columns(con)
                    if fallback_rows:
                        rows = fallback_rows
                        token_debug["fallback_used"] = True
                        token_debug["fallback_source"] = "schema_columns"
                        token_debug["row_count"] = len(rows)
                    token_debug.update(fallback_meta)

            if binding_source:
                token_debug["binding_source"] = binding_source
            options[token] = rows
            if token_debug.get("error"):
                logger.warning(
                    "mapping_key_query_failed",
                    extra={
                        "event": "mapping_key_query_failed",
                        "template_id": template_id,
                        "token": token,
                        "table": table_clean,
                        "column": column_clean,
                        "db_path": str(db_path),
                        "error": token_debug["error"],
                        "correlation_id": correlation_id,
                    },
                )
            debug_payload["token_details"][token] = token_debug

    logger.info(
        "mapping_key_options_complete",
        extra={
            "event": "mapping_key_options_complete",
            "template_id": template_id,
            "tokens": token_list,
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )
    response: dict[str, Any] = {"keys": options}
    write_debug_log(template_id, kind=kind, event="mapping_key_options", payload=debug_payload)
    if debug:
        response["debug"] = debug_payload
    return response



# ==============================================================================
# SECTION: MAPPING: preview
# ==============================================================================

def _mapping_preview_pipeline(
    template_id: str,
    connection_id: Optional[str],
    request: Optional[Request],
    *,
    correlation_id: Optional[str] = None,
    force_refresh: bool = False,
    kind: str = "pdf",
    ocr_context: str | None = None,
) -> Iterator[dict[str, Any]]:
    try:
        api_mod = importlib.import_module("backend.api")
    except Exception:
        api_mod = None
    verify_sqlite_fn = getattr(api_mod, "verify_sqlite", verify_sqlite)
    run_llm_call_3_fn = getattr(api_mod, "run_llm_call_3", run_llm_call_3)
    build_catalog_fn = getattr(api_mod, "_build_catalog_from_db", build_catalog_from_db)
    get_parent_child_info_fn = getattr(api_mod, "get_parent_child_info", get_parent_child_info)
    state_store_ref = getattr(api_mod, "state_store", state_store)

    correlation_id = correlation_id or (getattr(request.state, "correlation_id", None) if request else None)
    yield {
        "event": "stage",
        "stage": "mapping_preview",
        "status": "start",
        "template_id": template_id,
        "correlation_id": correlation_id,
        "prompt_version": PROMPT_VERSION,
    }

    template_dir_path = template_dir(template_id, kind=kind)
    mapping_keys_file = mapping_keys_path(template_dir_path)
    html_path = template_dir_path / "template_p1.html"
    if not html_path.exists():
        html_path = template_dir_path / "report_final.html"
    if not html_path.exists():
        raise http_error(404, "template_not_ready", "Run /templates/verify first")
    template_html = html_path.read_text(encoding="utf-8", errors="ignore")

    schema_ext = load_schema_ext(template_dir_path) or {}
    db_path = db_path_from_payload_or_default(connection_id)
    verify_sqlite_fn(db_path)

    catalog = list(dict.fromkeys(build_catalog_fn(db_path)))

    # Build rich catalog with types + sample values for LLM mapping
    _rich_catalog_text: str | None = None
    try:
        _rich_catalog_text = format_catalog_rich(build_rich_catalog_from_db(db_path))
    except Exception:
        logger.warning("rich_catalog_build_degraded", extra={"template_id": template_id})

    # Extract header labels from template HTML for table-matching heuristic
    _header_hints = re.findall(r'data-label="([^"]+)"', template_html)

    try:
        schema_info = get_parent_child_info_fn(db_path, header_hints=_header_hints)
    except Exception as exc:
        logger.warning(
            "mapping_preview_schema_probe_degraded",
            extra={
                "event": "mapping_preview_schema_probe_degraded",
                "template_id": template_id,
                "error": str(exc),
            },
        )
        # Additive fallback: build minimal schema_info from catalog so the
        # LLM mapping call can still proceed with available table/column info.
        tables_from_catalog: dict[str, list[str]] = {}
        for entry in catalog:
            if "." in entry:
                tbl, col = entry.split(".", 1)
                tables_from_catalog.setdefault(tbl, []).append(col)
        if tables_from_catalog:
            all_tables = sorted(tables_from_catalog.keys())
            first_table = all_tables[0]
            first_cols = tables_from_catalog[first_table]
            schema_info = {
                "child table": first_table,
                "parent table": first_table,
                "child_columns": first_cols,
                "parent_columns": first_cols,
                "common_names": first_cols,
            }
        else:
            schema_info = {
                "child table": "",
                "parent table": "",
                "child_columns": [],
                "parent_columns": [],
                "common_names": [],
            }
    pdf_sha = sha256_path(find_reference_pdf(template_dir_path)) or ""
    png_path = find_reference_png(template_dir_path)
    db_sig = compute_db_signature(db_path) or ""
    html_pre_sha = sha256_text(template_html)
    catalog_sha = hashlib.sha256(json.dumps(catalog, sort_keys=True).encode("utf-8")).hexdigest()
    schema_sha = hashlib.sha256(json.dumps(schema_ext, sort_keys=True).encode("utf-8")).hexdigest() if schema_ext else ""
    saved_keys = load_mapping_keys(template_dir_path)

    cache_payload = {
        "pdf_sha": pdf_sha,
        "db_signature": db_sig,
        "html_sha": html_pre_sha,
        "prompt_version": PROMPT_VERSION,
        "catalog_sha": catalog_sha,
        "schema_sha": schema_sha,
    }
    cache_key = hashlib.sha256(json.dumps(cache_payload, sort_keys=True).encode("utf-8")).hexdigest()

    cached_doc, mapping_path = load_mapping_step3(template_dir_path)
    constants_path = template_dir_path / "constant_replacements.json"
    if not force_refresh and cached_doc:
        prompt_meta = cached_doc.get("prompt_meta") or {}
        post_sha = prompt_meta.get("post_html_sha256")
        pre_sha_cached = prompt_meta.get("pre_html_sha256")
        cache_key_stored = prompt_meta.get("cache_key")
        html_matches_pre = pre_sha_cached == html_pre_sha
        html_matches_post = bool(post_sha and post_sha == html_pre_sha)
        cache_key_matches = cache_key_stored == cache_key
        cache_match = (cache_key_matches and (html_matches_pre or html_matches_post)) or (
            html_matches_post and cache_key_stored and not cache_key_matches
        )
        if cache_match:
            effective_cache_key = cache_key if cache_key_matches else (cache_key_stored or cache_key)
            mapping = cached_doc.get("mapping") or {}
            constant_replacements = cached_doc.get("constant_replacements") or {}
            if not constant_replacements and isinstance(cached_doc.get("raw_payload"), dict):
                constant_replacements = cached_doc["raw_payload"].get("constant_replacements") or {}
            errors = approval_errors(mapping)
            cached_prompt_version = prompt_meta.get("prompt_version") or PROMPT_VERSION

            # Build confidence, candidates, and token_signatures for cached result
            cached_confidence: dict[str, float] = {}
            cached_confidence_reason: dict[str, str] = {}
            cached_candidates: dict[str, list[str]] = {}
            cached_meta = cached_doc.get("meta") or {}
            cached_hints = cached_meta.get("hints", {})

            for token, col in mapping.items():
                if col == "UNRESOLVED":
                    cached_confidence[token] = 0.0
                    cached_confidence_reason[token] = "unresolved"
                    hint = cached_hints.get(token, {})
                    cached_candidates[token] = hint.get("columns", [])
                elif col.startswith("PARAM:") or col == "LATER_SELECTED":
                    cached_confidence[token] = 1.0
                    cached_confidence_reason[token] = "parameter"
                else:
                    col_name = col.split(".")[-1].lower() if "." in col else col.lower()
                    tok_clean = token.replace("row_", "").replace("total_", "").lower()
                    if tok_clean in col_name or col_name in tok_clean:
                        cached_confidence[token] = 0.95
                        cached_confidence_reason[token] = "name_match"
                    else:
                        cached_confidence[token] = 0.7
                        cached_confidence_reason[token] = "type_match"

            cached_token_signatures: dict[str, str] = {}
            for token in mapping:
                cached_token_signatures[token] = hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]

            cached_token_samples = cached_doc.get("token_samples") or {}

            yield {
                "event": "stage",
                "stage": "mapping_preview",
                "status": "cached",
                "template_id": template_id,
                "cache_key": effective_cache_key,
                "correlation_id": correlation_id,
                "prompt_version": cached_prompt_version,
            }
            return {
                "mapping": mapping,
                "errors": errors,
                "schema_info": schema_info,
                "catalog": catalog,
                "cache_key": effective_cache_key,
                "cached": True,
                "constant_replacements": constant_replacements,
                "constant_replacements_count": len(constant_replacements),
                "prompt_version": cached_prompt_version,
                "keys": saved_keys,
                "confidence": cached_confidence,
                "confidence_reason": cached_confidence_reason,
                "candidates": cached_candidates,
                "token_signatures": cached_token_signatures,
                "token_samples": cached_token_samples,
            }

    try:
        lock_ctx = acquire_template_lock(template_dir_path, "mapping_preview", correlation_id)
    except TemplateLockError:
        raise http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        try:
            result = run_llm_call_3_fn(
                template_html,
                catalog,
                schema_ext,
                PROMPT_VERSION,
                str(png_path) if png_path else "",
                cache_key,
                rich_catalog_text=_rich_catalog_text,
                ocr_context=ocr_context,
                allow_missing_tokens=True,  # Strip LLM-hallucinated tokens instead of rejecting
            )
        except MappingInlineValidationError as exc:
            logger.exception("mapping_llm_validation_error")
            raise http_error(422, "mapping_llm_invalid", "Mapping LLM validation failed")
        except Exception as exc:
            logger.exception(
                "mapping_preview_llm_failed",
                extra={"event": "mapping_preview_llm_failed", "template_id": template_id},
            )
            raise http_error(500, "mapping_llm_failed", "Mapping LLM call failed")

        html_applied = result.html_constants_applied
        write_text_atomic(html_path, html_applied, encoding="utf-8", step="mapping_preview_html")
        html_post_sha = sha256_text(html_applied)

        # Compute confidence, candidates, token_signatures from LLM result
        # (moved here so they're persisted in mapping_step3.json for widget hydration)
        _confidence: dict[str, float] = {}
        _confidence_reason: dict[str, str] = {}
        _candidates: dict[str, list[str]] = {}
        _meta = result.meta or {}
        _hints = _meta.get("hints", {})

        for _tok, _col in result.mapping.items():
            if _col == "UNRESOLVED":
                _confidence[_tok] = 0.0
                _confidence_reason[_tok] = "unresolved"
                _hint = _hints.get(_tok, {})
                _candidates[_tok] = _hint.get("columns", [])
            elif _col.startswith("PARAM:") or _col == "LATER_SELECTED":
                _confidence[_tok] = 1.0
                _confidence_reason[_tok] = "parameter"
            else:
                _col_name = _col.split(".")[-1].lower() if "." in _col else _col.lower()
                _tok_clean = _tok.replace("row_", "").replace("total_", "").lower()
                if _tok_clean in _col_name or _col_name in _tok_clean:
                    _confidence[_tok] = 0.95
                    _confidence_reason[_tok] = "name_match"
                else:
                    _confidence[_tok] = 0.7
                    _confidence_reason[_tok] = "type_match"

        _token_sigs: dict[str, str] = {}
        for _tok in result.mapping:
            _token_sigs[_tok] = hashlib.sha256(_tok.encode("utf-8")).hexdigest()[:12]

        mapping_doc = {
            "mapping": result.mapping,
            "meta": result.meta,
            "prompt_meta": {
                **(result.prompt_meta or {}),
                "cache_key": cache_key,
                "pre_html_sha256": html_pre_sha,
                "post_html_sha256": html_post_sha,
                "prompt_version": PROMPT_VERSION,
                "catalog_sha256": cache_payload.get("catalog_sha"),
                "schema_sha256": cache_payload.get("schema_sha"),
                "pdf_sha256": pdf_sha,
                "db_signature": db_sig,
            },
            "raw_payload": result.raw_payload,
            "constant_replacements": result.constant_replacements,
            "token_samples": result.token_samples,
            "confidence": _confidence,
            "confidence_reason": _confidence_reason,
            "candidates": _candidates,
            "token_signatures": _token_sigs,
        }
        write_json_atomic(mapping_path, mapping_doc, ensure_ascii=False, indent=2, step="mapping_preview_mapping")
        write_json_atomic(
            constants_path,
            result.constant_replacements,
            ensure_ascii=False,
            indent=2,
            step="mapping_preview_constants",
        )
        files_payload = {html_path.name: html_path, mapping_path.name: mapping_path, constants_path.name: constants_path}
        if mapping_keys_file.exists():
            files_payload[mapping_keys_file.name] = mapping_keys_file
        write_artifact_manifest(
            template_dir_path,
            step="mapping_inline_llm_call_3",
            files=files_payload,
            inputs=[
                f"cache_key={cache_key}",
                f"catalog_sha256={cache_payload.get('catalog_sha')}",
                f"schema_sha256={cache_payload.get('schema_sha')}",
                f"html_pre_sha256={html_pre_sha}",
                f"html_post_sha256={html_post_sha}",
            ],
            correlation_id=correlation_id,
        )

    errors = approval_errors(result.mapping)
    constant_replacements = result.constant_replacements

    # Reuse confidence/candidates/token_signatures computed inside the lock block
    # (already persisted to mapping_step3.json above)
    confidence = _confidence
    confidence_reason = _confidence_reason
    candidates = _candidates
    token_signatures = _token_sigs

    record = state_store_ref.get_template_record(template_id) or {}
    template_name = record.get("name") or f"Template {template_id[:8]}"
    artifacts = {
        "template_html_url": artifact_url(html_path),
        "mapping_step3_url": artifact_url(mapping_path),
    }
    constants_url = artifact_url(constants_path)
    if constants_url:
        artifacts["constants_inlined_url"] = constants_url
    if mapping_keys_file.exists():
        artifacts["mapping_keys_url"] = artifact_url(mapping_keys_file)
    schema_path = template_dir_path / "schema_ext.json"
    schema_url = artifact_url(schema_path) if schema_path.exists() else None
    if schema_url:
        artifacts["schema_ext_url"] = schema_url
    state_store_ref.upsert_template(
        template_id,
        name=template_name,
        status="mapping_previewed",
        artifacts={k: v for k, v in artifacts.items() if v},
        connection_id=connection_id or record.get("last_connection_id"),
        mapping_keys=saved_keys,
        template_type=kind,
    )

    yield {
        "event": "stage",
        "stage": "mapping_preview",
        "status": "ok",
        "template_id": template_id,
        "cache_key": cache_key,
        "correlation_id": correlation_id,
        "prompt_version": PROMPT_VERSION,
    }

    return {
        "mapping": result.mapping,
        "errors": errors,
        "schema_info": schema_info,
        "catalog": catalog,
        "cache_key": cache_key,
        "cached": False,
        "constant_replacements": constant_replacements,
        "constant_replacements_count": len(constant_replacements),
        "prompt_version": PROMPT_VERSION,
        "keys": saved_keys,
        "confidence": confidence,
        "confidence_reason": confidence_reason,
        "candidates": candidates,
        "token_signatures": token_signatures,
        "token_samples": result.token_samples or {},
    }


async def run_mapping_preview(
    template_id: str,
    connection_id: str,
    request: Request,
    force_refresh: bool = False,
    *,
    kind: str = "pdf",
    ocr_context: str | None = None,
) -> dict:
    correlation_id = getattr(request.state, "correlation_id", None)
    logger.info(
        "mapping_preview_start",
        extra={
            "event": "mapping_preview_start",
            "template_id": template_id,
            "connection_id": connection_id,
            "force_refresh": force_refresh,
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )
    pipeline = _mapping_preview_pipeline(
        template_id,
        connection_id,
        request,
        correlation_id=correlation_id,
        force_refresh=force_refresh,
        kind=kind,
        ocr_context=ocr_context,
    )
    try:
        while True:
            next(pipeline)
    except StopIteration as stop:
        payload = stop.value or {}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "mapping_preview_failed",
            extra={"event": "mapping_preview_failed", "template_id": template_id, "correlation_id": correlation_id},
        )
        raise http_error(500, "mapping_preview_failed", "Mapping preview failed")

    logger.info(
        "mapping_preview_complete",
        extra={
            "event": "mapping_preview_complete",
            "template_id": template_id,
            "connection_id": connection_id,
            "cache_key": payload.get("cache_key"),
            "cached": payload.get("cached", False),
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )
    return payload


def mapping_preview_internal(
    template_id: str,
    connection_id: str,
    request: Request,
    force_refresh: bool = False,
    *,
    kind: str = "pdf",
) -> dict:
    coro = run_mapping_preview(template_id, connection_id, request, force_refresh, kind=kind)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    raise RuntimeError("mapping_preview_internal cannot be called from a running event loop; use run_mapping_preview instead.")




# ==============================================================================
# SECTION: SERVICES: connection_inspector
# ==============================================================================

_SCHEMA_CACHE: dict[tuple[str, bool, bool, int], dict] = {}
_SCHEMA_CACHE_LOCK = threading.Lock()
_SCHEMA_CACHE_TTL_SECONDS = max(int(os.getenv("NR_SCHEMA_CACHE_TTL_SECONDS", "30") or "30"), 0)
_SCHEMA_CACHE_MAX_ENTRIES = max(int(os.getenv("NR_SCHEMA_CACHE_MAX_ENTRIES", "32") or "32"), 5)


def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _state_store():
    return state_store


def _quote_identifier(name: str) -> str:
    return name.replace('"', '""')


def _coerce_value(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return value


def _resolve_connection_info(connection_id: str) -> dict:
    """Resolve connection info from state store. Returns dict with db_type, loader, db_identifier."""
    store = _state_store()
    secrets = store.get_connection_secrets(connection_id) if store else None
    db_type = "sqlite"
    db_url = None

    if secrets:
        sp = secrets.get("secret_payload") or {}
        db_url = sp.get("db_url") or secrets.get("db_url")
        db_type = secrets.get("db_type") or "sqlite"
        # Detect from URL
        if db_url and db_url.startswith("postgresql"):
            db_type = "postgresql"

    if db_type in ("postgresql", "postgres"):
        if not db_url:
            raise _http_error(400, "connection_invalid", "No database URL for PostgreSQL connection")
        verify_postgres(db_url)
        loader = get_postgres_loader(db_url)
        return {"db_type": "postgresql", "loader": loader, "db_identifier": db_url}
    else:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        verify_sqlite(db_path)
        loader = get_loader(db_path)
        return {"db_type": "sqlite", "loader": loader, "db_identifier": str(db_path), "db_path": db_path}


def _count_rows_from_loader(loader, table: str) -> int:
    """Get row count from loader's DataFrame."""
    try:
        frame = loader.frame(table)
        return len(frame)
    except Exception:
        return 0


def _sample_rows_from_loader(loader, table: str, limit: int, offset: int = 0) -> list[dict]:
    """Get sample rows from loader's DataFrame."""
    try:
        frame = loader.frame(table)
        sample = frame.iloc[offset:offset + limit]
        rows = []
        for _, row in sample.iterrows():
            rows.append({key: _coerce_value(value) for key, value in row.to_dict().items()})
        return rows
    except Exception:
        return []


def get_connection_schema(
    connection_id: str,
    *,
    include_row_counts: bool = True,
    include_foreign_keys: bool = True,
    sample_rows: int = 0,
) -> dict[str, Any]:
    if not connection_id:
        raise _http_error(400, "connection_missing", "connection_id is required")
    try:
        conn_info = _resolve_connection_info(connection_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Connection validation failed for %s", connection_id)
        raise _http_error(400, "connection_invalid", "Connection validation failed")

    loader = conn_info["loader"]
    db_identifier = conn_info["db_identifier"]

    cache_key = (connection_id, include_row_counts, include_foreign_keys, int(sample_rows or 0))
    cache_enabled = _SCHEMA_CACHE_TTL_SECONDS > 0

    # For SQLite, use file mtime for cache invalidation. For PG, use time-based only.
    cache_mtime = 0.0
    if cache_enabled and conn_info["db_type"] == "sqlite":
        try:
            cache_mtime = conn_info["db_path"].stat().st_mtime
        except OSError:
            cache_mtime = 0.0

    if cache_enabled:
        now = time.time()
        with _SCHEMA_CACHE_LOCK:
            entry = _SCHEMA_CACHE.get(cache_key)
        if entry:
            cached_age = now - float(entry.get("ts") or 0.0)
            if entry.get("mtime") == cache_mtime and cached_age <= _SCHEMA_CACHE_TTL_SECONDS:
                return entry.get("data") or {}

    tables = []
    for table_name in loader.table_names():
        columns = [
            {
                "name": col.get("name"),
                "type": col.get("type"),
                "notnull": bool(col.get("notnull")),
                "pk": bool(col.get("pk")),
                "default": col.get("dflt_value"),
            }
            for col in loader.pragma_table_info(table_name)
        ]
        table_record = {
            "name": table_name,
            "columns": columns,
        }
        if include_foreign_keys:
            table_record["foreign_keys"] = loader.foreign_keys(table_name)
        if include_row_counts:
            table_record["row_count"] = _count_rows_from_loader(loader, table_name)
        if sample_rows and sample_rows > 0:
            table_record["sample_rows"] = _sample_rows_from_loader(loader, table_name, min(sample_rows, 25))
        tables.append(table_record)

    connection_record = _state_store().get_connection_record(connection_id) or {}
    result = {
        "connection_id": connection_id,
        "connection_name": connection_record.get("name"),
        "database": db_identifier,
        "table_count": len(tables),
        "tables": tables,
    }
    if cache_enabled:
        with _SCHEMA_CACHE_LOCK:
            _SCHEMA_CACHE[cache_key] = {"mtime": cache_mtime, "ts": time.time(), "data": result}
            if len(_SCHEMA_CACHE) > _SCHEMA_CACHE_MAX_ENTRIES:
                oldest = sorted(_SCHEMA_CACHE.items(), key=lambda item: item[1].get("ts") or 0.0)
                for key, _ in oldest[: max(len(_SCHEMA_CACHE) - _SCHEMA_CACHE_MAX_ENTRIES, 0)]:
                    _SCHEMA_CACHE.pop(key, None)
    return result


def get_connection_table_preview(
    connection_id: str,
    *,
    table: str,
    limit: int = 10,
    offset: int = 0,
) -> dict[str, Any]:
    if not connection_id:
        raise _http_error(400, "connection_missing", "connection_id is required")
    if not table:
        raise _http_error(400, "table_missing", "table name is required")
    try:
        conn_info = _resolve_connection_info(connection_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Connection validation failed for %s", connection_id)
        raise _http_error(400, "connection_invalid", "Connection validation failed")

    loader = conn_info["loader"]
    tables = loader.table_names()
    if table not in tables:
        raise _http_error(404, "table_not_found", f"Table '{table}' not found")

    safe_limit = max(1, min(int(limit or 10), 200))
    safe_offset = max(0, int(offset or 0))
    columns = [col.get("name") for col in loader.pragma_table_info(table)]
    rows = _sample_rows_from_loader(loader, table, safe_limit, safe_offset)
    return {
        "connection_id": connection_id,
        "table": table,
        "columns": columns,
        "rows": rows,
        "row_count": _count_rows_from_loader(loader, table),
        "limit": safe_limit,
        "offset": safe_offset,
    }




# ==============================================================================
# SECTION: SERVICES: connection_service
# ==============================================================================

def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _state_store():
    return state_store


def test_connection(payload: TestPayload) -> dict[str, Any]:
    t0 = time.time()
    try:
        db_path: Path = resolve_db_path(
            connection_id=None,
            db_url=payload.db_url,
            db_path=payload.database if (payload.db_type or "").lower() == "sqlite" else None,
        )
        verify_sqlite(db_path)
    except FileNotFoundError as exc:
        logger.warning("test_connection_file_not_found: %s", exc)
        raise _http_error(400, "file_not_found", f"Database file not found: {exc}")
    except Exception as exc:
        logger.exception("test_connection_failed")
        raise _http_error(400, "connection_invalid", f"Connection test failed: {exc}")

    latency_ms = int((time.time() - t0) * 1000)
    resolved = Path(db_path).resolve()
    display_name = display_name_for_path(resolved, "sqlite")
    cfg = {
        "db_type": "sqlite",
        "database": str(resolved),
        "db_url": payload.db_url,
        "name": display_name,
        "status": "connected",
        "latency_ms": latency_ms,
    }
    cid = save_connection(cfg)
    _state_store().record_connection_ping(
        cid,
        status="connected",
        detail=f"Connected ({display_name})",
        latency_ms=latency_ms,
    )

    return {
        "ok": True,
        "details": f"Connected ({display_name})",
        "latency_ms": latency_ms,
        "connection_id": cid,
        "normalized": {
            "db_type": "sqlite",
            "database": str(resolved),
        },
    }


def list_connections() -> list[dict]:
    return _state_store().list_connections()


def upsert_connection(payload: ConnectionUpsertPayload) -> dict[str, Any]:
    if not payload.db_url and not payload.database and not payload.id:
        raise _http_error(400, "invalid_payload", "Provide db_url or database when creating a connection.")

    existing = _state_store().get_connection_record(payload.id) if payload.id else None
    try:
        if payload.db_url:
            db_path = resolve_db_path(connection_id=None, db_url=payload.db_url, db_path=None)
        elif payload.database:
            db_path = Path(payload.database)
            ALLOWED_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".duckdb"}
            if db_path.suffix.lower() not in ALLOWED_EXTENSIONS:
                raise _http_error(400, "invalid_database_extension", "invalid_database_extension")
        elif existing and existing.get("database_path"):
            db_path = Path(existing["database_path"])
        else:
            raise RuntimeError("No database information supplied.")
    except Exception as exc:
        logger.exception("upsert_connection_invalid_database")
        raise _http_error(400, "invalid_database", "Invalid database reference")

    db_type = (payload.db_type or (existing or {}).get("db_type") or "sqlite").lower()
    if db_type != "sqlite":
        raise _http_error(400, "unsupported_db", "Only sqlite connections are supported in this build.")

    secret_payload: Optional[dict[str, Any]] = None
    if payload.db_url or payload.database:
        secret_payload = {
            "db_url": payload.db_url,
            "database": str(db_path),
        }

    record = _state_store().upsert_connection(
        conn_id=payload.id,
        name=payload.name or display_name_for_path(Path(db_path), db_type),
        db_type=db_type,
        database_path=str(db_path),
        secret_payload=secret_payload,
        status=payload.status,
        latency_ms=payload.latency_ms,
        tags=payload.tags,
    )

    if payload.status:
        _state_store().record_connection_ping(
            record["id"],
            status=payload.status,
            detail=None,
            latency_ms=payload.latency_ms,
        )
    return record


def delete_connection(connection_id: str) -> bool:
    return _state_store().delete_connection(connection_id)


def healthcheck_connection(connection_id: str) -> dict[str, Any]:
    t0 = time.time()
    try:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        verify_sqlite(db_path)
    except Exception as exc:
        logger.exception("healthcheck_connection_failed")
        _state_store().record_connection_ping(
            connection_id,
            status="failed",
            detail="Healthcheck failed",
            latency_ms=None,
        )
        raise _http_error(400, "connection_unhealthy", "Connection healthcheck failed")

    latency_ms = int((time.time() - t0) * 1000)
    _state_store().record_connection_ping(
        connection_id,
        status="connected",
        detail="Healthcheck succeeded",
        latency_ms=latency_ms,
    )
    return {
        "status": "ok",
        "connection_id": connection_id,
        "latency_ms": latency_ms,
    }




# ==============================================================================
# SECTION: SERVICES: scheduler_service
# ==============================================================================

def _http_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"status": "error", "code": code, "message": message})


def _state_store():
    try:
        api_mod = importlib.import_module("backend.api")
        return getattr(api_mod, "state_store", state_store)
    except Exception:
        return state_store


def _report_service():
    try:
        api_mod = importlib.import_module("backend.api")
        return getattr(api_mod, "report_service", report_service_module)
    except Exception:
        return report_service_module


def list_jobs(status: Optional[list[str]], job_type: Optional[list[str]], limit: int, active_only: bool):
    return _state_store().list_jobs(statuses=status, types=job_type, limit=limit, active_only=active_only)


def list_active_jobs(limit: int):
    return _state_store().list_jobs(limit=limit, active_only=True)


def get_job(job_id: str) -> dict[str, Any] | None:
    return _state_store().get_job(job_id)


def list_schedules():
    return _state_store().list_schedules()


def get_schedule(schedule_id: str) -> dict[str, Any] | None:
    """Get a specific schedule by ID."""
    return _state_store().get_schedule(schedule_id)


def cancel_job(job_id: str, *, force: bool = False) -> dict[str, Any]:
    existing = _state_store().get_job(job_id)
    if not existing:
        raise _http_error(404, "job_not_found", "Job not found.")
    previous_status = str(existing.get("status") or "").strip().lower()
    job = _state_store().cancel_job(job_id)
    if not job:
        raise _http_error(404, "job_not_found", "Job not found.")
    try:
        should_force = force or previous_status in {"running", "in_progress", "started"}
        _report_service().force_cancel_job(job_id, force=should_force)
    except Exception:
        # Best-effort force cancel; do not block the API response.
        logger.warning("force_cancel_failed", exc_info=True)
    return job


def create_schedule(payload: ScheduleCreatePayload) -> dict[str, Any]:
    store = _state_store()
    template = store.get_template_record(payload.template_id) or {}
    if not template:
        raise _http_error(404, "template_not_found", "Template not found.")
    template_status = str(template.get("status") or "").strip().lower()
    # Backward compatibility: older template workflows used "active" for
    # templates that are effectively approved/schedulable.
    if template_status not in {"approved", "active"}:
        raise _http_error(
            400,
            "template_not_ready",
            f"Template must be approved before scheduling runs (current status: {template_status or 'none'}). "
            "Complete the template mapping and approval workflow first.",
        )
    connection = store.get_connection_record(payload.connection_id)
    if not connection:
        raise _http_error(404, "connection_not_found", "Connection not found.")
    if not payload.start_date or not payload.end_date:
        raise _http_error(400, "invalid_schedule_range", "Provide both start_date and end_date.")
    interval_minutes = resolve_schedule_interval(payload.frequency, payload.interval_minutes)
    now_iso = utcnow_iso()
    schedule = store.create_schedule(
        name=(payload.name or template.get("name") or f"Schedule {payload.template_id}")[:120],
        template_id=payload.template_id,
        template_name=template.get("name") or payload.template_id,
        template_kind=template.get("kind") or "pdf",
        connection_id=payload.connection_id,
        connection_name=connection.get("name") or connection.get("connection_name") or payload.connection_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        key_values=clean_key_values(payload.key_values),
        batch_ids=payload.batch_ids,
        docx=payload.docx,
        xlsx=payload.xlsx,
        email_recipients=normalize_email_targets(payload.email_recipients or []),
        email_subject=payload.email_subject,
        email_message=payload.email_message,
        frequency=payload.frequency,
        interval_minutes=interval_minutes,
        run_time=payload.run_time,
        next_run_at=now_iso,
        first_run_at=now_iso,
        active=payload.active,
    )
    return schedule


def delete_schedule(schedule_id: str) -> bool:
    return _state_store().delete_schedule(schedule_id)


def update_schedule(schedule_id: str, payload: ScheduleUpdatePayload) -> dict[str, Any]:
    """Update an existing schedule with partial data."""
    store = _state_store()
    existing = store.get_schedule(schedule_id)
    if not existing:
        raise _http_error(404, "schedule_not_found", "Schedule not found.")

    # Build changes dict from non-None fields
    changes: dict[str, Any] = {}
    if payload.name is not None:
        changes["name"] = payload.name[:120]
    if payload.start_date is not None:
        changes["start_date"] = payload.start_date
    if payload.end_date is not None:
        changes["end_date"] = payload.end_date
    if payload.key_values is not None:
        changes["key_values"] = clean_key_values(payload.key_values)
    if payload.batch_ids is not None:
        changes["batch_ids"] = payload.batch_ids
    if payload.docx is not None:
        changes["docx"] = payload.docx
    if payload.xlsx is not None:
        changes["xlsx"] = payload.xlsx
    if payload.email_recipients is not None:
        changes["email_recipients"] = normalize_email_targets(payload.email_recipients)
    if payload.email_subject is not None:
        changes["email_subject"] = payload.email_subject
    if payload.email_message is not None:
        changes["email_message"] = payload.email_message
    if payload.frequency is not None:
        interval_minutes = resolve_schedule_interval(payload.frequency, payload.interval_minutes)
        changes["frequency"] = payload.frequency
        changes["interval_minutes"] = interval_minutes
    elif payload.interval_minutes is not None:
        # Only interval_minutes provided without frequency
        changes["interval_minutes"] = payload.interval_minutes
    if payload.run_time is not None:
        changes["run_time"] = payload.run_time
    if payload.active is not None:
        changes["active"] = payload.active

    if not changes:
        # No updates - return existing
        return existing

    updated = store.update_schedule(schedule_id, **changes)
    if not updated:
        raise _http_error(404, "schedule_not_found", "Schedule not found after update.")
    return updated




# ==============================================================================
# SECTION: SERVICES: template_service
# ==============================================================================


# Aliases for file_service functions referenced by template_service.
# The actual implementations are defined earlier in this file.
verify_template_service = verify_template
verify_excel_service = verify_excel
get_template_html_service = get_template_html
edit_template_manual_service = edit_template_manual
edit_template_ai_service = edit_template_ai
undo_last_template_edit_service = undo_last_template_edit
chat_template_edit_service = chat_template_edit
apply_chat_template_edit_service = apply_chat_template_edit
chat_template_create_service = chat_template_create
create_template_from_chat_service = create_template_from_chat
generator_assets_service = generator_assets
_load_template_generator_summary = load_template_generator_summary
_resolve_template_kind = resolve_template_kind
_update_template_generator_summary_for_edit = update_template_generator_summary_for_edit

_TEMPLATE_SERVICE: TemplateService | None = None


def _get_template_service() -> TemplateService:
    global _TEMPLATE_SERVICE
    if _TEMPLATE_SERVICE is None:
        settings = get_api_settings()
        _TEMPLATE_SERVICE = TemplateService(
            uploads_root=settings.uploads_dir,
            excel_uploads_root=settings.excel_uploads_dir,
            max_bytes=settings.max_upload_bytes,
            max_zip_entries=settings.max_zip_entries,
            max_zip_uncompressed_bytes=settings.max_zip_uncompressed_bytes,
            max_concurrency=settings.template_import_max_concurrency,
        )
    return _TEMPLATE_SERVICE


def _robust_rmtree(path: Path, retries: int = 3, delay: float = 0.5) -> None:
    """Remove a directory tree with Windows-robust error handling.

    On Windows, files may be locked by antivirus, search indexer, or stale
    handles. This retries after clearing read-only flags.
    """
    def _on_error(func, fpath, exc_info):
        # Clear read-only flag and retry
        try:
            os.chmod(fpath, stat.S_IWRITE)
            func(fpath)
        except Exception:
            pass

    for attempt in range(retries):
        try:
            shutil.rmtree(path, onerror=_on_error)
            return
        except PermissionError:
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise


def _http_error(status_code: int, code: str, message: str, details: str | None = None) -> HTTPException:
    payload = {"status": "error", "code": code, "message": message}
    if details:
        payload["details"] = details
    return HTTPException(status_code=status_code, detail=payload)


def _state_store():
    return state_store


def _normalize_tags(values: Optional[list[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        text = re.sub(r"[^A-Za-z0-9 _-]", "", str(raw or "")).strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text[:32])
        if len(normalized) >= 12:
            break
    return normalized


def export_template_zip(template_id: str, request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    kind = _resolve_template_kind(template_id)
    tdir = template_dir(template_id, must_exist=True, create=False, kind=kind)
    try:
        lock_ctx = acquire_template_lock(tdir, "template_export", correlation_id)
    except TemplateLockError:
        raise _http_error(
            409,
            "template_locked",
            "Template is currently processing another request.",
        )

    fd, tmp_name = tempfile.mkstemp(prefix=f"{template_id}-", suffix=".zip")
    os.close(fd)
    zip_path = Path(tmp_name)

    def _cleanup(path: Path = zip_path) -> None:
        with contextlib.suppress(FileNotFoundError):
            path.unlink(missing_ok=True)

    with lock_ctx:
        create_zip_from_dir(tdir, zip_path, include_root=True)

    headers = {"X-Correlation-ID": correlation_id} if correlation_id else None
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{template_id}.zip",
        background=BackgroundTask(_cleanup),
        headers=headers,
    )


async def import_template_zip(file: UploadFile, request: Request, name: str | None = None):
    if not file:
        raise _http_error(400, "file_missing", "No file provided for import.")

    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    service = _get_template_service()
    try:
        result = await service.import_zip(file, name, correlation_id)
    except TemplateImportError as exc:
        detail = {"status": "error", "code": exc.code, "message": exc.message}
        if exc.detail:
            detail["detail"] = exc.detail
        if correlation_id:
            detail["correlation_id"] = correlation_id
        raise HTTPException(status_code=exc.status_code, detail=detail)

    normalized = dict(result or {})
    normalized.setdefault("status", "ok")
    normalized.setdefault("correlation_id", correlation_id)
    return normalized


def verify_template(file: UploadFile, connection_id: str | None, request: Request, refine_iters: int = 0, page: int = 0):
    return verify_template_service(
        file=file,
        connection_id=connection_id,
        request=request,
        refine_iters=refine_iters,
        page=page,
    )


def verify_excel(file: UploadFile, request: Request, connection_id: str | None = None):
    return verify_excel_service(file=file, request=request, connection_id=connection_id)


def get_template_html(template_id: str, request: Request):
    return get_template_html_service(template_id, request)


def edit_template_manual(template_id: str, payload: TemplateManualEditPayload, request: Request):
    return edit_template_manual_service(template_id, payload, request)


def edit_template_ai(template_id: str, payload: TemplateAiEditPayload, request: Request):
    return edit_template_ai_service(template_id, payload, request)


def undo_last_template_edit(template_id: str, request: Request):
    return undo_last_template_edit_service(template_id, request)


def chat_template_edit(template_id: str, payload: TemplateChatPayload, request: Request):
    return chat_template_edit_service(template_id, payload, request)


def apply_chat_template_edit(template_id: str, html: str, request: Request):
    return apply_chat_template_edit_service(template_id, html, request)


def chat_template_create(payload: TemplateChatPayload, request: Request, sample_pdf_bytes: bytes | None = None):
    return chat_template_create_service(payload, request, sample_pdf_bytes=sample_pdf_bytes)


def create_template_from_chat(payload, request: Request):
    return create_template_from_chat_service(payload, request)


def generator_assets(template_id: str, payload: GeneratorAssetsPayload, request: Request, *, kind: str = "pdf"):
    return generator_assets_service(template_id, payload, request, kind=kind)


def bootstrap_state(request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    templates = _state_store().list_templates()
    hydrated_templates = _ensure_template_mapping_keys(templates)

    # Get connections with optional limit for performance
    all_connections = _state_store().list_connections()
    # Sort by lastConnected (most recent first), then by createdAt
    sorted_connections = sorted(
        all_connections,
        key=lambda c: (c.get("lastConnected") or c.get("createdAt") or ""),
        reverse=True
    )
    # Limit to 20 most recent to reduce payload size
    limited_connections = sorted_connections[:20]

    return {
        "status": "ok",
        "connections": limited_connections,
        "templates": hydrated_templates,
        "last_used": _state_store().get_last_used(),
        "correlation_id": correlation_id,
    }


def templates_catalog(request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    catalog = build_unified_template_catalog()
    return {"status": "ok", "templates": catalog, "correlation_id": correlation_id}


def list_templates(status: Optional[str], request: Request):
    templates = _state_store().list_templates()
    if status:
        status_lower = status.lower()
        # Compatibility: legacy records may store schedulable templates as
        # "active" instead of "approved".
        if status_lower == "approved":
            templates = [t for t in templates if (t.get("status") or "").lower() in {"approved", "active"}]
        else:
            templates = [t for t in templates if (t.get("status") or "").lower() == status_lower]
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    hydrated = _ensure_template_mapping_keys(templates)
    return {"status": "ok", "templates": hydrated, "correlation_id": correlation_id}


def recommend_templates(payload: TemplateRecommendPayload, request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    catalog = build_unified_template_catalog()

    def _dedupe_str_list(values: list[str] | None) -> list[str]:
        if not values:
            return []
        seen: set[str] = set()
        cleaned: list[str] = []
        for raw in values:
            text = str(raw or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            cleaned.append(text)
        return cleaned

    hints: dict[str, Any] = {}

    kind_values: list[str] = []
    if payload.kind:
        kind_values.append(payload.kind)
    if getattr(payload, "kinds", None):
        kind_values.extend(payload.kinds or [])
    kinds = _dedupe_str_list(kind_values)
    if payload.kind:
        kind = str(payload.kind or "").strip()
        if kind:
            hints["kind"] = kind
    if kinds:
        hints["kinds"] = kinds

    domain_values: list[str] = []
    if payload.domain:
        domain_values.append(payload.domain)
    if getattr(payload, "domains", None):
        domain_values.extend(payload.domains or [])
    domains = _dedupe_str_list(domain_values)
    if payload.domain:
        domain = str(payload.domain or "").strip()
        if domain:
            hints["domain"] = domain
    if domains:
        hints["domains"] = domains

    if payload.schema_snapshot is not None:
        hints["schema_snapshot"] = payload.schema_snapshot
    tables = _dedupe_str_list(payload.tables)
    if tables:
        hints["tables"] = tables

    raw_recs = recommend_templates_from_catalog(
        catalog,
        requirement=payload.requirement,
        hints=hints,
        max_results=6,
    )

    catalog_by_id: dict[str, dict[str, Any]] = {}
    for item in catalog:
        if isinstance(item, dict):
            tid = str(item.get("id") or "").strip()
            if tid and tid not in catalog_by_id:
                catalog_by_id[tid] = item

    recommendations: list[TemplateRecommendation] = []
    for rec in raw_recs:
        tid = str(rec.get("id") or "").strip()
        if not tid:
            continue
        template = catalog_by_id.get(tid)
        if not template:
            continue
        explanation = str(rec.get("explanation") or "").strip()
        try:
            score = float(rec.get("score") or 0.0)
        except Exception:
            score = 0.0
        recommendations.append(
            TemplateRecommendation(
                template=template,
                explanation=explanation,
                score=score,
            )
        )

    return TemplateRecommendResponse(recommendations=recommendations)


def delete_template(template_id: str, request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    existing_record = _state_store().get_template_record(template_id)
    template_kind = _resolve_template_kind(template_id)
    tdir = template_dir(template_id, must_exist=False, create=False, kind=template_kind)

    lock_ctx: contextlib.AbstractContextManager[Any] = contextlib.nullcontext()
    if tdir.exists():
        try:
            lock_ctx = acquire_template_lock(tdir, "template_delete", correlation_id)
        except TemplateLockError:
            raise _http_error(
                409,
                "template_locked",
                "Template is currently processing another request.",
            )

    removed_dir = False
    with lock_ctx:
        if tdir.exists():
            try:
                _robust_rmtree(tdir)
                removed_dir = True
            except FileNotFoundError:
                removed_dir = False
            except Exception as exc:
                raise _http_error(
                    500,
                    "template_delete_failed",
                    f"Failed to remove template files: {exc}",
                )

        removed_state = _state_store().delete_template(template_id)

    if not removed_state and not removed_dir and existing_record is None:
        raise _http_error(404, "template_not_found", "template_id not found")

    return {
        "status": "ok",
        "template_id": template_id,
        "correlation_id": correlation_id,
    }


def update_template_metadata(template_id: str, payload: TemplateUpdatePayload, request: Request):
    correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id()
    record = _state_store().get_template_record(template_id)
    if not record:
        raise _http_error(404, "template_not_found", "template_id not found")

    name = payload.name if payload.name is not None else record.get("name") or template_id
    if payload.name is not None and not is_safe_name(name):
        raise _http_error(400, "invalid_name", "Template name contains invalid characters")

    description = payload.description if payload.description is not None else record.get("description")
    if description is not None:
        description = str(description).strip()
        if len(description) > 280:
            raise _http_error(400, "description_too_long", "Description is limited to 280 characters")

    tags = _normalize_tags(payload.tags) if payload.tags is not None else list(record.get("tags") or [])
    status = payload.status if payload.status is not None else record.get("status") or "draft"
    status_norm = str(status or "").strip().lower()
    if status_norm not in {"draft", "pending", "approved", "archived"}:
        raise _http_error(400, "invalid_status", "Status must be draft, pending, approved, or archived")

    updated = _state_store().upsert_template(
        template_id,
        name=name,
        status=status_norm,
        description=description,
        artifacts=record.get("artifacts") or {},
        tags=tags,
        connection_id=record.get("last_connection_id"),
        mapping_keys=record.get("mapping_keys"),
        template_type=record.get("kind") or "pdf",
    )

    return {
        "status": "ok",
        "template": updated,
        "correlation_id": correlation_id,
    }


def _ensure_template_mapping_keys(records: list[dict]) -> list[dict]:
    hydrated: list[dict] = []
    for record in records:
        mapping_keys = record.get("mappingKeys") or []
        if mapping_keys:
            hydrated.append(record)
            continue
        template_id = record.get("id")
        if not template_id:
            hydrated.append(record)
            continue

        kind = record.get("kind") or "pdf"
        try:
            tdir = template_dir(template_id, must_exist=False, create=False, kind=kind)
        except HTTPException:
            hydrated.append(record)
            continue

        keys = load_mapping_keys(tdir)
        if not keys:
            hydrated.append(record)
            continue

        new_record = dict(record)
        new_record["mappingKeys"] = keys
        hydrated.append(new_record)

        try:
            _state_store().upsert_template(
                template_id,
                name=record.get("name") or f"Template {template_id[:8]}",
                status=record.get("status") or "unknown",
                artifacts=record.get("artifacts") or {},
                tags=record.get("tags") or [],
                connection_id=record.get("lastConnectionId"),
                mapping_keys=keys,
                template_type=kind,
            )
        except Exception:
            pass
    return hydrated




# ==============================================================================
# SECTION: SERVICES: report_service
# ==============================================================================

EVENT_BUS = EventBus(middlewares=[logging_middleware(logger), metrics_middleware(logger)])
RENDER_STRATEGIES = build_render_strategy_registry()
NOTIFICATION_STRATEGIES = build_notification_strategy_registry()

_UPLOAD_KIND_PREFIXES: dict[str, str] = {"pdf": "uploads", "excel": "excel-uploads"}
UPLOAD_ROOT_BASE = UPLOAD_ROOT.resolve()
EXCEL_UPLOAD_ROOT_BASE = EXCEL_UPLOAD_ROOT.resolve()

_DEFAULT_JOB_WORKERS = os.cpu_count() or 4
_JOB_MAX_WORKERS = max(int(os.getenv("NEURA_JOB_MAX_WORKERS", str(_DEFAULT_JOB_WORKERS)) or _DEFAULT_JOB_WORKERS), 1)
REPORT_JOB_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=_JOB_MAX_WORKERS,
    thread_name_prefix="nr-job",
)
_JOB_TASKS: set[asyncio.Task] = set()
_JOB_FUTURES: dict[str, concurrent.futures.Future] = {}
_JOB_THREADS: dict[str, int] = {}
_JOB_PROCESSES: dict[str, set[int]] = {}
_JOB_PROCESS_LOCK = threading.RLock()
_SUBPROCESS_JOB_CONTEXT = threading.local()
_ORIGINAL_POPEN = subprocess.Popen


class _TrackingPopen(_ORIGINAL_POPEN):
    """Popen subclass that registers child PIDs with the active job context."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        job_id = getattr(_SUBPROCESS_JOB_CONTEXT, "job_id", None)
        if job_id and self.pid:
            _register_job_process(job_id, self.pid)


# Install once at import time — no reference counting needed.
subprocess.Popen = _TrackingPopen  # type: ignore[misc]


@contextlib.contextmanager
def _track_subprocess(job_id: str):
    """Set thread-local job context so _TrackingPopen records child PIDs."""
    _SUBPROCESS_JOB_CONTEXT.job_id = job_id
    try:
        yield
    finally:
        _SUBPROCESS_JOB_CONTEXT.job_id = None


def _is_job_cancelled(job_id: str | None) -> bool:
    if not job_id:
        return False
    try:
        record = _state_store().get_job(job_id) or {}
    except Exception:
        logger.exception("job_status_check_failed", extra={"event": "job_status_check_failed", "job_id": job_id})
        return False
    status = str(record.get("status") or "").lower()
    return status == "cancelled"


def _raise_if_cancelled(job_tracker: "JobRunTracker" | None) -> None:
    if _is_job_cancelled(job_tracker.job_id if job_tracker else None):
        raise _http_error(409, "job_cancelled", "Job was cancelled.")


def _http_error(status_code: int, code: str, message: str, details: str | None = None) -> HTTPException:
    payload: dict[str, Any] = {"status": "error", "code": code, "message": message}
    if details:
        payload["detail"] = details
    return HTTPException(status_code=status_code, detail=payload)


def _track_background_task(task: asyncio.Task) -> None:
    _JOB_TASKS.add(task)

    def _cleanup(t: asyncio.Task) -> None:
        _JOB_TASKS.discard(t)

    task.add_done_callback(_cleanup)


def _track_job_future(job_id: str, future: concurrent.futures.Future) -> None:
    if not job_id or future is None:
        return
    _JOB_FUTURES[job_id] = future

    def _cleanup(_: concurrent.futures.Future) -> None:
        _JOB_FUTURES.pop(job_id, None)

    future.add_done_callback(_cleanup)


def _register_job_thread(job_id: str) -> None:
    if not job_id:
        return
    try:
        _JOB_THREADS[job_id] = threading.get_ident()
    except Exception:
        logger.exception("job_thread_register_failed", extra={"event": "job_thread_register_failed", "job_id": job_id})


def _clear_job_thread(job_id: str) -> None:
    if not job_id:
        return
    _JOB_THREADS.pop(job_id, None)


def _register_job_process(job_id: str, pid: int) -> None:
    if not job_id or not pid:
        return
    with _JOB_PROCESS_LOCK:
        _JOB_PROCESSES.setdefault(job_id, set()).add(pid)


def _clear_job_processes(job_id: str) -> None:
    if not job_id:
        return
    with _JOB_PROCESS_LOCK:
        _JOB_PROCESSES.pop(job_id, None)


def _terminate_pid(pid: int, *, kill_tree: bool = True) -> bool:
    if not pid:
        return False
    try:
        if os.name == "nt" and kill_tree:
            # Use the real Popen to avoid recursive tracking.
            _ORIGINAL_POPEN(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        os.kill(pid, signal.SIGTERM)
        return True
    except Exception:
        return False


def _kill_job_processes(job_id: str, *, kill_tree: bool = True) -> None:
    if not job_id:
        return
    with _JOB_PROCESS_LOCK:
        pids = list(_JOB_PROCESSES.get(job_id) or [])
    for pid in pids:
        _terminate_pid(pid, kill_tree=kill_tree)
    _clear_job_processes(job_id)


def _inject_thread_cancel(thread_id: int) -> bool:
    """
    Best-effort cancellation for a running thread by injecting CancelledError.
    """
    if not thread_id:
        return False
    try:
        res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
            ctypes.c_long(thread_id), ctypes.py_object(asyncio.CancelledError)
        )
        if res > 1:
            ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_long(thread_id), 0)
            return False
        return res == 1
    except Exception:
        logger.exception(
            "job_force_cancel_injection_failed",
            extra={"event": "job_force_cancel_injection_failed", "thread_id": thread_id},
        )
        return False


def force_cancel_job(job_id: str, *, force: bool = False) -> bool:
    """
    Attempt to cancel a running or queued job. When force=True, injects a CancelledError
    into the worker thread if it is already running and terminates tracked child processes.
    """
    if not job_id:
        return False
    future = _JOB_FUTURES.get(job_id)
    cancelled = False
    if future and not future.done():
        cancelled = future.cancel()
    if force and not cancelled:
        thread_id = _JOB_THREADS.get(job_id)
        if thread_id:
            cancelled = _inject_thread_cancel(thread_id)
        _kill_job_processes(job_id, kill_tree=True)
    return cancelled


def _publish_event_safe(event: Event) -> None:
    try:
        # Try to get the running loop (Python 3.10+ safe approach)
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, schedule the coroutine
            asyncio.run_coroutine_threadsafe(EVENT_BUS.publish(event), loop)
        except RuntimeError:
            # No running loop, create a new one
            asyncio.run(EVENT_BUS.publish(event))
    except Exception:
        logger.exception(
            "event_bus_publish_failed",
            extra={"event": event.name, "correlation_id": event.correlation_id},
        )


def _job_error_message(detail: Any) -> str:
    if isinstance(detail, Mapping):
        message = detail.get("message") or detail.get("detail")
        if message:
            return str(message)
        return json.dumps(detail, ensure_ascii=False)
    return str(detail)


_TEMPLATE_ID_SAFE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,180}$")


def _normalize_template_id(template_id: str) -> str:
    raw = str(template_id or "").strip()
    candidate = raw.replace("\\", "/").split("/")[-1].strip()
    if not candidate or candidate in {".", ".."}:
        raise _http_error(400, "invalid_template_id", "Invalid template_id format")
    normalized = candidate.lower()
    if _TEMPLATE_ID_SAFE_RE.fullmatch(normalized):
        return normalized
    try:
        return str(uuid.UUID(candidate))
    except (ValueError, TypeError):
        raise _http_error(400, "invalid_template_id", "Invalid template_id format")


def _template_dir(
    template_id: str,
    *,
    must_exist: bool = True,
    create: bool = False,
    kind: str = "pdf",
) -> Path:
    normalized_kind = (kind or "pdf").lower()
    if normalized_kind not in _UPLOAD_KIND_PREFIXES:
        raise _http_error(400, "invalid_template_kind", f"Unsupported template kind: {kind}")

    try:
        api_mod = importlib.import_module("backend.api")
        base_dir = getattr(api_mod, "UPLOAD_ROOT_BASE" if normalized_kind == "pdf" else "EXCEL_UPLOAD_ROOT_BASE")
    except Exception:
        base_dir = UPLOAD_ROOT_BASE if normalized_kind == "pdf" else EXCEL_UPLOAD_ROOT_BASE

    tid = _normalize_template_id(template_id)
    base_dir = base_dir.resolve()
    tdir = (base_dir / tid).resolve()
    if base_dir not in tdir.parents:
        raise _http_error(400, "invalid_template_path", "Invalid template_id path")
    if must_exist and not tdir.exists():
        raise _http_error(404, "template_not_found", "template_id not found")
    if create:
        tdir.mkdir(parents=True, exist_ok=True)
    return tdir


def _artifact_url(path: Path | None) -> Optional[str]:
    if path is None:
        return None
    path = Path(path)
    resolved = path.resolve()
    try:
        api_mod = importlib.import_module("backend.api")
        upload_root_base = getattr(api_mod, "UPLOAD_ROOT_BASE", UPLOAD_ROOT_BASE)
        excel_root_base = getattr(api_mod, "EXCEL_UPLOAD_ROOT_BASE", EXCEL_UPLOAD_ROOT_BASE)
    except Exception:
        upload_root_base = UPLOAD_ROOT_BASE
        excel_root_base = EXCEL_UPLOAD_ROOT_BASE
    mapping: dict[Path, str] = {
        upload_root_base: f"/{_UPLOAD_KIND_PREFIXES['pdf']}",
        excel_root_base: f"/{_UPLOAD_KIND_PREFIXES['excel']}",
    }
    for base, prefix in mapping.items():
        try:
            relative = resolved.relative_to(base)
        except ValueError:
            continue
        safe = relative.as_posix()
        return f"{prefix}/{safe}"
    return None


def _manifest_endpoint(template_id: str, kind: str = "pdf") -> str:
    if (kind or "pdf").lower() == "excel":
        return f"/excel/{template_id}/artifacts/manifest"
    return f"/templates/{template_id}/artifacts/manifest"


_EXCEL_SCALE_RE = re.compile(r"--excel-print-scale:\s*([0-9]*\.?[0-9]+)")


def _extract_excel_print_scale_from_html(html_path: Path) -> Optional[float]:
    try:
        html_text = html_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None
    match = _EXCEL_SCALE_RE.search(html_text)
    if not match:
        return None
    try:
        value = float(match.group(1))
    except (TypeError, ValueError):
        return None
    if value <= 0 or value > 1.0:
        return None
    return value


def _ensure_contract_files(template_id: str, *, kind: str = "pdf") -> tuple[Path, Path]:
    tdir = _template_dir(template_id, kind=kind)

    template_html_path = tdir / "report_final.html"
    if not template_html_path.exists():
        template_html_path = tdir / "template_p1.html"
    if not template_html_path.exists():
        raise _http_error(
            status_code=404,
            code="template_html_missing",
            message="No template HTML found (report_final.html or template_p1.html).",
        )

    contract_path = tdir / "contract.json"
    if not contract_path.exists():
        raise _http_error(
            status_code=400,
            code="contract_missing",
            message="Missing contract.json. Finish template approval/mapping to create a contract for generation.",
        )
    return template_html_path, contract_path


def _artifact_map_from_paths(
    out_html: Path,
    out_pdf: Path,
    out_docx: Path | None,
    out_xlsx: Path | None,
) -> dict[str, Path]:
    artifacts = {out_html.name: out_html, out_pdf.name: out_pdf}
    if out_docx:
        artifacts[out_docx.name] = out_docx
    if out_xlsx:
        artifacts[out_xlsx.name] = out_xlsx
    return artifacts


def _run_report_internal(
    p: RunPayload,
    *,
    kind: str = "pdf",
    correlation_id: str | None = None,
    job_tracker: JobRunTracker | None = None,
):
    def _ensure_not_cancelled():
        _raise_if_cancelled(job_tracker)

    run_started = time.time()
    logger.info(
        "reports_run_start",
        extra={
            "event": "reports_run_start",
            "template_id": p.template_id,
            "connection_id": p.connection_id,
            "template_kind": kind,
            "correlation_id": correlation_id,
        },
    )
    _ensure_not_cancelled()
    if job_tracker:
        job_tracker.step_running("dataLoad", label="Load database connection")
    db_path = db_path_from_payload_or_default(p.connection_id)
    if not db_path.exists():
        if job_tracker:
            job_tracker.step_failed("dataLoad", "Database not found")
        raise _http_error(400, "db_not_found", "Database not found")
    if job_tracker:
        job_tracker.step_succeeded("dataLoad")

    _ensure_not_cancelled()

    if job_tracker:
        job_tracker.step_running("contractCheck", label="Prepare contract")
    try:
        template_html_path, contract_path = _ensure_contract_files(p.template_id, kind=kind)
    except HTTPException as exc:
        if job_tracker:
            job_tracker.step_failed("contractCheck", _job_error_message(exc.detail))
        raise
    tdir = template_html_path.parent

    try:
        contract_data = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.exception("Invalid contract.json")
        if job_tracker:
            job_tracker.step_failed("contractCheck", "Invalid contract.json")
        raise _http_error(500, "invalid_contract", "Invalid contract.json")
    else:
        try:
            api_mod = importlib.import_module("backend.api")
            validate_fn = getattr(api_mod, "validate_contract_schema", validate_contract_schema)
        except Exception:
            validate_fn = validate_contract_schema
        try:
            validate_fn(contract_data)
        except Exception as exc:
            logger.exception("Contract schema validation failed")
            if job_tracker:
                job_tracker.step_failed("contractCheck", "Contract schema validation failed")
            raise _http_error(500, "invalid_contract", "Contract schema validation failed")
    if job_tracker:
        job_tracker.step_succeeded("contractCheck")

    key_values_payload = clean_key_values(p.key_values)

    docx_requested = bool(p.docx)
    xlsx_requested = bool(p.xlsx)
    docx_landscape = kind == "excel"
    docx_enabled = docx_requested  # DOCX is always opt-in; use /generate-docx for on-demand conversion
    # M5: Respect explicit xlsx=false; only auto-enable for excel templates when not specified
    xlsx_enabled = xlsx_requested if p.xlsx is not None else (kind == "excel")
    render_strategy = RENDER_STRATEGIES.resolve("excel" if docx_landscape or xlsx_enabled else "pdf")
    _ensure_not_cancelled()

    ts = str(int(time.time()))
    out_html = tdir / f"filled_{ts}.html"
    out_pdf = tdir / f"filled_{ts}.pdf"
    out_docx = tdir / f"filled_{ts}.docx" if docx_enabled else None
    out_xlsx = tdir / f"filled_{ts}.xlsx" if xlsx_enabled else None
    tmp_html = out_html.with_name(out_html.name + ".tmp")
    tmp_pdf = out_pdf.with_name(out_pdf.name + ".tmp")
    tmp_docx = out_docx.with_name(out_docx.name + ".tmp") if out_docx else None
    tmp_xlsx = out_xlsx.with_name(out_xlsx.name + ".tmp") if out_xlsx else None
    docx_path: Path | None = None
    docx_font_scale: float | None = None
    xlsx_path: Path | None = None

    try:
        lock_ctx = acquire_template_lock(tdir, "reports_run", correlation_id)
    except TemplateLockError:
        raise _http_error(409, "template_locked", "Template is currently processing another request.")

    with lock_ctx:
        try:
            _ensure_not_cancelled()
            initial_artifacts = _artifact_map_from_paths(out_html, out_pdf, out_docx, out_xlsx)
            try:
                write_artifact_manifest(
                    tdir,
                    step="reports_run_started",
                    files=initial_artifacts,
                    inputs=[str(contract_path), str(db_path)],
                    correlation_id=correlation_id,
                )
            except Exception:
                logger.exception(
                    "artifact_manifest_start_failed",
                    extra={
                        "event": "artifact_manifest_start_failed",
                        "template_id": p.template_id,
                        "correlation_id": correlation_id,
                    },
                )
            if job_tracker:
                job_tracker.step_running("renderPdf", label="Render PDF artifacts")
            if kind == "excel":
                from backend.app.services.reports import ReportGenerateExcel as report_generate_module
            else:
                from backend.app.services.reports import ReportGenerate as report_generate_module

            fill_and_print = report_generate_module.fill_and_print

            fill_and_print(
                OBJ=contract_data,
                TEMPLATE_PATH=template_html_path,
                DB_PATH=db_path,
                OUT_HTML=tmp_html,
                OUT_PDF=tmp_pdf,
                START_DATE=p.start_date,
                END_DATE=p.end_date,
                batch_ids=p.batch_ids,
                KEY_VALUES=key_values_payload,
                BRAND_KIT_ID=getattr(p, "brand_kit_id", None),
            )
            _ensure_not_cancelled()
            if tmp_html.exists():
                tmp_html.replace(out_html)
            if tmp_pdf.exists():
                tmp_pdf.replace(out_pdf)
            docx_step_tracked = bool(job_tracker and job_tracker.has_step("renderDocx"))
            if docx_enabled and out_docx and tmp_docx:
                _ensure_not_cancelled()
                if docx_step_tracked:
                    job_tracker.step_running("renderDocx", label="Render DOCX")
                docx_tmp_result: Path | None = None
                docx_error: str | None = None
                try:
                    if docx_landscape:
                        docx_font_scale = _extract_excel_print_scale_from_html(out_html) or docx_font_scale
                    docx_tmp_result = render_strategy.render_docx(
                        out_html,
                        out_pdf if out_pdf and Path(out_pdf).exists() else None,
                        tmp_docx,
                        landscape=docx_landscape,
                        font_scale=docx_font_scale or (0.82 if docx_landscape else None),
                    )
                except Exception as exc:
                    with contextlib.suppress(FileNotFoundError):
                        tmp_docx.unlink(missing_ok=True)
                    docx_error = f"DOCX export failed: {exc}"
                    logger.exception(
                        "docx_export_failed",
                        extra={
                            "event": "docx_export_failed",
                            "template_id": p.template_id,
                            "template_kind": kind,
                            "correlation_id": correlation_id,
                        },
                    )
                else:
                    if docx_tmp_result:
                        docx_tmp_path = Path(docx_tmp_result)
                        if docx_tmp_path != out_docx:
                            docx_tmp_path.replace(out_docx)
                        docx_path = out_docx
                    else:
                        with contextlib.suppress(FileNotFoundError):
                            tmp_docx.unlink(missing_ok=True)
                if docx_step_tracked:
                    if docx_error:
                        job_tracker.step_failed("renderDocx", docx_error)
                    else:
                        job_tracker.step_succeeded("renderDocx")
                if docx_path and not docx_error:
                    _publish_event_safe(
                        Event(
                            name="render.completed",
                            payload={"template_id": p.template_id, "kind": "docx"},
                            correlation_id=correlation_id,
                        )
                    )
            xlsx_step_tracked = bool(job_tracker and job_tracker.has_step("renderXlsx"))
            if xlsx_enabled and out_xlsx and tmp_xlsx:
                _ensure_not_cancelled()
                if xlsx_step_tracked:
                    job_tracker.step_running("renderXlsx", label="Render XLSX")
                xlsx_error: str | None = None
                try:
                    xlsx_tmp_result = render_strategy.render_xlsx(out_html, tmp_xlsx)
                except Exception as exc:
                    with contextlib.suppress(FileNotFoundError):
                        tmp_xlsx.unlink(missing_ok=True)
                    logger.exception(
                        "xlsx_export_failed",
                        extra={
                            "event": "xlsx_export_failed",
                            "template_id": p.template_id,
                            "template_kind": kind,
                            "correlation_id": correlation_id,
                        },
                    )
                    xlsx_error = f"XLSX export failed: {exc}"
                else:
                    if xlsx_tmp_result:
                        xlsx_tmp_path = Path(xlsx_tmp_result)
                        if xlsx_tmp_path != out_xlsx:
                            xlsx_tmp_path.replace(out_xlsx)
                        xlsx_path = out_xlsx
                    else:
                        with contextlib.suppress(FileNotFoundError):
                            tmp_xlsx.unlink(missing_ok=True)
                if xlsx_step_tracked:
                    if xlsx_error:
                        job_tracker.step_failed("renderXlsx", xlsx_error)
                    else:
                        job_tracker.step_succeeded("renderXlsx")
                if xlsx_path and not xlsx_error:
                    _publish_event_safe(
                        Event(
                            name="render.completed",
                            payload={"template_id": p.template_id, "kind": "xlsx"},
                            correlation_id=correlation_id,
                        )
                    )
        except ImportError:
            raise _http_error(
                501,
                "report_module_missing",
                (
                    "Report generation module not found. "
                    "Add .app.services.reports.ReportGenerate.fill_and_print("
                    "OBJ, TEMPLATE_PATH, DB_PATH, OUT_HTML, OUT_PDF, START_DATE, END_DATE, batch_ids=None)."
                ),
            )
        except Exception as exc:
            with contextlib.suppress(FileNotFoundError):
                tmp_html.unlink(missing_ok=True)
            with contextlib.suppress(FileNotFoundError):
                tmp_pdf.unlink(missing_ok=True)
            if tmp_docx is not None:
                with contextlib.suppress(FileNotFoundError):
                    tmp_docx.unlink(missing_ok=True)
            if tmp_xlsx is not None:
                with contextlib.suppress(FileNotFoundError):
                    tmp_xlsx.unlink(missing_ok=True)
            logger.exception("Report generation failed")
            if job_tracker:
                job_tracker.step_failed("renderPdf", "Report generation failed")
            raise _http_error(500, "report_generation_failed", "Report generation failed")
    if job_tracker:
        job_tracker.step_succeeded("renderPdf")

    _ensure_not_cancelled()

    artifact_files = _artifact_map_from_paths(out_html, out_pdf, out_docx, out_xlsx)

    if job_tracker and job_tracker.has_step("finalize"):
        job_tracker.step_running("finalize", label="Finalize artifacts")
    write_artifact_manifest(
        tdir,
        step="reports_run",
        files=artifact_files,
        inputs=[str(contract_path), str(db_path)],
        correlation_id=correlation_id,
    )
    if job_tracker and job_tracker.has_step("finalize"):
        job_tracker.step_succeeded("finalize")

    manifest_data = load_manifest(tdir) or {}
    manifest_url = _manifest_endpoint(p.template_id, kind=kind)
    _state_store().record_template_run(p.template_id, p.connection_id)
    _state_store().set_last_used(p.connection_id, p.template_id)

    logger.info(
        "reports_run_complete",
        extra={
            "event": "reports_run_complete",
            "template_id": p.template_id,
            "html": str(out_html.name),
            "pdf": str(out_pdf.name),
            "docx": str(out_docx.name) if docx_path and out_docx else None,
            "xlsx": str(out_xlsx.name) if xlsx_path and out_xlsx else None,
            "correlation_id": correlation_id,
            "elapsed_ms": int((time.time() - run_started) * 1000),
        },
    )

    run_id = str(uuid.uuid4())
    result = {
        "ok": True,
        "run_id": run_id,
        "template_id": p.template_id,
        "start_date": p.start_date,
        "end_date": p.end_date,
        "html_url": _artifact_url(out_html),
        "pdf_url": _artifact_url(out_pdf),
        "docx_url": _artifact_url(out_docx) if docx_path and out_docx else None,
        "xlsx_url": _artifact_url(out_xlsx) if xlsx_path and out_xlsx else None,
        "manifest_url": manifest_url,
        "manifest_produced_at": manifest_data.get("produced_at"),
        "correlation_id": correlation_id,
    }
    try:
        template_record = _state_store().get_template_record(p.template_id) or {}
        connection_record = _state_store().get_connection_record(p.connection_id) if p.connection_id else {}
        from datetime import datetime, timezone
        run_finished_iso = datetime.now(timezone.utc).isoformat()
        run_started_iso = datetime.fromtimestamp(run_started, tz=timezone.utc).isoformat()
        _state_store().record_report_run(
            run_id,
            template_id=p.template_id,
            template_name=template_record.get("name") or p.template_id,
            template_kind=kind,
            connection_id=p.connection_id,
            connection_name=(connection_record or {}).get("name"),
            start_date=p.start_date,
            end_date=p.end_date,
            batch_ids=p.batch_ids,
            key_values=key_values_payload,
            status="succeeded",
            artifacts={
                "html_url": result.get("html_url"),
                "pdf_url": result.get("pdf_url"),
                "docx_url": result.get("docx_url"),
                "xlsx_url": result.get("xlsx_url"),
                "manifest_url": result.get("manifest_url"),
            },
            schedule_id=p.schedule_id,
            schedule_name=p.schedule_name,
            created_at=run_started_iso,
        )
    except Exception:
        logger.exception(
            "report_run_history_record_failed",
            extra={
                "event": "report_run_history_record_failed",
                "template_id": p.template_id,
                "correlation_id": correlation_id,
            },
        )
    artifact_paths = {
        "html": out_html if out_html.exists() else None,
        "pdf": out_pdf if out_pdf.exists() else None,
        "docx": docx_path if docx_path and docx_path.exists() else None,
        "xlsx": xlsx_path if xlsx_path and xlsx_path.exists() else None,
    }

    # Post-generation agent hooks (fire-and-forget, non-blocking)
    try:
        _run_post_generation_hooks(run_id, p.template_id, kind, correlation_id)
    except Exception:
        logger.debug("post_generation_hooks_skipped")

    return result, artifact_paths


def _run_post_generation_hooks(
    run_id: str,
    template_id: str,
    kind: str,
    correlation_id: str | None,
) -> None:
    """
    Fire-and-forget post-generation agent hooks.

    Controlled by NEURA_REPORT_AGENT_HOOKS env var (comma-separated list).
    Supported hooks: summarize, insights
    Failures are logged but never block report delivery.
    """
    hooks_raw = os.getenv("NEURA_REPORT_AGENT_HOOKS", "").strip()
    if not hooks_raw:
        return

    hooks = [h.strip().lower() for h in hooks_raw.split(",") if h.strip()]
    if not hooks:
        return

    HOOK_TO_ANALYSIS_TYPE = {
        "summarize": "summarize",
        "insights": "insights",
    }

    for hook in hooks:
        analysis_type = HOOK_TO_ANALYSIS_TYPE.get(hook)
        if not analysis_type:
            logger.warning("Unknown report agent hook: %s (supported: %s)", hook, ", ".join(HOOK_TO_ANALYSIS_TYPE))
            continue

        try:
            import asyncio
            from backend.app.services.agents import AgentService

            service = AgentService()

            async def _run_hook(at=analysis_type, rid=run_id):
                try:
                    await service.run_report_analyst(
                        run_id=rid,
                        analysis_type=at,
                        sync=False,  # async — don't block report delivery
                    )
                    logger.info(
                        "report_agent_hook_queued",
                        extra={
                            "event": "report_agent_hook_queued",
                            "hook": at,
                            "run_id": rid,
                        },
                    )
                except Exception as exc:
                    logger.warning(
                        "report_agent_hook_failed",
                        extra={
                            "event": "report_agent_hook_failed",
                            "hook": at,
                            "run_id": rid,
                            "error": str(exc),
                        },
                    )

            # Schedule on the running event loop if available, else ignore
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_run_hook())
            except RuntimeError:
                # No running event loop (synchronous context) — run in thread
                import threading

                def _thread_runner():
                    asyncio.run(_run_hook())

                t = threading.Thread(target=_thread_runner, daemon=True, name=f"agent-hook-{hook}-{run_id[:8]}")
                t.start()

        except Exception as exc:
            logger.warning(
                "report_agent_hook_setup_failed",
                extra={
                    "event": "report_agent_hook_setup_failed",
                    "hook": hook,
                    "run_id": run_id,
                    "error": str(exc),
                },
            )


def _maybe_send_email(
    p: RunPayload,
    artifact_paths: Mapping[str, Optional[Path]],
    run_result: Mapping[str, Any],
    *,
    kind: str,
    correlation_id: str | None,
    job_tracker: JobRunTracker | None = None,
) -> None:
    notification_strategy = NOTIFICATION_STRATEGIES.resolve("email")
    _raise_if_cancelled(job_tracker)
    recipients = normalize_email_targets(p.email_recipients)
    email_step_tracked = bool(job_tracker and job_tracker.has_step("email"))
    if not recipients:
        if email_step_tracked:
            job_tracker.step_succeeded("email")
        return
    if email_step_tracked:
        job_tracker.step_running("email", label="Send notification email")
    attachments: list[Path] = []
    for key in ("pdf", "docx", "xlsx"):
        path = artifact_paths.get(key)
        if isinstance(path, Path) and path.exists():
            attachments.append(path)
    if not attachments:
        fallback = artifact_paths.get("html")
        if isinstance(fallback, Path) and fallback.exists():
            attachments.append(fallback)
    if not attachments:
        return
    template_record = _state_store().get_template_record(p.template_id) or {}
    template_name = template_record.get("name") or p.template_id
    default_subject = f"Report run for {template_name}"
    subject = (p.email_subject or default_subject).strip()
    if not subject:
        subject = default_subject
    if p.email_message:
        body = p.email_message.strip()
    else:
        artifact_lines = []
        for key in ("pdf_url", "docx_url", "xlsx_url", "html_url"):
            url = run_result.get(key)
            if url:
                label = key.replace("_url", "").upper()
                artifact_lines.append(f"{label}: {url}")
        lines = [
            f"Template: {template_name} ({p.template_id})",
            f"Run kind: {kind}",
            f"Range: {p.start_date} -> {p.end_date}",
        ]
        if artifact_lines:
            lines.append("")
            lines.append("Artifacts:")
            lines.extend(artifact_lines)
        lines.append("")
        lines.append("This notification was generated automatically by NeuraReport.")
        body = "\n".join(lines)

    success = notification_strategy.send(
        recipients=recipients,
        subject=subject,
        body=body,
        attachments=attachments,
    )
    if email_step_tracked:
        if success:
            job_tracker.step_succeeded("email")
        else:
            job_tracker.step_failed("email", "Email delivery failed")
    _publish_event_safe(
        Event(
            name="notification.sent" if success else "notification.failed",
            payload={
                "template_id": p.template_id,
                "kind": kind,
                "recipients": len(recipients),
            },
            correlation_id=correlation_id,
        )
    )
    logger.info(
        "report_email_attempt",
        extra={
            "event": "report_email_attempt",
            "template_id": p.template_id,
            "recipients": len(recipients),
            "correlation_id": correlation_id,
            "status": "sent" if success else "skipped",
        },
    )


def _run_report_with_email(
    p: RunPayload,
    *,
    kind: str,
    correlation_id: str | None = None,
    job_tracker: JobRunTracker | None = None,
) -> dict:
    result, artifact_paths = _run_report_internal(p, kind=kind, correlation_id=correlation_id, job_tracker=job_tracker)
    _maybe_send_email(
        p,
        artifact_paths,
        result,
        kind=kind,
        correlation_id=correlation_id,
        job_tracker=job_tracker,
    )
    return result


def _run_report_job_sync(
    job_id: str,
    payload_data: Mapping[str, Any],
    kind: str,
    correlation_id: str,
    step_progress: Mapping[str, float],
) -> None:
    # If job was cancelled before starting, short-circuit.
    if _is_job_cancelled(job_id):
        logger.info("report_job_skipped_cancelled", extra={"event": "report_job_skipped_cancelled", "job_id": job_id})
        return

    # Import retry/webhook services
    try:
        from backend.app.services.reports import is_retriable_error
        from backend.app.services.reports import send_job_webhook_sync
    except ImportError:
        is_retriable_error = lambda e: True  # Default to retriable
        send_job_webhook_sync = None

    _register_job_thread(job_id)
    tracker = JobRunTracker(job_id, correlation_id=correlation_id, step_progress=step_progress)
    tracker.start()
    _publish_event_safe(Event(name="job.started", payload={"job_id": job_id, "kind": kind}, correlation_id=correlation_id))

    # Start heartbeat thread to indicate worker is alive
    heartbeat_stop = threading.Event()
    worker_id = f"worker-{threading.get_ident()}"

    def _heartbeat_worker():
        while not heartbeat_stop.is_set():
            try:
                _state_store().update_job_heartbeat(job_id, worker_id=worker_id)
            except Exception:
                logger.debug("heartbeat_update_failed", extra={"job_id": job_id})
            heartbeat_stop.wait(timeout=30)

    heartbeat_thread = threading.Thread(target=_heartbeat_worker, daemon=True, name=f"heartbeat-{job_id[:8]}")
    heartbeat_thread.start()

    @contextlib.contextmanager
    def _patch_subprocess_tracking():
        if not job_id:
            yield
            return
        with _track_subprocess(job_id):
            yield

    job_succeeded = False
    job_error: str | None = None

    try:
        api_mod = importlib.import_module("backend.api")
        run_fn = getattr(api_mod, "_run_report_with_email", _run_report_with_email)
    except Exception:
        run_fn = _run_report_with_email
    try:
        run_payload = RunPayload(**payload_data)
    except Exception as exc:
        tracker.fail("Invalid payload")
        job_error = "Invalid payload"
        logger.exception(
            "report_job_payload_invalid",
            extra={"event": "report_job_payload_invalid", "job_id": job_id},
        )
        # Mark as non-retriable since payload is invalid
        _state_store().record_job_completion(job_id, status="failed", error=job_error)
        return
    try:
        with _patch_subprocess_tracking():
            result = run_fn(run_payload, kind=kind, correlation_id=correlation_id, job_tracker=tracker)
    except HTTPException as exc:
        error_message = _job_error_message(exc.detail)
        error_code = str(exc.detail.get("code") or "").lower() if isinstance(exc.detail, Mapping) else ""
        is_cancelled = error_code == "job_cancelled"
        job_error = error_message
        # Print to stderr so it appears in Tauri desktop logs
        import traceback
        print(f"[REPORT_ERROR] job={job_id} http_error={error_message} code={error_code}", flush=True)
        traceback.print_exc()

        if is_cancelled:
            tracker.fail(error_message, status="cancelled")
            logger.info("report_job_cancelled", extra={
                "event": "report_job_cancelled",
                "job_id": job_id,
                "template_id": run_payload.template_id,
                "correlation_id": correlation_id,
            })
            _publish_event_safe(
                Event(
                    name="job.cancelled",
                    payload={"job_id": job_id, "kind": kind, "status": "cancelled"},
                    correlation_id=correlation_id,
                )
            )
        else:
            # Check if error is retriable
            retriable = is_retriable_error(error_message)
            if retriable:
                # Mark for retry instead of permanent failure
                _state_store().mark_job_for_retry(job_id, reason=error_message, is_retriable=True)
                logger.warning("report_job_marked_for_retry", extra={
                    "event": "report_job_marked_for_retry",
                    "job_id": job_id,
                    "error": error_message,
                    "correlation_id": correlation_id,
                })
                _publish_event_safe(
                    Event(
                        name="job.retry_scheduled",
                        payload={"job_id": job_id, "kind": kind, "error": error_message},
                        correlation_id=correlation_id,
                    )
                )
            else:
                tracker.fail(error_message, status="failed")
                logger.exception("report_job_http_error", extra={
                    "event": "report_job_http_error",
                    "job_id": job_id,
                    "template_id": run_payload.template_id,
                    "correlation_id": correlation_id,
                })
                _publish_event_safe(
                    Event(
                        name="job.failed",
                        payload={"job_id": job_id, "kind": kind, "error": error_message},
                        correlation_id=correlation_id,
                    )
                )
    except (asyncio.CancelledError, KeyboardInterrupt, SystemExit) as exc:
        tracker.fail("Job cancelled", status="cancelled")
        job_error = "Job cancelled"
        logger.info(
            "report_job_force_cancelled",
            extra={
                "event": "report_job_force_cancelled",
                "job_id": job_id,
                "template_id": run_payload.template_id,
                "correlation_id": correlation_id,
                "exc": str(exc),
            },
        )
        _publish_event_safe(
            Event(
                name="job.cancelled",
                payload={"job_id": job_id, "kind": kind, "status": "cancelled"},
                correlation_id=correlation_id,
            )
        )
    except Exception as exc:
        error_str = str(exc)
        job_error = "Report generation failed"
        # Print full traceback to stderr so it appears in Tauri desktop logs
        import traceback
        print(f"[REPORT_ERROR] job={job_id} error={error_str}", flush=True)
        traceback.print_exc()

        # Check if error is retriable
        retriable = is_retriable_error(error_str)
        if retriable:
            # Mark for retry instead of permanent failure
            _state_store().mark_job_for_retry(job_id, reason=error_str, is_retriable=True)
            logger.warning("report_job_marked_for_retry", extra={
                "event": "report_job_marked_for_retry",
                "job_id": job_id,
                "error": error_str,
                "correlation_id": correlation_id,
            })
            _publish_event_safe(
                Event(
                    name="job.retry_scheduled",
                    payload={"job_id": job_id, "kind": kind, "error": error_str},
                    correlation_id=correlation_id,
                )
            )
        else:
            tracker.fail(error_str)
            logger.exception(
                "report_job_failed",
                extra={
                    "event": "report_job_failed",
                    "job_id": job_id,
                    "template_id": run_payload.template_id,
                    "correlation_id": correlation_id,
                },
            )
            _publish_event_safe(
                Event(
                    name="job.failed",
                    payload={"job_id": job_id, "kind": kind, "error": error_str},
                    correlation_id=correlation_id,
                )
            )
    else:
        job_succeeded = True
        tracker.succeed(result)
        _publish_event_safe(
            Event(
                name="job.completed",
                payload={"job_id": job_id, "kind": kind, "status": "succeeded"},
                correlation_id=correlation_id,
            )
        )
    finally:
        # Stop heartbeat thread
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=5)

        _clear_job_thread(job_id)
        _clear_job_processes(job_id)

        # Send webhook notification if job completed (success or permanent failure)
        if send_job_webhook_sync is not None:
            try:
                job_record = _state_store().get_job(job_id)
                if job_record and job_record.get("webhookUrl"):
                    job_status = str(job_record.get("status") or "").lower()
                    # Only send webhook for terminal states (not pending_retry)
                    if job_status in {"succeeded", "failed", "cancelled"}:
                        webhook_result = send_job_webhook_sync(job_record)
                        if webhook_result.success:
                            _state_store().mark_webhook_sent(job_id)
                            logger.info("webhook_sent", extra={"job_id": job_id, "status": job_status})
                        else:
                            logger.warning("webhook_failed", extra={
                                "job_id": job_id,
                                "error": webhook_result.error,
                            })
            except Exception:
                logger.exception("webhook_send_error", extra={"job_id": job_id})


def _schedule_report_job(
    job_id: str,
    payload_data: Mapping[str, Any],
    kind: str,
    correlation_id: str,
    step_progress: Mapping[str, float],
) -> None:
    _publish_event_safe(
        Event(
            name="job.enqueued",
            payload={"job_id": job_id, "kind": kind},
            correlation_id=correlation_id,
        )
    )

    async def runner() -> None:
        try:
            future = asyncio.get_running_loop().run_in_executor(
                REPORT_JOB_EXECUTOR,
                _run_report_job_sync,
                job_id,
                payload_data,
                kind,
                correlation_id,
                step_progress,
            )
            _track_job_future(job_id, future)
            await future
        except Exception:
            logger.exception(
                "report_job_task_failed",
                extra={"event": "report_job_task_failed", "job_id": job_id, "correlation_id": correlation_id},
            )

    task = asyncio.create_task(runner())
    _track_background_task(task)


def _normalize_run_payloads(raw: RunPayload | Sequence[Any]) -> list[RunPayload]:
    """
    Accept a single run payload or a sequence of payloads and normalize to RunPayload instances.
    """
    if isinstance(raw, RunPayload):
        return [raw]
    if isinstance(raw, Mapping) and "runs" in raw:
        return _normalize_run_payloads(raw.get("runs") or [])
    if isinstance(raw, Iterable) and not isinstance(raw, (str, bytes)):
        normalized: list[RunPayload] = []
        for idx, item in enumerate(raw):
            if isinstance(item, RunPayload):
                normalized.append(item)
                continue
            if isinstance(item, Mapping):
                try:
                    normalized.append(RunPayload(**item))
                    continue
                except Exception as exc:
                    logger.exception("Invalid run payload at index %d", idx)
                    raise _http_error(400, "invalid_payload", f"Invalid run payload at index {idx}")
            raise _http_error(400, "invalid_payload", "Payload entries must be run payload objects or mappings")
        if not normalized:
            raise _http_error(400, "invalid_payload", "At least one run payload is required")
        return normalized
    raise _http_error(400, "invalid_payload", "Payload must be a run payload or a list of run payloads")


async def queue_report_job(p: RunPayload | Sequence[Any], request: Request, *, kind: str) -> dict:
    correlation_base = getattr(request.state, "correlation_id", None) or f"job-{uuid.uuid4().hex[:10]}"
    payloads = _normalize_run_payloads(p)
    try:
        api_mod = importlib.import_module("backend.api")
        schedule_fn = getattr(api_mod, "_schedule_report_job", _schedule_report_job)
    except Exception:
        schedule_fn = _schedule_report_job

    scheduled_jobs: list[dict[str, Any]] = []
    for idx, payload in enumerate(payloads):
        correlation_id = correlation_base if len(payloads) == 1 else f"{correlation_base}-{idx + 1}"
        steps = _build_job_steps(payload, kind=kind)
        template_rec = _state_store().get_template_record(payload.template_id) or {}
        payload_data = payload.model_dump()
        job_record = _state_store().create_job(
            job_type="run_report",
            template_id=payload.template_id,
            connection_id=payload.connection_id,
            template_name=template_rec.get("name") or f"Template {payload.template_id[:8]}",
            template_kind=template_rec.get("kind") or kind,
            schedule_id=payload.schedule_id,
            correlation_id=correlation_id,
            steps=steps,
            meta={
                "start_date": payload.start_date,
                "end_date": payload.end_date,
                "docx": bool(payload.docx),
                "xlsx": bool(payload.xlsx),
                "payload": payload_data,
            },
        )
        step_progress = _step_progress_from_steps(steps)
        schedule_fn(job_record["id"], payload_data, kind, correlation_id, step_progress)
        logger.info(
            "job_enqueued",
            extra={
                "event": "job_enqueued",
                "job_id": job_record["id"],
                "template_id": payload.template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        scheduled_jobs.append(
            {
                "job_id": job_record["id"],
                "template_id": payload.template_id,
                "correlation_id": correlation_id,
                "kind": kind,
            }
        )

    job_ids = [job["job_id"] for job in scheduled_jobs]
    response: dict[str, Any] = {
        "job_id": job_ids[0],
        "job_ids": job_ids,
        "jobs": scheduled_jobs,
        "count": len(job_ids),
    }
    if len(job_ids) == 1:
        return {"job_id": job_ids[0]}
    return response


def recover_report_jobs(*, max_jobs: int = 50) -> int:
    """
    Attempt to requeue report jobs that were queued/running before a restart.

    Jobs must have a serialized payload stored in job meta to be recoverable.
    Returns the number of jobs requeued.
    """
    recovered = 0
    try:
        api_mod = importlib.import_module("backend.api")
        schedule_fn = getattr(api_mod, "_schedule_report_job", _schedule_report_job)
    except Exception:
        schedule_fn = _schedule_report_job

    jobs = _state_store().list_jobs(statuses=["queued", "running"], types=["run_report"], limit=0)
    for job in jobs:
        if max_jobs and recovered >= max_jobs:
            break
        job_id = job.get("id")
        if not job_id:
            continue
        meta = _state_store().get_job_meta(job_id) or {}
        payload = meta.get("payload")
        if not isinstance(payload, Mapping):
            _state_store().record_job_completion(
                job_id,
                status="failed",
                error="Server restarted before job could resume",
            )
            continue
        try:
            run_payload = RunPayload(**payload)
        except Exception as exc:
            logger.exception("Server restarted; job payload invalid for job %s", job_id)
            _state_store().record_job_completion(
                job_id,
                status="failed",
                error="Server restarted; job payload invalid",
            )
            continue

        kind = str(job.get("templateKind") or meta.get("template_kind") or payload.get("template_kind") or "pdf")
        steps = _build_job_steps(run_payload, kind=kind)
        step_progress = _step_progress_from_steps(steps)
        correlation_id = job.get("correlationId") or payload.get("correlation_id") or f"recovered-{job_id[:8]}"

        _state_store().record_job_completion(
            job_id,
            status="failed",
            error="Server restarted; job requeued",
        )

        template_rec = _state_store().get_template_record(run_payload.template_id) or {}
        new_job = _state_store().create_job(
            job_type="run_report",
            template_id=run_payload.template_id,
            connection_id=run_payload.connection_id,
            template_name=template_rec.get("name") or f"Template {run_payload.template_id[:8]}",
            template_kind=template_rec.get("kind") or kind,
            schedule_id=run_payload.schedule_id,
            correlation_id=correlation_id,
            steps=steps,
            meta={
                "start_date": run_payload.start_date,
                "end_date": run_payload.end_date,
                "docx": bool(run_payload.docx),
                "xlsx": bool(run_payload.xlsx),
                "payload": payload,
                "recovered_from": job_id,
            },
        )
        schedule_fn(new_job["id"], payload, kind, correlation_id, step_progress)
        recovered += 1

    return recovered


def list_report_runs(
    *,
    template_id: str | None = None,
    connection_id: str | None = None,
    schedule_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    return _state_store().list_report_runs(
        template_id=template_id,
        connection_id=connection_id,
        schedule_id=schedule_id,
        limit=limit,
    )


def get_report_run(run_id: str) -> dict | None:
    return _state_store().get_report_run(run_id)


def generate_docx_for_run(run_id: str) -> dict:
    """Generate DOCX on-demand from a completed run's PDF artifact.

    Raises ValueError if the run or PDF doesn't exist,
    RuntimeError if conversion fails.
    """
    store = _state_store()
    run = store.get_report_run(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")

    artifacts = run.get("artifacts") or {}
    if artifacts.get("docx_url"):
        return run  # already generated

    pdf_url = artifacts.get("pdf_url")
    if not pdf_url:
        raise ValueError("Run has no PDF artifact to convert")

    # Reverse-map the URL to a filesystem path.
    # PDF URLs look like: /uploads/<template_id>/…/filled_123.pdf
    #                  or: /excel-uploads/<template_id>/…/filled_123.pdf
    try:
        api_mod = importlib.import_module("backend.api")
        upload_root = getattr(api_mod, "UPLOAD_ROOT_BASE", UPLOAD_ROOT_BASE)
        excel_root = getattr(api_mod, "EXCEL_UPLOAD_ROOT_BASE", EXCEL_UPLOAD_ROOT_BASE)
    except Exception:
        upload_root = UPLOAD_ROOT_BASE
        excel_root = EXCEL_UPLOAD_ROOT_BASE

    pdf_path: Path | None = None
    for prefix, root in [("/uploads/", upload_root), ("/excel-uploads/", excel_root)]:
        if pdf_url.startswith(prefix):
            relative = pdf_url[len(prefix):]
            candidate = root / relative
            if candidate.exists():
                pdf_path = candidate
            break

    if not pdf_path or not pdf_path.exists():
        raise ValueError(f"PDF file not found on disk for URL: {pdf_url}")

    docx_path = pdf_path.with_suffix(".docx")

    pass  # pdf_file_to_docx imported at module top

    logger.info("generate_docx_start", extra={
        "event": "generate_docx_start",
        "run_id": run_id,
        "pdf_path": str(pdf_path),
    })

    result = pdf_file_to_docx(pdf_path, docx_path)
    if not result:
        raise RuntimeError("DOCX conversion failed — check backend logs for details")

    # Build the docx_url the same way _artifact_url does
    docx_url = _artifact_url(docx_path)
    if not docx_url:
        raise RuntimeError("Could not build download URL for generated DOCX")

    updated = store.update_report_run_artifacts(run_id, {"docx_url": docx_url})
    logger.info("generate_docx_complete", extra={
        "event": "generate_docx_complete",
        "run_id": run_id,
        "docx_url": docx_url,
    })
    return updated or run


def _run_docx_job_sync(
    job_id: str,
    run_id: str,
    correlation_id: str,
) -> None:
    """Background worker: convert an existing run's PDF to DOCX."""
    if _is_job_cancelled(job_id):
        return
    _register_job_thread(job_id)
    store = _state_store()
    store.update_job(job_id, status="running")
    _publish_event_safe(
        Event(name="job.started", payload={"job_id": job_id, "type": "generate_docx"}, correlation_id=correlation_id)
    )
    try:
        result = generate_docx_for_run(run_id)
        store.update_job(job_id, status="succeeded")
        store.record_job_completion(job_id, status="succeeded")
        _publish_event_safe(
            Event(name="job.completed", payload={"job_id": job_id, "type": "generate_docx", "run_id": run_id}, correlation_id=correlation_id)
        )
    except (ValueError, RuntimeError) as exc:
        error_msg = str(exc)
        store.update_job(job_id, status="failed", error=error_msg)
        store.record_job_completion(job_id, status="failed", error=error_msg)
        logger.exception("docx_job_failed", extra={"event": "docx_job_failed", "job_id": job_id, "run_id": run_id})
        _publish_event_safe(
            Event(name="job.failed", payload={"job_id": job_id, "error": error_msg}, correlation_id=correlation_id)
        )
    except Exception as exc:
        error_msg = f"Unexpected error: {type(exc).__name__}: {exc}"
        store.update_job(job_id, status="failed", error=error_msg)
        store.record_job_completion(job_id, status="failed", error=error_msg)
        logger.exception("docx_job_failed", extra={"event": "docx_job_failed", "job_id": job_id, "run_id": run_id})
    finally:
        _clear_job_thread(job_id)


async def queue_generate_docx_job(run_id: str, request: Request) -> dict:
    """Queue a background job to generate DOCX from a completed run's PDF."""
    correlation_id = getattr(request.state, "correlation_id", None) or f"docx-{uuid.uuid4().hex[:10]}"
    store = _state_store()

    # Validate the run exists and has a PDF
    run = store.get_report_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"status": "error", "code": "run_not_found", "message": "Run not found."})
    artifacts = run.get("artifacts") or {}
    if artifacts.get("docx_url"):
        return {"job_id": None, "run_id": run_id, "status": "already_exists", "docx_url": artifacts["docx_url"], "correlation_id": correlation_id}
    if not artifacts.get("pdf_url"):
        raise HTTPException(status_code=400, detail={"status": "error", "code": "no_pdf", "message": "Run has no PDF artifact to convert."})

    steps = [{"name": "generateDocx", "label": "Convert PDF to DOCX"}]
    job_record = store.create_job(
        job_type="generate_docx",
        template_id=run.get("template_id") or "",
        connection_id=run.get("connection_id") or "",
        template_name=run.get("template_name") or "DOCX Conversion",
        template_kind="docx",
        correlation_id=correlation_id,
        steps=steps,
        meta={"run_id": run_id},
    )
    job_id = job_record["id"]

    async def _runner():
        try:
            future = asyncio.get_running_loop().run_in_executor(
                REPORT_JOB_EXECUTOR,
                _run_docx_job_sync,
                job_id,
                run_id,
                correlation_id,
            )
            _track_job_future(job_id, future)
            await future
        except Exception:
            logger.exception("docx_job_task_failed", extra={"event": "docx_job_task_failed", "job_id": job_id})

    task = asyncio.create_task(_runner())
    _track_background_task(task)

    logger.info("docx_job_enqueued", extra={"event": "docx_job_enqueued", "job_id": job_id, "run_id": run_id, "correlation_id": correlation_id})
    return {"job_id": job_id, "run_id": run_id, "status": "queued", "correlation_id": correlation_id}


def scheduler_runner(payload: dict, kind: str, *, job_tracker: JobRunTracker | None = None) -> dict:
    run_payload = RunPayload(**payload)
    correlation_id = payload.get("correlation_id") or f"sched-{payload.get('schedule_id') or uuid.uuid4()}"
    return _run_report_with_email(run_payload, kind=kind, correlation_id=correlation_id, job_tracker=job_tracker)


def run_report(p: RunPayload, request: Request, *, kind: str = "pdf"):
    correlation_id = getattr(request.state, "correlation_id", None)
    return _run_report_with_email(p, kind=kind, correlation_id=correlation_id)


# ── Artifact helpers ───────────────────────────────────────────────────────

def artifact_manifest_response(
    template_id: str,
    *,
    kind: str = "pdf",
    template_dir_fn: Callable[..., Path] = template_dir,
) -> dict:
    tdir = template_dir_fn(template_id, kind=kind, must_exist=True, create=False)
    manifest = load_manifest(tdir)
    if not manifest:
        raise HTTPException(status_code=404, detail="manifest_not_found")
    manifest = dict(manifest)
    manifest.setdefault("template_id", template_id)
    manifest.setdefault("kind", kind)
    return manifest


def artifact_head_response(
    template_id: str,
    name: str,
    *,
    kind: str = "pdf",
    template_dir_fn: Callable[..., Path] = template_dir,
) -> dict:
    tdir = template_dir_fn(template_id, kind=kind, must_exist=True, create=False)
    target = tdir / name
    if not target.resolve().is_relative_to(tdir.resolve()):
        raise HTTPException(status_code=400, detail="invalid_artifact_name")
    if not target.exists():
        raise HTTPException(status_code=404, detail="artifact_not_found")
    stat = target.stat()
    url = artifact_url(target)
    return {
        "template_id": template_id,
        "kind": kind,
        "name": name,
        "url": url,
        "size": stat.st_size,
        "modified": int(stat.st_mtime),
    }


# ── Post-import initialization ────────────────────────────────────────────
# Resolve lazy mapping_service names now that this module is fully loaded.
_init_mapping_service_names()
