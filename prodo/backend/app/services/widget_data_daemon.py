"""
Background daemon that pre-computes widget data caches when session state changes.

Pre-fills ``{template_dir}/widget_cache/`` for:
  - D2  quality_{table}.json     (column stats)
  - D6  temporal_{table}_{col}.json  (temporal analysis)
  - 6d  batches.json             (batch discovery)
  - S7  problems.json            (validation + constraint violations)

Same async-queue pattern as ``HydrationDaemon``.
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Trigger → widgets to precompute
_TRIGGER_MAP: dict[str, list[str]] = {
    "state:html_ready": ["quality"],
    "state:mapped": ["quality", "temporal"],
    "state:approved": ["batches"],
    "state:validated": ["problems"],
    "state:building_assets": ["quality"],
    "stage:validate": ["problems"],
    "stage:dry_run": ["problems"],
}


class WidgetDataDaemon:
    """Async worker that pre-fills widget caches in the background."""

    _MAX_QUEUE = 64

    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._MAX_QUEUE)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._worker(), name="widget-data-daemon")
            logger.info("widget_data_daemon_started")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            logger.info("widget_data_daemon_stopped")

    def notify(
        self,
        session_id: str,
        template_dir: str,
        connection_id: str | None = None,
        reason: str = "",
    ) -> None:
        try:
            self._queue.put_nowait({
                "session_id": session_id,
                "template_dir": template_dir,
                "connection_id": connection_id,
                "reason": reason,
            })
        except asyncio.QueueFull:
            logger.debug("widget_data_daemon: queue full, dropping %s", reason)

    async def _worker(self) -> None:
        while True:
            item = await self._queue.get()
            try:
                await asyncio.to_thread(self._process, item)
            except Exception:
                logger.warning(
                    "widget_data_daemon: failed for %s (%s)",
                    item.get("session_id", "?"), item.get("reason", ""),
                    exc_info=True,
                )
            finally:
                self._queue.task_done()

    @staticmethod
    def _process(item: dict) -> None:
        """Route trigger reason to the right precomputation functions."""
        reason = item.get("reason", "")
        widgets = _TRIGGER_MAP.get(reason, [])
        if not widgets:
            return

        tdir = Path(item["template_dir"])
        if not tdir.exists():
            return
        connection_id = item.get("connection_id")

        # Verify session isolation
        from backend.app.services.chat.session import ChatSession
        try:
            session = ChatSession.load(tdir)
        except FileNotFoundError:
            return
        if session.session_id != item["session_id"]:
            return

        cache_dir = tdir / "widget_cache"
        cache_dir.mkdir(exist_ok=True)

        for widget in widgets:
            try:
                if widget == "quality" and connection_id:
                    _precompute_quality(tdir, cache_dir, connection_id)
                elif widget == "temporal" and connection_id:
                    _precompute_temporal(tdir, cache_dir, connection_id)
                elif widget == "batches" and connection_id:
                    _precompute_batches(tdir, cache_dir, connection_id)
                elif widget == "problems":
                    _precompute_problems(tdir, cache_dir, connection_id)
            except Exception:
                logger.debug("widget_data_daemon: %s precompute failed", widget, exc_info=True)


def _precompute_quality(tdir: Path, cache_dir: Path, connection_id: str) -> None:
    """Compute column stats for all tables mentioned in the mapping."""
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
    from backend.app.services.data_validator import DataValidator

    mapping_file = tdir / "mapping_step3.json"
    if not mapping_file.exists():
        return

    mapping_data = json.loads(mapping_file.read_text())
    mapping = mapping_data.get("mapping", mapping_data)

    # Extract unique table names from "table.column" mapping values
    tables = set()
    for v in mapping.values():
        if isinstance(v, str) and "." in v and not v.startswith(("COMPUTED", "SUM:", "LITERAL", "RESHAPE", "LATER")):
            tables.add(v.split(".")[0])

    if not tables:
        return

    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    loader = SQLiteDataFrameLoader(db_path)
    validator = DataValidator()

    all_stats = {}
    for table in tables:
        try:
            df = loader.frame(table)
            stats = validator.get_column_stats(df)
            prefixed = {f"{table}.{col}": s for col, s in stats.items()}
            all_stats.update(prefixed)

            # Per-table cache
            result = {"columns": prefixed}
            tmp = (cache_dir / f"quality_{table}.json").with_suffix(".tmp")
            tmp.write_text(json.dumps(result, ensure_ascii=False, default=str))
            tmp.rename(cache_dir / f"quality_{table}.json")
        except Exception:
            logger.debug("widget_data_daemon: quality for table %s failed", table, exc_info=True)

    # Also update main column_stats.json for hydration
    if all_stats:
        main = tdir / "column_stats.json"
        existing = {}
        if main.exists():
            try:
                existing = json.loads(main.read_text())
            except Exception:
                pass
        existing.update(all_stats)
        try:
            main.write_text(json.dumps(existing, ensure_ascii=False, default=str))
        except Exception:
            pass


def _precompute_temporal(tdir: Path, cache_dir: Path, connection_id: str) -> None:
    """Compute temporal distribution for date columns found in tags or stats."""
    import numpy as np
    import pandas as pd
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader

    # Find date columns from tags or column_stats
    tags_file = tdir / "column_tags.json"
    date_cols = []
    if tags_file.exists():
        try:
            tags = json.loads(tags_file.read_text())
            date_cols = [col for col, tag in tags.items() if tag == "date"]
        except Exception:
            pass

    if not date_cols:
        # Try to detect from column_stats
        stats_file = tdir / "column_stats.json"
        if stats_file.exists():
            try:
                stats = json.loads(stats_file.read_text())
                date_cols = [col for col, s in stats.items() if s.get("type") == "datetime"]
            except Exception:
                pass

    if not date_cols:
        return

    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    loader = SQLiteDataFrameLoader(db_path)

    for full_col in date_cols:
        parts = full_col.split(".", 1)
        table = parts[0] if len(parts) > 1 else None
        col = parts[-1]
        if not table:
            continue

        try:
            df = loader.frame(table)
            if col not in df.columns:
                continue

            dt = pd.to_datetime(df[col], errors="coerce").dropna()
            if len(dt) == 0:
                continue

            grouped = dt.dt.to_period("M").value_counts().sort_index()
            periods = [{"period": str(p), "count": int(c)} for p, c in grouped.items()]
            counts = grouped.values.astype(float)
            mean_val = float(np.mean(counts))
            std_val = float(np.std(counts))

            # Gaps
            all_p = pd.period_range(grouped.index.min(), grouped.index.max(), freq="M")
            missing = sorted(set(all_p) - set(grouped.index))
            gaps = []
            if missing:
                start = prev = missing[0]
                for m in missing[1:]:
                    if m == prev + 1:
                        prev = m
                    else:
                        gaps.append({"start": str(start), "end": str(prev)})
                        start = prev = m
                gaps.append({"start": str(start), "end": str(prev)})

            # Spikes
            threshold = mean_val + 2 * std_val
            spikes = [
                {"period": str(p), "count": int(c), "threshold": round(threshold, 1)}
                for p, c in grouped.items()
                if c > threshold and std_val > 0
            ]

            result = {
                "periods": periods, "gaps": gaps, "spikes": spikes,
                "stats": {"mean": round(mean_val, 1), "std": round(std_val, 1), "total": int(np.sum(counts))},
            }
            cache_name = f"temporal_{table}_{col}_month"
            tmp = (cache_dir / f"{cache_name}.json").with_suffix(".tmp")
            tmp.write_text(json.dumps(result, ensure_ascii=False, default=str))
            tmp.rename(cache_dir / f"{cache_name}.json")
        except Exception:
            logger.debug("widget_data_daemon: temporal %s.%s failed", table, col, exc_info=True)


def _precompute_batches(tdir: Path, cache_dir: Path, connection_id: str) -> None:
    """Pre-compute batch discovery from contract."""
    from backend.app.repositories import resolve_db_path
    from backend.app.services.reports import discover_batches_and_counts

    contract_file = tdir / "contract.json"
    if not contract_file.exists():
        return

    contract = json.loads(contract_file.read_text())
    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    raw = discover_batches_and_counts(db_path=db_path, contract=contract, start_date="", end_date="")
    batches = raw.get("batches", []) if isinstance(raw, dict) else raw
    if not isinstance(batches, list):
        batches = []

    result = {"batches": batches[:100], "count": len(batches)}
    tmp = (cache_dir / "batches.json").with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, default=str))
    tmp.rename(cache_dir / "batches.json")


def _precompute_problems(tdir: Path, cache_dir: Path, connection_id: str | None) -> None:
    """Merge validation_result.json + constraint_violations.json into problems cache."""
    issues = []
    violations = []

    val_file = tdir / "validation_result.json"
    if val_file.exists():
        try:
            issues = json.loads(val_file.read_text()).get("issues", [])
        except Exception:
            pass

    cv_file = tdir / "constraint_violations.json"
    if cv_file.exists():
        try:
            v = json.loads(cv_file.read_text())
            violations = v if isinstance(v, list) else []
        except Exception:
            pass

    if not issues and not violations:
        return

    summary = {
        "errors": sum(1 for i in issues if i.get("severity") == "error"),
        "warnings": sum(1 for i in issues if i.get("severity") == "warning"),
        "info": sum(1 for i in issues if i.get("severity") == "info"),
        "violations": len(violations),
    }
    result = {"issues": issues, "violations": violations, "summary": summary}
    tmp = (cache_dir / "problems.json").with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, default=str))
    tmp.rename(cache_dir / "problems.json")


# Module-level singleton
widget_data_daemon = WidgetDataDaemon()
