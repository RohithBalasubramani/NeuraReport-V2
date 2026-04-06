# mypy: ignore-errors
"""Deterministic validation checks — fast, no LLM needed."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd

from .models import Severity, ValidationIssue

logger = logging.getLogger("neura.validator.checks")

TOKEN_RE = re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")
DIRECT_COL_RE = re.compile(r"^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$")


def _extract_html_tokens(html: str) -> set[str]:
    return {m.group(1) for m in TOKEN_RE.finditer(html)}


def _contract_tokens(contract: dict) -> set[str]:
    tokens = contract.get("tokens", {})
    result = set()
    for key in ("scalars", "row_tokens", "totals"):
        result.update(tokens.get(key, []))
    return result


# ---------------------------------------------------------------------------
# Check 1: Template ↔ Contract token match
# ---------------------------------------------------------------------------

def check_template_token_match(contract: dict, template_html: str, **_) -> list[ValidationIssue]:
    issues = []
    html_tokens = _extract_html_tokens(template_html)
    contract_toks = _contract_tokens(contract)
    # Also include constant_replacements (tokens inlined as literals)
    constants = set(contract.get("constant_replacements", {}).keys())

    in_html_not_contract = html_tokens - contract_toks - constants
    in_contract_not_html = contract_toks - html_tokens

    for tok in sorted(in_html_not_contract):
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="token_match",
            message=f"Token '{{{tok}}}' in template HTML but not in contract",
            token=tok, fix_hint="Add this token to the contract mapping or remove from HTML",
        ))

    for tok in sorted(in_contract_not_html):
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="token_match",
            message=f"Token '{tok}' in contract but not found in template HTML",
            token=tok, detail="May be a computed/internal token",
        ))

    return issues


# ---------------------------------------------------------------------------
# Check 2: UNRESOLVED tokens
# ---------------------------------------------------------------------------

def check_unresolved_tokens(contract: dict, **_) -> list[ValidationIssue]:
    issues = []
    mapping = contract.get("mapping", {})
    row_tokens = set(contract.get("tokens", {}).get("row_tokens", []))
    meta_candidates = contract.get("meta", {}).get("candidates", {})

    for tok, col in mapping.items():
        if col == "UNRESOLVED":
            sev = Severity.ERROR if tok in row_tokens else Severity.WARNING
            issues.append(ValidationIssue(
                severity=sev, category="unresolved",
                message=f"Token '{tok}' is UNRESOLVED — no database column mapped",
                token=tok, fix_hint="Correct the mapping or remove this token",
                fix_candidates=meta_candidates.get(tok, []),
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 3: Column existence in DB
# ---------------------------------------------------------------------------

def check_column_existence(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    issues = []
    mapping = contract.get("mapping", {})
    tables = set(loader.table_names())

    for tok, col_ref in mapping.items():
        if col_ref in ("UNRESOLVED", "LATER_SELECTED") or col_ref.startswith("PARAM:"):
            continue
        m = DIRECT_COL_RE.match(col_ref)
        if not m:
            continue
        table, column = m.group(1), m.group(2)

        if table not in tables:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="column_exists",
                message=f"Table '{table}' does not exist in database",
                token=tok, detail=f"Mapping: {tok} → {col_ref}",
                fix_hint=f"Available tables: {', '.join(sorted(tables)[:10])}",
            ))
            continue

        try:
            df = loader.frame(table)
            if column not in df.columns:
                available = sorted(df.columns)
                col_lower = column.lower()
                candidates = [c for c in available if col_lower[:4] in c.lower() or c.lower()[:4] in col_lower][:5]
                issues.append(ValidationIssue(
                    severity=Severity.ERROR, category="column_exists",
                    message=f"Column '{column}' does not exist in table '{table}'",
                    token=tok, detail=f"Mapping: {tok} → {col_ref}",
                    fix_hint=f"Available columns: {', '.join(available[:10])}",
                    fix_candidates=candidates if candidates else available[:5],
                ))
        except Exception as exc:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="column_exists",
                message=f"Could not verify column '{col_ref}': {exc}",
                token=tok,
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 4: Join columns
# ---------------------------------------------------------------------------

def check_join_columns(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    issues = []
    join = contract.get("join", {})
    if not join:
        return issues

    tables = set(loader.table_names())

    for role, table_key, col_key in [
        ("parent", "parent_table", "parent_key"),
        ("child", "child_table", "child_key"),
    ]:
        table = join.get(table_key, "")
        col_raw = join.get(col_key, "")
        if not table or not col_raw:
            continue
        # Handle comma-separated keys and table.column format
        col_parts = [c.strip() for c in str(col_raw).split(",") if c.strip()]
        for col in col_parts:
            # Strip table prefix if present (e.g. "recipes.id" → "id")
            if "." in col:
                col = col.split(".", 1)[1]
            if col == "__rowid__":
                continue

            if table not in tables:
                issues.append(ValidationIssue(
                    severity=Severity.ERROR, category="join_valid",
                    message=f"Join {role} table '{table}' does not exist",
                ))
                break

            try:
                df = loader.frame(table)
                if col not in df.columns:
                    issues.append(ValidationIssue(
                        severity=Severity.ERROR, category="join_valid",
                        message=f"Join {role} column '{col}' not in table '{table}'",
                        fix_hint=f"Available: {', '.join(sorted(df.columns)[:10])}",
                    ))
            except Exception:
                pass

    return issues


# ---------------------------------------------------------------------------
# Check 5: Date columns parseable
# ---------------------------------------------------------------------------

def check_date_columns(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    issues = []
    date_cols = contract.get("date_columns", {})
    if not date_cols:
        return issues

    tables = set(loader.table_names())

    for table, col in date_cols.items():
        if table not in tables:
            continue
        try:
            df = loader.frame(table)
            if col not in df.columns:
                issues.append(ValidationIssue(
                    severity=Severity.ERROR, category="date_valid",
                    message=f"Date column '{col}' not in table '{table}'",
                ))
                continue
            sample = df[col].dropna().head(20)
            if len(sample) == 0:
                issues.append(ValidationIssue(
                    severity=Severity.WARNING, category="date_valid",
                    message=f"Date column '{table}.{col}' has no non-null values",
                ))
                continue
            parsed = pd.to_datetime(sample, errors="coerce")
            fail_rate = parsed.isna().sum() / len(parsed)
            if fail_rate > 0.5:
                issues.append(ValidationIssue(
                    severity=Severity.ERROR, category="date_valid",
                    message=f"Date column '{table}.{col}': {fail_rate:.0%} values fail to parse as dates",
                    detail=f"Sample values: {list(sample.head(3))}",
                ))
        except Exception as exc:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="date_valid",
                message=f"Could not verify date column '{table}.{col}': {exc}",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 6: Required filters have data
# ---------------------------------------------------------------------------

def check_required_filters(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    issues = []
    filters = contract.get("filters", contract.get("report_filters", {}))
    required = filters.get("required", {})
    if not required:
        return issues

    tables = set(loader.table_names())

    for name, fdef in required.items():
        table = fdef.get("table", "")
        col = fdef.get("column", "")
        if not table or not col or table not in tables:
            continue
        try:
            df = loader.frame(table)
            if col in df.columns:
                unique_count = df[col].nunique()
                if unique_count == 0:
                    issues.append(ValidationIssue(
                        severity=Severity.ERROR, category="filter_valid",
                        message=f"Required filter '{name}' ({table}.{col}) has 0 unique values",
                    ))
        except Exception:
            pass

    return issues


# ---------------------------------------------------------------------------
# Check 7: Reshape rules
# ---------------------------------------------------------------------------

def check_reshape_rules(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    """Validate reshape rules: check that all referenced columns exist in the DB."""
    issues = []
    rules = contract.get("reshape_rules", [])
    if not rules:
        return issues

    tables = set(loader.table_names())
    columns_cache: dict[str, set[str]] = {}

    def _get_columns(table: str) -> set[str]:
        if table not in columns_cache:
            try:
                columns_cache[table] = set(loader.frame(table).columns)
            except Exception:
                columns_cache[table] = set()
        return columns_cache[table]

    for i, rule in enumerate(rules):
        strategy = rule.get("strategy", "")
        columns = rule.get("columns", [])

        # Validate column specs: each has "as" and "from" (list of table.column refs)
        for col_spec in columns:
            alias = col_spec.get("as", "")
            froms = col_spec.get("from", [])

            if not froms or froms == ["INDEX"]:
                continue  # INDEX is a virtual source, not a DB column

            for src in froms:
                if not isinstance(src, str):
                    continue
                m = DIRECT_COL_RE.match(src)
                if not m:
                    continue
                table, col = m.group(1), m.group(2)
                if table not in tables:
                    issues.append(ValidationIssue(
                        severity=Severity.ERROR, category="reshape",
                        message=f"Reshape rule {i} ({strategy}): table '{table}' does not exist",
                        detail=f"Column spec '{alias}' references '{src}'",
                    ))
                    break  # one error per alias is enough
                db_cols = _get_columns(table)
                if col not in db_cols:
                    issues.append(ValidationIssue(
                        severity=Severity.ERROR, category="reshape",
                        message=f"Reshape rule {i} ({strategy}): column '{col}' not in table '{table}'",
                        detail=f"Column spec '{alias}' references '{src}'",
                        fix_hint=f"Available columns: {', '.join(sorted(db_cols)[:15])}",
                    ))
                    break

        # Validate cardinality: all non-INDEX column specs should have the same number of sources
        non_index_counts = [
            len(cs.get("from", []))
            for cs in columns
            if cs.get("from", []) != ["INDEX"]
        ]
        if non_index_counts and len(set(non_index_counts)) > 1:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="reshape",
                message=f"Reshape rule {i} ({strategy}): column specs have different source counts: {non_index_counts}",
                detail="All MELT columns should have the same number of sources for consistent row counts",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 8: Key combination limit
# ---------------------------------------------------------------------------

def check_key_combination_limit(key_values: dict | None = None, **_) -> list[ValidationIssue]:
    issues = []
    if not key_values:
        return issues

    product = 1
    for vals in key_values.values():
        if isinstance(vals, list) and vals:
            product *= len(vals)

    if product > 5000:
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="key_limit",
            message=f"Key combination count ({product:,}) exceeds limit (5,000)",
            fix_hint="Reduce the number of selected key values",
        ))
    elif product > 500:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="key_limit",
            message=f"Key combination count ({product:,}) is high — generation may be slow",
        ))

    return issues


# ---------------------------------------------------------------------------
# Check 9: Row count estimate
# ---------------------------------------------------------------------------

def check_row_count_estimate(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    issues = []
    mapping = contract.get("mapping", {})

    # Find the main table (most mapped columns)
    table_counts: dict[str, int] = {}
    for col_ref in mapping.values():
        m = DIRECT_COL_RE.match(col_ref or "")
        if m:
            table_counts[m.group(1)] = table_counts.get(m.group(1), 0) + 1

    if not table_counts:
        return issues

    main_table = max(table_counts, key=table_counts.get)
    try:
        df = loader.frame(main_table)
        row_count = len(df)

        if row_count > 100_000:
            issues.append(ValidationIssue(
                severity=Severity.ERROR, category="row_estimate",
                message=f"Table '{main_table}' has {row_count:,} rows — too many for PDF rendering",
                fix_hint="Use date filters to limit the data range",
            ))
        elif row_count > 10_000:
            issues.append(ValidationIssue(
                severity=Severity.WARNING, category="row_estimate",
                message=f"Table '{main_table}' has {row_count:,} rows — report may be very large",
            ))
        else:
            issues.append(ValidationIssue(
                severity=Severity.INFO, category="row_estimate",
                message=f"Table '{main_table}': {row_count:,} total rows",
            ))
    except Exception:
        pass

    return issues


# ---------------------------------------------------------------------------
# Check 10: Mapping semantic consistency (heuristic audit)
# ---------------------------------------------------------------------------

_DATE_TOKEN_RE = re.compile(r"(^|_)(date|time)(_|$)", re.IGNORECASE)
_AMOUNT_TOKEN_RE = re.compile(
    r"(^|_)(amount|total|price|cost|qty|quantity|sum|balance)(_|$)", re.IGNORECASE,
)
_ROW_PREFIX_RE = re.compile(r"^row_", re.IGNORECASE)


def check_mapping_semantics(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    """Heuristic mapping audit — replaces LLM-based Call 3A."""
    issues: list[ValidationIssue] = []
    mapping = contract.get("mapping", {})
    row_tokens = set(contract.get("tokens", {}).get("row_tokens", []))
    tables = set(loader.table_names())

    for tok, col_ref in mapping.items():
        if col_ref in ("UNRESOLVED", "LATER_SELECTED") or col_ref.startswith("PARAM:"):
            continue
        m = DIRECT_COL_RE.match(col_ref)
        if not m:
            continue
        table, column = m.group(1), m.group(2)
        if table not in tables:
            continue

        try:
            df = loader.frame(table)
        except Exception:
            continue

        if column not in df.columns:
            continue

        col_series = df[column]
        col_dtype = col_series.dtype

        # --- Date/time token mapped to non-date column ---
        if _DATE_TOKEN_RE.search(tok):
            if not pd.api.types.is_datetime64_any_dtype(col_dtype):
                # Allow if the string column actually parses as dates
                sample = col_series.dropna().head(20)
                parsed = pd.to_datetime(sample, errors="coerce")
                parseable = parsed.notna().sum() / max(len(sample), 1)
                if parseable < 0.5:
                    issues.append(ValidationIssue(
                        severity=Severity.WARNING,
                        category="mapping_semantics",
                        message=(
                            f"Token '{tok}' looks like a date/time token but column "
                            f"'{col_ref}' is not a date type (dtype={col_dtype})"
                        ),
                        token=tok,
                        detail=f"Only {parseable:.0%} of sampled values parse as dates",
                        fix_hint="Verify the mapping — the token name suggests a date column",
                    ))

        # --- Amount/total/price/cost token mapped to non-numeric column ---
        if _AMOUNT_TOKEN_RE.search(tok):
            if not pd.api.types.is_numeric_dtype(col_dtype):
                issues.append(ValidationIssue(
                    severity=Severity.WARNING,
                    category="mapping_semantics",
                    message=(
                        f"Token '{tok}' looks like a numeric token but column "
                        f"'{col_ref}' is not numeric (dtype={col_dtype})"
                    ),
                    token=tok,
                    fix_hint="Verify the mapping — the token name suggests a numeric column",
                ))

        # --- row_* token mapped to column with <10 unique values ---
        if _ROW_PREFIX_RE.match(tok):
            try:
                nunique = col_series.nunique()
                if nunique < 10:
                    issues.append(ValidationIssue(
                        severity=Severity.WARNING,
                        category="mapping_semantics",
                        message=(
                            f"Token '{tok}' has row_ prefix but column '{col_ref}' "
                            f"has only {nunique} unique values — likely a scalar, not a row token"
                        ),
                        token=tok,
                        fix_hint="Consider moving this token to scalars instead of row_tokens",
                    ))
            except Exception:
                pass

        # --- Token without row_ prefix but listed in row_tokens ---
        if not _ROW_PREFIX_RE.match(tok) and tok in row_tokens:
            issues.append(ValidationIssue(
                severity=Severity.INFO,
                category="mapping_semantics",
                message=(
                    f"Token '{tok}' is in row_tokens but does not have a row_ prefix"
                ),
                token=tok,
                detail="Not necessarily wrong, but unusual naming convention",
            ))

    return issues


# ---------------------------------------------------------------------------
# Check 11: row_computed / totals_math reference validity
# ---------------------------------------------------------------------------

def _extract_token_refs(expr: Any) -> set[str]:
    """Extract token references from a computed expression (recursive)."""
    refs = set()
    if isinstance(expr, str):
        refs.add(expr)
    elif isinstance(expr, dict):
        for key in ("column", "left", "right", "numerator", "denominator"):
            if key in expr:
                refs.update(_extract_token_refs(expr[key]))
        for key in ("columns",):
            if key in expr and isinstance(expr[key], list):
                for item in expr[key]:
                    refs.update(_extract_token_refs(item))
    return refs


def check_computed_references(contract: dict, **_) -> list[ValidationIssue]:
    """Verify that row_computed and totals_math reference tokens that exist."""
    issues = []
    tokens_section = contract.get("tokens", {})
    all_declared = set()
    for key in ("scalars", "row_tokens", "totals"):
        all_declared.update(tokens_section.get(key, []))

    # Also include mapping keys
    all_declared.update(contract.get("mapping", {}).keys())

    # Check row_computed
    for name, expr in contract.get("row_computed", {}).items():
        refs = _extract_token_refs(expr)
        for ref in refs:
            if ref not in all_declared and not ref.replace("_", "").isdigit():
                issues.append(ValidationIssue(
                    severity=Severity.WARNING, category="computed_ref",
                    message=f"row_computed '{name}' references unknown token '{ref}'",
                    token=name,
                    detail="May cause empty values at generation time",
                ))

    # Check totals_math
    for name, expr in contract.get("totals_math", contract.get("totals", {})).items():
        if not isinstance(expr, dict):
            continue
        refs = _extract_token_refs(expr)
        for ref in refs:
            if ref not in all_declared and not ref.replace("_", "").isdigit():
                issues.append(ValidationIssue(
                    severity=Severity.WARNING, category="computed_ref",
                    message=f"totals_math '{name}' references unknown token '{ref}'",
                    token=name,
                ))

    return issues


# ---------------------------------------------------------------------------
# Check 12: Discovery feasibility (can we actually find batches?)
# ---------------------------------------------------------------------------

def check_discovery_feasibility(contract: dict, loader: Any, **_) -> list[ValidationIssue]:
    """Verify the contract has enough info for discover_batches_and_counts to work."""
    issues = []
    join = contract.get("join", {})
    parent_table = join.get("parent_table", "")
    date_columns = contract.get("date_columns", {})

    if not parent_table:
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="discovery",
            message="No parent_table in join config — discovery cannot work",
            fix_hint="Contract must have join.parent_table set",
        ))
        return issues

    tables = set(loader.table_names())
    if parent_table not in tables:
        issues.append(ValidationIssue(
            severity=Severity.ERROR, category="discovery",
            message=f"Parent table '{parent_table}' does not exist in database",
        ))
        return issues

    # Check date column exists for filtering
    date_col = date_columns.get(parent_table, "")
    if not date_col:
        issues.append(ValidationIssue(
            severity=Severity.WARNING, category="discovery",
            message=f"No date column configured for parent table '{parent_table}' — date filtering disabled",
        ))
    elif date_col:
        try:
            df = loader.frame(parent_table)
            if date_col not in df.columns:
                issues.append(ValidationIssue(
                    severity=Severity.ERROR, category="discovery",
                    message=f"Date column '{date_col}' not in table '{parent_table}'",
                    fix_hint=f"Available: {', '.join(sorted(df.columns)[:10])}",
                ))
        except Exception:
            pass

    return issues


# ---------------------------------------------------------------------------
# Run all checks
# ---------------------------------------------------------------------------

ALL_CHECKS = [
    check_template_token_match,
    check_unresolved_tokens,
    check_column_existence,
    check_join_columns,
    check_date_columns,
    check_required_filters,
    check_reshape_rules,
    check_key_combination_limit,
    check_row_count_estimate,
    check_mapping_semantics,
    check_computed_references,
    check_discovery_feasibility,
]


def run_all_deterministic(
    contract: dict,
    template_html: str,
    loader: Any,
    key_values: dict | None = None,
) -> list[ValidationIssue]:
    all_issues = []
    for check_fn in ALL_CHECKS:
        try:
            issues = check_fn(
                contract=contract,
                template_html=template_html,
                loader=loader,
                key_values=key_values,
            )
            all_issues.extend(issues)
        except Exception as exc:
            logger.warning(f"Check {check_fn.__name__} failed: {exc}")
            all_issues.append(ValidationIssue(
                severity=Severity.WARNING, category="internal",
                message=f"Check '{check_fn.__name__}' failed internally: {exc}",
            ))
    return all_issues
