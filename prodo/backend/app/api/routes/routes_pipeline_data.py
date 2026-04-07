"""
Dedicated REST endpoints for the 10 non-LLM backend widgets.

Mounted at ``/api/v1/pipeline/data``.  Each endpoint resolves the session
by ``session_id``, reads/writes to the session's template directory, and
uses file-based caching in ``{tdir}/widget_cache/``.

Widgets served:
    D2  Column stats     GET /column-stats
    D6  Temporal         GET /temporal
    6d  Batches          GET /batches
    3c  Tags             GET /tags  +  POST /tags
    D10 Performance      GET /performance
    S7  Problems         GET /problems
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

pipeline_data_router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────


def _find_session(session_id: str):
    """Reuse the session-finder from routes_a (import to avoid duplication)."""
    from backend.app.api.routes.routes_a import _find_session as _fs
    return _fs(session_id)


def _get_loader(connection_id: str):
    """Resolve DB path and return a DataFrame loader."""
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    return SQLiteDataFrameLoader(db_path)


def _cache_dir(tdir: Path) -> Path:
    d = tdir / "widget_cache"
    d.mkdir(exist_ok=True)
    return d


def _read_cache(tdir: Path, name: str) -> dict | None:
    p = _cache_dir(tdir) / f"{name}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def _write_cache(tdir: Path, name: str, data: dict) -> None:
    d = _cache_dir(tdir)
    tmp = (d / f"{name}.json").with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, default=str))
    tmp.rename(d / f"{name}.json")


# ── Endpoint 1: Column Stats (D2 Data Quality) ───────────────────────


@pipeline_data_router.get("/column-stats")
async def widget_column_stats(
    session_id: str = Query(...),
    table: str = Query(...),
    columns: str | None = Query(None, description="Comma-separated column names"),
):
    """Column statistics: NULL%, unique count, top values, distribution."""
    session, tdir = _find_session(session_id)
    if not session.connection_id:
        raise HTTPException(400, "No database connection on this session")

    # Check cache
    cache_name = f"quality_{table}"
    cached = _read_cache(tdir, cache_name)
    if cached:
        return cached

    # Compute on-demand
    def _compute():
        from backend.app.services.data_validator import DataValidator

        loader = _get_loader(session.connection_id)
        df = loader.frame(table)
        target_cols = [c.strip() for c in columns.split(",")] if columns else None
        validator = DataValidator()
        stats = validator.get_column_stats(df, target_cols)

        # Prefix with table name (same convention as tool_get_column_stats)
        prefixed = {f"{table}.{col}": s for col, s in stats.items()}

        # Also merge into the main column_stats.json so hydration picks it up
        main_stats_file = tdir / "column_stats.json"
        existing = {}
        if main_stats_file.exists():
            try:
                existing = json.loads(main_stats_file.read_text())
            except Exception:
                pass
        existing.update(prefixed)
        try:
            main_stats_file.write_text(json.dumps(existing, ensure_ascii=False, default=str))
        except Exception:
            pass

        result = {"columns": prefixed}
        _write_cache(tdir, cache_name, result)
        return result

    return await asyncio.to_thread(_compute)


# ── Endpoint 2: Temporal Consistency (D6) ─────────────────────────────


@pipeline_data_router.get("/temporal")
async def widget_temporal(
    session_id: str = Query(...),
    table: str = Query(...),
    column: str = Query(...),
    period: str = Query("month", pattern="^(day|week|month)$"),
):
    """Date column aggregation with gap and spike detection."""
    session, tdir = _find_session(session_id)
    if not session.connection_id:
        raise HTTPException(400, "No database connection on this session")

    cache_name = f"temporal_{table}_{column}_{period}"
    cached = _read_cache(tdir, cache_name)
    if cached:
        return cached

    def _compute():
        import numpy as np

        loader = _get_loader(session.connection_id)
        df = loader.frame(table)

        if column not in df.columns:
            raise HTTPException(400, f"Column '{column}' not found in table '{table}'")

        dt = pd.to_datetime(df[column], errors="coerce").dropna()
        if len(dt) == 0:
            return {"periods": [], "gaps": [], "spikes": [], "stats": {"mean": 0, "std": 0, "total": 0}}

        # Group by period
        period_map = {"day": "D", "week": "W", "month": "M"}
        grouped = dt.dt.to_period(period_map[period]).value_counts().sort_index()

        periods = [{"period": str(p), "count": int(c)} for p, c in grouped.items()]
        counts = grouped.values.astype(float)
        mean_val = float(np.mean(counts))
        std_val = float(np.std(counts))
        total = int(np.sum(counts))

        # Detect gaps: periods with zero records between min and max
        all_periods = pd.period_range(grouped.index.min(), grouped.index.max(), freq=period_map[period])
        missing = set(all_periods) - set(grouped.index)
        gaps = []
        if missing:
            sorted_missing = sorted(missing)
            # Group consecutive missing periods
            start = sorted_missing[0]
            prev = start
            for m in sorted_missing[1:]:
                if m == prev + 1:
                    prev = m
                else:
                    gaps.append({"start": str(start), "end": str(prev)})
                    start = m
                    prev = m
            gaps.append({"start": str(start), "end": str(prev)})

        # Detect spikes: count > mean + 2σ
        threshold = mean_val + 2 * std_val
        spikes = [
            {"period": str(p), "count": int(c), "threshold": round(threshold, 1)}
            for p, c in grouped.items()
            if c > threshold and std_val > 0
        ]

        result = {
            "periods": periods,
            "gaps": gaps,
            "spikes": spikes,
            "stats": {"mean": round(mean_val, 1), "std": round(std_val, 1), "total": total},
        }
        _write_cache(tdir, cache_name, result)
        return result

    return await asyncio.to_thread(_compute)


# ── Endpoint 3: Batches (6d Batch Selector) ──────────────────────────


@pipeline_data_router.get("/batches")
async def widget_batches(
    session_id: str = Query(...),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    """Discover available batches from database via contract date columns."""
    session, tdir = _find_session(session_id)
    if not session.connection_id:
        raise HTTPException(400, "No database connection on this session")

    contract_file = tdir / "contract.json"
    if not contract_file.exists():
        return {"batches": [], "count": 0}

    # Only cache if no date filters (default view)
    use_cache = not date_from and not date_to
    if use_cache:
        cached = _read_cache(tdir, "batches")
        if cached:
            return cached

    def _compute():
        from backend.app.repositories import resolve_db_path
        from backend.app.services.reports import discover_batches_and_counts

        contract = json.loads(contract_file.read_text())
        db_path = resolve_db_path(
            connection_id=session.connection_id, db_url=None, db_path=None
        )
        raw = discover_batches_and_counts(
            db_path=db_path,
            contract=contract,
            start_date=date_from or "",
            end_date=date_to or "",
        )
        batches = raw.get("batches", []) if isinstance(raw, dict) else raw
        if not isinstance(batches, list):
            batches = []
        result = {"batches": batches[:100], "count": len(batches)}

        if use_cache:
            _write_cache(tdir, "batches", result)
        return result

    return await asyncio.to_thread(_compute)


# ── Endpoint 4: Column Tags (3c) ─────────────────────────────────────


@pipeline_data_router.get("/tags")
async def widget_tags_get(session_id: str = Query(...)):
    """Read persisted column tags (id/date/metric)."""
    _session, tdir = _find_session(session_id)
    tags_file = tdir / "column_tags.json"
    if tags_file.exists():
        try:
            return {"tags": json.loads(tags_file.read_text(encoding="utf-8"))}
        except Exception:
            pass
    return {"tags": {}}


class TagsPayload(BaseModel):
    session_id: str
    tags: dict[str, str | None]


@pipeline_data_router.post("/tags")
async def widget_tags_post(payload: TagsPayload):
    """Persist column tags to session directory."""
    _session, tdir = _find_session(payload.session_id)

    # Merge with existing tags (null value = remove)
    tags_file = tdir / "column_tags.json"
    existing = {}
    if tags_file.exists():
        try:
            existing = json.loads(tags_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    for col, tag in payload.tags.items():
        if tag is None:
            existing.pop(col, None)
        else:
            existing[col] = tag

    tmp = tags_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(existing, ensure_ascii=False))
    tmp.rename(tags_file)

    return {"tags": existing}


# ── Endpoint 5: Performance Metrics (D10) ────────────────────────────


@pipeline_data_router.get("/performance")
async def widget_performance(session_id: str = Query(...)):
    """Read pipeline performance metrics (step timings)."""
    _session, tdir = _find_session(session_id)
    perf_file = tdir / "performance_metrics.json"
    if perf_file.exists():
        try:
            data = json.loads(perf_file.read_text(encoding="utf-8"))
            return {"metrics": data if isinstance(data, list) else [data]}
        except Exception:
            pass
    return {"metrics": []}


# ── Endpoint 6: Problems (S7) ────────────────────────────────────────


@pipeline_data_router.get("/problems")
async def widget_problems(session_id: str = Query(...)):
    """Validation issues + constraint violations, with on-demand fallback."""
    session, tdir = _find_session(session_id)

    # Check cache first
    cached = _read_cache(tdir, "problems")
    if cached:
        return cached

    issues = []
    violations = []

    # Read validation result
    val_file = tdir / "validation_result.json"
    if val_file.exists():
        try:
            val = json.loads(val_file.read_text(encoding="utf-8"))
            issues = val.get("issues", [])
        except Exception:
            pass

    # Read constraint violations
    cv_file = tdir / "constraint_violations.json"
    if cv_file.exists():
        try:
            violations = json.loads(cv_file.read_text(encoding="utf-8"))
            if not isinstance(violations, list):
                violations = []
        except Exception:
            pass

    # On-demand fallback: compute if nothing cached and contract exists
    if not issues and not violations and session.connection_id:
        contract_file = tdir / "contract.json"
        if contract_file.exists():
            def _compute():
                from backend.app.services.data_validator import DataValidator

                contract = json.loads(contract_file.read_text())
                loader = _get_loader(session.connection_id)
                tables = loader.tables()
                if not tables:
                    return []
                df = loader.frame(tables[0])
                validator = DataValidator()
                return validator.validate_report_data(df, contract)

            try:
                violations = await asyncio.to_thread(_compute)
                if violations:
                    # Persist for next time
                    try:
                        cv_file.write_text(
                            json.dumps(violations, ensure_ascii=False, default=str)
                        )
                    except Exception:
                        pass
            except Exception as exc:
                logger.warning("widget_problems: on-demand validation failed: %s", exc)

    summary = {
        "errors": sum(1 for i in issues if i.get("severity") == "error"),
        "warnings": sum(1 for i in issues if i.get("severity") == "warning"),
        "info": sum(1 for i in issues if i.get("severity") == "info"),
        "violations": len(violations),
    }

    result = {"issues": issues, "violations": violations, "summary": summary}
    _write_cache(tdir, "problems", result)
    return result
