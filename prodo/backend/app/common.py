"""Canonical utility functions shared across backend modules.

Eliminates duplicate definitions of _now(), _utc_now(), _now_iso(),
_state_store(), _http_error(), strip_code_fences(), _extract_json(),
and _quote_identifier() that were scattered across many service files.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException


# ── Time helpers ────────────────────────────────────────────────────────────

def utc_now() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    """Return current UTC datetime as an ISO-8601 string (second precision)."""
    return utc_now().replace(microsecond=0).isoformat()


# ── State store accessor ───────────────────────────────────────────────────

def get_state_store():
    """Return the singleton StateStore instance (lazy import to avoid cycles)."""
    from backend.app.repositories import state_store as _mod
    return _mod.state_store


# ── HTTP error builder ─────────────────────────────────────────────────────

def http_error(
    status_code: int,
    code: str,
    message: str,
    details: str | None = None,
) -> HTTPException:
    """Build a structured HTTPException with a JSON detail payload."""
    payload: dict[str, Any] = {
        "status": "error",
        "code": code,
        "message": message,
    }
    if details:
        payload["detail"] = details
    return HTTPException(status_code=status_code, detail=payload)


# ── Text / JSON helpers ───────────────────────────────────────────────────

_FENCE_PATTERN = re.compile(r"^\s*```(?:json|html|js)?\s*([\s\S]*?)```", re.IGNORECASE)
_FENCE_ANYWHERE = re.compile(r"```(?:json|html|js)?\s*([\s\S]*?)```", re.IGNORECASE)


def strip_code_fences(text: str) -> str:
    """Remove surrounding markdown code fences, returning the inner payload."""
    if not text:
        return ""
    match = _FENCE_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    match = _FENCE_ANYWHERE.search(text)
    if match:
        return match.group(1).strip()
    return text.strip()


def extract_json_from_text(raw: str) -> dict:
    """Extract a JSON object from an LLM response that may contain markdown fences."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text, count=1)
        text = re.sub(r"\n?```\s*$", "", text, count=1)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError(f"Expected JSON object, got {type(parsed).__name__}")
    return parsed


# ── SQL helpers ────────────────────────────────────────────────────────────

_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def quote_sql_identifier(name: str, label: str = "identifier") -> str:
    """Validate and double-quote a SQL identifier to prevent injection."""
    if not name or not _SAFE_IDENTIFIER_RE.match(name):
        raise ValueError(f"Invalid SQL {label}: {name!r}")
    return f'"{name}"'
