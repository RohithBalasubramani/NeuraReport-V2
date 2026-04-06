from __future__ import annotations

import base64
import copy
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from . import ai_services as llm_prompts
# DataFrame mode is now the only mode — always use DF validation
from backend.app.services.templates import MODEL, _ensure_model, get_openai_client
from .infra_services import (
    call_chat_completion,
    extract_tokens,
    strip_code_fences,
    validate_mapping_inline_v4,
)
from .infra_services import SchemaValidationError, normalize_mapping_inline_payload

logger = logging.getLogger("neura.mapping.inline")

REPORT_SELECTED_VALUE = "LATER_SELECTED"
MAPPING_INLINE_MAX_ATTEMPTS = 2

ALLOWED_SPECIAL_VALUES = {"UNRESOLVED", "INPUT_SAMPLE", REPORT_SELECTED_VALUE}
LEGACY_WRAPPER_RE = re.compile(r"(?i)\b(DERIVED\s*:|TABLE_COLUMNS\s*\[|COLUMN_EXP\s*\[|PARAM\s*:)")
PARAM_REF_RE = re.compile(r"^params\.[A-Za-z_][\w]*$")
_TOKEN_DATE_RE = re.compile(r"(date|time|month|year)", re.IGNORECASE)
_REPORT_DATE_PREFIXES = {
    "from",
    "to",
    "start",
    "end",
    "begin",
    "finish",
    "through",
    "thru",
}
_REPORT_DATE_KEYWORDS = {
    "date",
    "dt",
    "day",
    "period",
    "range",
    "time",
    "timestamp",
    "window",
    "month",
    "year",
}
_REPORT_SELECTED_EXACT = {
    "page_info",
    "page_number",
    "page_no",
    "page_num",
    "page_count",
    "page_total",
    "page_total_count",
}
_REPORT_SELECTED_KEYWORDS = {
    "page",
    "sheet",
}
_REPORT_SELECTED_SUFFIXES = {
    "info",
    "number",
    "no",
    "num",
    "count",
    "label",
    "total",
}
_COLUMN_REF_RE = re.compile(
    r"""
    ["`\[]?
    (?P<table>[A-Za-z_][\w]*)
    ["`\]]?
    \.
    ["`\[]?
    (?P<column>[A-Za-z_][\w]*)
    ["`\]]?
    """,
    re.VERBOSE,
)
_SQL_EXPR_HINT_RE = re.compile(
    r"""
    [()+\-*/%]|
    ::|
    \b(
        SUM|AVG|COUNT|MIN|MAX|
        CASE|COALESCE|NULLIF|
        ROW_NUMBER|DENSE_RANK|RANK|NTILE|OVER|
        LEAD|LAG|
        ABS|ROUND|TRIM|UPPER|LOWER|SUBSTR|CAST|
        DATE|DATETIME|IFNULL|IIF|
        CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|
        LOCALTIME|LOCALTIMESTAMP|NOW|GETDATE|SYSDATE|STRFTIME
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)

def _normalized_token_parts(token: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(token or "").lower())
    return [part for part in normalized.split("_") if part]

def _is_date_token_agent(token_name: str, llm_client: Any) -> bool:
    """Use LLM to determine if a token represents a date/time runtime parameter.

    Only called for tokens not caught by the keyword-based heuristic.
    """
    try:
        prompt = (
            f"In a report template, is the token '{token_name}' a date/time parameter "
            "that should be user-selected at runtime (e.g., report period, date range)?\n"
            "Answer ONLY 'yes' or 'no'."
        )
        resp = call_chat_completion(
            llm_client,
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            description="date_token_detection",
        )
        answer = (resp.choices[0].message.content or "").strip().lower()
        is_date = answer.startswith("yes")
        if is_date:
            logger.info("date_token_agent_detected", extra={"token": token_name})
        return is_date
    except Exception:
        logger.debug("date_token_agent_failed", exc_info=True)
        return False

def _is_report_generator_date_token(token: str, *, llm_client: Any = None) -> bool:
    parts = _normalized_token_parts(token)
    if not parts:
        return False
    lowered_token = (token or "").lower()
    if lowered_token in _REPORT_SELECTED_EXACT:
        return True
    if any(part in _REPORT_SELECTED_KEYWORDS for part in parts) and any(
        part in _REPORT_SELECTED_SUFFIXES for part in parts
    ):
        return True

    has_prefix = any(part in _REPORT_DATE_PREFIXES for part in parts)
    has_keyword = any(part in _REPORT_DATE_KEYWORDS for part in parts)
    if has_prefix and has_keyword:
        return True

    # allow tokens like date_from or period_to
    if parts[0] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[1:]):
        return True
    if parts[-1] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[:-1]):
        return True

    # Fallback: ask the LLM for ambiguous tokens
    if llm_client is not None:
        return _is_date_token_agent(token, llm_client)

    return False

def _normalize_report_date_mapping(mapping: dict[str, str], *, llm_client: Any = None) -> None:
    """Coerce report date tokens to INPUT_SAMPLE so the UI can treat them as report filters."""
    for key, value in list(mapping.items()):
        if not _is_report_generator_date_token(key, llm_client=llm_client):
            continue
        normalized_value = (value or "").strip()
        if not normalized_value:
            continue
        lowered = normalized_value.lower()
        if PARAM_REF_RE.match(normalized_value) or lowered.startswith("to be selected"):
            mapping[key] = REPORT_SELECTED_VALUE

class MappingInlineValidationError(RuntimeError):
    """Raised when the LLM output fails validation."""

@dataclass
class MappingInlineResult:
    html_constants_applied: str
    mapping: dict[str, str]
    constant_replacements: dict[str, str]
    token_samples: dict[str, str]
    meta: dict[str, Any]
    prompt_meta: dict[str, Any]
    raw_payload: dict[str, Any]

def _read_png_as_data_uri(png_path: Path) -> str | None:
    if not png_path.exists():
        return None
    try:
        data = base64.b64encode(png_path.read_bytes()).decode("utf-8")
    except Exception:
        logger.exception("mapping_inline_png_read_failed", extra={"path": str(png_path)})
        return None
    return f"data:image/png;base64,{data}"

def _semantic_allowlist_check(
    value: str,
    catalog_entries: list[str],
    llm_client: Any,
) -> str | None:
    """Agent finds the closest catalog match for a value that failed exact match.

    Returns the corrected column name, or None if no match.
    """
    if not catalog_entries or not value:
        return None
    try:
        # Only send a subset to keep prompt small
        sample = catalog_entries[:150]
        prompt = (
            f"'{value}' is not in the allowed column list (likely a typo or naming mismatch).\n"
            f"Available columns: {sample}\n"
            "If there's an obvious typo or naming mismatch, return ONLY the correct "
            "column name. If no match, return NONE."
        )
        resp = call_chat_completion(
            llm_client,
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            description="allowlist_semantic_check",
        )
        result = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
        if result.upper() == "NONE" or not result:
            return None
        if result in catalog_entries:
            logger.info("semantic_allowlist_match", extra={"from": value, "to": result})
            return result
        return None
    except Exception:
        logger.debug("semantic_allowlist_check_failed", exc_info=True)
        return None

def _mapping_allowlist_errors(
    mapping: dict[str, str],
    catalog: Iterable[str],
    *,
    df_mode: bool = False,
    llm_client: Any = None,
) -> list[str]:
    allowed_catalog = {val.strip() for val in catalog if val}
    allowed = set(allowed_catalog)
    allowed.update(ALLOWED_SPECIAL_VALUES)
    errors: list[str] = []
    for key, value in mapping.items():
        normalized = (value or "").strip()
        if not normalized:
            errors.append(f"{key!r} -> {value!r}")
            continue
        if LEGACY_WRAPPER_RE.search(normalized):
            errors.append(f"{key!r} -> uses legacy wrapper (DERIVED/TABLE_COLUMNS/COLUMN_EXP)")
            continue
        if normalized in allowed:
            continue
        if PARAM_REF_RE.match(normalized):
            continue

        if df_mode:
            # DataFrame mode: only allow direct table.column references (no SQL)
            if _SQL_EXPR_HINT_RE.search(normalized):
                errors.append(
                    f"{key!r} -> contains SQL expression (not allowed in DataFrame mode); "
                    "use simple table.column or mark as UNRESOLVED"
                )
                continue
            # Must be a direct table.column reference
            if normalized not in allowed_catalog:
                # Try semantic match before reporting error
                if llm_client is not None:
                    corrected = _semantic_allowlist_check(normalized, sorted(allowed_catalog), llm_client)
                    if corrected:
                        mapping[key] = corrected
                        continue
                errors.append(
                    f"{key!r} -> value {normalized!r} is not a catalog column or params reference"
                )
            continue

        # SQL mode: allow SQL expressions with catalog column references
        referenced: list[str] = [
            f"{match.group('table')}.{match.group('column')}" for match in _COLUMN_REF_RE.finditer(normalized)
        ]
        if not referenced and not _SQL_EXPR_HINT_RE.search(normalized):
            errors.append(
                f"{key!r} -> value is not a catalog column, params reference, or recognizable DuckDB SQL expression"
            )
            continue
        invalid = [col for col in referenced if col not in allowed_catalog]
        if invalid:
            errors.append(f"{key!r} -> references columns outside catalog: {sorted(invalid)}")
    return errors

def _alias_lookup_keys(lowered_key: str) -> list[str]:
    candidates: list[str] = []
    if not lowered_key:
        return candidates

    if lowered_key.endswith("_wt_kg"):
        base = lowered_key[: -len("_wt_kg")]
        if base:
            candidates.append(f"{base}_wt")

    if lowered_key.endswith("_kg"):
        base = lowered_key[: -len("_kg")].rstrip("_")
        if base:
            candidates.append(base)

    filtered: list[str] = []
    for candidate in candidates:
        candidate = candidate.strip("_")
        if candidate and candidate != lowered_key:
            filtered.append(candidate)
    return filtered

def _llm_align_token(
    unmapped_key: str,
    template_tokens: list[str],
    llm_client: Any,
) -> str | None:
    """Use LLM to find the best semantic match for an unmapped token.

    Only called when deterministic alignment fails. Returns the matched
    template token or None if no match.
    """
    if not template_tokens or not unmapped_key:
        return None
    try:
        prompt = (
            f"Token '{unmapped_key}' from a data mapping doesn't match any template token.\n"
            f"Template tokens: {template_tokens}\n"
            "Return ONLY the single best matching template token name, or NONE if no match exists.\n"
            "Do not explain — return just the token name."
        )
        resp = call_chat_completion(
            llm_client,
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            description="token_alignment",
        )
        result = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
        if result in template_tokens:
            logger.info("llm_token_alignment_success", extra={"from": unmapped_key, "to": result})
            return result
        return None
    except Exception:
        logger.debug("llm_token_alignment_failed", exc_info=True)
        return None

def _align_mapping_to_template_tokens(
    mapping: Mapping[str, str],
    template_tokens: Iterable[str],
    *,
    llm_client: Any = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """
    Remap LLM-provided mapping keys onto the actual placeholders that exist in the template.
    Returns (aligned_mapping, remapped_aliases) where remapped_aliases maps original keys -> template tokens.
    """
    token_lookup: dict[str, str] = {}
    row_suffix_lookup: dict[str, str] = {}
    for raw_token in template_tokens:
        token = str(raw_token or "")
        if not token:
            continue
        lowered = token.lower()
        token_lookup.setdefault(lowered, token)
        if lowered.startswith("row_") and len(token) > 4:
            suffix = lowered[4:]
            if suffix:
                row_suffix_lookup.setdefault(suffix, token)

    aligned: dict[str, str] = {}
    remapped: dict[str, str] = {}
    for raw_key, value in mapping.items():
        key = str(raw_key or "")
        lowered = key.lower()
        target = token_lookup.get(lowered) or row_suffix_lookup.get(lowered)
        if target is None:
            alias_target = None
            for alias_key in _alias_lookup_keys(lowered):
                alias_target = token_lookup.get(alias_key) or row_suffix_lookup.get(alias_key)
                if alias_target:
                    break
            target = alias_target

        if target is None and llm_client is not None:
            all_tokens = list(token_lookup.values())
            target = _llm_align_token(key, all_tokens, llm_client)
        if target is None:
            if key not in aligned:
                aligned[key] = value
            continue
        if target in aligned:
            continue
        aligned[target] = value
        if target != key:
            remapped[key] = target

    return aligned, remapped

def _validate_constant_replacements(
    template_html: str,
    replacements: Mapping[str, Any],
    schema: dict[str, Any] | None,
) -> set[str]:
    if replacements is None:
        return set()
    if not isinstance(replacements, Mapping):
        raise MappingInlineValidationError("constant_replacements must be an object")

    available_tokens = set(extract_tokens(template_html))
    if not available_tokens and replacements:
        raise MappingInlineValidationError("Template does not contain any placeholders to replace")

    schema_tokens: set[str] = set()
    if isinstance(schema, dict):
        for key in ("row_tokens", "totals"):
            values = schema.get(key)
            if isinstance(values, list):
                schema_tokens.update(str(v).strip() for v in values if v)

    seen: set[str] = set()
    inline_tokens: set[str] = set()
    for raw_token, raw_value in replacements.items():
        token = str(raw_token or "").strip()
        if not token:
            raise MappingInlineValidationError("constant_replacements keys must be non-empty strings")
        if token in seen:
            raise MappingInlineValidationError(f"Duplicate constant token recorded: {token}")
        seen.add(token)

        if token not in available_tokens:
            raise MappingInlineValidationError(f"Token '{token}' not present in template HTML")
        # Treat row-level placeholders as inherently dynamic even if schema is absent.
        if token.lower().startswith("row_"):
            raise MappingInlineValidationError(
                f"Token '{token}' is a row-level placeholder and cannot be treated as a constant"
            )
        if token in schema_tokens:
            raise MappingInlineValidationError(f"Token '{token}' is defined as dynamic in the schema")
        if _TOKEN_DATE_RE.search(token) and not token.lower().startswith("label_"):
            raise MappingInlineValidationError(f"Date-like token '{token}' cannot be treated as a constant")

        if raw_value is None:
            raise MappingInlineValidationError(f"constant_replacements['{token}'] cannot be null")

        inline_tokens.add(token)

    return inline_tokens

def _replace_token(html: str, token: str, value: str) -> str:
    patterns = [
        re.compile(rf"\{{\{{\s*{re.escape(token)}\s*\}}\}}"),
        re.compile(rf"\{{\s*{re.escape(token)}\s*\}}"),
    ]
    for pattern in patterns:
        html = pattern.sub(value, html)
    return html

def _apply_constant_replacements(html: str, replacements: Mapping[str, Any]) -> str:
    updated = html
    for token, raw_value in replacements.items():
        value = str(raw_value)
        updated = _replace_token(updated, str(token), value)
    return updated

def _normalize_token_samples(
    token_samples_raw: Mapping[str, Any] | None,
    expected_tokens: set[str],
    *,
    allow_missing_tokens: bool = False,
) -> dict[str, str]:
    if not isinstance(token_samples_raw, Mapping):
        raise MappingInlineValidationError("token_samples must be an object with token -> literal value")

    normalized: dict[str, str] = {}
    for raw_key, raw_value in token_samples_raw.items():
        token = str(raw_key or "").strip()
        if not token:
            raise MappingInlineValidationError("token_samples keys must be non-empty token names")
        if token in normalized:
            raise MappingInlineValidationError(f"Duplicate token_samples entry for '{token}'")

        if raw_value is None:
            value = ""
        else:
            value = str(raw_value)
        if not value.strip():
            raise MappingInlineValidationError(
                f"token_samples['{token}'] must be a non-empty literal string (use NOT_VISIBLE/UNREADABLE when necessary)"
            )

        normalized[token] = value

    missing = sorted(expected_tokens - set(normalized))
    if missing:
        raise MappingInlineValidationError(f"token_samples missing entries for tokens: {missing}")

    extras = sorted(set(normalized) - expected_tokens)
    if extras:
        if allow_missing_tokens:
            for extra in extras:
                normalized.pop(extra, None)
        else:
            raise MappingInlineValidationError(f"token_samples contains unknown tokens: {extras}")

    return normalized

def _ensure_dict(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise MappingInlineValidationError(f"{label} must be an object")
    return value

def _build_messages(
    system_text: str,
    user_text: str,
    attachments: Sequence[dict[str, Any]],
    png_data_uri: str | None,
    validation_feedback: str | None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    if system_text:
        messages.append({"role": "system", "content": [{"type": "text", "text": system_text}]})

    user_content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    user_content.extend(attachments or [])
    if png_data_uri:
        user_content.append({"type": "image_url", "image_url": {"url": png_data_uri}})
    if validation_feedback:
        user_content.append(
            {
                "type": "text",
                "text": (
                    "VALIDATION_FEEDBACK:\n"
                    f"{validation_feedback}\n"
                    "Please correct the issues above and resend a compliant JSON response."
                ),
            }
        )
    messages.append({"role": "user", "content": user_content})
    return messages

def catalog_sha256(catalog: Sequence[str]) -> str:
    normalized = sorted({str(item).strip() for item in catalog if item})
    serialized = "\n".join(normalized).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()

def schema_sha256(schema: dict[str, Any] | None) -> str:
    if schema is None:
        return hashlib.sha256(b"null").hexdigest()
    payload = json.dumps(schema, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

def prompt_sha256(system_text: str, user_text: str) -> str:
    combined = f"{system_text.strip()}\n---\n{user_text.strip()}".encode("utf-8")
    return hashlib.sha256(combined).hexdigest()

def _get_rag_context(
    template_id: str | None,
    source_columns: Sequence[str],
    tokens: Sequence[str],
) -> str:
    """Retrieve RAG-augmented context from past mappings to improve LLM accuracy.

    Returns a context string to inject into the mapping prompt, or an empty
    string when RAG augmentation is disabled or unavailable.  All failures are
    silently swallowed so that the existing mapping flow is never disrupted.
    """
    try:
        from backend.app.services.infra_services import get_v2_config

        v2_config = get_v2_config()
        if not getattr(v2_config, "enable_rag_augmentation", False):
            return ""

        from backend.app.services.knowledge_service import find_similar_mappings

        similar = find_similar_mappings(
            template_id=template_id,
            source_columns=list(source_columns),
            tokens=list(tokens),
        )
        if not similar:
            return ""

        lines: list[str] = ["## Similar past mappings (for reference):"]
        for entry in similar:
            token = entry.get("token", "")
            column = entry.get("column", "")
            confidence = entry.get("confidence", "")
            lines.append(f"  - {token} -> {column} (confidence: {confidence})")
        return "\n".join(lines)
    except Exception:
        logger.debug("rag_context_retrieval_skipped", exc_info=True)
        return ""

def _dspy_field_mapping(
    fields: Sequence[str],
    schema_info: dict[str, Any] | None,
    context: str,
) -> dict[str, str] | None:
    """Attempt structured field-to-column mapping via DSPy.

    Returns a mapping dict when DSPy produces a high-confidence result (>0.8),
    or ``None`` to let the normal LLM call handle the mapping.  All failures
    are silently swallowed so that the existing mapping flow is never disrupted.
    """
    try:
        from backend.app.services.infra_services import get_v2_config

        v2_config = get_v2_config()
        if not getattr(v2_config, "enable_dspy_signatures", False):
            return None

        from backend.app.services.intelligence_service import get_module

        mapping_module = get_module("field_to_column_mapping")
        if mapping_module is None:
            return None

        result = mapping_module(
            fields=list(fields),
            schema_info=schema_info,
            context=context,
        )
        if result is None:
            return None

        confidence = getattr(result, "confidence", 0.0)
        if isinstance(confidence, (int, float)) and confidence > 0.8:
            mapping = getattr(result, "mapping", None)
            if isinstance(mapping, dict):
                return {str(k): str(v) for k, v in mapping.items()}
        return None
    except Exception:
        logger.debug("dspy_field_mapping_skipped", exc_info=True)
        return None

def run_llm_call_3(
    template_html: str,
    catalog: Sequence[str],
    schema: dict[str, Any] | None,
    prompt_version: str,
    png_path: str,
    cache_key: str,
    prompt_builder=None,
    *,
    allow_missing_tokens: bool = False,
    rich_catalog_text: str | None = None,
    ocr_context: str | None = None,
) -> MappingInlineResult:
    builder = prompt_builder or llm_prompts.build_llm_call_3_prompt
    prompt_payload = builder(template_html, catalog, schema, rich_catalog_text=rich_catalog_text)
    system_text = prompt_payload.get("system", "")
    user_text = prompt_payload.get("user", "")
    attachments = prompt_payload.get("attachments", [])

    # Inject OCR-extracted column headers from the source PDF
    if ocr_context:
        user_text += "\n\n## OCR-Extracted Column Headers from Source PDF\n" + ocr_context
        logger.info(
            "mapping_ocr_context_injected",
            extra={
                "event": "mapping_ocr_context_injected",
                "cache_key": cache_key,
                "ocr_context_length": len(ocr_context),
            },
        )

    prompt_hash = prompt_sha256(system_text, user_text)
    catalog_hash = catalog_sha256(catalog)
    schema_hash = schema_sha256(schema)
    pre_html_hash = hashlib.sha256((template_html or "").encode("utf-8")).hexdigest()

    png_uri = _read_png_as_data_uri(Path(png_path)) if png_path else None

    # --- Phase 12: RAG context injection (feature-flagged, non-breaking) ---
    rag_context = ""
    try:
        template_tokens = list(extract_tokens(template_html))
        rag_context = _get_rag_context(
            template_id=cache_key,
            source_columns=list(catalog),
            tokens=template_tokens,
        )
        if rag_context:
            user_text = user_text + "\n\n" + rag_context
            logger.info(
                "mapping_inline_rag_context_injected",
                extra={
                    "event": "mapping_inline_rag_context_injected",
                    "cache_key": cache_key,
                    "rag_context_length": len(rag_context),
                },
            )
    except Exception:
        logger.debug("mapping_inline_rag_injection_skipped", exc_info=True)

    # --- Phase 12: DSPy structured mapping short-circuit (feature-flagged, non-breaking) ---
    try:
        template_tokens_for_dspy = list(extract_tokens(template_html))
        dspy_result = _dspy_field_mapping(
            fields=template_tokens_for_dspy,
            schema_info=schema,
            context=rag_context,
        )
        if dspy_result is not None:
            logger.info(
                "mapping_inline_dspy_shortcircuit",
                extra={
                    "event": "mapping_inline_dspy_shortcircuit",
                    "cache_key": cache_key,
                    "mapped_fields": len(dspy_result),
                },
            )
            # Build a minimal MappingInlineResult from DSPy output
            _dspy_mapping = {str(k): str(v) for k, v in dspy_result.items()}
            return MappingInlineResult(
                html_constants_applied=template_html,
                mapping=_dspy_mapping,
                constant_replacements={},
                token_samples={},
                meta={"source": "dspy_field_to_column_mapping", "confidence": "high"},
                prompt_meta={
                    "version": prompt_version,
                    "prompt_sha256": prompt_hash,
                    "catalog_sha256": catalog_hash,
                    "schema_sha256": schema_hash,
                    "cache_key": cache_key,
                    "pre_html_sha256": pre_html_hash,
                    "post_html_sha256": pre_html_hash,
                    "dspy_shortcircuit": True,
                },
                raw_payload={"mapping": _dspy_mapping, "source": "dspy"},
            )
    except Exception:
        logger.debug("mapping_inline_dspy_shortcircuit_skipped", exc_info=True)

    client = get_openai_client()
    validation_feedback: str | None = None
    last_error: Exception | None = None

    def _build_agent_feedback(errors_text: str) -> str:
        """Build feedback string for retry — no LLM call, just structured error context."""
        return (
            f"PREVIOUS ATTEMPT FAILED with these validation errors:\n"
            f"{errors_text}\n\n"
            f"Fix ALL errors in this attempt. Common fixes:\n"
            f"- Replace SQL expressions with simple table.column references\n"
            f"- Use 'UNRESOLVED' for tokens that need computation\n"
            f"- Ensure every token from the HTML appears in the output"
        )

    for attempt in range(1, MAPPING_INLINE_MAX_ATTEMPTS + 1):
        messages = _build_messages(system_text, user_text, attachments, png_uri, validation_feedback)
        try:
            logger.info(
                "mapping_inline_call_start",
                extra={
                    "event": "mapping_inline_call_start",
                    "attempt": attempt,
                    "prompt_version": prompt_version,
                    "prompt_sha256": prompt_hash,
                    "catalog_sha256": catalog_hash,
                    "schema_sha256": schema_hash,
                    "cache_key": cache_key,
                },
            )
            response = call_chat_completion(
                client,
                model=MODEL,
                messages=messages,
                description=f"{prompt_version}",
            )
        except Exception as exc:
            logger.exception(
                "mapping_inline_call_failed",
                extra={
                    "event": "mapping_inline_call_failed",
                    "attempt": attempt,
                    "prompt_version": prompt_version,
                    "cache_key": cache_key,
                },
            )
            raise RuntimeError(f"LLM call failed for {prompt_version}") from exc

        raw_text = (response.choices[0].message.content or "").strip()
        # Strip Qwen thinking tags before parsing JSON
        import re as _re
        raw_text = _re.sub(r"<think>.*?</think>", "", raw_text, flags=_re.DOTALL).strip()
        parsed_text = strip_code_fences(raw_text)

        # Additive: try to extract JSON object even if surrounded by prose
        if parsed_text and not parsed_text.startswith(("{", "[")):
            _json_start = parsed_text.find("{")
            if _json_start >= 0:
                _json_end = parsed_text.rfind("}")
                if _json_end > _json_start:
                    parsed_text = parsed_text[_json_start : _json_end + 1]

        try:
            payload = json.loads(parsed_text)
        except Exception as exc:
            last_error = MappingInlineValidationError(f"Invalid JSON response: {exc}")
            logger.warning(
                "mapping_inline_json_parse_failed raw_preview=%s",
                raw_text[:300] if raw_text else "(empty)",
                extra={
                    "event": "mapping_inline_json_parse_failed",
                    "attempt": attempt,
                    "prompt_version": prompt_version,
                    "cache_key": cache_key,
                },
            )
            validation_feedback = _build_agent_feedback(str(last_error))
            continue

        raw_payload = copy.deepcopy(payload)

        try:
            try:
                # validate_mapping_inline_v4 normalizes internally before checking schema
                validate_mapping_inline_v4(payload)
            except SchemaValidationError as exc:
                raise MappingInlineValidationError(str(exc)) from exc
            # Ensure payload is normalized after validation (validator does this in-place)
            payload = normalize_mapping_inline_payload(payload)
            mapping_raw = _ensure_dict(payload.get("mapping"), "mapping")
            mapping = {str(k): str(v) for k, v in mapping_raw.items()}
            _normalize_report_date_mapping(mapping, llm_client=client)

            original_tokens = set(extract_tokens(template_html))
            mapping, remapped_aliases = _align_mapping_to_template_tokens(mapping, original_tokens, llm_client=client)
            if remapped_aliases:
                logger.info(
                    "mapping_inline_row_token_aligned",
                    extra={
                        "event": "mapping_inline_row_token_aligned",
                        "attempt": attempt,
                        "aliases": remapped_aliases,
                        "prompt_version": prompt_version,
                        "cache_key": cache_key,
                    },
                )

            allowlist_errors = _mapping_allowlist_errors(mapping, catalog, df_mode=True, llm_client=client)
            if allowlist_errors:
                raise MappingInlineValidationError("Mapping values outside allow-list: " + ", ".join(allowlist_errors))

            # Excel templates often use row-level placeholders like `row_<token>` in the tbody
            # while the mapping keys use header labels (e.g., `material_name`). Those row_* tokens
            # are dynamic by design and must never be treated as constants even when they are not
            # present in the mapping object. Exclude them from constant detection to avoid
            # accidentally inlining dynamic row placeholders when schema is absent.
            row_like_tokens = {tok for tok in original_tokens if str(tok).lower().startswith("row_")}

            token_samples = _normalize_token_samples(
                payload.get("token_samples"),
                original_tokens,
                allow_missing_tokens=allow_missing_tokens,
            )
            constant_tokens = (original_tokens - set(mapping.keys())) - row_like_tokens
            constant_entries = {token: token_samples[token] for token in constant_tokens}
            inline_token_set = _validate_constant_replacements(template_html, constant_entries, schema)

            missing_tokens = [token for token in list(mapping.keys()) if token not in original_tokens]
            if missing_tokens:
                log_event = (
                    "mapping_inline_missing_tokens_allowed" if allow_missing_tokens else "mapping_inline_missing_tokens"
                )
                log_level = logger.info if allow_missing_tokens else logger.warning
                log_level(
                    log_event,
                    extra={
                        "event": log_event,
                        "attempt": attempt,
                        "tokens": sorted(missing_tokens),
                        "prompt_version": prompt_version,
                        "cache_key": cache_key,
                    },
                )
                if not allow_missing_tokens:
                    for token in missing_tokens:
                        mapping.pop(token, None)

            overlap = inline_token_set.intersection(set(mapping.keys()))
            if overlap:
                raise MappingInlineValidationError(f"Constant tokens still present in mapping: {sorted(overlap)}")

            html_constants_applied = _apply_constant_replacements(template_html, constant_entries)

            updated_tokens = set(extract_tokens(html_constants_applied))
            added_tokens = updated_tokens - original_tokens
            if added_tokens:
                raise MappingInlineValidationError(f"New tokens introduced: {sorted(added_tokens)}")
            removed_tokens = original_tokens - updated_tokens
            if removed_tokens != inline_token_set:
                raise MappingInlineValidationError(
                    f"Token removal mismatch. Expected removal {sorted(inline_token_set)}, "
                    f"observed {sorted(removed_tokens)}"
                )

            meta = _ensure_dict(payload.get("meta"), "meta")
            if missing_tokens:
                dropped_tokens = meta.get("dropped_tokens")
                if isinstance(dropped_tokens, list):
                    dropped_tokens.extend(sorted(missing_tokens))
                else:
                    meta["dropped_tokens"] = sorted(missing_tokens)

            unresolved = meta.get("unresolved")
            if isinstance(unresolved, list):
                meta["unresolved"] = [tok for tok in unresolved if tok in updated_tokens]

            ambiguous = meta.get("ambiguous")
            if isinstance(ambiguous, list):
                meta["ambiguous"] = [
                    entry for entry in ambiguous if isinstance(entry, dict) and entry.get("header") in mapping
                ]

            hints = meta.get("hints")
            if isinstance(hints, dict):
                meta["hints"] = {key: value for key, value in hints.items() if key in mapping}

            confidence = meta.get("confidence")
            if isinstance(confidence, dict):
                meta["confidence"] = {key: value for key, value in confidence.items() if key in mapping}

            replacements_clean = {str(k): str(v) for k, v in constant_entries.items()}
            raw_payload["token_samples"] = token_samples
            raw_payload["constant_replacements"] = replacements_clean
            post_html_hash = hashlib.sha256(html_constants_applied.encode("utf-8")).hexdigest()

            logger.info(
                "mapping_inline_call_success",
                extra={
                    "event": "mapping_inline_call_success",
                    "attempt": attempt,
                    "prompt_version": prompt_version,
                    "prompt_sha256": prompt_hash,
                    "pre_html_sha256": pre_html_hash,
                    "post_html_sha256": post_html_hash,
                    "cache_key": cache_key,
                },
            )

            return MappingInlineResult(
                html_constants_applied=html_constants_applied,
                mapping=mapping,
                constant_replacements=replacements_clean,
                token_samples=token_samples,
                meta=meta,
                prompt_meta={
                    "version": prompt_version,
                    "prompt_sha256": prompt_hash,
                    "catalog_sha256": catalog_hash,
                    "schema_sha256": schema_hash,
                    "cache_key": cache_key,
                    "pre_html_sha256": pre_html_hash,
                    "post_html_sha256": post_html_hash,
                },
                raw_payload=raw_payload,
            )
        except MappingInlineValidationError as exc:
            last_error = exc
            logger.warning(
                "mapping_inline_validation_failed raw_llm_output=%s",
                raw_text[:2000] if raw_text else "(empty)",
                extra={
                    "event": "mapping_inline_validation_failed",
                    "attempt": attempt,
                    "error": str(exc),
                    "prompt_version": prompt_version,
                    "cache_key": cache_key,
                },
            )
            validation_feedback = _build_agent_feedback(str(exc))
            continue

    assert last_error is not None
    logger.error(
        "mapping_inline_failed last_raw_llm_output=%s",
        raw_text[:4000] if raw_text else "(empty)",
        extra={
            "event": "mapping_inline_failed",
            "error": str(last_error),
            "prompt_version": prompt_version,
            "cache_key": cache_key,
        },
    )
    raise MappingInlineValidationError(str(last_error)) from last_error

# Phase 2: Mapping Semantic Audit (LLM Call 3A)

def run_mapping_audit(
    mapping: dict[str, str],
    rich_catalog: dict[str, list[dict[str, Any]]],
    catalog_text: str,
) -> dict[str, str]:
    """Audit token→column mappings using LLM with sample data.

    Returns a dict of fixes: {token: new_table.column} for any "wrong" mappings.
    Gracefully returns empty dict on failure.
    """
    from .ai_services import LLM_CALL_3A_PROMPT
    from .infra_services import call_chat_completion, strip_code_fences

    # Build mapping entries with sample data from rich_catalog
    # rich_catalog: {table: [{column, type, sample}, ...]}
    col_samples: dict[str, dict[str, Any]] = {}
    for table, columns in rich_catalog.items():
        for col_info in columns:
            col_name = col_info.get("column") or col_info.get("name", "")
            fqn = f"{table}.{col_name}"
            col_samples[fqn] = {
                "type": col_info.get("type", ""),
                "sample": col_info.get("sample", ""),
            }

    mappings_payload = []
    for token, mapped_to in mapping.items():
        if not isinstance(mapped_to, str) or mapped_to.startswith("PARAM:") or mapped_to.upper() == "UNRESOLVED":
            continue
        info = col_samples.get(mapped_to, {})
        sample = info.get("sample", "")
        samples = [str(sample)] if sample else []
        mappings_payload.append({
            "token": token,
            "mapped_to": mapped_to,
            "samples": samples,
            "column_type": info.get("type", ""),
        })

    if not mappings_payload:
        return {}

    user_text = LLM_CALL_3A_PROMPT["user"].format(
        mappings_json=json.dumps(mappings_payload, indent=2, ensure_ascii=False),
        catalog_text=catalog_text,
    )

    messages = [
        {"role": "system", "content": LLM_CALL_3A_PROMPT["system"]},
        {"role": "user", "content": user_text},
    ]

    try:
        client = get_openai_client()
        import os
        from backend.app.services.llm import get_llm_config; model_name = get_llm_config().model
        raw = call_chat_completion(
            client,
            model=model_name,
            messages=messages,
            description="mapping_audit_3a",
        )
        content = (raw.choices[0].message.content or "").strip()
        content = strip_code_fences(content)
        if content and not content.startswith("{"):
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                content = content[start : end + 1]
        result = json.loads(content)
    except Exception as exc:
        logger.warning("mapping_audit_failed", extra={"error": str(exc)})
        return {}

    audited = result.get("audited_mappings", {})
    fixes: dict[str, str] = {}
    for token, info in audited.items():
        verdict = str(info.get("verdict", "")).lower()
        suggested = info.get("suggested_column")
        if verdict == "wrong" and suggested:
            fixes[token] = str(suggested)
            logger.warning(
                "mapping_audit_wrong",
                extra={"token": token, "current": info.get("current"), "suggested": suggested, "reason": info.get("reason")},
            )
        elif verdict == "suspect":
            logger.info(
                "mapping_audit_suspect",
                extra={"token": token, "current": info.get("current"), "reason": info.get("reason")},
            )

    if fixes:
        logger.info("mapping_audit_fixes", extra={"fix_count": len(fixes), "fixes": fixes})

    return fixes

__all__ = [
    "MappingInlineResult",
    "run_llm_call_3",
    "run_mapping_audit",
    "catalog_sha256",
    "schema_sha256",
    "prompt_sha256",
    "MappingInlineValidationError",
]

# mypy: ignore-errors

import logging
from backend.app.services.legacy_services import get_loader_for_ref
from collections import defaultdict
from typing import Dict, Iterable

logger = logging.getLogger("neura.mapping")

UNRESOLVED = "UNRESOLVED"
INPUT_SAMPLE = "INPUT_SAMPLE"
REPORT_SELECTED_VALUE = "LATER_SELECTED"
REPORT_SELECTED_DISPLAY = "To Be Selected in report generator"
UNRESOLVED_CHOICES = {UNRESOLVED, INPUT_SAMPLE, REPORT_SELECTED_VALUE}

def _detect_measurement_table(tables: list[str], cols: Dict[str, list[str]]) -> str | None:
    """Return the name of a wide measurement table (e.g., neuract__Flowmeters) if present."""
    for table in tables:
        lower_name = table.lower()
        if "flowmeter" not in lower_name and "flowmeters" not in lower_name and not lower_name.startswith("neuract__"):
            continue
        column_names = cols.get(table) or []
        if len(column_names) < 3:
            continue
        timestamp_like = any("timestamp" in c.lower() or c.lower().endswith("_utc") for c in column_names)
        if timestamp_like:
            return table
    return None

def get_parent_child_info(db_path) -> Dict[str, object]:
    """Inspect the database and infer suitable parent/child tables.

    Behavior:
      - If there is exactly ONE user table, treat it as BOTH parent and child (single-table report).
      - Else, prefer ('batches', 'batch_lines') if present.
      - Else, pick the first table that declares a foreign key as child and its referenced table as parent.
      - If none of the above applies, raise a clear error.
    """
    loader = get_loader_for_ref(db_path)
    tables = loader.table_names()

    if not tables:
        raise RuntimeError("No user tables found in database.")

    # --- NEW: single-table fallback ---
    if len(tables) == 1:
        t = tables[0]
        cols = [
            row.get("name", "")
            for row in loader.pragma_table_info(t)
            if isinstance(row, dict) and row.get("name")
        ]
        return {
            "child table": t,
            "parent table": t,
            "child_columns": cols,
            "parent_columns": cols,
            "common_names": sorted(set(cols)),  # same table on both sides
        }

    # collect columns for all tables
    cols: Dict[str, list[str]] = {}
    for table in tables:
        try:
            cols[table] = [
                row.get("name", "")
                for row in loader.pragma_table_info(table)
                if isinstance(row, dict) and row.get("name")
            ]
        except Exception:
            cols[table] = []

    # Additional case: wide measurement tables (e.g., neuract__Flowmeters)
    measurement_table = _detect_measurement_table(tables, cols)
    if measurement_table:
        measurement_cols = cols.get(measurement_table, [])
        if not measurement_cols:
            measurement_cols = [
                row.get("name", "")
                for row in loader.pragma_table_info(measurement_table)
                if isinstance(row, dict) and row.get("name")
            ]
        timestamp_cols = [c for c in measurement_cols if "timestamp" in c.lower() or c.lower().endswith("_utc")]
        if not timestamp_cols and measurement_cols:
            timestamp_cols = [measurement_cols[0]]
        return {
            "child table": measurement_table,
            "parent table": measurement_table,
            "child_columns": measurement_cols,
            "parent_columns": measurement_cols,
            "common_names": sorted(set(timestamp_cols) if timestamp_cols else set(measurement_cols)),
        }

    # preferred pair by name
    preferred_child, preferred_parent = "batch_lines", "batches"
    if preferred_child in tables and preferred_parent in tables:
        child, parent = preferred_child, preferred_parent
    else:
        # first-FK-wins fallback
        child = parent = None
        for table in tables:
            try:
                rows = loader.foreign_keys(table)
            except Exception:
                rows = []
            if rows:
                child = table
                parent = rows[0].get("table") or None
                if parent:
                    break

    # --- Additive fallback A: column-overlap heuristic (no FK, multi-table) ---
    if not child or not parent:
        best_overlap: list[str] = []
        best_parent_candidate = None
        best_child_candidate = None
        table_pairs = [(t1, t2) for i, t1 in enumerate(tables) for t2 in tables[i + 1:]]
        for t1, t2 in table_pairs:
            cols_t1 = set(cols.get(t1, []))
            cols_t2 = set(cols.get(t2, []))
            overlap = sorted(cols_t1 & cols_t2)
            if len(overlap) > len(best_overlap):
                best_overlap = overlap
                # More columns → master/parent; fewer → detail/child
                if len(cols.get(t1, [])) >= len(cols.get(t2, [])):
                    best_parent_candidate, best_child_candidate = t1, t2
                else:
                    best_parent_candidate, best_child_candidate = t2, t1
        if best_overlap and best_parent_candidate and best_child_candidate:
            parent = best_parent_candidate
            child = best_child_candidate

    # --- Additive fallback B: largest table as single-table report ---
    if not child or not parent:
        largest = max(tables, key=lambda t: len(cols.get(t, [])))
        largest_cols = cols.get(largest, [])
        return {
            "child table": largest,
            "parent table": largest,
            "child_columns": largest_cols,
            "parent_columns": largest_cols,
            "common_names": sorted(set(largest_cols)),
        }

    child_cols = cols.get(child, [])
    parent_cols = cols.get(parent, [])
    common = sorted(set(child_cols).intersection(parent_cols))

    return {
        "child table": child,
        "parent table": parent,
        "child_columns": child_cols,
        "parent_columns": parent_cols,
        "common_names": common,
    }

def _choice_key(choice: str) -> str:
    return str(choice or "").strip()

def is_unresolved_choice(choice: str) -> bool:
    return _choice_key(choice) in UNRESOLVED_CHOICES

def approval_errors(
    mapping: Dict[str, str], unresolved_tokens: Iterable[str] = UNRESOLVED_CHOICES
) -> list[dict[str, str]]:
    """Return issues that should block approval (unresolved or duplicate mappings)."""
    unresolved_set = {_choice_key(tok) for tok in unresolved_tokens}
    reverse = defaultdict(list)
    issues: list[dict[str, str]] = []

    for label, choice in mapping.items():
        normalized = _choice_key(choice)
        if normalized in unresolved_set:
            issues.append({"label": label, "issue": normalized})
        else:
            reverse[normalized].append(label)

    for colid, labels in reverse.items():
        if len(labels) > 1:
            issues.append({"label": "; ".join(labels), "issue": f"Duplicate mapping to {colid}"})

    return issues

import hashlib
import json
import logging
from backend.app.repositories import get_loader
from typing import Optional

logger = logging.getLogger("neura.auto_fill")

def _compute_db_signature(db_path) -> Optional[str]:
    """
    Build a stable fingerprint of the database schema (user tables only).
    Captures table columns and foreign keys to detect schema drift.
    """
    # Handle PostgreSQL connections
    if hasattr(db_path, 'is_postgresql') and db_path.is_postgresql:
        return hashlib.md5((db_path.connection_url or "").encode()).hexdigest()[:16]

    schema: dict[str, dict[str, list[dict[str, object]]]] = {}
    try:
        loader = get_loader(db_path)
    except Exception as exc:
        logger.warning(
            "db_signature_connect_failed",
            extra={
                "event": "db_signature_connect_failed",
                "db_path": str(db_path),
            },
            exc_info=exc,
        )
        return None

    try:
        tables = loader.table_names()
        for table in tables:
            table_entry: dict[str, list[dict[str, object]]] = {"columns": [], "foreign_keys": []}
            try:
                columns = loader.pragma_table_info(table)
                table_entry["columns"] = [
                    {
                        "name": str(col.get("name") or ""),
                        "type": str(col.get("type") or ""),
                        "notnull": int(col.get("notnull") or 0),
                        "pk": int(col.get("pk") or 0),
                    }
                    for col in columns
                ]
            except Exception:
                table_entry["columns"] = []

            try:
                fks = loader.foreign_keys(table)
                table_entry["foreign_keys"] = [
                    {
                        "id": int(fk.get("id", 0)),
                        "seq": int(fk.get("seq", 0)),
                        "table": str(fk.get("table") or ""),
                        "from": str(fk.get("from") or ""),
                        "to": str(fk.get("to") or ""),
                    }
                    for fk in fks
                ]
            except Exception:
                table_entry["foreign_keys"] = []

            schema[table] = table_entry
    except Exception as exc:
        logger.warning(
            "db_signature_pragmas_failed",
            extra={
                "event": "db_signature_pragmas_failed",
                "db_path": str(db_path),
            },
            exc_info=exc,
        )
        return None

    payload = json.dumps(schema, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

# from __future__ import annotations (already at top)

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Collection, Mapping, Sequence

from .ai_services import PROMPT_VERSION_3_5, build_llm_call_3_5_prompt
from backend.app.services.templates import MODEL, _ensure_model, get_openai_client
from .infra_services import (
    call_chat_completion,
    extract_tokens,
    strip_code_fences,
    validate_llm_call_3_5,
    write_artifact_manifest,
    write_json_atomic,
    write_text_atomic,
)
from .infra_services import SchemaValidationError
# (same file) INPUT_SAMPLE, REPORT_SELECTED_DISPLAY, REPORT_SELECTED_VALUE defined above # INPUT_SAMPLE, REPORT_SELECTED_DISPLAY, REPORT_SELECTED_VALUE

logger = logging.getLogger("neura.mapping.corrections_preview")

_REPEAT_MARKER_RE = re.compile(r"<!--\s*(BEGIN:BLOCK_REPEAT|END:BLOCK_REPEAT)[^>]*-->", re.IGNORECASE)
_DATA_REGION_RE = re.compile(r'data-region\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
_TBODY_RE = re.compile(r"<tbody\b", re.IGNORECASE)
_TR_RE = re.compile(r"<tr\b", re.IGNORECASE)
_SAMPLE_VALUE_TOKEN_RE = re.compile(r"[A-Za-z0-9%._-]+")

VALUE_SAMPLE = INPUT_SAMPLE
VALUE_LATER_SELECTED = REPORT_SELECTED_VALUE
_REPORT_DATE_PREFIXES = {
    "from",
    "to",
    "start",
    "end",
    "begin",
    "finish",
    "through",
    "thru",
}
_REPORT_DATE_KEYWORDS = {
    "date",
    "dt",
    "day",
    "period",
    "range",
    "time",
    "timestamp",
    "window",
    "month",
    "year",
}
_REPORT_SELECTED_EXACT = {
    "page_info",
    "page_number",
    "page_no",
    "page_num",
    "page_count",
    "page_total",
    "page_total_count",
}
_REPORT_SELECTED_KEYWORDS = {"page", "sheet"}
_REPORT_SELECTED_SUFFIXES = {"info", "number", "no", "num", "count", "total"}

class CorrectionsPreviewError(RuntimeError):
    """Raised when LLM Call 3.5 outputs invalid data."""

def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def _sha256_path(path: Path) -> str | None:
    if not path.exists():
        return None
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def _count_repeat_markers(html: str) -> int:
    return len(_REPEAT_MARKER_RE.findall(html or ""))

def _count_tbody(html: str) -> int:
    return len(_TBODY_RE.findall(html or ""))

def _tbody_row_signature(html: str) -> list[int]:
    signatures: list[int] = []
    tbody_pattern = re.compile(r"(<tbody\b[^>]*>)(.*?)(</tbody>)", re.IGNORECASE | re.DOTALL)
    for match in tbody_pattern.finditer(html or ""):
        body = match.group(2)
        signatures.append(len(_TR_RE.findall(body)))
    return signatures

def _data_regions(html: str) -> set[str]:
    return {match.strip() for match in _DATA_REGION_RE.findall(html or "") if match.strip()}

def _normalize_token_parts(token: str) -> list[str]:
    token = (token or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", token)
    return [part for part in normalized.split("_") if part]

def _is_report_generator_date_token(token: str, **_kwargs) -> bool:
    if not token:
        return False
    low = token.strip().lower()
    if low in _REPORT_SELECTED_EXACT:
        return True
    parts = _normalize_token_parts(token)
    if not parts:
        return False
    if any(part in _REPORT_SELECTED_KEYWORDS for part in parts) and any(
        part in _REPORT_SELECTED_SUFFIXES for part in parts
    ):
        return True
    has_prefix = any(part in _REPORT_DATE_PREFIXES for part in parts)
    has_keyword = any(part in _REPORT_DATE_KEYWORDS for part in parts)
    if has_prefix and has_keyword:
        return True
    if parts[0] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[1:]):
        return True
    if parts[-1] in _REPORT_DATE_KEYWORDS and any(part in _REPORT_DATE_PREFIXES for part in parts[:-1]):
        return True
    return False

def _is_sample_value(value: str) -> bool:
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    if not lowered:
        return False
    return lowered in {VALUE_SAMPLE.lower(), VALUE_LATER_SELECTED.lower()}

def _is_report_selected_value(value: str) -> bool:
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    if not lowered:
        return False
    if lowered == VALUE_LATER_SELECTED.lower():
        return True
    return lowered.startswith("to be selected")

def _display_mapping_value(token: str, value: str) -> str:
    if not isinstance(value, str):
        return value
    trimmed = value.strip()
    if not trimmed:
        return trimmed
    if _is_report_generator_date_token(token):
        if _is_report_selected_value(trimmed):
            return REPORT_SELECTED_DISPLAY
        if _is_sample_value(trimmed):
            return VALUE_SAMPLE
    return trimmed

def _ensure_invariants(
    original_html: str,
    final_html: str,
    expected_inline_tokens: Collection[str] | None = None,
    additional_constants: Collection[Mapping[str, Any]] | None = None,
    sample_values: Mapping[str, Any] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    expected_inline_tokens = expected_inline_tokens or ()
    expected_inline = {str(tok) for tok in expected_inline_tokens if str(tok)}
    if additional_constants:
        for entry in additional_constants:
            token = str((entry or {}).get("token") or "").strip()
            if token:
                expected_inline.add(token)
    original_tokens = set(extract_tokens(original_html))
    final_tokens = set(extract_tokens(final_html))

    unexpected_tokens = final_tokens - original_tokens
    if unexpected_tokens:
        raise CorrectionsPreviewError("New tokens introduced in final template: " f"{sorted(unexpected_tokens)}")

    removed_tokens = original_tokens - final_tokens
    missing_expected = sorted(expected_inline - removed_tokens)
    unexpected_removed = sorted(removed_tokens - expected_inline)

    if _count_repeat_markers(original_html) != _count_repeat_markers(final_html):
        raise CorrectionsPreviewError("Repeat marker count changed between original and final HTML.")

    if _count_tbody(original_html) != _count_tbody(final_html):
        raise CorrectionsPreviewError("<tbody> element count changed between original and final HTML.")

    if _tbody_row_signature(original_html) != _tbody_row_signature(final_html):
        raise CorrectionsPreviewError("Row prototype counts differ between original and final HTML.")

    original_regions = _data_regions(original_html)
    final_regions = _data_regions(final_html)
    if original_regions != final_regions:
        raise CorrectionsPreviewError(
            f"data-region attributes changed. Expected {sorted(original_regions)}, got {sorted(final_regions)}"
        )

    for token, sample in (sample_values or {}).items():
        sample_text = str(sample or "").strip()
        if not sample_text:
            continue
        if sample_text in final_html:
            raise CorrectionsPreviewError(f"Sample value leaked into final template for token {token!r}.")

    return sorted(removed_tokens), missing_expected, unexpected_removed

def _verify_invariants_agent(
    original_html: str,
    modified_html: str,
) -> list[str]:
    """LLM-based invariant verification — catches subtle structural issues
    that regex-based checks miss (e.g., CSS changes that break layout,
    attribute reordering, whitespace-sensitive template changes).

    Returns a list of warning strings.  Runs AFTER deterministic checks pass.
    Never raises — all issues are advisory warnings.
    """
    try:
        from backend.app.services.llm import get_llm_client, _extract_response_text
        from backend.app.services.infra_services import extract_json_from_llm_response

        client = get_llm_client()

        prompt = (
            "Compare these two HTML report templates (original vs modified) "
            "and verify the modification preserved the structure.\n\n"
            f"Original (excerpt):\n{original_html[:2000]}\n\n"
            f"Modified (excerpt):\n{modified_html[:2000]}\n\n"
            "Check for:\n"
            "- Same table structure (same number of tables, rows, columns)\n"
            "- Same repeat markers (<!-- BEGIN:BLOCK_REPEAT --> / <!-- END:BLOCK_REPEAT -->)\n"
            "- No leaked sample/literal data where tokens should be\n"
            "- No missing or altered dynamic tokens ({token_name})\n"
            "- No broken HTML tags or mismatched nesting\n\n"
            'Return ONLY valid JSON: {"issues": ["issue1", "issue2"]} '
            "or {\"issues\": []} if no problems found."
        )

        resp = client.complete(
            messages=[{"role": "user", "content": prompt}],
            description="invariant_verification",
            max_tokens=512,
        )

        text = _extract_response_text(resp)
        parsed = extract_json_from_llm_response(text, default={})
        issues = parsed.get("issues", [])
        if issues:
            logger.info(
                "invariant_agent_issues_found",
                extra={"count": len(issues), "issues": issues[:5]},
            )
        return [str(i) for i in issues if isinstance(i, str) and i.strip()]
    except Exception:
        logger.debug("invariant_agent_verification_skipped", exc_info=True)
        return []

def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise CorrectionsPreviewError(f"Failed to parse JSON file: {path.name}") from exc

def _default_schema(schema: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if schema is None:
        return {"scalars": [], "row_tokens": [], "totals": [], "notes": ""}
    payload = dict(schema)
    payload.setdefault("scalars", [])
    payload.setdefault("row_tokens", [])
    payload.setdefault("totals", [])
    payload.setdefault("notes", "")
    return payload

def run_corrections_preview(
    upload_dir: Path,
    template_html_path: Path,
    mapping_step3_path: Path,
    schema_ext_path: Path,
    user_input: str,
    page_png_path: Path | None = None,
    model_selector: str | None = None,
    mapping_override: Mapping[str, Any] | None = None,
    sample_tokens: Sequence[str] | None = None,
    *,
    prompt_builder=build_llm_call_3_5_prompt,
    prompt_version: str = PROMPT_VERSION_3_5,
) -> dict[str, Any]:
    upload_dir = upload_dir.resolve()
    template_html_path = template_html_path.resolve()
    mapping_step3_path = mapping_step3_path.resolve()
    mapping_labels_path = upload_dir / "mapping_pdf_labels.json"

    if not template_html_path.exists():
        raise CorrectionsPreviewError("template_p1.html not found. Run Step 3 before corrections preview.")
    if not mapping_step3_path.exists():
        raise CorrectionsPreviewError("mapping_step3.json not found. Run Step 3 before corrections preview.")

    template_html_original = template_html_path.read_text(encoding="utf-8", errors="ignore")
    mapping_payload = _load_json(mapping_step3_path)
    mapping_raw = mapping_payload.get("mapping") or {}
    if not isinstance(mapping_raw, Mapping):
        raise CorrectionsPreviewError("mapping_step3.json missing 'mapping' dictionary.")
    mapping_override = mapping_override or {}

    def _normalize_mapping(source: Mapping[str, Any]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for key, value in source.items():
            token = str(key or "").strip()
            if not token:
                continue
            if value is None:
                cleaned[token] = ""
            else:
                cleaned[token] = str(value).strip()
        return cleaned

    mapping_clean = _normalize_mapping(mapping_raw)
    override_clean = _normalize_mapping(mapping_override) if isinstance(mapping_override, Mapping) else {}

    def _coerce_report_selected(values: dict[str, str]) -> None:
        for token, val in list(values.items()):
            if not _is_report_generator_date_token(token):
                continue
            normalized_val = str(val or "").strip()
            if not normalized_val:
                continue
            if _is_report_selected_value(normalized_val) or normalized_val.lower() == VALUE_SAMPLE.lower():
                values[token] = REPORT_SELECTED_VALUE

    _coerce_report_selected(mapping_clean)
    _coerce_report_selected(override_clean)

    if override_clean:
        mapping_clean.update(override_clean)

    # --- Phase 12: Record mapping corrections into the feedback loop (feature-flagged, non-breaking) ---
    if override_clean:
        try:
            from backend.app.services.infra_services import get_v2_config

            cfg = get_v2_config()
            if getattr(cfg, "enable_rag_augmentation", False):
                from backend.app.services.quality_service import get_feedback_collector

                collector = get_feedback_collector()
                # Derive template_id from the upload directory name as a stable identifier
                _template_id = upload_dir.name if upload_dir else None
                for field_name, new_column in override_clean.items():
                    old_column = mapping_raw.get(field_name, "")
                    if isinstance(old_column, str):
                        old_column = old_column.strip()
                    else:
                        old_column = str(old_column or "")
                    collector.record_mapping_correction(
                        template_id=_template_id,
                        field_name=field_name,
                        old_column=old_column,
                        new_column=new_column,
                    )
                logger.debug(
                    "corrections_preview_feedback_recorded",
                    extra={
                        "event": "corrections_preview_feedback_recorded",
                        "corrections_count": len(override_clean),
                    },
                )
        except Exception:
            pass  # Non-critical: feedback recording should never break corrections

    sample_tokens_set = {str(tok).strip() for tok in (sample_tokens or []) if isinstance(tok, str) and str(tok).strip()}
    inline_expected_tokens: set[str] = {token for token, value in mapping_clean.items() if _is_sample_value(value)}
    sample_tokens_set.update(inline_expected_tokens)

    token_samples_raw = mapping_payload.get("token_samples")
    if not isinstance(token_samples_raw, Mapping):
        raw_payload_inner = mapping_payload.get("raw_payload")
        if isinstance(raw_payload_inner, Mapping):
            token_samples_raw = raw_payload_inner.get("token_samples")
    token_samples_clean: dict[str, str] | None = None
    if isinstance(token_samples_raw, Mapping):
        token_samples_clean = {
            str(key).strip(): str(value) for key, value in token_samples_raw.items() if str(key).strip()
        }
    else:
        token_samples_clean = None

    mapping_context = mapping_payload.get("raw_payload")
    if not isinstance(mapping_context, Mapping):
        mapping_context = {key: value for key, value in mapping_payload.items() if key not in {"mapping"}}
    mapping_context = dict(mapping_context)
    mapping_context["mapping"] = dict(mapping_clean)
    if override_clean:
        mapping_context["mapping_override"] = dict(override_clean)
    if sample_tokens_set:
        mapping_context["sample_tokens"] = sorted(sample_tokens_set)
    else:
        mapping_context.pop("sample_tokens", None)
    if inline_expected_tokens:
        mapping_context["inline_tokens"] = sorted(inline_expected_tokens)
    else:
        mapping_context.pop("inline_tokens", None)
    if token_samples_clean:
        mapping_context["token_samples"] = dict(token_samples_clean)
    else:
        mapping_context.pop("token_samples", None)

    if override_clean or sample_tokens_set or inline_expected_tokens:
        mapping_payload["mapping"] = mapping_clean
        mapping_payload["raw_payload"] = mapping_context
        if sample_tokens_set:
            mapping_payload["sample_tokens"] = sorted(sample_tokens_set)
        else:
            mapping_payload.pop("sample_tokens", None)
        if inline_expected_tokens:
            mapping_payload["inline_tokens"] = sorted(inline_expected_tokens)
        else:
            mapping_payload.pop("inline_tokens", None)
        write_json_atomic(
            mapping_step3_path,
            mapping_payload,
            ensure_ascii=False,
            indent=2,
            step="corrections_preview_mapping_update",
        )

    def _placeholder_for_token(token: str) -> str:
        token = token.strip()
        if not token:
            return token
        if token.startswith("{") and token.endswith("}"):
            return token
        if token.startswith("{{") and token.endswith("}}"):
            return token
        return f"{{{token}}}"

    def _load_existing_mapping_order(path: Path) -> list[str]:
        if not path.exists():
            return []
        try:
            existing_payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        order: list[str] = []
        if isinstance(existing_payload, list):
            for entry in existing_payload:
                if not isinstance(entry, dict):
                    continue
                header = str((entry.get("header") or "")).strip()
                if header:
                    order.append(header)
        return order

    mapping_labels: list[dict[str, str]] = []
    seen_headers: set[str] = set()

    def _append_header(header: str) -> None:
        header_clean = str(header or "").strip()
        if not header_clean or header_clean in seen_headers:
            return
        raw_value = mapping_clean.get(header_clean, "")
        mapping_labels.append(
            {
                "header": header_clean,
                "placeholder": _placeholder_for_token(header_clean),
                "mapping": _display_mapping_value(header_clean, raw_value),
            }
        )
        seen_headers.add(header_clean)

    existing_order = _load_existing_mapping_order(mapping_labels_path)
    for header in existing_order:
        _append_header(header)
    for header in mapping_clean.keys():
        _append_header(header)

    if mapping_labels:
        write_json_atomic(
            mapping_labels_path,
            mapping_labels,
            ensure_ascii=False,
            indent=2,
            step="corrections_preview_mapping_labels",
        )
    schema_payload: Mapping[str, Any] | None = None
    if schema_ext_path.exists():
        try:
            schema_payload = _load_json(schema_ext_path)
        except CorrectionsPreviewError:
            schema_payload = None
    schema_payload = _default_schema(schema_payload)

    if page_png_path is None or not page_png_path.exists():
        raise CorrectionsPreviewError(
            "Reference PNG not found. Ensure template verification produced reference imagery."
        )

    mapping_bytes = mapping_step3_path.read_bytes()
    mapping_sha = hashlib.sha256(mapping_bytes).hexdigest()
    template_sha_before = _sha256_text(template_html_original)
    user_input_sha = _sha256_text(user_input or "")
    from backend.app.services.templates import _ensure_model
    model_name = model_selector or _ensure_model()

    cache_components = [
        template_sha_before,
        mapping_sha,
        user_input_sha,
        model_name,
        prompt_version,
    ]
    cache_key = hashlib.sha256("|".join(cache_components).encode("utf-8")).hexdigest()

    page_summary_path = upload_dir / "page_summary.txt"
    legacy_artifacts = [
        upload_dir / "report_preview.html",
        upload_dir / "edits_applied.json",
        upload_dir / "additional_constants_inlined.json",
    ]
    for legacy_path in legacy_artifacts:
        try:
            legacy_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            logger.debug("legacy_artifact_cleanup_failed", extra={"path": str(legacy_path)})
    stage_path = upload_dir / "stage_3_5.json"

    if stage_path.exists():
        try:
            cached_stage = json.loads(stage_path.read_text(encoding="utf-8"))
        except Exception:
            cached_stage = None
        if cached_stage and cached_stage.get("cache_key") == cache_key:
            cached_final_sha = cached_stage.get("final_template_sha256")
            current_final_sha = _sha256_path(template_html_path)
            if cached_final_sha and cached_final_sha == current_final_sha:
                logger.info(
                    "corrections_preview_cache_hit",
                    extra={"event": "corrections_preview_cache_hit", "cache_key": cache_key},
                )
                result_payload = cached_stage.get("processed") or {}
                summary = cached_stage.get("summary") or {}
                artifacts = {
                    "template_html": str(template_html_path),
                    "stage": str(stage_path),
                }
                if page_summary_path.exists():
                    artifacts["page_summary"] = str(page_summary_path)
                return {
                    "cache_hit": True,
                    "cache_key": cache_key,
                    "summary": summary,
                    "processed": result_payload,
                    "artifacts": artifacts,
                }

    prompt_payload = prompt_builder(
        template_html=template_html_original,
        schema=schema_payload,
        user_input=user_input or "",
        page_png_path=str(page_png_path) if page_png_path else None,
        mapping_context=mapping_context,
    )

    system_text = prompt_payload.get("system", "")
    base_messages = prompt_payload.get("messages") or []
    if not base_messages:
        raise CorrectionsPreviewError("Prompt builder did not return messages for LLM Call 3.5.")

    client = get_openai_client()
    validation_feedback = None
    last_error: Exception | None = None
    llm_response_payload: dict[str, Any] | None = None
    for attempt in (1, 2):
        messages = [{"role": "system", "content": [{"type": "text", "text": system_text}]}]
        user_entry = json.loads(json.dumps(base_messages))  # deep copy
        if validation_feedback:
            user_entry[0]["content"].append(
                {
                    "type": "text",
                    "text": (
                        "VALIDATION_FEEDBACK:\n"
                        f"{validation_feedback}\n"
                        "Please correct the issues above and resend a compliant JSON response."
                    ),
                }
            )
        messages.extend(user_entry)

        try:
            logger.info(
                "corrections_preview_llm_start",
                extra={
                    "event": "corrections_preview_llm_start",
                    "attempt": attempt,
                    "cache_key": cache_key,
                },
            )
            response = call_chat_completion(
                client,
                model=model_name,
                messages=messages,
                description=prompt_version,
                response_format={"type": "json_object"},
                temperature=0.0,
            )
        except Exception as exc:
            logger.exception(
                "corrections_preview_llm_failure",
                extra={
                    "event": "corrections_preview_llm_failure",
                    "attempt": attempt,
                    "cache_key": cache_key,
                },
            )
            raise CorrectionsPreviewError("LLM Call 3.5 request failed.") from exc

        raw_text = (response.choices[0].message.content or "").strip()
        parsed_text = strip_code_fences(raw_text)
        try:
            payload = json.loads(parsed_text)
        except Exception as exc:
            last_error = exc
            validation_feedback = f"Invalid JSON payload: {exc}"
            continue

        try:
            validate_llm_call_3_5(payload)
        except SchemaValidationError as exc:
            last_error = exc
            validation_feedback = str(exc)
            logger.warning(
                "corrections_preview_schema_validation_failed",
                extra={
                    "event": "corrections_preview_schema_validation_failed",
                    "attempt": attempt,
                    "cache_key": cache_key,
                    "error": str(exc),
                },
            )
            continue

        final_html = str(payload.get("final_template_html") or "")
        page_summary = str(payload.get("page_summary") or "")
        if not page_summary.strip():
            last_error = CorrectionsPreviewError("page_summary cannot be blank.")
            validation_feedback = "page_summary must be a non-empty descriptive string."
            continue

        try:
            (
                inline_tokens_observed,
                missing_inline_tokens,
                unexpected_inline_tokens,
            ) = _ensure_invariants(
                original_html=template_html_original,
                final_html=final_html,
                expected_inline_tokens=inline_expected_tokens,
            )
        except CorrectionsPreviewError as exc:
            last_error = exc
            validation_feedback = str(exc)
            logger.warning(
                "corrections_preview_invariant_failed",
                extra={
                    "event": "corrections_preview_invariant_failed",
                    "attempt": attempt,
                    "cache_key": cache_key,
                    "error": str(exc),
                },
            )
            continue

        # Agent-based invariant verification (advisory warnings, non-blocking)
        agent_warnings = _verify_invariants_agent(template_html_original, final_html)
        if agent_warnings:
            logger.warning(
                "corrections_preview_agent_invariant_warnings",
                extra={
                    "event": "corrections_preview_agent_invariant_warnings",
                    "warnings": agent_warnings[:5],
                },
            )

        llm_response_payload = {
            "final_template_html": final_html,
            "page_summary": page_summary,
            "inline_constants": inline_tokens_observed,
            "missing_inline_tokens": missing_inline_tokens,
            "unexpected_inline_tokens": unexpected_inline_tokens,
            "agent_invariant_warnings": agent_warnings,
        }
        break

    if llm_response_payload is None:
        assert last_error is not None
        raise CorrectionsPreviewError(str(last_error)) from last_error

    final_html = llm_response_payload["final_template_html"]
    page_summary = llm_response_payload["page_summary"]
    inline_constants = list(llm_response_payload.get("inline_constants") or [])
    missing_inline_tokens = list(llm_response_payload.get("missing_inline_tokens") or [])
    unexpected_inline_tokens = list(llm_response_payload.get("unexpected_inline_tokens") or [])

    write_text_atomic(template_html_path, final_html, step="corrections_preview_final_html")
    write_text_atomic(page_summary_path, page_summary, step="corrections_preview_page_summary")

    final_template_sha = _sha256_text(final_html)
    page_summary_sha = _sha256_text(page_summary)

    if missing_inline_tokens:
        logger.warning(
            "corrections_preview_missing_inline_tokens",
            extra={
                "event": "corrections_preview_missing_inline_tokens",
                "tokens": missing_inline_tokens,
            },
        )
    if unexpected_inline_tokens:
        logger.warning(
            "corrections_preview_unexpected_inline_tokens",
            extra={
                "event": "corrections_preview_unexpected_inline_tokens",
                "tokens": unexpected_inline_tokens,
            },
        )

    summary = {
        "constants_inlined": len(inline_constants),
        "unexpected_inline_tokens": len(unexpected_inline_tokens),
        "missing_inline_tokens": len(missing_inline_tokens),
        "page_summary_chars": len(page_summary),
    }

    processed_payload = {
        "inline_constants": inline_constants,
        "expected_inline_constants": sorted(inline_expected_tokens),
        "missing_inline_constants": missing_inline_tokens,
        "unexpected_inline_constants": unexpected_inline_tokens,
        "page_summary": page_summary,
        "final_template_sha256": final_template_sha,
        "page_summary_sha256": page_summary_sha,
    }

    stage_document = {
        "cache_key": cache_key,
        "prompt_version": prompt_version,
        "model": model_name,
        "input_template_sha256": template_sha_before,
        "mapping_sha256": mapping_sha,
        "user_input_sha256": user_input_sha,
        "final_template_sha256": final_template_sha,
        "page_summary_sha256": page_summary_sha,
        "summary": summary,
        "processed": processed_payload,
        "raw_response": llm_response_payload,
        "artifacts": {
            "template_html": template_html_path.name,
            "page_summary": page_summary_path.name,
        },
    }
    write_json_atomic(stage_path, stage_document, ensure_ascii=False, indent=2, step="corrections_preview_stage")

    manifest_inputs = [
        f"stage_3_5_cache_key={cache_key}",
        f"template_pre_sha256={template_sha_before}",
        f"template_post_sha256={final_template_sha}",
        f"mapping_sha256={mapping_sha}",
        f"user_input_sha256={user_input_sha}",
    ]
    write_artifact_manifest(
        upload_dir,
        step="mapping_corrections_preview",
        files={
            "template_p1.html": template_html_path,
            "page_summary.txt": page_summary_path,
            "stage_3_5.json": stage_path,
        },
        inputs=manifest_inputs,
        correlation_id=None,
    )

    artifacts = {
        "template_html": str(template_html_path),
        "page_summary": str(page_summary_path),
        "stage": str(stage_path),
    }

    logger.info(
        "corrections_preview_complete",
        extra={
            "event": "corrections_preview_complete",
            "cache_key": cache_key,
            "constants_inlined": summary["constants_inlined"],
        },
    )

    return {
        "cache_hit": False,
        "cache_key": cache_key,
        "summary": summary,
        "processed": processed_payload,
        "artifacts": artifacts,
    }
