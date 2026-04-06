# mypy: ignore-errors
"""
Chat Pipeline Session — state machine tracking pipeline progress.

Persisted to ``{template_dir}/chat_session.json`` so the frontend can
resume a conversation after page reload.  The message history itself
stays on the frontend (stateless-backend pattern, matching the existing
chat_template_edit flow).
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("neura.chat.session")


# ---------------------------------------------------------------------------
# Pipeline states
# ---------------------------------------------------------------------------

class PipelineState(str, Enum):
    """All states the unified chat pipeline can be in."""

    EMPTY = "empty"
    VERIFYING = "verifying"
    HTML_READY = "html_ready"
    MAPPING = "mapping"
    MAPPED = "mapped"
    CORRECTING = "correcting"
    APPROVING = "approving"
    APPROVED = "approved"
    VALIDATING = "validating"
    VALIDATED = "validated"
    BUILDING_ASSETS = "building_assets"
    READY = "ready"
    GENERATING = "generating"

    # Overlay — allowed at any point after HTML_READY
    EDITING = "editing"


# ---------------------------------------------------------------------------
# Transition table
# ---------------------------------------------------------------------------

# Forward transitions (normal flow)
_FORWARD: dict[PipelineState, set[PipelineState]] = {
    PipelineState.EMPTY:           {PipelineState.VERIFYING},
    PipelineState.VERIFYING:       {PipelineState.HTML_READY},
    PipelineState.HTML_READY:      {PipelineState.MAPPING, PipelineState.EDITING},
    PipelineState.MAPPING:         {PipelineState.MAPPED},
    PipelineState.MAPPED:          {PipelineState.CORRECTING, PipelineState.APPROVING, PipelineState.EDITING},
    PipelineState.CORRECTING:      {PipelineState.MAPPED, PipelineState.APPROVING},
    PipelineState.APPROVING:       {PipelineState.APPROVED, PipelineState.MAPPED},
    PipelineState.APPROVED:        {PipelineState.BUILDING_ASSETS, PipelineState.EDITING},
    PipelineState.BUILDING_ASSETS: {PipelineState.VALIDATING, PipelineState.EDITING},
    PipelineState.VALIDATING:      {PipelineState.VALIDATED, PipelineState.BUILDING_ASSETS},  # BUILDING_ASSETS on failure
    PipelineState.VALIDATED:       {PipelineState.READY, PipelineState.GENERATING, PipelineState.EDITING},
    PipelineState.READY:           {PipelineState.GENERATING, PipelineState.EDITING},
    PipelineState.GENERATING:      {PipelineState.READY},
    PipelineState.EDITING:         set(),
}

# Backward transitions (user changed their mind / invalidation)
_BACKWARD: dict[PipelineState, set[PipelineState]] = {
    PipelineState.APPROVED:  {PipelineState.HTML_READY, PipelineState.MAPPED},
    PipelineState.READY:     {PipelineState.MAPPED, PipelineState.HTML_READY},
    PipelineState.MAPPED:    {PipelineState.HTML_READY},
}

# Any state can go back to EMPTY (re-upload replaces everything)
_UNIVERSAL_BACK = {PipelineState.EMPTY}

# States that require at least HTML_READY for EDITING overlay
_EDITING_ALLOWED_FROM = {
    PipelineState.HTML_READY,
    PipelineState.MAPPED,
    PipelineState.APPROVED,
    PipelineState.READY,
}

# Which stages get invalidated when going backward
_INVALIDATION_MAP: dict[PipelineState, list[str]] = {
    PipelineState.HTML_READY: ["mapping_preview", "corrections", "approve", "generator_assets"],
    PipelineState.MAPPED:     ["approve", "generator_assets"],
}


# ---------------------------------------------------------------------------
# Session class
# ---------------------------------------------------------------------------

_SESSION_FILENAME = "chat_session.json"


class ChatSession:
    """Server-side session tracking pipeline state for the unified chat."""

    def __init__(
        self,
        template_dir: Path,
        session_id: str | None = None,
        connection_id: str | None = None,
    ):
        self.template_dir = Path(template_dir)
        self.session_id = session_id or uuid.uuid4().hex[:12]
        self.pipeline_state = PipelineState.EMPTY
        self.connection_id = connection_id
        self.completed_stages: list[str] = []
        self.invalidated_stages: list[str] = []
        self.needs_reapproval = False
        self.turn_count = 0
        self.last_action: str | None = None
        self.workspace_mode: bool = False  # True = unrestricted, all tools, no state gates
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.updated_at = self.created_at
        self._previous_state: PipelineState | None = None  # for EDITING overlay return

    # -- state transitions ---------------------------------------------------

    def can_transition(self, target: PipelineState) -> bool:
        """Check if transition from current state to *target* is valid."""
        current = self.pipeline_state

        # Universal: any → EMPTY
        if target in _UNIVERSAL_BACK:
            return True

        # EDITING overlay
        if target == PipelineState.EDITING:
            return current in _EDITING_ALLOWED_FROM

        # Return from EDITING overlay
        if current == PipelineState.EDITING and self._previous_state is not None:
            return target == self._previous_state

        # Forward
        forward = _FORWARD.get(current, set())
        if target in forward:
            return True

        # Backward
        backward = _BACKWARD.get(current, set())
        if target in backward:
            return True

        return False

    def transition(self, target: PipelineState | str) -> None:
        """Move to *target* state, enforcing transition rules."""
        if isinstance(target, str):
            target = PipelineState(target)

        if not self.can_transition(target):
            raise ValueError(
                f"Invalid transition: {self.pipeline_state.value} → {target.value}"
            )

        old = self.pipeline_state

        # Handle EDITING overlay
        if target == PipelineState.EDITING:
            self._previous_state = old
            self.pipeline_state = target
            self._touch()
            return

        # Return from EDITING
        if old == PipelineState.EDITING and self._previous_state is not None:
            self.pipeline_state = target
            self._previous_state = None
            self._touch()
            return

        # Backward transition → invalidate downstream
        backward = _BACKWARD.get(old, set())
        if target in backward or target == PipelineState.EMPTY:
            self._invalidate_downstream(target)

        self.pipeline_state = target
        self._previous_state = None
        self._touch()

    def complete_stage(self, stage_name: str) -> None:
        """Mark a pipeline stage as completed."""
        if stage_name not in self.completed_stages:
            self.completed_stages.append(stage_name)
        # Remove from invalidated if it was there
        if stage_name in self.invalidated_stages:
            self.invalidated_stages.remove(stage_name)
        self.last_action = stage_name
        self._touch()

    def record_turn(self) -> None:
        """Increment turn counter."""
        self.turn_count += 1
        self._touch()

    # -- invalidation --------------------------------------------------------

    def _invalidate_downstream(self, target: PipelineState) -> None:
        """Invalidate stages that depend on states after *target*."""
        stages_to_invalidate = _INVALIDATION_MAP.get(target, [])
        for stage in stages_to_invalidate:
            if stage in self.completed_stages:
                self.completed_stages.remove(stage)
            if stage not in self.invalidated_stages:
                self.invalidated_stages.append(stage)

        if target in (PipelineState.HTML_READY, PipelineState.MAPPED):
            self.needs_reapproval = True

        logger.info(
            "session_invalidate_downstream",
            extra={
                "session_id": self.session_id,
                "target": target.value,
                "invalidated": self.invalidated_stages,
            },
        )

    # -- persistence ----------------------------------------------------------

    @property
    def _path(self) -> Path:
        return self.template_dir / _SESSION_FILENAME

    def save(self) -> None:
        """Persist session to disk."""
        self.template_dir.mkdir(parents=True, exist_ok=True)
        data = self.to_dict()
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._path)

    def migrate_to(self, new_dir: Path) -> None:
        """Move session to a new directory (e.g. from _session_xxx to template dir)."""
        old_dir = self.template_dir
        new_dir = Path(new_dir)
        new_dir.mkdir(parents=True, exist_ok=True)
        self.template_dir = new_dir
        self.save()
        # Clean up old session file
        old_path = old_dir / _SESSION_FILENAME
        if old_path.exists():
            old_path.unlink(missing_ok=True)
        logger.info("session_migrated from=%s to=%s", old_dir.name, new_dir.name)

    @classmethod
    def load(cls, template_dir: Path) -> ChatSession:
        """Load an existing session from disk."""
        path = Path(template_dir) / _SESSION_FILENAME
        if not path.exists():
            raise FileNotFoundError(f"No session at {path}")

        data = json.loads(path.read_text(encoding="utf-8"))
        session = cls(template_dir=template_dir, session_id=data.get("session_id"))
        session.pipeline_state = PipelineState(data.get("pipeline_state", "empty"))
        session.connection_id = data.get("connection_id")
        session.completed_stages = data.get("completed_stages", [])
        session.invalidated_stages = data.get("invalidated_stages", [])
        session.needs_reapproval = data.get("needs_reapproval", False)
        session.turn_count = data.get("turn_count", 0)
        session.last_action = data.get("last_action")
        session.workspace_mode = data.get("workspace_mode", False)
        session.created_at = data.get("created_at", session.created_at)
        session.updated_at = data.get("updated_at", session.updated_at)
        return session

    @classmethod
    def load_or_create(
        cls,
        template_dir: Path,
        session_id: str | None = None,
        connection_id: str | None = None,
    ) -> ChatSession:
        """Load existing session or create a new one."""
        path = Path(template_dir) / _SESSION_FILENAME
        if path.exists():
            try:
                return cls.load(template_dir)
            except Exception:
                logger.warning("Failed to load session, creating new", exc_info=True)
        return cls(
            template_dir=template_dir,
            session_id=session_id,
            connection_id=connection_id,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "pipeline_state": self.pipeline_state.value,
            "connection_id": self.connection_id,
            "completed_stages": self.completed_stages,
            "invalidated_stages": self.invalidated_stages,
            "needs_reapproval": self.needs_reapproval,
            "turn_count": self.turn_count,
            "last_action": self.last_action,
            "workspace_mode": self.workspace_mode,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    # -- helpers --------------------------------------------------------------

    def _touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat()

    @property
    def is_at_least(self) -> dict[str, bool]:
        """Quick checks for whether the pipeline has reached certain milestones."""
        order = list(PipelineState)
        idx = order.index(self.pipeline_state) if self.pipeline_state in order else -1
        return {
            "has_html": idx >= order.index(PipelineState.HTML_READY),
            "has_mapping": idx >= order.index(PipelineState.MAPPED),
            "has_contract": idx >= order.index(PipelineState.APPROVED),
            "has_assets": idx >= order.index(PipelineState.READY),
        }

    def __repr__(self) -> str:
        return (
            f"<ChatSession {self.session_id} "
            f"state={self.pipeline_state.value} "
            f"turns={self.turn_count}>"
        )
