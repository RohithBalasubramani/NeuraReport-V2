# mypy: ignore-errors
"""
Intent classifier for the unified chat pipeline.

Three-tier resolution:
  1. Explicit ``action`` field from frontend (button clicks)
  2. Pattern matching on latest user message (fast, no LLM)
  3. Fallback to ``"chat"`` — the LLM handles it conversationally
"""
from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger("neura.chat.intent")


# ---------------------------------------------------------------------------
# Tier 2: keyword / regex patterns
# ---------------------------------------------------------------------------

_ACTION_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("verify",    re.compile(r"(?i)\b(upload|verify|convert|new template|import\b.*\b(?:pdf|excel|file))\b")),
    ("correct",   re.compile(r"(?i)\b(correct|fix\s+(?:the\s+)?mapping|change\s+(?:the\s+)?mapping|wrong column|remap|re[\s\-]?map)\b")),
    ("map",       re.compile(r"(?i)\b(map\b|mapping|connect to|auto[\s\-]?map|link tokens|map tokens)\b")),
    ("approve",   re.compile(r"(?i)\b(approve|looks good|accept mapping|finalize|freeze)\b")),
    ("validate",  re.compile(r"(?i)\b(validate|preflight|dry[\s\-]?run|test[\s\-]?run|check pipeline|verify pipeline)\b")),
    ("edit",      re.compile(r"(?i)\b(change|edit|modify|update|style|color|font|layout|move|add|remove|header|footer|border|padding|margin)\b")),
    ("build_assets", re.compile(r"(?i)\b(build generator|generator assets|build sql|build assets)\b")),
    ("generate",  re.compile(r"(?i)\b(generate|run report|create report|produce|render report)\b")),
    ("discover",  re.compile(r"(?i)\b(discover|find batches|show batches|list reports|available batches)\b")),
    ("key_options", re.compile(r"(?i)\b(key options|filter options|filter values|available values)\b")),
    ("status",    re.compile(r"(?i)\b(status|where am i|what.s next|progress|what stage)\b")),
]

# Patterns that should NOT trigger "edit" when they are clearly about
# something else (e.g. "change mapping" → correct, not edit)
_EDIT_SUPPRESSORS = re.compile(
    r"(?i)\b(mapping|map|column|token|database|connection|report|generate|approve)\b"
)


# ---------------------------------------------------------------------------
# State-action compatibility
# ---------------------------------------------------------------------------

# Which states each action is valid in. If the current state is not listed,
# the orchestrator will respond with guidance instead of executing.
_VALID_STATES: dict[str, set[str]] = {
    "verify":       {"empty", "html_ready", "mapped", "approved", "ready"},  # re-upload allowed
    "map":          {"html_ready"},
    "correct":      {"mapped"},
    "approve":      {"mapped"},
    "edit":         {"html_ready", "mapped", "approved", "ready", "editing"},
    "build_assets": {"approved"},
    "generate":     {"ready", "validated"},
    "discover":     {"approved", "ready"},
    "validate":     {"approved", "validated"},
    "key_options":  {"approved", "validated", "ready"},
    "status":       set(),
    "chat":         set(),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_intent(
    message: str,
    action: Optional[str] = None,
    pipeline_state: str = "empty",
) -> str:
    """
    Classify user intent from the latest message.

    Returns one of: verify, map, correct, approve, edit, build_assets,
    generate, discover, key_options, status, chat.
    """
    # Tier 1: explicit action from frontend button
    if action:
        logger.debug("intent_explicit", extra={"action": action})
        return action

    if not message or not message.strip():
        return "chat"

    text = message.strip()

    # Tier 2: pattern matching
    matches: list[tuple[str, int]] = []
    for intent_name, pattern in _ACTION_PATTERNS:
        m = pattern.search(text)
        if m:
            matches.append((intent_name, m.start()))

    if matches:
        # If only one match, use it
        if len(matches) == 1:
            intent = matches[0][0]
        else:
            # Multiple matches — apply disambiguation rules
            intent = _disambiguate(matches, text)

        logger.debug(
            "intent_pattern",
            extra={"intent": intent, "candidates": [m[0] for m in matches]},
        )
        return intent

    # Tier 3: fallback — let the LLM handle it
    logger.debug("intent_fallback_chat", extra={"message_preview": text[:80]})
    return "chat"


def is_action_valid_for_state(action: str, pipeline_state: str) -> bool:
    """Check if *action* makes sense in the current *pipeline_state*."""
    valid = _VALID_STATES.get(action, set())
    if not valid:
        return True  # empty set means "any state"
    return pipeline_state in valid


def guidance_for_invalid_action(action: str, pipeline_state: str) -> str:
    """Return a helpful message when the user tries an action that doesn't
    match the current pipeline state."""
    _GUIDANCE = {
        ("map", "empty"): "I need a template first. Upload a PDF or describe your report, and I'll create one.",
        ("approve", "empty"): "There's nothing to approve yet. Let's start by creating a template.",
        ("approve", "html_ready"): "We need to map the template tokens to database columns first. Say 'map' or connect a database.",
        ("generate", "empty"): "We need a template and mapping before generating. Let's start from the beginning.",
        ("generate", "mapped"): "The mapping needs to be approved before generating. Say 'approve' to build the contract.",
        ("generate", "approved"): "Almost there! I need to build the generator assets first. Say 'build assets' or I can do it automatically.",
        ("generate", "html_ready"): "We need to map and approve before generating. Say 'map' to connect to your database.",
        ("edit", "empty"): "There's no template to edit yet. Upload a PDF or describe your report to get started.",
        ("correct", "html_ready"): "We need to run the initial mapping first. Say 'map' to auto-map tokens to database columns.",
        ("correct", "empty"): "There's no mapping to correct yet. Let's create a template first.",
        ("discover", "mapped"): "The mapping needs to be approved first. Say 'approve' to build the contract.",
    }
    key = (action, pipeline_state)
    if key in _GUIDANCE:
        return _GUIDANCE[key]

    # Generic fallback
    return (
        f"I can't do '{action}' right now — the pipeline is at '{pipeline_state}'. "
        f"Let me know what you'd like to do next, or say 'status' to see where we are."
    )


# ---------------------------------------------------------------------------
# Disambiguation helpers
# ---------------------------------------------------------------------------

def _disambiguate(matches: list[tuple[str, int]], text: str) -> str:
    """Pick the best intent when multiple patterns match."""
    intent_names = {m[0] for m in matches}

    # "correct" beats "edit" and "map" when both match (e.g. "change the mapping")
    if "correct" in intent_names:
        return "correct"

    # "edit" is suppressed when the message is clearly about something else
    if "edit" in intent_names and len(intent_names) > 1:
        if _EDIT_SUPPRESSORS.search(text):
            for name, _ in matches:
                if name != "edit":
                    return name

    # "map" beats "edit" (e.g. "add mapping")
    if "map" in intent_names and "edit" in intent_names:
        return "map"

    # "generate" beats "edit" (e.g. "create report")
    if "generate" in intent_names and "edit" in intent_names:
        return "generate"

    # Default: pick the earliest match in the message
    matches.sort(key=lambda m: m[1])
    return matches[0][0]
