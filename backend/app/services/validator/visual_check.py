# mypy: ignore-errors
"""Visual verification — LLM inspects the generated report PDF via vision."""
from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import Any

from .models import Severity, ValidationIssue

logger = logging.getLogger("neura.validator.visual")


def visual_verify_report(
    pdf_path: Path,
    contract: dict,
    template_dir: Path | None = None,
) -> list[ValidationIssue]:
    """
    Render page 1 of the dry-run PDF and ask Qwen 3.5 27B (via LiteLLM vision)
    to verify it looks correct.

    Returns a list of ValidationIssue from the LLM's inspection.
    """
    issues: list[ValidationIssue] = []

    # ---------------------------------------------------------------
    # Step 1: Render PDF page 1 to PNG
    # ---------------------------------------------------------------
    try:
        import fitz
        doc = fitz.open(str(pdf_path))
        if len(doc) == 0:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="visual",
                message="Dry-run PDF has 0 pages",
            ))
            doc.close()
            return issues

        page = doc[0]
        pix = page.get_pixmap(dpi=200)
        png_bytes = pix.tobytes("png")
        doc.close()
        b64_image = base64.b64encode(png_bytes).decode()
        logger.info(f"visual_check_png_rendered size={len(png_bytes)}")
    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="visual",
            message=f"Could not render PDF for visual check: {exc}",
        ))
        return issues

    # ---------------------------------------------------------------
    # Step 2: Build expected columns list from contract
    # ---------------------------------------------------------------
    tokens = contract.get("tokens", {})
    expected_columns = tokens.get("row_tokens", [])
    scalars = tokens.get("scalars", [])

    # ---------------------------------------------------------------
    # Step 2b: OCR pre-check — detect leaked placeholders and cross-check headers
    # ---------------------------------------------------------------
    try:
        from backend.app.services.infra_services import ocr_extract, VALIDATION_OCR_PROMPT
        ocr_text = ocr_extract(png_bytes, prompt=VALIDATION_OCR_PROMPT)
        if ocr_text:
            import re as _re
            leaked = _re.findall(r'\{\{?\s*[A-Za-z_][\w.]*\s*\}\}?', ocr_text)
            if leaked:
                issues.append(ValidationIssue(
                    severity=Severity.ERROR,
                    category="visual_ocr",
                    message=f"OCR detected {len(leaked)} unreplaced token(s): {', '.join(leaked[:5])}",
                    detail=f"Full OCR text (first 300 chars): {ocr_text[:300]}",
                ))
            # Check expected columns appear in output
            expected_cols = tokens.get("row_tokens", [])
            if expected_cols and ocr_text:
                missing = [c for c in expected_cols[:8] if c.lower().replace("_", " ").replace("row ", "") not in ocr_text.lower()]
                if missing and len(missing) > len(expected_cols) * 0.5:
                    issues.append(ValidationIssue(
                        severity=Severity.WARNING,
                        category="visual_ocr",
                        message=f"OCR could not find {len(missing)}/{len(expected_cols)} expected columns",
                        detail=f"Missing: {', '.join(missing[:5])}",
                    ))

            # Cross-check: compare generated report headers against source PDF OCR
            if template_dir:
                try:
                    ocr_json_path = template_dir / "ocr_structured.json"
                    if ocr_json_path.exists():
                        source_ocr = json.loads(ocr_json_path.read_text())
                        source_headers = [
                            h["text"].lower()
                            for h in source_ocr.get("sections", {}).get("column_headers", [])
                        ]
                        if source_headers:
                            missing_headers = [
                                h for h in source_headers
                                if h not in ocr_text.lower()
                            ]
                            if missing_headers:
                                issues.append(ValidationIssue(
                                    severity=Severity.WARNING,
                                    category="visual_ocr",
                                    message=f"Generated report missing {len(missing_headers)} column header(s) from source PDF",
                                    detail=f"Missing: {', '.join(missing_headers[:5])}",
                                ))
                except Exception:
                    logger.debug("source_ocr_crosscheck_failed", exc_info=True)

            logger.info("visual_ocr_check_done", extra={"leaked": len(leaked) if 'leaked' in dir() else 0})
    except Exception:
        logger.debug("visual_ocr_skipped", exc_info=True)

    # ---------------------------------------------------------------
    # Step 3: Call Qwen 3.5 27B via LiteLLM vision
    # ---------------------------------------------------------------
    prompt = f"""You are a report quality inspector. Examine this generated report PDF and check:

1. HEADER: Is there a company name and report title visible at the top?
2. TABLE STRUCTURE: Are column headers present and readable in a table?
3. DATA ROWS: Are there actual data values (numbers, dates) in the table rows? Not placeholders.
4. TOKEN LEAKS: Are there any visible {{placeholder}} or {{{{token}}}} strings that should have been replaced with real data? This is a critical error.
5. LAYOUT: Is the layout clean — no overlapping text, no cut-off columns, no broken borders?
6. BLANK SECTIONS: Are there large blank areas where data should be?

Expected row columns: {', '.join(expected_columns)}
Expected header fields: {', '.join(scalars)}

Return ONLY valid JSON (no markdown, no commentary):
{{"passed": true_or_false, "issues": [{{"severity": "error_or_warning", "message": "description"}}]}}
If everything looks good, return: {{"passed": true, "issues": []}}"""

    raw_text = ""
    try:
        import requests

        from backend.app.services.llm import get_llm_config
        config = get_llm_config()
        api_base = getattr(config, 'api_base', 'http://localhost:4000').rstrip('/')

        resp = requests.post(
            f"{api_base}/v1/messages",
            json={
                "model": getattr(config, 'model', 'qwen'),
                "max_tokens": 1000,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image", "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": b64_image,
                        }},
                    ],
                }],
            },
            headers={
                "x-api-key": getattr(config, 'api_key', 'dummy') or "dummy",
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            timeout=180,
        )

        data = resp.json()
        if "error" in data:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="visual",
                message=f"Visual LLM call failed: {data['error']}",
            ))
            return issues

        raw_text = data.get("content", [{}])[0].get("text", "")
        logger.info(f"visual_check_llm_response length={len(raw_text)}")

        # Parse JSON from response (strip markdown fences if present)
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        result = json.loads(cleaned)
        llm_passed = result.get("passed", False)
        llm_issues = result.get("issues", [])

        for li in llm_issues:
            sev = Severity.ERROR if li.get("severity") == "error" else Severity.WARNING
            issues.append(ValidationIssue(
                severity=sev, category="visual",
                message=li.get("message", "Visual issue detected by LLM"),
            ))

        if llm_passed and not llm_issues:
            issues.append(ValidationIssue(
                severity=Severity.INFO, category="visual",
                message="Visual inspection passed — report looks correct",
            ))

    except json.JSONDecodeError as exc:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="visual",
            message=f"Could not parse LLM visual response: {exc}",
            detail=raw_text[:200] if raw_text else None,
        ))
    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="visual",
            message=f"Visual verification failed: {exc}",
        ))

    return issues
