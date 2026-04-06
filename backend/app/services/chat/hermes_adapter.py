# mypy: ignore-errors
"""
Hermes Adapter — bridges our async pipeline tools to NousResearch hermes-agent.

This module:
1. Registers all 28 pipeline tools into Hermes's ToolRegistry
2. Wraps async tool handlers into sync handlers (Hermes requirement)
3. Preserves ToolContext, preconditions, call limits, and sanitization
4. Provides CallbackBridge mapping Hermes callbacks → NDJSON events

The sanitization gate is INSIDE the handler wrapper, ensuring Hermes's
memory/skills system only ever sees abstract patterns — never raw
column names, mapping values, or schema data.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from typing import Any, Callable

from .tools import (
    TOOL_DISPATCH,
    TOOL_SCHEMAS,
    ToolContext,
    PreconditionError,
    CallLimitExceeded,
    _sanitize_for_agent,
)

logger = logging.getLogger("neura.chat.hermes_adapter")

# ── Context var for passing ToolContext to sync handlers ─────────────
# asyncio.to_thread() copies context vars to the new thread, so
# Hermes's sync handler closures can read the current ToolContext.
_current_ctx: contextvars.ContextVar[ToolContext] = contextvars.ContextVar(
    "hermes_tool_ctx"
)


# ── Hermes native toolsets included in every pipeline state ────────
# These are resolved via the "includes" field in TOOLSETS definitions.
# Each adds ~150-200 tokens of schema — total ~1500 tokens overhead.
_HERMES_NATIVE_TOOLSETS = [
    "memory", "skills", "todo", "clarify", "delegation", "session_search",
    "file", "code_execution", "web",
]

# Workspace mode: everything available — adds terminal + vision on top
_WORKSPACE_TOOLSETS = _HERMES_NATIVE_TOOLSETS + ["terminal", "vision"]

# Tools that are Hermes-internal (not pipeline stages) — frontend styles differently
_HERMES_INTERNAL_TOOLS = {
    "memory", "todo", "skills_list", "skill_view", "skill_manage",
    "session_search", "clarify", "delegate_task",
    "read_file", "write_file", "patch", "search_files", "execute_code",
    "web_search", "web_extract",
}

# ── Sync handler wrapper ────────────────────────────────────────────

TOOL_TIMEOUTS: dict[str, int] = {
    "verify_template": 900,       # PDF upload + HTML gen + OCR (can take 10-15 min)
    "generate_report": 600,       # PDF rendering
    "dry_run_preview": 600,       # Sample report generation
    "auto_map_tokens": 800,       # LLM mapping (2 retries × 360s = 720s max)
    "resolve_mapping_pipeline": 600,  # Atomic map→sanity→contract
    "build_contract": 900,        # Contract JSON generation (8192 tok @ ~10 tok/s)
    "build_generator_assets": 600, # SQL/generator asset creation
    "ocr_pdf_page": 240,          # Single page OCR
}
_DEFAULT_TIMEOUT = 240


_TOOL_LOCK_MAP = {
    "auto_map_tokens": "mapping_preview",
    "resolve_mapping_pipeline": "mapping_preview",
    "verify_template": "template_verify",
    "generate_report": "reports_run",
    "dry_run_preview": "reports_run",
    "build_contract": "mapping_approve",
    "edit_template": "template_edit_ai",
}


def _cleanup_stale_locks(ctx: ToolContext, tool_name: str) -> None:
    """Remove lock files that may have been left by a cancelled tool."""
    from pathlib import Path

    lock_name = _TOOL_LOCK_MAP.get(tool_name)
    if not lock_name:
        return
    try:
        tdir = ctx.session.template_dir
        if tdir:
            lock_path = Path(tdir) / f".lock.{lock_name}"
            if lock_path.exists():
                lock_path.unlink(missing_ok=True)
                logger.info("stale_lock_cleaned", extra={
                    "tool": tool_name, "lock": str(lock_path),
                })
    except Exception:
        logger.debug("lock_cleanup_failed", exc_info=True)


def make_sync_handler(
    tool_name: str,
    tool_fn: Callable,
    event_loop: asyncio.AbstractEventLoop,
) -> Callable:
    """Wrap an async pipeline tool for Hermes's sync registry."""

    _timeout = TOOL_TIMEOUTS.get(tool_name, _DEFAULT_TIMEOUT)

    def handler(args: dict, **kwargs) -> str:
        ctx = _current_ctx.get()
        future = None

        try:
            ctx.check_call_limit(tool_name)
            future = asyncio.run_coroutine_threadsafe(
                tool_fn(ctx, **args), event_loop
            )
            raw_result = future.result(timeout=_timeout)

        except TimeoutError:
            # Cancel the still-running coroutine to free GPU/LLM resources
            if future is not None:
                future.cancel()
            # Clean up any stale lock files left by the cancelled operation
            _cleanup_stale_locks(ctx, tool_name)
            logger.warning("tool_timeout_cancelled", extra={
                "tool": tool_name, "timeout": _timeout,
            })
            raw_result = {
                "error": "tool_timeout",
                "tool": tool_name,
                "timeout_seconds": _timeout,
                "message": (
                    f"Tool '{tool_name}' timed out after {_timeout}s. "
                    f"The operation was cancelled. Try again or simplify."
                ),
            }
        except PreconditionError as e:
            raw_result = {
                "error": "precondition_failed",
                "tool": e.tool,
                "current_state": e.current_state,
                "required_states": sorted(e.required),
                "message": str(e),
            }
        except CallLimitExceeded as e:
            raw_result = {
                "error": "call_limit_exceeded",
                "tool": e.tool,
                "attempts": e.count,
                "limit": e.limit,
                "message": (
                    f"Tool '{e.tool}' called {e.count} times "
                    f"(limit: {e.limit}). Ask the user for help."
                ),
            }
        except Exception as e:
            logger.exception("tool_execution_failed", extra={"tool": tool_name})
            raw_result = {
                "error": "tool_execution_failed",
                "tool": tool_name,
                "message": str(e),
            }

        # ── SANITIZATION GATE ──
        # This runs BEFORE Hermes sees the result.
        # Hermes memory/skills only store sanitized abstract patterns.
        sanitized = _sanitize_for_agent(tool_name, raw_result)

        result_str = json.dumps(sanitized, ensure_ascii=False, default=str)
        if len(result_str) > 8000:
            result_str = result_str[:8000] + '..."truncated"}'

        # NOTE: No drain needed here. ctx.event_queue IS self._ndjson_queue
        # (same asyncio.Queue). Tools push events via `await put()` from the
        # main event loop, and the SENTINEL drain loop in hermes_agent.py
        # reads them via `await get()`. Events stream in real-time.

        return result_str

    return handler


# ── Tool Registration ───────────────────────────────────────────────

_registered = False


# ── State-based tool groups ─────────────────────────────────────────
# Smaller tool sets = fewer tokens in Hermes's LLM context = faster thinking

# Core tools always available
_CORE_TOOLS = {
    "session_transition",
}

# Tools per pipeline state (only these + core are registered)
STATE_TOOLS: dict[str, set[str]] = {
    "empty": _CORE_TOOLS | {"verify_template"},
    "html_ready": _CORE_TOOLS | {
        "auto_map_tokens", "resolve_mapping_pipeline",
        "edit_template",
    },
    "mapped": _CORE_TOOLS | {
        "auto_map_tokens", "refine_mapping", "edit_mapping",
        "build_contract", "read_mapping", "get_column_stats",
    },
    "approved": _CORE_TOOLS | {
        "build_generator_assets",
        "edit_mapping", "edit_template",
    },
    "building_assets": _CORE_TOOLS | {
        "validate_pipeline", "auto_fix_issues", "dry_run_preview",
        "edit_mapping", "edit_template", "get_column_stats",
    },
    "validated": _CORE_TOOLS | {
        "generate_report", "discover_batches", "get_key_options",
        "dry_run_preview", "get_column_stats",
    },
    "ready": _CORE_TOOLS | {
        "generate_report", "discover_batches", "get_key_options",
    },
}

# Full set as fallback
_ALL_TOOLS = set(TOOL_DISPATCH.keys())


def get_toolset_for_state(state: str) -> str:
    """Return the toolset name for a given pipeline state."""
    return f"nr_{state}" if state in STATE_TOOLS else "neurareport"


def register_pipeline_tools(event_loop: asyncio.AbstractEventLoop) -> None:
    """Register pipeline tools into state-specific toolsets.

    Each pipeline state gets a subset of tools to minimize LLM context size.
    A full 'neurareport' toolset is also registered as fallback.
    """
    global _registered
    if _registered:
        return

    from tools.registry import registry

    # Build schema lookup: tool_name → schema dict
    schema_map: dict[str, dict] = {}
    for schema_entry in TOOL_SCHEMAS:
        fn_schema = schema_entry.get("function", {})
        name = fn_schema.get("name")
        if name:
            schema_map[name] = fn_schema

    handlers: dict[str, Callable] = {}
    for tool_name, tool_fn in TOOL_DISPATCH.items():
        schema = schema_map.get(tool_name, {
            "name": tool_name,
            "description": f"Pipeline tool: {tool_name}",
            "parameters": {"type": "object", "properties": {}, "required": []},
        })
        handler = make_sync_handler(tool_name, tool_fn, event_loop)
        handlers[tool_name] = handler

        # Register into full toolset (fallback)
        registry.register(
            name=tool_name,
            toolset="neurareport",
            schema=schema,
            handler=handler,
            check_fn=lambda: True,
            is_async=False,
        )

    # Define state-specific toolsets as TOOLSETS entries (not registry entries).
    # The flat registry only supports one toolset per tool name — registering
    # the same tool in multiple state toolsets would overwrite earlier entries.
    # Instead, we define state toolsets in the TOOLSETS dict so that
    # resolve_toolset() returns the correct tool names for each state.
    try:
        from toolsets import TOOLSETS as _TS
        for state, tool_names in STATE_TOOLS.items():
            toolset = f"nr_{state}"
            _TS[toolset] = {
                "tools": sorted(tool_names & set(handlers.keys())),
                "includes": _HERMES_NATIVE_TOOLSETS,
            }
            logger.debug("state_toolset_defined", extra={
                "state": state, "toolset": toolset,
                "count": len(tool_names & set(handlers.keys())),
            })
        # Workspace mode: ALL pipeline tools + all native + terminal + vision
        _TS["nr_workspace"] = {
            "tools": sorted(handlers.keys()),  # all 28 pipeline tools
            "includes": _WORKSPACE_TOOLSETS,
        }
        logger.debug("workspace_toolset_defined", extra={
            "toolset": "nr_workspace", "count": len(handlers),
        })
    except ImportError:
        logger.warning("toolsets module not available — state-specific filtering disabled")

    _registered = True
    logger.info(
        "pipeline_tools_registered",
        extra={"count": len(TOOL_DISPATCH), "states": list(STATE_TOOLS.keys())},
    )


def get_workspace_toolset() -> str:
    """Return the toolset name for workspace mode (all tools)."""
    return "nr_workspace"


# ── Callback Bridge ─────────────────────────────────────────────────

class CallbackBridge:
    """Maps Hermes AIAgent callbacks → NDJSON events for our frontend.

    Hermes fires callbacks from its sync thread. We use
    loop.call_soon_threadsafe() to push events into the async NDJSON queue.

    Callback signatures (from hermes-agent run_agent.py):
        tool_start_callback(tc_id: str, name: str, args: dict)
        tool_complete_callback(tc_id: str, name: str, args: dict, result: str)
        tool_progress_callback(name: str, preview: str, args: dict)
        stream_delta_callback(delta: str)
        thinking_callback(text: str)
        status_callback(type_: str, message: str)
    """

    def __init__(
        self,
        ndjson_queue: asyncio.Queue,
        event_loop: asyncio.AbstractEventLoop,
        template_dir: str | None = None,
    ):
        self._queue = ndjson_queue
        self._loop = event_loop
        self._template_dir = template_dir
        self._tool_timings: dict[str, float] = {}  # tc_id → start_time
        self._perf_metrics: list[dict] = []  # collected tool metrics

    def _push(self, event: dict) -> None:
        """Thread-safe push to the async NDJSON queue."""
        self._loop.call_soon_threadsafe(self._queue.put_nowait, event)

    def save_performance_metrics(self) -> None:
        """Write collected performance metrics to artifact file."""
        if not self._perf_metrics or not self._template_dir:
            return
        import json
        from pathlib import Path
        try:
            perf_file = Path(self._template_dir) / "performance_metrics.json"
            perf_file.write_text(json.dumps(self._perf_metrics, ensure_ascii=False))
        except Exception:
            pass

    # ── Hermes Callbacks ──

    def on_tool_start(self, tc_id: str, name: str, args: dict) -> None:
        import time
        self._tool_timings[tc_id] = time.monotonic()
        is_internal = name in _HERMES_INTERNAL_TOOLS
        self._push({
            "event": "stage",
            "stage": name,
            "status": "running" if is_internal else "started",
            "progress": 0,
            "internal": is_internal,
        })

    def on_tool_complete(self, tc_id: str, name: str, args: dict, result: str) -> None:
        import time
        start = self._tool_timings.pop(tc_id, None)
        duration_ms = int((time.monotonic() - start) * 1000) if start else 0
        self._perf_metrics.append({
            "step": name,
            "durationMs": duration_ms,
            "queryCount": 1,
        })
        self._push({
            "event": "stage",
            "stage": name,
            "status": "complete",
            "progress": 100,
            "internal": name in _HERMES_INTERNAL_TOOLS,
        })

    def on_tool_progress(self, name: str, preview: str, args: dict) -> None:
        self._push({
            "event": "stage",
            "stage": name,
            "status": "running",
            "progress": 50,
        })

    def on_thinking(self, text: str) -> None:
        # Equivalent to our <think> tag stripping — discard reasoning output
        pass

    def on_stream_delta(self, delta: str) -> None:
        # Hermes accumulates internally; we don't stream tokens to frontend
        pass

    def on_status(self, type_: str, message: str) -> None:
        # Internal Hermes lifecycle — not exposed to frontend
        logger.debug("hermes_status", extra={"type": type_, "message": message})

    def on_step(self, *args, **kwargs) -> None:
        """Fires after each complete LLM turn (not just tool calls).

        Useful for tracking how many turns the agent has taken.
        """
        self._push({
            "event": "stage",
            "stage": "agent_turn",
            "status": "complete",
            "progress": 50,
        })

    def on_clarify(self, question: str, choices: list | None = None) -> str:
        """Route clarification request to user via NDJSON.

        In embedded API mode we can't block mid-stream for user input.
        Return the question as text — Hermes includes it in its response,
        user answers in the next message, and Hermes picks it up from history.
        """
        self._push({
            "event": "stage",
            "stage": "clarify",
            "status": "waiting",
            "progress": 0,
            "detail": {"question": question, "choices": choices},
        })
        answer = f"I need clarification: {question}"
        if choices:
            answer += f"\nOptions: {', '.join(str(c) for c in choices)}"
        return answer

    def on_background_review(self, data: Any) -> None:
        """Memory/skill updates from background review — this is where learning persists."""
        logger.info("hermes_background_review", extra={"data": str(data)[:200]})
        # Surface to frontend so user can see what was learned
        self._push({
            "event": "stage",
            "stage": "background_review",
            "status": "complete",
            "progress": 100,
            "detail": str(data)[:200],
        })
