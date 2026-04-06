"""Template path and artifact utilities -- moved from legacy_all.py.

Provides template_dir, normalize_template_id, manifest_endpoint, artifact_url,
find_reference_pdf, find_reference_png, mapping key helpers, clean_key_values, etc.
"""
from __future__ import annotations

import importlib
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from fastapi import HTTPException

from backend.app.services.config import get_settings
from backend.app.services.infra_services import write_json_atomic
from backend.app.common import http_error




# ── Settings-derived constants ────────────────────────────────────────────────

_SETTINGS = get_settings()
UPLOAD_ROOT: Path = _SETTINGS.uploads_root
EXCEL_UPLOAD_ROOT: Path = _SETTINGS.excel_uploads_root
APP_VERSION = _SETTINGS.version
APP_COMMIT = _SETTINGS.commit
SETTINGS = _SETTINGS

UPLOAD_KIND_PREFIXES: dict[str, str] = {
    "pdf": "/uploads",
    "excel": "/excel-uploads",
}


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


_TEMPLATE_ID_SAFE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,180}$")


def normalize_template_id(template_id: str) -> str:
    raw = str(template_id or "").strip()
    candidate = raw.replace("\\", "/").split("/")[-1].strip()
    if not candidate or candidate in {".", ".."}:
        raise http_error(400, "invalid_template_id", "Invalid template_id format")
    normalized = candidate.lower()
    if _TEMPLATE_ID_SAFE_RE.fullmatch(normalized):
        return normalized
    try:
        return str(uuid.UUID(candidate))
    except (ValueError, TypeError):
        raise http_error(400, "invalid_template_id", "Invalid template_id format")


def template_dir(template_id: str, *, must_exist: bool = True, create: bool = False, kind: str = "pdf") -> Path:
    normalized_kind = (kind or "pdf").lower()
    bases = _get_upload_kind_bases()
    if normalized_kind not in bases:
        raise http_error(400, "invalid_template_kind", f"Unsupported template kind: {kind}")

    base_dir = bases[normalized_kind][0]
    tid = normalize_template_id(template_id)

    tdir = (base_dir / tid).resolve()
    if base_dir not in tdir.parents:
        raise http_error(400, "invalid_template_path", "Invalid template_id path")

    if must_exist and not tdir.exists():
        raise http_error(404, "template_not_found", "template_id not found")

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


# ── Mapping key utilities ─────────────────────────────────────────────────────

_MAPPING_KEYS_FILENAME = "mapping_keys.json"


def mapping_keys_path(template_dir_path: Path) -> Path:
    return template_dir_path / _MAPPING_KEYS_FILENAME


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


def load_mapping_keys(template_dir_path: Path) -> list[str]:
    path = mapping_keys_path(template_dir_path)
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


def write_mapping_keys(template_dir_path: Path, keys: Iterable[str]) -> list[str]:
    normalized = normalize_key_tokens(keys)
    path = mapping_keys_path(template_dir_path)
    payload = {
        "keys": normalized,
        "updated_at": int(time.time()),
    }
    write_json_atomic(path, payload, ensure_ascii=False, indent=2, step="mapping_keys")
    return normalized


# ── Schedule utilities ────────────────────────────────────────────────────────

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
