# mypy: ignore-errors
"""Validation runner — orchestrates deterministic checks, dry run, and visual verification."""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from .models import Severity, ValidationIssue, ValidationResult

logger = logging.getLogger("neura.validator.runner")


async def validate_pipeline(
    *,
    template_id: str,
    connection_id: str,
    db_path: Path,
    template_dir: Path,
    key_values: dict | None = None,
    skip_llm: bool = False,
) -> ValidationResult:
    """
    Full pipeline validation:
      Phase 1 — Deterministic checks (fast, no LLM)
      Phase 2 — Dry run (actual report generation with sample data)
      Phase 3 — Visual verification (LLM vision inspects the PDF)

    Returns a ValidationResult. Blocks generation if passed=False.
    """
    all_issues: list[ValidationIssue] = []
    result = ValidationResult(passed=True)

    # ---------------------------------------------------------------
    # Load artifacts
    # ---------------------------------------------------------------
    contract_path = template_dir / "contract.json"
    if not contract_path.exists():
        return ValidationResult(
            passed=False,
            issues=[ValidationIssue(
                severity=Severity.ERROR, category="artifact",
                message="contract.json not found — run approve first",
            )],
        )

    contract = json.loads(contract_path.read_text(encoding="utf-8"))

    template_html = ""
    for name in ("report_final.html", "template_p1.html"):
        p = template_dir / name
        if p.exists() and p.stat().st_size > 0:
            template_html = p.read_text(encoding="utf-8")
            break

    if not template_html:
        return ValidationResult(
            passed=False,
            issues=[ValidationIssue(
                severity=Severity.ERROR, category="artifact",
                message="No template HTML found",
            )],
        )

    # ---------------------------------------------------------------
    # Phase 1: Deterministic checks
    # ---------------------------------------------------------------
    logger.info("validation_phase1_start")
    t0 = time.time()

    try:
        # Support pre-built loaders (MultiDataFrameLoader) via duck-typing
        if hasattr(db_path, 'table_names') and callable(db_path.table_names):
            loader = db_path
        else:
            from backend.app.repositories.dataframes.sqlite_loader import SQLiteDataFrameLoader
            loader = SQLiteDataFrameLoader(str(db_path))
    except Exception as exc:
        return ValidationResult(
            passed=False,
            issues=[ValidationIssue(
                severity=Severity.ERROR, category="db",
                message=f"Cannot connect to database: {exc}",
            )],
        )

    from .checks import run_all_deterministic
    det_issues = run_all_deterministic(
        contract=contract,
        template_html=template_html,
        loader=loader,
        key_values=key_values,
    )
    all_issues.extend(det_issues)
    result.deterministic_ms = (time.time() - t0) * 1000
    result.checks_run = len(det_issues)

    det_errors = [i for i in det_issues if i.severity == Severity.ERROR]
    logger.info(f"validation_phase1_done checks={len(det_issues)} errors={len(det_errors)} ms={result.deterministic_ms:.0f}")

    # ---------------------------------------------------------------
    # Phase 2: Dry run
    # ---------------------------------------------------------------
    logger.info("validation_phase2_start")
    t1 = time.time()

    from .dry_run import run_dry_report
    try:
        dry_issues, pdf_path, html_path = run_dry_report(
            template_id=template_id,
            connection_id=connection_id,
            contract=contract,
            template_html=template_html,
            db_path=db_path,
            template_dir=template_dir,
        )
        all_issues.extend(dry_issues)
        result.dry_run_pdf_path = pdf_path
        result.dry_run_html_path = html_path
    except Exception as exc:
        all_issues.append(ValidationIssue(
            severity=Severity.ERROR, category="dry_run",
            message=f"Dry run crashed: {exc}",
        ))

    result.dry_run_ms = (time.time() - t1) * 1000
    logger.info(f"validation_phase2_done pdf={'yes' if result.dry_run_pdf_path else 'no'} ms={result.dry_run_ms:.0f}")

    # ---------------------------------------------------------------
    # Phase 3: LLM analysis + visual verification
    # ---------------------------------------------------------------
    if not skip_llm:
        logger.info("validation_phase3_start")
        t2 = time.time()

        from .cli_validator import cli_analyze_results, cli_visual_inspect

        # 3a: LLM analyzes validation results
        try:
            partial_result = {
                "deterministic_errors": [i.to_dict() for i in all_issues if i.severity == Severity.ERROR],
                "deterministic_warnings": [i.to_dict() for i in all_issues if i.severity == Severity.WARNING],
                "dry_run_pdf": str(result.dry_run_pdf_path) if result.dry_run_pdf_path else None,
                "template_id": template_id,
            }
            cli_issues = cli_analyze_results(partial_result, template_dir)
            all_issues.extend(cli_issues)
        except Exception as exc:
            all_issues.append(ValidationIssue(
                severity=Severity.WARNING, category="cli_analysis",
                message=f"LLM analysis failed: {exc}",
            ))

        # 3b: Visual inspection of dry-run PDF (via LiteLLM vision)
        if result.dry_run_pdf_path:
            try:
                vis_issues = cli_visual_inspect(
                    pdf_path=result.dry_run_pdf_path,
                    contract=contract,
                )
                all_issues.extend(vis_issues)
                vis_errors = [i for i in vis_issues if i.severity == Severity.ERROR]
                result.visual_check_passed = len(vis_errors) == 0
            except Exception as exc:
                all_issues.append(ValidationIssue(
                    severity=Severity.WARNING, category="visual",
                    message=f"Visual check failed: {exc}",
                ))

        result.visual_ms = (time.time() - t2) * 1000
        logger.info(f"validation_phase3_done visual_passed={result.visual_check_passed} ms={result.visual_ms:.0f}")

    # ---------------------------------------------------------------
    # Assemble result
    # ---------------------------------------------------------------
    result.issues = all_issues
    result.checks_run = len(all_issues)
    result.passed = not any(i.severity == Severity.ERROR for i in all_issues)

    logger.info(
        "validation_complete",
        extra={
            "passed": result.passed,
            "errors": len(result.errors),
            "warnings": len(result.warnings),
            "total_ms": round(result.deterministic_ms + result.dry_run_ms + result.visual_ms, 1),
        },
    )

    return result
