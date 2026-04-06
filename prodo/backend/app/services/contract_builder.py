# mypy: ignore-errors
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

from .ai_services import PROMPT_VERSION_4, build_llm_call_4_prompt
from backend.app.services.templates import get_openai_client
from .infra_services import (
    call_chat_completion,
    write_artifact_manifest,
    write_json_atomic,
    write_text_atomic,
)
from .infra_services import strip_code_fences

logger = logging.getLogger("neura.contract.builder_v2")

_META_FILENAME = "contract_v2_meta.json"
_CONTRACT_FILENAME = "contract.json"
_OVERVIEW_FILENAME = "overview.md"
_STEP5_REQ_FILENAME = "step5_requirements.json"

class ContractBuilderError(RuntimeError):
    """Raised when contract construction fails."""

def _ensure_schema(schema: Mapping[str, Any] | None) -> dict[str, list[str]]:
    payload = dict(schema or {})
    payload.setdefault("scalars", [])
    payload.setdefault("row_tokens", [])
    payload.setdefault("totals", [])
    return {
        "scalars": [str(tok) for tok in payload.get("scalars", [])],
        "row_tokens": [str(tok) for tok in payload.get("row_tokens", [])],
        "totals": [str(tok) for tok in payload.get("totals", [])],
    }

def _normalize_key_tokens(values: Iterable[str] | None) -> list[str]:
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

def _compute_input_signature(
    *,
    final_template_html: str,
    page_summary: str,
    schema: Mapping[str, Any],
    auto_mapping_proposal: Mapping[str, Any],
    mapping_override: Mapping[str, Any] | None,
    user_instructions: str,
    catalog: Iterable[str],
    dialect_hint: str | None,
    key_tokens: Iterable[str],
) -> str:
    normalized_payload = {
        "final_html_sha256": hashlib.sha256((final_template_html or "").encode("utf-8")).hexdigest(),
        "page_summary_sha256": hashlib.sha256((page_summary or "").encode("utf-8")).hexdigest(),
        "schema": schema,
        "auto_mapping_proposal": auto_mapping_proposal,
        "mapping_override": dict(mapping_override or {}),
        "user_instructions": user_instructions or "",
        "catalog": list(catalog),
        "dialect_hint": dialect_hint or "",
        "key_tokens": list(key_tokens),
    }
    payload_bytes = json.dumps(normalized_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload_bytes).hexdigest()

def _load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise
    except Exception as exc:  # pragma: no cover - treated as cache miss
        logger.warning(
            "contract_v2_json_load_failed",
            extra={"event": "contract_v2_json_load_failed", "path": str(path)},
            exc_info=exc,
        )
        raise

def _load_cached_payload(
    template_dir: Path,
) -> Optional[dict[str, Any]]:
    contract_path = template_dir / _CONTRACT_FILENAME
    overview_path = template_dir / _OVERVIEW_FILENAME
    step5_path = template_dir / _STEP5_REQ_FILENAME
    meta_path = template_dir / _META_FILENAME

    required_files = (overview_path, step5_path, meta_path)
    for required in required_files:
        if not required.exists():
            return None

    try:
        meta = _load_json(meta_path)
        step5 = _load_json(step5_path)
        overview = overview_path.read_text(encoding="utf-8")
        contract = None

        if contract_path.exists():
            try:
                contract = _load_json(contract_path)
            except Exception:
                contract = None

        if contract is None:
            contract = meta.get("contract_payload")
        elif isinstance(meta, dict):
            meta["contract_payload"] = contract
    except (FileNotFoundError, json.JSONDecodeError):
        return None
    if contract is None:
        return None

    return {
        "meta": meta,
        "contract": contract,
        "overview_md": overview,
        "step5_requirements": step5,
        "artifacts": {
            "overview": overview_path,
            "step5_requirements": step5_path,
            "meta": meta_path,
            **({"contract": contract_path} if contract_path.exists() else {}),
        },
        "key_tokens": list(meta.get("key_tokens") or []),
    }

def _load_mapping_override_from_disk(template_dir: Path) -> dict[str, str]:
    path = template_dir / "mapping_pdf_labels.json"
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning(
            "contract_v2_mapping_override_load_failed",
            extra={
                "event": "contract_v2_mapping_override_load_failed",
                "path": str(path),
            },
            exc_info=True,
        )
        return {}
    if not isinstance(payload, list):
        return {}
    mapping: dict[str, str] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        token = str(entry.get("header") or "").strip()
        value = str(entry.get("mapping") or "").strip()
        if token:
            mapping[token] = value
    return mapping

def _load_page_summary(template_dir: Path) -> str:
    summary_path = template_dir / "page_summary.txt"
    if summary_path.exists():
        try:
            return summary_path.read_text(encoding="utf-8")
        except Exception:
            logger.warning(
                "contract_v2_page_summary_read_failed",
                extra={"event": "contract_v2_page_summary_read_failed", "path": str(summary_path)},
                exc_info=True,
            )
    stage_path = template_dir / "stage_3_5.json"
    if stage_path.exists():
        try:
            stage_payload = _load_json(stage_path)
        except Exception:
            stage_payload = None
        if isinstance(stage_payload, Mapping):
            processed = stage_payload.get("processed")
            if isinstance(processed, Mapping):
                summary = processed.get("page_summary")
                if isinstance(summary, str) and summary.strip():
                    return summary
            raw_response = stage_payload.get("raw_response")
            if isinstance(raw_response, Mapping):
                summary = raw_response.get("page_summary")
                if isinstance(summary, str) and summary.strip():
                    return summary
    return ""

def _augment_contract_for_compat(contract: dict[str, Any]) -> dict[str, Any]:
    tokens = contract.get("tokens") or {}
    scalars = list(tokens.get("scalars") or [])
    row_tokens = list(tokens.get("row_tokens") or [])
    totals = list(tokens.get("totals") or [])

    contract.setdefault("header_tokens", scalars)
    contract.setdefault("row_tokens", row_tokens)

    if "totals" not in contract:
        mapping = contract.get("mapping") or {}
        contract["totals"] = {tok: str(mapping.get(tok, "")) for tok in totals}

    if "row_order" not in contract:
        rows_order: list[str] = []
        order_by_block = contract.get("order_by")
        rows_spec: Any = None
        if isinstance(order_by_block, Mapping):
            rows_spec = order_by_block.get("rows")
        elif isinstance(order_by_block, list):
            rows_spec = list(order_by_block)
            contract["order_by"] = {"rows": list(rows_spec)}
        else:
            if order_by_block not in (None, {}):
                contract["order_by"] = {}
        if isinstance(rows_spec, list) and rows_spec:
            rows_order = [str(item) for item in rows_spec if str(item).strip()]
        elif isinstance(rows_spec, str) and rows_spec.strip():
            rows_order = [rows_spec.strip()]
        contract["row_order"] = rows_order or ["ROWID"]

    contract.setdefault("literals", contract.get("literals", {}))
    return contract

def _prepare_messages(system_text: str, payload_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages = [
        {
            "role": "system",
            "content": [
                {
                    "type": "text",
                    "text": system_text,
                }
            ],
        }
    ]
    messages.extend(payload_messages)
    return messages

def _normalize_contract_payload(contract: Mapping[str, Any] | None) -> dict[str, Any]:
    """
    Ensure the contract payload meets schema expectations before validation.
    Validates required fields and logs warnings for incomplete data.
    """
    normalized: dict[str, Any] = json.loads(json.dumps(contract or {}, ensure_ascii=False))
    join = normalized.get("join")
    if isinstance(join, dict):
        required_keys = ("parent_table", "parent_key", "child_table", "child_key")
        missing_keys = []

        for key in required_keys:
            value = join.get(key)
            if value is None:
                join[key] = ""
                missing_keys.append(key)
            elif not isinstance(value, str):
                join[key] = str(value)

        # Warn if parent keys are missing (these are required for a valid join)
        if missing_keys:
            logger.warning(
                "contract_join_incomplete",
                extra={
                    "event": "contract_join_incomplete",
                    "missing_keys": missing_keys,
                },
            )

        # Validate that if a join exists, both sides must be complete
        if join.get("parent_table") or join.get("child_table"):
            if not join.get("parent_table") or not join.get("parent_key"):
                logger.warning(
                    "contract_join_invalid: removing incomplete join (missing parent_table/parent_key)",
                    extra={
                        "event": "contract_join_invalid",
                        "reason": "parent_table and parent_key are required for a valid join",
                    },
                )
                normalized.pop("join", None)
            elif not join.get("child_table") or not join.get("child_key"):
                logger.warning(
                    "contract_join_invalid: removing incomplete join (missing child_table/child_key)",
                    extra={
                        "event": "contract_join_invalid",
                        "reason": "child_table and child_key are required for a valid join",
                    },
                )
                normalized.pop("join", None)

    return normalized

def _extract_mapping_entries(source: Mapping[str, Any] | None) -> dict[str, str]:
    if not isinstance(source, Mapping):
        return {}
    mapping_section = source.get("mapping")
    if isinstance(mapping_section, Mapping):
        source = mapping_section
    return {str(token): str(expr) for token, expr in source.items()}

def _reshape_rule_from_step5(step5_requirements: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(step5_requirements, Mapping):
        return None
    reshape = step5_requirements.get("reshape")
    if not isinstance(reshape, Mapping):
        return None
    selections = reshape.get("select") or reshape.get("selection") or []
    columns: list[dict[str, Any]] = []
    for entry in selections:
        if not isinstance(entry, Mapping):
            continue
        expr = str(entry.get("expr") or entry.get("expression") or entry.get("column") or "").strip()
        alias = str(entry.get("as") or entry.get("alias") or "").strip() or expr
        if not alias or not expr:
            continue
        columns.append({"as": alias, "from": [expr]})
    if not columns:
        return None
    rule: dict[str, Any] = {
        "purpose": reshape.get("purpose") or "Auto-generated reshape derived from Step-5 requirements.",
        "strategy": reshape.get("strategy") or "SELECT",
        "columns": columns,
    }
    explain = reshape.get("explain") or reshape.get("description")
    if explain:
        rule["explain"] = explain
    for key in ("order_by", "ordering"):
        order_val = reshape.get(key)
        if order_val:
            rule["order_by"] = order_val
            break
    filters = reshape.get("where") or reshape.get("filters")
    if filters:
        rule["filters"] = filters
    group_by = reshape.get("group_by")
    if group_by:
        rule["group_by"] = group_by
    return rule

def _reshape_rule_from_mapping(mapping: Mapping[str, str], row_tokens: list[str]) -> dict[str, Any] | None:
    columns: list[dict[str, Any]] = []
    for token in row_tokens:
        expr = str(mapping.get(token) or "").strip()
        if not expr:
            continue
        columns.append({"as": token, "from": [expr]})
    if not columns:
        return None
    return {
        "purpose": "Auto-generated reshape rule derived from mapping tokens.",
        "strategy": "SELECT",
        "columns": columns,
    }

def _validate_reshape_column(column: Any) -> bool:
    """
    Validate a single reshape column entry.
    A valid column must have:
    - 'as' or 'alias': non-empty string (the output column name)
    - 'from': non-empty string or non-empty list of strings (source expressions)
    """
    if not isinstance(column, Mapping):
        return False

    # Check alias
    alias = column.get("as") or column.get("alias")
    if not alias or not str(alias).strip():
        return False

    # Check source
    from_raw = column.get("from")
    if not from_raw:
        return False

    if isinstance(from_raw, str):
        return bool(from_raw.strip())
    elif isinstance(from_raw, list):
        return any(str(item).strip() for item in from_raw if item)

    return False

def _has_valid_reshape_rule(rules: Any) -> bool:
    """
    Check if reshape rules contain at least one valid rule with valid columns.
    """
    if not isinstance(rules, list):
        return False

    for rule in rules:
        if not isinstance(rule, Mapping):
            continue

        columns = rule.get("columns")
        if not isinstance(columns, list) or not columns:
            continue

        # Check that at least one column is valid
        valid_columns = [col for col in columns if _validate_reshape_column(col)]
        if valid_columns:
            return True

    return False

def _ensure_contract_defaults(
    contract: dict[str, Any],
    *,
    schema: Mapping[str, Any],
    auto_mapping: Mapping[str, Any] | None,
    mapping_override: Mapping[str, Any] | None,
    step5_requirements: Mapping[str, Any] | None,
) -> dict[str, str]:
    tokens_block_raw = contract.get("tokens")
    tokens_block = tokens_block_raw if isinstance(tokens_block_raw, dict) else {}
    tokens_block = {key: value for key, value in tokens_block.items() if key in {"scalars", "row_tokens", "totals"}}

    schema_scalars = list(schema.get("scalars") or [])
    schema_rows = list(schema.get("row_tokens") or [])
    schema_totals = list(schema.get("totals") or [])

    scalars = list(tokens_block.get("scalars") or []) or schema_scalars
    row_tokens = list(tokens_block.get("row_tokens") or []) or schema_rows
    totals = list(tokens_block.get("totals") or []) or schema_totals

    if not row_tokens:
        auto_map = _extract_mapping_entries(auto_mapping)
        inferred_rows = [token for token in auto_map if token.startswith("row_")]
        if inferred_rows:
            row_tokens = inferred_rows

    contract["tokens"] = {
        "scalars": scalars,
        "row_tokens": row_tokens,
        "totals": totals,
    }

    mapping_sources = {}
    mapping_sources.update(_extract_mapping_entries(auto_mapping))
    if isinstance(mapping_override, Mapping):
        mapping_sources.update({str(k): str(v) for k, v in mapping_override.items()})

    mapping_section_raw = contract.get("mapping")
    mapping_section = mapping_section_raw if isinstance(mapping_section_raw, dict) else {}
    contract["mapping"] = mapping_section
    for token in [*scalars, *row_tokens, *totals]:
        if token and token not in mapping_section and token in mapping_sources:
            mapping_section[token] = mapping_sources[token]

    if not _has_valid_reshape_rule(contract.get("reshape_rules")):
        rule = _reshape_rule_from_step5(step5_requirements) or _reshape_rule_from_mapping(mapping_section, row_tokens)
        if rule:
            contract["reshape_rules"] = [rule]

    return mapping_sources

def _normalize_reshape_rules(contract: dict[str, Any]) -> None:
    rules = contract.get("reshape_rules")
    if not isinstance(rules, list):
        contract["reshape_rules"] = []
        return

    normalized_rules: list[dict[str, Any]] = []
    for raw_rule in rules:
        if not isinstance(raw_rule, Mapping):
            continue
        rule = dict(raw_rule)

        columns_raw = rule.get("columns")
        if not isinstance(columns_raw, list) or not columns_raw:
            continue

        normalized_columns: list[dict[str, Any]] = []
        for entry in columns_raw:
            if not isinstance(entry, Mapping):
                continue
            alias = str(entry.get("as") or entry.get("alias") or "").strip()
            if not alias:
                continue
            from_raw = entry.get("from")
            sources: list[str] = []
            if isinstance(from_raw, str):
                value = from_raw.strip()
                if value:
                    sources = [value]
            elif isinstance(from_raw, list):
                sources = [str(item).strip() for item in from_raw if str(item or "").strip()]
            if not sources:
                continue
            normalized_columns.append({"as": alias, "from": sources})
        if not normalized_columns:
            continue
        rule["columns"] = normalized_columns

        order_by = rule.get("order_by")
        if isinstance(order_by, str):
            text = order_by.strip()
            rule["order_by"] = [text] if text else []
        elif isinstance(order_by, list):
            rule["order_by"] = [str(item).strip() for item in order_by if str(item or "").strip()]
        else:
            rule["order_by"] = []

        normalized_rules.append(rule)
        rule.setdefault("purpose", "Auto-generated reshape rule derived from Step-5 requirements.")

    contract["reshape_rules"] = normalized_rules

def _normalize_ordering(contract: dict[str, Any]) -> None:
    order_block = contract.get("order_by")
    if isinstance(order_block, Mapping):
        rows_val = order_block.get("rows")
        if isinstance(rows_val, str):
            rows_list = [rows_val.strip()] if rows_val.strip() else []
            order_block["rows"] = rows_list
        elif isinstance(rows_val, list):
            order_block["rows"] = [str(item).strip() for item in rows_val if str(item or "").strip()]
        else:
            order_block["rows"] = []
        contract["order_by"] = order_block
    elif isinstance(order_block, str):
        text = order_block.strip()
        contract["order_by"] = {"rows": [text] if text else []}
    else:
        contract["order_by"] = {"rows": []}

    row_order_val = contract.get("row_order")
    if isinstance(row_order_val, str):
        text = row_order_val.strip()
        contract["row_order"] = [text] if text else ["ROWID"]
    elif isinstance(row_order_val, list) and row_order_val:
        contract["row_order"] = [str(item).strip() for item in row_order_val if str(item or "").strip()]
    else:
        contract["row_order"] = ["ROWID"]

def _clean_sql_fragment(value: Any) -> str:
    text = str(value or "").strip()
    if _LEGACY_WRAPPER_RE.search(text):
        raise ContractBuilderError(
            "contract mapping contains legacy wrappers (DERIVED/TABLE_COLUMNS/COLUMN_EXP). "
            "Supply the executable SQL fragment directly."
        )
    return text

def _normalize_sql_mapping_sections(
    contract: dict[str, Any],
    *,
    allow_list: Iterable[str],
    fallback_mapping: Mapping[str, str] | None = None,
) -> None:
    allow_catalog = {str(item).strip() for item in allow_list if str(item).strip()}
    allowed_tables = {entry.split(".")[0] for entry in allow_catalog if "." in entry}

    def _validate_expr(token: str, expr: str) -> str:
        cleaned = _clean_sql_fragment(expr)
        if not cleaned:
            raise ContractBuilderError(f"contract mapping for '{token}' is empty after normalization.")
        if _SUBQUERY_RE.search(cleaned):
            raise ContractBuilderError(
                f"contract mapping for '{token}' contains disallowed SQL (subqueries or statements)."
            )
        referenced = {f"{match.group('table')}.{match.group('column')}" for match in _COLUMN_REF_RE.finditer(cleaned)}
        invalid = [ref for ref in referenced if ref not in allow_catalog and ref.split(".")[0] in allowed_tables]
        if invalid:
            raise ContractBuilderError(
                f"contract mapping for '{token}' references columns outside catalog: {sorted(invalid)}"
            )
        return cleaned

    mapping_section = contract.get("mapping")
    if isinstance(mapping_section, dict):
        normalized: dict[str, str] = {}
        for token, expr in mapping_section.items():
            token_name = str(token)
            try:
                normalized[token_name] = _validate_expr(token_name, expr)
            except ContractBuilderError as exc:
                fallback_expr = None
                if fallback_mapping:
                    fallback_expr = fallback_mapping.get(token_name)
                if fallback_expr:
                    logger.warning(
                        "contract_mapping_fallback",
                        extra={
                            "event": "contract_mapping_fallback",
                            "token": token_name,
                            "error": str(exc),
                        },
                    )
                    normalized[token_name] = _validate_expr(token_name, fallback_expr)
                else:
                    raise
        contract["mapping"] = normalized

    for section in ("totals", "row_computed", "totals_math"):
        block = contract.get(section)
        if isinstance(block, dict):
            contract[section] = {str(token): _validate_expr(str(token), expr) for token, expr in block.items()}

def _normalize_df_mapping_sections(
    contract: dict[str, Any],
    *,
    allow_list: Iterable[str],
    fallback_mapping: Mapping[str, str] | None = None,
) -> None:
    """DataFrame mode: reject SQL expressions, only allow TABLE.COLUMN or PARAM:name."""
    allow_catalog = {str(item).strip() for item in allow_list if str(item).strip()}
    _direct_col_re = re.compile(r"^\s*(?P<table>[A-Za-z_][\w]*)\s*\.\s*(?P<column>[A-Za-z_][\w]*)\s*$")
    _param_re = re.compile(r"^PARAM:[A-Za-z0-9_]+$")
    _unresolved_vals = {"UNRESOLVED", ""}

    def _validate_df_expr(token: str, expr: Any) -> Any:
        # Allow dict values in row_computed/totals_math (declarative ops)
        if isinstance(expr, dict):
            return expr
        text = str(expr or "").strip()
        if not text or text in _unresolved_vals:
            return text
        if _param_re.match(text):
            return text
        m = _direct_col_re.match(text)
        if m:
            ref = f"{m.group('table')}.{m.group('column')}"
            if ref in allow_catalog:
                return text
            # Allow if table matches but column may be from reshape
            return text
        # Fallback: try to use it as-is (may be a legacy SQL expression)
        logger.warning("df_mode_non_column_mapping", extra={"token": token, "expr": text})
        return text

    mapping_section = contract.get("mapping")
    if isinstance(mapping_section, dict):
        contract["mapping"] = {str(t): _validate_df_expr(str(t), v) for t, v in mapping_section.items()}

    for section in ("totals", "row_computed", "totals_math"):
        block = contract.get(section)
        if isinstance(block, dict):
            contract[section] = {str(t): _validate_df_expr(str(t), v) for t, v in block.items()}

# Contract post-processor - deterministic invariant enforcement after LLM

_DEFAULT_DATE_FORMAT = "%d-%m-%Y %H:%M:%S"
_TIMESTAMP_COLUMN_NAMES = {"timestamp_utc", "timestamp", "created_at", "date", "datetime"}
_SKIP_FORMATTER_COLUMNS = {"rowid", "__rowid__", "id", "pk"}

def _ensure_date_columns(contract: dict[str, Any]) -> None:
    """Auto-populate date_columns by scanning mapping for timestamp columns."""
    date_columns = contract.get("date_columns")
    if isinstance(date_columns, dict) and date_columns:
        return
    mapping = contract.get("mapping", {})
    for tok, expr in mapping.items():
        if not isinstance(expr, str) or "." not in expr:
            continue
        table, col = expr.rsplit(".", 1)
        if col.lower() in _TIMESTAMP_COLUMN_NAMES:
            contract.setdefault("date_columns", {})[table] = col
            logger.info(
                "postprocess_date_columns_inferred",
                extra={"event": "postprocess_date_columns_inferred", "table": table, "column": col},
            )
            break

def _ensure_date_filters(contract: dict[str, Any]) -> None:
    """If date_columns exists, ensure filters.optional has date_from/date_to."""
    date_columns = contract.get("date_columns")
    if not isinstance(date_columns, dict) or not date_columns:
        return
    filters = contract.setdefault("filters", {})
    optional = filters.setdefault("optional", {})
    for table, col in date_columns.items():
        if not table or not col:
            continue
        fqn = f"{table}.{col}"
        if "date_from" not in optional:
            optional["date_from"] = fqn
        if "date_to" not in optional:
            optional["date_to"] = fqn
    if optional:
        logger.info(
            "postprocess_date_filters_ensured",
            extra={"event": "postprocess_date_filters_ensured", "filters": dict(optional)},
        )

def _ensure_timestamp_formatting(contract: dict[str, Any]) -> None:
    """Ensure every timestamp-mapped token has format_date in row_computed."""
    mapping = contract.get("mapping", {})
    row_computed = contract.setdefault("row_computed", {})
    formatters = contract.get("formatters", {})

    for tok, expr in mapping.items():
        if not isinstance(expr, str) or "." not in expr:
            continue
        col_name = expr.rsplit(".", 1)[-1].lower()
        if col_name not in _TIMESTAMP_COLUMN_NAMES:
            continue
        source_col = expr.rsplit(".", 1)[-1]
        # Fix existing row_computed entries with incomplete date formats (missing time)
        if tok in row_computed:
            existing = row_computed[tok]
            if isinstance(existing, dict) and existing.get("op") == "format_date":
                fmt = existing.get("format", "")
                if "%H" not in fmt and "%I" not in fmt:
                    existing["format"] = _DEFAULT_DATE_FORMAT
                    logger.info(
                        "postprocess_timestamp_format_fixed",
                        extra={"event": "postprocess_timestamp_format_fixed", "token": tok, "old_format": fmt},
                    )
            continue
        if tok in formatters:
            spec = str(formatters[tok]).strip().lower()
            if spec.startswith("date("):
                continue
        row_computed[tok] = {
            "op": "format_date",
            "column": source_col,
            "format": _DEFAULT_DATE_FORMAT,
        }
        logger.info(
            "postprocess_timestamp_formatter_added",
            extra={"event": "postprocess_timestamp_formatter_added", "token": tok, "column": source_col},
        )

def _normalize_formatter_conflicts(contract: dict[str, Any]) -> None:
    """Remove date() formatters when row_computed.format_date exists for same token."""
    row_computed = contract.get("row_computed", {})
    formatters = contract.get("formatters", {})
    to_remove = []
    for tok, rc in row_computed.items():
        if isinstance(rc, dict) and rc.get("op") == "format_date" and tok in formatters:
            spec = str(formatters[tok]).strip().lower()
            if spec.startswith("date("):
                to_remove.append(tok)
    for tok in to_remove:
        formatters.pop(tok)
        logger.info(
            "postprocess_formatter_conflict_resolved",
            extra={"event": "postprocess_formatter_conflict_resolved", "token": tok},
        )

def _ensure_numeric_formatters(contract: dict[str, Any], catalog: list[str]) -> None:
    """Auto-add number(2) for numeric columns missing formatters."""
    mapping = contract.get("mapping", {})
    formatters = contract.setdefault("formatters", {})
    row_computed = contract.get("row_computed", {})

    for tok, expr in mapping.items():
        if tok in formatters or tok in row_computed:
            continue
        if not isinstance(expr, str) or "." not in expr:
            continue
        col_name = expr.rsplit(".", 1)[-1].lower()
        if col_name in _TIMESTAMP_COLUMN_NAMES or col_name in _SKIP_FORMATTER_COLUMNS:
            continue
        formatters[tok] = "number(2)"

def _validate_mapping_against_catalog(contract: dict[str, Any], catalog: list[str]) -> None:
    """Remove mapping entries that reference columns not in the catalog."""
    catalog_set = {e.lower() for e in catalog}
    mapping = contract.get("mapping", {})
    unresolved = list(contract.get("unresolved") or [])
    removed = []
    for tok, expr in list(mapping.items()):
        if not isinstance(expr, str):
            continue
        if expr.upper() in ("UNRESOLVED", "") or expr.startswith("PARAM:"):
            continue
        if "." in expr and expr.lower() not in catalog_set:
            logger.warning(
                "postprocess_invalid_column",
                extra={"event": "postprocess_invalid_column", "token": tok, "expr": expr},
            )
            mapping.pop(tok)
            unresolved.append(tok)
            removed.append(tok)
    if removed:
        contract["unresolved"] = list(dict.fromkeys(unresolved))

def _strip_unresolved_entries(contract: dict[str, Any]) -> None:
    """Remove UNRESOLVED/empty mappings and clean related sections."""
    mapping = contract.get("mapping", {})
    unresolved = list(contract.get("unresolved") or [])
    to_remove = [
        k for k, v in mapping.items()
        if isinstance(v, str) and v.strip().upper() in ("UNRESOLVED", "")
    ]
    for tok in to_remove:
        mapping.pop(tok)
    unresolved.extend(to_remove)
    contract["unresolved"] = list(dict.fromkeys(unresolved))

    remove_set = set(to_remove)
    for key in ("row_tokens", "header_tokens"):
        tokens = contract.get(key)
        if isinstance(tokens, list):
            contract[key] = [t for t in tokens if t not in remove_set]

    reshape_rules = contract.get("reshape_rules")
    if isinstance(reshape_rules, list):
        for rule in reshape_rules:
            cols = rule.get("columns")
            if isinstance(cols, list):
                rule["columns"] = [c for c in cols if c.get("as") not in remove_set]

# Phase 7: Auto-repair from dry run + validation results

def _agent_repair_plan(
    contract: dict[str, Any],
    errors: list[dict[str, Any]],
    catalog_columns: dict[str, str],
) -> list[dict[str, str]]:
    """Have the agent analyze errors and produce a targeted repair plan.

    Returns list of {key, old, new} fix dicts. Falls back to empty list on failure.
    """
    if not errors:
        return []
    try:
        from backend.app.services.llm import get_llm_client
        from backend.app.services.infra_services import extract_json_from_llm_response

        client = get_llm_client()
        mapping = contract.get("mapping", {})
        available = sorted(catalog_columns.values())[:200]

        prompt = (
            "This data contract has validation errors. Analyze each error and suggest "
            "the exact fix (which mapping key to change, what new value to set).\n\n"
            f"Errors:\n{json.dumps(errors[:20], indent=2)}\n\n"
            f"Current mapping:\n{json.dumps(mapping, indent=2)}\n\n"
            f"Available catalog columns: {available}\n\n"
            'Return ONLY valid JSON: {"fixes": [{"key": "token_name", "old": "current_value", "new": "correct_table.column"}]}'
        )
        resp = client.complete(
            messages=[{"role": "user", "content": prompt}],
            description="contract_agent_repair",
            max_tokens=1024,
        )
        from backend.app.services.llm import _extract_response_text
        text = _extract_response_text(resp)
        parsed = extract_json_from_llm_response(text)
        fixes = parsed.get("fixes", [])
        if isinstance(fixes, list):
            valid_catalog = set(catalog_columns.values())
            return [f for f in fixes if isinstance(f, dict) and f.get("new") in valid_catalog]
        return []
    except Exception:
        logger.debug("agent_repair_plan_failed", exc_info=True)
        return []

def auto_repair_contract(
    contract: dict[str, Any],
    dry_run_result: dict[str, Any] | None,
    validation_result: dict[str, Any] | None,
    rich_catalog: dict[str, list[dict[str, Any]]] | None,
) -> bool:
    """Auto-repair using agent-driven analysis + deterministic fuzzy-matching.

    Returns True if any repairs were applied.
    """
    repaired = False
    mapping = contract.get("mapping", {})
    row_tokens = contract.get("row_tokens", []) or contract.get("tokens", {}).get("row_tokens", [])
    totals_math = contract.get("totals_math", {})

    # Build flat catalog for fuzzy matching
    catalog_columns: dict[str, str] = {}  # bare_col_lower -> table.column
    if rich_catalog:
        for table, columns in rich_catalog.items():
            for col_info in columns:
                col_name = col_info.get("column") or col_info.get("name", "")
                if col_name:
                    catalog_columns[col_name.lower()] = f"{table}.{col_name}"

    # Fix 0: Agent-driven repair - analyze errors and apply targeted fixes
    all_issues = []
    if dry_run_result:
        all_issues.extend(dry_run_result.get("issues") or [])
    if validation_result:
        all_issues.extend(validation_result.get("issues") or [])
    if all_issues:
        agent_fixes = _agent_repair_plan(contract, all_issues, catalog_columns)
        for fix in agent_fixes:
            key = fix.get("key", "")
            new_val = fix.get("new", "")
            if key and new_val and key in mapping:
                old_val = mapping[key]
                mapping[key] = new_val
                logger.info("agent_repair_applied", extra={"token": key, "old": old_val, "new": new_val})
                repaired = True

    # Fix 1: Unresolved row tokens - fuzzy match against catalog columns
    if dry_run_result:
        for issue in (dry_run_result.get("issues") or []):
            if issue.get("code") in ("row_token_missing_column", "row_token_all_empty"):
                tok = issue.get("token", "")
                if not tok or tok in mapping:
                    # Already mapped, check if mapping target exists
                    existing = mapping.get(tok, "")
                    if isinstance(existing, str) and existing and existing.upper() != "UNRESOLVED":
                        continue
                # Try fuzzy match: strip row_ prefix, lowercase
                bare = tok.removeprefix("row_").lower()
                if bare in catalog_columns:
                    mapping[tok] = catalog_columns[bare]
                    logger.info("auto_repair_fuzzy_match", extra={"token": tok, "mapped_to": catalog_columns[bare]})
                    repaired = True

    # Fix 2: totals_math referencing table.column -> find matching row token
    col_to_row_token: dict[str, str] = {}
    for tok in row_tokens:
        expr = mapping.get(tok, "")
        if isinstance(expr, str):
            col_to_row_token[expr] = tok
            if "." in expr:
                col_to_row_token[expr.rsplit(".", 1)[-1]] = tok

    for tok, spec in totals_math.items():
        if not isinstance(spec, dict):
            continue
        col = spec.get("column", "")
        if isinstance(col, str) and "." in col and col in col_to_row_token:
            spec["column"] = col_to_row_token[col]
            logger.info("auto_repair_totals_math_ref", extra={"token": tok, "old": col, "new": spec["column"]})
            repaired = True
        elif isinstance(col, str) and col and col not in set(row_tokens) and col in col_to_row_token:
            spec["column"] = col_to_row_token[col]
            logger.info("auto_repair_totals_math_bare", extra={"token": tok, "old": col, "new": spec["column"]})
            repaired = True

    # Fix 3: Validation issues - mapping_column_missing -> try fuzzy match
    if validation_result:
        for issue in (validation_result.get("issues") or []):
            if issue.get("code") == "mapping_column_missing":
                tok = issue.get("token", "")
                if not tok:
                    continue
                bare = tok.removeprefix("row_").removeprefix("total_").lower()
                if bare in catalog_columns:
                    mapping[tok] = catalog_columns[bare]
                    logger.info("auto_repair_validation_fix", extra={"token": tok, "mapped_to": catalog_columns[bare]})
                    repaired = True

    if repaired:
        contract["mapping"] = mapping
        contract["totals_math"] = totals_math
        logger.info("auto_repair_applied")

    return repaired

# Phase 3: LLM Ops Refiner - fix column namespaces in computed/totals

def _refine_contract_ops(contract: dict[str, Any]) -> None:
    """Call a focused LLM to fix column references in row_computed/totals_math.

    row_computed must use bare column names (DataFrame columns after reshape).
    totals_math must use row token names (row_* prefixed).
    Skipped when no computed ops exist.  Graceful degradation on failure.
    """
    from .ai_services import LLM_OPS_REFINER_PROMPT

    row_computed = contract.get("row_computed", {})
    totals_math = contract.get("totals_math", {})
    if not row_computed and not totals_math:
        return

    # Build reshape output columns (bare names available in DataFrame)
    reshape_output_cols: list[str] = []
    for rule in (contract.get("reshape_rules") or []):
        for col in (rule.get("columns") or []):
            alias = col.get("as", "")
            if alias:
                # The DataFrame column is the bare name from the "from" source
                sources = col.get("from", [])
                if sources:
                    # Extract bare column name from table.column
                    bare = sources[0].rsplit(".", 1)[-1] if "." in str(sources[0]) else str(sources[0])
                    reshape_output_cols.append(bare)

    row_tokens = contract.get("row_tokens", []) or contract.get("tokens", {}).get("row_tokens", [])
    header_tokens = contract.get("header_tokens", []) or contract.get("tokens", {}).get("scalars", [])
    mapping = contract.get("mapping", {})
    formatters = contract.get("formatters", {})

    # Build the user payload
    user_text = LLM_OPS_REFINER_PROMPT["user"].format(
        row_computed_json=json.dumps(row_computed, indent=2, ensure_ascii=False),
        totals_math_json=json.dumps(totals_math, indent=2, ensure_ascii=False),
        formatters_json=json.dumps(formatters, indent=2, ensure_ascii=False),
        reshape_output_columns_json=json.dumps(reshape_output_cols, ensure_ascii=False),
        row_tokens_json=json.dumps(row_tokens, ensure_ascii=False),
        header_tokens_json=json.dumps(header_tokens, ensure_ascii=False),
        mapping_json=json.dumps(mapping, indent=2, ensure_ascii=False),
    )

    messages = [
        {"role": "system", "content": LLM_OPS_REFINER_PROMPT["system"]},
        {"role": "user", "content": user_text},
    ]

    try:
        client = get_openai_client()
        from backend.app.services.llm import get_llm_config; model_name = get_llm_config().model
        raw = call_chat_completion(
            client,
            model=model_name,
            messages=messages,
            description="ops_refiner",
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
        logger.warning("ops_refiner_failed", extra={"error": str(exc)})
        return

    fixes = result.get("fixes_applied", [])
    if not fixes:
        logger.info("ops_refiner_no_changes")
        return

    # Apply fixed sections back
    if "row_computed" in result and isinstance(result["row_computed"], dict):
        for tok, spec in result["row_computed"].items():
            if spec is None:
                row_computed.pop(tok, None)
            elif isinstance(spec, dict):
                row_computed[tok] = spec
        contract["row_computed"] = row_computed

    if "totals_math" in result and isinstance(result["totals_math"], dict):
        for tok, spec in result["totals_math"].items():
            if spec is None:
                totals_math.pop(tok, None)
            elif isinstance(spec, dict):
                totals_math[tok] = spec
        contract["totals_math"] = totals_math

    if "formatters" in result and isinstance(result["formatters"], dict):
        for tok, spec in result["formatters"].items():
            if spec is None:
                formatters.pop(tok, None)
            else:
                formatters[tok] = spec
        contract["formatters"] = formatters

    logger.info(
        "ops_refiner_applied",
        extra={"fixes_count": len(fixes), "fixes": fixes[:5]},
    )

# Phase 1: Enhanced deterministic validators

_OP_REQUIRED_KEYS: dict[str, set[str]] = {
    "subtract": {"left", "right"},
    "add": {"left", "right"},
    "multiply": {"left", "right"},
    "divide": {"numerator", "denominator"},
    "sum": {"column"},
    "mean": {"column"},
    "count": {"column"},
    "min": {"column"},
    "max": {"column"},
    "concat": {"columns"},
    "format_date": {"column", "format"},
    "format_number": {"column"},
}
# divide also accepts {left, right} as alias for {numerator, denominator}
_DIVIDE_ALT_KEYS = {"left", "right"}

def _validate_join_block(contract: dict[str, Any]) -> None:
    """Fix incomplete join blocks."""
    join = contract.get("join")
    if not isinstance(join, dict):
        # Infer parent_table from most-referenced table in mapping
        mapping = contract.get("mapping", {})
        table_counts: dict[str, int] = {}
        for expr in mapping.values():
            if isinstance(expr, str) and "." in expr and not expr.startswith("PARAM:"):
                table = expr.rsplit(".", 1)[0]
                table_counts[table] = table_counts.get(table, 0) + 1
        if table_counts:
            top_table = max(table_counts, key=table_counts.get)  # type: ignore[arg-type]
            contract["join"] = {
                "parent_table": top_table,
                "parent_key": "rowid",
                "child_table": top_table,
                "child_key": "rowid",
            }
            logger.warning("postprocess_join_inferred", extra={"table": top_table})
        return

    parent = join.get("parent_table", "")
    child = join.get("child_table", "")
    if parent and not child:
        join["child_table"] = parent
        join.setdefault("child_key", join.get("parent_key", "rowid"))
        logger.warning("postprocess_join_child_copied", extra={"table": parent})

    # Validate key count parity
    pk = str(join.get("parent_key", "")).split(",")
    ck = str(join.get("child_key", "")).split(",")
    if len(pk) != len(ck):
        # Truncate to shorter
        min_len = min(len(pk), len(ck))
        join["parent_key"] = ",".join(pk[:min_len])
        join["child_key"] = ",".join(ck[:min_len])
        logger.warning("postprocess_join_key_parity_fixed", extra={"pk": pk, "ck": ck})

def _validate_declarative_ops(contract: dict[str, Any]) -> None:
    """Remove malformed declarative op entries from row_computed and totals_math."""
    for section_name in ("row_computed", "totals_math"):
        section = contract.get(section_name)
        if not isinstance(section, dict):
            continue
        to_remove = []
        for tok, spec in section.items():
            if not isinstance(spec, dict):
                to_remove.append(tok)
                logger.warning(
                    "postprocess_op_not_dict",
                    extra={"section": section_name, "token": tok, "type": type(spec).__name__},
                )
                continue
            op = str(spec.get("op", "")).lower()
            if not op:
                to_remove.append(tok)
                logger.warning("postprocess_op_missing", extra={"section": section_name, "token": tok})
                continue
            required = _OP_REQUIRED_KEYS.get(op)
            if required is None:
                to_remove.append(tok)
                logger.warning("postprocess_op_unknown", extra={"section": section_name, "token": tok, "op": op})
                continue
            # For divide, accept either {numerator, denominator} or {left, right}
            if op == "divide":
                has_primary = required.issubset(spec.keys())
                has_alt = _DIVIDE_ALT_KEYS.issubset(spec.keys())
                if not has_primary and not has_alt:
                    to_remove.append(tok)
                    logger.warning("postprocess_op_missing_keys", extra={"section": section_name, "token": tok, "op": op})
            else:
                if not required.issubset(spec.keys()):
                    to_remove.append(tok)
                    logger.warning("postprocess_op_missing_keys", extra={"section": section_name, "token": tok, "op": op, "missing": list(required - spec.keys())})
        for tok in to_remove:
            section.pop(tok, None)

def _validate_token_consistency(contract: dict[str, Any]) -> None:
    """Sync header_tokens/row_tokens with tokens block and fix totals_math references."""
    tokens = contract.get("tokens", {})
    scalars = tokens.get("scalars", [])
    row_toks = tokens.get("row_tokens", [])

    # Sync header_tokens ↔ tokens.scalars
    header_tokens = contract.get("header_tokens", [])
    if isinstance(header_tokens, list) and isinstance(scalars, list):
        merged = list(dict.fromkeys(scalars + header_tokens))
        contract["header_tokens"] = merged
        tokens["scalars"] = merged

    # Sync row_tokens ↔ tokens.row_tokens
    rt_top = contract.get("row_tokens", [])
    if isinstance(rt_top, list) and isinstance(row_toks, list):
        merged = list(dict.fromkeys(row_toks + rt_top))
        contract["row_tokens"] = merged
        tokens["row_tokens"] = merged

    # Fix totals_math: if column is table.column format, find the row token that maps to it
    totals_math = contract.get("totals_math", {})
    mapping = contract.get("mapping", {})
    if isinstance(totals_math, dict) and isinstance(mapping, dict):
        # Build reverse: table.column -> row_token
        col_to_row_token: dict[str, str] = {}
        for tok, expr in mapping.items():
            if isinstance(expr, str) and tok.startswith("row_"):
                col_to_row_token[expr] = tok
                # Also index bare column name
                if "." in expr:
                    bare = expr.rsplit(".", 1)[-1]
                    col_to_row_token[bare] = tok

        for tok, spec in totals_math.items():
            if not isinstance(spec, dict):
                continue
            col = spec.get("column", "")
            if not isinstance(col, str):
                continue
            # If it's a table.column or bare column that maps to a row token, fix it
            if col in col_to_row_token:
                new_col = col_to_row_token[col]
                if new_col != col:
                    spec["column"] = new_col
                    logger.info(
                        "postprocess_totals_math_col_fixed",
                        extra={"token": tok, "old": col, "new": new_col},
                    )

def _validate_reshape_lengths(contract: dict[str, Any]) -> None:
    """For UNION_ALL/MELT reshape rules, ensure all 'from' arrays are same length."""
    rules = contract.get("reshape_rules")
    if not isinstance(rules, list):
        return
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        strategy = str(rule.get("strategy", "")).upper()
        if strategy not in ("UNION_ALL", "MELT"):
            continue
        columns = rule.get("columns", [])
        if not isinstance(columns, list) or not columns:
            continue
        lengths = [len(c.get("from", [])) for c in columns if isinstance(c, dict)]
        if not lengths:
            continue
        max_len = max(lengths)
        if max_len == 0:
            continue
        for col in columns:
            if not isinstance(col, dict):
                continue
            sources = col.get("from", [])
            if len(sources) < max_len:
                # Pad with last value repeated
                pad_val = sources[-1] if sources else ""
                col["from"] = sources + [pad_val] * (max_len - len(sources))
                logger.warning(
                    "postprocess_reshape_padded",
                    extra={"alias": col.get("as"), "padded_from": len(sources), "to": max_len},
                )
            elif len(sources) > max_len:
                col["from"] = sources[:max_len]
                logger.warning(
                    "postprocess_reshape_truncated",
                    extra={"alias": col.get("as"), "truncated_from": len(sources), "to": max_len},
                )

def _postprocess_contract(contract: dict[str, Any], catalog: list[str]) -> None:
    """Enforce structural invariants the LLM may violate.

    Runs after all normalization, before serialization.  Each sub-function
    is idempotent - running the post-processor twice produces the same output.
    """
    before = {
        "date_columns": bool(contract.get("date_columns")),
        "filters_optional": len(contract.get("filters", {}).get("optional", {})),
        "row_computed": len(contract.get("row_computed", {})),
        "formatters": len(contract.get("formatters", {})),
    }

    # Phase 1 validators
    _validate_join_block(contract)
    _validate_declarative_ops(contract)
    _validate_token_consistency(contract)
    _validate_reshape_lengths(contract)

    # Existing validators
    _ensure_date_columns(contract)
    _ensure_date_filters(contract)
    _ensure_timestamp_formatting(contract)
    _normalize_formatter_conflicts(contract)
    _ensure_numeric_formatters(contract, catalog)
    _validate_mapping_against_catalog(contract, catalog)
    _strip_unresolved_entries(contract)

    after = {
        "date_columns": bool(contract.get("date_columns")),
        "filters_optional": len(contract.get("filters", {}).get("optional", {})),
        "row_computed": len(contract.get("row_computed", {})),
        "formatters": len(contract.get("formatters", {})),
    }
    changes = {k: f"{before[k]} -> {after[k]}" for k in before if before[k] != after[k]}
    if changes:
        logger.warning(
            "postprocess_contract_modified",
            extra={"event": "postprocess_contract_modified", "changes": changes},
        )

    # Stamp schema version
    contract["_schema_version"] = CONTRACT_SCHEMA_VERSION

CONTRACT_SCHEMA_VERSION = "2.1"

def check_contract_version(contract: dict[str, Any]) -> tuple[bool, str]:
    """Check if contract schema version is compatible. Returns (ok, message)."""
    version = contract.get("_schema_version", "1.0")
    try:
        major = int(str(version).split(".")[0])
        current_major = int(CONTRACT_SCHEMA_VERSION.split(".")[0])
    except (ValueError, IndexError):
        return False, f"Invalid contract version: {version}"
    if major < current_major:
        return False, f"Contract v{version} incompatible with builder v{CONTRACT_SCHEMA_VERSION}"
    return True, "ok"

def _serialize_contract(contract: dict[str, Any]) -> dict[str, Any]:
    """
    Return a deep-ish copy safe for persistence (ensures JSON serialisable values).
    """
    return json.loads(json.dumps(contract, ensure_ascii=False))

def build_or_load_contract_v2(
    template_dir: Path,
    catalog: Iterable[str],
    final_template_html: str,
    schema: Mapping[str, Any],
    auto_mapping_proposal: Mapping[str, Any],
    mapping_override: Mapping[str, Any] | None,
    user_instructions: str,
    dialect_hint: str | None,
    *,
    db_signature: str | None = None,
    key_tokens: Iterable[str] | None = None,
    prompt_builder=build_llm_call_4_prompt,
    prompt_version: str = PROMPT_VERSION_4,
) -> dict[str, Any]:
    """
    Build (or return cached) contract artifacts using LLM Call 4.
    """
    template_dir = template_dir.resolve()
    template_dir.mkdir(parents=True, exist_ok=True)

    page_summary = _load_page_summary(template_dir)
    page_summary_sha = hashlib.sha256((page_summary or "").encode("utf-8")).hexdigest()
    schema_payload = _ensure_schema(schema)
    allow_list = [str(item) for item in catalog]
    mapping_override_payload = dict(mapping_override or {})
    if not mapping_override_payload:
        mapping_override_payload = _load_mapping_override_from_disk(template_dir)

    key_tokens_list = _normalize_key_tokens(key_tokens)

    input_signature = _compute_input_signature(
        final_template_html=final_template_html,
        page_summary=page_summary,
        schema=schema_payload,
        auto_mapping_proposal=auto_mapping_proposal,
        mapping_override=mapping_override_payload,
        user_instructions=user_instructions,
        catalog=allow_list,
        dialect_hint=dialect_hint,
        key_tokens=key_tokens_list,
    )

    cached = _load_cached_payload(template_dir)
    if cached:
        meta = cached.get("meta") or {}
        if meta.get("input_signature") == input_signature and (
            db_signature is None or meta.get("db_signature") == db_signature
        ):
            logger.info(
                "contract_v2_cache_hit",
                extra={
                    "event": "contract_v2_cache_hit",
                    "template_dir": str(template_dir),
                },
            )
            result = dict(cached)
            result["cached"] = True
            contract = result.get("contract") or result.get("meta", {}).get("contract_payload")
            if isinstance(contract, dict):
                _postprocess_contract(contract, allow_list)
                contract_path = template_dir / _CONTRACT_FILENAME
                write_json_atomic(contract_path, contract, indent=2, ensure_ascii=False, step="contract_v2_postprocess_write")
            return result

    logger.info(
        "contract_v2_build_start",
        extra={
            "event": "contract_v2_build_start",
            "template_dir": str(template_dir),
        },
    )

    prompt_payload = prompt_builder(
        final_template_html=final_template_html,
        page_summary=page_summary,
        schema=schema_payload,
        auto_mapping_proposal=auto_mapping_proposal,
        mapping_override=mapping_override_payload,
        user_instructions=user_instructions,
        catalog=allow_list,
        dialect_hint=dialect_hint,
        key_tokens=key_tokens_list,
    )

    system_text = prompt_payload.get("system", "")
    base_messages = prompt_payload.get("messages") or []
    if not base_messages:
        raise ContractBuilderError("Prompt builder did not return a user message for LLM Call 4.")

    messages = _prepare_messages(system_text, base_messages)
    client = get_openai_client()

    from backend.app.services.llm import get_llm_config; model_name = get_llm_config().model

    try:
        raw_response = call_chat_completion(
            client,
            model=model_name,
            messages=messages,
            description=prompt_version,
        )
    except Exception as exc:  # pragma: no cover - network issues bubble up
        raise ContractBuilderError(f"LLM Call 4 request failed: {exc}") from exc

    content = (raw_response.choices[0].message.content or "").strip()
    content = strip_code_fences(content)
    # Additive: extract JSON object if surrounded by prose
    if content and not content.startswith(("{", "[")):
        _json_start = content.find("{")
        if _json_start >= 0:
            _json_end = content.rfind("}")
            if _json_end > _json_start:
                content = content[_json_start : _json_end + 1]
    try:
        llm_payload = json.loads(content)
    except json.JSONDecodeError as exc:
        snippet = content[:200]
        raise ContractBuilderError(f"LLM Call 4 response was not valid JSON (snippet: {snippet!r})") from exc

    overview_md = str(llm_payload.get("overview_md") or "").strip()
    if not overview_md:
        page_summary = str(llm_payload.get("page_summary") or "").strip()
        if page_summary:
            overview_md = page_summary
    if not overview_md:
        overview_md = (
            "## Contract Overview\n\n"
            "The user skipped Step 3.5 corrections or no summary was generated. "
            "Add narrative instructions in the Approve dialog to replace this placeholder."
        )
    step5_requirements = llm_payload.get("step5_requirements") or {}
    contract = _normalize_contract_payload(llm_payload.get("contract"))
    assumptions = list(llm_payload.get("assumptions") or [])
    warnings = list(llm_payload.get("warnings") or [])
    validation = llm_payload.get("validation") or {}

    validation.setdefault("unknown_columns", [])
    validation.setdefault("unknown_tokens", [])
    validation.setdefault(
        "token_coverage",
        {
            "scalars_mapped_pct": 0,
            "row_tokens_mapped_pct": 0,
            "totals_mapped_pct": 0,
        },
    )

    fallback_mapping_sources = _ensure_contract_defaults(
        contract,
        schema=schema_payload,
        auto_mapping=auto_mapping_proposal,
        mapping_override=mapping_override_payload,
        step5_requirements=step5_requirements,
    )
    _normalize_reshape_rules(contract)
    _normalize_ordering(contract)
    contract = _augment_contract_for_compat(_serialize_contract(contract))
    # DataFrame pipeline only - validate declarative ops, no SQL
    _normalize_df_mapping_sections(
        contract,
        allow_list=allow_list,
        fallback_mapping=fallback_mapping_sources,
    )
    # Phase 3: LLM Ops Refiner - fix column namespaces in row_computed/totals_math
    _refine_contract_ops(contract)
    _postprocess_contract(contract, allow_list)

    now = int(time.time())
    overview_path = template_dir / _OVERVIEW_FILENAME
    step5_path = template_dir / _STEP5_REQ_FILENAME
    meta_path = template_dir / _META_FILENAME

    write_text_atomic(overview_path, overview_md, encoding="utf-8", step="contract_v2_overview_write")
    write_json_atomic(step5_path, step5_requirements, indent=2, ensure_ascii=False, step="contract_v2_step5_write")

    contract_path = template_dir / _CONTRACT_FILENAME

    meta_payload = {
        "prompt_version": prompt_version,
        "model": model_name,
        "input_signature": input_signature,
        "db_signature": db_signature,
        "page_summary_sha256": page_summary_sha,
        "generated_at": now,
        "assumptions": assumptions,
        "warnings": warnings,
        "validation": validation,
        "overview_path": _OVERVIEW_FILENAME,
        "step5_requirements_path": _STEP5_REQ_FILENAME,
        "contract_payload": contract,
        "key_tokens": key_tokens_list,
    }
    write_json_atomic(meta_path, meta_payload, indent=2, ensure_ascii=False, step="contract_v2_meta_write")
    write_json_atomic(contract_path, contract, indent=2, ensure_ascii=False, step="contract_v2_contract_write")

    write_artifact_manifest(
        template_dir,
        step="contract_build_v2",
        files={
            _OVERVIEW_FILENAME: overview_path,
            _STEP5_REQ_FILENAME: step5_path,
            _META_FILENAME: meta_path,
            _CONTRACT_FILENAME: contract_path,
        },
        inputs=[
            f"contract_v2_input_signature={input_signature}",
            f"dialect_hint={dialect_hint or ''}",
        ],
        correlation_id=None,
    )

    logger.info(
        "contract_v2_build_complete",
        extra={
            "event": "contract_v2_build_complete",
            "template_dir": str(template_dir),
        },
    )

    return {
        "contract": contract,
        "overview_md": overview_md,
        "step5_requirements": step5_requirements,
        "assumptions": assumptions,
        "warnings": warnings,
        "validation": validation,
        "artifacts": {
            "overview": overview_path,
            "step5_requirements": step5_path,
            "meta": meta_path,
            "contract": contract_path,
        },
        "meta": meta_payload,
        "cached": False,
        "key_tokens": key_tokens_list,
    }

def load_contract_v2(template_dir: Path) -> Optional[dict[str, Any]]:
    """
    Load persisted contract v2 artifacts without triggering a rebuild.
    Returns None if any required artifact is missing.
    """
    cached = _load_cached_payload(template_dir.resolve())
    if cached is None:
        return None
    cached["cached"] = True
    return cached

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
_SUBQUERY_RE = re.compile(r"(?is)\bSELECT\b|;", re.IGNORECASE)
_LEGACY_WRAPPER_RE = re.compile(r"(?i)\b(DERIVED\s*:|TABLE_COLUMNS\s*\[|COLUMN_EXP\s*\[)")

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("neura.contract.validator")

_TABLE_COL_RE = re.compile(r"^([A-Za-z_][\w]*)\.\s*([A-Za-z_][\w]*)$")
_VALID_OPS = {
    "subtract", "add", "multiply", "divide",
    "sum", "mean", "count", "min", "max",
    "concat", "format_date", "format_number",
}

@dataclass
class ValidationIssue:
    severity: str  # "error" | "warning"
    code: str
    message: str
    token: str = ""
    section: str = ""

@dataclass
class ValidationReport:
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "error")

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == "warning")

    def to_dict(self) -> dict[str, Any]:
        return {
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "issues": [
                {
                    "severity": i.severity,
                    "code": i.code,
                    "message": i.message,
                    "token": i.token,
                    "section": i.section,
                }
                for i in self.issues
            ],
        }

    def to_gate_result(self, artifact_sha256: str = "") -> "GateResult":
        """Convert to a pipeline GateResult for mandatory gate checks."""
        from .pipeline_combined import GateIssue, GateResult

        errors = [
            GateIssue(severity=i.severity, code=i.code, message=i.message, token=i.token, section=i.section)
            for i in self.issues if i.severity == "error"
        ]
        warnings = [
            GateIssue(severity=i.severity, code=i.code, message=i.message, token=i.token, section=i.section)
            for i in self.issues if i.severity == "warning"
        ]
        return GateResult(
            passed=self.error_count == 0,
            stage="contract_validate",
            errors=errors,
            warnings=warnings,
            artifact_sha256=artifact_sha256,
        )

def _build_catalog_set(rich_catalog: dict[str, list[dict[str, Any]]]) -> set[str]:
    """Build a set of table.column from rich_catalog."""
    result: set[str] = set()
    for table, columns in rich_catalog.items():
        for col_info in columns:
            col_name = col_info.get("column") or col_info.get("name", "")
            if col_name:
                result.add(f"{table}.{col_name}")
    return result

def _get_catalog_tables(rich_catalog: dict[str, list[dict[str, Any]]]) -> set[str]:
    return set(rich_catalog.keys())

def validate_contract(
    contract: dict[str, Any],
    rich_catalog: dict[str, list[dict[str, Any]]],
) -> ValidationReport:
    """Run all deterministic checks against the contract and rich_catalog."""
    report = ValidationReport()
    catalog_set = _build_catalog_set(rich_catalog)
    catalog_tables = _get_catalog_tables(rich_catalog)
    catalog_lower = {c.lower() for c in catalog_set}

    # 1. Every table.column in mapping exists in rich_catalog
    mapping = contract.get("mapping", {})
    for tok, expr in mapping.items():
        if not isinstance(expr, str):
            continue
        if expr.startswith("PARAM:") or expr.upper() in ("UNRESOLVED", ""):
            continue
        m = _TABLE_COL_RE.match(expr.strip())
        if m:
            ref = f"{m.group(1)}.{m.group(2)}"
            if ref.lower() not in catalog_lower:
                report.issues.append(ValidationIssue(
                    severity="error",
                    code="mapping_column_missing",
                    message=f"Mapping '{tok}' -> '{ref}' not found in catalog",
                    token=tok,
                    section="mapping",
                ))

    # 2. Join keys exist in their tables
    join = contract.get("join", {})
    if isinstance(join, dict):
        for role in ("parent", "child"):
            table = join.get(f"{role}_table", "")
            key = join.get(f"{role}_key", "")
            if table and key and table in catalog_tables:
                for k in key.split(","):
                    k = k.strip()
                    if k == "rowid":
                        continue  # SQLite implicit
                    ref = f"{table}.{k}"
                    if ref.lower() not in catalog_lower:
                        report.issues.append(ValidationIssue(
                            severity="warning",
                            code="join_key_missing",
                            message=f"Join {role}_key '{k}' not found in table '{table}'",
                            section="join",
                        ))

    # 3. date_columns entries are real columns
    date_columns = contract.get("date_columns", {})
    if isinstance(date_columns, dict):
        for table, col in date_columns.items():
            if not table or not col:
                continue
            ref = f"{table}.{col}"
            if ref.lower() not in catalog_lower:
                report.issues.append(ValidationIssue(
                    severity="warning",
                    code="date_column_missing",
                    message=f"date_columns '{ref}' not found in catalog",
                    section="date_columns",
                ))

    # 4. Reshape "from" sources exist in catalog
    for rule in (contract.get("reshape_rules") or []):
        for col in (rule.get("columns") or []):
            for src in (col.get("from") or []):
                if not isinstance(src, str) or src.upper() == "UNRESOLVED":
                    continue
                m = _TABLE_COL_RE.match(src.strip())
                if m:
                    ref = f"{m.group(1)}.{m.group(2)}"
                    if ref.lower() not in catalog_lower:
                        report.issues.append(ValidationIssue(
                            severity="error",
                            code="reshape_source_missing",
                            message=f"Reshape source '{ref}' (alias '{col.get('as')}') not in catalog",
                            token=col.get("as", ""),
                            section="reshape_rules",
                        ))

    # 5. totals_math references row token names, not table.column
    row_tokens_set = set(contract.get("row_tokens", []) or contract.get("tokens", {}).get("row_tokens", []))
    totals_math = contract.get("totals_math", {})
    if isinstance(totals_math, dict):
        for tok, spec in totals_math.items():
            if not isinstance(spec, dict):
                continue
            col = spec.get("column", "")
            if isinstance(col, str) and col and "." in col:
                report.issues.append(ValidationIssue(
                    severity="warning",
                    code="totals_math_table_ref",
                    message=f"totals_math '{tok}' references '{col}' - should use row token name",
                    token=tok,
                    section="totals_math",
                ))
            elif isinstance(col, str) and col and col not in row_tokens_set:
                report.issues.append(ValidationIssue(
                    severity="warning",
                    code="totals_math_unknown_token",
                    message=f"totals_math '{tok}' references '{col}' which is not in row_tokens",
                    token=tok,
                    section="totals_math",
                ))

    # 6. No UNRESOLVED values in reshape rule sources
    for rule in (contract.get("reshape_rules") or []):
        for col in (rule.get("columns") or []):
            for src in (col.get("from") or []):
                if isinstance(src, str) and src.upper() == "UNRESOLVED":
                    report.issues.append(ValidationIssue(
                        severity="error",
                        code="reshape_unresolved",
                        message=f"Reshape column '{col.get('as')}' has UNRESOLVED source",
                        token=col.get("as", ""),
                        section="reshape_rules",
                    ))

    # 7. All row_computed / totals_math entries are dicts with valid op keys
    for section_name in ("row_computed", "totals_math"):
        section = contract.get(section_name, {})
        if not isinstance(section, dict):
            continue
        for tok, spec in section.items():
            if not isinstance(spec, dict):
                report.issues.append(ValidationIssue(
                    severity="error",
                    code="op_not_dict",
                    message=f"{section_name}.{tok} is {type(spec).__name__}, expected dict",
                    token=tok,
                    section=section_name,
                ))
                continue
            op = str(spec.get("op", "")).lower()
            if op not in _VALID_OPS:
                report.issues.append(ValidationIssue(
                    severity="error",
                    code="op_invalid",
                    message=f"{section_name}.{tok} has unknown op '{op}'",
                    token=tok,
                    section=section_name,
                ))

    # 8. Every mapping value matches table.column or PARAM:* format
    for tok, expr in mapping.items():
        if not isinstance(expr, str):
            report.issues.append(ValidationIssue(
                severity="error",
                code="mapping_not_string",
                message=f"Mapping '{tok}' has non-string value: {type(expr).__name__}",
                token=tok,
                section="mapping",
            ))
        elif expr and not expr.startswith("PARAM:") and expr.upper() != "UNRESOLVED":
            if "." not in expr:
                report.issues.append(ValidationIssue(
                    severity="warning",
                    code="mapping_no_table_prefix",
                    message=f"Mapping '{tok}' -> '{expr}' missing table prefix",
                    token=tok,
                    section="mapping",
                ))

    # 9. Token names are valid identifiers
    _TOKEN_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    for section_name in ("header_tokens", "row_tokens"):
        for tok in (contract.get(section_name) or []):
            if not _TOKEN_NAME_RE.match(tok):
                report.issues.append(ValidationIssue(
                    severity="warning",
                    code="invalid_token_name",
                    message=f"Token '{tok}' in {section_name} is not a valid identifier",
                    token=tok,
                    section=section_name,
                ))

    # 10. Schema drift detection - required top-level keys
    _REQUIRED_KEYS = {"mapping", "tokens"}
    for key in _REQUIRED_KEYS:
        if key not in contract:
            report.issues.append(ValidationIssue(
                severity="warning",
                code="missing_required_key",
                message=f"Contract missing expected key '{key}'",
                section="schema",
            ))

    # 11. Semantic validation via LLM (warnings only, non-blocking)
    try:
        semantic_issues = _validate_contract_semantic(contract, rich_catalog)
        report.issues.extend(semantic_issues)
    except Exception:
        logger.debug("semantic_validation_skipped", exc_info=True)

    if report.issues:
        logger.warning(
            "contract_validation_complete",
            extra={
                "error_count": report.error_count,
                "warning_count": report.warning_count,
                "issues": [f"{i.code}:{i.token}" for i in report.issues[:10]],
            },
        )
    else:
        logger.info("contract_validation_clean")

    return report

def _validate_contract_semantic(
    contract: dict[str, Any],
    rich_catalog: dict[str, list[dict[str, Any]]],
) -> list[ValidationIssue]:
    """LLM-based semantic validation - catches issues deterministic checks miss.

    All issues are reported as warnings (not errors) to avoid false-positive blocking.
    """
    import json as _json

    from backend.app.services.llm import get_llm_client

    client = get_llm_client()

    mapping = contract.get("mapping", {})
    join = contract.get("join", {})
    reshape = contract.get("reshape_rules", [])
    catalog_summary = {
        table: [c.get("column") or c.get("name", "") for c in cols]
        for table, cols in rich_catalog.items()
    }

    contract_excerpt = _json.dumps(
        {"mapping": mapping, "join": join, "reshape_rules": reshape},
        indent=2, ensure_ascii=False,
    )[:5000]
    catalog_excerpt = _json.dumps(catalog_summary, indent=2, ensure_ascii=False)[:3000]

    prompt = (
        "You are a data contract validator. Check this contract for semantic issues:\n"
        "- Joins between mismatched data types (e.g., date column joined to numeric)\n"
        "- Reshape rules that would produce empty results\n"
        "- Logical inconsistencies in mapping (e.g., same column mapped to incompatible tokens)\n"
        "- Missing join conditions for multi-table contracts\n\n"
        f"Contract:\n{contract_excerpt}\n\n"
        f"Database catalog:\n{catalog_excerpt}\n\n"
        'Return ONLY valid JSON array of issues: [{"code": "...", "message": "...", "token": "...", "section": "..."}]\n'
        "Return [] if no issues found."
    )

    resp = client.complete(
        messages=[{"role": "user", "content": prompt}],
        description="contract_semantic_validate",
        max_tokens=1024,
    )

    from backend.app.services.infra_services import extract_json_array_from_llm_response
    from backend.app.services.llm import _extract_response_text

    text = _extract_response_text(resp)
    raw_issues = extract_json_array_from_llm_response(text, default=[])

    issues: list[ValidationIssue] = []
    for item in raw_issues:
        if not isinstance(item, dict):
            continue
        issues.append(ValidationIssue(
            severity="warning",  # Always warnings - LLM may produce false positives
            code=f"semantic_{item.get('code', 'unknown')}",
            message=str(item.get("message", "Semantic issue detected")),
            token=str(item.get("token", "")),
            section=str(item.get("section", "")),
        ))

    if issues:
        logger.info("semantic_validation_issues", extra={"count": len(issues)})
    return issues

# mypy: ignore-errors
"""Phase 6: Deterministic dry-run pre-flight check.

Instantiates ContractAdapter and runs resolve_header_data, resolve_row_data,
resolve_totals_data against real data.  Returns a structured result with
any issues found.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("neura.contract.dry_run")

@dataclass
class DryRunIssue:
    severity: str  # "error" | "warning"
    code: str
    message: str
    token: str = ""

@dataclass
class DryRunResult:
    success: bool = True
    header_tokens_resolved: int = 0
    header_tokens_empty: list[str] = field(default_factory=list)
    row_count: int = 0
    row_tokens_unresolved: list[str] = field(default_factory=list)
    totals_resolved: int = 0
    totals_empty: list[str] = field(default_factory=list)
    issues: list[DryRunIssue] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "header_tokens_resolved": self.header_tokens_resolved,
            "header_tokens_empty": self.header_tokens_empty,
            "row_count": self.row_count,
            "row_tokens_unresolved": self.row_tokens_unresolved,
            "totals_resolved": self.totals_resolved,
            "totals_empty": self.totals_empty,
            "issues": [
                {"severity": i.severity, "code": i.code, "message": i.message, "token": i.token}
                for i in self.issues
            ],
        }

    def to_gate_result(self, artifact_sha256: str = "") -> "GateResult":
        """Convert to a pipeline GateResult for mandatory gate checks."""
        from .pipeline_combined import GateIssue, GateResult

        errors = [
            GateIssue(severity=i.severity, code=i.code, message=i.message, token=i.token)
            for i in self.issues if i.severity == "error"
        ]
        warnings = [
            GateIssue(severity=i.severity, code=i.code, message=i.message, token=i.token)
            for i in self.issues if i.severity == "warning"
        ]
        return GateResult(
            passed=self.success,
            stage="contract_dry_run",
            errors=errors,
            warnings=warnings,
            artifact_sha256=artifact_sha256,
        )

def run_contract_dry_run(
    contract: dict[str, Any],
    loader,
) -> DryRunResult:
    """Execute a dry run of the contract against real data via the loader.

    Non-destructive: reads data only.  Catches exceptions gracefully.
    """
    from .reports.support import ContractAdapter

    result = DryRunResult()

    try:
        adapter = ContractAdapter(contract)
    except Exception as exc:
        result.success = False
        result.issues.append(DryRunIssue(
            severity="error",
            code="adapter_init_failed",
            message=f"ContractAdapter init failed: {exc}",
        ))
        logger.error("dry_run_adapter_init_failed", extra={"error": str(exc)})
        return result

    # --- Header resolution ---
    try:
        header_data = adapter.resolve_header_data(loader, params={})
        for tok, val in header_data.items():
            if val is None or str(val).strip() == "":
                result.header_tokens_empty.append(tok)
                result.issues.append(DryRunIssue(
                    severity="warning",
                    code="header_empty",
                    message=f"Header token '{tok}' resolved to empty",
                    token=tok,
                ))
            else:
                result.header_tokens_resolved += 1
    except Exception as exc:
        result.issues.append(DryRunIssue(
            severity="error",
            code="header_resolve_failed",
            message=f"resolve_header_data failed: {exc}",
        ))
        logger.warning("dry_run_header_failed", extra={"error": str(exc)})

    # --- Row resolution ---
    rows_df = None
    try:
        rows_df = adapter.resolve_row_data(loader, params={})
        if rows_df is not None and not rows_df.empty:
            result.row_count = len(rows_df)
            # Check for columns that are entirely empty
            row_tokens = contract.get("row_tokens", []) or contract.get("tokens", {}).get("row_tokens", [])
            for tok in row_tokens:
                if tok in rows_df.columns:
                    if rows_df[tok].isna().all() or (rows_df[tok].astype(str).str.strip() == "").all():
                        result.row_tokens_unresolved.append(tok)
                        result.issues.append(DryRunIssue(
                            severity="warning",
                            code="row_token_all_empty",
                            message=f"Row token '{tok}' is empty for all rows",
                            token=tok,
                        ))
                else:
                    result.row_tokens_unresolved.append(tok)
                    result.issues.append(DryRunIssue(
                        severity="error",
                        code="row_token_missing_column",
                        message=f"Row token '{tok}' not found in resolved DataFrame columns",
                        token=tok,
                    ))
        else:
            result.issues.append(DryRunIssue(
                severity="warning",
                code="no_row_data",
                message="resolve_row_data returned empty DataFrame",
            ))
    except Exception as exc:
        result.success = False
        result.issues.append(DryRunIssue(
            severity="error",
            code="row_resolve_failed",
            message=f"resolve_row_data failed: {exc}",
        ))
        logger.warning("dry_run_row_failed", extra={"error": str(exc)})

    # --- Totals resolution ---
    try:
        if rows_df is not None and not rows_df.empty:
            totals_data = adapter.resolve_totals_data(rows_df)
            for tok, val in totals_data.items():
                if val is None or str(val).strip() == "":
                    result.totals_empty.append(tok)
                    result.issues.append(DryRunIssue(
                        severity="warning",
                        code="total_empty",
                        message=f"Total token '{tok}' resolved to empty",
                        token=tok,
                    ))
                else:
                    result.totals_resolved += 1
    except Exception as exc:
        result.issues.append(DryRunIssue(
            severity="error",
            code="totals_resolve_failed",
            message=f"resolve_totals_data failed: {exc}",
        ))
        logger.warning("dry_run_totals_failed", extra={"error": str(exc)})

    # Set success based on presence of errors
    if any(i.severity == "error" for i in result.issues):
        result.success = False

    logger.info(
        "dry_run_complete",
        extra={
            "success": result.success,
            "headers": result.header_tokens_resolved,
            "rows": result.row_count,
            "totals": result.totals_resolved,
            "issues": len(result.issues),
        },
    )

    return result

# mypy: ignore-errors
"""Phase 4: Contract-Data Simulation.

Gives the LLM the finalized contract + actual sample data rows + template tokens,
and asks it to simulate filling in the template. Catches issues that only manifest
with real data - empty tokens, type mismatches, wrong join direction.
"""

import json
import logging
import os
from typing import Any

logger = logging.getLogger("neura.contract.simulator")

def run_contract_simulation(
    contract: dict[str, Any],
    loader,
    template_tokens: list[str] | None = None,
) -> dict[str, Any]:
    """Simulate filling a report with real data and return issues found.

    Returns dict with: header_fill, row_fill, totals_fill, issues.
    Gracefully returns empty result on failure.
    """
    from .ai_services import LLM_SIMULATE_FILL_PROMPT
    from backend.app.services.templates import get_openai_client
    from .infra_services import call_chat_completion
    from .infra_services import strip_code_fences

    # Collect sample data from referenced tables
    join = contract.get("join", {})
    tables_to_sample: set[str] = set()
    if isinstance(join, dict):
        for key in ("parent_table", "child_table"):
            t = join.get(key, "")
            if t:
                tables_to_sample.add(t)

    # Also scan mapping for table references
    for expr in (contract.get("mapping") or {}).values():
        if isinstance(expr, str) and "." in expr and not expr.startswith("PARAM:"):
            table = expr.rsplit(".", 1)[0]
            tables_to_sample.add(table)

    sample_data: dict[str, list[dict[str, Any]]] = {}
    for table in tables_to_sample:
        try:
            df = loader.frame(table)
            if df is not None and not df.empty:
                sample_data[table] = df.head(5).to_dict("records")
        except Exception:
            logger.debug(f"simulator_table_skip: {table}")

    if not sample_data:
        logger.warning("simulator_no_data")
        return {"issues": [{"severity": "warning", "problem": "no_data", "detail": "No sample data available"}]}

    # Build template tokens if not provided
    if not template_tokens:
        template_tokens = []
        for section in ("header_tokens", "row_tokens"):
            template_tokens.extend(contract.get(section, []))
        for tok in (contract.get("tokens", {}).get("totals") or []):
            template_tokens.append(tok)
        for tok in (contract.get("totals_math") or {}):
            if tok not in template_tokens:
                template_tokens.append(tok)

    user_text = LLM_SIMULATE_FILL_PROMPT["user"].format(
        contract_json=json.dumps(contract, indent=2, ensure_ascii=False),
        sample_data_json=json.dumps(sample_data, indent=2, ensure_ascii=False, default=str),
        template_tokens_json=json.dumps(template_tokens, ensure_ascii=False),
    )

    messages = [
        {"role": "system", "content": LLM_SIMULATE_FILL_PROMPT["system"]},
        {"role": "user", "content": user_text},
    ]

    try:
        client = get_openai_client()
        from backend.app.services.llm import get_llm_config; model_name = get_llm_config().model
        raw = call_chat_completion(
            client,
            model=model_name,
            messages=messages,
            description="contract_simulation",
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
        logger.warning("simulator_failed", extra={"error": str(exc)})
        return {"issues": [{"severity": "warning", "problem": "simulation_failed", "detail": str(exc)}]}

    issues = result.get("issues", [])
    error_count = sum(1 for i in issues if i.get("severity") == "error")
    warning_count = sum(1 for i in issues if i.get("severity") == "warning")

    logger.info(
        "simulator_complete",
        extra={
            "errors": error_count,
            "warnings": warning_count,
            "header_fill_count": len(result.get("header_fill", {})),
            "row_fill_count": len(result.get("row_fill", [])),
            "totals_fill_count": len(result.get("totals_fill", {})),
        },
    )

    return result
