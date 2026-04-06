# mypy: ignore-errors
"""
DSPy Optimization Module (merged from V1 optimization/).

Provides:
- DSPy signatures for report quality, field mapping, query classification, SQL validation, content summarization
- DSPy module wrappers with caching
- Claude Code LM adapter for DSPy
- BootstrapFewShot optimizer

All DSPy imports are conditional; stubs are used when DSPy is not installed.
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("neura.optimization")

# ---------------------------------------------------------------------------
# Optional dependency: DSPy
# ---------------------------------------------------------------------------
_dspy_available = False
try:
    import dspy
    _dspy_available = True
    logger.debug("dspy_available", extra={"event": "dspy_available"})
except ImportError:
    logger.debug("dspy_unavailable", extra={"event": "dspy_unavailable", "fallback": "stub"})


# =========================================================================== #
#  Section 1: Signatures                                                      #
# =========================================================================== #

if _dspy_available:
    class ReportQualityAssessment(dspy.Signature):
        """Assess the quality of a generated report."""
        report_content: str = dspy.InputField(desc="The full report content to assess")
        context: str = dspy.InputField(desc="Original requirements and data context")
        quality_score: str = dspy.OutputField(desc="Quality score from 0.0 to 1.0")
        issues: str = dspy.OutputField(desc="List of issues found")
        suggestions: str = dspy.OutputField(desc="Improvement suggestions")

    class FieldMappingReasoner(dspy.Signature):
        """Reason about the best field mapping between source columns and target template fields."""
        source_columns: str = dspy.InputField(desc="Comma-separated source column names")
        target_fields: str = dspy.InputField(desc="Comma-separated target template field names")
        context: str = dspy.InputField(desc="Additional context about the data domain")
        mappings: str = dspy.OutputField(desc="JSON mapping of source columns to target fields")
        confidence: str = dspy.OutputField(desc="Confidence score from 0.0 to 1.0")
        reasoning: str = dspy.OutputField(desc="Step-by-step reasoning for the chosen mappings")

    class QueryClassifier(dspy.Signature):
        """Classify a natural language query by type and intent."""
        query: str = dspy.InputField(desc="The natural language query to classify")
        available_types: str = dspy.InputField(desc="Comma-separated list of valid query types")
        query_type: str = dspy.OutputField(desc="The classified query type")
        intent: str = dspy.OutputField(desc="The underlying intent of the query")
        entities: str = dspy.OutputField(desc="Extracted entities as JSON list")

    class SQLValidator(dspy.Signature):
        """Validate and optionally correct a SQL query."""
        sql_query: str = dspy.InputField(desc="The SQL query to validate")
        schema_context: str = dspy.InputField(desc="Database schema information for validation")
        is_valid: str = dspy.OutputField(desc="Whether the SQL is valid (true/false)")
        issues: str = dspy.OutputField(desc="List of validation issues found")
        corrected_sql: str = dspy.OutputField(desc="Corrected SQL query if issues were found")

    class ContentSummarizer(dspy.Signature):
        """Summarize content to a target length while preserving key information."""
        content: str = dspy.InputField(desc="The content to summarize")
        max_length: str = dspy.InputField(desc="Target maximum length in characters")
        summary: str = dspy.OutputField(desc="The summarized content")
        key_points: str = dspy.OutputField(desc="Bullet-point list of key information preserved")


# =========================================================================== #
#  Stub fallbacks (used when DSPy is NOT installed)                           #
# =========================================================================== #

@dataclass
class StubPrediction:
    """Mimics dspy.Prediction when DSPy is not installed."""
    _data: Dict[str, Any] = field(default_factory=dict)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._data.get(name, "")

    def __repr__(self) -> str:
        return f"StubPrediction({self._data})"


def stub_report_quality(report_content: str, context: str = "") -> StubPrediction:
    logger.warning("stub_report_quality called; DSPy unavailable")
    return StubPrediction(_data={"quality_score": "0.5", "issues": "DSPy unavailable", "suggestions": ""})


def stub_field_mapping(source_columns: str, target_fields: str, context: str = "") -> StubPrediction:
    logger.warning("stub_field_mapping called; DSPy unavailable")
    return StubPrediction(_data={"mappings": "{}", "confidence": "0.0", "reasoning": "DSPy unavailable"})


def stub_query_classifier(query: str, available_types: str = "") -> StubPrediction:
    logger.warning("stub_query_classifier called; DSPy unavailable")
    return StubPrediction(_data={"query_type": "unknown", "intent": "unknown", "entities": "[]"})


def stub_sql_validator(sql_query: str, schema_context: str = "") -> StubPrediction:
    logger.warning("stub_sql_validator called; DSPy unavailable")
    return StubPrediction(_data={"is_valid": "true", "issues": "DSPy unavailable; validation skipped", "corrected_sql": sql_query})


def stub_content_summarizer(content: str, max_length: str = "500") -> StubPrediction:
    logger.warning("stub_content_summarizer called; DSPy unavailable")
    limit = int(max_length) if max_length.isdigit() else 500
    return StubPrediction(_data={"summary": content[:limit], "key_points": "DSPy unavailable; content truncated only"})


def is_dspy_available() -> bool:
    return _dspy_available


_SIGNATURE_REGISTRY: Dict[str, Any] = {}

if _dspy_available:
    _SIGNATURE_REGISTRY = {
        "report_quality": ReportQualityAssessment,
        "field_mapping": FieldMappingReasoner,
        "query_classifier": QueryClassifier,
        "sql_validator": SQLValidator,
        "content_summarizer": ContentSummarizer,
    }
else:
    _SIGNATURE_REGISTRY = {
        "report_quality": stub_report_quality,
        "field_mapping": stub_field_mapping,
        "query_classifier": stub_query_classifier,
        "sql_validator": stub_sql_validator,
        "content_summarizer": stub_content_summarizer,
    }


def get_signature(name: str) -> Any:
    if name not in _SIGNATURE_REGISTRY:
        raise KeyError(f"Unknown signature '{name}'. Available: {', '.join(sorted(_SIGNATURE_REGISTRY))}")
    return _SIGNATURE_REGISTRY[name]


def available_signatures() -> List[str]:
    return sorted(_SIGNATURE_REGISTRY)


# =========================================================================== #
#  Section 2: DSPy Module wrappers                                            #
# =========================================================================== #

if _dspy_available:
    class ReportQualityModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.assess = dspy.ChainOfThought(ReportQualityAssessment)
        def forward(self, report_content: str, context: str = "") -> Any:
            return self.assess(report_content=report_content, context=context)

    class FieldMappingModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.reason = dspy.ChainOfThought(FieldMappingReasoner)
        def forward(self, source_columns: str, target_fields: str, context: str = "") -> Any:
            return self.reason(source_columns=source_columns, target_fields=target_fields, context=context)

    class QueryClassifierModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.classify = dspy.ChainOfThought(QueryClassifier)
        def forward(self, query: str, available_types: str = "") -> Any:
            return self.classify(query=query, available_types=available_types)

    class SQLValidatorModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.validate = dspy.ChainOfThought(SQLValidator)
        def forward(self, sql_query: str, schema_context: str = "") -> Any:
            return self.validate(sql_query=sql_query, schema_context=schema_context)

    class ContentSummarizerModule(dspy.Module):
        def __init__(self) -> None:
            super().__init__()
            self.summarize = dspy.ChainOfThought(ContentSummarizer)
        def forward(self, content: str, max_length: str = "500") -> Any:
            return self.summarize(content=content, max_length=max_length)


class FallbackReportQuality:
    def __call__(self, report_content: str, context: str = "") -> StubPrediction:
        return stub_report_quality(report_content, context)

class FallbackFieldMapping:
    def __call__(self, source_columns: str, target_fields: str, context: str = "") -> StubPrediction:
        return stub_field_mapping(source_columns, target_fields, context)

class FallbackQueryClassifier:
    def __call__(self, query: str, available_types: str = "") -> StubPrediction:
        return stub_query_classifier(query, available_types)

class FallbackSQLValidator:
    def __call__(self, sql_query: str, schema_context: str = "") -> StubPrediction:
        return stub_sql_validator(sql_query, schema_context)

class FallbackContentSummarizer:
    def __call__(self, content: str, max_length: str = "500") -> StubPrediction:
        return stub_content_summarizer(content, max_length)


class CachedModule:
    """Wraps a DSPy module (or fallback) with deterministic LRU caching."""
    def __init__(self, module: Any, cache_size: int = 50) -> None:
        self._module = module
        self._cache: Dict[str, Any] = {}
        self._cache_order: deque[str] = deque(maxlen=cache_size)
        self._cache_size = cache_size
        self._hits = 0
        self._misses = 0

    def __call__(self, **kwargs: Any) -> Any:
        key = hashlib.sha256(json.dumps(kwargs, sort_keys=True, default=str).encode()).hexdigest()
        if key in self._cache:
            self._hits += 1
            return self._cache[key]
        self._misses += 1
        result = self._module(**kwargs)
        if len(self._cache) >= self._cache_size:
            oldest = self._cache_order.popleft()
            self._cache.pop(oldest, None)
        self._cache[key] = result
        self._cache_order.append(key)
        return result

    def get_stats(self) -> Dict[str, Any]:
        total = self._hits + self._misses
        return {"hits": self._hits, "misses": self._misses, "hit_rate": self._hits / total if total else 0.0, "cache_size": len(self._cache)}

    def clear(self) -> None:
        self._cache.clear()
        self._cache_order.clear()
        self._hits = 0
        self._misses = 0


_MODULE_REGISTRY: Dict[str, type] = {
    "report_quality": (ReportQualityModule if _dspy_available else FallbackReportQuality),
    "field_mapping": (FieldMappingModule if _dspy_available else FallbackFieldMapping),
    "query_classifier": (QueryClassifierModule if _dspy_available else FallbackQueryClassifier),
    "sql_validator": (SQLValidatorModule if _dspy_available else FallbackSQLValidator),
    "content_summarizer": (ContentSummarizerModule if _dspy_available else FallbackContentSummarizer),
}

_module_cache: Dict[str, Any] = {}


def get_module(name: str, cached: bool = True) -> Any:
    if name not in _MODULE_REGISTRY:
        raise KeyError(f"Unknown module: {name!r}. Available: {sorted(_MODULE_REGISTRY)}")
    if name in _module_cache:
        return _module_cache[name]
    module = _MODULE_REGISTRY[name]()
    if cached:
        module = CachedModule(module)
    _module_cache[name] = module
    return module


def available_modules() -> list[str]:
    return sorted(_MODULE_REGISTRY)


def reset_module_cache() -> None:
    _module_cache.clear()


# =========================================================================== #
#  Section 3: Claude Code LM adapter for DSPy                                #
# =========================================================================== #

_BaseLM: type = object
if _dspy_available:
    try:
        _BaseLM = dspy.LM
    except AttributeError:
        _BaseLM = object


class ClaudeCodeLM(_BaseLM):  # type: ignore[misc]
    """DSPy language model adapter that routes through the NeuraReport LLM stack."""

    def __init__(self, model: str = "qwen", client: Optional[Any] = None, **kwargs: Any) -> None:
        if _BaseLM is not object:
            try:
                super().__init__(model=f"claude/{model}", **kwargs)
            except TypeError:
                super().__init__()
        else:
            super().__init__()
        self._model = model
        self._client = client
        self._history: deque[Dict[str, Any]] = deque(maxlen=100)

    def _get_client(self):
        if self._client is None:
            try:
                from backend.app.services.llm import get_llm_client
                self._client = get_llm_client()
            except Exception:
                pass
        return self._client

    def __call__(self, prompt: Optional[str] = None, messages: Optional[List[Dict[str, Any]]] = None, **kwargs: Any) -> list[str]:
        if prompt is not None and messages is None:
            msgs: List[Dict[str, Any]] = [{"role": "user", "content": str(prompt)}]
        elif messages is not None:
            msgs = list(messages)
        else:
            msgs = [{"role": "user", "content": ""}]
        client = self._get_client()
        if client is None:
            return ["(LLM client unavailable)"]
        response = client.complete(messages=msgs, model=self._model, description="dspy_adapter", **kwargs)
        response_text = ""
        try:
            response_text = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        except (AttributeError, IndexError, TypeError):
            response_text = str(response)
        self._history.append({"messages": msgs, "response": response_text[:500], "model": self._model})
        return [response_text]

    def inspect_history(self, n: int = 1) -> str:
        entries = list(self._history)[-n:]
        if not entries:
            return "(no history)"
        parts: list[str] = []
        for i, entry in enumerate(entries, 1):
            msg_preview = entry["messages"][-1]["content"][:200] if entry["messages"] else ""
            parts.append(f"--- Call {i} (model={entry['model']}) ---\nInput:  {msg_preview}...\nOutput: {entry['response'][:200]}...")
        return "\n\n".join(parts)


_configured = False


def configure_dspy_with_claude(model: str = "qwen", client: Optional[Any] = None) -> bool:
    global _configured
    if not _dspy_available:
        return False
    if _configured:
        return True
    try:
        lm = ClaudeCodeLM(model=model, client=client)
        try:
            dspy.configure(lm=lm)
        except (AttributeError, TypeError):
            try:
                dspy.settings.configure(lm=lm)
            except (AttributeError, TypeError):
                return False
        _configured = True
        return True
    except Exception:
        return False


# =========================================================================== #
#  Section 4: DSPyOptimizer                                                   #
# =========================================================================== #

@dataclass
class OptimizationConfig:
    max_bootstrapped_demos: int = 3
    max_labeled_demos: int = 5
    num_candidate_programs: int = 10
    metric_threshold: float = 0.7
    save_dir: Optional[Path] = None


def default_quality_metric(example: Any, prediction: Any, trace: Any = None) -> float:
    score_str = getattr(prediction, "quality_score", "")
    if not score_str:
        return 0.0
    try:
        return max(0.0, min(1.0, float(score_str)))
    except (ValueError, TypeError):
        return 0.5


class DSPyOptimizer:
    def __init__(self, config: Optional[OptimizationConfig] = None) -> None:
        self.config = config or OptimizationConfig()

    def optimize_module(self, module: Any, trainset: List[Any], metric: Callable[..., float] = default_quality_metric, save_name: Optional[str] = None) -> Any:
        # V2 feature flag: skip optimization when DSPy signatures are disabled
        try:
            from backend.app.services.config import get_v2_config
            if not get_v2_config().enable_dspy_signatures:
                return module
        except Exception:
            pass

        if not _dspy_available:
            return module
        configure_dspy_with_claude()
        try:
            optimizer = dspy.BootstrapFewShot(metric=metric, max_bootstrapped_demos=self.config.max_bootstrapped_demos, max_labeled_demos=self.config.max_labeled_demos)
            compiled = optimizer.compile(module, trainset=trainset)
            if save_name and self.config.save_dir:
                self.config.save_dir.mkdir(parents=True, exist_ok=True)
                compiled.save(self.config.save_dir / f"{save_name}.json")
            return compiled
        except Exception:
            logger.error("optimization_failed", exc_info=True)
            return module

    def evaluate(self, module: Any, testset: List[Any], metric: Callable[..., float] = default_quality_metric) -> Dict[str, Any]:
        if not _dspy_available or not testset:
            return {"score": 0.0, "num_examples": len(testset), "per_example": [], "note": "DSPy unavailable or empty test set"}
        per_example: List[Dict[str, Any]] = []
        total_score = 0.0
        for i, example in enumerate(testset):
            try:
                inputs = {k: v for k, v in example.items() if k not in ("dspy_uuid", "dspy_split")}
                prediction = module(**inputs)
                score = metric(example, prediction)
            except Exception:
                score = 0.0
            total_score += score
            per_example.append({"index": i, "score": score})
        return {"score": round(total_score / len(testset), 4), "num_examples": len(testset), "per_example": per_example}

    def load_optimized(self, module: Any, save_name: str) -> Any:
        """Load a previously saved optimization checkpoint from disk."""
        if not self.config.save_dir:
            return module
        path = self.config.save_dir / f"{save_name}.json"
        if not path.exists():
            logger.warning("optimization_checkpoint_not_found", extra={"path": str(path)})
            return module
        try:
            module.load(path)
            logger.info("optimization_checkpoint_loaded", extra={"path": str(path)})
            return module
        except Exception:
            logger.error("optimization_checkpoint_load_failed", exc_info=True)
            return module

    def _save_checkpoint(self, compiled: Any, save_name: str, metadata: Optional[Dict[str, Any]] = None) -> Optional[Path]:
        """Save optimized module checkpoint with metadata."""
        if not self.config.save_dir:
            return None
        self.config.save_dir.mkdir(parents=True, exist_ok=True)
        path = self.config.save_dir / f"{save_name}.json"
        try:
            compiled.save(path)
            if metadata:
                meta_path = self.config.save_dir / f"{save_name}_meta.json"
                import json
                meta_path.write_text(json.dumps(metadata, indent=2, default=str))
            logger.info("optimization_checkpoint_saved", extra={"path": str(path), "metadata": bool(metadata)})
            return path
        except Exception:
            logger.error("optimization_checkpoint_save_failed", exc_info=True)
            return None


_configured = False


def is_configured() -> bool:
    """Return whether DSPy has been configured."""
    return _configured


def reset_configuration() -> None:
    """Reset DSPy configuration state."""
    global _configured
    _configured = False


__all__ = [
    "is_dspy_available", "get_signature", "available_signatures", "StubPrediction",
    "get_module", "CachedModule", "available_modules", "reset_module_cache",
    "ClaudeCodeLM", "configure_dspy_with_claude",
    "DSPyOptimizer", "OptimizationConfig",
    "is_configured", "reset_configuration",
]
