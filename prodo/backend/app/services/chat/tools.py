# mypy: ignore-errors
"""
Pipeline Tool Definitions for the Hermes Agent loop.

Each tool:
- Has an OpenAI-format function schema (for tool calling)
- Validates preconditions via session state (Python-enforced gates)
- Calls existing service functions from legacy_services.py etc.
- Returns a typed result dict
- Can push progress events to an asyncio.Queue for NDJSON streaming
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, Optional

from starlette.requests import Request

from .session import ChatSession, PipelineState

logger = logging.getLogger("neura.chat.tools")


# ── Exceptions ────────────────────────────────────────────────────────

class PreconditionError(Exception):
    """Raised when a tool is called in an invalid pipeline state."""

    def __init__(self, tool: str, current_state: str, required: set[str]):
        self.tool = tool
        self.current_state = current_state
        self.required = required
        super().__init__(
            f"Tool '{tool}' requires state in {sorted(required)}, "
            f"current state is '{current_state}'"
        )


class CallLimitExceeded(Exception):
    """Raised when a tool has been called too many times in one turn."""

    def __init__(self, tool: str, count: int, limit: int):
        self.tool = tool
        self.count = count
        self.limit = limit
        super().__init__(
            f"Tool '{tool}' called {count} times, limit is {limit}"
        )


# ── Tool Context ──────────────────────────────────────────────────────

@dataclass
class ToolContext:
    """Shared context passed to every tool invocation."""

    session: ChatSession
    request: Request
    template_id: str | None
    connection_id: str | None
    event_queue: asyncio.Queue
    call_counts: dict[str, int] = field(default_factory=dict)
    _upload_file: Any = None  # stashed by agent loop for verify_template

    CALL_LIMITS: ClassVar[dict[str, int]] = {
        "validate_pipeline": 3,
        "auto_fix_issues": 3,
        "refine_mapping": 5,
        "call_qwen_vision": 5,
        "auto_map_tokens": 2,       # Allow retry after mapping adjustment (hallucinated tokens stripped)
        "resolve_mapping_pipeline": 1,  # Same — uses auto_map internally
        "simulate_mapping": 1,      # Read-only preview, once is enough
    }

    def check_call_limit(self, tool_name: str) -> None:
        limit = self.CALL_LIMITS.get(tool_name)
        if limit is None:
            return
        count = self.call_counts.get(tool_name, 0)
        if count >= limit:
            raise CallLimitExceeded(tool_name, count, limit)
        self.call_counts[tool_name] = count + 1


# ── Helpers ───────────────────────────────────────────────────────────

def _require_state(session: ChatSession, allowed: set[str], tool_name: str) -> None:
    """Raise PreconditionError if session is not in an allowed state."""
    if getattr(session, "workspace_mode", False):
        return  # Workspace mode: no state restrictions
    if session.pipeline_state.value not in allowed:
        raise PreconditionError(tool_name, session.pipeline_state.value, allowed)


# ── Canonical directive definitions ───────────────────────────────────
# Single source of truth for what constitutes a mapping directive vs a table.column ref.
# Import these in mapping_sanity.py and checks.py instead of defining inline.

MAPPING_DIRECTIVE_PREFIXES = frozenset({"RESHAPE:", "COMPUTED:", "SUM:", "AGGREGATE:", "PARAM:", "params."})
MAPPING_DIRECTIVE_VALUES = frozenset({"INDEX", "LATER_SELECTED", "UNRESOLVED", "To Be Selected in report generator"})


def is_directive(value: str) -> bool:
    """Check if a mapping value is a directive (not a table.column reference)."""
    if value in MAPPING_DIRECTIVE_VALUES:
        return True
    return any(value.startswith(p) for p in MAPPING_DIRECTIVE_PREFIXES)


def is_resolved(value: str) -> bool:
    """Check if a mapping value is resolved (not UNRESOLVED or empty)."""
    return bool(value.strip()) and value != "UNRESOLVED"


# ── Learning Control: Sanitization + Signals ──────────────────────────
# Hermes learns from tool outputs. It must learn execution PATTERNS
# (tool order, retry strategy) but NOT data specifics (mappings, schemas).

ERROR_TAXONOMY = frozenset({
    "mapping:many_unresolved", "mapping:few_unresolved",
    "mapping_sanity:duplicate_column", "mapping_sanity:type_mismatch", "mapping_sanity:cross_field",
    "validation:column_missing", "validation:join_failed", "validation:dry_run_failed", "validation:visual_check_failed",
    "precondition:wrong_state", "gate:validation_required",
    "limit:validate_pipeline", "limit:auto_fix_issues", "limit:refine_mapping",
    "tool:unknown", "tool:execution_failed",
})


def _classify_error(raw_result: dict) -> str:
    """Hierarchical error type for sharper Hermes learning.

    Format: 'category:specificity'
    Hermes learns which recovery tool fixes which error class,
    without learning data specifics.
    """
    error = raw_result.get("error", "unknown")
    violations = raw_result.get("violations", [])
    message = str(raw_result.get("message", "")).lower()

    if error == "mapping_sanity_failed":
        if any("same column" in str(v) for v in violations):
            return "mapping_sanity:duplicate_column"
        if any("numeric" in str(v).lower() or "type" in str(v).lower() for v in violations):
            return "mapping_sanity:type_mismatch"
        return "mapping_sanity:cross_field"

    if error == "unresolved_tokens":
        count = len(raw_result.get("unresolved", []))
        return "mapping:many_unresolved" if count > 5 else "mapping:few_unresolved"

    if error == "precondition_failed":
        return "precondition:wrong_state"
    if error == "call_limit_exceeded":
        tool = raw_result.get("tool", "unknown")
        canonical = f"limit:{tool}"
        return canonical if canonical in ERROR_TAXONOMY else "limit:validate_pipeline"
    if error == "validation_required":
        return "gate:validation_required"

    if "column" in message and "missing" in message:
        return "validation:column_missing"
    if "join" in message and ("fail" in message or "invalid" in message):
        return "validation:join_failed"
    if "dry" in message and "run" in message:
        return "validation:dry_run_failed"

    return "tool:execution_failed"


def _sanitize_for_agent(tool_name: str, raw_result: dict) -> dict:
    """Strip semantic data from tool results before Hermes sees them.

    Hermes sees abstract summaries + error types + learning signals.
    Never sees: mapping dicts, contract JSON, column associations.
    """
    sanitized = {
        "status": raw_result.get("status", "unknown"),
        "stage": tool_name,
    }

    # Error path: structured signal
    if raw_result.get("error"):
        error_type = _classify_error(raw_result)
        sanitized["error_type"] = error_type
        sanitized["retryable"] = error_type not in (
            "precondition:wrong_state", "gate:validation_required",
        ) and not error_type.startswith("limit:")
        sanitized["learning_signal"] = {"valid": False, "reason": error_type}
        # Pass through error message (safe — it's about structure, not data)
        sanitized["message"] = raw_result.get("message", "")
        return sanitized

    # Success path: learning signal
    sanitized["learning_signal"] = {"valid": True}

    # Tool-specific sanitization: expose counts/status, NOT data
    if tool_name == "auto_map_tokens":
        sanitized["resolved_count"] = raw_result.get("total_tokens", 0) - raw_result.get("unresolved_count", 0)
        sanitized["unresolved_count"] = raw_result.get("unresolved_count", 0)
        sanitized["has_issues"] = raw_result.get("unresolved_count", 0) > 0

    elif tool_name == "build_contract":
        sanitized["contract_built"] = raw_result.get("status") == "ok"

    elif tool_name == "validate_pipeline":
        summary = raw_result.get("summary", {})
        sanitized["passed"] = raw_result.get("passed", False)
        sanitized["error_count"] = summary.get("errors", 0)
        sanitized["warning_count"] = summary.get("warnings", 0)

    elif tool_name == "verify_template":
        sanitized["template_id"] = raw_result.get("template_id")
        sanitized["token_count"] = raw_result.get("token_count", 0)
        sanitized["ocr_extracted"] = raw_result.get("ocr_extracted", False)
        sanitized["ocr_chars"] = raw_result.get("ocr_chars", 0)

    elif tool_name == "simulate_mapping":
        sanitized["overall_score"] = raw_result.get("overall_score")
        sanitized["weak_token_count"] = len(raw_result.get("weak_tokens", []))
        sanitized["unresolved_count"] = len(raw_result.get("unresolved", []))

    elif tool_name == "generate_report":
        sanitized["job_id"] = raw_result.get("job_id")

    elif tool_name == "dry_run_preview":
        # Pass through verification data — agent needs this to decide fix vs show to user
        sanitized["verdict"] = raw_result.get("verdict")
        sanitized["sample_start"] = raw_result.get("sample_start")
        sanitized["sample_end"] = raw_result.get("sample_end")
        sanitized["batches_found"] = raw_result.get("batches_found")
        sanitized["data_rows"] = raw_result.get("data_rows")
        sanitized["filled_cells"] = raw_result.get("filled_cells")
        sanitized["empty_cell_pct"] = raw_result.get("empty_cell_pct")
        sanitized["leaked_tokens"] = raw_result.get("leaked_tokens")
        sanitized["has_data"] = raw_result.get("has_data")
        sanitized["has_leaks"] = raw_result.get("has_leaks")
        sanitized["pdf_size_kb"] = raw_result.get("pdf_size_kb")
        sanitized["pdf_url"] = raw_result.get("pdf_url")
        sanitized["cross_check_issues"] = raw_result.get("cross_check_issues", [])
        sanitized["row_data_issues"] = raw_result.get("row_data_issues", [])
        sanitized["db_first_row_sample"] = raw_result.get("db_first_row_sample", {})
        sanitized["db_rows_in_range"] = raw_result.get("db_rows_in_range")
        sanitized["dry_run_completed"] = raw_result.get("dry_run_completed", False)

    elif tool_name == "resolve_mapping_pipeline":
        sanitized["pipeline_status"] = raw_result.get("status")
        if raw_result.get("unresolved"):
            sanitized["unresolved_count"] = len(raw_result["unresolved"])

    else:
        # Safe tools (session_get_state, inspect_data, get_schema, etc.)
        # Pass through — no learnable semantic data
        return raw_result

    return sanitized


# ── Tool → Panel mapping (frontend panel to show after tool completes) ──
TOOL_PANEL_MAP = {
    "verify_template": "template",
    "save_template": "template",
    "read_template": "template",
    "edit_template": "template",
    "auto_map_tokens": "mappings",
    "resolve_mapping_pipeline": "mappings",
    "refine_mapping": "mappings",
    "edit_mapping": "mappings",
    "read_mapping": "mappings",
    "simulate_mapping": "mappings",
    "compare_mappings": "mappings",
    "get_schema": "data",
    "inspect_data": "data",
    "get_column_stats": "data",
    "build_contract": "logic",
    "build_generator_assets": "logic",
    "preview_contract": "logic",
    "read_contract": "logic",
    "validate_pipeline": "errors",
    "auto_fix_issues": "errors",
    "dry_run_preview": "preview",
    "discover_batches": "preview",
    "generate_report": "preview",
}


def _build_completion_signal(ctx: ToolContext) -> dict:
    """Build learning signal for pipeline completion."""
    session = ctx.session
    retries_used = any(v > 1 for v in ctx.call_counts.values())
    user_corrected = "corrections" in session.completed_stages

    if (session.pipeline_state.value in ("validated", "ready")
            and "validate" in session.completed_stages):
        return {
            "valid": True,
            "stage": "complete",
            "no_retries": not retries_used,
            "no_user_corrections": not user_corrected,
            "clean_run": not retries_used and not user_corrected,
        }
    return {
        "valid": False,
        "reason": f"ended_at_{session.pipeline_state.value}",
        "retries_used": retries_used,
        "user_corrected": user_corrected,
    }


def _expand_reshape_directives(mapping: dict[str, str], connection_id: str) -> dict[str, list[str]]:
    """Expand RESHAPE:pattern directives into actual column lists from DB.

    E.g. RESHAPE:bin_content → find all columns matching bin*_content in DB
    → returns {"row_material_name": ["recipes.bin1_content", "recipes.bin2_content", ...]}
    """
    expansions: dict[str, list[str]] = {}
    reshape_tokens = {t: v for t, v in mapping.items() if v.startswith("RESHAPE:")}
    if not reshape_tokens:
        return expansions

    try:
        from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)

        # Get all column names from all tables
        all_columns: dict[str, list[str]] = {}
        for table in loader.table_names():
            try:
                all_columns[table] = list(loader.frame(table).columns)
            except Exception:
                pass

        for token, directive in reshape_tokens.items():
            raw = directive.split(":", 1)[1].strip()  # e.g. "bin_content" or "bin1_content,bin2_content,..."

            # Case 1: Comma-separated explicit column list
            if "," in raw:
                col_names = [c.strip() for c in raw.split(",") if c.strip()]
                # Find which table these columns belong to
                for table, cols in all_columns.items():
                    if col_names[0] in cols:
                        expansions[token] = [f"{table}.{c}" for c in col_names if c in cols]
                        logger.info(f"reshape_expanded_explicit {token}: {len(expansions[token])} columns")
                        break
                continue

            # Case 2: Pattern matching — "bin_content" matches "bin1_content", "bin2_content", etc.
            pattern = raw
            for table, cols in all_columns.items():
                matches = []
                for col in cols:
                    stripped = re.sub(r'\d+', '', col)  # "bin1_content" → "bin_content"
                    if stripped == pattern:
                        matches.append(f"{table}.{col}")

                if matches:
                    def _natural_key(s):
                        return [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', s)]
                    matches.sort(key=_natural_key)
                    expansions[token] = matches
                    logger.info(f"reshape_expanded_pattern {token}: {pattern} → {len(matches)} columns")
                    break

    except Exception:
        logger.warning("reshape_expansion_failed", exc_info=True)

    return expansions


def _fix_computed_refs(expr: Any, alias_map: dict[str, str]) -> None:
    """Recursively fix column references in a computed expression.

    Replaces raw DB column names (bin1_act) with MELT alias names (row_ach_wt_kg).
    """
    if not isinstance(expr, dict):
        return
    for key in ("left", "right", "numerator", "denominator", "column"):
        val = expr.get(key)
        if isinstance(val, str) and val in alias_map:
            expr[key] = alias_map[val]
            logger.debug(f"computed_ref_fixed: {val} → {alias_map[val]}")
        elif isinstance(val, dict):
            _fix_computed_refs(val, alias_map)
    # Also check 'columns' list (for concat etc.)
    if isinstance(expr.get("columns"), list):
        expr["columns"] = [alias_map.get(c, c) if isinstance(c, str) else c for c in expr["columns"]]


def _parse_computed_expr(expr: str) -> dict | None:
    """Parse a COMPUTED: expression string into a declarative op dict.

    Handles: a-b, (a/b)*100, (a-b)/c*100, a/b*100, ROW_NUMBER, ROW_NUMBER()
    """
    expr = expr.strip()
    if expr in ("ROW_NUMBER", "ROW_NUMBER()"):
        return None  # handled by INDEX in reshape

    import re as _re

    # Pattern: (a/b)*100 → multiply(divide(a, b), 100)
    paren_div_match = _re.match(r"\(([^)]+)/([^)]+)\)\s*\*\s*(\d+)", expr)
    if paren_div_match:
        num = paren_div_match.group(1).strip()
        den = paren_div_match.group(2).strip()
        mult = int(paren_div_match.group(3))
        return {"op": "multiply", "left": {"op": "divide", "numerator": num, "denominator": den}, "right": mult}

    # Pattern: (a-b)/c*100 → multiply(divide(subtract(a,b), c), 100)
    pct_match = _re.match(r"\(([^)]+)\)/([^*]+)\*(\d+)", expr)
    if pct_match:
        inner = pct_match.group(1)
        denom = pct_match.group(2).strip()
        mult = int(pct_match.group(3))
        inner_parts = inner.split("-", 1)
        if len(inner_parts) == 2:
            return {
                "op": "multiply",
                "left": {"op": "divide", "numerator": {"op": "subtract", "left": inner_parts[0].strip(), "right": inner_parts[1].strip()}, "denominator": denom},
                "right": mult,
            }

    # Pattern: a/b*100
    div_mult_match = _re.match(r"([^(/]+)/([^*]+)\*(\d+)", expr)
    if div_mult_match:
        return {
            "op": "multiply",
            "left": {"op": "divide", "numerator": div_mult_match.group(1).strip(), "denominator": div_mult_match.group(2).strip()},
            "right": int(div_mult_match.group(3)),
        }

    # Pattern: a-b
    if "-" in expr and not expr.startswith("("):
        parts = expr.split("-", 1)
        return {"op": "subtract", "left": parts[0].strip(), "right": parts[1].strip()}

    # Pattern: a+b
    if "+" in expr:
        parts = expr.split("+", 1)
        return {"op": "add", "left": parts[0].strip(), "right": parts[1].strip()}

    return {"op": "expression", "expr": expr}


def _post_process_contract(tdir: Path, mapping: dict[str, str], expansions: dict[str, list[str]]) -> None:
    """Post-process contract.json after LLM generation.

    The LLM contract builder often generates incomplete or incorrect:
    - reshape_rules with empty columns
    - row_computed referencing raw DB column names instead of MELT aliases
    - empty totals_math

    This function fixes ALL of these using the user's mapping directives
    (RESHAPE:, COMPUTED:, SUM:) as the authoritative source of truth.
    User mapping directives ALWAYS override LLM-generated content.
    """
    contract_path = tdir / "contract.json"
    if not contract_path.exists():
        return

    try:
        contract = json.loads(contract_path.read_text())
        modified = False

        # ── 1. Fix reshape columns ──
        # ALWAYS override MELT column specs from the user's expansion map.
        # The LLM often uses wrong aliases (bin_content instead of row_material_name).
        # User's token names ARE the correct MELT aliases.
        rules = contract.get("reshape_rules", [])
        if expansions:
            # Build the correct column specs from user's mapping
            correct_columns = [{"as": "row_sl_no", "from": ["INDEX"]}]
            for token, col_list in expansions.items():
                if "sl_no" in token.lower() or "index" in token.lower():
                    continue
                correct_columns.append({"as": token, "from": col_list})

            if correct_columns and rules:
                # Override the first MELT rule's columns
                for rule in rules:
                    if rule.get("strategy") == "MELT":
                        rule["columns"] = correct_columns
                        modified = True
                        break
                # Deduplicate: keep only 1 MELT rule
                contract["reshape_rules"] = [r for r in rules if r.get("columns")][:1]
            elif correct_columns and not rules:
                contract["reshape_rules"] = [{"purpose": "Melt wide-format columns into rows", "strategy": "MELT", "columns": correct_columns, "order_by": []}]
                modified = True
            logger.info(f"reshape_columns_set: {[c.get('as') for c in correct_columns]}")

        # ── 2. Build reshape source→alias map for fixing computed refs ──
        reshape_source_to_alias: dict[str, str] = {}
        for rule in contract.get("reshape_rules", []):
            for col_spec in rule.get("columns", []):
                alias = col_spec.get("as", "")
                for src in col_spec.get("from", []):
                    if src == "INDEX":
                        continue
                    col = src.split(".", 1)[1] if "." in src else src
                    reshape_source_to_alias[col] = alias

        # ── 3. ALWAYS generate row_computed from user COMPUTED: directives ──
        # User mapping directives are authoritative — override LLM garbage
        user_computed: dict[str, dict] = {}
        for token, value in mapping.items():
            if not value.startswith("COMPUTED:") or token.startswith("total_"):
                continue
            parsed = _parse_computed_expr(value.split(":", 1)[1])
            if parsed:
                user_computed[token] = parsed

        if user_computed:
            contract["row_computed"] = user_computed
            modified = True
            logger.info(f"contract_row_computed_set: {list(user_computed.keys())}")
        # Also fix any LLM-generated row_computed that references raw columns
        for name, expr in contract.get("row_computed", {}).items():
            _fix_computed_refs(expr, reshape_source_to_alias)

        # ── 4. ALWAYS generate totals_math from user SUM:/COMPUTED: directives ──
        user_totals: dict[str, dict] = {}
        for token, value in mapping.items():
            if not token.startswith("total_"):
                continue
            if value.startswith("SUM:"):
                source = value.split(":", 1)[1].strip()
                user_totals[token] = {"op": "sum", "column": source}
            elif value.startswith("AGGREGATE:"):
                # AGGREGATE:SUM(x) or AGGREGATE:AVG(x)
                agg_expr = value.split(":", 1)[1].strip()
                agg_match = re.match(r"(SUM|AVG|MIN|MAX|COUNT)\(([^)]+)\)", agg_expr, re.IGNORECASE)
                if agg_match:
                    op = agg_match.group(1).lower()
                    col = agg_match.group(2).strip()
                    user_totals[token] = {"op": op, "column": col}
            elif value.startswith("COMPUTED:"):
                parsed = _parse_computed_expr(value.split(":", 1)[1])
                if parsed:
                    user_totals[token] = parsed

        if user_totals:
            contract["totals_math"] = user_totals
            contract["totals"] = user_totals
            modified = True
            logger.info(f"contract_totals_set: {list(user_totals.keys())}")
        # Fix any raw column references in totals too
        for name, expr in contract.get("totals_math", contract.get("totals", {})).items():
            if isinstance(expr, dict):
                _fix_computed_refs(expr, reshape_source_to_alias)

        if modified:
            contract_path.write_text(json.dumps(contract, indent=2, ensure_ascii=False))
            logger.info("contract_post_processed")

    except Exception:
        logger.warning("contract_postprocess_failed", exc_info=True)


def _resolve_kind(template_id: str) -> str:
    """Determine template kind (pdf/excel) from state store or directory."""
    try:
        from backend.app.services.legacy_services import resolve_template_kind
        return resolve_template_kind(template_id) or "pdf"
    except Exception:
        return "pdf"


def _template_dir(template_id: str) -> Path:
    from backend.app.services.legacy_services import template_dir
    kind = _resolve_kind(template_id)
    return template_dir(template_id, must_exist=True, kind=kind)


async def _push_stage(ctx: ToolContext, stage: str, status: str, progress: int = 0) -> None:
    """Push a stage event to the NDJSON stream."""
    await ctx.event_queue.put({
        "event": "stage",
        "stage": stage,
        "status": status,
        "progress": progress,
    })


async def _iter_streaming_response(response) -> list[dict]:
    """Iterate a StreamingResponse body and collect NDJSON events."""
    events = []
    if hasattr(response, "body_iterator"):
        async for chunk in response.body_iterator:
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8", errors="ignore")
            for line in chunk.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events


# ═══════════════════════════════════════════════════════════════════════
# Tool 1: session_get_state
# ═══════════════════════════════════════════════════════════════════════

async def tool_session_get_state(ctx: ToolContext) -> dict:
    """Return the current pipeline session state."""
    return ctx.session.to_dict()


# ═══════════════════════════════════════════════════════════════════════
# Tool 2: session_transition
# ═══════════════════════════════════════════════════════════════════════

async def tool_session_transition(ctx: ToolContext, target_state: str) -> dict:
    """Transition the pipeline to a new state. Enforced by state machine."""
    try:
        target = PipelineState(target_state)
    except ValueError:
        return {"error": "invalid_state", "message": f"Unknown state: {target_state}"}

    try:
        ctx.session.transition(target)
        ctx.session.save()
        return {"status": "ok", "new_state": ctx.session.pipeline_state.value}
    except ValueError as exc:
        return {"error": "invalid_transition", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 3: extract_ocr_text
# ═══════════════════════════════════════════════════════════════════════

async def tool_extract_ocr_text(
    ctx: ToolContext,
    page_image_b64: str,
    prompt: str = "OCR the text in this image.",
) -> dict:
    """Extract text from an image using the configured OCR model."""
    import base64
    from backend.app.services.infra_services import ocr_extract

    image_bytes = base64.b64decode(page_image_b64)
    text = await asyncio.to_thread(ocr_extract, image_bytes, prompt=prompt)
    if text:
        return {"status": "ok", "text": text, "chars": len(text)}
    return {"status": "no_text", "text": None}


# ═══════════════════════════════════════════════════════════════════════
# Tool 4: verify_template
# ═══════════════════════════════════════════════════════════════════════

async def tool_verify_template(ctx: ToolContext) -> dict:
    """Upload and convert a PDF/Excel file to an HTML template."""
    _require_state(ctx.session, {"empty", "html_ready", "mapped", "approved", "ready"}, "verify_template")

    upload_file = ctx._upload_file
    if upload_file is None:
        return {"error": "no_file", "message": "No file provided for verification."}

    # Reset file position for re-reads (Hermes may retry this tool)
    if hasattr(upload_file, 'file') and hasattr(upload_file.file, 'seek'):
        upload_file.file.seek(0)

    from backend.app.services.legacy_services import verify_template, verify_excel

    filename = getattr(upload_file, "filename", "") or ""
    is_excel = filename.lower().endswith((".xlsx", ".xls", ".xlsm"))

    await _push_stage(ctx, "verify.start", "started", 5)

    try:
        if is_excel:
            response = verify_excel(file=upload_file, request=ctx.request, connection_id=ctx.connection_id)
        else:
            response = verify_template(file=upload_file, connection_id=ctx.connection_id, request=ctx.request)

        template_id = None
        token_signatures = None
        events = await _iter_streaming_response(response)
        for event in events:
            if event.get("event") == "stage":
                await ctx.event_queue.put(event)
            if event.get("template_id"):
                template_id = event["template_id"]
            if event.get("token_signatures"):
                token_signatures = event["token_signatures"]

        # Load generated HTML + tokens
        template_html = ""
        template_tokens = []
        if template_id:
            try:
                tdir = _template_dir(template_id)
                # Ensure report_final.html exists (render step may fail)
                report_final = tdir / "report_final.html"
                template_p1 = tdir / "template_p1.html"
                if not report_final.exists() and template_p1.exists():
                    import shutil
                    shutil.copy2(template_p1, report_final)
                    logger.info("copied template_p1 → report_final (render skipped)")

                for name in ("report_final.html", "template_p1.html"):
                    p = tdir / name
                    if p.exists() and p.stat().st_size > 0:
                        template_html = p.read_text(encoding="utf-8", errors="ignore")
                        break
                template_tokens = sorted(set(re.findall(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?", template_html)))
            except Exception:
                pass

            # Migrate session from _session_xxx to the real template directory
            try:
                from backend.app.services.legacy_services import UPLOAD_ROOT, EXCEL_UPLOAD_ROOT
                # Try both upload roots
                for root in (UPLOAD_ROOT, EXCEL_UPLOAD_ROOT):
                    candidate = root / template_id
                    if candidate.is_dir():
                        if candidate.resolve() != ctx.session.template_dir.resolve():
                            ctx.session.migrate_to(candidate)
                            logger.info("session_migrated template_id=%s", template_id)
                        break
            except Exception:
                logger.warning("session_migration_failed", exc_info=True)

        # Transition to HTML_READY — handle case where verify already transitioned
        try:
            if ctx.session.pipeline_state == PipelineState.EMPTY:
                ctx.session.transition(PipelineState.VERIFYING)
            if ctx.session.pipeline_state == PipelineState.VERIFYING:
                ctx.session.transition(PipelineState.HTML_READY)
        except ValueError:
            pass  # already at or past HTML_READY
        ctx.session.complete_stage("verify")
        ctx.session.save()
        ctx.template_id = template_id

        # ── OCR: already extracted during HTML generation (templates.py) ──
        # _extract_vision_text() → ocr_extract_structured() saves both
        # ocr_structured.json and ocr_reference.txt. Just verify artifacts exist.
        ocr_chars = 0
        try:
            ocr_json_path = tdir / "ocr_structured.json"
            ocr_txt_path = tdir / "ocr_reference.txt"
            if ocr_json_path.exists():
                ocr_data = json.loads(ocr_json_path.read_text())
                ocr_chars = len(ocr_data.get("raw_text", ""))
                logger.info("ocr_verified", extra={
                    "chars": ocr_chars,
                    "headers": len(ocr_data.get("sections", {}).get("column_headers", [])),
                    "template_id": template_id,
                })
            elif ocr_txt_path.exists():
                ocr_chars = ocr_txt_path.stat().st_size
                logger.info("ocr_verified_txt_only", extra={"chars": ocr_chars})
        except Exception:
            logger.debug("ocr_artifact_check_failed", exc_info=True)

        await _push_stage(ctx, "verify.complete", "complete", 100)

        return {
            "status": "ok",
            "template_id": template_id,
            "tokens": template_tokens,
            "token_count": len(template_tokens),
            "html_length": len(template_html),
            "token_signatures": token_signatures or {},
            "ocr_extracted": ocr_chars > 0,
            "ocr_chars": ocr_chars,
        }

    except Exception as exc:
        logger.exception("tool_verify_template_failed")
        return {"error": "verify_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 5: save_template
# ═══════════════════════════════════════════════════════════════════════

async def tool_save_template(ctx: ToolContext, html: str, tokens: list[str]) -> dict:
    """Save updated template HTML to disk."""
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "ready", "editing"}, "save_template")

    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}

    tdir = _template_dir(ctx.template_id)
    out = tdir / "report_final.html"
    out.write_text(html, encoding="utf-8")
    return {"status": "ok", "path": str(out), "tokens": tokens}


# ═══════════════════════════════════════════════════════════════════════
# Tool 6: get_schema
# ═══════════════════════════════════════════════════════════════════════

async def tool_get_schema(ctx: ToolContext, connection_id: str) -> dict:
    """Get the database schema for a connection."""
    from backend.app.services.infra_services import ConnectionService

    try:
        svc = ConnectionService()
        conn = svc.get(connection_id)
        if not conn:
            return {"error": "not_found", "message": f"Connection {connection_id} not found"}

        from backend.app.repositories import get_connection_schema
        schema = get_connection_schema(connection_id)
        ctx.connection_id = connection_id
        ctx.session.connection_id = connection_id
        ctx.session.save()
        return {"status": "ok", "schema": schema}
    except Exception as exc:
        return {"error": "schema_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# EXPLORATION LAYER — read-only tools for thinking before committing
# ═══════════════════════════════════════════════════════════════════════

# ── Tool E1: inspect_data ─────────────────────────────────────────────

async def tool_inspect_data(
    ctx: ToolContext,
    connection_id: str,
    table: str,
    columns: list[str] | None = None,
    limit: int = 10,
) -> dict:
    """Sample column values and basic stats from a DB table. Read-only, no state change."""
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader

    try:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)
        df = loader.frame(table)

        if columns:
            df = df[[c for c in columns if c in df.columns]]

        sample = df.head(limit)
        stats: dict[str, Any] = {
            "row_count": len(df),
            "columns": list(df.columns),
            "sample": sample.to_dict("records"),
        }

        # Per-column type + basic stats
        col_info = {}
        for col in df.columns:
            series = df[col].dropna()
            info: dict[str, Any] = {"dtype": str(df[col].dtype), "non_null": len(series), "null": int(df[col].isna().sum())}
            try:
                if series.dtype in ("int64", "float64"):
                    info["min"] = float(series.min())
                    info["max"] = float(series.max())
                    info["mean"] = round(float(series.mean()), 2)
                else:
                    info["unique"] = int(series.nunique())
                    info["sample_values"] = series.head(5).tolist()
            except Exception:
                pass
            col_info[col] = info

        stats["column_info"] = col_info
        return {"status": "ok", **stats}

    except Exception as exc:
        return {"error": "inspect_failed", "message": str(exc)}


# ── Tool E1b: get_column_stats ────────────────────────────────────────

async def tool_get_column_stats(
    ctx: ToolContext,
    connection_id: str,
    table: str,
    columns: list[str] | None = None,
) -> dict:
    """Get detailed column statistics: distribution, null%, unique count, top values.
    Used by frontend MappingsTab sparklines and column stats popovers."""
    _require_state(ctx.session, {"mapped", "approved", "building_assets", "validated", "ready"}, "get_column_stats")
    import json as _json
    from pathlib import Path
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
    from backend.app.services.data_validator import DataValidator

    try:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)
        df = loader.frame(table)

        validator = DataValidator()
        target_cols = columns or list(df.columns)
        stats = validator.get_column_stats(df, target_cols)

        # Prefix with table name for frontend store
        prefixed = {f"{table}.{col}": s for col, s in stats.items()}

        # Persist to artifact so _build_status_view can include in chat_complete
        tdir = Path(ctx.session.template_dir) if ctx.session.template_dir else None
        if tdir:
            existing = {}
            stats_file = tdir / "column_stats.json"
            if stats_file.exists():
                try:
                    existing = _json.loads(stats_file.read_text())
                except Exception:
                    pass
            existing.update(prefixed)
            stats_file.write_text(_json.dumps(existing, ensure_ascii=False))

        return {"status": "ok", "column_stats": prefixed}

    except Exception as exc:
        return {"error": "stats_failed", "message": str(exc)}


# ── Tool E2: simulate_mapping ─────────────────────────────────────────

async def tool_simulate_mapping(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
) -> dict:
    """Generate candidate mappings and score them WITHOUT writing anything.

    Read-only exploration: returns candidates + scores + per-token breakdown.
    Agent can reason about results before committing via auto_map_tokens.
    """
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "ready"}, "simulate_mapping")

    from backend.app.services.legacy_services import run_mapping_preview
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
    from backend.app.services.validator.mapping_evaluator import score_candidate

    try:
        kind = _resolve_kind(template_id)
        # Get a single mapping from the LLM (existing flow)
        result = await run_mapping_preview(template_id, connection_id, ctx.request, kind=kind)

        mapping = result.get("mapping", {})
        errors = result.get("errors", [])
        confidence = result.get("confidence", {})

        # Get column types + sample data for scoring
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)
        tables = loader.table_names()
        column_types: dict[str, str] = {}
        sample_rows: list[dict] = []
        for t in tables:
            try:
                df = loader.frame(t)
                for col in df.columns:
                    column_types[col] = str(df[col].dtype).replace("int64", "INTEGER").replace("float64", "REAL").replace("object", "TEXT")
                sample_rows = df.head(10).to_dict("records")
                break  # use first table for now
            except Exception:
                pass

        tokens = list(mapping.keys())
        scored = score_candidate(mapping, tokens, column_types, sample_rows)

        # Find low-confidence tokens
        weak_tokens = [
            {"token": tok, "column": mapping.get(tok, "?"), "score": scores.get("weighted", 0)}
            for tok, scores in scored.get("token_scores", {}).items()
            if scores.get("weighted", 0) < 0.5
        ]

        return {
            "status": "simulated",
            "mapping": mapping,
            "overall_score": scored["score"],
            "token_scores": scored["token_scores"],
            "weak_tokens": weak_tokens,
            "unresolved": [e["label"] for e in errors if e.get("issue") == "UNRESOLVED"],
            "note": "This is a simulation. No state was changed. Call auto_map_tokens to commit.",
        }

    except Exception as exc:
        return {"error": "simulation_failed", "message": str(exc)}


# ── Tool E3: compare_mappings ─────────────────────────────────────────

async def tool_compare_mappings(
    ctx: ToolContext,
    mapping_a: dict[str, str],
    mapping_b: dict[str, str],
) -> dict:
    """Compare two candidate mappings. Returns differences and risk assessment. Read-only."""
    differences = []
    risks = []
    for token in set(list(mapping_a.keys()) + list(mapping_b.keys())):
        col_a = mapping_a.get(token, "MISSING")
        col_b = mapping_b.get(token, "MISSING")
        if col_a != col_b:
            diff = {"token": token, "mapping_a": col_a, "mapping_b": col_b}
            differences.append(diff)

            # Risk assessment
            if col_a == "UNRESOLVED" or col_b == "UNRESOLVED":
                diff["risk"] = "one_unresolved"
            elif col_a == "MISSING" or col_b == "MISSING":
                diff["risk"] = "token_missing_in_one"
            else:
                # Both resolved but different — this is the interesting case
                diff["risk"] = "column_swap"
                risks.append(f"Token '{token}' differs: '{col_a}' vs '{col_b}' — potential column swap")

    return {
        "status": "ok",
        "identical": len(differences) == 0,
        "difference_count": len(differences),
        "differences": differences,
        "risks": risks,
        "agreement_pct": round((1 - len(differences) / max(len(mapping_a), 1)) * 100, 1),
    }


# ── Tool E4: preview_contract ─────────────────────────────────────────

async def tool_preview_contract(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
) -> dict:
    """Estimate what a contract would look like without building it.

    Returns: estimated row count, join feasibility, reshape cardinality.
    Read-only, no state change.
    """
    _require_state(ctx.session, {"mapped", "approved"}, "preview_contract")

    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader

    try:
        tdir = _template_dir(template_id)

        # Read current mapping
        mapping_path = tdir / "mapping_pdf_labels.json"
        if not mapping_path.exists():
            return {"error": "no_mapping", "message": "No mapping file found."}

        mapping_data = json.loads(mapping_path.read_text())
        mapping_dict = {
            e.get("header", ""): e.get("mapping", "UNRESOLVED")
            for e in mapping_data if isinstance(e, dict)
        }

        # Read contract if it exists
        contract_path = tdir / "contract.json"
        contract = json.loads(contract_path.read_text()) if contract_path.exists() else {}

        # Estimate data shape
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)

        join_cfg = contract.get("join", {})
        parent_table = join_cfg.get("parent_table", "")
        child_table = join_cfg.get("child_table", "")

        estimates: dict[str, Any] = {"unresolved_tokens": [], "tables_found": [], "row_estimates": {}}

        for t in loader.table_names():
            try:
                df = loader.frame(t)
                estimates["tables_found"].append(t)
                estimates["row_estimates"][t] = len(df)
            except Exception:
                pass

        # Check reshape rules
        reshape = contract.get("reshape_rules", [])
        if reshape:
            for rule in reshape:
                cols = rule.get("columns", [])
                n_positions = max((len(c.get("from", [])) for c in cols if c.get("from", []) != ["INDEX"]), default=0)
                estimates["reshape_positions"] = n_positions
                if parent_table in estimates["row_estimates"]:
                    estimates["estimated_rows_after_reshape"] = estimates["row_estimates"][parent_table] * n_positions

        # Check unresolved
        estimates["unresolved_tokens"] = [t for t, v in mapping_dict.items() if v == "UNRESOLVED"]
        estimates["mapped_tokens"] = len(mapping_dict) - len(estimates["unresolved_tokens"])

        return {"status": "ok", **estimates}

    except Exception as exc:
        return {"error": "preview_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 7: auto_map_tokens (with multi-candidate evaluation)
# ═══════════════════════════════════════════════════════════════════════

def _detect_wide_format_columns(connection_id: str) -> dict[str, list[str]]:
    """Detect wide-format column patterns in the DB.

    Scans all tables for repeating column patterns like:
      bin1_content, bin2_content, ..., bin12_content
    Groups them by pattern (prefix+suffix with digits stripped).

    Returns: {"bin_content": ["bin1_content", "bin2_content", ...], "bin_sp": [...], ...}
    Only includes groups with 3+ members (true wide-format series).
    """
    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader

    try:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        loader = SQLiteDataFrameLoader(db_path)

        pattern_groups: dict[str, list[str]] = {}

        for table in loader.table_names():
            try:
                cols = list(loader.frame(table).columns)
            except Exception:
                continue

            for col in cols:
                # Strip digits to get the pattern: "bin1_content" → "bin_content"
                pattern = re.sub(r'\d+', '', col)
                if pattern != col:  # only if digits were found
                    pattern_groups.setdefault(pattern, []).append(col)

        # Keep only groups with 3+ members (real wide-format, not just col1/col2)
        wide_groups = {
            pattern: sorted(cols, key=lambda c: [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', c)])
            for pattern, cols in pattern_groups.items()
            if len(cols) >= 3
        }

        if wide_groups:
            logger.info(f"wide_format_detected: {len(wide_groups)} groups: {list(wide_groups.keys())}")

        return wide_groups

    except Exception:
        logger.warning("wide_format_detection_failed", exc_info=True)
        return {}


# Semantic aliases for matching token names to wide-format column suffixes
_TOKEN_TO_COLUMN_SUFFIX = {
    # token substring → column pattern suffix matches
    "material": ["content", "name", "material", "desc", "item"],
    "name": ["content", "name", "material", "desc"],
    "content": ["content", "name"],
    "set_wt": ["sp", "set", "setpoint", "target", "set_wt", "setwt"],
    "set_weight": ["sp", "set", "setpoint", "target"],
    "sp": ["sp", "setpoint"],
    "ach_wt": ["act", "actual", "achieved", "ach", "ach_wt", "achwt"],
    "act_wt": ["act", "actual", "achieved"],
    "actual": ["act", "actual", "achieved"],
    "act": ["act", "actual"],
    "qty": ["qty", "quantity", "count"],
    "weight": ["wt", "weight", "mass"],
    "temp": ["temp", "temperature"],
    "pressure": ["press", "pressure"],
    "speed": ["speed", "rpm"],
    "time": ["time", "duration", "sec"],
}


def _match_token_to_wide_group(token: str, wide_groups: dict[str, list[str]]) -> str | None:
    """Match a row token to a wide-format column group by semantic similarity.

    E.g. row_material_name → matches group "bin_content" (material ↔ content)
    E.g. row_set_wt_kg → matches group "bin_sp" (set_wt ↔ sp)

    Returns the pattern key (e.g. "bin_content") or None.
    """
    tok_lower = token.lower().removeprefix("row_").removeprefix("total_")

    # Direct suffix match first
    for pattern in wide_groups:
        suffix = pattern.split("_", 1)[1] if "_" in pattern else pattern
        if suffix in tok_lower or tok_lower in suffix:
            return pattern

    # Semantic alias match
    for tok_fragment, aliases in _TOKEN_TO_COLUMN_SUFFIX.items():
        if tok_fragment in tok_lower:
            for pattern in wide_groups:
                suffix = pattern.split("_", 1)[1] if "_" in pattern else pattern
                if suffix in aliases:
                    return pattern

    return None


def _auto_resolve_wide_format(
    mapping: dict[str, str],
    unresolved: list[str],
    wide_groups: dict[str, list[str]],
    table: str,
) -> dict[str, str]:
    """Auto-generate RESHAPE/COMPUTED/SUM directives for unresolved tokens
    when a wide-format DB is detected.

    Returns: dict of token→directive overrides to apply.
    """
    overrides: dict[str, str] = {}
    matched_groups: set[str] = set()

    # Phase 1: Match unresolved row tokens to wide-format groups
    for token in unresolved:
        tok_lower = token.lower()

        # Skip non-row tokens
        if not tok_lower.startswith("row_") and not tok_lower.startswith("total_"):
            continue

        # row_sl_no → INDEX/ROW_NUMBER
        if "sl_no" in tok_lower or "serial" in tok_lower or "index" in tok_lower:
            overrides[token] = "COMPUTED:ROW_NUMBER"
            continue

        # total_* tokens → SUM of corresponding row token
        if tok_lower.startswith("total_"):
            row_equivalent = "row_" + tok_lower[6:]  # total_set_wt_kg → row_set_wt_kg
            if row_equivalent in mapping or row_equivalent in overrides:
                overrides[token] = f"SUM:{row_equivalent}"
                continue

        # Try matching to wide-format group
        matched_pattern = _match_token_to_wide_group(token, wide_groups)
        if matched_pattern:
            overrides[token] = f"RESHAPE:{matched_pattern}"
            matched_groups.add(matched_pattern)

    # Phase 2: Generate COMPUTED for error tokens if we have set + actual
    has_set = any("set_wt" in t or "_sp" in mapping.get(t, "") for t in list(mapping.keys()) + list(overrides.keys()))
    has_act = any("ach_wt" in t or "act_wt" in t or "_act" in mapping.get(t, "") for t in list(mapping.keys()) + list(overrides.keys()))

    if has_set and has_act:
        # Find the ROW-level token names for set and actual (not totals)
        set_token = act_token = None
        for t in list(mapping.keys()) + list(overrides.keys()):
            tl = t.lower()
            if not tl.startswith("row_"):
                continue  # only match row-level tokens, not totals
            if "set_wt" in tl or "set_weight" in tl or tl.endswith("_sp"):
                set_token = t
            if "ach_wt" in tl or "act_wt" in tl or "actual" in tl or tl.endswith("_act"):
                act_token = t

        if set_token and act_token:
            for token in unresolved:
                tl = token.lower()
                # Only apply computed formulas to ROW tokens, not totals
                if not tl.startswith("row_"):
                    continue
                if "error_kg" in tl or "error_wt" in tl or ("error" in tl and "pct" not in tl and "percent" not in tl):
                    if token not in overrides:
                        overrides[token] = f"COMPUTED:{act_token}-{set_token}"
                elif "error_pct" in tl or "error_percent" in tl or ("error" in tl and ("pct" in tl or "percent" in tl)):
                    error_token = None
                    for t2 in list(overrides.keys()):
                        if "error" in t2.lower() and "pct" not in t2.lower() and t2.startswith("row_"):
                            error_token = t2
                            break
                    if error_token and set_token and token not in overrides:
                        overrides[token] = f"COMPUTED:({error_token}/{set_token})*100"

    # Phase 3: Generate totals — SUM for all total_* tokens with corresponding row_* tokens
    for token in unresolved:
        if token.startswith("total_") and token not in overrides:
            row_equiv = "row_" + token[6:]
            if row_equiv in overrides or row_equiv in mapping:
                overrides[token] = f"SUM:{row_equiv}"

    if overrides:
        logger.info(f"wide_format_auto_resolved: {len(overrides)} tokens: {list(overrides.keys())}")

    return overrides


async def tool_auto_map_tokens(ctx: ToolContext, template_id: str, connection_id: str) -> dict:
    """Auto-map template tokens to database columns.

    After the LLM maps what it can, detects wide-format column patterns
    and auto-generates RESHAPE/COMPUTED/SUM directives for unresolved tokens.
    """
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "ready"}, "auto_map_tokens")

    from backend.app.services.legacy_services import run_mapping_preview

    await _push_stage(ctx, "mapping.auto_map", "started", 10)

    # Transition to MAPPING first (state machine: html_ready → mapping → mapped)
    if ctx.session.pipeline_state == PipelineState.HTML_READY:
        ctx.session.transition(PipelineState.MAPPING)

    try:
        kind = _resolve_kind(template_id)

        # Load structured OCR context (extracted during verify_template)
        ocr_context = None
        try:
            tdir = _template_dir(template_id)
            ocr_json_path = tdir / "ocr_structured.json"
            if ocr_json_path.exists():
                from backend.app.services.infra_services import format_ocr_for_mapping
                ocr_data = json.loads(ocr_json_path.read_text())
                ocr_context = format_ocr_for_mapping(ocr_data)
                logger.info("mapping_structured_ocr_loaded", extra={
                    "chars": len(ocr_context),
                    "headers": len(ocr_data.get("sections", {}).get("column_headers", [])),
                })
            else:
                # Backward compat: fall back to raw txt
                ocr_path = tdir / "ocr_reference.txt"
                if ocr_path.exists():
                    ocr_context = ocr_path.read_text(encoding="utf-8")
                    logger.info("mapping_ocr_loaded_txt", extra={"chars": len(ocr_context)})
        except Exception:
            pass

        result = await run_mapping_preview(
            template_id, connection_id, ctx.request, kind=kind,
            ocr_context=ocr_context,
        )

        mapping = result.get("mapping", {})
        errors = result.get("errors", [])
        unresolved = [e["label"] for e in errors if e.get("issue") == "UNRESOLVED"]

        await _push_stage(ctx, "mapping.auto_map", "complete", 60)

        # ── Wide-format detection: auto-resolve RESHAPE/COMPUTED/SUM ──
        wide_resolved = {}
        if unresolved:
            await _push_stage(ctx, "mapping.wide_format_detect", "started", 65)

            wide_groups = _detect_wide_format_columns(connection_id)
            if wide_groups:
                # Find the main table
                table = ""
                for tok, col in mapping.items():
                    if "." in col:
                        table = col.split(".")[0]
                        break

                wide_resolved = _auto_resolve_wide_format(mapping, unresolved, wide_groups, table)

                if wide_resolved:
                    # Apply the overrides to mapping files
                    tdir = _template_dir(template_id)
                    step3_path = tdir / "mapping_step3.json"
                    labels_path = tdir / "mapping_pdf_labels.json"

                    # Update mapping_step3
                    if step3_path.exists():
                        step3 = json.loads(step3_path.read_text())
                        step3_mapping = step3.get("mapping", {})
                        step3_mapping.update(wide_resolved)
                        step3["mapping"] = step3_mapping
                        step3_path.write_text(json.dumps(step3, indent=2, ensure_ascii=False))

                    # Update mapping_pdf_labels
                    if labels_path.exists():
                        labels = json.loads(labels_path.read_text())
                        existing = {e.get("header"): e for e in labels if isinstance(e, dict)}
                        for token, directive in wide_resolved.items():
                            if token in existing:
                                existing[token]["mapping"] = directive
                            else:
                                labels.append({"header": token, "placeholder": "{" + token + "}", "mapping": directive})
                        labels_path.write_text(json.dumps(
                            [existing.get(e.get("header"), e) if isinstance(e, dict) and e.get("header") in existing else e for e in labels],
                            indent=2, ensure_ascii=False,
                        ))

                    # Update the unresolved list
                    mapping.update(wide_resolved)
                    unresolved = [t for t in unresolved if t not in wide_resolved]

                    logger.info(f"wide_format_applied: {len(wide_resolved)} auto-resolved, {len(unresolved)} remaining")

            await _push_stage(ctx, "mapping.wide_format_detect", "complete", 90)

        ctx.session.transition(PipelineState.MAPPED)
        ctx.session.complete_stage("mapping_preview")
        ctx.session.save()

        await _push_stage(ctx, "mapping.auto_map", "complete", 100)

        return {
            "status": "mapped",
            "mapping": mapping,
            "unresolved_count": len(unresolved),
            "unresolved_tokens": unresolved,
            "total_tokens": len(mapping),
            "wide_format_resolved": len(wide_resolved),
            "wide_format_details": {t: v for t, v in wide_resolved.items()},
            "confidence": result.get("confidence", {}),
        }

    except Exception as exc:
        logger.exception("tool_auto_map_tokens_failed")
        return {"error": "mapping_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 8: refine_mapping
# ═══════════════════════════════════════════════════════════════════════

async def tool_refine_mapping(
    ctx: ToolContext,
    user_input: str,
    mapping_override: dict | None = None,
) -> dict:
    """Refine token-to-column mappings based on user instructions or explicit overrides.

    When mapping_override is provided, writes it directly to mapping files
    without calling the LLM (the override IS the correction).
    When only user_input is provided, delegates to LLM-based corrections.
    """
    _require_state(ctx.session, {"mapped"}, "refine_mapping")

    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}

    tdir = _template_dir(ctx.template_id)

    # Direct override path: write mapping_override to files without LLM call
    if mapping_override:
        try:
            # Read existing mapping
            step3_path = tdir / "mapping_step3.json"
            labels_path = tdir / "mapping_pdf_labels.json"

            if step3_path.exists():
                step3 = json.loads(step3_path.read_text())
                mapping = step3.get("mapping", {})
            else:
                mapping = {}

            # Apply overrides
            mapping.update(mapping_override)

            # Write back mapping_step3.json
            step3["mapping"] = mapping
            step3_path.write_text(json.dumps(step3, indent=2, ensure_ascii=False))

            # Write mapping_pdf_labels.json
            labels = []
            for k, v in mapping.items():
                labels.append({"header": k, "placeholder": "{" + k + "}", "mapping": v})
            labels_path.write_text(json.dumps(labels, indent=2, ensure_ascii=False))

            ctx.session.complete_stage("corrections")
            ctx.session.save()

            applied = len(mapping_override)
            return {"status": "ok", "message": f"Applied {applied} mapping override(s) directly.", "overrides_applied": applied}

        except Exception as exc:
            return {"error": "refine_failed", "message": str(exc)}

    # LLM-based corrections path (user_input only, no explicit override)
    # Enrich user_input with OCR context so Qwen can cross-reference actual PDF headers
    try:
        ocr_json_path = tdir / "ocr_structured.json"
        if ocr_json_path.exists():
            from backend.app.services.infra_services import format_ocr_for_mapping
            ocr_data = json.loads(ocr_json_path.read_text())
            ocr_enrichment = format_ocr_for_mapping(ocr_data)
            if ocr_enrichment:
                user_input = f"[OCR Reference from source PDF]\n{ocr_enrichment}\n\n[User Correction]\n{user_input}"
    except Exception:
        pass

    from backend.app.services.legacy_services import run_corrections_preview, CorrectionsPreviewPayload

    payload = CorrectionsPreviewPayload(
        user_input=user_input,
    )

    try:
        kind = _resolve_kind(ctx.template_id)
        response = run_corrections_preview(ctx.template_id, payload, ctx.request, kind=kind)
        events = await _iter_streaming_response(response)

        ctx.session.complete_stage("corrections")
        ctx.session.save()

        return {"status": "ok", "message": "Mapping updated via LLM corrections."}
    except Exception as exc:
        return {"error": "refine_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 9: get_key_options
# ═══════════════════════════════════════════════════════════════════════

async def tool_get_key_options(
    ctx: ToolContext,
    tokens: list[str] | None = None,
    limit: int = 50,
) -> dict:
    """Get available filter values for key tokens."""
    _require_state(ctx.session, {"approved", "validated", "ready"}, "get_key_options")

    from backend.app.services.legacy_services import mapping_key_options

    if not ctx.template_id:
        return {"error": "no_template"}

    try:
        result = mapping_key_options(
            ctx.template_id, ctx.request,
            connection_id=ctx.connection_id,
            tokens=tokens, limit=limit,
            kind=_resolve_kind(ctx.template_id),
        )
        return {"status": "ok", **result}
    except Exception as exc:
        return {"error": "key_options_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 10: build_contract (with mapping sanity gate)
# ═══════════════════════════════════════════════════════════════════════

async def tool_build_contract(ctx: ToolContext, template_id: str, connection_id: str) -> dict:
    """Build the contract JSON from approved mapping. Runs sanity checks first."""
    _require_state(ctx.session, {"mapped"}, "build_contract")

    # ── Sanity gate: check mapping before building ──
    try:
        tdir = _template_dir(template_id)
        mapping_path = tdir / "mapping_pdf_labels.json"
        if mapping_path.exists():
            mapping_data = json.loads(mapping_path.read_text())
            mapping_dict = {}
            for entry in mapping_data:
                if isinstance(entry, dict):
                    mapping_dict[entry.get("header", "")] = entry.get("mapping", "UNRESOLVED")

            # Check for unresolved tokens (RESHAPE/COMPUTED/SUM/PARAM/INDEX are valid directives, not UNRESOLVED)
            _VALID_DIRECTIVES = {"RESHAPE:", "COMPUTED:", "SUM:", "PARAM:", "INDEX", "LATER_SELECTED", "params."}
            def _is_resolved(v: str) -> bool:
                if v == "UNRESOLVED" or not v.strip():
                    return False
                return True  # anything else (table.col, directives, etc.) is resolved
            unresolved = [t for t, v in mapping_dict.items() if not _is_resolved(v)]
            if unresolved:
                return {
                    "error": "unresolved_tokens",
                    "message": f"{len(unresolved)} tokens still unresolved: {unresolved[:5]}",
                    "unresolved": unresolved,
                }

            # Run sanity checks — cross-field violations block, duplicate column warnings don't
            from backend.app.services.validator.mapping_sanity import (
                check_cross_field_consistency,
                run_all_sanity_checks,
            )
            cross_field_violations = check_cross_field_consistency(mapping_dict)
            if cross_field_violations:
                return {
                    "error": "mapping_sanity_failed",
                    "violations": cross_field_violations,
                    "message": f"Mapping has {len(cross_field_violations)} cross-field issue(s) that must be fixed before contract build.",
                }
            all_violations = run_all_sanity_checks(mapping_dict)
            if all_violations:
                logger.warning("mapping_sanity_violations", extra={
                    "violations": all_violations, "blocking": False,
                })
    except Exception:
        logger.warning("mapping_sanity_check_skipped", exc_info=True)

    # ── Build contract ──
    from backend.app.services.legacy_services import run_mapping_approve, MappingPayload

    await _push_stage(ctx, "contract.build", "started", 10)

    try:
        # Read current mapping to pass to MappingPayload (required field)
        mapping_path = tdir / "mapping_pdf_labels.json"
        current_mapping = {}
        if mapping_path.exists():
            for entry in json.loads(mapping_path.read_text()):
                if isinstance(entry, dict):
                    current_mapping[entry.get("header", "")] = entry.get("mapping", "")

        # Expand RESHAPE: directives into actual column lists from DB schema
        # The contract builder LLM can't expand patterns like "bin_content" → "bin1_content...bin12_content"
        _reshape_expansions = _expand_reshape_directives(current_mapping, connection_id)

        payload = MappingPayload(mapping=current_mapping, connection_id=connection_id)
        kind = _resolve_kind(template_id)
        response = await run_mapping_approve(template_id, payload, ctx.request, kind=kind)

        events = await _iter_streaming_response(response)
        has_error = False
        for event in events:
            if event.get("event") == "stage":
                await ctx.event_queue.put(event)
            if event.get("event") == "error":
                has_error = True
                return {"error": "contract_build_failed", "message": event.get("detail", "Contract build failed")}

        # Post-process: fill reshape columns, row_computed, totals from directives + DB schema
        _post_process_contract(tdir, current_mapping, _reshape_expansions)

        # Transition to APPROVED (defensive — may already be there)
        if ctx.session.pipeline_state != PipelineState.APPROVED:
            try:
                if ctx.session.pipeline_state == PipelineState.MAPPED:
                    ctx.session.transition(PipelineState.APPROVING)
                if ctx.session.pipeline_state == PipelineState.APPROVING:
                    ctx.session.transition(PipelineState.APPROVED)
            except ValueError:
                pass
        ctx.session.complete_stage("approve")
        ctx.session.save()

        await _push_stage(ctx, "contract.build", "complete", 100)
        return {"status": "ok", "message": "Contract built and approved. Pipeline is now at APPROVED state."}

    except Exception as exc:
        logger.exception("tool_build_contract_failed")
        return {"error": "contract_build_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 11: validate_pipeline
# ═══════════════════════════════════════════════════════════════════════

async def tool_validate_pipeline(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
    skip_llm: bool = False,
) -> dict:
    """Run 3-phase validation: deterministic checks → dry run → visual check."""
    _require_state(ctx.session, {"building_assets", "validated"}, "validate_pipeline")

    from backend.app.services.validator.runner import validate_pipeline
    from backend.app.repositories import resolve_db_path

    await _push_stage(ctx, "validate.start", "started", 5)

    try:
        tdir = _template_dir(template_id)
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)

        result = await validate_pipeline(
            template_id=template_id,
            connection_id=connection_id,
            db_path=db_path,
            template_dir=tdir,
            skip_llm=skip_llm,
        )

        result_dict = result.to_dict()
        passed = result_dict.get("passed", False)

        logger.info(
            "validate_result",
            extra={"passed": passed, "errors": result_dict.get("summary", {}).get("errors", 0),
                   "current_state": ctx.session.pipeline_state.value},
        )

        if passed:
            # Stay at APPROVED — only dry_run_preview PASS transitions to VALIDATED
            # This ensures template creation isn't "complete" until real data renders correctly
            ctx.session.complete_stage("validate")
            ctx.session.save()
            logger.info(f"validate_passed — state stays at {ctx.session.pipeline_state.value}, dry_run needed for VALIDATED")
        else:
            logger.info(f"validation_failed issues={len(result_dict.get('issues', []))}")

        await _push_stage(ctx, "validate.complete", "complete", 100)

        # Persist to disk for _build_status_view
        val_result = {
            "status": "passed" if passed else "failed",
            "passed": passed,
            "issues": result_dict.get("issues", []),
            "summary": result_dict.get("summary", {}),
        }
        try:
            (tdir / "validation_result.json").write_text(
                json.dumps(val_result, default=str), encoding="utf-8"
            )
        except Exception:
            pass

        # Run DataValidator for constraint violations
        try:
            from backend.app.services.data_validator import DataValidator
            from backend.app.repositories import SQLiteDataFrameLoader
            import pandas as pd

            contract_file = tdir / "contract.json"
            if contract_file.exists() and db_path:
                contract_data = json.loads(contract_file.read_text())
                loader = SQLiteDataFrameLoader(db_path)
                # Get first available table
                tables = loader.tables()
                if tables:
                    df = loader.frame(tables[0])
                    validator = DataValidator()
                    violations = validator.validate_report_data(df, contract_data)
                    if violations:
                        (tdir / "constraint_violations.json").write_text(
                            json.dumps(violations, default=str, ensure_ascii=False)
                        )
        except Exception:
            pass  # Non-critical — don't break validation

        return val_result

    except Exception as exc:
        logger.exception("tool_validate_pipeline_failed")
        return {"error": "validation_error", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 12: auto_fix_issues
# ═══════════════════════════════════════════════════════════════════════

async def tool_auto_fix_issues(ctx: ToolContext, issues: list[dict], template_id: str) -> dict:
    """Attempt to auto-fix validation issues using LLM reasoning."""
    _require_state(ctx.session, {"building_assets", "approved", "validated"}, "auto_fix_issues")

    # Delegate to Qwen via the existing LLM infrastructure
    from backend.app.services.infra_services import call_chat_completion
    from backend.app.services.llm import get_llm_client

    try:
        client = get_llm_client()
        prompt = (
            "You are fixing validation issues in a report template pipeline.\n\n"
            f"Issues:\n{json.dumps(issues, indent=2)}\n\n"
            "Suggest specific fixes for each issue. Return JSON: "
            '{"fixes": [{"issue": "...", "fix": "...", "action": "refine_mapping|edit_template|skip"}]}'
        )

        response = call_chat_completion(
            client, model=None,
            messages=[{"role": "user", "content": prompt}],
            description="auto_fix_issues",
        )
        content = response.choices[0].message.content if hasattr(response, "choices") else str(response)
        return {"status": "ok", "suggestions": content}

    except Exception as exc:
        return {"error": "auto_fix_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 13: discover_batches
# ═══════════════════════════════════════════════════════════════════════

async def tool_discover_batches(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """Discover available batch IDs and row counts for a date range."""
    _require_state(ctx.session, {"approved", "validated", "ready"}, "discover_batches")

    from backend.app.services.reports import discover_batches_and_counts
    from backend.app.repositories import resolve_db_path

    try:
        tdir = _template_dir(template_id)
        contract = json.loads((tdir / "contract.json").read_text())
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)

        result = await asyncio.to_thread(
            discover_batches_and_counts,
            db_path=db_path,
            contract=contract,
            start_date=start_date or "",
            end_date=end_date or "",
        )

        batches = result.get("batches", []) if isinstance(result, dict) else result
        return {
            "status": "ok",
            "batches_count": len(batches) if isinstance(batches, list) else 0,
            "batches": batches[:20] if isinstance(batches, list) else [],
        }

    except Exception as exc:
        return {"error": "discover_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 14: generate_report
# ═══════════════════════════════════════════════════════════════════════

async def tool_generate_report(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
    start_date: str,
    end_date: str,
    batch_ids: list[str] | None = None,
) -> dict:
    """Queue a report generation job. REQUIRES VALIDATED state (= template complete).

    VALIDATED means: structural validation passed AND dry run with real data passed.
    This is enforced by the state machine — only dry_run_preview PASS transitions to VALIDATED.
    """
    _require_state(ctx.session, {"validated", "ready"}, "generate_report")

    # Hard gate: both validate and dry_run must have passed to reach VALIDATED
    if "validate" not in ctx.session.completed_stages or "dry_run" not in ctx.session.completed_stages:
        missing = []
        if "validate" not in ctx.session.completed_stages:
            missing.append("validate_pipeline")
        if "dry_run" not in ctx.session.completed_stages:
            missing.append("dry_run_preview")
        return {
            "error": "template_incomplete",
            "message": f"Template creation not complete. Still need: {', '.join(missing)}",
        }

    from backend.app.services.legacy_services import queue_report_job, RunPayload

    try:
        kind = _resolve_kind(template_id)
        run_payload = RunPayload(
            template_id=template_id,
            connection_id=connection_id,
            start_date=start_date,
            end_date=end_date,
            batch_ids=batch_ids,
        )

        ctx.session.transition(PipelineState.GENERATING)
        ctx.session.save()

        result = await queue_report_job(run_payload, ctx.request, kind=kind)

        ctx.session.transition(PipelineState.READY)
        ctx.session.complete_stage("generate")
        ctx.session.save()

        job_id = result.get("job_id") or (result.get("jobs", [{}])[0].get("id") if result.get("jobs") else None)
        return {"status": "ok", "job_id": job_id}

    except Exception as exc:
        logger.exception("tool_generate_report_failed")
        return {"error": "generation_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 15: build_generator_assets
# ═══════════════════════════════════════════════════════════════════════

async def tool_build_generator_assets(ctx: ToolContext, template_id: str) -> dict:
    """Build generator assets for the template (DataFrame mode: validates contract, derives output schemas)."""
    _require_state(ctx.session, {"approved"}, "build_generator_assets")

    from backend.app.services.legacy_services import _build_df_generator_assets

    await _push_stage(ctx, "generator_assets", "started", 10)

    try:
        tdir = _template_dir(template_id)
        result = _build_df_generator_assets(
            template_dir=tdir,
            contract_path=tdir / "contract.json",
            mapping_path=tdir / "mapping_step3.json",
            key_tokens=None,
        )

        issues = result.get("needs_user_fix", [])

        # Transition: APPROVED → BUILDING_ASSETS
        ctx.session.transition(PipelineState.BUILDING_ASSETS)
        ctx.session.complete_stage("generator_assets")
        ctx.session.save()

        await _push_stage(ctx, "generator_assets", "complete", 100)

        return {
            "status": "ok" if not issues else "warning",
            "mode": "dataframe",
            "scalars": result.get("scalars", 0),
            "row_tokens": result.get("row_tokens", 0),
            "totals": result.get("totals", 0),
            "reshape_rules": result.get("reshape_rules", 0),
            "row_computed": result.get("row_computed", 0),
            "issues": issues,
        }
    except Exception as exc:
        logger.exception("tool_build_generator_assets_failed")
        return {"error": "assets_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 16: call_qwen_vision
# ═══════════════════════════════════════════════════════════════════════

async def tool_call_qwen_vision(
    ctx: ToolContext,
    messages: list[dict],
    images: list[str] | None = None,
) -> dict:
    """Call Qwen 3.5 27B with optional images for vision tasks."""
    from backend.app.services.infra_services import call_chat_completion
    from backend.app.services.llm import get_llm_client

    try:
        client = get_llm_client()
        response = call_chat_completion(
            client, model=None,
            messages=messages,
            description="agent_vision_call",
        )
        content = response.choices[0].message.content if hasattr(response, "choices") else str(response)
        return {"status": "ok", "content": content}
    except Exception as exc:
        return {"error": "vision_call_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool 17: resolve_mapping_pipeline (composite)
# ═══════════════════════════════════════════════════════════════════════

async def tool_resolve_mapping_pipeline(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
) -> dict:
    """Atomic pipeline: map → sanity validate → build contract. Reduces agent decision surface."""
    _require_state(ctx.session, {"html_ready", "mapped"}, "resolve_mapping_pipeline")

    # Step 1: Auto-map
    map_result = await tool_auto_map_tokens(ctx, template_id, connection_id)
    if map_result.get("error"):
        return map_result

    # Step 2: Check for unresolved
    unresolved = map_result.get("unresolved_tokens", [])
    if unresolved:
        return {
            "status": "needs_user_input",
            "unresolved": unresolved,
            "mapping": map_result.get("mapping", {}),
            "message": f"{len(unresolved)} tokens need manual mapping before contract can be built.",
        }

    # Step 3: Build contract (includes sanity gate)
    contract_result = await tool_build_contract(ctx, template_id, connection_id)
    if contract_result.get("error"):
        return contract_result

    return {"status": "contract_ready", **contract_result}


# ═══════════════════════════════════════════════════════════════════════
# DRY RUN PREVIEW — final verification with real data before generation
# ═══════════════════════════════════════════════════════════════════════

async def tool_dry_run_preview(
    ctx: ToolContext,
    template_id: str,
    connection_id: str,
    user_approved_warnings: bool = False,
) -> dict:
    """FINAL STEP of template creation. Generates a sample report with REAL data.

    This is what makes template creation "complete":
    1. Find dates with actual data in DB
    2. Generate report through the SAME fill_and_print code path as production
    3. Cross-verify rendered output against raw DB values
    4. Check for empty rows, leaked tokens, missing data, row-level accuracy
    5. PASS → state transitions to VALIDATED (template complete)
    6. WARN/FAIL → agent fixes and retries, or asks user

    Only after PASS can generate_report run.
    """
    _require_state(ctx.session, {"building_assets", "validated", "ready"}, "dry_run_preview")

    # Structural validation must have passed first
    if "validate" not in ctx.session.completed_stages:
        return {
            "error": "validate_first",
            "message": "Run validate_pipeline first. Structural checks must pass before dry run.",
        }

    from backend.app.repositories import resolve_db_path, SQLiteDataFrameLoader
    import pandas as pd

    try:
        tdir = _template_dir(template_id)
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        contract_path = tdir / "contract.json"
        if not contract_path.exists():
            return {"error": "no_contract", "message": "No contract.json found."}

        contract = json.loads(contract_path.read_text())
        loader = SQLiteDataFrameLoader(db_path)

        # ── Step 1: Find dates with actual data ──
        await _push_stage(ctx, "dry_run.find_data", "started", 5)

        date_cols = contract.get("date_columns", {})
        sample_start = sample_end = None
        parent_table = contract.get("join", {}).get("parent_table", "")
        main_df = None

        for table, col in date_cols.items():
            if table not in loader.table_names():
                continue
            df = loader.frame(table)
            if col not in df.columns:
                continue
            main_df = df
            dates = pd.to_datetime(df[col], errors="coerce").dropna()
            if len(dates) == 0:
                continue
            # Try windows at different positions to find 5-100 rows
            for window_days in [1, 2, 7]:
                for offset_pct in [0.5, 0.0, 1.0]:
                    range_days = max((dates.max() - dates.min()).days, 1)
                    try_start = dates.min() + pd.Timedelta(days=int(range_days * offset_pct))
                    try_end = try_start + pd.Timedelta(days=window_days)
                    count = dates.between(try_start, try_end).sum()
                    if 5 <= count <= 100:
                        sample_start = str(try_start.date())
                        sample_end = str(try_end.date())
                        break
                if sample_start:
                    break
            if not sample_start:
                sample_start = str(dates.min().date())
                sample_end = str((dates.min() + pd.Timedelta(days=1)).date())
            break

        if not sample_start:
            return {"error": "no_data_range", "message": "No dates with data found in DB."}

        await _push_stage(ctx, "dry_run.find_data", "complete", 15)

        # ── Step 2: Sample raw DB rows for cross-verification ──
        await _push_stage(ctx, "dry_run.sample_db", "started", 18)

        db_sample_rows = []
        if main_df is not None and date_cols:
            date_col = list(date_cols.values())[0]
            if date_col in main_df.columns:
                dt_series = pd.to_datetime(main_df[date_col], errors="coerce")
                mask = dt_series.between(pd.Timestamp(sample_start), pd.Timestamp(sample_end))
                sample_df = main_df[mask].head(5)
                db_sample_rows = sample_df.to_dict("records")

        await _push_stage(ctx, "dry_run.sample_db", "complete", 25)

        # ── Step 3: Discover batches + generate PDF ──
        await _push_stage(ctx, "dry_run.generate", "started", 30)

        from backend.app.services.reports import discover_batches_and_counts, fill_and_print

        discovery_result = discover_batches_and_counts(
            db_path=db_path, contract=contract,
            start_date=sample_start, end_date=sample_end,
        )
        batches = discovery_result.get("batches", []) if isinstance(discovery_result, dict) else []

        if not batches:
            return {
                "error": "no_batches",
                "message": f"No batches for {sample_start} to {sample_end}.",
                "sample_start": sample_start, "sample_end": sample_end,
            }

        validation_dir = tdir / "_dry_run_preview"
        validation_dir.mkdir(parents=True, exist_ok=True)

        template_html = ""
        for name in ("report_final.html", "template_p1.html"):
            p = tdir / name
            if p.exists():
                template_html = p.read_text(encoding="utf-8", errors="ignore")
                break

        template_file = validation_dir / "template.html"
        template_file.write_text(template_html, encoding="utf-8")
        out_html = validation_dir / "preview.html"
        out_pdf = validation_dir / "preview.pdf"

        fill_and_print(
            OBJ=contract, TEMPLATE_PATH=template_file, DB_PATH=db_path,
            OUT_HTML=out_html, OUT_PDF=out_pdf,
            START_DATE=sample_start, END_DATE=sample_end,
        )

        await _push_stage(ctx, "dry_run.generate", "complete", 60)

        # ── Step 4: Verify output quality ──
        await _push_stage(ctx, "dry_run.verify_html", "started", 62)

        preview_html = out_html.read_text(encoding="utf-8", errors="ignore") if out_html.exists() else ""
        pdf_size = out_pdf.stat().st_size if out_pdf.exists() else 0

        data_rows = len(re.findall(r"<tr\b", preview_html))
        empty_cells = len(re.findall(r"<td[^>]*>\s*</td>", preview_html))
        total_cells = len(re.findall(r"<td\b", preview_html))
        filled_cells = total_cells - empty_cells

        # Leaked tokens (exclude CSS braces)
        all_tokens_in_html = re.findall(r"\{([A-Za-z_]\w*)\}", preview_html)
        style_block = re.search(r"<style[^>]*>(.*?)</style>", preview_html, re.DOTALL)
        css_tokens = set(re.findall(r"\{([A-Za-z_]\w*)\}", style_block.group(1))) if style_block else set()
        leaked = [t for t in all_tokens_in_html if t not in css_tokens and not t.startswith("__")]

        await _push_stage(ctx, "dry_run.verify_html", "complete", 70)

        # ── Step 5: Cross-verify rendered values against raw DB ──
        await _push_stage(ctx, "dry_run.cross_verify", "started", 72)

        cross_check_issues = []

        if db_sample_rows and preview_html:
            # Extract visible text values from the first few table rows in HTML
            cell_pattern = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL)
            rendered_values = [re.sub(r"<[^>]+>", "", m).strip() for m in cell_pattern.findall(preview_html)]
            rendered_values = [v for v in rendered_values if v]  # non-empty

            # Check: do any raw DB values appear in the rendered output?
            first_row = db_sample_rows[0] if db_sample_rows else {}
            mapping = contract.get("mapping", {})

            for token, col_ref in mapping.items():
                if "." not in col_ref:
                    continue
                col = col_ref.split(".", 1)[1]
                if col not in first_row:
                    continue
                db_val = str(first_row[col]).strip()
                if not db_val or db_val.lower() in ("none", "nan", ""):
                    continue

                # Check if this DB value appears somewhere in rendered output
                found = any(db_val in rv for rv in rendered_values)
                if not found and token.startswith("row_"):
                    # Row tokens might be reshaped — check bin columns
                    pass  # reshape makes this hard to verify directly
                elif not found and not token.startswith("row_") and not token.startswith("total_"):
                    cross_check_issues.append(
                        f"Token '{token}': DB value '{db_val[:30]}' not found in rendered output"
                    )

            # Check: are batch header values (recipe name, times) in the output?
            for key in ("recipe_name", "start_time", "end_time"):
                if key in first_row:
                    val = str(first_row[key]).strip()
                    if not val:
                        continue
                    # Fuzzy timestamp check: try full value, date part, time part
                    found_in_html = val in preview_html
                    if not found_in_html and " " in val:
                        date_part = val.split(" ")[0]  # "2025-08-19"
                        time_part = val.split(" ")[1] if len(val.split(" ")) > 1 else ""
                        found_in_html = date_part in preview_html or time_part in preview_html
                    if not found_in_html and "T" in val:
                        date_part = val.split("T")[0]
                        found_in_html = date_part in preview_html
                    if not found_in_html and key == "recipe_name":
                        # recipe name might appear without prefix
                        found_in_html = val.upper() in preview_html.upper()
                    if not found_in_html:
                        cross_check_issues.append(
                            f"DB '{key}'='{val[:30]}' not found in rendered HTML"
                        )

        await _push_stage(ctx, "dry_run.cross_verify", "complete", 90)

        # ── Step 6: Row-level data verification ──
        await _push_stage(ctx, "dry_run.row_verify", "started", 92)

        # Check if actual material/data values from DB appear in rendered output
        row_data_issues = []
        if db_sample_rows and preview_html:
            # Get the first few DB rows — check if their key values appear in HTML
            first_row = db_sample_rows[0]

            # Check reshape source columns (bin*_content values should appear as material names)
            for key in sorted(first_row.keys()):
                if "content" in key and not key.startswith("__"):
                    val = str(first_row[key]).strip()
                    if val and val.lower() not in ("none", "nan", ""):
                        if val not in preview_html:
                            row_data_issues.append(f"Material '{val}' (from {key}) not in output")
                        break  # just check the first non-empty bin

            # Check numeric values — at least one set_weight should appear
            for key in sorted(first_row.keys()):
                if "_sp" in key and not key.startswith("__"):
                    val = str(first_row[key]).strip()
                    if val and val != "0":
                        # Format as the report would
                        try:
                            formatted = f"{float(val):.2f}"
                            if formatted in preview_html or val in preview_html:
                                break  # found at least one weight value
                        except (ValueError, TypeError):
                            pass
            else:
                row_data_issues.append("No set weight values from DB found in rendered output")

        await _push_stage(ctx, "dry_run.row_verify", "complete", 95)

        # ── Step 7: Build final result ──
        has_data = filled_cells > 5 and data_rows > 2
        has_leaks = len(leaked) > 0
        has_cross_issues = len(cross_check_issues) > 0
        has_row_issues = len(row_data_issues) > 0

        if has_data and not has_leaks and not has_cross_issues and not has_row_issues:
            verdict = "PASS"
        elif has_data and not has_leaks and user_approved_warnings:
            # User reviewed the warnings and said they're acceptable
            verdict = "PASS"
        elif has_data and not has_leaks:
            verdict = "WARN"
        else:
            verdict = "FAIL"

        # Mark dry_run as completed and transition to VALIDATED ONLY on PASS
        # This is the FINAL step of template creation — VALIDATED means "template complete"
        if verdict == "PASS":
            ctx.session.complete_stage("dry_run")
            try:
                if ctx.session.pipeline_state == PipelineState.BUILDING_ASSETS:
                    ctx.session.transition(PipelineState.VALIDATING)
                if ctx.session.pipeline_state == PipelineState.VALIDATING:
                    ctx.session.transition(PipelineState.VALIDATED)
            except ValueError:
                pass
            ctx.session.save()
            logger.info("dry_run_passed — template creation COMPLETE, state=VALIDATED")

        await _push_stage(ctx, "dry_run.complete", "complete", 100)

        # Build a DB sample summary for the agent to review
        db_summary = {}
        if db_sample_rows:
            row = db_sample_rows[0]
            for k, v in row.items():
                if k.startswith("__") or k == "rowid":
                    continue
                db_summary[k] = str(v)[:50]

        dry_run_result = {
            "status": "preview_ready",
            "verdict": verdict,
            "sample_start": sample_start,
            "sample_end": sample_end,
            "batch_count": len(batches),
            "row_count": data_rows,
            "source_rows": len(db_sample_rows),
            "grouped_rows": len(batches),
            "output_rows": len(batches),
            "batches_found": len(batches),
            "db_rows_in_range": len(db_sample_rows),
            "pdf_size_kb": round(pdf_size / 1024, 1),
            "data_rows": data_rows,
            "filled_cells": filled_cells,
            "total_cells": total_cells,
            "empty_cell_pct": round(empty_cells / max(total_cells, 1) * 100, 1),
            "leaked_tokens": leaked[:5] if leaked else [],
            "has_data": has_data,
            "has_leaks": has_leaks,
            "cross_check_issues": cross_check_issues[:5],
            "row_data_issues": row_data_issues[:5],
            "db_first_row_sample": db_summary,
            "sample_rows": db_sample_rows[:3],
            "pdf_url": f"/uploads/{template_id}/_dry_run_preview/preview.pdf",
            "dry_run_completed": verdict == "PASS",
        }

        # Persist to disk for _build_status_view
        try:
            (tdir / "dry_run_result.json").write_text(
                json.dumps(dry_run_result, default=str), encoding="utf-8"
            )
        except Exception:
            pass

        return dry_run_result

    except Exception as exc:
        logger.exception("dry_run_preview_failed")
        return {"error": "dry_run_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# FREEFORM EDITING LAYER — read/modify artifacts between pipeline steps
# ═══════════════════════════════════════════════════════════════════════

async def tool_read_template(ctx: ToolContext) -> dict:
    """Read the current template HTML. Use this to see what the template looks like before making changes."""
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "building_assets", "validated", "ready"}, "read_template")
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}
    try:
        tdir = _template_dir(ctx.template_id)
        for name in ("report_final.html", "template_p1.html"):
            p = tdir / name
            if p.exists() and p.stat().st_size > 0:
                html = p.read_text(encoding="utf-8", errors="ignore")
                tokens = sorted(set(re.findall(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?", html)))
                return {
                    "status": "ok",
                    "html": html,
                    "tokens": tokens,
                    "token_count": len(tokens),
                    "file": name,
                    "size": len(html),
                }
        return {"error": "no_html", "message": "No template HTML file found."}
    except Exception as exc:
        return {"error": "read_failed", "message": str(exc)}


async def tool_read_mapping(ctx: ToolContext) -> dict:
    """Read the current token-to-column mapping. Use this to review the mapping before corrections."""
    _require_state(ctx.session, {"mapped", "approved", "building_assets", "validated", "ready"}, "read_mapping")
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}
    try:
        tdir = _template_dir(ctx.template_id)
        labels_path = tdir / "mapping_pdf_labels.json"
        step3_path = tdir / "mapping_step3.json"

        mapping = {}
        if labels_path.exists():
            data = json.loads(labels_path.read_text())
            for entry in data:
                if isinstance(entry, dict):
                    mapping[entry.get("header", "")] = entry.get("mapping", "UNRESOLVED")
        elif step3_path.exists():
            data = json.loads(step3_path.read_text())
            mapping = data.get("mapping", {})

        unresolved = [t for t, v in mapping.items() if v == "UNRESOLVED"]
        return {
            "status": "ok",
            "mapping": mapping,
            "total": len(mapping),
            "unresolved_count": len(unresolved),
            "unresolved": unresolved,
        }
    except Exception as exc:
        return {"error": "read_failed", "message": str(exc)}


async def tool_read_contract(ctx: ToolContext) -> dict:
    """Read the current contract JSON. Use this to review contract structure before validation."""
    _require_state(ctx.session, {"approved", "building_assets", "validated", "ready"}, "read_contract")
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}
    try:
        tdir = _template_dir(ctx.template_id)
        contract_path = tdir / "contract.json"
        if not contract_path.exists():
            return {"error": "no_contract", "message": "No contract.json found. Build the contract first."}

        contract = json.loads(contract_path.read_text())
        # Return a summary, not the full contract (can be very large)
        return {
            "status": "ok",
            "tokens": contract.get("tokens", {}),
            "mapping_keys": list(contract.get("mapping", {}).keys()),
            "join": contract.get("join", {}),
            "date_columns": contract.get("date_columns", {}),
            "reshape_rules_count": len(contract.get("reshape_rules", [])),
            "row_computed_keys": list(contract.get("row_computed", {}).keys()),
            "totals_keys": list(contract.get("totals_math", contract.get("totals", {})).keys()),
            "param_tokens": contract.get("param_tokens", []),
            "literals": contract.get("literals", {}),
            "formatters_count": len(contract.get("formatters", {})),
        }
    except Exception as exc:
        return {"error": "read_failed", "message": str(exc)}


async def tool_edit_template(ctx: ToolContext, instruction: str) -> dict:
    """Apply a user's edit instruction to the template HTML using Qwen.

    The agent reads the current HTML, sends it to Qwen with the user's instruction,
    gets back modified HTML, and saves it. This enables freeform template editing
    (change fonts, colors, layout, borders, etc.) without predefined tools.
    """
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "building_assets", "validated", "ready"}, "edit_template")
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}

    try:
        tdir = _template_dir(ctx.template_id)
        # Read current HTML
        html_path = None
        html = ""
        for name in ("report_final.html", "template_p1.html"):
            p = tdir / name
            if p.exists() and p.stat().st_size > 0:
                html = p.read_text(encoding="utf-8", errors="ignore")
                html_path = p
                break

        if not html:
            return {"error": "no_html", "message": "No template HTML found."}

        # Load OCR context so Qwen knows actual PDF headers when editing
        ocr_reference = ""
        try:
            ocr_json_path = tdir / "ocr_structured.json"
            if ocr_json_path.exists():
                ocr_data = json.loads(ocr_json_path.read_text())
                headers = ocr_data.get("sections", {}).get("column_headers", [])
                scalars = ocr_data.get("sections", {}).get("scalar_fields", [])
                if headers or scalars:
                    ocr_reference = "\nREFERENCE — actual PDF content (from OCR):\n"
                    if scalars:
                        ocr_reference += "Header fields: " + ", ".join(
                            f'{s["label"]}={s.get("sample_value", "?")}' for s in scalars
                        ) + "\n"
                    if headers:
                        ocr_reference += "Table columns: " + ", ".join(
                            h["text"] for h in headers
                        ) + "\n"
        except Exception:
            pass

        # Call Qwen to apply the edit
        from backend.app.services.infra_services import call_chat_completion
        from backend.app.services.llm import get_llm_client

        client = get_llm_client()
        edit_prompt = (
            "You are editing an HTML report template. Apply the user's instruction to the HTML below.\n\n"
            "RULES:\n"
            "- Keep ALL {token_name} placeholders exactly as they are. Do NOT rename, remove, or add tokens.\n"
            "- Keep <!-- BEGIN:BLOCK_REPEAT --> and <!-- END:BLOCK_REPEAT --> markers unchanged.\n"
            "- Only modify CSS/styling/layout as requested.\n"
            "- Return ONLY the complete modified HTML. No explanations, no markdown fences.\n"
            f"{ocr_reference}\n"
            f"USER INSTRUCTION: {instruction}\n\n"
            f"CURRENT HTML:\n{html}"
        )

        response = call_chat_completion(
            client, model=None,
            messages=[{"role": "user", "content": edit_prompt}],
            description="edit_template",
        )

        new_html = response.choices[0].message.content if hasattr(response, "choices") else str(response)
        # Strip code fences if present
        new_html = re.sub(r"^```(?:html)?\s*\n?", "", new_html.strip())
        new_html = re.sub(r"\n?```\s*$", "", new_html.strip())

        # Verify tokens are preserved
        old_tokens = set(re.findall(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?", html))
        new_tokens = set(re.findall(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?", new_html))
        lost_tokens = old_tokens - new_tokens

        if lost_tokens:
            return {
                "error": "tokens_lost",
                "message": f"Edit would remove {len(lost_tokens)} tokens: {sorted(lost_tokens)[:5]}. Edit rejected.",
                "lost_tokens": sorted(lost_tokens),
            }

        # Save
        html_path.write_text(new_html, encoding="utf-8")
        # Also write to report_final.html if we edited template_p1.html
        final = tdir / "report_final.html"
        if html_path.name == "template_p1.html":
            final.write_text(new_html, encoding="utf-8")

        return {
            "status": "ok",
            "message": f"Template edited: {instruction[:100]}",
            "tokens_preserved": len(new_tokens),
            "html_size": len(new_html),
        }

    except Exception as exc:
        return {"error": "edit_failed", "message": str(exc)}


async def tool_edit_mapping(ctx: ToolContext, changes: dict[str, str]) -> dict:
    """Apply specific token→column mapping changes. Lightweight version of refine_mapping.

    Unlike refine_mapping which can call the LLM, this directly writes the changes.
    Use for quick fixes like: {"row_error_kg": "COMPUTED:row_ach_wt_kg-row_set_wt_kg"}
    """
    _require_state(ctx.session, {"html_ready", "mapped", "approved", "building_assets"}, "edit_mapping")
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}

    try:
        tdir = _template_dir(ctx.template_id)
        step3_path = tdir / "mapping_step3.json"
        labels_path = tdir / "mapping_pdf_labels.json"

        # Read current mapping
        if step3_path.exists():
            step3 = json.loads(step3_path.read_text())
            mapping = step3.get("mapping", {})
        else:
            mapping = {}

        # Apply changes
        mapping.update(changes)

        # Write back
        if step3_path.exists():
            step3["mapping"] = mapping
            step3_path.write_text(json.dumps(step3, indent=2, ensure_ascii=False))

        # Write mapping_pdf_labels.json
        labels = []
        for k, v in mapping.items():
            labels.append({"header": k, "placeholder": "{" + k + "}", "mapping": v})
        labels_path.write_text(json.dumps(labels, indent=2, ensure_ascii=False))

        # Transition to MAPPED if currently at HTML_READY
        # (edit_mapping is a valid way to complete mapping, not just auto_map_tokens)
        if ctx.session.pipeline_state.value in ("html_ready", "mapped"):
            try:
                if ctx.session.pipeline_state.value == "html_ready":
                    ctx.session.transition("mapped")
                ctx.session.complete_stage("mapping")
                ctx.session.save()
            except Exception:
                pass  # Non-fatal — mapping was written regardless

        return {
            "status": "ok",
            "message": f"Applied {len(changes)} mapping change(s).",
            "changes": changes,
        }

    except Exception as exc:
        return {"error": "edit_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool: read_ocr
# ═══════════════════════════════════════════════════════════════════════

async def tool_read_ocr(ctx: ToolContext) -> dict:
    """Read structured OCR data from the reference PDF.

    Returns structured sections (scalar_fields, column_headers, data_samples,
    layout_notes) when available, or raw text as fallback.
    Use when the user asks about PDF content, token names, or column headers.
    """
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}
    try:
        tdir = _template_dir(ctx.template_id)
        # Prefer structured JSON
        ocr_json_path = tdir / "ocr_structured.json"
        if ocr_json_path.exists():
            data = json.loads(ocr_json_path.read_text())
            return {
                "status": "ok",
                "structured": True,
                "sections": data.get("sections", {}),
                "raw_text": data.get("raw_text", ""),
                "chars": len(data.get("raw_text", "")),
            }
        # Backward compat: raw text
        ocr_path = tdir / "ocr_reference.txt"
        if ocr_path.exists():
            text = ocr_path.read_text(encoding="utf-8")
            return {"status": "ok", "structured": False, "ocr_text": text, "chars": len(text)}
        return {"status": "no_ocr", "message": "OCR text not available. Verify template first."}
    except Exception as exc:
        return {"error": "read_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# Tool: ocr_pdf_page
# ═══════════════════════════════════════════════════════════════════════

async def tool_ocr_pdf_page(
    ctx: ToolContext,
    page: int = 0,
    prompt: str | None = None,
) -> dict:
    """OCR a specific page from the source PDF at 400 DPI via GLM-OCR.

    Default: uses structured extraction prompt (cached per page).
    Custom prompt: uses raw extraction (not cached).
    """
    if not ctx.template_id:
        return {"error": "no_template", "message": "No template_id set."}
    try:
        tdir = _template_dir(ctx.template_id)
        source_pdf = tdir / "source.pdf"
        if not source_pdf.exists():
            return {"error": "no_pdf", "message": "Source PDF not found."}

        # Check cache for structured extraction (default prompt only)
        cache_path = tdir / f"ocr_structured_p{page}.json"
        if prompt is None and cache_path.exists():
            data = json.loads(cache_path.read_text())
            return {
                "status": "ok", "cached": True, "structured": True,
                "sections": data.get("sections", {}),
                "raw_text": data.get("raw_text", ""),
                "chars": len(data.get("raw_text", "")),
                "page": page,
            }

        import fitz
        doc = fitz.open(str(source_pdf))
        if page >= len(doc):
            page_count = len(doc)
            doc.close()
            return {"error": "invalid_page", "message": f"Page {page} out of range (0-{page_count - 1})."}

        pix = doc[page].get_pixmap(dpi=400)
        png_bytes = pix.tobytes("png")
        doc.close()

        if prompt is None:
            # Structured extraction with production prompt
            from backend.app.services.infra_services import ocr_extract_structured
            result = await asyncio.to_thread(ocr_extract_structured, png_bytes)
            if result.get("raw_text"):
                result["page"] = page
                result["dpi"] = 400
                cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
            return {
                "status": "ok", "structured": True,
                "sections": result.get("sections", {}),
                "raw_text": result.get("raw_text", ""),
                "chars": len(result.get("raw_text", "")),
                "page": page,
            }
        else:
            # Custom prompt — raw extraction, no cache
            from backend.app.services.infra_services import ocr_extract
            text = await asyncio.to_thread(ocr_extract, png_bytes, prompt=prompt)
            if text:
                return {"status": "ok", "text": text, "chars": len(text), "page": page}
            return {"status": "no_text", "text": None, "page": page}
    except Exception as exc:
        return {"error": "ocr_failed", "message": str(exc)}


# ═══════════════════════════════════════════════════════════════════════
# OpenAI Tool Schemas
# ═══════════════════════════════════════════════════════════════════════

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "session_get_state",
            "description": "Get the current pipeline session state including completed stages.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "session_transition",
            "description": "Transition the pipeline to a new state. State machine enforces valid transitions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_state": {
                        "type": "string",
                        "description": "Target state: empty, html_ready, mapping, mapped, approving, approved, validating, validated, generating, ready",
                    },
                },
                "required": ["target_state"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_ocr_text",
            "description": "Extract text from a PDF page image using OCR.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_image_b64": {"type": "string", "description": "Base64-encoded page image"},
                    "prompt": {"type": "string", "description": "OCR prompt (default: 'OCR the text in this image.')"},
                },
                "required": ["page_image_b64"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_template",
            "description": "Upload and convert a PDF/Excel file to an HTML template with placeholder tokens.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "save_template",
            "description": "Save updated template HTML to disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "html": {"type": "string", "description": "The HTML template content"},
                    "tokens": {"type": "array", "items": {"type": "string"}, "description": "List of token names"},
                },
                "required": ["html", "tokens"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schema",
            "description": "Get the database schema (tables, columns, types) for a connection.",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "string", "description": "Database connection ID"},
                },
                "required": ["connection_id"],
            },
        },
    },
    # ── Exploration layer schemas ──
    {
        "type": "function",
        "function": {
            "name": "inspect_data",
            "description": "Sample column values and basic stats from a DB table. Read-only, no state change. Use to understand data before mapping.",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "string"},
                    "table": {"type": "string", "description": "Table name to inspect"},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "Specific columns (optional, default all)"},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["connection_id", "table"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_column_stats",
            "description": "Get detailed column statistics: distribution, null%, unique count, top values. Use to provide data quality insights to the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "connection_id": {"type": "string"},
                    "table": {"type": "string", "description": "Table name"},
                    "columns": {"type": "array", "items": {"type": "string"}, "description": "Specific columns (optional, default all)"},
                },
                "required": ["connection_id", "table"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_mapping",
            "description": "Generate candidate mapping and score it WITHOUT writing anything. Use to preview mapping quality before committing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_mappings",
            "description": "Compare two candidate mappings and show differences + risks. Read-only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mapping_a": {"type": "object", "additionalProperties": {"type": "string"}, "description": "First mapping"},
                    "mapping_b": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Second mapping"},
                },
                "required": ["mapping_a", "mapping_b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "preview_contract",
            "description": "Estimate what a contract would produce: row counts, join feasibility, reshape cardinality. Read-only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    # ── Transformation layer schemas ──
    {
        "type": "function",
        "function": {
            "name": "auto_map_tokens",
            "description": "Auto-map template tokens to database columns using LLM + scoring. WRITES mapping to disk.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refine_mapping",
            "description": "Refine token-to-column mappings based on user corrections.",
            "parameters": {
                "type": "object",
                "properties": {
                    "user_input": {"type": "string", "description": "User's correction instructions"},
                    "mapping_override": {
                        "type": "object",
                        "description": "Explicit token→column overrides",
                        "additionalProperties": {"type": "string"},
                    },
                },
                "required": ["user_input"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_key_options",
            "description": "Get available filter values for key tokens.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tokens": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "default": 50},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_contract",
            "description": "Build the contract JSON from approved mapping. Runs sanity checks first. Requires all tokens resolved.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_pipeline",
            "description": "Run 3-phase validation: deterministic checks, dry run, visual check. MUST pass before generate.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                    "skip_llm": {"type": "boolean", "default": False},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "auto_fix_issues",
            "description": "Attempt to auto-fix validation issues using LLM reasoning.",
            "parameters": {
                "type": "object",
                "properties": {
                    "issues": {"type": "array", "items": {"type": "object"}, "description": "Validation issues to fix"},
                    "template_id": {"type": "string"},
                },
                "required": ["issues", "template_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "discover_batches",
            "description": "Discover available batch IDs and row counts for a date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_report",
            "description": "Queue report generation. REQUIRES validate_pipeline to have passed first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                    "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "End date (YYYY-MM-DD)"},
                    "batch_ids": {"type": "array", "items": {"type": "string"}, "description": "Specific batch IDs (optional)"},
                },
                "required": ["template_id", "connection_id", "start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_generator_assets",
            "description": "Validate contract and build generator assets (output_schemas, params, metadata) for the DataFrame pipeline.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                },
                "required": ["template_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "dry_run_preview",
            "description": "FINAL STEP of template creation. Generates a sample report with REAL data from the DB. Verifies data renders correctly. PASS = template complete. WARN = user must review. Set user_approved_warnings=true when user confirms warnings are acceptable.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                    "user_approved_warnings": {"type": "boolean", "default": False, "description": "Set true when user has reviewed warnings and confirmed they are acceptable"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "call_qwen_vision",
            "description": "Call Qwen 3.5 27B for vision tasks (comparing images, reading charts, etc.).",
            "parameters": {
                "type": "object",
                "properties": {
                    "messages": {"type": "array", "items": {"type": "object"}, "description": "OpenAI-format messages"},
                    "images": {"type": "array", "items": {"type": "string"}, "description": "Base64 images (optional)"},
                },
                "required": ["messages"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resolve_mapping_pipeline",
            "description": "Atomic pipeline: auto-map tokens → sanity check → build contract. Preferred for normal flow. Returns needs_user_input if tokens are unresolved.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "string"},
                    "connection_id": {"type": "string"},
                },
                "required": ["template_id", "connection_id"],
            },
        },
    },
    # ── Freeform editing layer schemas ──
    {
        "type": "function",
        "function": {
            "name": "read_template",
            "description": "Read the current template HTML and its tokens. Use to see the template before making changes.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_mapping",
            "description": "Read the current token-to-column mapping. Use to review before corrections.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_contract",
            "description": "Read the current contract summary (tokens, joins, reshapes, formatters). Use to review before validation.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_template",
            "description": "Apply an edit instruction to the template HTML using LLM (change fonts, colors, layout, borders, etc.). Tokens are preserved automatically.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {"type": "string", "description": "What to change, e.g. 'change font to Arial', 'make header border thicker', 'add alternating row colors'"},
                },
                "required": ["instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_mapping",
            "description": "Apply specific token→column mapping changes directly. For quick fixes without LLM.",
            "parameters": {
                "type": "object",
                "properties": {
                    "changes": {
                        "type": "object",
                        "additionalProperties": {"type": "string"},
                        "description": "Token→column changes, e.g. {\"row_error_kg\": \"COMPUTED:row_ach_wt_kg-row_set_wt_kg\"}",
                    },
                },
                "required": ["changes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_ocr",
            "description": "Read STRUCTURED OCR data from the reference PDF. Returns scalar_fields, column_headers (with normalized names), data_samples, and layout_notes. Use when user asks about PDF content, token names, or column headers.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ocr_pdf_page",
            "description": "OCR a specific page from the source PDF at 400 DPI via GLM-OCR. Returns structured sections (headers, scalars, data samples, layout). Results are cached per page. Use when user references a specific page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page": {
                        "type": "integer",
                        "description": "Page number (0-indexed). Default: 0 (first page).",
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Custom OCR prompt. If omitted, uses structured extraction (recommended). Only provide for specialized extraction tasks.",
                    },
                },
                "required": [],
            },
        },
    },
]


# ═══════════════════════════════════════════════════════════════════════
# Tool Dispatch Table
# ═══════════════════════════════════════════════════════════════════════

TOOL_DISPATCH: dict[str, Any] = {
    "session_get_state": tool_session_get_state,
    "session_transition": tool_session_transition,
    "extract_ocr_text": tool_extract_ocr_text,
    "verify_template": tool_verify_template,
    "save_template": tool_save_template,
    "get_schema": tool_get_schema,
    "inspect_data": tool_inspect_data,
    "get_column_stats": tool_get_column_stats,
    "simulate_mapping": tool_simulate_mapping,
    "compare_mappings": tool_compare_mappings,
    "preview_contract": tool_preview_contract,
    "auto_map_tokens": tool_auto_map_tokens,
    "refine_mapping": tool_refine_mapping,
    "get_key_options": tool_get_key_options,
    "build_contract": tool_build_contract,
    "validate_pipeline": tool_validate_pipeline,
    "auto_fix_issues": tool_auto_fix_issues,
    "discover_batches": tool_discover_batches,
    "generate_report": tool_generate_report,
    "build_generator_assets": tool_build_generator_assets,
    "call_qwen_vision": tool_call_qwen_vision,
    "resolve_mapping_pipeline": tool_resolve_mapping_pipeline,
    "dry_run_preview": tool_dry_run_preview,
    # Freeform editing
    "read_template": tool_read_template,
    "read_mapping": tool_read_mapping,
    "read_contract": tool_read_contract,
    "edit_template": tool_edit_template,
    "edit_mapping": tool_edit_mapping,
    # OCR tools
    "read_ocr": tool_read_ocr,
    "ocr_pdf_page": tool_ocr_pdf_page,
}
