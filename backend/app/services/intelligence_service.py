from __future__ import annotations


# ── Originally: signatures.py ──

# mypy: ignore-errors
"""
DSPy Signature Definitions for NeuraReport Intelligence Pipelines.

Each signature declares typed input/output fields that DSPy uses to
auto-generate prompts, enable chain-of-thought reasoning, and support
few-shot optimization via BootstrapFewShot.

When DSPy is unavailable, lightweight dataclass stubs are provided so
that downstream code can reference the same class names without import
errors.  The stub classes carry ``_is_stub = True`` for introspection.
"""


import logging
from dataclasses import dataclass
from typing import Any, Dict

logger = logging.getLogger("neura.intelligence.signatures")

# ---------------------------------------------------------------------------
# Attempt DSPy import
# ---------------------------------------------------------------------------
_dspy_available: bool = False
try:
    import dspy

    _dspy_available = True
except ImportError:
    pass


# ═══════════════════════════════════════════════════════════════════════════
# DSPy Signature Definitions (used when DSPy IS available)
# ═══════════════════════════════════════════════════════════════════════════

if _dspy_available:

    class TemplateFieldExtraction(dspy.Signature):
        """Extract structured field definitions from a PDF document.

        Given raw PDF text and optional layout hints (e.g. bounding-box
        coordinates, header positions), identify every fillable or data
        field in the document.  Return a JSON list of field descriptors,
        each containing at minimum: name, data_type, page_number, and
        an optional description.
        """

        pdf_text: str = dspy.InputField(
            desc="Full extracted text content of the PDF document."
        )
        layout_hints: str = dspy.InputField(
            desc=(
                "JSON-encoded layout metadata such as bounding boxes, "
                "header positions, and table coordinates."
            ),
        )
        extracted_fields: str = dspy.OutputField(
            desc=(
                "JSON array of extracted field objects. Each object must "
                "contain: name (str), data_type (str), page_number (int), "
                "and description (str, optional)."
            ),
        )

    class FieldToColumnMapping(dspy.Signature):
        """Map extracted document fields to database schema columns.

        Given a list of document fields and a target database schema,
        produce a mapping that pairs each field to the most semantically
        appropriate column.  Include a confidence score (0.0-1.0) for
        each mapping and flag any fields that have no suitable column.
        """

        extracted_fields: str = dspy.InputField(
            desc=(
                "JSON array of field descriptors as produced by "
                "TemplateFieldExtraction."
            ),
        )
        db_schema: str = dspy.InputField(
            desc=(
                "JSON object describing the target database schema: "
                "table names, column names, column types, and descriptions."
            ),
        )
        mappings: str = dspy.OutputField(
            desc=(
                "JSON array of mapping objects. Each contains: "
                "field_name (str), column_name (str | null), "
                "confidence (float 0-1), reason (str)."
            ),
        )

    class SQLGeneration(dspy.Signature):
        """Generate a safe, parameterized SQL query from a field mapping.

        Given validated field-to-column mappings and optional user-supplied
        filters, produce a SQL SELECT statement.  The SQL must use
        parameterized placeholders (``?``) for any literal values and
        must not contain destructive statements (INSERT, UPDATE, DELETE,
        DROP).
        """

        mapping: str = dspy.InputField(
            desc=(
                "JSON array of approved field-to-column mappings with "
                "column names and data types."
            ),
        )
        filters: str = dspy.InputField(
            desc=(
                "JSON object of user-supplied filter conditions, "
                "e.g. {\"date_from\": \"2025-01-01\", \"status\": \"active\"}."
            ),
        )
        sql: str = dspy.OutputField(
            desc=(
                "A safe, parameterized SQL SELECT query. Use '?' as "
                "placeholder for literal values. No DDL or DML statements."
            ),
        )

    class ContentSynthesis(dspy.Signature):
        """Synthesize coherent content from multiple source documents.

        Given a collection of source texts and a guiding query, produce
        a well-structured synthesis that integrates information across
        sources.  Cite source indices where relevant.
        """

        sources: str = dspy.InputField(
            desc=(
                "JSON array of source objects, each with 'index' (int) "
                "and 'text' (str)."
            ),
        )
        query: str = dspy.InputField(
            desc="The user's query or topic to synthesize content around.",
        )
        synthesis: str = dspy.OutputField(
            desc=(
                "A coherent, well-structured text that synthesizes "
                "information from the sources. Cite sources as [index]."
            ),
        )

    class QualityEvaluation(dspy.Signature):
        """Evaluate generated content against quality criteria.

        Assess a piece of generated content on specified criteria (e.g.
        accuracy, completeness, clarity) and return a numeric score plus
        actionable feedback for improvement.
        """

        content: str = dspy.InputField(
            desc="The generated content to evaluate.",
        )
        criteria: str = dspy.InputField(
            desc=(
                "JSON object defining evaluation criteria and their "
                "weights, e.g. {\"accuracy\": 0.4, \"completeness\": 0.3, "
                "\"clarity\": 0.3}."
            ),
        )
        score: float = dspy.OutputField(
            desc="Overall quality score from 0.0 (worst) to 1.0 (best).",
        )
        feedback: str = dspy.OutputField(
            desc=(
                "Structured feedback with per-criterion scores and "
                "specific suggestions for improvement."
            ),
        )

else:
    # ═══════════════════════════════════════════════════════════════════════
    # Stub Dataclass Signatures (used when DSPy is NOT available)
    # ═══════════════════════════════════════════════════════════════════════

    logger.debug("Creating stub signature dataclasses (DSPy not available)")

    @dataclass
    class _StubResult:
        """Generic container returned by stub signatures."""

        _is_stub: bool = True

        def __getattr__(self, name: str) -> Any:
            """Return empty string for any missing output field."""
            return ""

    @dataclass
    class TemplateFieldExtraction:  # type: ignore[no-redef]
        """Stub for TemplateFieldExtraction when DSPy is unavailable."""

        _is_stub: bool = True

        pdf_text: str = ""
        layout_hints: str = ""
        extracted_fields: str = ""

        class Config:
            input_fields = ("pdf_text", "layout_hints")
            output_fields = ("extracted_fields",)

    @dataclass
    class FieldToColumnMapping:  # type: ignore[no-redef]
        """Stub for FieldToColumnMapping when DSPy is unavailable."""

        _is_stub: bool = True

        extracted_fields: str = ""
        db_schema: str = ""
        mappings: str = ""

        class Config:
            input_fields = ("extracted_fields", "db_schema")
            output_fields = ("mappings",)

    @dataclass
    class SQLGeneration:  # type: ignore[no-redef]
        """Stub for SQLGeneration when DSPy is unavailable."""

        _is_stub: bool = True

        mapping: str = ""
        filters: str = ""
        sql: str = ""

        class Config:
            input_fields = ("mapping", "filters")
            output_fields = ("sql",)

    @dataclass
    class ContentSynthesis:  # type: ignore[no-redef]
        """Stub for ContentSynthesis when DSPy is unavailable."""

        _is_stub: bool = True

        sources: str = ""
        query: str = ""
        synthesis: str = ""

        class Config:
            input_fields = ("sources", "query")
            output_fields = ("synthesis",)

    @dataclass
    class QualityEvaluation:  # type: ignore[no-redef]
        """Stub for QualityEvaluation when DSPy is unavailable."""

        _is_stub: bool = True

        content: str = ""
        criteria: str = ""
        score: float = 0.0
        feedback: str = ""

        class Config:
            input_fields = ("content", "criteria")
            output_fields = ("score", "feedback")


# ---------------------------------------------------------------------------
# Registry for programmatic access
# ---------------------------------------------------------------------------

SIGNATURE_REGISTRY: Dict[str, type] = {
    "template_field_extraction": TemplateFieldExtraction,
    "field_to_column_mapping": FieldToColumnMapping,
    "sql_generation": SQLGeneration,
    "content_synthesis": ContentSynthesis,
    "quality_evaluation": QualityEvaluation,
}


def get_signature(name: str) -> type:
    """Look up a signature class by registry name.

    Args:
        name: One of the keys in SIGNATURE_REGISTRY.

    Returns:
        The corresponding signature class.

    Raises:
        KeyError: If the name is not found in the registry.
    """
    if name not in SIGNATURE_REGISTRY:
        available = ", ".join(sorted(SIGNATURE_REGISTRY.keys()))
        raise KeyError(
            f"Unknown signature '{name}'. Available: {available}"
        )
    return SIGNATURE_REGISTRY[name]



# ── Originally: modules.py ──

# mypy: ignore-errors
"""
Compiled ChainOfThought Modules for NeuraReport Intelligence Pipelines.

Each module wraps a DSPy Signature with ``dspy.ChainOfThought`` and
supports lazy initialization, on-disk caching of compiled weights, and
a factory function ``get_module(name)`` for uniform access.

When DSPy is not installed, stub modules are returned that delegate to
the raw LLM client (``get_llm_client().complete(...)``), producing
equivalent results without structured optimization.
"""

import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional


logger = logging.getLogger("neura.intelligence.modules")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_MODULE_DIR = Path(__file__).resolve().parent
_COMPILED_CACHE_DIR = _MODULE_DIR / "compiled_cache"
_COMPILED_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# DSPy availability
# ---------------------------------------------------------------------------
_dspy_available: bool = False
try:
    import dspy

    _dspy_available = True
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Thread-safe module cache
# ---------------------------------------------------------------------------
_module_cache: Dict[str, Any] = {}
_cache_lock = threading.Lock()


# ═══════════════════════════════════════════════════════════════════════════
# DSPy Compiled Modules (when DSPy IS available)
# ═══════════════════════════════════════════════════════════════════════════

if _dspy_available:

    class _CompiledModule:
        """Thin wrapper around a ``dspy.ChainOfThought`` with persistence.

        On first call the module checks ``compiled_cache/<name>.json``
        for previously optimized weights.  If found they are loaded
        transparently; otherwise the base (zero-shot) module is used.
        """

        def __init__(self, name: str, signature_cls: type) -> None:
            self.name = name
            self._signature_cls = signature_cls
            self._module: Optional[dspy.ChainOfThought] = None
            self._lock = threading.Lock()
            self._weights_path = _COMPILED_CACHE_DIR / f"{name}.json"

        # -- lazy init -------------------------------------------------------
        def _ensure_initialized(self) -> dspy.ChainOfThought:
            """Lazily construct (and optionally load weights for) the module."""
            if self._module is not None:
                return self._module

            with self._lock:
                # Double-check after acquiring lock
                if self._module is not None:
                    return self._module

                logger.info(
                    "Initializing DSPy ChainOfThought module '%s'", self.name
                )
                module = dspy.ChainOfThought(self._signature_cls)

                # Attempt to load compiled weights
                if self._weights_path.exists():
                    try:
                        module.load(str(self._weights_path))
                        logger.info(
                            "Loaded compiled weights for '%s' from %s",
                            self.name,
                            self._weights_path,
                        )
                    except Exception:
                        logger.warning(
                            "Failed to load compiled weights for '%s'; "
                            "falling back to zero-shot",
                            self.name,
                            exc_info=True,
                        )
                else:
                    logger.debug(
                        "No compiled weights found for '%s' at %s — "
                        "using zero-shot",
                        self.name,
                        self._weights_path,
                    )

                self._module = module
                return module

        # -- invocation ------------------------------------------------------
        def __call__(self, **kwargs: Any) -> Any:
            """Forward keyword arguments to the underlying DSPy module.

            Returns:
                A ``dspy.Prediction`` with output fields accessible as
                attributes.
            """
            module = self._ensure_initialized()
            logger.debug(
                "Calling module '%s' with keys: %s",
                self.name,
                list(kwargs.keys()),
            )
            return module(**kwargs)

        # -- persistence -----------------------------------------------------
        def save_weights(self) -> Path:
            """Persist the current module weights to disk.

            Returns:
                Path to the saved weights file.
            """
            module = self._ensure_initialized()
            module.save(str(self._weights_path))
            logger.info(
                "Saved compiled weights for '%s' to %s",
                self.name,
                self._weights_path,
            )
            return self._weights_path

        def has_compiled_weights(self) -> bool:
            """Return whether on-disk compiled weights exist."""
            return self._weights_path.exists()

        def __repr__(self) -> str:
            status = "compiled" if self.has_compiled_weights() else "zero-shot"
            init = "loaded" if self._module is not None else "pending"
            return (
                f"<CompiledModule name={self.name!r} "
                f"status={status} init={init}>"
            )

else:
    # ═══════════════════════════════════════════════════════════════════════
    # Stub Fallback Modules (when DSPy is NOT available)
    # ═══════════════════════════════════════════════════════════════════════

    class _StubPrediction:
        """Mimics ``dspy.Prediction`` for stub modules."""

        def __init__(self, data: Dict[str, Any]) -> None:
            self._data = data

        def __getattr__(self, name: str) -> Any:
            try:
                return self._data[name]
            except KeyError:
                raise AttributeError(
                    f"StubPrediction has no field '{name}'"
                ) from None

        def __repr__(self) -> str:
            fields = ", ".join(f"{k}=..." for k in self._data)
            return f"<StubPrediction({fields})>"

    # Map each signature to a system prompt used in fallback LLM calls
    _FALLBACK_PROMPTS: Dict[str, str] = {
        "template_field_extraction": (
            "You are a document analysis expert.  Given PDF text and layout "
            "hints, extract all structured fields.  Return a JSON array of "
            "objects with keys: name, data_type, page_number, description."
        ),
        "field_to_column_mapping": (
            "You are a data mapping specialist.  Given document fields and a "
            "database schema, produce a JSON array of mapping objects with "
            "keys: field_name, column_name (null if unmapped), confidence "
            "(0-1), reason."
        ),
        "sql_generation": (
            "You are an expert SQL engineer.  Given a field-to-column mapping "
            "and filter conditions, generate a safe parameterized SQL SELECT "
            "query using '?' placeholders.  No DDL/DML."
        ),
        "content_synthesis": (
            "You are a research synthesis writer.  Given multiple source texts "
            "and a query, produce a coherent synthesis citing sources as "
            "[index]."
        ),
        "quality_evaluation": (
            "You are a quality assessment expert.  Evaluate the given content "
            "against the provided criteria.  Return JSON with 'score' (0-1) "
            "and 'feedback' (structured per-criterion feedback)."
        ),
    }

    # Map signature names to their output field names
    _OUTPUT_FIELDS: Dict[str, List[str]] = {
        "template_field_extraction": ["fields"],
        "field_to_column_mapping": ["mappings"],
        "sql_generation": ["sql"],
        "content_synthesis": ["synthesis"],
        "quality_evaluation": ["score", "feedback"],
    }

    class _CompiledModule:  # type: ignore[no-redef]
        """Stub module that delegates to the raw LLM client.

        When DSPy is not available, this class constructs a prompt from
        the input kwargs and the signature's docstring, sends it through
        ``get_llm_client().complete()``, and wraps the response in a
        ``_StubPrediction``.
        """

        def __init__(self, name: str, signature_cls: type) -> None:
            self.name = name
            self._signature_cls = signature_cls
            self._system_prompt = _FALLBACK_PROMPTS.get(name, "")
            self._output_fields = _OUTPUT_FIELDS.get(name, [])

        def __call__(self, **kwargs: Any) -> _StubPrediction:
            """Build a prompt from kwargs and call the LLM."""
            from backend.app.services.llm import get_llm_client

            client = get_llm_client()

            # Construct a user message from input fields
            user_parts: List[str] = []
            for key, value in kwargs.items():
                user_parts.append(f"### {key}\n{value}")
            user_message = "\n\n".join(user_parts)

            # Request structured output for known output fields
            output_instruction = ""
            if self._output_fields:
                field_list = ", ".join(
                    f"'{f}'" for f in self._output_fields
                )
                output_instruction = (
                    f"\n\nReturn your response as JSON with keys: "
                    f"{field_list}."
                )

            messages = [
                {
                    "role": "system",
                    "content": self._system_prompt + output_instruction,
                },
                {"role": "user", "content": user_message},
            ]

            logger.debug(
                "Stub module '%s' calling LLM with %d input fields",
                self.name,
                len(kwargs),
            )

            try:
                response = client.complete(
                    messages=messages,
                    description=f"intelligence-stub-{self.name}",
                )
                # Extract text from OpenAI-compatible response
                text = (
                    response.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                )

                # Attempt to parse as JSON for structured output
                result: Dict[str, Any] = {}
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict):
                        result = parsed
                except (json.JSONDecodeError, TypeError):
                    # If single output field, assign raw text
                    if len(self._output_fields) == 1:
                        result = {self._output_fields[0]: text}
                    else:
                        result = {f: text for f in self._output_fields}

                return _StubPrediction(result)

            except Exception:
                logger.error(
                    "Stub module '%s' LLM call failed",
                    self.name,
                    exc_info=True,
                )
                # Return empty prediction rather than crashing
                return _StubPrediction(
                    {f: "" for f in self._output_fields}
                )

        def save_weights(self) -> Path:
            """No-op for stub modules."""
            logger.warning(
                "save_weights() called on stub module '%s' — "
                "install DSPy to enable compiled weight persistence",
                self.name,
            )
            return _COMPILED_CACHE_DIR / f"{self.name}.json"

        def has_compiled_weights(self) -> bool:
            """Stubs never have compiled weights."""
            return False

        def __repr__(self) -> str:
            return f"<StubModule name={self.name!r}>"


# ═══════════════════════════════════════════════════════════════════════════
# Factory & Cache
# ═══════════════════════════════════════════════════════════════════════════


def get_module(name: str) -> _CompiledModule:
    """Get or create a compiled (or stub) module by registry name.

    Modules are lazily initialized and cached for the lifetime of the
    process.  Thread-safe.

    Args:
        name: One of the keys in ``SIGNATURE_REGISTRY``
              (e.g. ``"template_field_extraction"``).

    Returns:
        A callable module instance.

    Raises:
        KeyError: If the name is not found in the signature registry.
    """
    if name not in SIGNATURE_REGISTRY:
        available = ", ".join(sorted(SIGNATURE_REGISTRY.keys()))
        raise KeyError(
            f"Unknown module '{name}'. Available: {available}"
        )

    # Fast path: already cached
    if name in _module_cache:
        return _module_cache[name]

    with _cache_lock:
        # Double-check after lock
        if name in _module_cache:
            return _module_cache[name]

        signature_cls = SIGNATURE_REGISTRY[name]
        module = _CompiledModule(name=name, signature_cls=signature_cls)
        _module_cache[name] = module

        logger.info(
            "Created %s module '%s'",
            "compiled" if _dspy_available else "stub",
            name,
        )
        return module


def list_modules() -> Dict[str, Dict[str, Any]]:
    """Return metadata about all registered modules.

    Returns:
        Dict mapping module name to metadata including availability,
        compilation status, and whether compiled weights exist on disk.
    """
    result: Dict[str, Dict[str, Any]] = {}
    for name in SIGNATURE_REGISTRY:
        weights_path = _COMPILED_CACHE_DIR / f"{name}.json"
        cached_instance = _module_cache.get(name)

        result[name] = {
            "dspy_available": _dspy_available,
            "initialized": cached_instance is not None,
            "has_compiled_weights": weights_path.exists(),
            "weights_path": str(weights_path),
        }
    return result


def clear_module_cache() -> int:
    """Clear the in-memory module cache.

    Useful for testing or after re-optimization.  Does NOT delete
    compiled weights from disk.

    Returns:
        Number of modules evicted from cache.
    """
    with _cache_lock:
        count = len(_module_cache)
        _module_cache.clear()
        logger.info("Cleared module cache (%d modules evicted)", count)
        return count



# ── Originally: claude_adapter.py ──

# mypy: ignore-errors
"""
Custom DSPy Language Model Adapter for Claude Code CLI.

Bridges DSPy's ``dspy.LM`` interface to NeuraReport's existing
``LLMClient`` (which communicates through the Claude Code CLI).

When DSPy is not installed, this module exposes a lightweight
``get_claude_lm()`` function that returns ``None`` and logs a warning.

Architecture:
    DSPy Module
        -> dspy.ChainOfThought
            -> ClaudeCodeLM (this adapter)
                -> LLMClient.complete()
                    -> Claude Code CLI provider
"""

import logging
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger("neura.intelligence.claude_adapter")

# ---------------------------------------------------------------------------
# DSPy availability
# ---------------------------------------------------------------------------
_dspy_available: bool = False
try:
    import dspy

    _dspy_available = True
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------
_adapter_instance: Optional[Any] = None
_adapter_lock = threading.Lock()


# ═══════════════════════════════════════════════════════════════════════════
# Adapter Implementation
# ═══════════════════════════════════════════════════════════════════════════

if _dspy_available:

    class ClaudeCodeLM(dspy.LM):
        """DSPy Language Model adapter wrapping the NeuraReport LLM client.

        This adapter translates DSPy's ``__call__`` protocol into calls
        to ``LLMClient.complete()``, which ultimately routes through the
        Claude Code CLI provider.

        Args:
            model: Model identifier string (default: from LLM config).
            max_tokens: Maximum tokens to generate per call.
            temperature: Sampling temperature.  DSPy typically uses 0.0
                for deterministic chain-of-thought.
            cache_responses: Whether to use the LLMClient's built-in
                response cache.
        """

        def __init__(
            self,
            model: Optional[str] = None,
            max_tokens: int = 4096,
            temperature: float = 0.0,
            cache_responses: bool = True,
            **kwargs: Any,
        ) -> None:
            # Resolve model name from config if not provided
            from backend.app.services.llm import get_llm_config

            config = get_llm_config()
            resolved_model = model or config.model

            # Initialize dspy.LM base class
            super().__init__(
                model=resolved_model,
                max_tokens=max_tokens,
                temperature=temperature,
                **kwargs,
            )

            self._cache_responses = cache_responses
            self._call_count = 0
            self._total_tokens = 0

            logger.info(
                "ClaudeCodeLM adapter initialized — model=%s, "
                "max_tokens=%d, temperature=%.2f",
                resolved_model,
                max_tokens,
                temperature,
            )

        def __call__(
            self,
            prompt: Optional[str] = None,
            messages: Optional[List[Dict[str, str]]] = None,
            **kwargs: Any,
        ) -> List[Dict[str, Any]]:
            """Execute a completion through the NeuraReport LLM client.

            DSPy calls this method with either a prompt string or a
            messages list.  We normalize to the messages format and
            delegate to ``LLMClient.complete()``.

            Args:
                prompt: A single prompt string (legacy DSPy interface).
                messages: A list of message dicts with 'role' and 'content'.
                **kwargs: Additional parameters forwarded to the client.

            Returns:
                A list containing a single dict with the completion text
                under the key ``"text"``, conforming to the DSPy LM
                response protocol.
            """
            from backend.app.services.llm import get_llm_client

            client = get_llm_client()

            # Normalize to messages format
            if messages is None:
                if prompt is not None:
                    messages = [{"role": "user", "content": prompt}]
                else:
                    raise ValueError(
                        "ClaudeCodeLM requires either 'prompt' or "
                        "'messages' to be provided."
                    )

            self._call_count += 1
            call_num = self._call_count

            logger.debug(
                "ClaudeCodeLM call #%d — %d messages, model=%s",
                call_num,
                len(messages),
                self.model,
            )

            try:
                response = client.complete(
                    messages=messages,
                    model=self.model,
                    description=f"dspy-adapter-call-{call_num}",
                    use_cache=self._cache_responses,
                    max_tokens=self.max_tokens,
                    temperature=self.temperature,
                    **kwargs,
                )

                # Extract text from OpenAI-compatible response
                text = ""
                choices = response.get("choices", [])
                if choices:
                    text = (
                        choices[0].get("message", {}).get("content", "")
                    )

                # Track token usage
                usage = response.get("usage", {})
                total = usage.get("total_tokens", 0)
                self._total_tokens += total

                logger.debug(
                    "ClaudeCodeLM call #%d completed — "
                    "%d chars, %d tokens",
                    call_num,
                    len(text),
                    total,
                )

                return [{"text": text}]

            except Exception:
                logger.error(
                    "ClaudeCodeLM call #%d failed",
                    call_num,
                    exc_info=True,
                )
                raise

        @property
        def stats(self) -> Dict[str, Any]:
            """Return usage statistics for this adapter instance."""
            return {
                "model": self.model,
                "call_count": self._call_count,
                "total_tokens": self._total_tokens,
            }

        def __repr__(self) -> str:
            return (
                f"<ClaudeCodeLM model={self.model!r} "
                f"calls={self._call_count}>"
            )


def get_claude_lm(**kwargs: Any) -> Optional[Any]:
    """Get or create the singleton ClaudeCodeLM adapter.

    When DSPy is available, returns a ``ClaudeCodeLM`` instance
    (created once, cached thereafter).  When DSPy is not available,
    returns ``None`` and logs a warning.

    Args:
        **kwargs: Forwarded to ``ClaudeCodeLM.__init__`` on first call.
            Subsequent calls return the cached instance regardless of
            kwargs.

    Returns:
        A ``ClaudeCodeLM`` instance, or ``None`` if DSPy is unavailable.
    """
    global _adapter_instance

    if not _dspy_available:
        logger.warning(
            "get_claude_lm() called but DSPy is not installed — "
            "returning None. Install with: pip install dspy-ai"
        )
        return None

    if _adapter_instance is not None:
        return _adapter_instance

    with _adapter_lock:
        if _adapter_instance is not None:
            return _adapter_instance

        _adapter_instance = ClaudeCodeLM(**kwargs)
        logger.info(
            "Created singleton ClaudeCodeLM adapter: %r",
            _adapter_instance,
        )
        return _adapter_instance


def configure_dspy_with_claude(**kwargs: Any) -> bool:
    """Configure DSPy globally to use the Claude Code LM adapter.

    This is a convenience function that calls ``dspy.configure(lm=...)``
    with our adapter.  Should be called once at application startup
    before any DSPy modules are invoked.

    Args:
        **kwargs: Forwarded to ``get_claude_lm()``.

    Returns:
        True if DSPy was configured successfully, False otherwise.
    """
    lm = get_claude_lm(**kwargs)
    if lm is None:
        logger.warning("Cannot configure DSPy — adapter unavailable")
        return False

    try:
        dspy.configure(lm=lm)
        logger.info("DSPy globally configured with ClaudeCodeLM adapter")
        return True
    except Exception:
        logger.error(
            "Failed to configure DSPy with ClaudeCodeLM",
            exc_info=True,
        )
        return False



# ── Originally: optimizer.py ──

# mypy: ignore-errors
"""
BootstrapFewShot Optimization Runner for NeuraReport Intelligence Modules.

Uses DSPy's ``BootstrapFewShot`` teleprompter to compile modules with
automatically generated few-shot demonstrations drawn from training
data (e.g. mapping corrections approved by users).

The optimization loop:
    1. Load training examples from the corrections store
    2. Convert them into ``dspy.Example`` objects
    3. Run ``BootstrapFewShot`` with a metric function
    4. Save compiled weights to ``compiled_cache/``
    5. Hot-swap the cached module instance

When DSPy is not available, ``run_optimization()`` returns a result
indicating that optimization was skipped.
"""

import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("neura.intelligence.optimizer")

# ---------------------------------------------------------------------------
# DSPy availability
# ---------------------------------------------------------------------------
_dspy_available: bool = False
try:
    import dspy

    _dspy_available = True
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_MODULE_DIR = Path(__file__).resolve().parent
_COMPILED_CACHE_DIR = _MODULE_DIR / "compiled_cache"
_COMPILED_CACHE_DIR.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# Result Container
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class OptimizationResult:
    """Outcome of an optimization run.

    Attributes:
        module_name: The name of the module that was optimized.
        success: Whether optimization completed without error.
        skipped: True if optimization was not attempted (e.g. DSPy
            unavailable or insufficient training data).
        skip_reason: Human-readable reason when ``skipped`` is True.
        num_train_examples: Number of training examples used.
        num_bootstrapped: Number of few-shot demos bootstrapped.
        metric_before: Average metric score before optimization (if
            evaluated).
        metric_after: Average metric score after optimization.
        duration_seconds: Wall-clock time of the optimization run.
        weights_path: Path to saved compiled weights, or None.
        error: Error message if ``success`` is False.
    """

    module_name: str
    success: bool = False
    skipped: bool = False
    skip_reason: str = ""
    num_train_examples: int = 0
    num_bootstrapped: int = 0
    metric_before: Optional[float] = None
    metric_after: Optional[float] = None
    duration_seconds: float = 0.0
    weights_path: Optional[str] = None
    error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a JSON-friendly dictionary."""
        return {
            "module_name": self.module_name,
            "success": self.success,
            "skipped": self.skipped,
            "skip_reason": self.skip_reason,
            "num_train_examples": self.num_train_examples,
            "num_bootstrapped": self.num_bootstrapped,
            "metric_before": self.metric_before,
            "metric_after": self.metric_after,
            "duration_seconds": round(self.duration_seconds, 3),
            "weights_path": self.weights_path,
            "error": self.error,
        }


# ═══════════════════════════════════════════════════════════════════════════
# Training Data Conversion
# ═══════════════════════════════════════════════════════════════════════════


def _corrections_to_examples(
    corrections: List[Dict[str, Any]],
    module_name: str,
) -> list:
    """Convert mapping correction records into DSPy Example objects.

    Each correction record is expected to have an ``inputs`` dict and
    an ``outputs`` dict whose keys correspond to the signature's
    input/output fields respectively.

    Args:
        corrections: List of correction dicts.  Each must have:
            - ``inputs``: dict mapping input field names to values
            - ``outputs``: dict mapping output field names to expected values
        module_name: Name of the target module (for logging).

    Returns:
        A list of ``dspy.Example`` objects if DSPy is available,
        otherwise a list of plain dicts.
    """
    examples = []
    skipped = 0

    for i, correction in enumerate(corrections):
        inputs = correction.get("inputs")
        outputs = correction.get("outputs")

        if not inputs or not outputs:
            skipped += 1
            continue

        if _dspy_available:
            # Merge inputs and outputs into a single Example, marking
            # which keys are inputs so DSPy can distinguish them
            combined = {**inputs, **outputs}
            example = dspy.Example(**combined).with_inputs(*inputs.keys())
            examples.append(example)
        else:
            examples.append({"inputs": inputs, "outputs": outputs})

    if skipped:
        logger.warning(
            "Skipped %d/%d corrections for '%s' (missing inputs/outputs)",
            skipped,
            len(corrections),
            module_name,
        )

    logger.info(
        "Converted %d corrections into training examples for '%s'",
        len(examples),
        module_name,
    )
    return examples


# ═══════════════════════════════════════════════════════════════════════════
# Default Metric Functions
# ═══════════════════════════════════════════════════════════════════════════

def _exact_match_metric(example: Any, prediction: Any, trace: Any = None) -> float:
    """Simple exact-match metric for optimization.

    Compares each output field in the example to the corresponding
    field in the prediction.  Returns 1.0 if all match, 0.0 otherwise.
    """
    if not _dspy_available:
        return 0.0

    # Get output keys (those NOT in the input set)
    input_keys = set(example.inputs().keys()) if hasattr(example, "inputs") else set()
    all_keys = set(example.keys()) if hasattr(example, "keys") else set()
    output_keys = all_keys - input_keys

    if not output_keys:
        return 1.0  # No outputs to compare

    matches = 0
    for key in output_keys:
        expected = getattr(example, key, None)
        predicted = getattr(prediction, key, None)

        if expected is not None and predicted is not None:
            # Normalize whitespace for comparison
            exp_str = str(expected).strip()
            pred_str = str(predicted).strip()
            if exp_str == pred_str:
                matches += 1
            else:
                # Try JSON-level comparison for structured outputs
                try:
                    if json.loads(exp_str) == json.loads(pred_str):
                        matches += 1
                except (json.JSONDecodeError, TypeError):
                    pass

    return matches / len(output_keys) if output_keys else 1.0


def _fuzzy_match_metric(example: Any, prediction: Any, trace: Any = None) -> float:
    """Fuzzy matching metric that rewards partial correctness.

    For JSON array outputs, computes set overlap.  For plain text,
    falls back to token-level Jaccard similarity.
    """
    if not _dspy_available:
        return 0.0

    input_keys = set(example.inputs().keys()) if hasattr(example, "inputs") else set()
    all_keys = set(example.keys()) if hasattr(example, "keys") else set()
    output_keys = all_keys - input_keys

    if not output_keys:
        return 1.0

    scores: List[float] = []

    for key in output_keys:
        expected = str(getattr(example, key, "")).strip()
        predicted = str(getattr(prediction, key, "")).strip()

        if not expected:
            scores.append(1.0 if not predicted else 0.0)
            continue

        # Try JSON array overlap
        try:
            exp_items = json.loads(expected)
            pred_items = json.loads(predicted)

            if isinstance(exp_items, list) and isinstance(pred_items, list):
                exp_set = {json.dumps(x, sort_keys=True) for x in exp_items}
                pred_set = {json.dumps(x, sort_keys=True) for x in pred_items}

                if exp_set:
                    intersection = exp_set & pred_set
                    union = exp_set | pred_set
                    scores.append(len(intersection) / len(union) if union else 1.0)
                    continue
        except (json.JSONDecodeError, TypeError):
            pass

        # Token-level Jaccard
        exp_tokens = set(expected.lower().split())
        pred_tokens = set(predicted.lower().split())
        if exp_tokens:
            intersection = exp_tokens & pred_tokens
            union = exp_tokens | pred_tokens
            scores.append(len(intersection) / len(union) if union else 0.0)
        else:
            scores.append(1.0 if not pred_tokens else 0.0)

    return sum(scores) / len(scores) if scores else 1.0


# Registry of built-in metric functions
METRIC_REGISTRY: Dict[str, Callable] = {
    "exact_match": _exact_match_metric,
    "fuzzy_match": _fuzzy_match_metric,
}


# ═══════════════════════════════════════════════════════════════════════════
# Main Optimization Entry Point
# ═══════════════════════════════════════════════════════════════════════════


def run_optimization(
    module_name: str,
    corrections: List[Dict[str, Any]],
    *,
    metric: str | Callable = "fuzzy_match",
    max_bootstrapped_demos: int = 4,
    max_labeled_demos: int = 8,
    min_examples: int = 3,
    num_threads: int = 1,
    teacher_settings: Optional[Dict[str, Any]] = None,
    hot_swap: bool = True,
) -> OptimizationResult:
    """Run BootstrapFewShot optimization for a named module.

    This is the primary entry point for improving a module's performance
    using human-corrected examples.

    Args:
        module_name: Registry name of the module to optimize
            (e.g. ``"field_to_column_mapping"``).
        corrections: Training data — list of dicts, each with ``inputs``
            and ``outputs`` sub-dicts matching the signature's fields.
        metric: Metric function name (from METRIC_REGISTRY) or a custom
            callable ``(example, prediction, trace) -> float``.
        max_bootstrapped_demos: Max few-shot demos to bootstrap.
        max_labeled_demos: Max labeled demos to include directly.
        min_examples: Minimum corrections required to attempt
            optimization.  Below this threshold, optimization is skipped.
        num_threads: Number of threads for parallel bootstrapping.
        teacher_settings: Optional dict of settings for the teacher LM
            (e.g. ``{"temperature": 0.7}``).
        hot_swap: If True, replace the cached module instance after
            successful optimization.

    Returns:
        An ``OptimizationResult`` describing the outcome.
    """
    start_time = time.time()

    # -- Pre-flight checks ---------------------------------------------------

    if not _dspy_available:
        return OptimizationResult(
            module_name=module_name,
            skipped=True,
            skip_reason=(
                "DSPy is not installed. Install with: pip install dspy-ai"
            ),
            duration_seconds=time.time() - start_time,
        )

    # (same-file) SIGNATURE_REGISTRY — defined above

    if module_name not in SIGNATURE_REGISTRY:
        available = ", ".join(sorted(SIGNATURE_REGISTRY.keys()))
        return OptimizationResult(
            module_name=module_name,
            success=False,
            error=f"Unknown module '{module_name}'. Available: {available}",
            duration_seconds=time.time() - start_time,
        )

    if len(corrections) < min_examples:
        return OptimizationResult(
            module_name=module_name,
            skipped=True,
            skip_reason=(
                f"Insufficient training data: {len(corrections)} examples "
                f"provided, minimum {min_examples} required."
            ),
            num_train_examples=len(corrections),
            duration_seconds=time.time() - start_time,
        )

    # -- Resolve metric function ---------------------------------------------

    if isinstance(metric, str):
        metric_fn = METRIC_REGISTRY.get(metric)
        if metric_fn is None:
            available_metrics = ", ".join(sorted(METRIC_REGISTRY.keys()))
            return OptimizationResult(
                module_name=module_name,
                success=False,
                error=(
                    f"Unknown metric '{metric}'. "
                    f"Available: {available_metrics}"
                ),
                duration_seconds=time.time() - start_time,
            )
    else:
        metric_fn = metric

    # -- Convert corrections to DSPy examples --------------------------------

    examples = _corrections_to_examples(corrections, module_name)
    if not examples:
        return OptimizationResult(
            module_name=module_name,
            skipped=True,
            skip_reason="No valid training examples after conversion.",
            num_train_examples=0,
            duration_seconds=time.time() - start_time,
        )

    # -- Ensure DSPy is configured with our adapter --------------------------

    # (same-file) configure_dspy_with_claude — defined above

    if not configure_dspy_with_claude(**(teacher_settings or {})):
        return OptimizationResult(
            module_name=module_name,
            success=False,
            error="Failed to configure DSPy with Claude adapter.",
            duration_seconds=time.time() - start_time,
        )

    # -- Build the base module -----------------------------------------------

    signature_cls = SIGNATURE_REGISTRY[module_name]
    base_module = dspy.ChainOfThought(signature_cls)

    # -- Run BootstrapFewShot optimization -----------------------------------

    logger.info(
        "Starting BootstrapFewShot optimization for '%s' with %d examples "
        "(max_bootstrapped=%d, max_labeled=%d)",
        module_name,
        len(examples),
        max_bootstrapped_demos,
        max_labeled_demos,
    )

    try:
        optimizer = dspy.BootstrapFewShot(
            metric=metric_fn,
            max_bootstrapped_demos=max_bootstrapped_demos,
            max_labeled_demos=max_labeled_demos,
            num_threads=num_threads,
        )

        compiled_module = optimizer.compile(
            base_module,
            trainset=examples,
        )

        # Count bootstrapped demos
        num_bootstrapped = 0
        if hasattr(compiled_module, "demos"):
            num_bootstrapped = len(compiled_module.demos)

        # -- Save compiled weights -------------------------------------------

        weights_path = _COMPILED_CACHE_DIR / f"{module_name}.json"
        compiled_module.save(str(weights_path))
        logger.info(
            "Saved optimized weights for '%s' to %s",
            module_name,
            weights_path,
        )

        # -- Evaluate metric after optimization (on training set) ------------

        metric_scores: List[float] = []
        for ex in examples[:10]:  # Evaluate on up to 10 examples
            try:
                input_kwargs = {
                    k: getattr(ex, k)
                    for k in ex.inputs().keys()
                }
                pred = compiled_module(**input_kwargs)
                score = metric_fn(ex, pred)
                metric_scores.append(score)
            except Exception:
                logger.debug(
                    "Metric evaluation failed for an example",
                    exc_info=True,
                )

        metric_after = (
            sum(metric_scores) / len(metric_scores)
            if metric_scores
            else None
        )

        # -- Hot-swap the cached module instance -----------------------------

        if hot_swap:
            # (same-file) _module_cache, _cache_lock — defined above

            with _cache_lock:
                # Evict old instance so next get_module() loads new weights
                _module_cache.pop(module_name, None)
            logger.info(
                "Hot-swapped cached module '%s' — next call will "
                "load optimized weights",
                module_name,
            )

        duration = time.time() - start_time

        result = OptimizationResult(
            module_name=module_name,
            success=True,
            num_train_examples=len(examples),
            num_bootstrapped=num_bootstrapped,
            metric_after=metric_after,
            duration_seconds=duration,
            weights_path=str(weights_path),
        )

        logger.info(
            "Optimization complete for '%s': %d examples, "
            "%d bootstrapped demos, metric=%.3f, %.1fs",
            module_name,
            len(examples),
            num_bootstrapped,
            metric_after or 0.0,
            duration,
        )

        return result

    except Exception as exc:
        duration = time.time() - start_time
        logger.error(
            "Optimization failed for '%s' after %.1fs",
            module_name,
            duration,
            exc_info=True,
        )
        return OptimizationResult(
            module_name=module_name,
            success=False,
            num_train_examples=len(examples),
            duration_seconds=duration,
            error=str(exc),
        )


def run_optimization_batch(
    corrections_by_module: Dict[str, List[Dict[str, Any]]],
    **kwargs: Any,
) -> Dict[str, OptimizationResult]:
    """Run optimization for multiple modules in sequence.

    Convenience wrapper around ``run_optimization()`` for batch jobs.

    Args:
        corrections_by_module: Dict mapping module names to their
            respective correction lists.
        **kwargs: Additional keyword arguments forwarded to each
            ``run_optimization()`` call.

    Returns:
        Dict mapping module names to their ``OptimizationResult``.
    """
    results: Dict[str, OptimizationResult] = {}

    for module_name, corrections in corrections_by_module.items():
        logger.info(
            "Batch optimization: processing '%s' (%d corrections)",
            module_name,
            len(corrections),
        )
        results[module_name] = run_optimization(
            module_name=module_name,
            corrections=corrections,
            **kwargs,
        )

    # Summary log
    success_count = sum(1 for r in results.values() if r.success)
    skip_count = sum(1 for r in results.values() if r.skipped)
    fail_count = sum(1 for r in results.values() if not r.success and not r.skipped)

    logger.info(
        "Batch optimization complete: %d succeeded, %d skipped, %d failed",
        success_count,
        skip_count,
        fail_count,
    )

    return results
