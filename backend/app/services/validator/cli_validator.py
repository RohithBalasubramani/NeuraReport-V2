# mypy: ignore-errors
"""
LLM validator — uses Qwen 3.5 27B (via Hermes/LiteLLM/vLLM) to analyze
validation results and visually inspect generated reports.

Architecture:
1. Python runs deterministic checks + dry run → produces results JSON + PDF
2. LLM (Qwen 3.5) gets results + PDF image → makes final judgment
3. For vision: direct LiteLLM call with base64 images

The LLM acts as the decision-maker while Python does the heavy lifting
of actual validation.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from pathlib import Path
from typing import Any, Optional

from .models import Severity, ValidationIssue, ValidationResult

logger = logging.getLogger("neura.validator.llm")


def _get_llm_client():
    """Get OpenAI-compatible client pointed at LiteLLM/vLLM."""
    from backend.app.services.llm import get_llm_config
    from openai import OpenAI

    config = get_llm_config()
    api_base = config.api_base.rstrip("/")
    if not api_base.endswith("/v1"):
        api_base = f"{api_base}/v1"

    client = OpenAI(
        base_url=api_base,
        api_key=config.api_key or "none",
        timeout=120.0,
    )
    model = config.model or "qwen"
    return client, model


def cli_analyze_results(
    validation_json: dict,
    template_dir: Path,
) -> list[ValidationIssue]:
    """
    Pass validation results to Qwen 3.5 (via LiteLLM) for analysis.
    Returns LLM-generated issues/recommendations.
    """
    issues: list[ValidationIssue] = []

    prompt = f"""You are a NeuraReport pipeline validator. Analyze these validation results and provide your verdict.

VALIDATION RESULTS:
{json.dumps(validation_json, indent=2)}

TEMPLATE DIRECTORY: {template_dir}

Respond with EXACTLY this JSON format (no markdown, no commentary):
{{"verdict": "PASS" or "FAIL", "analysis": "brief explanation", "critical_fixes": ["fix1", "fix2"]}}"""

    try:
        client, model = _get_llm_client()

        t0 = time.time()
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=2048,
        )
        elapsed = time.time() - t0

        content = (response.choices[0].message.content or "").strip()
        logger.info(f"llm_analyze elapsed={elapsed:.1f}s output_len={len(content)}")

        if not content:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="llm_analysis",
                message="LLM returned empty analysis",
            ))
            return issues

        # Parse JSON from response
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        data = json.loads(cleaned)
        verdict = data.get("verdict", "UNKNOWN")
        analysis = data.get("analysis", "")
        fixes = data.get("critical_fixes", [])

        sev = Severity.INFO if verdict == "PASS" else Severity.ERROR
        issues.append(ValidationIssue(
            severity=sev, category="llm_analysis",
            message=f"LLM verdict: {verdict} — {analysis}",
        ))

        for fix in fixes:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="llm_fix",
                message=f"Recommended fix: {fix}",
            ))

    except json.JSONDecodeError:
        issues.append(ValidationIssue(
            severity=Severity.INFO, category="llm_analysis",
            message=f"LLM analysis (raw): {content[:300]}",
        ))
    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="llm_analysis",
            message=f"LLM analysis failed: {exc}",
        ))

    return issues


def cli_visual_inspect(
    pdf_path: Path,
    contract: dict,
) -> list[ValidationIssue]:
    """
    Send the dry-run PDF to Qwen 3.5 27B (via LiteLLM vision) for visual inspection.
    Uses direct HTTP call with base64 image payload.
    """
    issues: list[ValidationIssue] = []
    api_base, api_key = _get_litellm_config()

    try:
        import fitz
        import requests

        doc = fitz.open(str(pdf_path))
        if len(doc) == 0:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="visual",
                message="Generated PDF has 0 pages",
            ))
            doc.close()
            return issues

        pix = doc[0].get_pixmap(dpi=200)
        png_bytes = pix.tobytes("png")
        b64_image = base64.b64encode(png_bytes).decode()
        doc.close()

        tokens = contract.get("tokens", {})
        expected_cols = tokens.get("row_tokens", [])
        expected_scalars = tokens.get("scalars", [])

        # --- OCR pre-check: detect leaked placeholders deterministically ---
        ocr_text = None
        try:
            from backend.app.services.infra_services import ocr_extract
            ocr_text = ocr_extract(png_bytes)
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
                if expected_cols and ocr_text:
                    missing = [c for c in expected_cols[:8] if c.lower().replace("_", " ").replace("row ", "") not in ocr_text.lower()]
                    if missing and len(missing) > len(expected_cols) * 0.5:
                        issues.append(ValidationIssue(
                            severity=Severity.WARNING,
                            category="visual_ocr",
                            message=f"OCR could not find {len(missing)}/{len(expected_cols)} expected columns",
                            detail=f"Missing: {', '.join(missing[:5])}",
                        ))
                logger.info("cli_visual_ocr_check_done", extra={"leaked": len(leaked) if 'leaked' in dir() else 0})
        except Exception:
            logger.debug("cli_visual_ocr_skipped", exc_info=True)

        prompt = f"""You are a report quality inspector. Examine this generated report and check:
1. HEADER: Company name and report title visible?
2. TABLE: Column headers present? Data rows with actual values (numbers/dates)?
3. TOKEN LEAKS: Any visible {{placeholder}} or {{{{token}}}} text that should be data?
4. LAYOUT: Clean layout, no overlapping text, no broken borders?
5. BLANK AREAS: Large empty sections where data should be?

Expected columns: {', '.join(expected_cols[:8])}
Expected headers: {', '.join(expected_scalars)}

Return ONLY JSON: {{"passed": true/false, "issues": [{{"severity": "error/warning", "message": "..."}}]}}"""

        if ocr_text:
            prompt += f"\n\nOCR-EXTRACTED TEXT FROM THIS PAGE:\n{ocr_text[:2000]}"

        t0 = time.time()
        resp = requests.post(
            f"{api_base}/v1/messages",
            json={
                "model": config.model,
                "max_tokens": 1000,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image", "source": {
                            "type": "base64", "media_type": "image/png", "data": b64_image,
                        }},
                    ],
                }],
            },
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            timeout=180,
        )
        elapsed = time.time() - t0

        data = resp.json()
        if "error" in data:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="visual",
                message=f"Vision call failed: {data['error']}",
            ))
            return issues

        raw_text = data.get("content", [{}])[0].get("text", "")
        logger.info(f"cli_visual_inspect elapsed={elapsed:.1f}s")

        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        result = json.loads(cleaned)
        for li in result.get("issues", []):
            sev = Severity.ERROR if li.get("severity") == "error" else Severity.WARNING
            issues.append(ValidationIssue(
                severity=sev, category="visual",
                message=li.get("message", "Visual issue"),
            ))

        if result.get("passed") and not result.get("issues"):
            issues.append(ValidationIssue(
                severity=Severity.INFO, category="visual",
                message="Visual inspection passed — report looks correct",
            ))

    except json.JSONDecodeError:
        issues.append(ValidationIssue(
            severity=Severity.INFO, category="visual",
            message=f"Visual inspection (raw): {raw_text[:200] if 'raw_text' in dir() else 'no response'}",
        ))
    except Exception as exc:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="visual",
            message=f"Visual inspection failed: {exc}",
        ))

    return issues
