"""Health check utilities -- moved from legacy_all.py."""
from __future__ import annotations

import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Tuple

from fastapi import Request
from fastapi.responses import JSONResponse

from backend.app.services.template_utils import APP_VERSION, APP_COMMIT


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
