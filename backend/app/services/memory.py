# mypy: ignore-errors
"""
Memory subsystem (merged from V1 memory/).

Provides:
- ConversationMemory — per-user conversation sessions with prompt injection
- EntityTracker — entity mention tracking and anaphoric reference resolution
- UserPreferences — learned user preferences with context awareness
"""
from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("neura.memory")


def _state_store():
    try:
        from backend.app.repositories import state_store
        return state_store
    except Exception:
        return None


# =========================================================================== #
#  Section 1: Conversation Memory                                             #
# =========================================================================== #

@dataclass
class MemoryEntry:
    role: str
    content: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    session_id: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)
    relevance_score: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {"role": self.role, "content": self.content, "timestamp": self.timestamp.isoformat(), "session_id": self.session_id, "metadata": self.metadata, "relevance_score": self.relevance_score}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> MemoryEntry:
        ts = data.get("timestamp")
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        elif ts is None:
            ts = datetime.now(timezone.utc)
        return cls(role=data["role"], content=data["content"], timestamp=ts, session_id=data.get("session_id", ""), metadata=data.get("metadata", {}), relevance_score=data.get("relevance_score", 1.0))


class ConversationMemory:
    MAX_HISTORY = 100
    MAX_CONTEXT_TOKENS = 4000

    def __init__(self) -> None:
        self._sessions: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._load()

    def create_session(self, user_id: str, name: str = "") -> str:
        session_id = str(uuid.uuid4())
        if user_id not in self._sessions:
            self._sessions[user_id] = {}
        self._sessions[user_id][session_id] = {"name": name or f"Session {len(self._sessions[user_id]) + 1}", "created_at": datetime.now(timezone.utc).isoformat(), "entries": []}
        self._persist()
        return session_id

    def get_session(self, user_id: str, session_id: str) -> List[MemoryEntry]:
        session = self._sessions.get(user_id, {}).get(session_id)
        return [MemoryEntry.from_dict(e) for e in session.get("entries", [])] if session else []

    def list_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        return [{"session_id": sid, "name": d.get("name", ""), "created_at": d.get("created_at", ""), "entry_count": len(d.get("entries", []))} for sid, d in self._sessions.get(user_id, {}).items()]

    def add_entry(self, user_id: str, session_id: str, entry: MemoryEntry) -> None:
        # V2 feature flag: no-op when conversation memory is disabled
        try:
            from backend.app.services.config import get_v2_config
            if not get_v2_config().enable_conversation_memory:
                return
        except Exception:
            pass

        session = self._sessions.get(user_id, {}).get(session_id)
        if session is None:
            return
        entry.session_id = session_id
        session["entries"].append(entry.to_dict())
        if len(session["entries"]) > self.MAX_HISTORY:
            session["entries"] = session["entries"][-self.MAX_HISTORY:]
        self._persist()

    def get_context(self, user_id: str, session_id: str, current_query: str, max_entries: int = 10) -> List[MemoryEntry]:
        entries = self.get_session(user_id, session_id)
        if not entries:
            return []
        query_tokens = set(current_query.lower().split())
        if query_tokens:
            for entry in entries:
                content_tokens = set(entry.content.lower().split())
                overlap = len(query_tokens & content_tokens)
                entry.relevance_score = 0.5 + (0.5 * min(overlap / max(len(query_tokens), 1), 1.0))
        scored = sorted(entries, key=lambda e: e.relevance_score, reverse=True)[:max_entries]
        scored.sort(key=lambda e: e.timestamp)
        return scored

    def inject_context(self, messages: List[Dict[str, Any]], user_id: str, session_id: str, current_query: str) -> List[Dict[str, Any]]:
        # V2 feature flag: return messages unchanged when conversation memory is disabled
        try:
            from backend.app.services.config import get_v2_config
            if not get_v2_config().enable_conversation_memory:
                return messages
        except Exception:
            pass

        ctx = self.get_context(user_id, session_id, current_query)
        parts: List[str] = []
        if ctx:
            lines = [f"{'User' if e.role == 'user' else 'Assistant'}: {e.content}" for e in ctx]
            parts.append("## Conversation History\n" + "\n".join(lines))
        try:
            entity_ctx = get_entity_tracker().to_context_string(user_id, limit=5)
            if entity_ctx:
                parts.append("## Entity Context\n" + entity_ctx)
        except Exception:
            pass
        try:
            pref_ctx = get_user_preferences().to_prompt_context(user_id)
            if pref_ctx:
                parts.append("## User Preferences\n" + pref_ctx)
        except Exception:
            pass
        if not parts:
            return messages
        return [{"role": "system", "content": "\n\n".join(parts)}] + list(messages)

    def _persist(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            with store._lock:
                state = store._read_state() or {}
                if not isinstance(state, dict):
                    state = {}
                state["conversation_memory"] = self._sessions
                store._write_state(state)
        except Exception:
            pass

    def _load(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            with store._lock:
                state = store._read_state() or {}
                data = state.get("conversation_memory", {}) if isinstance(state, dict) else {}
            if isinstance(data, dict):
                self._sessions = data
        except Exception:
            self._sessions = {}


_conv_instance: Optional[ConversationMemory] = None
_conv_lock = threading.Lock()


def get_conversation_memory() -> ConversationMemory:
    global _conv_instance
    with _conv_lock:
        if _conv_instance is None:
            _conv_instance = ConversationMemory()
    return _conv_instance


# =========================================================================== #
#  Section 2: Entity Tracker                                                  #
# =========================================================================== #

_ANAPHORIC_TOKENS = frozenset({"it", "its", "that", "that one", "the same", "the same one", "this", "this one", "those", "them", "these"})


@dataclass
class TrackedEntity:
    name: str
    entity_type: str
    first_mentioned: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_mentioned: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    mention_count: int = 1
    aliases: List[str] = field(default_factory=list)
    context: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "entity_type": self.entity_type, "first_mentioned": self.first_mentioned.isoformat(), "last_mentioned": self.last_mentioned.isoformat(), "mention_count": self.mention_count, "aliases": list(self.aliases), "context": self.context}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> TrackedEntity:
        first = data.get("first_mentioned")
        last = data.get("last_mentioned")
        if isinstance(first, str):
            first = datetime.fromisoformat(first)
        elif first is None:
            first = datetime.now(timezone.utc)
        if isinstance(last, str):
            last = datetime.fromisoformat(last)
        elif last is None:
            last = datetime.now(timezone.utc)
        return cls(name=data["name"], entity_type=data.get("entity_type", "unknown"), first_mentioned=first, last_mentioned=last, mention_count=data.get("mention_count", 1), aliases=data.get("aliases", []), context=data.get("context", ""))


class EntityTracker:
    def __init__(self) -> None:
        self._entities: Dict[str, Dict[str, TrackedEntity]] = {}
        self._load()

    def track_mention(self, user_id: str, session_id: str, entity_name: str, entity_type: str = "unknown") -> TrackedEntity:
        if user_id not in self._entities:
            self._entities[user_id] = {}
        key = entity_name.lower().strip()
        now = datetime.now(timezone.utc)
        existing = self._entities[user_id].get(key)
        if existing is not None:
            existing.mention_count += 1
            existing.last_mentioned = now
            if entity_type != "unknown":
                existing.entity_type = entity_type
            self._persist()
            return existing
        entity = TrackedEntity(name=entity_name, entity_type=entity_type, first_mentioned=now, last_mentioned=now, context=session_id)
        self._entities[user_id][key] = entity
        self._persist()
        return entity

    def resolve_reference(self, user_id: str, reference: str) -> Optional[TrackedEntity]:
        user_entities = self._entities.get(user_id, {})
        if not user_entities:
            return None
        ref_lower = reference.lower().strip()
        if ref_lower in _ANAPHORIC_TOKENS:
            return max(user_entities.values(), key=lambda e: e.last_mentioned) if user_entities else None
        if ref_lower in user_entities:
            return user_entities[ref_lower]
        for entity in user_entities.values():
            for alias in entity.aliases:
                if alias.lower().strip() == ref_lower:
                    return entity
        for key, entity in user_entities.items():
            if ref_lower in key or key in ref_lower:
                return entity
        return None

    def get_recent_entities(self, user_id: str, limit: int = 10) -> List[TrackedEntity]:
        return sorted(self._entities.get(user_id, {}).values(), key=lambda e: e.last_mentioned, reverse=True)[:limit]

    def to_context_string(self, user_id: str, limit: int = 5) -> str:
        recent = self.get_recent_entities(user_id, limit=limit)
        if not recent:
            return ""
        return "Recently discussed: " + ", ".join(f"{e.name} ({e.entity_type})" for e in recent)

    def _persist(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            serialised = {uid: {k: e.to_dict() for k, e in ents.items()} for uid, ents in self._entities.items()}
            with store._lock:
                state = store._read_state() or {}
                if not isinstance(state, dict):
                    state = {}
                state["entity_tracker"] = serialised
                store._write_state(state)
        except Exception:
            pass

    def _load(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            with store._lock:
                state = store._read_state() or {}
                data = state.get("entity_tracker", {}) if isinstance(state, dict) else {}
            if isinstance(data, dict):
                for uid, ents_raw in data.items():
                    if isinstance(ents_raw, dict):
                        self._entities[uid] = {k: TrackedEntity.from_dict(v) for k, v in ents_raw.items() if isinstance(v, dict)}
        except Exception:
            self._entities = {}


_et_instance: Optional[EntityTracker] = None
_et_lock = threading.Lock()


def get_entity_tracker() -> EntityTracker:
    global _et_instance
    with _et_lock:
        if _et_instance is None:
            _et_instance = EntityTracker()
    return _et_instance


# =========================================================================== #
#  Section 3: User Preferences                                                #
# =========================================================================== #

PREFERENCE_KEYS = ["analysis_depth", "chart_style", "report_format", "response_length", "visualization_type", "domain_focus"]

_FEEDBACK_INFERENCE_MAP: Dict[str, Dict[str, str]] = {
    "detailed": {"key": "analysis_depth", "value": "comprehensive"},
    "brief": {"key": "analysis_depth", "value": "concise"},
    "concise": {"key": "analysis_depth", "value": "concise"},
    "chart": {"key": "chart_style", "value": "chart-heavy"},
    "table": {"key": "chart_style", "value": "tabular"},
    "technical": {"key": "report_format", "value": "technical"},
    "summary": {"key": "report_format", "value": "executive-summary"},
    "short": {"key": "response_length", "value": "short"},
    "long": {"key": "response_length", "value": "long"},
}

_PREF_TEMPLATES: Dict[str, str] = {
    "analysis_depth": "{value} analysis",
    "chart_style": "{value} charts",
    "report_format": "{value} format",
    "response_length": "{value} responses",
    "visualization_type": "{value} visualizations",
    "domain_focus": "focus on {value}",
}


@dataclass
class UserPreference:
    key: str
    value: str
    confidence: float = 0.5
    source: str = "inferred"
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        return {"key": self.key, "value": self.value, "confidence": self.confidence, "source": self.source, "updated_at": self.updated_at.isoformat()}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> UserPreference:
        ts = data.get("updated_at")
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        elif ts is None:
            ts = datetime.now(timezone.utc)
        return cls(key=data["key"], value=data.get("value", ""), confidence=data.get("confidence", 0.5), source=data.get("source", "inferred"), updated_at=ts)


class UserPreferences:
    def __init__(self) -> None:
        self._prefs: Dict[str, Dict[str, UserPreference]] = {}
        self._load()

    def get(self, user_id: str, key: str) -> Optional[UserPreference]:
        return self._prefs.get(user_id, {}).get(key)

    def set_explicit(self, user_id: str, key: str, value: str) -> UserPreference:
        if user_id not in self._prefs:
            self._prefs[user_id] = {}
        pref = UserPreference(key=key, value=value, confidence=1.0, source="explicit")
        self._prefs[user_id][key] = pref
        self._persist()
        return pref

    def infer_from_feedback(self, user_id: str, feedback_entries: list) -> None:
        """Analyse feedback patterns and infer preferences.

        Each feedback entry is expected to have ``rating`` (e.g. "thumbs_up") and
        ``comment`` (str) attributes or dict keys.
        """
        if user_id not in self._prefs:
            self._prefs[user_id] = {}

        keyword_counts: Dict[str, int] = {}

        for entry in feedback_entries:
            if isinstance(entry, dict):
                rating = entry.get("rating", "")
                comment = entry.get("comment", "")
            else:
                rating = getattr(entry, "rating", "")
                comment = getattr(entry, "comment", "")

            if rating not in ("thumbs_up", "positive", "good"):
                continue

            comment_lower = str(comment).lower()
            for keyword, mapping in _FEEDBACK_INFERENCE_MAP.items():
                if keyword in comment_lower:
                    compound_key = f"{mapping['key']}:{mapping['value']}"
                    keyword_counts[compound_key] = keyword_counts.get(compound_key, 0) + 1

        for compound_key, count in keyword_counts.items():
            if count < 2:
                continue
            pref_key, pref_value = compound_key.split(":", 1)
            existing = self._prefs[user_id].get(pref_key)
            if existing is not None and existing.source == "explicit":
                continue
            confidence = min(0.3 + 0.1 * count, 0.9)
            self._prefs[user_id][pref_key] = UserPreference(
                key=pref_key,
                value=pref_value,
                confidence=confidence,
                source="inferred",
                updated_at=datetime.now(timezone.utc),
            )
            logger.info("Inferred user preference from feedback", extra={
                "event": "preference_inferred", "user_id": user_id,
                "key": pref_key, "value": pref_value, "confidence": confidence,
            })

        self._persist()

    def infer_from_choice(self, user_id: str, key: str, chosen_value: str) -> UserPreference:
        if user_id not in self._prefs:
            self._prefs[user_id] = {}
        existing = self._prefs[user_id].get(key)
        if existing and existing.value == chosen_value:
            existing.confidence = min(existing.confidence + 0.1, 0.95)
            self._persist()
            return existing
        pref = UserPreference(key=key, value=chosen_value, confidence=0.5, source="inferred")
        self._prefs[user_id][key] = pref
        self._persist()
        return pref

    def to_prompt_context(self, user_id: str) -> str:
        user_prefs = self._prefs.get(user_id, {})
        if not user_prefs:
            return ""
        fragments: List[str] = []
        for key in PREFERENCE_KEYS:
            pref = user_prefs.get(key)
            if pref and pref.confidence >= 0.3:
                fragments.append(_PREF_TEMPLATES.get(key, "{value}").format(value=pref.value))
        return ("User prefers " + ", ".join(fragments) + ".") if fragments else ""

    def _persist(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            serialised = {uid: {k: p.to_dict() for k, p in prefs.items()} for uid, prefs in self._prefs.items()}
            with store._lock:
                state = store._read_state() or {}
                if not isinstance(state, dict):
                    state = {}
                state["user_preferences"] = serialised
                store._write_state(state)
        except Exception:
            pass

    def _load(self) -> None:
        store = _state_store()
        if store is None:
            return
        try:
            with store._lock:
                state = store._read_state() or {}
                data = state.get("user_preferences", {}) if isinstance(state, dict) else {}
            if isinstance(data, dict):
                for uid, prefs_raw in data.items():
                    if isinstance(prefs_raw, dict):
                        self._prefs[uid] = {k: UserPreference.from_dict(v) for k, v in prefs_raw.items() if isinstance(v, dict)}
        except Exception:
            self._prefs = {}


_up_instance: Optional[UserPreferences] = None
_up_lock = threading.Lock()


def get_user_preferences() -> UserPreferences:
    global _up_instance
    with _up_lock:
        if _up_instance is None:
            _up_instance = UserPreferences()
    return _up_instance


__all__ = [
    "ConversationMemory", "MemoryEntry", "get_conversation_memory",
    "EntityTracker", "TrackedEntity", "get_entity_tracker",
    "UserPreferences", "UserPreference", "get_user_preferences",
]
