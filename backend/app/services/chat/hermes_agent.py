# mypy: ignore-errors
"""
Hermes Agent — NousResearch hermes-agent v0.7.0 full integration.

Wraps the real AIAgent from hermes-agent with ALL Hermes features enabled:

Core:
- Tool-calling loop (run_conversation) with 27 pipeline + 9 built-in tools
- Dynamic system prompt (ephemeral_system_prompt)
- Max iterations (20), max tokens (4096)

Persistent Learning:
- Memory (MEMORY.md/USER.md) — agent-curated, nudge every 5 turns
- Skills (~/.hermes/skills/) — auto-generated from clean pipeline runs
- Trajectories (trajectory_samples.jsonl) — full tool sequences persisted
- Session search (FTS5 via shared SessionDB) — cross-session recall
- Background review — auto-saves learnings after complex turns
- flush_memories() — forced write at pipeline end

Reliability:
- Checkpoints — auto-snapshot before file changes
- Context compression — automatic when approaching limits (uses local Qwen)
- Platform hints — "api" mode for embedded use

Integration:
- Callbacks → NDJSON events (chat_start, stage, chat_complete)
- Clarify callback → user clarification via frontend
- Step callback → per-turn progress tracking
- Sanitization gate — Hermes never sees raw column names/mappings
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any, AsyncIterator

# Ensure vendor/hermes-agent is on sys.path so `from run_agent import AIAgent`
# and `from hermes_state import SessionDB` resolve correctly.
_VENDOR_DIR = str(Path(__file__).resolve().parents[4] / "vendor" / "hermes-agent")
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)

from starlette.requests import Request

from .session import ChatSession

logger = logging.getLogger("neura.chat.hermes_agent")


# ── Shared SessionDB singleton (FTS5 session search) ────────────────
# All pipeline sessions share one SQLite DB so session_search can find
# past conversations across templates.

_shared_session_db = None


def _get_session_db():
    """Lazy-init shared SessionDB. Returns None if hermes_state unavailable."""
    global _shared_session_db
    if _shared_session_db is not None:
        return _shared_session_db
    try:
        from hermes_state import SessionDB
        _shared_session_db = SessionDB()
        logger.info("hermes_session_db_initialized")
        return _shared_session_db
    except Exception as exc:
        logger.warning("hermes_session_db_unavailable: %s", exc)
        return None


# ── NDJSON event helpers (preserved — frontend depends on exact shapes) ──


def _chat_event(event: str, **kw) -> dict:
    return {"event": event, **kw}


def _chat_start(action: str, message: str) -> dict:
    return _chat_event("chat_start", action=action, message=message)


def _chat_complete(action: str, pipeline_state: str, message: str, **extra) -> dict:
    return _chat_event(
        "chat_complete",
        action=action,
        pipeline_state=pipeline_state,
        message=message,
        **extra,
    )


def _stage_event(stage: str, status: str, progress: int = 0, **kw) -> dict:
    return _chat_event("stage", stage=stage, status=status, progress=progress, **kw)


# ── Reasoning stripper ──────────────────────────────────────────────
#
# Qwen 3.5 via vLLM with enable_thinking=True produces:
#
#   Thinking Process:\n\n1. ...\n...\n</think>\n\nActual user-facing response
#
# The </think> tag is the definitive boundary. "Thinking Process:" is the
# header but has no closing tag — </think> marks the end.
#
# When the output is NOT truncated (max_tokens is large enough), the
# </think> tag is ALWAYS present. We rely on this structural marker.
# The only fallback needed is for rare truncated outputs where </think>
# never appears.


def _strip_reasoning(raw: str) -> str:
    """Extract the user-facing response by splitting on the </think> boundary.

    This is the ONLY reliable strategy — Qwen's thinking mode always outputs:
        Thinking Process:\\n...reasoning...\\n</think>\\n\\nActual response

    When </think> is present (normal case), everything after it is the response.
    When absent (truncated output), fall back to "Thinking Process:" header parsing.
    """
    text = raw

    # ── 1. Split on </think> — the definitive boundary ──
    # Take everything AFTER the last </think> tag.
    if "</think>" in text:
        after = text.rsplit("</think>", 1)[-1].strip()
        if after:
            return after
        # </think> was at the very end — no response after it.
        # This means the model used ALL its tokens on thinking.
        # Fall through to try other methods.

    # ── 2. Remove paired <think>...</think> blocks ──
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    cleaned = re.sub(r"</?think>", "", cleaned).strip()
    if cleaned and cleaned != text.strip():
        text = cleaned
        if text:
            return text

    # ── 3. "Thinking Process:" header — output was truncated (no </think>) ──
    # The response starts after a double-newline gap following the last
    # indented/numbered reasoning line.
    if re.match(r"^Thinking Process:", text, re.IGNORECASE):
        lines = text.split("\n")
        blank_run = 0
        for i, line in enumerate(lines):
            if i == 0:
                continue  # skip header
            s = line.strip()
            if not s:
                blank_run += 1
                continue
            # Reasoning: numbered, indented, bulleted, or starting with **
            if (s[0].isdigit() or line.startswith("    ") or line.startswith("\t")
                    or s.startswith("*") or s.startswith("-")):
                blank_run = 0
                continue
            # Non-reasoning line after a gap = start of response
            if blank_run >= 1:
                result = "\n".join(lines[i:]).strip()
                if result:
                    return result
            blank_run = 0

    # ── 4. No structural markers ──
    logger.warning("no_thinking_markers_found", extra={
        "length": len(text),
        "first_50": text[:50],
    })
    return text


# ── Status View builder (plain-language panel data for frontend) ─────

_STATE_LABELS = {
    "empty": "Ready for your report",
    "verifying": "Reading your report...",
    "html_ready": "Your report template is ready",
    "mapping": "Connecting your data to the report",
    "mapped": "Data connections are set up",
    "approving": "Reviewing your connections",
    "approved": "Preparing your report structure",
    "building_assets": "Setting everything up",
    "validating": "Testing with your real data",
    "validated": "Everything looks good — ready to create reports",
    "ready": "Your reports are ready",
    "correcting": "Fixing data connections...",
    "generating": "Creating your reports...",
}

_PANEL_AVAILABILITY = {
    "empty": [],
    "verifying": ["template"],
    "html_ready": ["template", "data"],
    "mapping": ["template", "data"],
    "mapped": ["template", "data", "mappings"],
    "approving": ["template", "data", "mappings"],
    "approved": ["template", "data", "mappings", "logic"],
    "correcting": ["template", "data", "mappings"],
    "building_assets": ["template", "data", "mappings", "logic", "errors"],
    "validating": ["template", "data", "mappings", "logic", "errors"],
    "validated": ["template", "data", "mappings", "logic", "preview", "errors"],
    "ready": ["template", "data", "mappings", "logic", "preview", "errors"],
    "generating": ["template", "data", "mappings", "logic", "preview", "errors"],
}


def _build_status_view(session) -> dict:
    """Build plain-language status for the right panel from session artifacts."""
    from pathlib import Path

    state = session.pipeline_state.value
    tdir = Path(session.template_dir) if session.template_dir else None

    view = {
        "step": _STATE_LABELS.get(state, "Working..."),
        "progress": _state_progress(state),
        "cards": [],
        "actions_taken": [],
        "example": None,
        "confidence": None,
        "problems": [],
        "next_step": None,
        "actions": [],
        "row_counts": None,
        "transform_stages": [],
    }

    if not tdir:
        return view

    # ── Cards from artifacts ──
    template_html = tdir / "template_p1.html"
    if template_html.exists():
        try:
            html = template_html.read_text()
            import re as _re
            tokens = set(_re.findall(r"\{\{?\s*([A-Za-z0-9_\-.]+)\s*\}\}?", html))
            view["cards"].append({
                "text": f"We found {len(tokens)} fields in your report",
                "type": "success",
                "panel": "template",
            })
            view["actions_taken"].append("Read your report and extracted the layout")
        except Exception:
            pass

    mapping_file = tdir / "mapping_step3.json"
    if mapping_file.exists():
        try:
            mapping = json.loads(mapping_file.read_text())
            total = len(mapping)
            resolved = sum(1 for v in mapping.values() if v and v != "UNRESOLVED")
            unresolved = total - resolved
            view["cards"].append({
                "text": f"{resolved} fields matched automatically",
                "type": "success",
                "panel": "mappings",
            })
            if unresolved > 0:
                view["cards"].append({
                    "text": f"{unresolved} fields need your input",
                    "type": "attention",
                    "panel": "mappings",
                })
                view["confidence"] = "needs_attention"
            else:
                view["confidence"] = "most_correct"
            view["actions_taken"].append("Connected to your database")
            view["actions_taken"].append("Matched fields automatically")
        except Exception:
            pass

    contract_file = tdir / "contract.json"
    if contract_file.exists():
        view["cards"].append({
            "text": "We figured out where each value comes from",
            "type": "success",
            "panel": "logic",
        })
        view["actions_taken"].append("Prepared how data will fill your report")

    # Validation results
    validation_file = tdir / "validation_result.json"
    if validation_file.exists():
        try:
            vdata = json.loads(validation_file.read_text())
            issues = vdata.get("issues", [])
            errors = [i for i in issues if i.get("severity") == "error"]
            warnings = [i for i in issues if i.get("severity") == "warning"]
            if not errors:
                view["cards"].append({
                    "text": "Everything looks good",
                    "type": "success",
                    "panel": "errors",
                })
            else:
                for err in errors[:3]:
                    problem = {
                        "text": err.get("message", "Unknown issue"),
                        "panel": "errors",
                    }
                    # Populate field from token for cross-panel jump
                    if err.get("token"):
                        problem["field"] = err["token"]
                        problem["panel"] = "mappings"
                    view["problems"].append(problem)
            if warnings:
                view["cards"].append({
                    "text": f"{len(warnings)} minor things to review",
                    "type": "attention",
                    "panel": "errors",
                })
        except Exception:
            pass

    # Dry run preview
    dry_run_file = tdir / "dry_run_result.json"
    if dry_run_file.exists():
        try:
            dr = json.loads(dry_run_file.read_text())
            batch_count = dr.get("batch_count", 0)
            row_count = dr.get("row_count", 0)
            if batch_count:
                view["cards"].append({
                    "text": f"{batch_count} batches of data found",
                    "type": "success",
                    "panel": "preview",
                })
            if row_count:
                view["cards"].append({
                    "text": f"{row_count} rows rendered correctly",
                    "type": "success",
                    "panel": "preview",
                })
            # Build example from sample rows
            sample = dr.get("sample_rows")
            if sample and isinstance(sample, list) and len(sample) > 0:
                view["example"] = {
                    "label": "Here's a real example from your data:",
                    "rows": sample[:3],
                }

            # Row counts for RowFlowCompression viz (#7)
            source_rows = dr.get("source_rows", dr.get("row_count", 0))
            filtered_rows = dr.get("filtered_rows", source_rows)
            grouped_rows = dr.get("grouped_rows", batch_count or 0)
            output_rows = dr.get("output_rows", batch_count or 0)
            if source_rows:
                view["row_counts"] = {
                    "source": source_rows,
                    "filtered": filtered_rows,
                    "grouped": grouped_rows,
                    "final": output_rows,
                }

            # Transform stages for BeforeAfterMorph viz (#3)
            if source_rows and grouped_rows:
                view["transform_stages"] = [
                    {"label": "Raw Data", "count": source_rows},
                    {"label": "Grouped", "count": grouped_rows},
                    {"label": "Final Report", "count": output_rows or grouped_rows},
                ]
        except Exception:
            pass

    # ── Column stats (persisted by get_column_stats tool) ──
    try:
        stats_file = tdir / "column_stats.json"
        if stats_file.exists():
            import json as _json
            view["column_stats"] = _json.loads(stats_file.read_text())
    except Exception:
        pass

    # ── Performance metrics ──
    try:
        perf_file = tdir / "performance_metrics.json"
        if perf_file.exists():
            import json as _json
            view["performance_metrics"] = _json.loads(perf_file.read_text())
    except Exception:
        pass

    # ── Constraint violations from data validator ──
    try:
        violations_file = tdir / "constraint_violations.json"
        if violations_file.exists():
            import json as _json
            view["constraint_violations"] = _json.loads(violations_file.read_text())
    except Exception:
        pass

    # ── Next step + actions ──
    _set_next_step(view, state)

    return view


def _state_progress(state: str) -> int:
    return {
        "empty": 0, "verifying": 10, "html_ready": 20,
        "mapping": 40, "mapped": 50, "approving": 55,
        "approved": 60, "building_assets": 70,
        "validating": 80, "validated": 90, "ready": 100,
    }.get(state, 0)


def _set_next_step(view: dict, state: str) -> None:
    if state in ("empty", "verifying"):
        view["next_step"] = "Upload a report to get started"
        view["actions"] = [{"label": "Upload a file", "action": "upload"}]
    elif state == "html_ready":
        view["next_step"] = "Connect your database to fill in the data"
        view["actions"] = [
            {"label": "Connect my Database", "action": "connect_database"},
            {"label": "Make changes", "action": "edit"},
        ]
    elif state in ("mapping", "mapped"):
        view["next_step"] = "Review the connections and continue"
        view["actions"] = [
            {"label": "Looks good, continue", "action": "approve"},
            {"label": "Review fields", "action": "show_panel", "panel": "mappings"},
        ]
    elif state in ("approved", "building_assets"):
        view["next_step"] = "We'll test it with your real data"
        view["actions"] = [{"label": "Continue", "action": "validate"}]
    elif state in ("validating", "validated"):
        view["next_step"] = "Ready to create your reports"
        view["actions"] = [
            {"label": "Create my Reports", "action": "generate"},
            {"label": "Review results", "action": "show_panel", "panel": "preview"},
        ]
    elif state == "ready":
        view["next_step"] = "Your reports are ready to download"
        view["actions"] = [{"label": "Download Reports", "action": "download"}]


# ── Agent ─────────────────────────────────────────────────────────────


class HermesAgent:
    """
    NousResearch hermes-agent v0.7.0 wrapper for the NeuraReport pipeline.

    Uses ALL Hermes features: memory, skills, session search, checkpoints,
    context compression, background review, clarification, subagent delegation.

    Same public interface:
        HermesAgent(session, request)
        async def run(payload, upload_file=None) -> AsyncIterator[dict]
    """

    MAX_TOOL_ROUNDS = 25   # Delegation + complex pipelines need headroom
    CONVERSATION_TIMEOUT = 2400  # 40 minutes max (template gen takes 15-20 min on single GPU)

    def __init__(self, session: ChatSession, request: Request, workspace_mode: bool = False):
        self.session = session
        self.request = request
        self.workspace_mode = workspace_mode
        self.session.workspace_mode = workspace_mode
        self._ndjson_queue: asyncio.Queue[dict] = asyncio.Queue()

    async def run(
        self,
        payload: Any,
        *,
        upload_file: Any = None,
        attachments: list[dict] | None = None,
    ) -> AsyncIterator[dict]:
        """Main entry point. Yields NDJSON events compatible with frontend.

        Parameters
        ----------
        upload_file : UploadFile or None
            Template file (PDF/Excel) for verify_template tool.
        attachments : list[dict] or None
            Reference files saved to disk. Each dict has: name, path, size, content_type.
            These are injected as context in the user message, not as pipeline templates.
        """
        from run_agent import AIAgent
        from .hermes_adapter import (
            _current_ctx,
            register_pipeline_tools,
            get_toolset_for_state,
            get_workspace_toolset,
            CallbackBridge,
        )
        from .hermes_system_prompt import build_system_prompt, build_workspace_prompt
        from .chat_history import ChatHistory
        from .tools import ToolContext, _build_completion_signal

        # ── 1. Build ToolContext ──
        logger.info("pipeline_turn_start", extra={
            "session_id": self.session.session_id,
            "state": self.session.pipeline_state.value,
            "turn": self.session.turn_count,
            "template_id": payload.template_id,
            "connection_id": payload.connection_id,
            "workspace_mode": self.workspace_mode,
            "has_upload": upload_file is not None,
            "completed_stages": list(self.session.completed_stages),
        })
        _conn_ids = getattr(payload, "connection_ids", None) or self.session.connection_ids or []
        ctx = ToolContext(
            session=self.session,
            request=self.request,
            template_id=payload.template_id,
            connection_id=payload.connection_id or self.session.connection_id,
            connection_ids=_conn_ids if len(_conn_ids) > 1 else None,
            event_queue=self._ndjson_queue,
        )
        if upload_file:
            # Read file bytes ONCE and stash them — the file object may
            # be closed/consumed after the first tool call. Hermes may call
            # verify_template multiple times (retries), so we need bytes.
            import io
            _file_bytes = upload_file.file.read()
            upload_file.file.seek(0)  # Reset for immediate use
            # Create a reusable wrapper that can be read multiple times
            class _ReusableUpload:
                def __init__(self, data, original):
                    self._data = data
                    self.filename = getattr(original, 'filename', 'upload.pdf')
                    self.content_type = getattr(original, 'content_type', 'application/pdf')
                    self.size = len(data)
                    self.file = io.BytesIO(data)
                def read(self):
                    self.file.seek(0)
                    return self._data
                def seek(self, pos):
                    self.file.seek(pos)
            ctx._upload_file = _ReusableUpload(_file_bytes, upload_file)

        # ── 2. Set context vars (copied to Hermes thread by asyncio.to_thread) ──
        _current_ctx.set(ctx)

        # ── 3. Register pipeline tools once per process ──
        loop = asyncio.get_running_loop()
        register_pipeline_tools(loop)

        # ── 4. Build callback bridge ──
        bridge = CallbackBridge(
            self._ndjson_queue, loop,
            template_dir=str(self.session.template_dir) if self.session.template_dir else None,
        )

        # ── 5. Build dynamic system prompt (mode-dependent) ──
        if self.workspace_mode:
            system_prompt = build_workspace_prompt(
                self.session, ctx.template_id, ctx.connection_id,
                connection_ids=ctx.connection_ids,
            )
            _toolsets = [get_workspace_toolset()]
            _max_iter = 50
        else:
            system_prompt = build_system_prompt(
                self.session, ctx.template_id, ctx.connection_id,
                connection_ids=ctx.connection_ids,
            )
            # Use the FULL pipeline toolset — not state-specific.
            # The state may change mid-turn (e.g. empty→html_ready after verify).
            # Python-enforced preconditions (_require_state) in each tool already
            # gate invalid calls, so the LLM having extra tools is safe.
            # The system prompt guides which tools to call at each state.
            _toolsets = [get_workspace_toolset()]
            _max_iter = self.MAX_TOOL_ROUNDS

        # ── 6. Read LLM config ──
        from backend.app.services.llm import get_llm_config

        llm_config = get_llm_config()
        base_url = llm_config.api_base

        # ── 6b. Apply user thinking toggle ──
        _extra_body = dict(llm_config.extra_body or {})
        _thinking = getattr(payload, "thinking_enabled", False)
        _extra_body["chat_template_kwargs"] = {"enable_thinking": bool(_thinking)}

        # ── 7. Create AIAgent with ALL Hermes features ──
        agent = AIAgent(
            # LLM endpoint
            base_url=base_url,
            api_key=llm_config.api_key or "none",
            model=llm_config.model or "qwen",
            max_tokens=4096,
            extra_body_override=_extra_body,

            # Agent behavior
            quiet_mode=True,
            ephemeral_system_prompt=system_prompt,
            max_iterations=_max_iter,
            platform="api",

            # Tool filtering — workspace gets ALL tools, pipeline gets state-specific
            enabled_toolsets=_toolsets,

            # Persistent learning — disable memory/compression in pipeline mode
            # to prevent auxiliary LLM calls from blocking the response.
            # Trajectories are still saved; memory is flushed post-conversation.
            save_trajectories=True,    # Trajectory persistence
            skip_context_files=True,   # We use our own system prompt
            skip_memory=not self.workspace_mode,  # Memory only in workspace mode
            persist_session=False,     # Disable session DB persistence (we use ChatSession)

            # Session linkage — connects to our ChatSession
            session_id=self.session.session_id,
            session_db=_get_session_db(),  # Shared FTS5 DB for session_search

            # Crash recovery
            checkpoints_enabled=True,

            # Callbacks → NDJSON events
            # NOTE: stream_delta_callback intentionally NOT set.
            # When set, Hermes uses streaming API which breaks Qwen's
            # XML tool call format (content comes empty in streaming mode).
            # Tool progress is still streamed via tool_start/tool_complete callbacks.
            tool_start_callback=bridge.on_tool_start,
            tool_complete_callback=bridge.on_tool_complete,
            tool_progress_callback=bridge.on_tool_progress,
            thinking_callback=bridge.on_thinking,
            status_callback=bridge.on_status,
            step_callback=bridge.on_step,
            clarify_callback=bridge.on_clarify,
        )
        agent.background_review_callback = bridge.on_background_review

        # ── 7b. Disable auxiliary LLM features in pipeline mode ──
        # Context compression and background review make extra LLM calls that
        # can timeout/loop and block the response. Only enable in workspace mode.
        if not self.workspace_mode:
            agent.compression_enabled = False
            agent.background_review_callback = None

        if hasattr(agent, '_memory_store') and agent._memory_store:
            agent._memory_store.memory_char_limit = min(agent._memory_store.memory_char_limit, 1500)
            agent._memory_store.user_char_limit = min(agent._memory_store.user_char_limit, 1000)

        # ── 8. Load conversation history ──
        history = ChatHistory.load(self.session.template_dir)
        conversation_history = history.get_messages()

        # ── 8b. Pre-seed state context so Hermes doesn't call session_get_state ──
        state_context = self._build_state_context()
        if state_context:
            conversation_history = conversation_history + [
                {"role": "assistant", "content": f"[Pipeline state: {state_context}]"}
            ]

        # ── 9. Build user message ──
        user_message = self._build_user_message(payload, upload_file, attachments)

        # ── 10. Yield chat_start ──
        yield _chat_start(action="agent", message="Processing your request...")

        # ── 10b. Scope file operations to template directory ──
        import os as _os
        _template_cwd = str(self.session.template_dir) if self.session.template_dir else None
        if _template_cwd:
            _os.environ["TERMINAL_CWD"] = _template_cwd

        # ── 11. Run Hermes in background thread, drain NDJSON events in real-time ──
        SENTINEL = object()

        async def _run_hermes():
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(
                        agent.run_conversation,
                        user_message,
                        conversation_history=conversation_history,
                    ),
                    timeout=2400 if self.workspace_mode else self.CONVERSATION_TIMEOUT,
                )
                return result
            except asyncio.TimeoutError:
                logger.warning("hermes_conversation_timeout", extra={
                    "timeout": self.CONVERSATION_TIMEOUT,
                })
                return {
                    "final_response": (
                        f"The operation timed out after {self.CONVERSATION_TIMEOUT}s. "
                        "Please try again or simplify your request."
                    ),
                }
            finally:
                loop.call_soon_threadsafe(self._ndjson_queue.put_nowait, SENTINEL)

        hermes_task = asyncio.create_task(_run_hermes())

        while True:
            event = await self._ndjson_queue.get()
            if event is SENTINEL:
                break
            yield event

        # ── 12. Get final response ──
        try:
            hermes_result = await hermes_task
            final_response = hermes_result.get("final_response", "") or ""
        except Exception as exc:
            logger.exception("hermes_agent_failed")
            yield _chat_complete(
                action="agent",
                pipeline_state=self.session.pipeline_state.value,
                message=f"Agent failed: {exc}",
            )
            return

        # ── 13. Flush memories (only in workspace mode — pipeline mode skips
        #    to avoid auxiliary LLM calls that can block/loop indefinitely) ──
        if self.workspace_mode:
            try:
                await asyncio.to_thread(agent.flush_memories)
            except Exception:
                logger.debug("flush_memories_failed", exc_info=True)

        # ── 14. Strip thinking tags + leaked reasoning ──
        clean_content = _strip_reasoning(final_response)

        # ── 15. Extract structured fields from JSON code blocks ──
        extra_fields = self._extract_structured_fields(clean_content)

        # ── 16. History poisoning prevention (only user + final response) ──
        history.save_turn(user_message, clean_content)
        self.session.record_turn()
        self.session.save()

        # ── 17. Learning signal ──
        completion_signal = _build_completion_signal(ctx)
        extra_fields["learning_signal"] = completion_signal

        # Persist learning_signal for hydration (survives page reload)
        try:
            _ls_path = Path(self.session.template_dir) / "learning_signal.json"
            _ls_path.write_text(json.dumps(completion_signal, ensure_ascii=False, default=str))
        except Exception:
            logger.debug("learning_signal_persist_failed", exc_info=True)

        # ── 17b. Save performance metrics from tool timings ──
        bridge.save_performance_metrics()

        # ── 17c. Build inline action_result from artifacts ──
        # The frontend processEvent checks action-specific handlers (verify, map,
        # approve, validate, discover) to populate pipelineState.data.
        # Hermes sends action="agent" which skips those handlers.
        # Solution: use action="hydrate" so the frontend bulk-restores all data
        # from artifacts, same as page-load hydration.
        try:
            from backend.app.services.hydration import build_hydration_payload
            _hydration = build_hydration_payload(self.session)
            # Extract the parts processEvent needs for hydrate action
            extra_fields["action_result"] = _hydration.get("action_result", {})
            if _hydration.get("token_color_map"):
                extra_fields["token_color_map"] = _hydration["token_color_map"]
        except Exception:
            logger.debug("inline_hydration_failed", exc_info=True)

        # ── 18. Build status view + panel signals ──
        status_view = _build_status_view(self.session)
        state_val = self.session.pipeline_state.value
        # Use data-aware panel gating from hydration (checks artifact existence)
        try:
            available_panels = _hydration.get("panel", {}).get("available", [])
        except NameError:
            available_panels = _PANEL_AVAILABILITY.get(state_val, [])

        # Promote nested fields to top-level for frontend store
        if status_view.get("column_stats"):
            extra_fields["column_stats"] = status_view.pop("column_stats")
        if status_view.get("performance_metrics"):
            extra_fields["performance_metrics"] = status_view.pop("performance_metrics")
        if status_view.get("constraint_violations"):
            extra_fields["constraint_violations"] = status_view.pop("constraint_violations")

        extra_fields["status_view"] = status_view
        extra_fields["session_id"] = self.session.session_id
        extra_fields["panel"] = {
            "available": available_panels,
            "show": None,  # Hermes doesn't force a panel — user clicks through
        }

        # ── 19. Yield chat_complete ──
        # Use action="hydrate" so frontend processEvent bulk-restores
        # pipelineState.data from action_result (same code path as page-load).
        _ar = extra_fields.get("action_result", {})
        logger.info("pipeline_turn_complete", extra={
            "session_id": self.session.session_id,
            "state": state_val,
            "panels": available_panels,
            "has_template": bool(_ar.get("template", {}).get("html")),
            "has_mapping": bool(_ar.get("mapping", {}).get("mapping")),
            "has_contract": bool(_ar.get("contract")),
            "has_validation": bool(_ar.get("validation")),
            "has_generation": bool(_ar.get("generation")),
            "status_cards": len(status_view.get("cards", [])),
            "problems": len(status_view.get("problems", [])),
            "learning_patterns": len(extra_fields.get("learning_signal", {}).get("patterns", [])),
            "message_len": len(clean_content),
        })
        yield _chat_complete(
            action="hydrate",
            pipeline_state=state_val,
            message=clean_content,
            **extra_fields,
        )

        # ── 19. Clean up TERMINAL_CWD to avoid leaking between sessions ──
        if _template_cwd:
            _os.environ.pop("TERMINAL_CWD", None)

    # ── Helper methods ───────────────────────────────────────────────

    def _build_state_context(self) -> str:
        """Build state summary for conversation pre-seeding."""
        parts = [f"state={self.session.pipeline_state.value}"]
        parts.append(f"turn={self.session.turn_count}")
        parts.append(f"completed={self.session.completed_stages}")
        tdir = self.session.template_dir
        if tdir:
            from pathlib import Path
            tdir = Path(tdir)
            if (tdir / "mapping_step3.json").exists():
                parts.append("mapping=exists")
            if (tdir / "contract.json").exists():
                parts.append("contract=exists")
        return ", ".join(parts)

    # File extensions we can inline as text
    _TEXT_EXTENSIONS = {
        ".txt", ".csv", ".json", ".md", ".xml", ".html", ".htm", ".yaml",
        ".yml", ".toml", ".ini", ".cfg", ".log", ".sql", ".py", ".js",
        ".ts", ".sh", ".bat", ".env", ".conf",
    }
    _IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
    _MAX_INLINE_SIZE = 8000  # chars per file

    def _build_user_message(
        self, payload: Any, upload_file: Any = None,
        attachments: list[dict] | None = None,
    ) -> str:
        """Build user message from payload, template upload, and reference attachments.

        Text-based attachments are inlined so the LLM can read them directly.
        Images are described with path + instruction to use vision_analyze tool.
        Binary files (PDF, docx, xlsx) are read with appropriate extractors.
        """
        from pathlib import Path as _P

        user_message = ""
        if payload.messages:
            user_message = payload.messages[-1].content
        if payload.action:
            user_message = f"[action: {payload.action}] {user_message}".strip()
        if upload_file:
            filename = getattr(upload_file, "filename", "file")
            user_message = (
                f"[uploaded: {filename}] "
                f"{user_message or 'Create a template from this file.'}"
            )

        if not attachments:
            return user_message

        att_sections = []
        image_paths = []

        for att in attachments:
            name = att.get("name", "file")
            path = att.get("path", "")
            size = att.get("size", 0)
            ext = _P(name).suffix.lower()

            # ── Text files: inline content directly ──
            if ext in self._TEXT_EXTENSIONS:
                try:
                    content = _P(path).read_text(encoding="utf-8", errors="ignore")
                    if len(content) > self._MAX_INLINE_SIZE:
                        content = content[:self._MAX_INLINE_SIZE] + f"\n... (truncated, {size} bytes total)"
                    att_sections.append(
                        f"📄 **{name}**\n```\n{content}\n```"
                    )
                except Exception:
                    att_sections.append(f"📄 {name} — could not read (path: {path})")
                continue

            # ── Images: collect for vision_analyze instruction ──
            if ext in self._IMAGE_EXTENSIONS:
                image_paths.append((name, path))
                continue

            # ── PDF: extract text with pdfplumber or fallback ──
            if ext == ".pdf":
                try:
                    import pdfplumber
                    text_parts = []
                    with pdfplumber.open(path) as pdf:
                        for i, page in enumerate(pdf.pages[:10]):  # max 10 pages
                            page_text = page.extract_text() or ""
                            if page_text.strip():
                                text_parts.append(f"--- Page {i+1} ---\n{page_text}")
                    if text_parts:
                        content = "\n\n".join(text_parts)
                        if len(content) > self._MAX_INLINE_SIZE:
                            content = content[:self._MAX_INLINE_SIZE] + "\n... (truncated)"
                        att_sections.append(f"📄 **{name}** (PDF)\n```\n{content}\n```")
                    else:
                        att_sections.append(f"📄 {name} — PDF with no extractable text (path: {path})")
                except ImportError:
                    att_sections.append(f"📄 {name} — PDF file at: {path} (use read_file to view)")
                except Exception:
                    att_sections.append(f"📄 {name} — could not extract PDF text (path: {path})")
                continue

            # ── Excel/CSV: extract as text table ──
            if ext in (".xlsx", ".xls", ".xlsm"):
                try:
                    import openpyxl
                    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
                    rows = []
                    ws = wb.active
                    for i, row in enumerate(ws.iter_rows(values_only=True)):
                        if i >= 50: break  # max 50 rows
                        rows.append("\t".join(str(c) if c is not None else "" for c in row))
                    wb.close()
                    content = "\n".join(rows)
                    if len(content) > self._MAX_INLINE_SIZE:
                        content = content[:self._MAX_INLINE_SIZE] + "\n... (truncated)"
                    att_sections.append(f"📊 **{name}** (Excel)\n```\n{content}\n```")
                except Exception:
                    att_sections.append(f"📊 {name} — Excel file at: {path} (use read_file to view)")
                continue

            # ── Word docs: extract text ──
            if ext in (".doc", ".docx"):
                try:
                    import docx
                    doc = docx.Document(path)
                    content = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
                    if len(content) > self._MAX_INLINE_SIZE:
                        content = content[:self._MAX_INLINE_SIZE] + "\n... (truncated)"
                    att_sections.append(f"📄 **{name}** (Word)\n```\n{content}\n```")
                except Exception:
                    att_sections.append(f"📄 {name} — Word file at: {path}")
                continue

            # ── Unknown: just mention path ──
            att_sections.append(f"📎 {name} ({size} bytes) — file at: {path}")

        # Build the attachment block
        parts = []
        if att_sections:
            parts.append("\n\n".join(att_sections))
        if image_paths:
            img_list = "\n".join(f"  - {n}: {p}" for n, p in image_paths)
            parts.append(
                f"🖼️ **Attached images** (use `vision_analyze` tool with the file path to view):\n{img_list}"
            )

        if parts:
            att_block = "\n\n".join(parts)
            user_message = f"{user_message}\n\n--- Attached files ---\n{att_block}"

        return user_message

    def _extract_structured_fields(self, content: str) -> dict:
        """Extract structured fields from LLM response.

        Looks for ```json code blocks and parses them as action_result.
        """
        extra: dict[str, Any] = {}
        json_match = re.search(r"```json\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group(1))
                if isinstance(parsed, dict):
                    extra["action_result"] = parsed
            except json.JSONDecodeError:
                pass
        return extra
