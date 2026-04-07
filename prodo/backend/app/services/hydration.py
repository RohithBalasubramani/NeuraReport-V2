"""
Hydration service — builds a complete store-hydration payload from session artifacts.

The payload is shaped like a ``chat_complete`` NDJSON event so the frontend can
process it through the existing ``processEvent()`` code path, populating all 28
pure-frontend widgets in one shot.

Used by:
  - ``GET /api/v1/pipeline/{session_id}/hydrate`` (on-demand)
  - ``HydrationDaemon`` (background pre-computation on state changes)
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Token extraction pattern (same as hermes_agent._build_status_view)
_TOKEN_RE = re.compile(r"\{\{?\s*([A-Za-z0-9_\-.]+)\s*\}\}?")

# Panel availability per pipeline state — mirrors hermes_agent._PANEL_AVAILABILITY
_PANEL_AVAILABILITY: dict[str, list[str]] = {
    "empty": [],
    "verifying": ["template"],
    "html_ready": ["template", "data"],
    "mapping": ["template", "data"],
    "mapped": ["template", "data", "mappings"],
    "approving": ["template", "data", "mappings"],
    "approved": ["template", "data", "mappings", "logic"],
    "correcting": ["template", "data", "mappings"],
    "building_assets": ["template", "data", "mappings", "logic", "errors"],
    "validating": ["template", "data", "mappings", "logic", "errors"],
    "validated": ["template", "data", "mappings", "logic", "preview", "errors"],
    "ready": ["template", "data", "mappings", "logic", "preview", "errors"],
    "generating": ["template", "data", "mappings", "logic", "preview", "errors"],
}


def _read_json(path: Path) -> Any | None:
    """Read and parse a JSON file, returning None on any failure."""
    try:
        if path.exists() and path.stat().st_size > 0:
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.debug("hydration: skipped %s", path.name, exc_info=True)
    return None


def _read_text(path: Path) -> str | None:
    """Read a text file, returning None on any failure."""
    try:
        if path.exists() and path.stat().st_size > 0:
            return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        logger.debug("hydration: skipped %s", path.name, exc_info=True)
    return None


def build_hydration_payload(session) -> dict:
    """Build a complete store hydration payload from session artifacts.

    Parameters
    ----------
    session : ChatSession
        The session whose artifacts to read.  Only files inside
        ``session.template_dir`` are touched (session isolation).

    Returns
    -------
    dict
        Shaped like a ``chat_complete`` event with ``action="hydrate"``
        so the frontend ``processEvent()`` can handle it directly.
    """
    tdir = Path(session.template_dir)
    state = session.pipeline_state.value

    payload: dict[str, Any] = {
        "event": "chat_complete",
        "action": "hydrate",
        "pipeline_state": state,
        "session_id": session.session_id,
        "connection_id": session.connection_id,
        "action_result": {},
    }

    ar = payload["action_result"]

    # ── 1. Template ──────────────────────────────────────────────────
    html = _read_text(tdir / "template_p1.html")
    if html:
        tokens = sorted(set(_TOKEN_RE.findall(html)))
        schema_data = _read_json(tdir / "schema_ext.json")
        ar["template"] = {
            "html": html,
            "tokens": tokens,
            "schema": schema_data,
        }

    # ── 2. Mapping ───────────────────────────────────────────────────
    mapping_raw = _read_json(tdir / "mapping_step3.json")
    if mapping_raw and isinstance(mapping_raw, dict):
        mapping_dict = mapping_raw.get("mapping", mapping_raw)
        meta = mapping_raw.get("meta", {})
        # Read persisted fields first (written by _mapping_preview_pipeline),
        # fall back to meta, then to heuristic for old sessions.
        confidence = mapping_raw.get("confidence") or meta.get("confidence", {})
        candidates = mapping_raw.get("candidates") or meta.get("candidates", {})
        confidence_reason = mapping_raw.get("confidence_reason", {})

        if not confidence:
            # Heuristic fallback for sessions created before persistence was added
            hints = meta.get("hints", {})
            for token, col in mapping_dict.items():
                if not isinstance(col, str):
                    continue
                if col == "UNRESOLVED":
                    confidence[token] = 0.0
                    confidence_reason[token] = "unresolved"
                elif col.startswith(("PARAM:", "LITERAL")) or col == "LATER_SELECTED":
                    confidence[token] = 1.0
                    confidence_reason[token] = "parameter"
                elif col.startswith(("COMPUTED", "SUM:", "RESHAPE")):
                    confidence[token] = 0.8
                    confidence_reason[token] = "computed"
                elif "." in col:
                    col_name = col.split(".")[-1].lower()
                    tok_clean = token.replace("row_", "").replace("total_", "").lower()
                    if tok_clean in col_name or col_name in tok_clean:
                        confidence[token] = 0.9
                        confidence_reason[token] = "name_match"
                    else:
                        confidence[token] = 0.6
                        confidence_reason[token] = "type_match"

            if not candidates and hints:
                for token, hint in hints.items():
                    cols = [ref.replace("columns:", "") for ref in hint.get("over", []) if isinstance(ref, str) and ref.startswith("columns:")]
                    if cols:
                        candidates[token] = cols

        ar["mapping"] = {
            "mapping": mapping_dict,
            "confidence": confidence,
            "candidates": candidates,
            "confidence_reason": confidence_reason,
            "token_samples": mapping_raw.get("token_samples", {}),
            "status": "mapped",
        }
        # Build catalog from DB so DataTab can list tables/columns
        if session.connection_id:
            try:
                from backend.app.services.legacy_services import (
                    build_rich_catalog_from_db,
                )
                from backend.app.repositories import resolve_db_path
                db_path = resolve_db_path(
                    connection_id=session.connection_id, db_url=None, db_path=None
                )
                ar["mapping"]["catalog"] = build_rich_catalog_from_db(db_path)
            except Exception:
                logger.debug("hydration: catalog build failed", exc_info=True)
        # Token color map from mapping keys (deterministic color assignment)
        token_sigs = mapping_raw.get("raw_payload", {}).get("token_signatures")
        if token_sigs:
            payload["token_color_map"] = token_sigs

    # ── 3. Contract ──────────────────────────────────────────────────
    contract_data = _read_json(tdir / "contract.json")
    if contract_data:
        ar["contract"] = contract_data if "contract" in contract_data else {"contract": contract_data}

    # ── 4. Validation ────────────────────────────────────────────────
    validation_data = _read_json(tdir / "validation_result.json")
    if validation_data:
        # The frontend derivePhase() checks validation.result === 'pass'.
        # The backend stores status/passed but not 'result', so we map it.
        if validation_data.get("passed") or validation_data.get("status") == "passed":
            validation_data["result"] = "pass"
        elif not validation_data.get("result"):
            validation_data["result"] = "fail"
        ar["validation"] = validation_data

    # ── 5. Generation / Dry Run ──────────────────────────────────────
    dry_run = _read_json(tdir / "dry_run_result.json")
    if dry_run:
        ar["generation"] = {
            "batches": dry_run.get("batches", []),
            "batch_count": dry_run.get("batch_count", 0),
            "row_count": dry_run.get("row_count", 0),
            "sample_rows": dry_run.get("sample_rows", []),
        }

    # ── 6. Status View ───────────────────────────────────────────────
    try:
        from backend.app.services.chat.hermes_agent import _build_status_view
        status_view = _build_status_view(session)

        # Promote nested fields to top-level (same as hermes_agent.run)
        if status_view.get("column_stats"):
            payload["column_stats"] = status_view.pop("column_stats")
        if status_view.get("performance_metrics"):
            payload["performance_metrics"] = status_view.pop("performance_metrics")
        if status_view.get("constraint_violations"):
            payload["constraint_violations"] = status_view.pop("constraint_violations")

        payload["status_view"] = status_view
    except Exception:
        logger.warning("hydration: _build_status_view failed", exc_info=True)

    # ── 7. Extended data (fallback if not already set by status_view) ─
    if "column_stats" not in payload:
        cs = _read_json(tdir / "column_stats.json")
        if cs:
            payload["column_stats"] = cs

    if "performance_metrics" not in payload:
        pm = _read_json(tdir / "performance_metrics.json")
        if pm:
            payload["performance_metrics"] = pm

    if "constraint_violations" not in payload:
        cv = _read_json(tdir / "constraint_violations.json")
        if cv:
            payload["constraint_violations"] = cv

    # ── 7b. Temporal analysis (detailed gap/spike data from daemon) ──
    temporal_data = {}
    cache_dir = tdir / "widget_cache"
    if cache_dir.exists():
        for tf in cache_dir.glob("temporal_*.json"):
            td = _read_json(tf)
            if td:
                temporal_data[tf.stem] = td
    if temporal_data:
        payload["temporal_data"] = temporal_data

    # ── 7c. Custom constraint rules ──────────────────────────────────
    cc = _read_json(tdir / "custom_constraints.json")
    if cc:
        payload["custom_constraint_rules"] = cc

    # ── 8. Available panels (data-aware gating) ────────────────────
    #
    # Logic: the _PANEL_AVAILABILITY dict is the baseline (state-driven).
    # We refine it for EARLY states only, where the state might be reached
    # before the required data actually exists.  For LATE states we trust
    # the state machine — if the pipeline reached "validated", the data
    # must be there (you can't transition without it).
    #
    _LATE_STATES = {"validated", "ready", "generating"}
    base_panels = list(_PANEL_AVAILABILITY.get(state, []))

    # "data" panel: useless without a DB connection.  Remove only at early
    # states (html_ready/mapping) where connection might not be set yet.
    # At mapped+ the connection is guaranteed (mapping requires it).
    if "data" in base_panels and not session.connection_id:
        if state not in {"mapped", "approving", "approved", "correcting",
                         "building_assets", "validating"} | _LATE_STATES:
            base_panels = [p for p in base_panels if p != "data"]

    # "errors" panel: only hide if we're at an early state where validation
    # hasn't run AND no error artifacts exist yet.  At validated+ always show.
    if "errors" in base_panels and state not in _LATE_STATES:
        has_errors_data = (
            (tdir / "validation_result.json").exists()
            or (tdir / "constraint_violations.json").exists()
        )
        if not has_errors_data:
            base_panels = [p for p in base_panels if p != "errors"]

    # "preview" panel: only hide if dry_run hasn't run AND we're before
    # validated.  At validated+ the dry_run must have succeeded.
    if "preview" in base_panels and state not in _LATE_STATES:
        if not (tdir / "dry_run_result.json").exists():
            base_panels = [p for p in base_panels if p != "preview"]

    payload["panel"] = {"available": base_panels, "show": None}

    # ── 9. Learning signal ────────────────────────────────────────────
    ls = _read_json(tdir / "learning_signal.json")
    if ls:
        payload["learning_signal"] = ls

    # ── 10. Template ID + kind ──────────────────────────────────────
    payload["template_id"] = tdir.name
    try:
        from backend.app.services.legacy_services import resolve_template_kind
        payload["template_kind"] = resolve_template_kind(tdir.name) or "pdf"
    except Exception:
        payload["template_kind"] = "pdf"

    # ── 11. Pipeline history (for D12 action replay) ─────────────────
    hist = _read_json(tdir / "pipeline_history.json")
    if hist and isinstance(hist, list):
        payload["action_result"]["history"] = hist[-30:]

    return payload
