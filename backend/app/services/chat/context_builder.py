# mypy: ignore-errors
"""
Pipeline Context Builder.

Assembles a [PIPELINE_CONTEXT] block injected into every unified prompt call.
Contains: pipeline state, template HTML summary, DB schema, mapping, contract,
errors — all budget-aware to fit Qwen's context window.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from .session import ChatSession

logger = logging.getLogger("neura.chat.context")

# Budget limits (chars) — total ~33K to fit 32K-65K token window
_BUDGET = {
    "state": 500,
    "template": 8000,
    "schema": 500,
    "catalog": 4000,
    "mapping": 2000,
    "contract": 2000,
    "errors": 1000,
    "history": 12000,
}

TOKEN_RE = re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")


def build_pipeline_context(
    session: ChatSession,
    template_id: Optional[str] = None,
    connection_id: Optional[str] = None,
    template_dir: Optional[Path] = None,
    db_path: Optional[Path] = None,
) -> str:
    """
    Build the [PIPELINE_CONTEXT] block for the unified prompt.

    Each section is only included when relevant data exists.
    Budget-aware: truncates sections to fit context window.
    """
    sections = []

    # ── STATE ──
    state_parts = [f"Pipeline state: {session.pipeline_state.value}"]
    if session.completed_stages:
        state_parts.append(f"Completed: {', '.join(session.completed_stages)}")
    if session.connection_id:
        state_parts.append(f"Connection: {session.connection_id}")
    if session.needs_reapproval:
        state_parts.append("⚠ Template edited after approval — contract needs re-approval")
    sections.append(_section("STATE", "\n".join(state_parts), _BUDGET["state"]))

    # ── TEMPLATE ──
    if template_dir:
        html = _load_template_html(template_dir)
        if html:
            tokens = sorted(set(TOKEN_RE.findall(html)))
            summary = f"{len(html)} chars, {len(tokens)} tokens: {', '.join(tokens[:15])}"
            if len(tokens) > 15:
                summary += f"... (+{len(tokens)-15} more)"
            # Include truncated HTML structure (head + first table + token locations)
            html_preview = _truncate_html(html, _BUDGET["template"] - len(summary) - 50)
            sections.append(_section("TEMPLATE", f"{summary}\n\n{html_preview}", _BUDGET["template"]))

    # ── SCHEMA ──
    if template_dir:
        schema = _load_json(template_dir / "schema_ext.json")
        if schema:
            parts = []
            for key in ("scalars", "row_tokens", "totals"):
                vals = schema.get(key, [])
                if vals:
                    parts.append(f"{key}: {vals}")
            if parts:
                sections.append(_section("SCHEMA", "\n".join(parts), _BUDGET["schema"]))

    # ── DATABASE CATALOG ──
    if db_path and db_path.exists():
        catalog_text = _build_catalog(db_path)
        if catalog_text:
            sections.append(_section("DATABASE", catalog_text, _BUDGET["catalog"]))

    # ── MAPPING ──
    if template_dir:
        mapping = _load_mapping(template_dir)
        if mapping:
            lines = []
            for tok, col in sorted(mapping.items()):
                icon = "✓" if col not in ("UNRESOLVED", "LATER_SELECTED") and not col.startswith("PARAM:") else "✗"
                lines.append(f"  {icon} {tok} → {col}")
            sections.append(_section("MAPPING", "\n".join(lines), _BUDGET["mapping"]))

    # ── CONTRACT SUMMARY ──
    if template_dir:
        contract = _load_json(template_dir / "contract.json")
        if contract:
            summary = _summarize_contract(contract)
            sections.append(_section("CONTRACT", summary, _BUDGET["contract"]))

    # ── ERRORS ──
    if session.invalidated_stages:
        sections.append(_section("ERRORS", f"Invalidated stages: {', '.join(session.invalidated_stages)}", _BUDGET["errors"]))

    if not sections:
        return "No context available yet. User needs to upload a PDF or describe a report."

    return "\n\n".join(sections)


def build_conversation_context(
    conversation_history: list[dict],
    max_chars: int = 12000,
) -> list[dict]:
    """
    Build conversation history for the LLM, with sliding window + summarization.

    Returns a trimmed list of messages that fits within max_chars.
    """
    if not conversation_history:
        return []

    # Calculate total size
    total = sum(len(m.get("content", "")) for m in conversation_history)
    if total <= max_chars:
        return conversation_history

    # Keep last N messages that fit, summarize the rest
    kept = []
    remaining = max_chars - 200  # reserve for summary
    for msg in reversed(conversation_history):
        content_len = len(msg.get("content", ""))
        if content_len <= remaining:
            kept.insert(0, msg)
            remaining -= content_len
        else:
            break

    # Summarize dropped messages
    dropped = len(conversation_history) - len(kept)
    if dropped > 0:
        summary_msg = {
            "role": "system",
            "content": f"[Earlier conversation: {dropped} messages summarized] "
                       f"The user and assistant discussed template creation/editing. "
                       f"Key decisions were made about the template structure and data mapping."
        }
        kept.insert(0, summary_msg)

    return kept


# ── Internal helpers ──

def _section(name: str, content: str, budget: int) -> str:
    """Format a context section, truncated to budget."""
    header = f"[{name}]"
    if len(content) > budget:
        content = content[:budget - 20] + "\n... (truncated)"
    return f"{header}\n{content}"


def _load_template_html(template_dir: Path) -> str:
    """Load the current template HTML."""
    for name in ("report_final.html", "template_p1.html"):
        p = template_dir / name
        if p.exists() and p.stat().st_size > 0:
            return p.read_text(encoding="utf-8", errors="ignore")
    return ""


def _truncate_html(html: str, max_chars: int) -> str:
    """Truncate HTML keeping structure visible."""
    if len(html) <= max_chars:
        return html
    # Keep head + first 500 chars of body + last 500 chars
    head_end = html.find("</head>")
    if head_end > 0 and head_end < max_chars // 2:
        head = html[:head_end + 7]
        body_start = html.find("<body", head_end)
        if body_start > 0:
            body_preview = html[body_start:body_start + (max_chars - len(head)) // 2]
            body_end = html[-(max_chars - len(head)) // 2:]
            return f"{head}\n{body_preview}\n... (middle truncated) ...\n{body_end}"
    return html[:max_chars]


def _load_json(path: Path) -> Optional[dict]:
    """Load a JSON file, return None on failure."""
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _load_mapping(template_dir: Path) -> Optional[dict]:
    """Load the current mapping from mapping_step3.json or contract.json."""
    # Try mapping_step3 first (from preview), then contract
    for name in ("mapping_step3.json", "mapping_pdf_labels.json", "contract.json"):
        data = _load_json(template_dir / name)
        if data:
            mapping = data.get("mapping", {})
            if mapping:
                return mapping
    return None


def _build_catalog(db_path: Path) -> str:
    """Build a DB catalog summary with sample values."""
    try:
        from backend.app.repositories.dataframes.sqlite_loader import SQLiteDataFrameLoader
        loader = SQLiteDataFrameLoader(str(db_path))
        tables = loader.table_names()
        parts = []
        for table in tables[:5]:  # Top 5 tables
            try:
                df = loader.frame(table)
                cols = []
                for col in list(df.columns)[:20]:  # 20 cols per table
                    dtype = str(df[col].dtype)
                    sample = ""
                    non_null = df[col].dropna().head(2)
                    if len(non_null) > 0:
                        sample = f" e.g. {non_null.iloc[0]}"
                    cols.append(f"    {col}({dtype}){sample}")
                parts.append(f"  {table} ({len(df)} rows):\n" + "\n".join(cols))
            except Exception:
                parts.append(f"  {table}: (could not load)")
        return "\n".join(parts)
    except Exception as exc:
        return f"(catalog unavailable: {exc})"


def _summarize_contract(contract: dict) -> str:
    """Summarize a contract for context injection."""
    parts = []
    tokens = contract.get("tokens", {})
    parts.append(f"Scalars: {tokens.get('scalars', [])}")
    parts.append(f"Row tokens: {tokens.get('row_tokens', [])}")
    parts.append(f"Totals: {tokens.get('totals', [])}")

    join = contract.get("join", {})
    if join:
        parts.append(f"Join: {join.get('parent_table', '?')} → {join.get('child_table', '?')}")

    date_cols = contract.get("date_columns", {})
    if date_cols:
        parts.append(f"Date filters: {date_cols}")

    filters = contract.get("filters", {})
    if filters:
        parts.append(f"Filters: {list(filters.get('required', {}).keys())}")

    return "\n".join(parts)
