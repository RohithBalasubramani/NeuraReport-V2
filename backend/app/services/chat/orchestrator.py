# mypy: ignore-errors
"""
Chat Pipeline Orchestrator.

Routes chat messages to existing service functions based on classified intent.
Each handler wraps an existing function from ``legacy_services.py`` without
rewriting it — this is purely a routing and event-translation layer.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, AsyncIterator, Optional

from starlette.requests import Request

from .session import ChatSession, PipelineState
from .intent import classify_intent, is_action_valid_for_state, guidance_for_invalid_action

logger = logging.getLogger("neura.chat.orchestrator")


# ---------------------------------------------------------------------------
# NDJSON event helpers
# ---------------------------------------------------------------------------

def _chat_event(event: str, **kw) -> dict:
    """Build a chat-wrapped NDJSON event."""
    return {"event": event, **kw}


def _chat_start(action: str, message: str) -> dict:
    return _chat_event("chat_start", action=action, message=message)


def _chat_complete(
    action: str,
    pipeline_state: str,
    message: str,
    **extra,
) -> dict:
    return _chat_event(
        "chat_complete",
        action=action,
        pipeline_state=pipeline_state,
        message=message,
        **extra,
    )


def _stage_event(stage: str, status: str, progress: int = 0, **kw) -> dict:
    return _chat_event("stage", stage=stage, status=status, progress=progress, **kw)


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class ChatPipelineOrchestrator:
    """Routes unified chat messages to existing pipeline service functions."""

    def __init__(self, session: ChatSession, request: Request):
        self.session = session
        self.request = request

    async def dispatch(
        self,
        intent: str,
        payload: Any,
        *,
        upload_file: Any = None,
    ) -> AsyncIterator[dict]:
        """Dispatch to the handler matching *intent*. Yields NDJSON events."""
        # Check state compatibility
        if not is_action_valid_for_state(intent, self.session.pipeline_state.value):
            msg = guidance_for_invalid_action(intent, self.session.pipeline_state.value)
            yield _chat_complete(
                action=intent,
                pipeline_state=self.session.pipeline_state.value,
                message=msg,
            )
            return

        handler = getattr(self, f"_handle_{intent}", None)
        if handler is None:
            # Unknown intent — fall through to chat
            handler = self._handle_chat

        self.session.record_turn()

        try:
            async for event in handler(payload, upload_file=upload_file):
                yield event
        except Exception as exc:
            logger.exception("orchestrator_dispatch_error", extra={"intent": intent})
            yield _chat_complete(
                action=intent,
                pipeline_state=self.session.pipeline_state.value,
                message=f"Something went wrong: {exc}",
            )

        self.session.save()

    # -----------------------------------------------------------------------
    # Handler: verify (upload PDF → HTML)
    # -----------------------------------------------------------------------

    async def _handle_verify(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import verify_template, verify_excel

        upload_file = kw.get("upload_file")
        if upload_file is None:
            yield _chat_complete(
                action="verify",
                pipeline_state=self.session.pipeline_state.value,
                message="Please upload a PDF or Excel file to convert into a template.",
            )
            return

        # Detect file type from filename
        filename = getattr(upload_file, 'filename', '') or ''
        is_excel = filename.lower().endswith(('.xlsx', '.xls', '.xlsm'))

        yield _chat_start("verify", f"Converting your {'Excel' if is_excel else 'PDF'} to an HTML template...")

        self.session.transition(PipelineState.VERIFYING)
        self.session.save()

        connection_id = payload.connection_id or self.session.connection_id
        try:
            if is_excel:
                response = verify_excel(
                    file=upload_file,
                    request=self.request,
                    connection_id=connection_id,
                )
            else:
                response = verify_template(
                    file=upload_file,
                    connection_id=connection_id,
                    request=self.request,
                )
            # verify_template returns a StreamingResponse — iterate its body
            template_id = None
            token_signatures = None
            async for chunk in _iter_streaming(response):
                event = _try_parse_ndjson(chunk)
                if event:
                    # Pass through stage events
                    if event.get("event") == "stage":
                        yield _stage_event(
                            stage=event.get("stage", "verify"),
                            status=event.get("status", "started"),
                            progress=event.get("progress", 0),
                        )
                    # Capture template_id from result
                    if event.get("template_id"):
                        template_id = event["template_id"]
                    # Capture token_signatures from result
                    if event.get("token_signatures"):
                        token_signatures = event["token_signatures"]

            self.session.transition(PipelineState.HTML_READY)
            self.session.complete_stage("verify")

            # Migrate session from _session_xxx to the real template directory
            if template_id:
                try:
                    from backend.app.services.legacy_services import template_dir
                    kind = _resolve_kind(template_id)
                    real_tdir = template_dir(template_id, must_exist=True, kind=kind)
                    if real_tdir != self.session.template_dir:
                        self.session.migrate_to(real_tdir)
                        logger.info("session_migrated_to_template template_id=%s", template_id)
                except Exception:
                    logger.warning("session_migration_failed", exc_info=True)

            # Load the generated template HTML + tokens so frontend can display it
            template_html = ""
            template_tokens = []
            if template_id:
                try:
                    from backend.app.services.legacy_services import template_dir
                    kind = _resolve_kind(template_id)
                    tdir = template_dir(template_id, must_exist=True, kind=kind)
                    for name in ("report_final.html", "template_p1.html"):
                        p = tdir / name
                        if p.exists() and p.stat().st_size > 0:
                            template_html = p.read_text(encoding="utf-8", errors="ignore")
                            break
                    import re
                    template_tokens = sorted(set(re.findall(r'\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?', template_html)))
                except Exception:
                    pass

            msg = "Your template is ready!"
            if template_tokens:
                msg += f" Found {len(template_tokens)} tokens."
            if self.session.connection_id:
                msg += " Would you like to map it to your database, or edit it first?"
            else:
                msg += " Would you like to edit it, or connect a database for mapping?"

            yield _chat_complete(
                action="verify",
                pipeline_state=self.session.pipeline_state.value,
                message=msg,
                template_id=template_id,
                updated_html=template_html if template_html else None,
                action_result={
                    "tokens": template_tokens,
                    "token_signatures": token_signatures or {},
                },
            )

        except Exception as exc:
            self.session.transition(PipelineState.HTML_READY if self.session.pipeline_state == PipelineState.VERIFYING else PipelineState.EMPTY)
            raise

    # -----------------------------------------------------------------------
    # Handler: edit (chat-based template editing)
    # -----------------------------------------------------------------------

    # -----------------------------------------------------------------------
    # Handler: edit — alias to chat (unified prompt handles both)
    # -----------------------------------------------------------------------

    async def _handle_edit(self, payload: Any, **kw) -> AsyncIterator[dict]:
        """Edit is handled by the unified chat prompt with context injection."""
        # Enter editing overlay if we have a template
        if payload.template_id and self.session.pipeline_state != PipelineState.EDITING:
            try:
                self.session.transition(PipelineState.EDITING)
            except ValueError:
                pass  # Not all states allow editing overlay
        async for event in self._handle_chat(payload, **kw):
            yield event

    # -----------------------------------------------------------------------
    # Handler: chat (unified — handles all conversation, editing, creation)
    # -----------------------------------------------------------------------

    async def _handle_chat(self, payload: Any, **kw) -> AsyncIterator[dict]:
        """
        Unified chat handler with context injection.

        Uses the unified pipeline prompt. Context is injected automatically:
        pipeline state, template HTML, DB schema, mapping, contract, errors.
        Handles: creation, editing, questions, status, and intent detection.
        """
        from backend.app.services.ai_services import build_unified_pipeline_prompt, UNIFIED_PIPELINE_PROMPT_VERSION
        from backend.app.services.chat.context_builder import build_pipeline_context, build_conversation_context
        from backend.app.services.infra_services import call_chat_completion
        from backend.app.services.llm import get_llm_client

        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id

        # Load current HTML
        current_html = payload.html or ""
        template_dir_path = None
        db_path = None
        if template_id:
            try:
                from backend.app.services.legacy_services import template_dir, db_path_from_payload_or_default
                template_dir_path = template_dir(template_id, must_exist=True)
                if not current_html:
                    for name in ("report_final.html", "template_p1.html"):
                        p = template_dir_path / name
                        if p.exists():
                            current_html = p.read_text(encoding="utf-8", errors="ignore")
                            break
                if connection_id:
                    try:
                        db_path = db_path_from_payload_or_default(connection_id)
                    except Exception:
                        pass
            except Exception:
                pass

        # Build pipeline context
        from pathlib import Path
        context_block = build_pipeline_context(
            session=self.session,
            template_id=template_id,
            connection_id=connection_id,
            template_dir=template_dir_path,
            db_path=Path(db_path) if db_path else None,
        )

        # Build conversation history with sliding window
        raw_history = [{"role": msg.role, "content": msg.content} for msg in payload.messages]
        conversation_history = build_conversation_context(raw_history, max_chars=12000)

        # Resolve template kind
        kind = "pdf"
        if template_id:
            kind = _resolve_kind(template_id)

        # Build unified prompt
        prompt_payload = build_unified_pipeline_prompt(
            conversation_history=conversation_history,
            pipeline_context=context_block,
            current_html=current_html if current_html else None,
            kind=kind,
        )

        messages = prompt_payload.get("messages") or []
        if not messages:
            yield _chat_complete(
                action="chat",
                pipeline_state=self.session.pipeline_state.value,
                message="I'm ready to help. What would you like to do?",
            )
            return

        # V2: Inject RAG context into messages if enabled
        try:
            from backend.app.services.config import get_v2_config
            v2 = get_v2_config()
            if v2.enable_rag_augmentation:
                try:
                    from backend.app.services.indexes import retrieve_rag_context
                    user_query = raw_history[-1]["content"] if raw_history else ""
                    rag_context = retrieve_rag_context(
                        query=user_query,
                        top_k=v2.rag_top_k,
                        threshold=v2.rag_relevance_threshold,
                    )
                    if rag_context:
                        rag_block = "## Retrieved Context (RAG)\n" + "\n---\n".join(rag_context)
                        messages = [{"role": "system", "content": rag_block}] + messages
                        logger.debug("RAG context injected", extra={"chunks": len(rag_context)})
                except ImportError:
                    logger.debug("RAG augmentation enabled but indexes module not available")
                except Exception:
                    logger.debug("RAG augmentation failed", exc_info=True)
        except Exception:
            pass

        # Call LLM with retry
        raw_text = ""
        last_error = None
        try:
            client = get_llm_client()
            from backend.app.services.llm import get_llm_config
            model = get_llm_config().model

            for attempt in range(2):  # max 2 attempts
                try:
                    response = call_chat_completion(
                        client, model=model, messages=messages,
                        description=UNIFIED_PIPELINE_PROMPT_VERSION,
                    )
                    raw_text = response.choices[0].message.content or ""
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt == 0:
                        logger.warning(f"chat_llm_retry attempt={attempt+1} error={exc}")
                        import time; time.sleep(2)
                    else:
                        logger.exception("unified_chat_llm_failed")
                        yield _chat_complete(
                            action="chat",
                            pipeline_state=self.session.pipeline_state.value,
                            message=f"LLM call failed after 2 attempts: {exc}",
                        )
                        return
        except Exception as exc:
            logger.exception("unified_chat_llm_failed")
            yield _chat_complete(
                action="chat",
                pipeline_state=self.session.pipeline_state.value,
                message=f"LLM call failed: {exc}",
            )
            return

        # Parse JSON response
        from backend.app.services.infra_services import strip_code_fences
        cleaned = strip_code_fences(raw_text).strip()
        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            # LLM returned non-JSON — treat as plain text message
            result = {"message": raw_text, "ready_to_apply": False}

        # Flag reapproval if editing after approve
        if result.get("ready_to_apply") and result.get("updated_html"):
            if "approve" in self.session.completed_stages:
                self.session.needs_reapproval = True

        # Emit the response
        yield _chat_complete(
            action="chat",
            pipeline_state=self.session.pipeline_state.value,
            message=result.get("message", ""),
            ready_to_apply=result.get("ready_to_apply", False),
            proposed_changes=result.get("proposed_changes"),
            updated_html=result.get("updated_html"),
            follow_up_questions=result.get("follow_up_questions"),
        )

        # Intent re-routing: if LLM detected an intent, dispatch to that handler
        detected_intent = result.get("intent")
        if detected_intent and detected_intent not in ("chat", "edit"):
            from .intent import is_action_valid_for_state
            # Guard: check state validity
            if not is_action_valid_for_state(detected_intent, self.session.pipeline_state.value):
                logger.warning(f"intent_reroute_blocked intent={detected_intent} state={self.session.pipeline_state.value}")
            # Guard: prevent recursive re-routing (max depth 1)
            elif not getattr(payload, '_intent_depth', 0):
                logger.info(f"intent_reroute from_chat intent={detected_intent}")
                payload._intent_depth = 1
                handler = getattr(self, f"_handle_{detected_intent}", None)
                if handler:
                    async for event in handler(payload):
                        yield event

    # -----------------------------------------------------------------------
    # Handler: map (auto-map tokens → DB columns)
    # -----------------------------------------------------------------------

    async def _handle_map(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import run_mapping_preview

        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id
        if not template_id or not connection_id:
            yield _chat_complete(
                action="map",
                pipeline_state=self.session.pipeline_state.value,
                message="I need both a template and a database connection to map. "
                        + ("Please provide a connection ID." if template_id else "Please create a template first."),
            )
            return

        yield _chat_start("map", "Auto-mapping template tokens to database columns...")

        self.session.transition(PipelineState.MAPPING)
        self.session.connection_id = connection_id
        self.session.save()

        try:
            kind = _resolve_kind(template_id)

            # OCR context — read from cached structured extraction (saved during verify_template)
            ocr_context_text = None
            try:
                from backend.app.services.legacy_services import template_dir as _tdir_fn
                tdir = _tdir_fn(template_id, must_exist=True, kind=kind)
                ocr_json = tdir / "ocr_structured.json"
                if ocr_json.exists():
                    import json as _json
                    from backend.app.services.infra_services import format_ocr_for_mapping
                    ocr_data = _json.loads(ocr_json.read_text())
                    ocr_context_text = format_ocr_for_mapping(ocr_data)
                else:
                    ocr_txt = tdir / "ocr_reference.txt"
                    if ocr_txt.exists():
                        ocr_context_text = ocr_txt.read_text(encoding="utf-8")
                if ocr_context_text:
                    logger.info("map_ocr_context", extra={"chars": len(ocr_context_text)})
            except Exception:
                logger.debug("map_ocr_skipped", exc_info=True)

            result = await run_mapping_preview(
                template_id, connection_id, self.request, kind=kind,
                ocr_context=ocr_context_text,
            )

            self.session.transition(PipelineState.MAPPED)
            self.session.complete_stage("mapping_preview")

            mapping = result.get("mapping", {})
            errors = result.get("errors", [])
            token_count = len(mapping)
            error_count = len(errors)

            if error_count:
                msg = (
                    f"Mapped {token_count} tokens with {error_count} issue(s). "
                    f"Review the mapping below and correct any issues, or say 'approve' if it looks good."
                )
            else:
                msg = (
                    f"Successfully mapped {token_count} tokens to database columns. "
                    f"Review the mapping below. Say 'approve' to build the contract, or describe any corrections."
                )

            yield _chat_complete(
                action="map",
                pipeline_state=self.session.pipeline_state.value,
                message=msg,
                action_result={
                    "mapping": mapping,
                    "errors": errors,
                    "catalog": result.get("catalog"),
                    "confidence": result.get("confidence", {}),
                    "confidence_reason": result.get("confidence_reason", {}),
                    "candidates": result.get("candidates", {}),
                    "token_signatures": result.get("token_signatures", {}),
                    "token_samples": result.get("token_samples", {}),
                },
            )

        except Exception as exc:
            self.session.transition(PipelineState.HTML_READY)
            raise

    # -----------------------------------------------------------------------
    # Handler: correct (refine mappings)
    # -----------------------------------------------------------------------

    async def _handle_correct(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import run_corrections_preview, CorrectionsPreviewPayload

        template_id = payload.template_id
        if not template_id:
            yield _chat_complete(
                action="correct",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        yield _chat_start("correct", "Refining mappings based on your instructions...")

        self.session.transition(PipelineState.CORRECTING)
        self.session.save()

        # Build corrections payload from the latest user message
        user_input = payload.messages[-1].content if payload.messages else ""
        action_params = payload.action_params or {}

        corrections_payload = CorrectionsPreviewPayload(
            user_input=user_input,
            page=action_params.get("page", 1),
            mapping_override=action_params.get("mapping_override"),
            sample_tokens=action_params.get("sample_tokens"),
        )

        try:
            kind = _resolve_kind(template_id)
            response = run_corrections_preview(template_id, corrections_payload, self.request, kind=kind)

            # corrections_preview returns a StreamingResponse
            result_data = {}
            async for chunk in _iter_streaming(response):
                event = _try_parse_ndjson(chunk)
                if event:
                    if event.get("event") == "stage":
                        yield _stage_event(
                            stage=event.get("stage", "correct"),
                            status=event.get("status", "started"),
                            progress=event.get("progress", 0),
                        )
                    if event.get("event") == "result":
                        result_data = event

            self.session.transition(PipelineState.MAPPED)
            self.session.complete_stage("corrections")

            yield _chat_complete(
                action="correct",
                pipeline_state=self.session.pipeline_state.value,
                message="Mappings updated. Review the changes and say 'approve' when ready.",
                action_result=result_data,
            )

        except Exception:
            self.session.transition(PipelineState.MAPPED)
            raise

    # -----------------------------------------------------------------------
    # Handler: approve (build contract + gates)
    # -----------------------------------------------------------------------

    async def _handle_approve(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import run_mapping_approve, MappingPayload

        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id
        if not template_id:
            yield _chat_complete(
                action="approve",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        yield _chat_start("approve", "Building contract and running validation gates...")

        self.session.transition(PipelineState.APPROVING)
        self.session.save()

        action_params = payload.action_params or {}
        mapping_payload = MappingPayload(
            mapping=action_params.get("mapping", {}),
            connection_id=connection_id,
            user_instructions=action_params.get("user_instructions", ""),
            dialect_hint=action_params.get("dialect_hint", "duckdb"),
            keys=action_params.get("keys", []),
        )

        try:
            kind = _resolve_kind(template_id)
            response = await run_mapping_approve(
                template_id, mapping_payload, self.request, kind=kind,
            )

            # Approve returns StreamingResponse with gate events
            gate_issues = []
            async for chunk in _iter_streaming(response):
                event = _try_parse_ndjson(chunk)
                if event:
                    stage = event.get("stage", "")
                    status = event.get("status", "")
                    if event.get("event") == "stage":
                        yield _stage_event(stage=stage, status=status, progress=event.get("progress", 0))
                    # Capture gate failures
                    if "gate" in stage.lower() and status == "error":
                        gate_issues.append(event)

            if gate_issues:
                self.session.transition(PipelineState.MAPPED)
                issues_text = "\n".join(
                    f"- {g.get('stage', '?')}: {g.get('detail', g.get('message', 'Unknown issue'))}"
                    for g in gate_issues
                )
                yield _chat_complete(
                    action="approve",
                    pipeline_state=self.session.pipeline_state.value,
                    message=f"Contract validation found issues:\n\n{issues_text}\n\nWould you like me to auto-repair, or do you want to correct the mapping manually?",
                    action_result={"gate_issues": gate_issues},
                )
            else:
                self.session.transition(PipelineState.APPROVED)
                self.session.complete_stage("approve")
                self.session.needs_reapproval = False

                yield _chat_complete(
                    action="approve",
                    pipeline_state=self.session.pipeline_state.value,
                    message="Contract approved. Running validation (dry run + visual check)...",
                )

                # Auto-trigger validation after approve
                async for event in self._handle_validate(payload):
                    yield event

        except Exception:
            self.session.transition(PipelineState.MAPPED)
            raise

    # -----------------------------------------------------------------------
    # Handler: validate (dry run + visual check + auto-fix loop)
    # -----------------------------------------------------------------------

    _MAX_FIX_ATTEMPTS = 3

    async def _handle_validate(self, payload: Any, **kw) -> AsyncIterator[dict]:
        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id
        if not template_id:
            yield _chat_complete(
                action="validate",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        yield _chat_start("validate", "Validating pipeline — checks, dry run, visual inspection...")

        self.session.transition(PipelineState.VALIDATING)
        self.session.save()

        try:
            from backend.app.services.validator import validate_pipeline
            from backend.app.services.legacy_services import template_dir, db_path_from_payload_or_default
            from pathlib import Path

            kind = _resolve_kind(template_id)
            tdir = template_dir(template_id, must_exist=True, kind=kind)
            db = db_path_from_payload_or_default(connection_id)
            key_values = payload.action_params.get("key_values") if payload.action_params else None

            for attempt in range(1, self._MAX_FIX_ATTEMPTS + 1):
                result = await validate_pipeline(
                    template_id=template_id,
                    connection_id=connection_id,
                    db_path=Path(db),
                    template_dir=tdir,
                    key_values=key_values,
                    skip_llm=(attempt > 1),  # LLM checks only on first pass
                )

                if result.passed:
                    self.session.transition(PipelineState.VALIDATED)
                    self.session.complete_stage("validate")

                    msg = f"Validation passed"
                    if attempt > 1:
                        msg += f" (after {attempt - 1} auto-fix round(s))"
                    msg += f"! {result.checks_run} checks completed."
                    if result.visual_check_passed:
                        msg += " Visual inspection confirmed the report looks correct."
                    msg += " Ready to generate reports."

                    yield _chat_complete(
                        action="validate",
                        pipeline_state=self.session.pipeline_state.value,
                        message=msg,
                        action_result=result.to_dict(),
                    )
                    return

                # --- FAILED: attempt auto-fix ---
                if attempt >= self._MAX_FIX_ATTEMPTS:
                    break

                yield _stage_event(
                    stage=f"validate.auto_fix_{attempt}",
                    status="started",
                    progress=50 + attempt * 10,
                )

                fixable, needs_user = self._classify_errors(result.errors)

                if not fixable and needs_user:
                    # Can't auto-fix — need user input
                    break

                if fixable:
                    fix_result = await self._auto_fix_issues(
                        fixable, template_id, connection_id, tdir, db, payload,
                    )
                    yield _stage_event(
                        stage=f"validate.auto_fix_{attempt}",
                        status="complete",
                        progress=50 + attempt * 10,
                        detail=fix_result,
                    )

                    if not fix_result.get("fixed"):
                        break  # Auto-fix couldn't resolve anything
                else:
                    break

            # --- EXHAUSTED: report failure ---
            self.session.transition(PipelineState.APPROVED)
            errors = result.errors[:5]
            issues_text = "\n".join(f"- **{i.category}**: {i.message}" for i in errors)

            # Separate fixable from user-required
            _, needs_user = self._classify_errors(result.errors)
            if needs_user:
                user_items = "\n".join(f"- {i.message}" for i in needs_user[:3])
                msg = (
                    f"Auto-fix resolved some issues but {len(needs_user)} require your input:\n\n"
                    f"{user_items}\n\nPlease address these and I'll re-validate."
                )
            else:
                msg = (
                    f"Validation failed after {self._MAX_FIX_ATTEMPTS} auto-fix attempts. "
                    f"{len(result.errors)} error(s) remain:\n\n{issues_text}"
                )

            yield _chat_complete(
                action="validate",
                pipeline_state=self.session.pipeline_state.value,
                message=msg,
                action_result=result.to_dict(),
            )

        except Exception as exc:
            self.session.transition(PipelineState.APPROVED)
            logger.exception("validation_failed")
            yield _chat_complete(
                action="validate",
                pipeline_state=self.session.pipeline_state.value,
                message=f"Validation crashed: {exc}",
            )

    def _classify_errors(self, errors):
        """Split errors into auto-fixable vs needs-user-input."""
        from backend.app.services.validator.models import Severity

        fixable = []
        needs_user = []

        for err in errors:
            cat = err.category
            # Auto-fixable categories
            if cat in ("unresolved", "column_exists", "join_valid", "reshape", "token_match"):
                fixable.append(err)
            # Needs user input
            elif cat in ("filter_valid", "dry_run", "visual"):
                needs_user.append(err)
            # Row estimate can be auto-fixed by adding date filters
            elif cat == "row_estimate":
                fixable.append(err)
            else:
                needs_user.append(err)

        return fixable, needs_user

    async def _auto_fix_issues(self, issues, template_id, connection_id, tdir, db, payload):
        """
        Use Qwen 3.5 (via LiteLLM/vLLM) to auto-fix validation issues.

        Sends the issues to the LLM and asks it to produce corrected
        mapping/contract. Then writes the fixes back to disk.
        """
        import json as _json
        import os
        from pathlib import Path

        # Load current contract and mapping
        contract_path = tdir / "contract.json"
        mapping_path = tdir / "mapping_step3.json"

        contract = {}
        if contract_path.exists():
            contract = _json.loads(contract_path.read_text())

        mapping = contract.get("mapping", {})

        # Build fix prompt
        issues_text = "\n".join(f"- [{i.category}] {i.message}" + (f" (hint: {i.fix_hint})" if i.fix_hint else "") for i in issues)

        # Get DB schema for context
        try:
            from backend.app.repositories.dataframes.sqlite_loader import SQLiteDataFrameLoader
            loader = SQLiteDataFrameLoader(str(db))
            tables = loader.table_names()
            schema_parts = []
            for t in tables[:5]:
                cols = list(loader.frame(t).columns)
                schema_parts.append(f"  {t}: {cols}")
            schema_text = "\n".join(schema_parts)
        except Exception:
            schema_text = "(could not load schema)"

        prompt = f"""You are a NeuraReport pipeline auto-fixer. Fix these validation errors.

CURRENT MAPPING:
{_json.dumps(mapping, indent=2)}

DATABASE SCHEMA:
{schema_text}

ERRORS TO FIX:
{issues_text}

For each error, determine the fix:
- "column_exists": Find the correct column name in the schema (fuzzy match)
- "unresolved": Map to the best matching column or mark as PARAM
- "token_match": Add missing token to mapping or remove from contract
- "join_valid": Fix join column references
- "row_estimate": Note that date filters should be used (this is a runtime fix, not contract fix)

Return ONLY JSON (no markdown):
{{"fixed": true/false, "updated_mapping": {{}}, "explanation": "what was fixed"}}
If you can't fix it, return: {{"fixed": false, "explanation": "why"}}"""

        try:
            from backend.app.services.llm import get_llm_config
            from openai import OpenAI

            config = get_llm_config()
            api_base = config.api_base.rstrip("/")
            if not api_base.endswith("/v1"):
                api_base = f"{api_base}/v1"

            client = OpenAI(
                base_url=api_base,
                api_key=config.api_key or "none",
                timeout=120.0,
            )
            model = config.model or "qwen"

            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=4096,
            )

            content = (response.choices[0].message.content or "").strip()
            if not content:
                return {"fixed": False, "explanation": "Empty response from LLM"}

            # Parse fix
            cleaned = content.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

            try:
                fix = _json.loads(cleaned)
            except _json.JSONDecodeError:
                return {"fixed": False, "explanation": f"Invalid JSON from LLM: {cleaned[:200]}"}

            if fix.get("fixed") and fix.get("updated_mapping"):
                # Apply the fix
                contract["mapping"] = fix["updated_mapping"]
                contract_path.write_text(_json.dumps(contract, indent=2, ensure_ascii=False))
                logger.info(f"auto_fix_applied: {fix.get('explanation', '')}")
                return fix
            else:
                return fix

        except Exception as exc:
            logger.warning(f"auto_fix_failed: {exc}")
            return {"fixed": False, "explanation": str(exc)}

    # -----------------------------------------------------------------------
    # Handler: build_assets (generator assets)
    # -----------------------------------------------------------------------

    async def _handle_build_assets(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import generator_assets, GeneratorAssetsPayload

        template_id = payload.template_id
        if not template_id:
            yield _chat_complete(
                action="build_assets",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        yield _chat_start("build_assets", "Building generator assets...")

        self.session.transition(PipelineState.BUILDING_ASSETS)
        self.session.save()

        action_params = payload.action_params or {}
        assets_payload = GeneratorAssetsPayload(**(action_params or {}))

        try:
            kind = _resolve_kind(template_id)
            response = generator_assets(template_id, assets_payload, self.request, kind=kind)

            async for chunk in _iter_streaming(response):
                event = _try_parse_ndjson(chunk)
                if event and event.get("event") == "stage":
                    yield _stage_event(
                        stage=event.get("stage", "build_assets"),
                        status=event.get("status", "started"),
                        progress=event.get("progress", 0),
                    )

            self.session.transition(PipelineState.READY)
            self.session.complete_stage("generator_assets")

            yield _chat_complete(
                action="build_assets",
                pipeline_state=self.session.pipeline_state.value,
                message="Generator assets built. You're ready to generate reports! Say 'generate' or select your date range and filters.",
            )

        except Exception:
            self.session.transition(PipelineState.APPROVED)
            raise

    # -----------------------------------------------------------------------
    # Handler: discover (find batches)
    # -----------------------------------------------------------------------

    async def _handle_discover(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.platform_services import discover_reports as discover_reports_service
        from backend.app.services.legacy_services import template_dir, db_path_from_payload_or_default, clean_key_values, manifest_endpoint
        from backend.app.services.contract_builder import load_contract_v2
        from backend.app.services.reports import discover_batches_and_counts, build_batch_field_catalog_and_stats, build_batch_metrics
        from backend.app.services.infra_services import load_manifest
        from backend.app.services.legacy_services import DiscoverPayload

        template_id = payload.template_id
        if not template_id:
            yield _chat_complete(
                action="discover",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        action_params = payload.action_params or {}
        kind = _resolve_kind(template_id)

        discover_payload = DiscoverPayload(
            template_id=template_id,
            connection_id=payload.connection_id or self.session.connection_id,
            start_date=action_params.get("start_date"),
            end_date=action_params.get("end_date"),
            key_values=action_params.get("key_values"),
        )

        try:
            result = discover_reports_service(
                discover_payload,
                kind=kind,
                template_dir_fn=lambda tpl: template_dir(tpl, kind=kind),
                db_path_fn=db_path_from_payload_or_default,
                load_contract_fn=load_contract_v2,
                clean_key_values_fn=clean_key_values,
                discover_fn=discover_batches_and_counts,
                build_field_catalog_fn=build_batch_field_catalog_and_stats,
                build_batch_metrics_fn=build_batch_metrics,
                load_manifest_fn=load_manifest,
                manifest_endpoint_fn=lambda tpl: manifest_endpoint(tpl, kind=kind),
            )

            batches = result.get("batches", [])
            yield _chat_complete(
                action="discover",
                pipeline_state=self.session.pipeline_state.value,
                message=f"Found {len(batches)} batch(es) available for generation. Select the ones you want to generate.",
                action_result=result,
            )

        except Exception:
            raise

    # -----------------------------------------------------------------------
    # Handler: generate (queue report job)
    # -----------------------------------------------------------------------

    async def _handle_generate(self, payload: Any, **kw) -> AsyncIterator[dict]:
        # Block generation if not validated
        if "validate" not in self.session.completed_stages:
            yield _chat_complete(
                action="generate",
                pipeline_state=self.session.pipeline_state.value,
                message="Pipeline must be validated before generating. Running validation now...",
            )
            async for event in self._handle_validate(payload):
                yield event
            # Check if validation passed
            if "validate" not in self.session.completed_stages:
                yield _chat_complete(
                    action="generate",
                    pipeline_state=self.session.pipeline_state.value,
                    message="Cannot generate — validation failed. Fix the issues first.",
                )
                return

        from backend.app.services.legacy_services import queue_report_job, RunPayload

        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id
        if not template_id:
            yield _chat_complete(
                action="generate",
                pipeline_state=self.session.pipeline_state.value,
                message="No template selected.",
            )
            return

        yield _chat_start("generate", "Queuing report generation...")

        self.session.transition(PipelineState.GENERATING)
        self.session.save()

        action_params = payload.action_params or {}
        kind = _resolve_kind(template_id)

        run_payload = RunPayload(
            template_id=template_id,
            connection_id=connection_id,
            start_date=action_params.get("start_date"),
            end_date=action_params.get("end_date"),
            batch_ids=action_params.get("batch_ids"),
            key_values=action_params.get("key_values"),
            brand_kit_id=action_params.get("brand_kit_id"),
            docx=action_params.get("docx", False),
            xlsx=action_params.get("xlsx"),
        )

        try:
            result = await queue_report_job(run_payload, self.request, kind=kind)

            self.session.transition(PipelineState.READY)
            self.session.complete_stage("generate")

            job_id = result.get("job_id") or result.get("jobs", [{}])[0].get("job_id", "?")
            yield _chat_complete(
                action="generate",
                pipeline_state=self.session.pipeline_state.value,
                message=f"Report generation started (Job: {job_id}). I'll let you know when it's ready.",
                action_result=result,
            )

        except Exception:
            self.session.transition(PipelineState.READY)
            raise

    # -----------------------------------------------------------------------
    # Handler: key_options (filter values)
    # -----------------------------------------------------------------------

    async def _handle_key_options(self, payload: Any, **kw) -> AsyncIterator[dict]:
        from backend.app.services.legacy_services import mapping_key_options

        template_id = payload.template_id
        connection_id = payload.connection_id or self.session.connection_id
        action_params = payload.action_params or {}
        kind = _resolve_kind(template_id)

        result = mapping_key_options(
            template_id,
            self.request,
            connection_id=connection_id,
            tokens=action_params.get("tokens"),
            limit=action_params.get("limit", 50),
            start_date=action_params.get("start_date"),
            end_date=action_params.get("end_date"),
            kind=kind,
        )

        yield _chat_complete(
            action="key_options",
            pipeline_state=self.session.pipeline_state.value,
            message="Here are the available filter values.",
            action_result=result,
        )

    # -----------------------------------------------------------------------
    # Handler: status
    # -----------------------------------------------------------------------

    async def _handle_status(self, payload: Any, **kw) -> AsyncIterator[dict]:
        s = self.session
        milestones = s.is_at_least
        parts = [f"**Pipeline state:** {s.pipeline_state.value}"]

        if s.completed_stages:
            parts.append(f"**Completed:** {', '.join(s.completed_stages)}")
        if s.invalidated_stages:
            parts.append(f"**Invalidated:** {', '.join(s.invalidated_stages)}")
        if s.needs_reapproval:
            parts.append("**Note:** Template was edited after approval — contract needs re-approval.")

        # Suggest next step
        state = s.pipeline_state
        if state == PipelineState.EMPTY:
            parts.append("\n**Next:** Upload a PDF or describe your report to get started.")
        elif state == PipelineState.HTML_READY:
            parts.append("\n**Next:** Edit the template or say 'map' to connect to a database.")
        elif state == PipelineState.MAPPED:
            parts.append("\n**Next:** Review the mapping and say 'approve' to build the contract.")
        elif state == PipelineState.APPROVED:
            parts.append("\n**Next:** Say 'generate' to create reports, or keep editing.")
        elif state == PipelineState.READY:
            parts.append("\n**Next:** Say 'generate' with your date range and filters.")

        yield _chat_complete(
            action="status",
            pipeline_state=s.pipeline_state.value,
            message="\n".join(parts),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_kind(template_id: str) -> str:
    """Determine template kind from the state store."""
    try:
        from backend.app.services.legacy_services import resolve_template_kind
        return resolve_template_kind(template_id)
    except Exception:
        return "pdf"


async def _iter_streaming(response) -> AsyncIterator[bytes]:
    """Iterate a StreamingResponse's body, handling both sync and async iterators."""
    body = getattr(response, "body_iterator", None)
    if body is None:
        return

    if hasattr(body, "__aiter__"):
        async for chunk in body:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            yield chunk
    else:
        for chunk in body:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            yield chunk


def _try_parse_ndjson(chunk: bytes) -> Optional[dict]:
    """Try to parse a bytes chunk as NDJSON (one JSON object per line)."""
    try:
        text = chunk.decode("utf-8").strip()
        if not text:
            return None
        return json.loads(text)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
