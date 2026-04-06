# mypy: ignore-errors
"""
Conversation History — persistence + sliding window for the Hermes Agent.

Stores the full message log (system, user, assistant, tool calls, tool results).
Persisted to {template_dir}/chat_history.json.
Implements sliding window to keep context within LLM limits.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger("neura.chat.history")

_HISTORY_FILENAME = "chat_history.json"


class ChatHistory:
    """Manages conversation history for the agent loop."""

    MAX_MESSAGES = 50  # hard cap on stored messages
    MAX_TOOL_RESULT_CHARS = 2000  # trim old tool results to save context
    TRIM_AFTER_TURNS = 2  # tool results older than N turns get trimmed

    def __init__(self, template_dir: Path):
        self.template_dir = Path(template_dir)
        self.messages: list[dict[str, Any]] = []

    def append(self, message: dict[str, Any]) -> None:
        """Add a message to history."""
        self.messages.append(message)
        # Enforce max messages by dropping oldest (keep system if present)
        if len(self.messages) > self.MAX_MESSAGES:
            # Keep first message if it's system, drop next oldest
            if self.messages and self.messages[0].get("role") == "system":
                self.messages = [self.messages[0]] + self.messages[-(self.MAX_MESSAGES - 1):]
            else:
                self.messages = self.messages[-self.MAX_MESSAGES:]

    def get_messages(self, max_chars: int = 80000) -> list[dict[str, Any]]:
        """Get messages for the LLM, trimming old tool results to save context.

        Returns a copy — does not modify stored messages.
        """
        result = []
        total_chars = 0
        n = len(self.messages)

        for i, msg in enumerate(self.messages):
            entry = dict(msg)  # shallow copy
            age = n - i  # how many messages ago

            # Trim old tool results
            if entry.get("role") == "tool" and age > self.TRIM_AFTER_TURNS * 3:
                content = entry.get("content", "")
                if len(content) > self.MAX_TOOL_RESULT_CHARS:
                    entry["content"] = content[:self.MAX_TOOL_RESULT_CHARS] + "...[trimmed]"

            # Track total size
            entry_size = len(json.dumps(entry, ensure_ascii=False, default=str))
            if total_chars + entry_size > max_chars and i > 0:
                # Drop oldest messages to fit budget (keep latest)
                break
            total_chars += entry_size
            result.append(entry)

        return result

    def save_turn(self, user_msg: str, assistant_msg: str) -> None:
        """Save a complete turn (user message + final assistant response).

        Only the user message and final response are persisted. Tool calls,
        tool results, and injected instructions are NOT saved — they're
        ephemeral to the current agent loop iteration. This prevents
        history poisoning where old tool results contaminate future turns.
        """
        self.messages.append({"role": "user", "content": user_msg})
        self.messages.append({"role": "assistant", "content": assistant_msg})
        self.save()

    def save(self) -> None:
        """Persist to disk."""
        self.template_dir.mkdir(parents=True, exist_ok=True)
        path = self.template_dir / _HISTORY_FILENAME
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.messages, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        tmp.replace(path)

    @classmethod
    def load(cls, template_dir: Path) -> ChatHistory:
        """Load from disk, or create empty if not found."""
        history = cls(template_dir)
        path = Path(template_dir) / _HISTORY_FILENAME
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    history.messages = data
            except Exception:
                logger.warning("chat_history_load_failed", exc_info=True)
        return history

    def clear(self) -> None:
        """Clear all messages."""
        self.messages = []

    def __len__(self) -> int:
        return len(self.messages)
