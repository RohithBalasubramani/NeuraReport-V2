# mypy: ignore-errors
"""Dry run — actual report generation with sample data to verify the full pipeline."""
from __future__ import annotations

import json
import logging
import shutil
import traceback
from pathlib import Path
from typing import Any, Optional

from .models import Severity, ValidationIssue

logger = logging.getLogger("neura.validator.dry_run")


def run_dry_report(
    template_id: str,
    connection_id: str,
    contract: dict,
    template_html: str,
    db_path: Path,
    template_dir: Path,
) -> tuple[list[ValidationIssue], Optional[Path], Optional[Path]]:
    """
    Run an actual report generation with a small sample of data.

    Returns (issues, pdf_path_or_none, html_path_or_none).
    """
    issues: list[ValidationIssue] = []
    validation_dir = template_dir / "_validation"

    if not template_dir.exists():
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="dry_run",
            message=f"Template directory not found: {template_dir}",
        ))
        return issues, None, None

    validation_dir.mkdir(parents=True, exist_ok=True)

    # ---------------------------------------------------------------
    # Step 1: Find a sample date range (~50 rows)
    # ---------------------------------------------------------------
    date_cols = contract.get("date_columns", {})
    start_date = None
    end_date = None

    if date_cols:
        try:
            import pandas as pd
            from backend.app.repositories.dataframes.sqlite_loader import SQLiteDataFrameLoader

            loader = SQLiteDataFrameLoader(str(db_path))
            for table, col in date_cols.items():
                if table in loader.table_names():
                    df = loader.frame(table)
                    if col in df.columns:
                        dates = pd.to_datetime(df[col], errors="coerce").dropna()
                        if len(dates) > 0:
                            # Pick the earliest date range that gives ~50 rows
                            min_date = dates.min()
                            # Try 1-day window first
                            mask = dates.between(min_date, min_date + pd.Timedelta(days=1))
                            count = mask.sum()
                            if count > 0:
                                start_date = str(min_date.date())
                                end_date = str((min_date + pd.Timedelta(days=1)).date())
                                logger.info(f"dry_run_date_range start={start_date} end={end_date} rows={count}")
                            break
        except Exception as exc:
            logger.warning(f"Could not determine sample date range: {exc}")

    if not start_date:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="dry_run",
            message="Could not determine sample date range — using full dataset (may be slow)",
        ))

    # ---------------------------------------------------------------
    # Step 2: Run discovery
    # ---------------------------------------------------------------
    batches = []
    try:
        from backend.app.services.reports import discover_batches_and_counts

        discovery_result = discover_batches_and_counts(
            db_path=db_path,
            contract=contract,
            start_date=start_date,
            end_date=end_date,
        )
        # discover_batches_and_counts returns {"batches": [...], "batches_count": N, ...}
        if isinstance(discovery_result, dict):
            batches = discovery_result.get("batches", [])
        else:
            batches = discovery_result or []

        if not batches:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="dry_run",
                message="Discovery returned 0 batches — no data in the selected range",
                fix_hint="Check date columns and filters in the contract",
            ))
            return issues, None, None

        issues.append(ValidationIssue(
            severity=Severity.INFO, category="dry_run",
            message=f"Discovery found {len(batches)} batch(es) for sample range",
        ))
    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="dry_run",
            message=f"Discovery failed: {exc}",
            detail=traceback.format_exc()[-500:],
        ))
        return issues, None, None

    # ---------------------------------------------------------------
    # Step 3: Run fill_and_print for 1 batch
    # ---------------------------------------------------------------
    pdf_path = None
    html_path = None

    try:
        from backend.app.services.reports import fill_and_print

        # Pick first batch
        batch = batches[0] if isinstance(batches, list) else list(batches.values())[0] if isinstance(batches, dict) else None
        batch_id = batch.get("id", batch.get("batch_id", "1")) if isinstance(batch, dict) else str(batch) if batch else "1"

        # Write the template HTML into the validation dir so fill_and_print can find it
        template_file = validation_dir / "template.html"
        template_file.write_text(template_html, encoding="utf-8")
        out_html = validation_dir / "dry_run_output.html"
        out_pdf = validation_dir / "dry_run_output.pdf"

        result = fill_and_print(
            OBJ=contract,
            TEMPLATE_PATH=template_file,
            DB_PATH=db_path,
            OUT_HTML=out_html,
            OUT_PDF=out_pdf,
            START_DATE=start_date or "",
            END_DATE=end_date or "",
            batch_ids=[batch_id],
        )

        # Check for output files
        if out_pdf.exists():
            pdf_path = out_pdf
        if out_html.exists():
            html_path = out_html

        if pdf_path and pdf_path.stat().st_size > 1024:
            issues.append(ValidationIssue(
                severity=Severity.INFO, category="dry_run",
                message=f"Dry run PDF generated: {pdf_path.stat().st_size / 1024:.0f} KB",
            ))
        elif pdf_path:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="dry_run",
                message=f"Dry run PDF is suspiciously small: {pdf_path.stat().st_size} bytes",
            ))
        else:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="dry_run",
                message="Dry run completed but no PDF was generated",
            ))

    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="dry_run",
            message=f"Dry run report generation failed: {type(exc).__name__}: {exc}",
            detail=traceback.format_exc()[-500:],
            fix_hint="Fix the contract/mapping and re-approve",
        ))

    return issues, pdf_path, html_path
