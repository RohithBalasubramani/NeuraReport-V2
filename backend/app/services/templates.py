from __future__ import annotations

"""Merged templates module."""

import asyncio
import contextlib
import logging
import tempfile
import zipfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Optional

from fastapi import UploadFile

from backend.app.utils import Event, EventBus, logging_middleware, metrics_middleware
from backend.app.utils import PipelineRunner, PipelineStep
from backend.app.utils import Result, err, ok
from backend.app.utils import StrategyRegistry
# TemplateExtractionError, TemplateImportError, TemplateLockedError,
# TemplateTooLargeError, TemplateZipInvalidError, TemplateKindStrategy,
# build_template_kind_registry are all defined above in this file
from backend.app.utils import sanitize_filename
from backend.app.repositories import state_store
from backend.app.services.infra_services import TemplateLockError, acquire_template_lock
from backend.app.services.infra_services import load_manifest
from backend.app.services.infra_services import detect_zip_root, extract_zip_to_dir
def load_mapping_keys(*args, **kwargs):
    """Lazy import to break circular dependency with legacy_services."""
    from backend.app.services.legacy_services import load_mapping_keys as _fn
    return _fn(*args, **kwargs)

@dataclass
class TemplateImportContext:
    upload: UploadFile
    display_name: Optional[str]
    correlation_id: Optional[str]
    tmp_path: Optional[Path] = None
    root: Optional[str] = None
    contains_excel: bool = False
    kind: Optional[str] = None
    template_id: Optional[str] = None
    template_dir: Optional[Path] = None
    name: Optional[str] = None
    artifacts: dict = field(default_factory=dict)
    manifest: dict = field(default_factory=dict)

def _create_temp_path(*, suffix: str) -> Path:
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = Path(handle.name)
    handle.close()
    return tmp_path

class TemplateService:
    def __init__(
        self,
        uploads_root: Path,
        excel_uploads_root: Path,
        max_bytes: int,
        *,
        max_zip_entries: int | None = None,
        max_zip_uncompressed_bytes: int | None = None,
        max_concurrency: int = 4,
        event_bus: Optional[EventBus] = None,
        kind_registry: Optional[StrategyRegistry[TemplateKindStrategy] | dict[str, TemplateKindStrategy]] = None,
    ) -> None:
        self.uploads_root = uploads_root
        self.excel_uploads_root = excel_uploads_root
        self.max_bytes = max_bytes
        self.max_zip_entries = max_zip_entries
        self.max_zip_uncompressed_bytes = max_zip_uncompressed_bytes
        self._semaphore = asyncio.Semaphore(max(1, int(max_concurrency or 1)))
        self.logger = logging.getLogger("neura.templates")
        self.event_bus = event_bus or EventBus(
            middlewares=[logging_middleware(logging.getLogger("neura.events")), metrics_middleware(logging.getLogger("neura.events"))]
        )
        if isinstance(kind_registry, StrategyRegistry):
            self.kind_registry = kind_registry
        else:
            self.kind_registry = build_template_kind_registry(self.uploads_root, self.excel_uploads_root)
            if kind_registry:
                for key, strategy in kind_registry.items():
                    self.kind_registry.register(key, strategy)

    def _normalize_display_name(
        self,
        display_name: Optional[str],
        root_name: Optional[str],
        upload_name: Optional[str],
    ) -> str:
        raw = (display_name or "").strip() or (root_name or "").strip() or (upload_name or "").strip() or "template"
        base = Path(raw).name
        base = Path(base).stem or base
        safe = sanitize_filename(base)
        if len(safe) > 100:
            safe = safe[:100].rstrip()
        return safe or "template"

    async def _write_upload(self, upload, dest: Path) -> int:
        size = 0
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with dest.open("wb") as fh:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise TemplateTooLargeError(self.max_bytes)
                    fh.write(chunk)
        except Exception:
            with contextlib.suppress(Exception):
                dest.unlink(missing_ok=True)
            raise
        finally:
            with contextlib.suppress(Exception):
                await upload.seek(0)
        return size

    async def import_zip(
        self,
        upload: UploadFile,
        display_name: Optional[str],
        correlation_id: Optional[str],
    ):
        ctx = TemplateImportContext(upload=upload, display_name=display_name, correlation_id=correlation_id)
        tmp_paths: list[Path] = []

        async def _write(ctx: TemplateImportContext) -> Result[TemplateImportContext, TemplateImportError | Exception]:
            tmp_path = _create_temp_path(suffix=".zip")
            try:
                await self._write_upload(ctx.upload, tmp_path)
            except TemplateImportError as exc:
                return err(exc)
            except Exception as exc:
                logger.exception("Template upload failed")
                return err(TemplateImportError(code="upload_failed", message="Upload failed"))
            tmp_paths.append(tmp_path)
            return ok(replace(ctx, tmp_path=tmp_path))

        def _inspect(ctx: TemplateImportContext) -> Result[TemplateImportContext, TemplateImportError]:
            if not ctx.tmp_path:
                return err(TemplateImportError(code="upload_missing", message="Temporary upload path missing"))
            try:
                with zipfile.ZipFile(ctx.tmp_path, "r") as zf:
                    members = list(zf.infolist())
                    file_members = [member for member in members if not member.is_dir()]
                    if self.max_zip_entries is not None and len(file_members) > self.max_zip_entries:
                        return err(
                            TemplateImportError(
                                code="zip_too_many_files",
                                message="Zip contains too many files",
                                detail=f"max_entries={self.max_zip_entries}",
                            )
                        )
                    if self.max_zip_uncompressed_bytes is not None:
                        total_uncompressed = sum(member.file_size for member in file_members)
                        if total_uncompressed > self.max_zip_uncompressed_bytes:
                            return err(
                                TemplateImportError(
                                    code="zip_too_large",
                                    message="Zip expands beyond allowed size",
                                    detail=f"max_uncompressed_bytes={self.max_zip_uncompressed_bytes}",
                                )
                            )
                    root = detect_zip_root(m.filename for m in members)
                    contains_excel = any(Path(m.filename).name.lower() == "source.xlsx" for m in members)
            except Exception as exc:
                logger.exception("Invalid template ZIP")
                return err(TemplateZipInvalidError(detail="Invalid ZIP archive"))
            kind = "excel" if contains_excel else "pdf"
            name = self._normalize_display_name(display_name, root, upload.filename)
            return ok(
                replace(
                    ctx,
                    root=root,
                    contains_excel=contains_excel,
                    kind=kind,
                    name=name,
                )
            )

        def _allocate(ctx: TemplateImportContext) -> Result[TemplateImportContext, TemplateImportError]:
            if not ctx.kind:
                return err(TemplateImportError(code="kind_missing", message="Unable to infer template kind"))
            strategy = self.kind_registry.resolve(ctx.kind)

            # Dedup: reuse existing template with same name+kind
            existing = [t for t in state_store.list_templates()
                        if t.get("name") == ctx.name and t.get("kind") == ctx.kind]
            if existing:
                template_id = existing[0]["id"]
                tdir = strategy.target_dir(template_id)
                tdir.mkdir(parents=True, exist_ok=True)
            else:
                template_id = strategy.generate_id(ctx.name)
                tdir = strategy.ensure_target_dir(template_id)

            return ok(replace(ctx, template_id=template_id, template_dir=tdir))

        def _extract(ctx: TemplateImportContext) -> Result[TemplateImportContext, TemplateImportError]:
            if not ctx.template_dir or not ctx.template_id or not ctx.tmp_path:
                return err(TemplateImportError(code="missing_context", message="Template import context incomplete"))
            try:
                lock_ctx = acquire_template_lock(ctx.template_dir, "import_zip", ctx.correlation_id)
            except TemplateLockError:
                return err(TemplateLockedError())

            with lock_ctx:
                try:
                    extract_zip_to_dir(
                        ctx.tmp_path,
                        ctx.template_dir,
                        strip_root=True,
                        max_entries=self.max_zip_entries,
                        max_uncompressed_bytes=self.max_zip_uncompressed_bytes,
                    )
                except Exception as exc:
                    with contextlib.suppress(Exception):
                        for path in ctx.template_dir.rglob("*"):
                            if path.is_file():
                                path.unlink()
                    logger.exception("Template extraction failed")
                    return err(TemplateExtractionError(detail="Extraction failed"))

                manifest = load_manifest(ctx.template_dir) or {}
                artifacts = manifest.get("artifacts") or {}
                template_name = ctx.name or f"Template {ctx.template_id[:6]}"
                status = "approved" if (ctx.template_dir / "contract.json").exists() else "draft"
                imported_keys = load_mapping_keys(ctx.template_dir)
                state_store.upsert_template(
                    ctx.template_id,
                    name=template_name,
                    status=status,
                    artifacts=artifacts,
                    connection_id=None,
                    mapping_keys=imported_keys,
                    template_type=ctx.kind,
                )

            return ok(
                replace(
                    ctx,
                    artifacts=artifacts,
                    manifest=manifest,
                    name=template_name,
                )
            )

        async def _emit_complete(
            ctx: TemplateImportContext,
        ) -> Result[TemplateImportContext, TemplateImportError]:
            await self.event_bus.publish(
                Event(
                    name="template.imported",
                    payload={
                        "template_id": ctx.template_id,
                        "kind": ctx.kind,
                        "artifacts": list((ctx.artifacts or {}).keys()),
                    },
                    correlation_id=ctx.correlation_id,
                )
            )
            return ok(ctx)

        steps = [
            PipelineStep("write_upload", _write),
            PipelineStep("inspect_zip", _inspect),
            PipelineStep("allocate_id", _allocate),
            PipelineStep("extract_and_persist", _extract),
            PipelineStep("emit_complete", _emit_complete),
        ]

        async with self._semaphore:
            runner = PipelineRunner(
                steps,
                bus=self.event_bus,
                logger=self.logger,
                correlation_id=correlation_id,
            )
            try:
                result = await runner.run(ctx)
            finally:
                with contextlib.suppress(Exception):
                    for path in tmp_paths:
                        path.unlink(missing_ok=True)

        if result.is_err:
            error = result.unwrap_err()
            if isinstance(error, TemplateImportError):
                raise error
            self.logger.exception("Template import failed")
            raise TemplateImportError(code="import_failed", message="Template import failed")

        final_ctx = result.unwrap()
        return {
            "template_id": final_ctx.template_id,
            "name": final_ctx.name,
            "kind": final_ctx.kind,
            "artifacts": final_ctx.artifacts,
            "correlation_id": correlation_id,
        }

    async def export_zip(
        self,
        template_id: str,
        correlation_id: Optional[str],
    ) -> dict:
        """Export a template directory as a zip file."""
        from fastapi import HTTPException

        # Find the template in state
        template_record = state_store.get_template_record(template_id)
        if not template_record:
            raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

        template_kind = template_record.get("kind") or template_record.get("template_type") or "pdf"
        template_name = template_record.get("name") or template_id

        # Resolve template directory
        if template_kind == "excel":
            template_dir = self.excel_uploads_root / template_id
        else:
            template_dir = self.uploads_root / template_id

        if not template_dir.exists():
            raise HTTPException(status_code=404, detail=f"Template directory not found for '{template_id}'")

        # Create a temporary zip file
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in template_name)
        zip_filename = f"{safe_name}-{template_id[:8]}.zip"
        tmp_zip_path = _create_temp_path(suffix=".zip")

        try:
            with zipfile.ZipFile(tmp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for file_path in template_dir.rglob("*"):
                    if file_path.is_file():
                        # Skip lock files and temp files
                        if file_path.name.startswith(".") or file_path.suffix == ".lock":
                            continue
                        arcname = file_path.relative_to(template_dir)
                        zf.write(file_path, arcname)
        except Exception as exc:
            with contextlib.suppress(Exception):
                tmp_zip_path.unlink(missing_ok=True)
            self.logger.exception("template_export_zip_failed")
            raise HTTPException(status_code=500, detail="Failed to create export zip")

        self.logger.info(
            "template_exported",
            extra={
                "event": "template_exported",
                "template_id": template_id,
                "kind": template_kind,
                "zip_path": str(tmp_zip_path),
                "correlation_id": correlation_id,
            },
        )

        return {
            "zip_path": str(tmp_zip_path),
            "filename": zip_filename,
            "template_id": template_id,
            "kind": template_kind,
        }

    async def duplicate(
        self,
        template_id: str,
        new_name: Optional[str],
        correlation_id: Optional[str],
    ) -> dict:
        """Duplicate a template by copying its directory to a new ID."""
        import shutil
        from fastapi import HTTPException

        # Find the source template
        template_record = state_store.get_template_record(template_id)
        if not template_record:
            raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

        template_kind = template_record.get("kind") or template_record.get("template_type") or "pdf"
        original_name = template_record.get("name") or template_id

        # Determine source directory
        if template_kind == "excel":
            source_dir = self.excel_uploads_root / template_id
        else:
            source_dir = self.uploads_root / template_id

        if not source_dir.exists():
            raise HTTPException(status_code=404, detail=f"Template directory not found for '{template_id}'")

        # Generate new template info
        strategy = self.kind_registry.resolve(template_kind)
        display_name = new_name or f"{original_name} (Copy)"
        new_template_id = strategy.generate_id(display_name)
        target_dir = strategy.ensure_target_dir(new_template_id)

        try:
            # Copy all files from source to target
            for file_path in source_dir.rglob("*"):
                if file_path.is_file():
                    # Skip lock files and temp files
                    if file_path.name.startswith(".") or file_path.suffix == ".lock":
                        continue
                    rel_path = file_path.relative_to(source_dir)
                    dest_path = target_dir / rel_path
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(file_path, dest_path)

            # Load manifest and artifacts
            manifest = load_manifest(target_dir) or {}
            artifacts = manifest.get("artifacts") or {}
            status = "approved" if (target_dir / "contract.json").exists() else "draft"

            # Register the new template in state
            imported_keys = load_mapping_keys(target_dir)
            state_store.upsert_template(
                new_template_id,
                name=display_name,
                status=status,
                artifacts=artifacts,
                connection_id=None,
                mapping_keys=imported_keys,
                template_type=template_kind,
            )

            self.logger.info(
                "template_duplicated",
                extra={
                    "event": "template_duplicated",
                    "source_id": template_id,
                    "new_id": new_template_id,
                    "kind": template_kind,
                    "correlation_id": correlation_id,
                },
            )

            return {
                "template_id": new_template_id,
                "name": display_name,
                "kind": template_kind,
                "status": status,
                "artifacts": artifacts,
                "source_id": template_id,
            }
        except Exception as exc:
            # Clean up on failure
            with contextlib.suppress(Exception):
                if target_dir.exists():
                    shutil.rmtree(target_dir)
            self.logger.exception("template_duplicate_failed")
            raise HTTPException(status_code=500, detail="Failed to duplicate template")

    async def update_tags(
        self,
        template_id: str,
        tags: list[str],
    ) -> dict:
        """Update tags for a template."""
        from fastapi import HTTPException

        template_record = state_store.get_template_record(template_id)
        if not template_record:
            raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")

        # Clean and normalize tags
        cleaned_tags = sorted(set(tag.strip().lower() for tag in tags if tag.strip()))

        # Update the template
        state_store.upsert_template(
            template_id,
            name=template_record.get("name") or template_id,
            status=template_record.get("status") or "draft",
            artifacts=template_record.get("artifacts"),
            tags=cleaned_tags,
            connection_id=template_record.get("last_connection_id"),
            mapping_keys=template_record.get("mapping_keys"),
            template_type=template_record.get("kind"),
            description=template_record.get("description"),
        )

        return {
            "template_id": template_id,
            "tags": cleaned_tags,
        }

    async def get_all_tags(self) -> dict:
        """Get all unique tags across all templates."""
        templates = state_store.list_templates()
        all_tags = set()
        tag_counts = {}

        for template in templates:
            tags = template.get("tags") or []
            for tag in tags:
                all_tags.add(tag)
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        # Sort tags by count (most used first), then alphabetically
        sorted_tags = sorted(all_tags, key=lambda t: (-tag_counts.get(t, 0), t))

        return {
            "tags": sorted_tags,
            "tagCounts": tag_counts,
            "total": len(sorted_tags),
        }

from typing import Optional

from backend.app.utils import DomainError

class TemplateImportError(DomainError):
    def __init__(self, *, code: str, message: str, status_code: int = 400, detail: Optional[str] = None) -> None:
        super().__init__(code=code, message=message, status_code=status_code, detail=detail)

class TemplateZipInvalidError(TemplateImportError):
    def __init__(self, detail: Optional[str] = None) -> None:
        super().__init__(code="invalid_zip", message="Invalid zip file", detail=detail, status_code=400)

class TemplateLockedError(TemplateImportError):
    def __init__(self) -> None:
        super().__init__(code="template_locked", message="Template is busy", status_code=409)

class TemplateTooLargeError(TemplateImportError):
    def __init__(self, max_bytes: int) -> None:
        super().__init__(
            code="upload_too_large",
            message=f"Upload exceeds limit of {max_bytes} bytes",
            status_code=413,
        )

class TemplateExtractionError(TemplateImportError):
    def __init__(self, detail: Optional[str] = None) -> None:
        super().__init__(code="import_failed", message="Failed to extract zip", detail=detail, status_code=400)

import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from backend.app.utils import StrategyRegistry

def _slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "template"

@dataclass
class TemplateKindStrategy:
    kind: str
    base_dir: Path

    def generate_id(self, hint: str | None) -> str:
        name = _slugify(hint or "template")
        return f"{name}-{uuid.uuid4().hex[:6]}-{self.kind}"

    def target_dir(self, template_id: str) -> Path:
        return (self.base_dir / template_id).resolve()

    def ensure_target_dir(self, template_id: str) -> Path:
        tdir = self.target_dir(template_id)
        tdir.mkdir(parents=True, exist_ok=True)
        return tdir

def build_template_kind_registry(pdf_root: Path, excel_root: Path) -> StrategyRegistry[TemplateKindStrategy]:
    registry: StrategyRegistry[TemplateKindStrategy] = StrategyRegistry(
        default_factory=lambda: TemplateKindStrategy(kind="pdf", base_dir=pdf_root)
    )
    registry.register("pdf", TemplateKindStrategy(kind="pdf", base_dir=pdf_root))
    registry.register("excel", TemplateKindStrategy(kind="excel", base_dir=excel_root))
    return registry

from typing import Any, Dict, List

"""
Static starter template catalog used to seed the unified template list and
power the template recommender.

These entries are intentionally small and generic so they work across
projects while remaining realistic.
"""

StarterTemplate = Dict[str, Any]

STARTER_TEMPLATES: List[StarterTemplate] = [
    {
        "id": "starter_monthly_sales_performance",
        "name": "Monthly Sales Performance Summary",
        "kind": "pdf",
        "domain": "Finance",
        "tags": ["sales", "monthly", "revenue", "margin", "kpi"],
        "useCases": [
            "Share monthly sales KPIs with leadership",
            "Track revenue and margin by product line and region",
        ],
        "primaryMetrics": [
            "Total revenue",
            "Gross margin %",
            "Revenue by product line",
            "Top customers by revenue",
        ],
        "description": (
            "Board-ready monthly sales summary with revenue, volume, and margin "
            "breakdowns by product line and region."
        ),
        "artifacts": {
            "thumbnail_url": "/starter/starter_monthly_sales_performance.png",
            "template_html_url": "/starter/starter_monthly_sales_performance.html",
        },
    },
    {
        "id": "starter_ops_throughput_quality",
        "name": "Operational Throughput & Quality Dashboard",
        "kind": "pdf",
        "domain": "Operations",
        "tags": ["operations", "throughput", "quality", "downtime"],
        "useCases": [
            "Monitor daily or weekly production performance",
            "Identify bottlenecks and recurring downtime causes",
        ],
        "primaryMetrics": [
            "Units produced",
            "Overall equipment effectiveness (OEE)",
            "First pass yield",
            "Unplanned downtime (minutes)",
        ],
        "description": (
            "Operations dashboard summarising throughput, quality, and downtime "
            "with trend charts and top root-cause categories."
        ),
        "artifacts": {
            "thumbnail_url": "/starter/starter_ops_throughput_quality.png",
            "template_html_url": "/starter/starter_ops_throughput_quality.html",
        },
    },
    {
        "id": "starter_marketing_campaign_roas",
        "name": "Campaign Performance & ROAS",
        "kind": "pdf",
        "domain": "Marketing",
        "tags": ["marketing", "campaign", "roas", "acquisition"],
        "useCases": [
            "Compare acquisition campaigns across channels",
            "Report ROAS and conversion performance to stakeholders",
        ],
        "primaryMetrics": [
            "Spend by channel",
            "Impressions and clicks",
            "Conversions and CPA",
            "Revenue and ROAS",
        ],
        "description": (
            "Channel-level campaign report highlighting spend, conversions, "
            "and return on ad spend (ROAS) across key marketing channels."
        ),
        "artifacts": {
            "thumbnail_url": "/starter/starter_marketing_campaign_roas.png",
            "template_html_url": "/starter/starter_marketing_campaign_roas.html",
        },
    },
    {
        "id": "starter_finance_cashflow_projection",
        "name": "Cashflow Projection & Variance",
        "kind": "excel",
        "domain": "Finance",
        "tags": ["cashflow", "forecast", "variance", "finance"],
        "useCases": [
            "Review monthly cash-in and cash-out projections",
            "Compare actual vs forecast cash positions",
        ],
        "primaryMetrics": [
            "Opening and closing cash balance",
            "Cash-in vs cash-out by category",
            "Forecast vs actual variance %",
        ],
        "description": (
            "Tabular cashflow projection with monthly actuals, forecasts, and "
            "variance analysis for finance teams."
        ),
        "artifacts": {
            "thumbnail_url": "/starter/starter_finance_cashflow_projection.png",
            "template_html_url": "/starter/starter_finance_cashflow_projection.html",
        },
    },
    {
        "id": "starter_product_cohort_retention",
        "name": "Product Cohort Retention",
        "kind": "pdf",
        "domain": "Product",
        "tags": ["product", "cohort", "retention", "engagement"],
        "useCases": [
            "Track user retention across signup cohorts",
            "Identify churn inflection points by lifecycle stage",
        ],
        "primaryMetrics": [
            "Week N retention %",
            "DAU/WAU/MAU",
            "Churned users",
        ],
        "description": "Visual cohort grids and charts for retention/engagement by signup date.",
        "artifacts": {
            "thumbnail_url": "/starter/starter_product_cohort_retention.png",
            "template_html_url": "/starter/starter_product_cohort_retention.html",
        },
    },
    {
        "id": "starter_supply_chain_fill_rate",
        "name": "Supply Chain Fill Rate & Stockouts",
        "kind": "pdf",
        "domain": "Operations",
        "tags": ["supply chain", "inventory", "fill rate", "logistics"],
        "useCases": [
            "Monitor fill rates and backorders by DC/region",
            "Spot recurring stockouts and lead-time slippage",
        ],
        "primaryMetrics": [
            "Fill rate %",
            "Stockout count",
            "Average lead time",
        ],
        "description": "Operational scorecard for fulfillment performance and inventory health.",
        "artifacts": {
            "thumbnail_url": "/starter/starter_supply_chain_fill_rate.png",
            "template_html_url": "/starter/starter_supply_chain_fill_rate.html",
        },
    },
]

from typing import Any, Dict, List, Optional, Sequence

from backend.app.repositories import state_store

TemplateCatalogItem = Dict[str, Any]

def _normalize_str_list(values: Optional[Sequence[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized

def build_unified_template_catalog() -> List[TemplateCatalogItem]:
    """
    Combine company templates from the persistent state store with the static
    starter catalog into a unified, normalised list.

    Each entry has:
        - id, name, kind
        - domain (optional)
        - tags
        - useCases
        - primaryMetrics
        - source: \"company\" | \"starter\"
    """
    catalog: list[TemplateCatalogItem] = []
    seen_ids: set[str] = set()

    # Company templates from state.json, via the sanitised view.
    for rec in state_store.list_templates():
        template_id = str(rec.get("id") or "").strip()
        if not template_id:
            continue
        if template_id in seen_ids:
            continue
        name = (rec.get("name") or "").strip() or f"Template {template_id[:8]}"
        kind = (rec.get("kind") or "pdf").strip().lower() or "pdf"

        item: TemplateCatalogItem = {
            "id": template_id,
            "name": name,
            "kind": kind,
            "domain": rec.get("domain") or None,
            "tags": _normalize_str_list(rec.get("tags") or []),
            "useCases": _normalize_str_list(rec.get("useCases") or []),
            "primaryMetrics": _normalize_str_list(rec.get("primaryMetrics") or []),
            "description": (rec.get("description") or "").strip() or None,
            "source": "company",
        }
        catalog.append(item)
        seen_ids.add(template_id)

    # Static starter templates.
    for starter in STARTER_TEMPLATES:
        template_id = str(starter.get("id") or "").strip()
        if not template_id or template_id in seen_ids:
            continue
        name = (starter.get("name") or "").strip() or template_id
        kind = (starter.get("kind") or "pdf").strip().lower() or "pdf"

        item: TemplateCatalogItem = {
            "id": template_id,
            "name": name,
            "kind": kind,
            "domain": starter.get("domain") or None,
            "tags": _normalize_str_list(starter.get("tags") or []),
            "useCases": _normalize_str_list(starter.get("useCases") or []),
            "primaryMetrics": _normalize_str_list(starter.get("primaryMetrics") or []),
            "description": (starter.get("description") or "").strip() or None,
            "source": "starter",
        }
        catalog.append(item)
        seen_ids.add(template_id)

    return catalog

import logging
from pathlib import Path
from typing import Any, Dict, Optional

try:  # pragma: no cover - optional dependencies
    import fitz  # type: ignore
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

try:  # pragma: no cover - optional dependencies
    import cv2  # type: ignore
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore

try:  # pragma: no cover - optional dependencies
    import numpy as np  # type: ignore
except ImportError:  # pragma: no cover
    np = None  # type: ignore

logger = logging.getLogger("neura.layout_hints")

MM_PER_POINT = 25.4 / 72.0

def _estimate_table_columns(page) -> Optional[int]:
    if any(mod is None for mod in (cv2, np, fitz)):  # type: ignore[arg-type]
        return None

    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        img = np.frombuffer(pix.samples, dtype="uint8")  # type: ignore[call-arg]
        img = img.reshape(pix.height, pix.width, pix.n)
        if pix.n >= 3:
            rgb = img[:, :, :3]
        else:
            rgb = img
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)  # type: ignore[attr-defined]
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)  # type: ignore[attr-defined]
        edges = cv2.Canny(blurred, 50, 150)  # type: ignore[attr-defined]

        vertical_projection = edges.sum(axis=0)
        if not np.any(vertical_projection):  # type: ignore[attr-defined]
            return None

        threshold = float(vertical_projection.mean() * 1.5)  # type: ignore[attr-defined]
        indices = np.where(vertical_projection > threshold)[0]  # type: ignore[attr-defined]
        if indices.size == 0:
            return None

        min_gap = max(6, pix.width // 200)
        min_span = max(4, pix.width // 500)
        clusters: list[tuple[int, int]] = []
        start = int(indices[0])
        prev = int(indices[0])
        for raw_idx in indices[1:]:
            idx = int(raw_idx)
            if idx - prev > min_gap:
                clusters.append((start, prev))
                start = idx
            prev = idx
        clusters.append((start, prev))

        significant = [(lo, hi) for lo, hi in clusters if (hi - lo) >= min_span]
        line_count = len(significant)
        if line_count >= 2:
            return line_count - 1  # vertical dividers imply columns
    except Exception:  # pragma: no cover - heuristic best-effort
        logger.debug("layout_hints_column_estimate_failed", exc_info=True)
    return None

def get_layout_hints(pdf_path: Path, page_index: int = 0) -> Dict[str, Any]:
    """Best-effort geometry hints for prompts (page size, rough table columns)."""
    if fitz is None:
        return {}

    try:
        with fitz.open(str(pdf_path)) as doc:  # type: ignore[call-arg]
            if page_index < 0 or page_index >= len(doc):
                return {}
            page = doc[page_index]
            width_mm = round(page.rect.width * MM_PER_POINT, 2)
            height_mm = round(page.rect.height * MM_PER_POINT, 2)

            hints: Dict[str, Any] = {
                "page_mm": [width_mm, height_mm],
                "notes": "best-effort",
            }

            est_tables = []
            columns = _estimate_table_columns(page)
            if columns and columns > 1:
                est_tables.append({"id": "tbl-1", "cols": int(columns)})
            if est_tables:
                hints["est_tables"] = est_tables
            return hints
    except Exception:  # pragma: no cover - logging for diagnostics
        logger.debug(
            "layout_hints_failed",
            exc_info=True,
            extra={"event": "layout_hints_failed", "pdf_path": str(pdf_path), "page_index": page_index},
        )
    return {}

import re

STYLE_RE = re.compile(r"(?is)<style\b[^>]*>(.*?)</style>")
HEAD_CLOSE_RE = re.compile(r"(?i)</head>")

def _extract_css(css_patch: str) -> str:
    match = STYLE_RE.search(css_patch)
    if match:
        return match.group(1).strip()
    return css_patch.strip()

def merge_css_into_html(html: str, css_patch: str) -> str:
    """Merge the provided CSS patch into the first <style> block (append to override)."""
    rules = _extract_css(css_patch)
    if not rules:
        return html

    match = STYLE_RE.search(html)
    if match:
        start, end = match.span(1)
        existing = match.group(1).rstrip()
        if existing:
            merged = f"{existing}\n{rules}\n"
        else:
            merged = f"{rules}\n"
        return html[:start] + merged + html[end:]

    injection = f"<style>\n{rules}\n</style>\n"
    head_match = HEAD_CLOSE_RE.search(html)
    if head_match:
        idx = head_match.start()
        return html[:idx] + injection + html[idx:]
    return injection + html

def replace_table_colgroup(html: str, table_id: str, new_colgroup_html: str) -> str:
    """Replace or insert a <colgroup> for the table with the given id."""
    snippet = new_colgroup_html.strip()
    if not table_id or not snippet:
        return html
    if "<colgroup" not in snippet.lower():
        return html

    table_pattern = re.compile(
        rf'(<table\b[^>]*\bid=["\']{re.escape(table_id)}["\'][^>]*>)(?P<body>.*?)(</table>)',
        re.I | re.S,
    )
    match = table_pattern.search(html)
    if not match:
        return html

    start_tag = match.group(1)
    body = match.group("body")
    end_tag = match.group(3)

    colgroup_pattern = re.compile(r"<colgroup\b[^>]*>.*?</colgroup>", re.I | re.S)
    if colgroup_pattern.search(body):
        new_body = colgroup_pattern.sub(snippet, body, count=1)
    else:
        prepend = snippet if snippet.endswith("\n") else snippet + "\n"
        new_body = prepend + body

    new_table = start_tag + new_body + end_tag
    return html[: match.start()] + new_table + html[match.end() :]

"""
Unified Pipeline — Canvas agent orchestrator for the Template Creator.

Dispatches agent_type requests to the correct agent, collects structured
results, and returns them for the Intelligence Canvas cards.

Supported agents:
- template_qa       → TemplateQAAgent
- data_mapping      → DataMappingAgent
- data_quality      → DataQualityAgent
- anomaly_detection → AnomalyDetectionAgent
- trend_analysis    → TrendAnalysisAgent
- report_pipeline   → ReportPipelineAgent
"""

import asyncio
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("neura.templates.unified_pipeline")

# ────────────────────────────────────────────────────────────────────
# Agent type → module and class name
# ────────────────────────────────────────────────────────────────────
_AGENT_MAP: Dict[str, tuple[str, str]] = {
    "template_qa": (
        "backend.app.services.agents.research_agents",
        "TemplateQAAgent",
    ),
    "data_mapping": (
        "backend.app.services.agents.data_agents",
        "DataMappingAgent",
    ),
    "data_quality": (
        "backend.app.services.agents.data_agents",
        "DataQualityAgent",
    ),
    "anomaly_detection": (
        "backend.app.services.agents.data_agents",
        "AnomalyDetectionAgent",
    ),
    "trend_analysis": (
        "backend.app.services.agents.research_agents",
        "TrendAnalysisAgent",
    ),
    "report_pipeline": (
        "backend.app.services.agents.research_agents",
        "ReportPipelineAgent",
    ),
}

SUPPORTED_AGENTS = set(_AGENT_MAP.keys())

def _load_agent(agent_type: str):
    """Lazily import and instantiate an agent class."""
    if agent_type not in _AGENT_MAP:
        raise ValueError(
            f"Unknown agent_type '{agent_type}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_AGENTS))}"
        )
    module_path, class_name = _AGENT_MAP[agent_type]
    import importlib
    mod = importlib.import_module(module_path)
    cls = getattr(mod, class_name)
    return cls()

def _serialize_result(result: Any) -> Any:
    """Convert Pydantic model or dataclass to JSON-safe dict."""
    if result is None:
        return None
    # Agents may return (report, metadata) tuples — take the report
    if isinstance(result, tuple):
        result = result[0]
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    if hasattr(result, "dict"):
        return result.dict()
    if isinstance(result, dict):
        return result
    return str(result)

async def run_canvas_agent(
    template_id: str,
    agent_type: str,
    params: Optional[Dict[str, Any]] = None,
    sync: bool = True,
) -> Dict[str, Any]:
    """Run an agent for the intelligence canvas and return structured result."""
    params = dict(params or {})
    params.setdefault("template_id", template_id)

    agent = _load_agent(agent_type)

    logger.info(
        "canvas_agent_start",
        extra={"agent_type": agent_type, "template_id": template_id},
    )

    try:
        # Remove internal-only keys that agents don't accept
        invoke_params = {k: v for k, v in params.items() if k != "template_id"}

        # All our agents have an async execute() method
        if asyncio.iscoroutinefunction(getattr(agent, "execute", None)):
            result = await agent.execute(**invoke_params)
        else:
            # Run synchronous agents in a thread pool
            import functools
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None, functools.partial(agent.execute, **invoke_params)
            )

        serialized = _serialize_result(result)

        logger.info(
            "canvas_agent_done",
            extra={"agent_type": agent_type, "template_id": template_id},
        )

        return serialized

    except Exception as e:
        logger.error(
            "canvas_agent_error",
            extra={
                "agent_type": agent_type,
                "template_id": template_id,
                "error": str(e),
            },
            exc_info=True,
        )
        raise

import asyncio
import base64
import json
import logging
import re
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from backend.app.services.ai_services import LLM_CALL_PROMPTS
from backend.app.services.infra_services import rasterize_html_to_png, save_png
from backend.app.services.infra_services import call_chat_completion, extract_tokens, normalize_token_braces
from backend.app.services.infra_services import render_html_to_png as _render_html_to_png_sync
from backend.app.services.infra_services import sanitize_html, write_json_atomic, write_text_atomic

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

try:
    from skimage.metrics import structural_similarity as ssim
except ImportError:  # pragma: no cover
    ssim = None  # type: ignore

from backend.app.services.config import get_settings

logger = logging.getLogger("neura.template_verify")

def _get_model() -> str:
    """Use centralized LLM config for model selection."""
    from backend.app.services.llm import get_llm_config
    return get_llm_config().model

# Lazy evaluation - will be called when needed, not at import time
MODEL = None

def _ensure_model() -> str:
    global MODEL
    if MODEL is None:
        MODEL = _get_model()
    return MODEL

# Unified LLM client (lazily initialized)
_llm_client = None

@dataclass
class InitialHtmlResult:
    html: str
    schema: Optional[Dict[str, Any]]
    schema_text: Optional[str]

@lru_cache(maxsize=1)
def _load_llm_call1_prompt() -> str:
    try:
        return LLM_CALL_PROMPTS["llm_call_1"]
    except KeyError as exc:  # pragma: no cover
        raise RuntimeError("Prompt 'llm_call_1' missing from LLM_CALL_PROMPTS") from exc

@lru_cache(maxsize=1)
def _load_llm_call2_prompt() -> str:
    try:
        return LLM_CALL_PROMPTS["llm_call_2"]
    except KeyError as exc:  # pragma: no cover
        raise RuntimeError("Prompt 'llm_call_2' missing from LLM_CALL_PROMPTS") from exc

def _extract_marked_section(text: str, begin: str, end: str) -> Optional[str]:
    pattern = re.compile(re.escape(begin) + r"([\s\S]*?)" + re.escape(end))
    match = pattern.search(text)
    if not match:
        return None
    return match.group(1).strip()

def _strip_braces(token: str) -> str:
    token = normalize_token_braces(token or "").strip()
    if token.startswith("{") and token.endswith("}"):
        return token[1:-1].strip()
    return token

def _dedupe_preserve_order(items: Iterable[str]) -> List[str]:
    seen: Dict[str, None] = {}
    for item in items:
        if item not in seen:
            seen[item] = None
    return list(seen.keys())

_BEGIN_REPEAT_RE = re.compile(r"<!--\s*BEGIN:BLOCK_REPEAT\b", re.IGNORECASE)
_REPEAT_BLOCK_RE = re.compile(
    r"<!--\s*BEGIN:BLOCK_REPEAT\b.*?-->(.*?)<!--\s*END:BLOCK_REPEAT\b.*?-->",
    re.IGNORECASE | re.DOTALL,
)
_TR_PATTERN = re.compile(r"<tr\b", re.IGNORECASE)

def _extract_tokens(html_text: str) -> set[str]:
    return set(extract_tokens(normalize_token_braces(html_text or "")))

def _repeat_marker_counts(html_text: str) -> int:
    return len(_BEGIN_REPEAT_RE.findall(html_text or ""))

def _prototype_row_counts(html_text: str) -> List[int]:
    counts: List[int] = []
    for block in _REPEAT_BLOCK_RE.finditer(html_text or ""):
        segment = block.group(1) or ""
        counts.append(len(_TR_PATTERN.findall(segment)))
    return counts

def _write_fix_metrics(tdir: Path, payload: Dict[str, Any]) -> Path:
    metrics_path = Path(tdir) / "fix_metrics.json"
    write_json_atomic(
        metrics_path,
        payload,
        indent=2,
        ensure_ascii=False,
        sort_keys=True,
        step="template_verify_fix_metrics",
    )
    return metrics_path

def _parse_schema_ext(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception as exc:
        logger.warning(
            "schema_ext_json_parse_failed",
            extra={
                "event": "schema_ext_json_parse_failed",
                "error": str(exc),
                "snippet": raw[:200],
            },
        )
        return None
    if not isinstance(data, dict):
        logger.warning(
            "schema_ext_invalid_type",
            extra={"event": "schema_ext_invalid_type", "snippet": raw[:200]},
        )
        return None

    try:
        scalars_raw = data.get("scalars", [])
        row_tokens_raw = data.get("row_tokens", [])
        totals_raw = data.get("totals", [])
        notes_raw = data.get("notes", "")

        scalars = _dedupe_preserve_order(
            [_strip_braces(str(tok)) for tok in list(scalars_raw or []) if str(tok).strip()]
        )
        rows = _dedupe_preserve_order(
            [_strip_braces(str(tok)) for tok in list(row_tokens_raw or []) if str(tok).strip()]
        )
        totals = _dedupe_preserve_order([_strip_braces(str(tok)) for tok in list(totals_raw or []) if str(tok).strip()])

        if not isinstance(notes_raw, str):
            notes = str(notes_raw)
        else:
            notes = notes_raw
    except Exception as exc:
        logger.warning(
            "schema_ext_validation_failed",
            extra={
                "event": "schema_ext_validation_failed",
                "error": str(exc),
            },
        )
        return None

    return {
        "scalars": scalars,
        "row_tokens": rows,
        "totals": totals,
        "notes": notes,
    }

def get_openai_client():
    """
    Return a cached LLM client using the centralized LLM provider.

    This function is named get_openai_client for backward compatibility,
    but uses the configured LLM provider (local Qwen via LiteLLM) as the backend.
    """
    global _llm_client
    if _llm_client is not None:
        return _llm_client
    from backend.app.services.llm import get_llm_client
    _llm_client = get_llm_client()
    return _llm_client

def pdf_page_count(pdf_path: Path) -> int:
    """Return the number of pages in a PDF without rendering anything."""
    if fitz is None:
        raise RuntimeError("PyMuPDF (install via `pip install pymupdf`) is required for PDF operations.")
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count

def pdf_to_pngs(pdf_path: Path, out_dir: Path, dpi=400, *, page: int = 0):
    """Render a single page of the PDF to PNG."""
    if fitz is None:
        raise RuntimeError("PyMuPDF (install via `pip install pymupdf`) is required for PDF rendering.")
    assert pdf_path.exists(), f"PDF not found: {pdf_path}"
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    if page < 0 or page >= total_pages:
        doc.close()
        raise ValueError(
            f"Page index {page} out of range for PDF with {total_pages} page(s). "
            f"Valid range: 0–{total_pages - 1}."
        )
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pg = doc[page]
    pix = pg.get_pixmap(matrix=mat, alpha=False)
    out_png = out_dir / "reference_p1.png"
    pix.save(out_png)
    doc.close()
    logger.info(
        "pdf_page_rendered",
        extra={
            "event": "pdf_page_rendered",
            "pdf_path": str(pdf_path),
            "png_path": str(out_png),
            "page": page,
            "total_pages": total_pages,
            "dpi": dpi,
        },
    )
    return [out_png]

def b64_image(path: Path):
    return base64.b64encode(path.read_bytes()).decode("utf-8")

from backend.app.common import strip_code_fences  # noqa: E302 - canonical impl

CSS_PATCH_RE = re.compile(r"<!--BEGIN_CSS_PATCH-->([\s\S]*?)<!--END_CSS_PATCH-->", re.I)
HTML_BLOCK_RE = re.compile(r"<!--BEGIN_HTML-->([\s\S]*?)<!--END_HTML-->", re.I)
STYLE_BLOCK_RE = re.compile(r"(?is)<style\b[^>]*>(.*?)</style>")
TABLE_COMMENT_RE = re.compile(
    r"<!--\s*TABLE:(?P<table>[\w\-\.:]+)\s*-->\s*(?P<colgroup><colgroup\b[^>]*>.*?</colgroup>)",
    re.I | re.S,
)
COLGROUP_SNIPPET_RE = re.compile(r"(<colgroup\b[^>]*>.*?</colgroup>)", re.I | re.S)
COLGROUP_ATTR_TARGET_RE = re.compile(
    r"(data-(?:target|table|table-id|for)|table-id|for)\s*=\s*['\"](?P<value>[^'\"]+)['\"]",
    re.I,
)

def normalize_schema_for_initial_html(schema_json: Dict[str, Any]) -> Dict[str, Any]:
    """Return a legacy-compatible schema shape for initial HTML prompts."""
    scalars: Dict[str, str] = {}
    raw_scalars = schema_json.get("scalars", {})
    if isinstance(raw_scalars, dict):
        for key, value in raw_scalars.items():
            token = key
            label: str
            if isinstance(value, dict):
                token = str(value.get("token") or token)
                label = str(value.get("label") or value.get("token") or token)
            elif isinstance(value, str):
                label = value
            else:
                label = str(value)
            scalars[token] = label
    elif isinstance(raw_scalars, list):
        for entry in raw_scalars:
            if isinstance(entry, str):
                scalars[entry] = entry
            elif isinstance(entry, dict):
                token = entry.get("token") or entry.get("name") or entry.get("id")
                if token:
                    scalars[str(token)] = str(entry.get("label") or token)

    blocks_raw = schema_json.get("blocks") or {}
    rows: list[str] = []
    headers: list[str] = []
    repeat_regions = None
    if isinstance(blocks_raw, dict):
        raw_rows = blocks_raw.get("rows")
        if isinstance(raw_rows, list):
            for entry in raw_rows:
                if isinstance(entry, str):
                    rows.append(entry)
                elif isinstance(entry, dict):
                    token = entry.get("token") or entry.get("name") or entry.get("id")
                    if token:
                        rows.append(str(token))
        raw_headers = blocks_raw.get("headers")
        if isinstance(raw_headers, list):
            headers = [str(item) for item in raw_headers]
        repeat_regions = blocks_raw.get("repeat_regions")

    normalized_blocks: Dict[str, Any] = {}
    if rows:
        normalized_blocks["rows"] = rows
    if headers:
        normalized_blocks["headers"] = headers
    if repeat_regions:
        normalized_blocks["repeat_regions"] = repeat_regions

    normalized: Dict[str, Any] = {
        "scalars": scalars,
        "blocks": normalized_blocks,
    }
    notes = schema_json.get("notes")
    if isinstance(notes, str) and notes:
        normalized["notes"] = notes

    page_tokens = schema_json.get("page_tokens_protect") or schema_json.get("pageTokensProtect")
    if isinstance(page_tokens, list) and page_tokens:
        normalized["page_tokens_protect"] = page_tokens

    return normalized

def _iter_colgroup_updates(patch_body: str):
    seen: set[tuple[str, str]] = set()
    for match in TABLE_COMMENT_RE.finditer(patch_body):
        table_id = match.group("table").strip()
        colgroup_html = match.group("colgroup").strip()
        key = (table_id, colgroup_html)
        if table_id and colgroup_html and key not in seen:
            seen.add(key)
            yield table_id, colgroup_html

    for match in COLGROUP_SNIPPET_RE.finditer(patch_body):
        snippet = match.group(1).strip()
        attr_match = COLGROUP_ATTR_TARGET_RE.search(snippet)
        if not attr_match:
            continue
        table_id = attr_match.group("value").strip()
        key = (table_id, snippet)
        if table_id and key not in seen:
            seen.add(key)
            yield table_id, snippet

def apply_fix_response(html_before: str, llm_output: str) -> str:
    """Merge LLM fix output into the existing HTML."""
    output = llm_output.strip()
    css_match = CSS_PATCH_RE.search(output)
    if css_match:
        patch_body = css_match.group(1).strip()
        style_match = STYLE_BLOCK_RE.search(patch_body)
        css_rules = style_match.group(1).strip() if style_match else patch_body
        merged = merge_css_into_html(html_before, css_rules)
        for table_id, colgroup_html in _iter_colgroup_updates(patch_body):
            merged = replace_table_colgroup(merged, table_id, colgroup_html)
        return merged

    html_match = HTML_BLOCK_RE.search(output)
    if html_match:
        return html_match.group(1).strip()

    return output

def render_panel_preview(
    html_path: Path,
    dest_png: Path,
    *,
    fallback_png: Optional[Path] = None,
    dpi: int = 144,
) -> Path:
    """
    Generate a template snapshot that matches the front-end preview
    (CSS-sized A4 at ~96 DPI, optionally with a device scale factor).
    Falls back to the existing PNG if rasterisation fails.
    """
    html_path = Path(html_path)
    dest_png = Path(dest_png)
    fallback_png = Path(fallback_png) if fallback_png else None
    try:
        html_text = html_path.read_text(encoding="utf-8")
        png_bytes = rasterize_html_to_png(html_text, dpi=dpi, method="screenshot")
        save_png(png_bytes, str(dest_png))
    except Exception:
        logger.warning(
            "render_panel_preview_failed",
            exc_info=True,
            extra={"event": "render_panel_preview_failed", "html_path": str(html_path)},
        )
        if fallback_png and fallback_png.exists():
            dest_png.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(fallback_png, dest_png)
    return dest_png

def render_html_to_png(html_path: Path, out_png: Path, *, page_size: str = "A4") -> None:
    """
    Render HTML to PNG using the shared utils helper for compatibility with existing imports.
    """
    _render_html_to_png_sync(html_path, out_png, page_size=page_size)

def compare_images(ref_img_path: Path, test_img_path: Path, out_diff: Path):
    if None in (Image, np, cv2, ssim):
        raise RuntimeError("Image comparison requires Pillow, numpy, opencv-python, and scikit-image.")
    A = Image.open(ref_img_path).convert("RGB")
    B = Image.open(test_img_path).convert("RGB")
    # Resize both to the same target (e.g., width of reference)
    target = (A.width, A.height)
    B = B.resize(target)
    A_arr = np.array(A).astype("uint8")
    B_arr = np.array(B).astype("uint8")
    A_g = cv2.cvtColor(A_arr, cv2.COLOR_RGB2GRAY)
    B_g = cv2.cvtColor(B_arr, cv2.COLOR_RGB2GRAY)
    score, diff = ssim(A_g, B_g, full=True, data_range=255)
    heat = ((1 - diff) * 255).astype("uint8")
    heat_color = cv2.applyColorMap(heat, cv2.COLORMAP_JET)
    overlay = cv2.addWeighted(A_arr, 0.6, heat_color, 0.4, 0)
    cv2.imwrite(str(out_diff), cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
    return float(score)

def save_html(path: Path, html: str):
    normalized_html = sanitize_html(normalize_token_braces(html))
    write_text_atomic(path, normalized_html, encoding="utf-8", step="template_verify_save")
    logger.info(
        "html_saved",
        extra={"event": "html_saved", "path": str(path)},
    )

# LLM client initialised lazily via get_openai_client() (uses local Qwen via LiteLLM)

def _extract_pdf_page_text(pdf_path: Path, page_index: int = 0) -> str:
    """Extract structured text from a PDF page using PyMuPDF.

    Returns the raw text content with layout preserved as much as possible.
    This is critical for text-only LLMs that cannot see the attached image.
    """
    try:
        import fitz
        with fitz.open(str(pdf_path)) as doc:
            if page_index < 0 or page_index >= len(doc):
                return ""
            page = doc[page_index]
            # Use "text" mode for structured extraction preserving layout
            text = page.get_text("text")
            if text and text.strip():
                return text.strip()
            # Fallback: try blocks mode for better structure
            blocks = page.get_text("blocks")
            lines = []
            for b in sorted(blocks, key=lambda x: (x[1], x[0])):
                if b[6] == 0:  # text block
                    lines.append(b[4].strip())
            return "\n".join(lines)
    except Exception as exc:
        logger.debug("pdf_text_extraction_failed", extra={"error": str(exc)})
        return ""

def _extract_vision_text(page_png: Path) -> Optional[dict]:
    """Use GLM-OCR to extract STRUCTURED text from a PDF page image.

    Delegates to ocr_extract_structured() which calls Ollama with a
    production-quality prompt that separates scalar fields, column headers,
    data samples, and layout notes.

    Returns structured OCR dict, or None if unavailable.
    """
    from backend.app.services.infra_services import ocr_extract_structured
    image_bytes = page_png.read_bytes()
    result = ocr_extract_structured(image_bytes)
    if result and result.get("raw_text"):
        logger.info("vision_text_extracted", extra={
            "event": "vision_text_extracted",
            "chars": len(result["raw_text"]),
            "headers": len(result.get("sections", {}).get("column_headers", [])),
        })
        return result
    return None


def _save_structured_ocr(tdir: Path, ocr_result: dict, page_index: int = 0) -> None:
    """Persist structured OCR to template directory (single extraction point)."""
    # Structured JSON
    ocr_result["page"] = page_index
    ocr_result["dpi"] = 400
    (tdir / "ocr_structured.json").write_text(
        json.dumps(ocr_result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # Backward-compatible raw text
    raw_text = ocr_result.get("raw_text", "")
    if raw_text:
        (tdir / "ocr_reference.txt").write_text(raw_text, encoding="utf-8")
    logger.info("structured_ocr_saved", extra={
        "chars": len(raw_text),
        "headers": len(ocr_result.get("sections", {}).get("column_headers", [])),
    })

def request_initial_html(
    page_png: Path,
    schema_json: Optional[dict],
    layout_hints: Optional[Dict[str, Any]] = None,
    pdf_path: Optional[Path] = None,
    page_index: int = 0,
) -> InitialHtmlResult:
    """Ask the LLM to synthesize the first-pass HTML photocopy and optional schema."""
    prompt_template = _load_llm_call1_prompt()
    schema_str = ""
    if schema_json:
        schema_str = json.dumps(schema_json, ensure_ascii=False, separators=(",", ":"))
    prompt = prompt_template.replace("{schema_str}", schema_str)
    hints_json = json.dumps(layout_hints or {}, ensure_ascii=False, separators=(",", ":"))

    # Extract text from the PDF page for text-only LLMs
    pdf_text = ""
    if pdf_path and pdf_path.exists():
        pdf_text = _extract_pdf_page_text(pdf_path, page_index)
        if pdf_text:
            logger.info(
                "pdf_text_extracted",
                extra={"event": "pdf_text_extracted", "chars": len(pdf_text)},
            )

    # Try vision-based extraction for superior quality (GLM-OCR structured)
    vision_result = _extract_vision_text(page_png)
    if vision_result:
        # Save structured OCR immediately — this is the ONE extraction point
        tdir = page_png.parent
        _save_structured_ocr(tdir, vision_result, page_index=page_index)

        # Format for LLM prompt injection
        from backend.app.services.infra_services import format_ocr_for_llm
        vision_text = format_ocr_for_llm(vision_result)
        if not pdf_text or len(vision_text) >= len(pdf_text) * 0.5:
            logger.info("using_vision_text", extra={
                "event": "using_vision_text",
                "vision_chars": len(vision_text),
                "pymupdf_chars": len(pdf_text),
            })
            pdf_text = vision_text

    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    if hints_json and hints_json != "{}":
        content.append({"type": "text", "text": "HINTS_JSON:\n" + hints_json})
    # Include extracted PDF text so text-only models know the actual content
    if pdf_text:
        content.append({
            "type": "text",
            "text": (
                "PDF_PAGE_TEXT (exact text extracted from the PDF page — use these "
                "EXACT column headers and field names for your token names, do NOT "
                "invent generic names):\n" + pdf_text[:8000]
            ),
        })
    content.append(
        {
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64_image(page_png)}"},
        }
    )

    client = get_openai_client()
    resp = call_chat_completion(
        client,
        model=_ensure_model(),
        messages=[{"role": "user", "content": content}],
        description="template_initial_html",
    )

    raw_content = resp.choices[0].message.content or ""
    # Strip Qwen thinking tags before extracting HTML
    import re as _re
    raw_content = _re.sub(r"<think>.*?</think>", "", raw_content, flags=_re.DOTALL).strip()
    raw_content = strip_code_fences(raw_content)

    html_section = _extract_marked_section(raw_content, "<!--BEGIN_HTML-->", "<!--END_HTML-->")
    if html_section is None:
        logger.warning(
            "initial_html_marker_missing",
            extra={
                "event": "initial_html_marker_missing",
                "marker": "HTML",
            },
        )
        html_section = raw_content
    html_clean = normalize_token_braces(html_section.strip())

    schema_section = _extract_marked_section(raw_content, "<!--BEGIN_SCHEMA_JSON-->", "<!--END_SCHEMA_JSON-->")
    schema_payload = None
    if schema_section:
        schema_payload = _parse_schema_ext(schema_section)
        if schema_payload is None:
            logger.warning(
                "initial_schema_ext_invalid",
                extra={
                    "event": "initial_schema_ext_invalid",
                    "snippet": schema_section[:200],
                },
            )

    return InitialHtmlResult(
        html=html_clean,
        schema=schema_payload,
        schema_text=schema_section,
    )

def request_fix_html(
    pdf_dir: Path,
    html_path: Path,
    schema_path_or_none: Optional[Path],
    reference_png_path: Path,
    render_png_path: Path,
    ssim_value: float,
) -> Dict[str, Any]:
    """
    Execute the single-pass HTML refinement call (LLM CALL 2) and enforce strict invariants.

    Returns a payload with acceptance metadata and artifact paths:
        {
            "accepted": bool,
            "rejected_reason": Optional[str],
            "render_after_path": Optional[Path],
            "metrics_path": Path,
            "raw_response": str,
        }
    """
    pdf_dir = Path(pdf_dir)
    html_path = Path(html_path)
    schema_path = Path(schema_path_or_none) if schema_path_or_none else None
    reference_png_path = Path(reference_png_path)
    render_png_path = Path(render_png_path)

    current_html = html_path.read_text(encoding="utf-8")

    # --- Skip image-comparison refinement for non-vision models ---
    # The fix step requires the LLM to compare reference vs rendered images.
    # Non-vision models (e.g. Qwen via LiteLLM) cannot do this,
    # so we accept the initial HTML as-is.
    from backend.app.services.llm import get_llm_config
    _cfg = get_llm_config()
    if not getattr(_cfg, "supports_vision", False):
        logger.info(
            "request_fix_html_skipped_no_vision",
            extra={
                "event": "request_fix_html_skipped_no_vision",
                "model": _cfg.model,
            },
        )
        metrics: Dict[str, Any] = {"accepted": True, "rejected_reason": "skipped_no_vision_model"}
        metrics_path = _write_fix_metrics(pdf_dir, metrics)
        return {
            "accepted": True,
            "rejected_reason": None,
            "render_after_path": None,
            "render_after_full_path": None,
            "metrics_path": metrics_path,
            "raw_response": "",
        }

    schema_text = "{}"
    if schema_path and schema_path.exists():
        try:
            schema_payload = json.loads(schema_path.read_text(encoding="utf-8"))
            schema_text = json.dumps(schema_payload, ensure_ascii=False, indent=2, sort_keys=True)
        except Exception as exc:
            logger.warning(
                "template_fix_html_schema_load_failed",
                extra={
                    "event": "template_fix_html_schema_load_failed",
                    "path": str(schema_path),
                    "error": str(exc),
                },
            )
            schema_text = "{}"

    prompt_template = _load_llm_call2_prompt()
    prompt_text = prompt_template.replace("{{ssim_value:.4f}}", "0.0000")
    prompt_text = prompt_text.replace("{schema_str}", schema_text)
    prompt_text = prompt_text.replace("{current_html}", current_html)
    prompt_text = prompt_text.replace("(embedded image URL)", "").strip()

    client = get_openai_client()
    response = call_chat_completion(
        client,
        model=_ensure_model(),
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_text},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64_image(reference_png_path)}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{b64_image(render_png_path)}",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
        description="template_fix_html_call2",
    )
    raw_response = (response.choices[0].message.content or "").strip()

    refined_html = _extract_marked_section(raw_response, "<!--BEGIN_HTML-->", "<!--END_HTML-->")
    metrics: Dict[str, Any] = {
        "accepted": False,
        "rejected_reason": None,
    }
    render_after_path: Optional[Path] = None

    if refined_html is None:
        logger.warning(
            "template_fix_html_missing_markers",
            extra={
                "event": "template_fix_html_missing_markers",
                "snippet": raw_response[:300],
            },
        )
        metrics["rejected_reason"] = "missing_markers"
        save_html(html_path, current_html)
        metrics_path = _write_fix_metrics(pdf_dir, metrics)
        return {
            "accepted": False,
            "rejected_reason": "missing_markers",
            "render_after_path": render_after_path,
            "render_after_full_path": None,
            "metrics_path": metrics_path,
            "raw_response": raw_response,
        }

    tokens_before = _extract_tokens(current_html)
    tokens_after = _extract_tokens(refined_html)
    if tokens_before != tokens_after:
        logger.warning(
            "template_fix_html_token_drift",
            extra={
                "event": "template_fix_html_token_drift",
                "tokens_missing": sorted(tokens_before - tokens_after),
                "tokens_added": sorted(tokens_after - tokens_before),
            },
        )
        metrics["rejected_reason"] = "token_drift"
        save_html(html_path, current_html)
        metrics_path = _write_fix_metrics(pdf_dir, metrics)
        return {
            "accepted": False,
            "rejected_reason": "token_drift",
            "render_after_path": render_after_path,
            "render_after_full_path": None,
            "metrics_path": metrics_path,
            "raw_response": raw_response,
        }

    repeats_before = _repeat_marker_counts(current_html)
    repeats_after = _repeat_marker_counts(refined_html)
    if repeats_before != repeats_after:
        logger.warning(
            "template_fix_html_repeat_marker_drift",
            extra={
                "event": "template_fix_html_repeat_marker_drift",
                "before": repeats_before,
                "after": repeats_after,
            },
        )
        metrics["rejected_reason"] = "repeat_marker_drift"
        save_html(html_path, current_html)
        metrics_path = _write_fix_metrics(pdf_dir, metrics)
        return {
            "accepted": False,
            "rejected_reason": "repeat_marker_drift",
            "render_after_path": render_after_path,
            "render_after_full_path": None,
            "metrics_path": metrics_path,
            "raw_response": raw_response,
        }

    prototype_before = _prototype_row_counts(current_html)
    prototype_after = _prototype_row_counts(refined_html)
    if prototype_before != prototype_after:
        logger.warning(
            "template_fix_html_prototype_row_drift",
            extra={
                "event": "template_fix_html_prototype_row_drift",
                "before": prototype_before,
                "after": prototype_after,
            },
        )
        metrics["rejected_reason"] = "prototype_row_drift"
        save_html(html_path, current_html)
        metrics_path = _write_fix_metrics(pdf_dir, metrics)
        return {
            "accepted": False,
            "rejected_reason": "prototype_row_drift",
            "render_after_path": render_after_path,
            "render_after_full_path": None,
            "metrics_path": metrics_path,
            "raw_response": raw_response,
        }

    save_html(html_path, refined_html)
    metrics["accepted"] = True

    render_after_full_path = pdf_dir / "render_p1_after_full.png"
    render_html_to_png(html_path, render_after_full_path)
    render_after_path = pdf_dir / "render_p1_after.png"
    render_panel_preview(html_path, render_after_path, fallback_png=render_after_full_path)
    metrics_path = _write_fix_metrics(pdf_dir, metrics)

    logger.info(
        "template_fix_html_complete",
        extra={
            "event": "template_fix_html_complete",
            "accepted": metrics["accepted"],
        },
    )

    return {
        "accepted": True,
        "rejected_reason": None,
        "render_after_path": render_after_path,
        "render_after_full_path": render_after_full_path,
        "metrics_path": metrics_path,
        "raw_response": raw_response,
    }

async def main():
    raise RuntimeError("Legacy CLI entrypoint removed. Use the API verify flow instead.")

if __name__ == "__main__":
    asyncio.run(main())

"""Templates service placeholder."""
