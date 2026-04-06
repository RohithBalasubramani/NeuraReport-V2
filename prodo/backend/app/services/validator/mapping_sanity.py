# mypy: ignore-errors
"""
Mapping Sanity Checks — hard gates before contract build.

Binary pass/fail checks that catch structural mapping errors:
- Cross-field consistency (exclusive pairs must not map to same column)
- Duplicate column mappings
- Type hard failures (numeric token → TEXT column, etc.)
"""
from __future__ import annotations

import logging
from typing import Any, Sequence

logger = logging.getLogger("neura.validator.mapping_sanity")

# ── Token type inference ──────────────────────────────────────────────

NUMERIC_PATTERNS = ("_wt", "_kg", "_qty", "_count", "_amt", "_pct", "_price", "_cost", "_total", "_sum", "_avg")
DATE_PATTERNS = ("_date", "_time", "timestamp", "_at")
TEXT_PATTERNS = ("_name", "_desc", "_code", "_label", "_title", "_content", "_material", "_recipe")

NUMERIC_SQL_TYPES = {"INTEGER", "REAL", "FLOAT", "DOUBLE", "NUMERIC", "DECIMAL", "INT", "BIGINT", "SMALLINT"}
TEXT_SQL_TYPES = {"TEXT", "VARCHAR", "CHAR", "NVARCHAR", "CLOB", "BLOB", "STRING"}
# Dates in SQLite are often TEXT — so TEXT is compatible with date tokens


def _infer_token_type(token: str) -> str:
    """Infer expected column type from token name pattern."""
    tok = token.lower()
    if any(p in tok for p in NUMERIC_PATTERNS):
        return "numeric"
    if any(p in tok for p in DATE_PATTERNS):
        return "datetime"
    if any(p in tok for p in TEXT_PATTERNS):
        return "text"
    return "unknown"


def _is_numeric_string(v: Any) -> bool:
    try:
        float(str(v))
        return True
    except (ValueError, TypeError):
        return False


# ── Check 1: Cross-field consistency ──────────────────────────────────

# Pairs of token patterns that MUST NOT map to the same column
EXCLUSIVE_PAIRS = [
    ("set_wt", "ach_wt"),
    ("set_wt", "act_wt"),
    ("set_wt", "actual"),
    ("start_time", "end_time"),
    ("from_date", "to_date"),
    ("error_kg", "set_wt"),
    ("error_kg", "ach_wt"),
    ("_sp", "_act"),
]


def check_cross_field_consistency(mapping: dict[str, str]) -> list[str]:
    """Tokens in exclusive pairs must map to different columns."""
    from backend.app.services.chat.tools import is_directive
    violations = []
    for pat_a, pat_b in EXCLUSIVE_PAIRS:
        cols_a = {t: v for t, v in mapping.items()
                  if pat_a in t.lower() and v != "UNRESOLVED" and not is_directive(v)}
        cols_b = {t: v for t, v in mapping.items()
                  if pat_b in t.lower() and v != "UNRESOLVED" and not is_directive(v)}
        for ta, va in cols_a.items():
            for tb, vb in cols_b.items():
                if ta != tb and va == vb:
                    violations.append(
                        f"Tokens '{ta}' and '{tb}' both map to same column '{va}' — these should be different columns"
                    )
    return violations


# ── Check 2: Duplicate column mappings ────────────────────────────────

def check_duplicate_columns(mapping: dict[str, str], computed_tokens: set[str] | None = None) -> list[str]:
    """Multiple row tokens should not map to the exact same column (excluding computed/total tokens)."""
    computed_tokens = computed_tokens or set()
    from backend.app.services.chat.tools import is_directive
    violations = []
    col_to_tokens: dict[str, list[str]] = {}
    for token, col in mapping.items():
        if token in computed_tokens:
            continue
        if is_directive(col) or col == "UNRESOLVED" or col.startswith("__"):
            continue
        col_to_tokens.setdefault(col, []).append(token)

    for col, tokens in col_to_tokens.items():
        if len(tokens) > 1:
            violations.append(
                f"Column '{col}' mapped by multiple tokens: {tokens} — likely a mapping error"
            )
    return violations


# ── Check 3: Type hard failures ───────────────────────────────────────

def check_type_alignment(
    mapping: dict[str, str],
    column_types: dict[str, str],
) -> list[str]:
    """Numeric tokens must map to numeric columns. Text tokens must not map to numeric columns."""
    violations = []
    for token, col_ref in mapping.items():
        if col_ref == "UNRESOLVED" or ":" in col_ref:
            continue
        # Extract column name from table.column format
        col = col_ref.split(".", 1)[1] if "." in col_ref else col_ref
        col_type = column_types.get(col, "").upper()
        if not col_type:
            continue

        expected = _infer_token_type(token)
        if expected == "numeric" and col_type in TEXT_SQL_TYPES:
            violations.append(
                f"Token '{token}' expects numeric but column '{col_ref}' is {col_type}"
            )
        if expected == "text" and col_type in NUMERIC_SQL_TYPES:
            violations.append(
                f"Token '{token}' expects text but column '{col_ref}' is {col_type}"
            )
    return violations


# ── Check 4: Value distribution sanity ────────────────────────────────

def check_value_distribution(
    mapping: dict[str, str],
    sample_rows: list[dict[str, Any]],
) -> list[str]:
    """Sample actual data to detect obvious mismatches."""
    if not sample_rows:
        return []
    violations = []
    for token, col_ref in mapping.items():
        if col_ref == "UNRESOLVED" or ":" in col_ref:
            continue
        col = col_ref.split(".", 1)[1] if "." in col_ref else col_ref
        values = [row.get(col) for row in sample_rows if row.get(col) is not None]
        if not values:
            continue

        expected = _infer_token_type(token)
        if expected == "numeric":
            non_numeric = sum(1 for v in values if not _is_numeric_string(v))
            if non_numeric > len(values) * 0.5:
                violations.append(
                    f"Token '{token}' expects numbers but column '{col}' has mostly non-numeric values: {[str(v) for v in values[:3]]}"
                )
        elif expected == "text":
            all_numeric = sum(1 for v in values if _is_numeric_string(v))
            if all_numeric == len(values) and len(values) >= 3:
                violations.append(
                    f"Token '{token}' expects text but column '{col}' has only numeric values: {[str(v) for v in values[:3]]}"
                )
    return violations


# ── Composite gate ────────────────────────────────────────────────────

def run_all_sanity_checks(
    mapping: dict[str, str],
    column_types: dict[str, str] | None = None,
    sample_rows: list[dict[str, Any]] | None = None,
    computed_tokens: set[str] | None = None,
) -> list[str]:
    """Run all sanity checks. Returns list of violation strings. Empty = pass."""
    violations = []
    violations.extend(check_cross_field_consistency(mapping))
    violations.extend(check_duplicate_columns(mapping, computed_tokens))
    if column_types:
        violations.extend(check_type_alignment(mapping, column_types))
    if sample_rows:
        violations.extend(check_value_distribution(mapping, sample_rows))
    if violations:
        logger.warning(
            "mapping_sanity_violations",
            extra={"event": "mapping_sanity_violations", "count": len(violations), "violations": violations[:5]},
        )
    return violations
