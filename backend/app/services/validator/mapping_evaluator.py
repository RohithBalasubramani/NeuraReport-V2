# mypy: ignore-errors
"""
Multi-Candidate Mapping Evaluator.

Generates 2-3 candidate mappings via LLM with temperature sampling,
scores each on 3 axes (name similarity, type alignment, distribution),
picks the best OR flags ambiguity for user review.

This replaces single-shot mapping which allows subtle column swaps
(e.g. bin1_sp vs bin1_act) to survive undetected.
"""
from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from typing import Any, Optional

from .mapping_sanity import (
    _infer_token_type,
    _is_numeric_string,
    run_all_sanity_checks,
    NUMERIC_SQL_TYPES,
    TEXT_SQL_TYPES,
)

logger = logging.getLogger("neura.validator.mapping_evaluator")

# ── Alias expansion tables ────────────────────────────────────────────

# Column abbreviation → expanded forms
COLUMN_ALIASES: dict[str, list[str]] = {
    "sp": ["set", "setpoint", "set_weight", "set_wt", "target"],
    "act": ["actual", "achieved", "ach", "measured", "ach_wt"],
    "content": ["name", "material", "description", "label", "desc"],
    "err": ["error", "diff", "deviation"],
    "pct": ["percent", "percentage", "ratio"],
    "qty": ["quantity", "amount", "count"],
    "ts": ["timestamp", "time", "datetime"],
    "dt": ["date", "datetime"],
    "no": ["number", "num", "id"],
    "wt": ["weight", "mass"],
}

# Token abbreviation → expanded forms
TOKEN_ALIASES: dict[str, list[str]] = {
    "set_wt": ["sp", "setpoint", "target", "set_weight"],
    "ach_wt": ["act", "actual", "achieved", "measured"],
    "material_name": ["content", "description", "label", "material"],
    "batch_no": ["id", "batch_id", "batch_number", "number"],
    "recipe_code": ["recipe_name", "recipe", "code"],
    "sl_no": ["index", "serial", "row_number", "seq"],
    "error": ["err", "diff", "deviation"],
}


def _normalize_token(token: str) -> str:
    """Normalize token name for comparison: strip row_ prefix, expand abbreviations."""
    t = token.lower()
    if t.startswith("row_"):
        t = t[4:]
    if t.startswith("total_"):
        t = t[6:]
    # Expand known abbreviations
    parts = re.split(r"[_\s]+", t)
    expanded = []
    for p in parts:
        expanded.append(p)
    return " ".join(expanded)


def _normalize_column(column: str) -> str:
    """Normalize column name for comparison: strip table prefix, expand abbreviations."""
    c = column.lower()
    if "." in c:
        c = c.split(".", 1)[1]
    # Expand known column abbreviations
    parts = re.split(r"[_\s]+", c)
    expanded = []
    for p in parts:
        # Strip leading digits (bin1 → bin, bin12 → bin)
        base = re.sub(r"\d+$", "", p)
        if base in COLUMN_ALIASES:
            expanded.extend(COLUMN_ALIASES[base][:1])  # Use primary expansion
        else:
            expanded.append(p)
    return " ".join(expanded)


# ── Axis 1: Name Similarity ──────────────────────────────────────────

def score_name_similarity(token: str, column: str) -> float:
    """Score 0.0-1.0 based on fuzzy string match + semantic alias matching."""
    tok_norm = _normalize_token(token)
    col_norm = _normalize_column(column)

    # Direct SequenceMatcher ratio
    ratio = SequenceMatcher(None, tok_norm, col_norm).ratio()

    # Bonus: check if token aliases match column aliases
    tok_base = token.lower().removeprefix("row_").removeprefix("total_")
    col_base = column.lower().split(".", 1)[-1]
    col_stripped = re.sub(r"\d+", "", col_base)  # bin1_sp → bin_sp → sp

    # Check TOKEN_ALIASES: does any alias of the token match the column?
    for tok_pattern, aliases in TOKEN_ALIASES.items():
        if tok_pattern in tok_base:
            for alias in aliases:
                if alias in col_stripped:
                    ratio = max(ratio, 0.75)
                    break

    # Check COLUMN_ALIASES: does any expansion of the column match the token?
    for col_abbr, expansions in COLUMN_ALIASES.items():
        if col_abbr in col_stripped:
            for exp in expansions:
                if exp in tok_base:
                    ratio = max(ratio, 0.7)
                    break

    return min(ratio, 1.0)


# ── Axis 2: Type Alignment ───────────────────────────────────────────

def score_type_alignment(token: str, column: str, column_types: dict[str, str]) -> float:
    """Binary 0.0 or 1.0: does token type expectation match column's actual type?"""
    col = column.split(".", 1)[1] if "." in column else column
    col_type = column_types.get(col, "").upper()
    if not col_type:
        return 0.5  # unknown type → neutral

    expected = _infer_token_type(token)
    if expected == "unknown":
        return 0.5  # can't infer → neutral

    TYPE_COMPAT = {
        "numeric": NUMERIC_SQL_TYPES,
        "text": TEXT_SQL_TYPES | {"TEXT"},  # TEXT is always compatible with text tokens
        "datetime": {"TEXT", "DATETIME", "TIMESTAMP", "DATE"},
    }

    compatible = TYPE_COMPAT.get(expected, set())
    return 1.0 if col_type in compatible else 0.0


# ── Axis 3: Distribution Alignment ───────────────────────────────────

def _looks_like_datetime(v: str) -> bool:
    """Heuristic: does a string look like a date/timestamp?"""
    return bool(re.search(r"\d{4}[-/]\d{2}[-/]\d{2}", v))


def _is_sequential(values: list) -> bool:
    """Check if values form a sequential integer series (1, 2, 3, ...)."""
    try:
        nums = [int(float(v)) for v in values if _is_numeric_string(v)]
        if len(nums) < 3:
            return False
        diffs = [nums[i + 1] - nums[i] for i in range(len(nums) - 1)]
        return len(set(diffs)) == 1 and diffs[0] == 1
    except (ValueError, TypeError):
        return False


def score_distribution_alignment(
    token: str,
    column: str,
    sample_rows: list[dict[str, Any]],
) -> float:
    """Score 0.0-1.0 based on sampled data characteristics."""
    col = column.split(".", 1)[1] if "." in column else column
    values = [row.get(col) for row in sample_rows if row.get(col) is not None]
    if not values:
        return 0.0

    score = 0.5  # neutral baseline
    expected = _infer_token_type(token)

    if expected == "numeric":
        numeric_count = sum(1 for v in values if _is_numeric_string(v))
        score = numeric_count / len(values) if values else 0.0
    elif expected == "text":
        text_count = sum(1 for v in values if isinstance(v, str) and not _is_numeric_string(v))
        score = text_count / len(values) if values else 0.0
    elif expected == "datetime":
        dt_count = sum(1 for v in values if _looks_like_datetime(str(v)))
        score = dt_count / len(values) if values else 0.0

    # Bonus: sequential check for sl_no/index tokens
    tok_low = token.lower()
    if "sl_no" in tok_low or "index" in tok_low or "serial" in tok_low:
        if _is_sequential(values):
            score = min(score + 0.3, 1.0)

    return score


# ── Candidate scoring and selection ───────────────────────────────────

SCORE_WEIGHTS = {"name": 0.4, "type": 0.3, "distribution": 0.3}

# Margin within which two candidates are considered "close" → ask user
AMBIGUITY_THRESHOLD = 0.1


def score_candidate(
    candidate: dict[str, str],
    tokens: list[str],
    column_types: dict[str, str],
    sample_rows: list[dict[str, Any]],
) -> dict:
    """Score a single candidate mapping. Returns {mapping, score, token_scores}."""
    total = 0.0
    token_scores: dict[str, dict[str, float]] = {}

    for token in tokens:
        col = candidate.get(token, "UNRESOLVED")
        if col == "UNRESOLVED" or ":" in col:
            token_scores[token] = {"name": 0.0, "type": 0.0, "distribution": 0.0, "weighted": 0.0}
            continue

        s_name = score_name_similarity(token, col)
        s_type = score_type_alignment(token, col, column_types)
        s_dist = score_distribution_alignment(token, col, sample_rows)

        weighted = (
            s_name * SCORE_WEIGHTS["name"]
            + s_type * SCORE_WEIGHTS["type"]
            + s_dist * SCORE_WEIGHTS["distribution"]
        )
        token_scores[token] = {"name": s_name, "type": s_type, "distribution": s_dist, "weighted": weighted}
        total += weighted

    avg = total / len(tokens) if tokens else 0.0
    return {"mapping": candidate, "score": round(avg, 4), "token_scores": token_scores}


def select_best_mapping(
    candidates: list[dict[str, str]],
    tokens: list[str],
    column_types: dict[str, str],
    sample_rows: list[dict[str, Any]],
) -> tuple[dict, Optional[dict], bool]:
    """
    Score all candidates and select the best.

    Returns: (best_scored, runner_up_scored_or_None, needs_user_confirmation)
    needs_user_confirmation=True when top 2 are within AMBIGUITY_THRESHOLD.
    """
    scored = [score_candidate(c, tokens, column_types, sample_rows) for c in candidates]
    scored.sort(key=lambda x: x["score"], reverse=True)

    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None

    needs_confirmation = (
        runner_up is not None
        and abs(best["score"] - runner_up["score"]) < AMBIGUITY_THRESHOLD
    )

    logger.info(
        "mapping_candidates_scored",
        extra={
            "event": "mapping_candidates_scored",
            "n_candidates": len(scored),
            "best_score": best["score"],
            "runner_up_score": runner_up["score"] if runner_up else None,
            "needs_confirmation": needs_confirmation,
        },
    )

    return best, runner_up, needs_confirmation


def deduplicate_mappings(candidates: list[dict[str, str]]) -> list[dict[str, str]]:
    """Remove identical candidate mappings."""
    seen: list[str] = []
    unique: list[dict[str, str]] = []
    for c in candidates:
        key = str(sorted(c.items()))
        if key not in seen:
            seen.append(key)
            unique.append(c)
    return unique
