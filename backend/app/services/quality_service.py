from __future__ import annotations


# ── Originally: evaluator.py ──

# mypy: ignore-errors
"""
Quality Evaluator — Multi-criteria quality scoring.

Evaluates generated content (reports, mappings, agent outputs) against
configurable quality criteria with weighted scoring.

Usage:
    evaluator = QualityEvaluator()
    score = await evaluator.evaluate(
        content="Generated report text...",
        criteria={"accuracy": 0.4, "completeness": 0.3, "clarity": 0.3},
        context={"expected_fields": [...], "data_summary": "..."},
    )
"""


import logging
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger("neura.quality.evaluator")


@dataclass
class CriterionScore:
    """Score for a single quality criterion."""
    name: str
    score: float  # 0.0 - 1.0
    weight: float
    feedback: str = ""


@dataclass
class QualityScore:
    """Aggregated quality score with per-criterion breakdown."""
    overall: float  # Weighted average, 0.0 - 1.0
    criteria: List[CriterionScore] = field(default_factory=list)
    feedback: str = ""
    evaluation_method: str = "llm"  # "llm", "heuristic", "hybrid"
    heuristic_flags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall": round(self.overall, 4),
            "criteria": [
                {
                    "name": c.name,
                    "score": round(c.score, 4),
                    "weight": c.weight,
                    "feedback": c.feedback,
                }
                for c in self.criteria
            ],
            "feedback": self.feedback,
            "evaluation_method": self.evaluation_method,
            "heuristic_flags": self.heuristic_flags,
        }


# Default criteria for different content types
DEFAULT_CRITERIA = {
    "report": {"accuracy": 0.35, "completeness": 0.3, "clarity": 0.2, "formatting": 0.15},
    "mapping": {"accuracy": 0.5, "coverage": 0.3, "confidence": 0.2},
    "agent_output": {"relevance": 0.35, "accuracy": 0.3, "actionability": 0.2, "clarity": 0.15},
    "generic": {"accuracy": 0.4, "completeness": 0.3, "clarity": 0.3},
}


class QualityEvaluator:
    """
    Multi-criteria quality evaluator.

    Supports both LLM-based evaluation and heuristic-based evaluation.
    LLM evaluation uses structured prompts to score each criterion.
    Heuristic evaluation uses rule-based checks (faster, no LLM cost).
    """

    def __init__(self, use_llm: bool = True):
        self._use_llm = use_llm
        self._llm_client = None

    def _get_llm_client(self):
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    async def evaluate(
        self,
        content: str,
        criteria: Optional[Dict[str, float]] = None,
        content_type: str = "generic",
        context: Optional[Dict[str, Any]] = None,
    ) -> QualityScore:
        """
        Evaluate content quality.

        Args:
            content: The generated content to evaluate.
            criteria: Dict of {criterion_name: weight}. Weights should sum to ~1.0.
            content_type: One of "report", "mapping", "agent_output", "generic".
            context: Additional context for evaluation (expected fields, data, etc.).

        Returns:
            QualityScore with overall score and per-criterion breakdown.
        """
        if not content or not content.strip():
            return QualityScore(overall=0.0, feedback="Empty content", heuristic_flags=["empty_output"])

        criteria = criteria or DEFAULT_CRITERIA.get(content_type, DEFAULT_CRITERIA["generic"])

        # Normalize weights
        total_weight = sum(criteria.values())
        if total_weight > 0:
            criteria = {k: v / total_weight for k, v in criteria.items()}

        # Detect heuristic flags (always runs, fast)
        flags = self._detect_heuristic_flags(content)

        if self._use_llm:
            try:
                result = await self._llm_evaluate(content, criteria, context)
                result.heuristic_flags = flags
                return result
            except Exception as exc:
                logger.warning("LLM evaluation failed, falling back to heuristic: %s", exc)

        result = self._heuristic_evaluate(content, criteria, context)
        result.heuristic_flags = flags
        return result

    async def _llm_evaluate(
        self,
        content: str,
        criteria: Dict[str, float],
        context: Optional[Dict[str, Any]],
    ) -> QualityScore:
        """Evaluate using LLM-based scoring."""
        import asyncio

        client = self._get_llm_client()
        criteria_list = ", ".join(f"{k} (weight: {v:.2f})" for k, v in criteria.items())
        context_str = json.dumps(context, default=str)[:1000] if context else "None"

        prompt = (
            f"Evaluate the following content on these criteria: {criteria_list}\n\n"
            f"Context: {context_str}\n\n"
            f"Content to evaluate:\n{content[:3000]}\n\n"
            f"For each criterion, provide a score from 0.0 to 1.0 and brief feedback.\n"
            f"Respond in JSON format:\n"
            f'{{"criteria": [{{"name": "...", "score": 0.0, "feedback": "..."}}], "overall_feedback": "..."}}'
        )

        loop = asyncio.get_running_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: client.complete(
                messages=[{"role": "user", "content": prompt}],
                description="quality-evaluate",
                max_tokens=1024,
            ),
        )

        from backend.app.services.llm import _extract_response_text
        text = _extract_response_text(resp)

        return self._parse_llm_response(text, criteria)

    def _parse_llm_response(self, text: str, criteria: Dict[str, float]) -> QualityScore:
        """Parse LLM evaluation response into QualityScore."""
        try:
            # Try to extract JSON from the response
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(text[start:end])
            else:
                raise ValueError("No JSON found in response")

            criterion_scores = []
            for item in data.get("criteria", []):
                name = item.get("name", "")
                score = float(item.get("score", 0.0))
                score = max(0.0, min(1.0, score))
                weight = criteria.get(name, 0.0)
                criterion_scores.append(CriterionScore(
                    name=name,
                    score=score,
                    weight=weight,
                    feedback=item.get("feedback", ""),
                ))

            # Calculate weighted average
            if criterion_scores:
                overall = sum(c.score * c.weight for c in criterion_scores)
            else:
                overall = 0.5

            return QualityScore(
                overall=overall,
                criteria=criterion_scores,
                feedback=data.get("overall_feedback", ""),
                evaluation_method="llm",
            )

        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            logger.warning("Failed to parse LLM evaluation: %s", exc)
            return QualityScore(overall=0.5, feedback=f"Parse error: {exc}", evaluation_method="llm")

    def _heuristic_evaluate(
        self,
        content: str,
        criteria: Dict[str, float],
        context: Optional[Dict[str, Any]],
    ) -> QualityScore:
        """Evaluate using heuristic rules (no LLM needed)."""
        criterion_scores = []

        for name, weight in criteria.items():
            score = self._heuristic_score(name, content, context)
            criterion_scores.append(CriterionScore(
                name=name, score=score, weight=weight,
                feedback=f"Heuristic score for {name}",
            ))

        overall = sum(c.score * c.weight for c in criterion_scores) if criterion_scores else 0.0

        return QualityScore(
            overall=overall,
            criteria=criterion_scores,
            feedback="Evaluated using heuristic rules",
            evaluation_method="heuristic",
        )

    def _heuristic_score(self, criterion: str, content: str, context: Optional[Dict[str, Any]]) -> float:
        """Score a single criterion using heuristics."""
        length = len(content)

        if criterion in ("completeness", "coverage"):
            # Longer content generally more complete (with diminishing returns)
            if length < 50:
                return 0.2
            elif length < 200:
                return 0.5
            elif length < 1000:
                return 0.7
            else:
                return 0.85

        elif criterion == "clarity":
            # Shorter sentences, proper paragraphs → higher clarity
            sentences = content.count(".") + content.count("!") + content.count("?")
            avg_sentence_len = length / max(sentences, 1)
            if avg_sentence_len < 100:
                return 0.8
            elif avg_sentence_len < 200:
                return 0.6
            else:
                return 0.4

        elif criterion == "formatting":
            score = 0.5
            if "\n" in content:
                score += 0.15
            if "##" in content or "**" in content:
                score += 0.1
            if content.count("\n\n") >= 2:
                score += 0.1
            return min(score, 1.0)

        elif criterion in ("accuracy", "relevance", "confidence"):
            # Can't truly evaluate accuracy without ground truth — default moderate
            return 0.6

        elif criterion == "actionability":
            action_words = ["recommend", "suggest", "should", "action", "next step", "consider"]
            found = sum(1 for w in action_words if w.lower() in content.lower())
            return min(0.4 + found * 0.1, 1.0)

        return 0.5  # Default

    # ------------------------------------------------------------------
    # Heuristic flag detection (ported from new-repo evaluator)
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_heuristic_flags(content: str) -> List[str]:
        """Run fast rule-based checks and return a list of issue flags.

        Flags surface common problems without needing LLM evaluation:
        - ``empty_output``: content is blank
        - ``very_short``: content is under 50 characters
        - ``no_structure``: no newlines or markdown headers
        - ``repetitive``: same sentence appears 3+ times
        - ``error_markers``: contains error/exception keywords
        """
        flags: List[str] = []
        stripped = content.strip()

        if not stripped:
            flags.append("empty_output")
            return flags

        if len(stripped) < 50:
            flags.append("very_short")

        # No structure (no newlines, no headers like # or **)
        has_newlines = "\n" in stripped
        has_headers = bool(re.search(r"(^|\n)(#{1,6}\s|[*]{2})", stripped))
        if not has_newlines and not has_headers:
            flags.append("no_structure")

        # Repetitive text (same sentence repeated 3+ times)
        sentences = re.split(r"[.!?]+", stripped)
        sentences_lower = [s.strip().lower() for s in sentences if s.strip()]
        if sentences_lower:
            counts = Counter(sentences_lower)
            most_common_count = counts.most_common(1)[0][1] if counts else 0
            if most_common_count >= 3:
                flags.append("repetitive")

        # Contains error markers
        error_pattern = re.compile(
            r"\b(Error:|Failed|Traceback|Exception:|FATAL)\b", re.IGNORECASE
        )
        if error_pattern.search(stripped):
            flags.append("error_markers")

        return flags



# ── Originally: feedback.py ──

# mypy: ignore-errors
"""
Feedback Collector — Captures user corrections and quality signals.

Stores feedback from:
- Template mapping corrections (field→column remapping)
- Report quality ratings (thumbs up/down, star ratings)
- Agent task feedback (helpful/not helpful)

Feedback is used by:
- DSPy optimizer (Phase 5): mapping corrections → training examples
- Thompson Sampler (Phase 7): strategy variant selection
- Quality evaluator: calibrating scoring thresholds
"""

import json
import logging
import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pathlib import Path

logger = logging.getLogger("neura.quality.feedback")


class FeedbackType(str, Enum):
    MAPPING_CORRECTION = "mapping_correction"
    REPORT_RATING = "report_rating"
    AGENT_THUMBS = "agent_thumbs"
    CONTENT_EDIT = "content_edit"
    QUALITY_FLAG = "quality_flag"
    GENERAL = "general"


@dataclass
class FeedbackEntry:
    """A single feedback entry from a user."""
    feedback_id: str
    feedback_type: FeedbackType
    timestamp: float = field(default_factory=time.time)
    user_id: Optional[str] = None

    # What was being evaluated
    entity_type: str = ""  # "template", "report", "agent_task", "mapping"
    entity_id: str = ""

    # The feedback itself
    rating: Optional[float] = None  # 0.0-1.0 normalized score
    correction: Optional[Dict[str, Any]] = None  # Before/after correction
    comment: Optional[str] = None

    # Context
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "feedback_id": self.feedback_id,
            "feedback_type": self.feedback_type.value,
            "timestamp": datetime.fromtimestamp(self.timestamp, tz=timezone.utc).isoformat(),
            "user_id": self.user_id,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "rating": self.rating,
            "correction": self.correction,
            "comment": self.comment,
            "metadata": self.metadata,
        }


class FeedbackCollector:
    """
    Collects and stores user feedback for quality improvement.

    Feedback is stored in-memory with optional persistence to JSON file.
    Provides aggregation methods for downstream consumers (DSPy optimizer,
    Thompson Sampler).

    Usage:
        collector = get_feedback_collector()
        collector.record_mapping_correction(
            template_id="tpl_123",
            field_name="pressure",
            old_column="temperature",
            new_column="pressure_reading",
        )
        corrections = collector.get_mapping_corrections(template_id="tpl_123")
    """

    def __init__(self, persist_path: Optional[str] = None, max_entries: int = 10000):
        self._entries: List[FeedbackEntry] = []
        self._by_type: Dict[FeedbackType, List[FeedbackEntry]] = defaultdict(list)
        self._by_entity: Dict[str, List[FeedbackEntry]] = defaultdict(list)
        self._persist_path = Path(persist_path) if persist_path else None
        self._max_entries = max_entries
        self._lock = threading.Lock()
        self._counter = 0

        if self._persist_path and self._persist_path.exists():
            self._load()

    def _next_id(self) -> str:
        self._counter += 1
        return f"fb_{int(time.time())}_{self._counter}"

    def record(self, entry: FeedbackEntry) -> str:
        """Record a feedback entry. Returns the feedback_id."""
        with self._lock:
            if not entry.feedback_id:
                entry.feedback_id = self._next_id()

            self._entries.append(entry)
            self._by_type[entry.feedback_type].append(entry)
            self._by_entity[f"{entry.entity_type}:{entry.entity_id}"].append(entry)

            # Prune if too many
            if len(self._entries) > self._max_entries:
                removed = self._entries[:100]
                self._entries = self._entries[100:]
                for r in removed:
                    type_list = self._by_type.get(r.feedback_type, [])
                    if r in type_list:
                        type_list.remove(r)

            if self._persist_path:
                self._save_entry(entry)

            logger.info("feedback_recorded", extra={
                "feedback_id": entry.feedback_id,
                "type": entry.feedback_type.value,
                "entity": f"{entry.entity_type}:{entry.entity_id}",
            })

            return entry.feedback_id

    def record_mapping_correction(
        self,
        template_id: str,
        field_name: str,
        old_column: str,
        new_column: str,
        user_id: Optional[str] = None,
    ) -> str:
        """Convenience method for recording a mapping correction."""
        return self.record(FeedbackEntry(
            feedback_id="",
            feedback_type=FeedbackType.MAPPING_CORRECTION,
            user_id=user_id,
            entity_type="template",
            entity_id=template_id,
            correction={
                "field_name": field_name,
                "old_column": old_column,
                "new_column": new_column,
            },
        ))

    def record_report_rating(
        self,
        report_id: str,
        rating: float,
        comment: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> str:
        """Convenience method for recording a report quality rating."""
        return self.record(FeedbackEntry(
            feedback_id="",
            feedback_type=FeedbackType.REPORT_RATING,
            user_id=user_id,
            entity_type="report",
            entity_id=report_id,
            rating=max(0.0, min(1.0, rating)),
            comment=comment,
        ))

    def record_agent_thumbs(
        self,
        task_id: str,
        thumbs_up: bool,
        comment: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> str:
        """Convenience method for recording agent task feedback."""
        return self.record(FeedbackEntry(
            feedback_id="",
            feedback_type=FeedbackType.AGENT_THUMBS,
            user_id=user_id,
            entity_type="agent_task",
            entity_id=task_id,
            rating=1.0 if thumbs_up else 0.0,
            comment=comment,
        ))

    def get_mapping_corrections(
        self, template_id: Optional[str] = None, limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get mapping corrections, optionally filtered by template."""
        with self._lock:
            entries = self._by_type.get(FeedbackType.MAPPING_CORRECTION, [])
            if template_id:
                entries = [e for e in entries if e.entity_id == template_id]
            entries = entries[-limit:]
            return [e.correction for e in entries if e.correction]

    def get_ratings(
        self, entity_type: str, entity_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get aggregated ratings for an entity type."""
        with self._lock:
            if entity_id:
                entries = self._by_entity.get(f"{entity_type}:{entity_id}", [])
            else:
                entries = [
                    e for e in self._entries
                    if e.entity_type == entity_type and e.rating is not None
                ]

            ratings = [e.rating for e in entries if e.rating is not None]
            if not ratings:
                return {"count": 0, "average": 0.0, "min": 0.0, "max": 0.0}

            return {
                "count": len(ratings),
                "average": round(sum(ratings) / len(ratings), 4),
                "min": round(min(ratings), 4),
                "max": round(max(ratings), 4),
            }

    def get_stats(self) -> Dict[str, Any]:
        """Get overall feedback statistics."""
        with self._lock:
            return {
                "total_entries": len(self._entries),
                "by_type": {
                    ft.value: len(entries)
                    for ft, entries in self._by_type.items()
                },
                "entity_count": len(self._by_entity),
            }

    # ------------------------------------------------------------------
    # Reward mapping (ported from new-repo feedback module)
    # ------------------------------------------------------------------

    def to_reward(self, entry: FeedbackEntry) -> float:
        """Convert a feedback entry into a scalar reward signal.

        Mapping
        -------
        AGENT_THUMBS with rating 1.0  ->  +1.0
        AGENT_THUMBS with rating 0.0  ->  -1.0
        REPORT_RATING                 ->  (rating - 0.5) * 2.0   (maps 0-1 to -1.0 .. +1.0)
        MAPPING_CORRECTION            ->  -0.5
        QUALITY_FLAG                  ->  -0.3
        GENERAL / CONTENT_EDIT        ->  0.0
        """
        if entry.feedback_type == FeedbackType.AGENT_THUMBS:
            return 1.0 if (entry.rating and entry.rating >= 0.5) else -1.0
        if entry.feedback_type == FeedbackType.REPORT_RATING:
            rating = entry.rating if entry.rating is not None else 0.5
            return (rating - 0.5) * 2.0
        if entry.feedback_type == FeedbackType.MAPPING_CORRECTION:
            return -0.5
        if entry.feedback_type == FeedbackType.QUALITY_FLAG:
            return -0.3
        return 0.0

    def aggregate_rewards(self, entity_type: str, entity_id: str) -> float:
        """Average reward across all feedback for the given entity."""
        key = f"{entity_type}:{entity_id}"
        with self._lock:
            entries = self._by_entity.get(key, [])
        if not entries:
            return 0.0
        return sum(self.to_reward(e) for e in entries) / len(entries)

    def _save_entry(self, entry: FeedbackEntry) -> None:
        """Append a single entry to the persistence file."""
        try:
            with open(self._persist_path, "a") as f:
                f.write(json.dumps(entry.to_dict()) + "\n")
        except Exception as exc:
            logger.warning("Failed to persist feedback: %s", exc)

    def _load(self) -> None:
        """Load feedback entries from persistence file."""
        try:
            with open(self._persist_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    data = json.loads(line)
                    entry = FeedbackEntry(
                        feedback_id=data["feedback_id"],
                        feedback_type=FeedbackType(data["feedback_type"]),
                        timestamp=time.time(),
                        user_id=data.get("user_id"),
                        entity_type=data.get("entity_type", ""),
                        entity_id=data.get("entity_id", ""),
                        rating=data.get("rating"),
                        correction=data.get("correction"),
                        comment=data.get("comment"),
                        metadata=data.get("metadata", {}),
                    )
                    self._entries.append(entry)
                    self._by_type[entry.feedback_type].append(entry)
                    self._by_entity[f"{entry.entity_type}:{entry.entity_id}"].append(entry)
            logger.info("Loaded %d feedback entries from %s", len(self._entries), self._persist_path)
        except Exception as exc:
            logger.warning("Failed to load feedback: %s", exc)


# Global instance
_feedback_collector: Optional[FeedbackCollector] = None


def get_feedback_collector() -> FeedbackCollector:
    """Get the global feedback collector."""
    global _feedback_collector
    if _feedback_collector is None:
        _feedback_collector = FeedbackCollector()
    return _feedback_collector



# ── Originally: loop.py ──

# mypy: ignore-errors
"""
Quality Loop — Iterative execution with quality breakers.

Inspired by BFI's agent/loop.py pattern. Executes a task, evaluates quality,
and retries with refined context until quality thresholds are met or breakers
trigger (max iterations, timeout, quality plateau).

Usage:
    loop = QualityLoop(
        breakers=[MaxIterationBreaker(3), QualityBreaker(0.7), TimeoutBreaker(300)]
    )
    result = await loop.run(execute_fn, evaluate_fn, refine_fn, initial_input)
"""

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, List, Optional

logger = logging.getLogger("neura.quality.loop")


# ---------------------------------------------------------------------------
# Breaker definitions
# ---------------------------------------------------------------------------

class Breaker(ABC):
    """Abstract breaker that can stop the quality loop."""

    @abstractmethod
    def should_break(self, context: "LoopContext") -> bool:
        """Return True if the loop should stop."""
        ...

    @abstractmethod
    def reason(self) -> str:
        """Human-readable reason for breaking."""
        ...


# Alias for compatibility with new-repo interface
LoopBreaker = Breaker


class MaxIterationBreaker(Breaker):
    """Break after a maximum number of iterations."""

    def __init__(self, max_iterations: int = 3):
        self._max = max_iterations

    def should_break(self, context: "LoopContext") -> bool:
        return context.iteration >= self._max

    def reason(self) -> str:
        return f"Max iterations ({self._max}) reached"


class QualityBreaker(Breaker):
    """Break when quality score meets the threshold."""

    def __init__(self, min_score: float = 0.7):
        self._min_score = min_score

    def should_break(self, context: "LoopContext") -> bool:
        if not context.scores:
            return False
        return context.scores[-1] >= self._min_score

    def reason(self) -> str:
        return f"Quality threshold ({self._min_score}) met"


class TimeoutBreaker(Breaker):
    """Break after wall-clock timeout."""

    def __init__(self, timeout_seconds: int = 300):
        self._timeout = timeout_seconds

    def should_break(self, context: "LoopContext") -> bool:
        return (time.monotonic() - context.start_time) > self._timeout

    def reason(self) -> str:
        return f"Timeout ({self._timeout}s) exceeded"


class PlateauBreaker(Breaker):
    """Break when quality score stops improving."""

    def __init__(self, min_improvement: float = 0.02, patience: int = 2):
        self._min_improvement = min_improvement
        self._patience = patience

    def should_break(self, context: "LoopContext") -> bool:
        if len(context.scores) < self._patience + 1:
            return False
        recent = context.scores[-self._patience:]
        baseline = context.scores[-(self._patience + 1)]
        return all(s - baseline < self._min_improvement for s in recent)

    def reason(self) -> str:
        return f"Quality plateau (min improvement {self._min_improvement})"


# ---------------------------------------------------------------------------
# Loop context
# ---------------------------------------------------------------------------

@dataclass
class LoopContext:
    """Tracks state across quality loop iterations."""
    iteration: int = 0
    start_time: float = field(default_factory=time.monotonic)
    scores: List[float] = field(default_factory=list)
    results: List[Any] = field(default_factory=list)
    feedbacks: List[str] = field(default_factory=list)
    break_reason: Optional[str] = None
    best_result: Any = None
    best_score: float = 0.0


@dataclass
class LoopResult:
    """Final result from the quality loop."""
    result: Any
    score: float
    iterations: int
    total_time_ms: int
    break_reason: str
    all_scores: List[float]
    improved: bool  # Whether final result is better than first


# ---------------------------------------------------------------------------
# Quality Loop
# ---------------------------------------------------------------------------

# Type aliases for the callback functions
ExecuteFn = Callable[[Any], Awaitable[Any]]
EvaluateFn = Callable[[Any], Awaitable[float]]
RefineFn = Callable[[Any, Any, float, str], Awaitable[Any]]

class QualityLoop:
    """
    Iterative quality improvement loop.

    Executes a task, evaluates the result, and optionally refines and retries
    until a breaker condition is met. Tracks the best result across all iterations.

    Args:
        breakers: List of Breaker instances that control loop termination.
            Default: [MaxIterationBreaker(3), QualityBreaker(0.7), TimeoutBreaker(300)]
        progress_callback: Optional callback for progress updates.
    """

    def __init__(
        self,
        breakers: Optional[List[Breaker]] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ):
        self._breakers = breakers or [
            MaxIterationBreaker(3),
            QualityBreaker(0.7),
            TimeoutBreaker(300),
        ]
        self._progress = progress_callback

    async def run(
        self,
        execute_fn: ExecuteFn,
        evaluate_fn: EvaluateFn,
        refine_fn: Optional[RefineFn] = None,
        initial_input: Any = None,
    ) -> LoopResult:
        """
        Execute the quality loop.

        Args:
            execute_fn: Async function that produces a result from input.
            evaluate_fn: Async function that scores a result (0.0-1.0).
            refine_fn: Optional async function that refines input based on
                (input, result, score, feedback) → refined_input.
            initial_input: Initial input to pass to execute_fn.

        Returns:
            LoopResult with the best result and metadata.
        """
        ctx = LoopContext()
        current_input = initial_input

        logger.info("quality_loop_start", extra={"breakers": len(self._breakers)})

        while True:
            ctx.iteration += 1

            if self._progress:
                self._progress(
                    min(10 + ctx.iteration * 20, 90),
                    f"Quality iteration {ctx.iteration}",
                )

            # Execute
            try:
                result = await execute_fn(current_input)
            except Exception as exc:
                logger.error("quality_loop_execute_error", extra={
                    "iteration": ctx.iteration, "error": str(exc)[:200]
                })
                break

            ctx.results.append(result)

            # Evaluate
            try:
                score = await evaluate_fn(result)
            except Exception as exc:
                logger.error("quality_loop_evaluate_error", extra={
                    "iteration": ctx.iteration, "error": str(exc)[:200]
                })
                score = 0.0

            ctx.scores.append(score)

            logger.info("quality_loop_iteration", extra={
                "iteration": ctx.iteration, "score": round(score, 4),
            })

            # Track best
            if score > ctx.best_score:
                ctx.best_score = score
                ctx.best_result = result

            # Check breakers
            broken = False
            for breaker in self._breakers:
                if breaker.should_break(ctx):
                    ctx.break_reason = breaker.reason()
                    broken = True
                    logger.info("quality_loop_break", extra={
                        "reason": ctx.break_reason,
                        "iteration": ctx.iteration,
                        "score": round(score, 4),
                    })
                    break

            if broken:
                break

            # Refine for next iteration
            if refine_fn:
                feedback = f"Score: {score:.2f}. Improve quality."
                ctx.feedbacks.append(feedback)
                try:
                    current_input = await refine_fn(current_input, result, score, feedback)
                except Exception as exc:
                    logger.error("quality_loop_refine_error", extra={
                        "iteration": ctx.iteration, "error": str(exc)[:200]
                    })
                    break
            else:
                # No refinement function — single execution only
                break

        elapsed_ms = int((time.monotonic() - ctx.start_time) * 1000)

        return LoopResult(
            result=ctx.best_result if ctx.best_result is not None else (ctx.results[-1] if ctx.results else None),
            score=ctx.best_score,
            iterations=ctx.iteration,
            total_time_ms=elapsed_ms,
            break_reason=ctx.break_reason or "No breaker triggered",
            all_scores=ctx.scores,
            improved=len(ctx.scores) > 1 and ctx.scores[-1] > ctx.scores[0],
        )



# ── Originally: rl_experience.py ──

# mypy: ignore-errors
"""
Thompson Sampling RL Experience Buffer.

Implements a multi-armed bandit approach to variant/strategy selection.
Each (context, strategy) pair has a Beta distribution tracking successes
and failures. Thompson Sampling selects the next strategy by sampling
from each distribution and choosing the highest sample.

Used for:
- Prompt strategy selection (which prompt template works best for a template type)
- Model selection (qwen for all operations)
- Pipeline parameter tuning (chunk sizes, retry counts)

Inspired by BFI's Thompson Sampling pattern for variant exploration.

Usage:
    sampler = ThompsonSampler()
    strategy = sampler.select("template_mapping", ["strategy_a", "strategy_b", "strategy_c"])
    # ... execute with selected strategy ...
    sampler.record("template_mapping", strategy, success=True)
"""

import logging
import random
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("neura.quality.rl_experience")


@dataclass
class BetaParams:
    """Beta distribution parameters for a (context, strategy) pair."""
    alpha: float = 1.0  # Successes + 1 (prior)
    beta: float = 1.0   # Failures + 1 (prior)
    total_trials: int = 0
    last_update: float = field(default_factory=time.time)

    @property
    def mean(self) -> float:
        """Expected success rate."""
        return self.alpha / (self.alpha + self.beta)

    @property
    def variance(self) -> float:
        """Variance of the distribution (uncertainty)."""
        a, b = self.alpha, self.beta
        return (a * b) / ((a + b) ** 2 * (a + b + 1))

    def sample(self) -> float:
        """Draw a sample from the Beta distribution."""
        return random.betavariate(self.alpha, self.beta)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alpha": round(self.alpha, 4),
            "beta": round(self.beta, 4),
            "mean": round(self.mean, 4),
            "variance": round(self.variance, 6),
            "total_trials": self.total_trials,
        }


# Alias for compatibility with new-repo interface
BetaArm = BetaParams


@dataclass
class ExperienceRecord:
    """A single experience record."""
    context: str
    strategy: str
    success: bool
    reward: float  # 0.0-1.0
    timestamp: float
    metadata: Dict[str, Any] = field(default_factory=dict)


class ExperienceBuffer:
    """
    Ring buffer for storing raw experience records.

    Keeps the most recent N records for audit and analysis.
    """

    def __init__(self, max_size: int = 5000):
        self._buffer: List[ExperienceRecord] = []
        self._max_size = max_size
        self._lock = threading.Lock()

    def add(self, record: ExperienceRecord) -> None:
        with self._lock:
            self._buffer.append(record)
            if len(self._buffer) > self._max_size:
                self._buffer = self._buffer[-self._max_size:]

    def get_recent(self, context: Optional[str] = None, limit: int = 100) -> List[ExperienceRecord]:
        with self._lock:
            records = self._buffer
            if context:
                records = [r for r in records if r.context == context]
            return records[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            contexts = defaultdict(int)
            for r in self._buffer:
                contexts[r.context] += 1
            return {
                "total_records": len(self._buffer),
                "contexts": dict(contexts),
            }


class ThompsonSampler:
    """
    Thompson Sampling for strategy selection.

    Maintains Beta distribution parameters for each (context, strategy) pair.
    Selects strategies by sampling from each distribution and picking the
    highest value — balancing exploration (uncertain strategies) and
    exploitation (known-good strategies).

    Args:
        decay_rate: Optional temporal decay for old observations.
            0.0 = no decay, 0.01 = moderate decay.
        prior_strength: Strength of the uniform prior (higher = more exploration).
    """

    def __init__(
        self,
        decay_rate: float = 0.0,
        prior_strength: float = 1.0,
        experience_buffer_size: int = 5000,
    ):
        self._params: Dict[str, Dict[str, BetaParams]] = defaultdict(dict)
        self._decay_rate = decay_rate
        self._prior = prior_strength
        self._buffer = ExperienceBuffer(max_size=experience_buffer_size)
        self._lock = threading.Lock()
        self._loading_from_jsonl = False

        # V2: Reload bandit state from JSONL if exists
        try:
            from backend.app.services.infra_services import get_v2_config
            cfg = get_v2_config()
            if cfg.rl_persist_to_jsonl:
                import json
                from pathlib import Path
                jsonl_path = Path(cfg.rl_jsonl_path)
                if jsonl_path.exists():
                    self._loading_from_jsonl = True
                    loaded_count = 0
                    with open(jsonl_path) as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            record = json.loads(line)
                            self.record(
                                context=record["context"],
                                strategy=record["strategy"],
                                success=record.get("success", True),
                                reward=record.get("reward", 1.0),
                            )
                            loaded_count += 1
                    self._loading_from_jsonl = False
                    logger.info("Loaded %d RL experience records from JSONL", loaded_count)
        except Exception:
            self._loading_from_jsonl = False
            pass  # JSONL reload is non-critical

    def select(self, context: str, strategies: List[str]) -> str:
        """
        Select a strategy using Thompson Sampling.

        Args:
            context: The context key (e.g., "template_mapping", "model_selection").
            strategies: Available strategies to choose from.

        Returns:
            The selected strategy name.
        """
        if not strategies:
            raise ValueError("No strategies provided")

        if len(strategies) == 1:
            return strategies[0]

        with self._lock:
            best_strategy = strategies[0]
            best_sample = -1.0

            for strategy in strategies:
                params = self._get_or_create(context, strategy)
                sample = params.sample()
                if sample > best_sample:
                    best_sample = sample
                    best_strategy = strategy

            logger.debug(
                "thompson_select: context=%s, selected=%s (sample=%.4f)",
                context, best_strategy, best_sample,
            )

            return best_strategy

    def record(
        self,
        context: str,
        strategy: str,
        success: bool,
        reward: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Record the outcome of using a strategy.

        Args:
            context: The context key.
            strategy: The strategy that was used.
            success: Whether the strategy succeeded.
            reward: Optional continuous reward (0.0-1.0). If None, uses 1.0/0.0.
            metadata: Optional metadata for the experience record.
        """
        effective_reward = reward if reward is not None else (1.0 if success else 0.0)
        effective_reward = max(0.0, min(1.0, effective_reward))

        with self._lock:
            params = self._get_or_create(context, strategy)
            params.alpha += effective_reward
            params.beta += (1.0 - effective_reward)
            params.total_trials += 1
            params.last_update = time.time()

        self._buffer.add(ExperienceRecord(
            context=context,
            strategy=strategy,
            success=success,
            reward=effective_reward,
            timestamp=time.time(),
            metadata=metadata or {},
        ))

        logger.info("thompson_record", extra={
            "context": context,
            "strategy": strategy,
            "success": success,
            "reward": round(effective_reward, 4),
            "mean": round(params.mean, 4),
        })

        # V2: Persist to JSONL if configured (skip during reload to avoid duplication)
        if not self._loading_from_jsonl:
            try:
                from backend.app.services.infra_services import get_v2_config
                cfg = get_v2_config()
                if cfg.rl_persist_to_jsonl:
                    import json
                    from pathlib import Path
                    jsonl_path = Path(cfg.rl_jsonl_path)
                    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
                    record = {
                        "context": context,
                        "strategy": strategy,
                        "success": success,
                        "reward": effective_reward,
                        "timestamp": time.time(),
                    }
                    with open(jsonl_path, "a") as f:
                        f.write(json.dumps(record) + "\n")
            except Exception:
                pass  # JSONL persistence is non-critical

    def get_strategy_stats(self, context: str) -> Dict[str, Any]:
        """Get stats for all strategies in a context."""
        with self._lock:
            strategies = self._params.get(context, {})
            return {
                name: params.to_dict()
                for name, params in sorted(strategies.items())
            }

    def get_best_strategy(self, context: str) -> Optional[Tuple[str, float]]:
        """Get the current best strategy by expected value (exploitation only)."""
        with self._lock:
            strategies = self._params.get(context, {})
            if not strategies:
                return None

            best = max(strategies.items(), key=lambda x: x[1].mean)
            return (best[0], best[1].mean)

    def get_all_stats(self) -> Dict[str, Any]:
        """Get stats for all contexts."""
        with self._lock:
            return {
                "contexts": {
                    ctx: {
                        name: params.to_dict()
                        for name, params in strategies.items()
                    }
                    for ctx, strategies in self._params.items()
                },
                "experience_buffer": self._buffer.get_stats(),
            }

    def reset(self, context: Optional[str] = None) -> None:
        """Reset parameters. If context is given, reset only that context."""
        with self._lock:
            if context:
                self._params.pop(context, None)
            else:
                self._params.clear()

    def _get_or_create(self, context: str, strategy: str) -> BetaParams:
        """Get or create Beta parameters for a (context, strategy) pair."""
        if strategy not in self._params[context]:
            self._params[context][strategy] = BetaParams(
                alpha=self._prior,
                beta=self._prior,
            )
        return self._params[context][strategy]


# ---------------------------------------------------------------------------
# RLExperienceStore — state-store persistent experience tuples
# (Ported from new-repo for domain-bucketed experience replay)
# ---------------------------------------------------------------------------


class RLExperienceStore:
    """Append-only store of (state, action, reward) experience tuples.

    Experiences are bucketed by *domain* and persisted to the
    state store so they survive process restarts.
    """

    def __init__(self) -> None:
        self._experiences: Dict[str, List[dict]] = defaultdict(list)
        self._lock = threading.Lock()
        self._max_per_domain: int = 1000
        self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record(
        self,
        domain: str,
        state: dict,
        action: str,
        reward: float,
        metadata: Optional[dict] = None,
    ) -> None:
        """Append an experience tuple and persist."""
        entry = {
            "state": state,
            "action": action,
            "reward": reward,
            "metadata": metadata or {},
        }
        with self._lock:
            bucket = self._experiences[domain]
            bucket.append(entry)
            # Trim oldest entries when over capacity
            if len(bucket) > self._max_per_domain:
                self._experiences[domain] = bucket[-self._max_per_domain:]
            self._persist()

    def get_experiences(
        self, domain: str, limit: int = 100
    ) -> List[dict]:
        """Return the most recent experiences for *domain*."""
        with self._lock:
            bucket = self._experiences.get(domain, [])
            return list(bucket[-limit:])

    def get_best_action(self, domain: str) -> Optional[str]:
        """Return the action with the highest average reward in *domain*.

        Returns ``None`` if no experiences have been recorded.
        """
        with self._lock:
            bucket = self._experiences.get(domain, [])
            if not bucket:
                return None

        # Group by action, compute average reward
        totals: Dict[str, float] = defaultdict(float)
        counts: Dict[str, int] = defaultdict(int)
        for exp in bucket:
            action = exp.get("action", "")
            totals[action] += exp.get("reward", 0.0)
            counts[action] += 1

        best_action: Optional[str] = None
        best_avg = float("-inf")
        for action, total in totals.items():
            avg = total / counts[action]
            if avg > best_avg:
                best_avg = avg
                best_action = action

        return best_action

    # ------------------------------------------------------------------
    # Persistence (follows docqa/service.py state-store pattern)
    # ------------------------------------------------------------------

    def _persist(self) -> None:
        """Write experiences to the state store."""
        try:
            from backend.app.repositories import state_store as state_store_module

            store = state_store_module.state_store
            with store._lock:
                state = store._read_state() or {}
                if not isinstance(state, dict):
                    state = {}
                state["rl_experiences"] = dict(self._experiences)
                store._write_state(state)
        except Exception as exc:
            logger.warning(
                "rl_persist_failed",
                extra={"event": "rl_persist_failed", "error": str(exc)},
            )

    def _load(self) -> None:
        """Restore experiences from the state store on startup."""
        try:
            from backend.app.repositories import state_store as state_store_module

            store = state_store_module.state_store
            with store._lock:
                state = store._read_state() or {}
            if not isinstance(state, dict):
                return
            raw = state.get("rl_experiences", {})
            if not isinstance(raw, dict):
                return
            for domain, entries in raw.items():
                if isinstance(entries, list):
                    self._experiences[domain] = entries
        except Exception as exc:
            logger.warning(
                "rl_load_failed",
                extra={"event": "rl_load_failed", "error": str(exc)},
            )


# ---------------------------------------------------------------------------
# Singletons
# ---------------------------------------------------------------------------

# Global instance
_thompson_sampler: Optional[ThompsonSampler] = None


def get_thompson_sampler() -> ThompsonSampler:
    """Get the global Thompson Sampler."""
    global _thompson_sampler
    if _thompson_sampler is None:
        _thompson_sampler = ThompsonSampler()
    return _thompson_sampler


_experience_store: Optional[RLExperienceStore] = None
_experience_store_lock = threading.Lock()


def get_experience_store() -> RLExperienceStore:
    """Return the process-wide :class:`RLExperienceStore` singleton."""
    global _experience_store
    if _experience_store is None:
        with _experience_store_lock:
            if _experience_store is None:
                _experience_store = RLExperienceStore()
    return _experience_store
