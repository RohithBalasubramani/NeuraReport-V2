from __future__ import annotations

"""Merged agents module: service + all_agents + agent_service."""


# Section: service

"""Agents service — registry, base agent, legacy service, orchestration."""


# AGENT_REGISTRY

"""
Agent Registry: Dynamic agent registration and discovery.

Replaces hardcoded agent dicts with decorator-based registration.
Based on: Temporal workflow/activity patterns + plugin architecture.
"""
import importlib
import logging
import pkgutil
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from backend.app.common import utc_now, utc_now_iso

logger = logging.getLogger("neura.agents.registry")


@dataclass
class AgentDescriptor:
    """Metadata about a registered agent."""
    name: str
    agent_class: type
    version: str = "1.0"
    description: str = ""
    capabilities: list[str] = field(default_factory=list)
    max_concurrent: int = 5
    timeout_seconds: int = 120
    _instance: Optional[Any] = field(default=None, repr=False)

    def get_instance(self):
        if self._instance is None:
            self._instance = self.agent_class()
        return self._instance


class AgentRegistry:
    """Central registry for all agent types with auto-discovery."""

    def __init__(self):
        self._agents: Dict[str, AgentDescriptor] = {}
        self._lock = threading.RLock()

    def register(self, name: str, agent_class: type, version: str = "1.0",
                 description: str = "", capabilities: Optional[List[str]] = None,
                 max_concurrent: int = 5, timeout_seconds: int = 120) -> None:
        with self._lock:
            self._agents[name] = AgentDescriptor(
                name=name, agent_class=agent_class, version=version,
                description=description or agent_class.__doc__ or "",
                capabilities=capabilities or [], max_concurrent=max_concurrent,
                timeout_seconds=timeout_seconds,
            )
            logger.info(f"Registered agent: {name} v{version}")

    def get(self, name: str):
        with self._lock:
            descriptor = self._agents.get(name)
        return descriptor.get_instance() if descriptor else None

    def get_descriptor(self, name: str) -> Optional[AgentDescriptor]:
        with self._lock:
            return self._agents.get(name)

    def find_by_capability(self, capability: str) -> List[AgentDescriptor]:
        with self._lock:
            return [d for d in self._agents.values() if capability in d.capabilities]

    def list_agents(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {"name": d.name, "version": d.version, "description": d.description,
                 "capabilities": d.capabilities, "timeout_seconds": d.timeout_seconds}
                for d in sorted(self._agents.values(), key=lambda d: d.name)
            ]

    def auto_discover(self, package_path: str = "backend.app.services.agents") -> int:
        before = len(self._agents)
        try:
            package = importlib.import_module(package_path)
            pkg_dir = getattr(package, "__path__", None)
            if pkg_dir:
                for _, modname, _ in pkgutil.iter_modules(pkg_dir):
                    if not modname.startswith("_"):
                        try:
                            importlib.import_module(f"{package_path}.{modname}")
                        except Exception as exc:
                            logger.warning(f"Failed to import agent module {modname}: {exc}")
        except Exception as exc:
            logger.error(f"Agent auto-discovery failed: {exc}")
        return len(self._agents) - before


_registry: Optional[AgentRegistry] = None
_registry_lock = threading.Lock()


def get_agent_registry() -> AgentRegistry:
    global _registry
    if _registry is None:
        with _registry_lock:
            if _registry is None:
                _registry = AgentRegistry()
    return _registry


def register_agent(name: str, *, version: str = "1.0", capabilities: Optional[List[str]] = None,
                   max_concurrent: int = 5, timeout_seconds: int = 120):
    """Decorator to register an agent class."""
    def decorator(cls):
        get_agent_registry().register(
            name=name, agent_class=cls, version=version,
            capabilities=capabilities, max_concurrent=max_concurrent,
            timeout_seconds=timeout_seconds,
        )
        return cls
    return decorator


# BASE_AGENT

"""
Base Agent V2 - Shared infrastructure for all production-grade agents.

Provides:
- Lazy-loaded OpenAI client with model-aware parameter handling
- Robust JSON parsing from LLM responses (handles code blocks, partial JSON)
- Token counting and cost estimation
- Timeout handling with proper error categorization
- Progress callback infrastructure

All production agents extend this base class.
"""

import asyncio
import json
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("neura.agents.base")


# Error types (re-exported from research_agent for backward compat)
class AgentError(Exception):
    """Base class for agent errors."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        retryable: bool = True,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        super().__init__(message)


class ValidationError(AgentError):
    """Input validation error."""

    def __init__(self, message: str, field: Optional[str] = None):
        super().__init__(
            message,
            code="VALIDATION_ERROR",
            retryable=False,
            details={"field": field} if field else {},
        )


class LLMTimeoutError(AgentError):
    """LLM request timed out."""

    def __init__(self, timeout_seconds: int):
        super().__init__(
            f"LLM request timed out after {timeout_seconds} seconds",
            code="LLM_TIMEOUT",
            retryable=True,
            details={"timeout_seconds": timeout_seconds},
        )


class LLMRateLimitError(AgentError):
    """LLM rate limit exceeded."""

    def __init__(self, retry_after: Optional[int] = None):
        super().__init__(
            "LLM rate limit exceeded",
            code="LLM_RATE_LIMITED",
            retryable=True,
            details={"retry_after": retry_after},
        )


class LLMResponseError(AgentError):
    """LLM returned invalid response."""

    def __init__(self, message: str):
        super().__init__(
            message,
            code="LLM_RESPONSE_ERROR",
            retryable=True,
        )


class LLMContentFilterError(AgentError):
    """LLM content was filtered."""

    def __init__(self, reason: str):
        super().__init__(
            f"Content was filtered: {reason}",
            code="LLM_CONTENT_FILTERED",
            retryable=False,
            details={"reason": reason},
        )


# Progress callback
@dataclass
class ProgressUpdate:
    """Progress update for long-running operations."""
    percent: int
    message: str
    current_step: str
    total_steps: int
    current_step_num: int


ProgressCallback = Callable[[ProgressUpdate], None]


@dataclass
class PipelineStepResult:
    """Result of running a single pipeline step."""
    step_name: str
    success: bool
    result: Any = None
    error_type: str = ""
    error_message: str = ""
    error_code: str = ""
    retryable: bool = True
    elapsed_ms: float = 0.0
    attempt: int = 1
    repair_actions: list = field(default_factory=list)


# Error type → (code, retryable_by_default)
_PIPELINE_ERROR_MAP = {
    "ContractBuilderError": ("CONTRACT_BUILD", True),
    "SchemaValidationError": ("SCHEMA_VALIDATION", True),
    "MappingInlineValidationError": ("MAPPING_VALIDATION", True),
    "PipelineRepairExhausted": ("REPAIR_EXHAUSTED", False),
    "PipelineGateError": ("GATE_FAILED", True),
    "NameError": ("MISSING_VARIABLE", False),
    "FileNotFoundError": ("FILE_NOT_FOUND", False),
    "KeyError": ("KEY_ERROR", True),
    "TypeError": ("TYPE_ERROR", False),
    "ValueError": ("VALUE_ERROR", True),
    "HTTPException": ("HTTP_ERROR", False),
}


# Base Agent
class BaseAgentV2(ABC):
    """
    Abstract base for all production-grade V2 agents.

    Subclasses implement execute() and define their input/output models.
    The base class provides shared LLM calling, JSON parsing, error
    categorization, and cost tracking infrastructure.

    Supports all LLM providers: OpenAI-compatible (LiteLLM, vLLM), etc.
    """

    # Token cost estimates (per 1K tokens) — overridable per agent
    INPUT_COST_PER_1K: float = 0.003
    OUTPUT_COST_PER_1K: float = 0.015

    # Timeout settings
    DEFAULT_TIMEOUT_SECONDS: int = 120
    MAX_TIMEOUT_SECONDS: int = 300

    def __init__(self):
        self._llm_client = None
        self._model: Optional[str] = None

    def _get_llm_client(self):
        """Get unified LLM client lazily."""
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    def _get_model(self) -> str:
        """Get model name from LLM config."""
        if self._model is None:
            from backend.app.services.llm import get_llm_config
            self._model = get_llm_config().model
        return self._model

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        timeout_seconds: Optional[int] = None,
        temperature: float = 0.7,
        parse_json: bool = True,
    ) -> Dict[str, Any]:
        """Make an LLM call with proper error handling and token tracking.

        Uses the unified LLM client which supports all providers:
        OpenAI-compatible (LiteLLM, vLLM), etc.

        Args:
            system_prompt: System prompt for the LLM.
            user_prompt: User prompt for the LLM.
            max_tokens: Maximum tokens in the response.
            timeout_seconds: Timeout for the LLM call.
            temperature: Sampling temperature.
            parse_json: If True (default), parse response as JSON.
                If False, skip JSON parsing and set parsed={}.

        Returns:
            Dict with keys: raw, parsed, input_tokens, output_tokens.

        Raises:
            LLMTimeoutError: If the call times out.
            LLMRateLimitError: If rate limited.
            LLMContentFilterError: If content was filtered.
            LLMResponseError: If response can't be parsed (only when parse_json=True).
            AgentError: For other LLM errors.
        """
        timeout = timeout_seconds or self.DEFAULT_TIMEOUT_SECONDS
        client = self._get_llm_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            loop = asyncio.get_running_loop()
            response = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: client.complete(
                        messages=messages,
                        description="agent_call_v2",
                        max_tokens=max_tokens,
                        temperature=temperature,
                    ),
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout)
        except Exception as exc:
            self._categorize_and_raise(exc, timeout)

        # Extract content from OpenAI-compatible response
        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        ) or ""

        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        # Parse JSON from response (skip for agents that expect raw text)
        parsed = self._parse_json_response(content) if parse_json else {}

        return {
            "raw": content,
            "parsed": parsed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    async def _call_ocr(
        self,
        image_bytes_or_path,
    ) -> Optional[str]:
        """Extract text from an image using GLM-OCR (not the LLM agent).

        Accepts bytes or a file path (str/Path). Returns extracted text
        or None on failure — never raises.
        """
        try:
            loop = asyncio.get_running_loop()
            from pathlib import Path as _Path

            if isinstance(image_bytes_or_path, (str, _Path)):
                from backend.app.services.infra_services import ocr_extract_from_file
                return await loop.run_in_executor(
                    None, ocr_extract_from_file, _Path(image_bytes_or_path)
                )
            else:
                from backend.app.services.infra_services import ocr_extract
                return await loop.run_in_executor(
                    None, ocr_extract, image_bytes_or_path
                )
        except Exception:
            logger.debug("agent_ocr_call_failed", exc_info=True)
            return None

    async def _call_llm_messages(
        self,
        messages: List[Dict[str, Any]],
        max_tokens: int,
        timeout_seconds: Optional[int] = None,
        temperature: float = 0.7,
        parse_json: bool = True,
    ) -> Dict[str, Any]:
        """LLM call with full message control (multi-part content, images, etc.).

        Like _call_llm() but accepts raw messages instead of just
        system_prompt + user_prompt. Gives agents flexibility to construct
        complex prompts with OCR results, multiple contexts, etc.
        """
        timeout = timeout_seconds or self.DEFAULT_TIMEOUT_SECONDS
        client = self._get_llm_client()

        try:
            loop = asyncio.get_running_loop()
            response = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: client.complete(
                        messages=messages,
                        description="agent_call_v2_messages",
                        max_tokens=max_tokens,
                        temperature=temperature,
                    ),
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout)
        except Exception as exc:
            self._categorize_and_raise(exc, timeout)

        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        ) or ""

        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        parsed = self._parse_json_response(content) if parse_json else {}

        return {
            "raw": content,
            "parsed": parsed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    def _categorize_and_raise(self, exc: Exception, timeout: int) -> None:
        """Categorize an exception and raise the appropriate AgentError."""
        error_str = str(exc).lower()

        if "rate limit" in error_str or "rate_limit" in error_str:
            raise LLMRateLimitError()
        elif "timeout" in error_str:
            raise LLMTimeoutError(timeout)
        elif "content filter" in error_str or "content_filter" in error_str:
            raise LLMContentFilterError(str(exc))
        else:
            raise AgentError(
                str(exc),
                code="LLM_ERROR",
                retryable=True,
            )

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from LLM response, handling markdown code blocks.

        This method handles common LLM output patterns:
        - Raw JSON
        - JSON wrapped in ```json ... ``` code blocks
        - JSON embedded in natural language text
        - Partial/truncated JSON (returns empty dict)

        Raises:
            LLMResponseError: If no valid JSON can be extracted.
        """
        if not content or not content.strip():
            return {}

        cleaned = content.strip()

        # Handle ```json ... ``` blocks
        json_block_match = re.search(
            r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL
        )
        if json_block_match:
            cleaned = json_block_match.group(1).strip()
        elif cleaned.startswith("```"):
            parts = cleaned.split("```", 2)
            if len(parts) >= 2:
                cleaned = parts[1].strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Try to find JSON object or array in the content
        for pattern in [r"\{.*\}", r"\[.*\]"]:
            match = re.search(pattern, cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    continue

        logger.warning(f"Failed to parse JSON from LLM output: {content[:200]}...")
        raise LLMResponseError("Failed to parse JSON from LLM response")

    def _estimate_cost_cents(
        self, input_tokens: int, output_tokens: int
    ) -> int:
        """Estimate cost in cents from token counts."""
        return int(
            (input_tokens / 1000 * self.INPUT_COST_PER_1K * 100)
            + (output_tokens / 1000 * self.OUTPUT_COST_PER_1K * 100)
        )

    async def _run_pipeline_step(
        self,
        step_name: str,
        fn: Callable,
        *args,
        max_retries: int = 3,
        on_error: Optional[Callable] = None,
        **kwargs,
    ) -> PipelineStepResult:
        """Run a pipeline function with retry logic and error classification.

        Wraps sync pipeline functions in run_in_executor(). On failure,
        classifies the error and optionally calls `on_error(step_result)`
        which can return modified args/kwargs for a retry attempt.

        Args:
            step_name: Human-readable step identifier.
            fn: The pipeline function to call (sync or async).
            *args: Positional args for fn.
            max_retries: Maximum retry attempts (includes first try).
            on_error: Async callback(PipelineStepResult) → Optional[tuple[args, kwargs]].
                      Returns new (args, kwargs) for retry, or None to stop.
            **kwargs: Keyword args for fn.
        """
        attempt = 0
        repair_actions = []

        while attempt < max_retries:
            attempt += 1
            t0 = time.time()
            try:
                loop = asyncio.get_running_loop()
                if asyncio.iscoroutinefunction(fn):
                    result = await fn(*args, **kwargs)
                else:
                    result = await loop.run_in_executor(
                        None, lambda: fn(*args, **kwargs)
                    )
                elapsed = (time.time() - t0) * 1000
                return PipelineStepResult(
                    step_name=step_name,
                    success=True,
                    result=result,
                    elapsed_ms=round(elapsed, 1),
                    attempt=attempt,
                    repair_actions=repair_actions,
                )
            except Exception as exc:
                elapsed = (time.time() - t0) * 1000
                exc_type = type(exc).__name__
                code, retryable = _PIPELINE_ERROR_MAP.get(
                    exc_type, ("UNKNOWN", True)
                )
                step_result = PipelineStepResult(
                    step_name=step_name,
                    success=False,
                    error_type=exc_type,
                    error_message=str(exc)[:2000],
                    error_code=code,
                    retryable=retryable,
                    elapsed_ms=round(elapsed, 1),
                    attempt=attempt,
                    repair_actions=repair_actions,
                )
                logger.warning(
                    "pipeline_step_failed",
                    extra={
                        "step": step_name,
                        "error_type": exc_type,
                        "error_code": code,
                        "attempt": attempt,
                        "retryable": retryable,
                    },
                )

                if not retryable or attempt >= max_retries or on_error is None:
                    return step_result

                # Ask the agent to diagnose and fix
                try:
                    fix = await on_error(step_result)
                    if fix is None:
                        return step_result
                    # fix should be a dict of updated kwargs
                    if isinstance(fix, dict):
                        kwargs.update(fix)
                        repair_actions.append(
                            f"attempt {attempt}: applied fix for {code}"
                        )
                    elif isinstance(fix, tuple) and len(fix) == 2:
                        args, kwargs = fix[0], fix[1]
                        repair_actions.append(
                            f"attempt {attempt}: applied fix for {code}"
                        )
                except Exception:
                    logger.debug("pipeline_on_error_failed", exc_info=True)
                    return step_result

        # Should not reach here, but safety net
        return PipelineStepResult(
            step_name=step_name,
            success=False,
            error_message="Max retries exhausted",
            error_code="MAX_RETRIES",
            retryable=False,
            attempt=attempt,
            repair_actions=repair_actions,
        )

    async def _self_check(
        self,
        step_name: str,
        intermediate_result: Any,
        elapsed_ms: int,
        budget_remaining_tokens: int = 0,
    ) -> Dict[str, Any]:
        """Agent evaluates its own progress and adjusts strategy mid-execution.

        Called between pipeline steps in an agent's execute() method.
        Returns {"continue": bool, "adjustment": str|None, "confidence": float}.
        Always returns a result — never raises.
        """
        default = {"continue": True, "adjustment": None, "confidence": 1.0}
        try:
            client = self._get_llm_client()

            result_preview = str(intermediate_result)[:2000]
            prompt = (
                f"You're executing step '{step_name}' in an agent pipeline "
                f"and produced this intermediate result:\n"
                f"{result_preview}\n\n"
                f"Elapsed: {elapsed_ms}ms"
                f"{f', Budget remaining: ~{budget_remaining_tokens} tokens' if budget_remaining_tokens else ''}\n\n"
                "Assess: Is this result on track? Should execution continue, "
                "adjust approach, or flag for human review?\n"
                'Return ONLY JSON: {"continue": true/false, '
                '"adjustment": "suggestion" or null, "confidence": 0.0-1.0}'
            )

            loop = __import__("asyncio").get_running_loop()
            response = await __import__("asyncio").wait_for(
                loop.run_in_executor(
                    None,
                    lambda: client.complete(
                        messages=[{"role": "user", "content": prompt}],
                        description="agent_self_check",
                        max_tokens=256,
                    ),
                ),
                timeout=15,  # Quick check, hard timeout
            )

            content = (
                response.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            ) or ""
            parsed = json.loads(content.strip())

            result = {
                "continue": bool(parsed.get("continue", True)),
                "adjustment": parsed.get("adjustment"),
                "confidence": float(parsed.get("confidence", 1.0)),
            }

            if not result["continue"] or result["adjustment"]:
                logger.info(
                    "agent_self_check_adjustment",
                    extra={
                        "step": step_name,
                        "continue": result["continue"],
                        "adjustment": str(result["adjustment"])[:200],
                        "confidence": result["confidence"],
                    },
                )

            return result
        except Exception:
            logger.debug("agent_self_check_failed", exc_info=True)
            return default

    @abstractmethod
    async def execute(
        self,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
        **kwargs: Any,
    ) -> tuple[Any, Dict[str, Any]]:
        """Execute the agent.

        All agents return a tuple of (result_model, metadata_dict).
        The metadata dict must contain: tokens_input, tokens_output,
        estimated_cost_cents.
        """
        ...


# LEGACY_SERVICE

"""
AI Agents Service
Specialized AI agents for research, analysis, email drafting, and more.
"""

import hashlib
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AgentType(str, Enum):
    """Types of AI agents."""
    RESEARCH = "research"
    DATA_ANALYST = "data_analyst"
    EMAIL_DRAFT = "email_draft"
    CONTENT_REPURPOSE = "content_repurpose"
    PROOFREADING = "proofreading"


class AgentStatus(str, Enum):
    """Agent execution status."""
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"




class AgentTask(BaseModel):
    """Task assigned to an agent."""
    task_id: str
    agent_type: AgentType
    input: Dict[str, Any]
    status: AgentStatus = AgentStatus.IDLE
    progress: float = 0
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=utc_now)
    completed_at: Optional[datetime] = None


class LegacyResearchReport(BaseModel):
    """Result from legacy research agent."""
    topic: str
    summary: str
    sections: List[Dict[str, str]] = Field(default_factory=list)
    sources: List[Dict[str, Any]] = Field(default_factory=list)
    key_findings: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    word_count: int = 0


class DataAnalysisResult(BaseModel):
    """Result from data analyst agent."""
    query: str
    answer: str
    data_summary: Dict[str, Any] = Field(default_factory=dict)
    insights: List[str] = Field(default_factory=list)
    charts: List[Dict[str, Any]] = Field(default_factory=list)
    sql_queries: List[str] = Field(default_factory=list)
    confidence: float = 0


class EmailDraft(BaseModel):
    """Result from email draft agent."""
    subject: str
    body: str
    tone: str
    suggested_recipients: List[str] = Field(default_factory=list)
    attachments_suggested: List[str] = Field(default_factory=list)
    follow_up_actions: List[str] = Field(default_factory=list)


class RepurposedContent(BaseModel):
    """Result from content repurposing agent."""
    original_format: str
    outputs: List[Dict[str, Any]] = Field(default_factory=list)  # {format, content, metadata}
    adaptations_made: List[str] = Field(default_factory=list)


class ProofreadingResult(BaseModel):
    """Result from proofreading agent."""
    original_text: str
    corrected_text: str
    issues_found: List[Dict[str, Any]] = Field(default_factory=list)
    style_suggestions: List[str] = Field(default_factory=list)
    readability_score: float = 0
    word_count: int = 0
    reading_level: str = ""


class BaseAgent(ABC):
    """Base class for AI agents."""

    def __init__(self):
        self._llm_client = None

    # Backwards compatibility alias
    @property
    def _client(self):
        """Backwards compatibility alias for _llm_client."""
        return self._llm_client

    @_client.setter
    def _client(self, value):
        """Backwards compatibility setter for _llm_client."""
        self._llm_client = value

    def _get_client(self):
        """Backwards compatibility alias for _get_llm_client."""
        return self._get_llm_client()

    def _get_llm_client(self):
        """Get OpenAI client (legacy service expectation).

        Note: This is the legacy in-memory agent service used by a subset of
        API/tests that patch `openai.OpenAI`. The production agent service uses
        the unified LLM client.
        """
        if self._llm_client is None:
            import openai
            self._llm_client = openai.OpenAI()
        return self._llm_client

    def _get_model(self) -> str:
        """Get model name from LLM config."""
        return get_llm_config().model

    def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.7,
    ) -> str:
        """Make an OpenAI chat-completions call (legacy).

        The v2 agent service owns the unified LLM abstraction; this legacy
        implementation keeps a minimal OpenAI-compatible call path for tests
        and backward compatibility.
        """
        client = self._get_llm_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        model = self._get_model()
        # Some OpenAI models (e.g. gpt-5) use max_completion_tokens instead of max_tokens.
        # Keep this logic local to the legacy agent service to satisfy compatibility tests.
        create_kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if str(model).startswith("gpt-5"):
            create_kwargs["max_completion_tokens"] = max_tokens
        else:
            create_kwargs["max_tokens"] = max_tokens

        response = client.chat.completions.create(**create_kwargs)

        # Support both SDK object responses and dict-like responses.
        try:
            return response.choices[0].message.content or ""
        except Exception:
            pass

        try:
            return (
                (response or {}).get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                or ""
            )
        except Exception:
            return ""

    # Backwards compatibility alias
    def _call_openai(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        temperature: float = 0.7,
    ) -> str:
        """Backwards compatible alias for _call_llm."""
        return self._call_llm(system_prompt, user_prompt, max_tokens, temperature)

    def _safe_parse_json(self, content: str, default: dict | None = None) -> dict:
        """Safely parse JSON from LLM output, handling code blocks and malformed JSON.

        Args:
            content: Raw LLM output that may contain JSON
            default: Default value if parsing fails

        Returns:
            Parsed JSON dict or default value
        """

        if default is None:
            default = {}

        if not content or not content.strip():
            return default

        # Try to extract JSON from markdown code blocks
        cleaned = content.strip()

        # Handle ```json ... ``` blocks
        json_block_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if json_block_match:
            cleaned = json_block_match.group(1).strip()
        elif cleaned.startswith("```"):
            # Handle case where ``` is at start but no closing
            parts = cleaned.split("```", 2)
            if len(parts) >= 2:
                cleaned = parts[1].strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()

        # Try direct parse
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Try to find JSON object or array in the content
        for pattern in [r"\{.*\}", r"\[.*\]"]:
            match = re.search(pattern, cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    continue

        logger.warning(f"Failed to parse JSON from LLM output: {content[:200]}...")
        return default

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        """Execute the agent's task."""
        pass


class LegacyResearchAgentImpl(BaseAgent):
    """Legacy research agent — deep-dives into any topic and compiles reports."""

    async def execute(
        self,
        topic: str,
        depth: str = "comprehensive",  # quick, moderate, comprehensive
        focus_areas: Optional[List[str]] = None,
        max_sections: int = 5,
    ) -> ResearchReport:
        """
        Research a topic and compile a report.

        Args:
            topic: Topic to research
            depth: Research depth level
            focus_areas: Specific areas to focus on
            max_sections: Maximum number of sections

        Returns:
            ResearchReport with findings
        """
        focus_prompt = ""
        if focus_areas:
            focus_prompt = f"\nFocus on these areas: {', '.join(focus_areas)}"

        depth_instructions = {
            "quick": "Provide a brief overview with key points only.",
            "moderate": "Provide a balanced report with main points and some detail.",
            "comprehensive": "Provide an in-depth analysis with detailed sections, examples, and recommendations.",
        }

        system_prompt = f"""You are an expert research analyst. Your task is to research the given topic and compile a comprehensive report.

{depth_instructions.get(depth, depth_instructions['moderate'])}
{focus_prompt}

Structure your response as JSON:
{{
    "summary": "<executive summary>",
    "sections": [
        {{"title": "<section title>", "content": "<detailed content>"}},
        ...
    ],
    "key_findings": ["<finding 1>", "<finding 2>", ...],
    "recommendations": ["<recommendation 1>", ...],
    "sources": [{{"title": "<source title>", "url": "<url if applicable>"}}]
}}

Limit to {max_sections} main sections."""

        try:
            content = self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Research topic: {topic}",
                max_tokens=4000,
                temperature=0.7,
            )

            # Safely parse JSON from LLM output
            result = self._safe_parse_json(content, default={
                "summary": "Unable to parse research results",
                "sections": [],
                "sources": [],
                "key_findings": [],
                "recommendations": [],
            })

            return LegacyResearchReport(
                topic=topic,
                summary=result.get("summary", ""),
                sections=result.get("sections", []),
                sources=result.get("sources", []),
                key_findings=result.get("key_findings", []),
                recommendations=result.get("recommendations", []),
                word_count=len(content.split()),
            )

        except Exception as e:
            logger.exception("agent_task_failed")
            return LegacyResearchReport(
                topic=topic,
                summary="Research failed due to an internal error",
            )


class DataAnalystAgent(BaseAgent):
    """
    Data Analyst Agent
    Answers questions about data and generates insights.
    """

    def _compute_column_stats(self, data: List[Dict[str, Any]], columns: List[str]) -> Dict[str, Any]:
        """Compute summary statistics for all columns in the dataset."""
        stats = {}
        for col in columns:
            values = [row.get(col) for row in data if row.get(col) is not None]
            if not values:
                stats[col] = {"type": "empty", "count": 0}
                continue

            # Determine column type and compute appropriate stats
            numeric_values = []
            for v in values:
                try:
                    numeric_values.append(float(v))
                except (ValueError, TypeError):
                    pass

            if len(numeric_values) > len(values) * 0.5:  # More than 50% numeric
                import statistics
                stats[col] = {
                    "type": "numeric",
                    "count": len(numeric_values),
                    "min": min(numeric_values),
                    "max": max(numeric_values),
                    "mean": round(statistics.mean(numeric_values), 2),
                    "median": round(statistics.median(numeric_values), 2),
                    "std": round(statistics.stdev(numeric_values), 2) if len(numeric_values) > 1 else 0,
                }
            else:
                # Categorical column
                from collections import Counter
                value_counts = Counter(str(v) for v in values)
                top_values = value_counts.most_common(5)
                stats[col] = {
                    "type": "categorical",
                    "count": len(values),
                    "unique": len(value_counts),
                    "top_values": [{"value": v, "count": c} for v, c in top_values],
                }
        return stats

    def _stratified_sample(self, data: List[Dict[str, Any]], sample_size: int = 50) -> List[Dict[str, Any]]:
        """Get a stratified sample from the data to ensure representation."""
        if len(data) <= sample_size:
            return data

        # Take samples from beginning, middle, and end to capture distribution
        n = len(data)
        indices = set()

        # First 10 rows
        indices.update(range(min(10, n)))
        # Last 10 rows
        indices.update(range(max(0, n - 10), n))
        # Evenly spaced samples from the middle
        remaining = sample_size - len(indices)
        if remaining > 0:
            step = max(1, n // remaining)
            for i in range(0, n, step):
                indices.add(i)
                if len(indices) >= sample_size:
                    break

        return [data[i] for i in sorted(indices)][:sample_size]

    async def execute(
        self,
        question: str,
        data: List[Dict[str, Any]],
        data_description: Optional[str] = None,
        generate_charts: bool = True,
    ) -> DataAnalysisResult:
        """
        Analyze data and answer questions.

        Args:
            question: Question about the data
            data: Data to analyze
            data_description: Description of the data
            generate_charts: Whether to suggest charts

        Returns:
            DataAnalysisResult with analysis
        """

        # Get column info and compute full dataset statistics
        if data:
            columns = list(data[0].keys())
            column_info = f"Columns: {', '.join(columns)}"

            # Compute statistics from FULL dataset (not just sample)
            full_stats = self._compute_column_stats(data, columns)
            stats_summary = json.dumps(full_stats, indent=2, default=str)

            # Get stratified sample for detailed inspection
            sample = self._stratified_sample(data, sample_size=30)
            data_sample = json.dumps(sample, indent=2, default=str)
        else:
            column_info = "No data provided"
            stats_summary = "{}"
            data_sample = "[]"

        system_prompt = f"""You are an expert data analyst. Analyze the provided data and answer the question.

Data Description: {data_description or 'Not provided'}
{column_info}
Total rows: {len(data)}

IMPORTANT: The statistics below are computed from the FULL dataset, not just the sample.
Column Statistics (full dataset):
{stats_summary}

Provide your response as JSON:
{{
    "answer": "<direct answer to the question>",
    "data_summary": {{"key metrics": "..."}},
    "insights": ["<insight 1>", "<insight 2>", ...],
    "charts": [{{"type": "<chart type>", "title": "<title>", "x_column": "<col>", "y_columns": ["<col>"]}}],
    "sql_queries": ["<SQL query that would answer this>"],
    "confidence": <0.0-1.0>
}}"""

        try:
            content = self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Data sample (stratified from full dataset):\n{data_sample}\n\nQuestion: {question}",
                max_tokens=2000,
                temperature=0.3,
            )

            # Safely parse JSON from LLM output
            result = self._safe_parse_json(content, default={
                "answer": "Unable to parse analysis results",
                "data_summary": {},
                "insights": [],
                "charts": [],
                "sql_queries": [],
                "confidence": 0.0,
            })

            return DataAnalysisResult(
                query=question,
                answer=result.get("answer", ""),
                data_summary=result.get("data_summary", {}),
                insights=result.get("insights", []),
                charts=result.get("charts", []) if generate_charts else [],
                sql_queries=result.get("sql_queries", []),
                confidence=result.get("confidence", 0.5),
            )

        except Exception as e:
            logger.exception("agent_task_failed")
            return DataAnalysisResult(
                query=question,
                answer="Analysis failed due to an internal error",
            )


class EmailDraftAgent(BaseAgent):
    """
    Email Draft Agent
    Composes email responses based on context and previous emails.
    """

    async def execute(
        self,
        context: str,
        purpose: str,
        tone: str = "professional",
        recipient_info: Optional[str] = None,
        previous_emails: Optional[List[str]] = None,
        include_subject: bool = True,
    ) -> EmailDraft:
        """
        Draft an email response.

        Args:
            context: Context for the email
            purpose: Purpose of the email
            tone: Desired tone (professional, friendly, formal, casual)
            recipient_info: Information about the recipient
            previous_emails: Previous emails in the thread
            include_subject: Whether to suggest a subject line

        Returns:
            EmailDraft with the composed email
        """
        previous_context = ""
        if previous_emails:
            previous_context = "\n\nPrevious emails in thread:\n" + "\n---\n".join(previous_emails[-3:])

        recipient_context = ""
        if recipient_info:
            recipient_context = f"\n\nRecipient information: {recipient_info}"

        system_prompt = f"""You are an expert email writer. Draft an email based on the context and purpose provided.

Tone: {tone}
{recipient_context}
{previous_context}

Provide your response as JSON:
{{
    "subject": "<email subject line>",
    "body": "<full email body>",
    "tone": "{tone}",
    "suggested_recipients": ["<email if mentioned>"],
    "attachments_suggested": ["<suggested attachment if relevant>"],
    "follow_up_actions": ["<action items from this email>"]
}}"""

        try:
            content = self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Context: {context}\n\nPurpose: {purpose}",
                max_tokens=1500,
                temperature=0.7,
            )

            # Safely parse JSON from LLM output
            result = self._safe_parse_json(content, default={
                "subject": "",
                "body": "Unable to generate email draft",
                "tone": tone,
                "suggested_recipients": [],
                "attachments_suggested": [],
                "follow_up_actions": [],
            })

            return EmailDraft(
                subject=result.get("subject", ""),
                body=result.get("body", ""),
                tone=result.get("tone", tone),
                suggested_recipients=result.get("suggested_recipients", []),
                attachments_suggested=result.get("attachments_suggested", []),
                follow_up_actions=result.get("follow_up_actions", []),
            )

        except Exception as e:
            logger.exception("agent_task_failed")
            return EmailDraft(
                subject="",
                body="Draft failed due to an internal error",
                tone=tone,
            )


class ContentRepurposingAgent(BaseAgent):
    """
    Content Repurposing Agent
    Transforms content from one format to multiple other formats.
    """

    async def execute(
        self,
        content: str,
        source_format: str,
        target_formats: List[str],
        preserve_key_points: bool = True,
        adapt_length: bool = True,
    ) -> RepurposedContent:
        """
        Repurpose content into multiple formats.

        Args:
            content: Original content
            source_format: Original format (article, report, transcript, etc.)
            target_formats: Target formats (tweet_thread, linkedin_post, blog_summary, slides, etc.)
            preserve_key_points: Ensure key points are preserved
            adapt_length: Adapt length for each format

        Returns:
            RepurposedContent with all versions
        """
        format_guidelines = {
            "tweet_thread": "Create a Twitter thread (max 280 chars per tweet, 5-10 tweets)",
            "linkedin_post": "Create a LinkedIn post (professional tone, 1300 chars max)",
            "blog_summary": "Create a blog-style summary (300-500 words)",
            "slides": "Create slide content (title + 3-5 bullet points per slide, max 10 slides)",
            "email_newsletter": "Create newsletter content (catchy subject, scannable body)",
            "video_script": "Create a video script (conversational, 2-3 minutes)",
            "infographic": "Create infographic copy (headline, key stats, takeaways)",
            "podcast_notes": "Create podcast show notes (summary, timestamps, links)",
            "press_release": "Create press release format (headline, lead, quotes)",
            "executive_summary": "Create executive summary (1 page, key decisions)",
        }

        outputs = []
        adaptations = []

        for target_format in target_formats:
            guidelines = format_guidelines.get(target_format, f"Create {target_format} format content")

            system_prompt = f"""You are a content repurposing expert. Transform the following {source_format} into {target_format} format.

Guidelines: {guidelines}
{'Preserve all key points and main ideas.' if preserve_key_points else ''}
{'Adapt the length appropriately for the format.' if adapt_length else ''}

Return ONLY the transformed content, no explanations."""

            try:
                transformed = self._call_llm(
                    system_prompt=system_prompt,
                    user_prompt=content,
                    max_tokens=2000,
                    temperature=0.7,
                )

                outputs.append({
                    "format": target_format,
                    "content": transformed,
                    "metadata": {
                        "word_count": len(transformed.split()),
                        "char_count": len(transformed),
                    }
                })

                adaptations.append(f"Converted to {target_format}")

            except Exception as e:
                logger.exception("agent_task_failed")
                outputs.append({
                    "format": target_format,
                    "content": "Conversion failed due to an internal error",
                    "metadata": {"error": True}
                })

        return RepurposedContent(
            original_format=source_format,
            outputs=outputs,
            adaptations_made=adaptations,
        )


class ProofreadingAgent(BaseAgent):
    """
    Proofreading Agent
    Comprehensive style and grammar checking.
    """

    async def execute(
        self,
        text: str,
        style_guide: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        preserve_voice: bool = True,
    ) -> ProofreadingResult:
        """
        Proofread and improve text.

        Args:
            text: Text to proofread
            style_guide: Style guide to follow (AP, Chicago, etc.)
            focus_areas: Specific areas to focus on
            preserve_voice: Preserve author's voice

        Returns:
            ProofreadingResult with corrections
        """
        style_context = f"\nFollow {style_guide} style guide." if style_guide else ""
        focus_context = f"\nFocus especially on: {', '.join(focus_areas)}" if focus_areas else ""
        voice_context = "\nPreserve the author's unique voice while making corrections." if preserve_voice else ""

        system_prompt = f"""You are an expert editor and proofreader. Review the text for:
1. Grammar and spelling errors
2. Punctuation issues
3. Style and clarity improvements
4. Consistency issues
5. Readability enhancements
{style_context}{focus_context}{voice_context}

Provide your response as JSON:
{{
    "corrected_text": "<the improved text>",
    "issues_found": [
        {{"type": "<error type>", "original": "<original text>", "correction": "<corrected>", "explanation": "<why>"}}
    ],
    "style_suggestions": ["<suggestion 1>", ...],
    "readability_score": <0-100>,
    "reading_level": "<grade level>"
}}"""

        try:
            content = self._call_llm(
                system_prompt=system_prompt,
                user_prompt=text,
                max_tokens=4000,
                temperature=0.3,
            )

            # Safely parse JSON from LLM output
            result = self._safe_parse_json(content, default={
                "corrected_text": text,
                "issues_found": [],
                "style_suggestions": [],
                "readability_score": 0,
                "reading_level": "",
            })

            return ProofreadingResult(
                original_text=text,
                corrected_text=result.get("corrected_text", text),
                issues_found=result.get("issues_found", []),
                style_suggestions=result.get("style_suggestions", []),
                readability_score=result.get("readability_score", 0),
                word_count=len(text.split()),
                reading_level=result.get("reading_level", ""),
            )

        except Exception as e:
            logger.exception("agent_task_failed")
            return ProofreadingResult(
                original_text=text,
                corrected_text=text,
                issues_found=[{"type": "error", "original": "", "correction": "", "explanation": "Review failed due to an internal error"}],
            )


class AgentService:
    """
    Central service for managing AI agents.
    """

    # Maximum number of completed tasks to keep in memory
    MAX_COMPLETED_TASKS = 100
    # Maximum age of completed tasks in seconds (1 hour)
    MAX_TASK_AGE_SECONDS = 3600

    def __init__(self):
        self._agents = {
            AgentType.RESEARCH: LegacyResearchAgentImpl(),
            AgentType.DATA_ANALYST: DataAnalystAgent(),
            AgentType.EMAIL_DRAFT: EmailDraftAgent(),
            AgentType.CONTENT_REPURPOSE: ContentRepurposingAgent(),
            AgentType.PROOFREADING: ProofreadingAgent(),
        }
        self._tasks: Dict[str, AgentTask] = {}
        # Legacy service is in-memory and used in both sync and async contexts.
        # Use a threading lock so callers can list tasks without having to await.
        self._tasks_lock = threading.RLock()

    def _cleanup_old_tasks(self) -> None:
        """Remove old completed tasks to prevent memory leaks.

        Must be called while holding self._tasks_lock.
        """
        now = datetime.now(timezone.utc)
        completed_tasks = [
            (task_id, task) for task_id, task in self._tasks.items()
            if task.status in (AgentStatus.COMPLETED, AgentStatus.FAILED)
        ]

        # Remove tasks older than MAX_TASK_AGE_SECONDS
        for task_id, task in completed_tasks:
            if task.completed_at:
                age_seconds = (now - task.completed_at).total_seconds()
                if age_seconds > self.MAX_TASK_AGE_SECONDS:
                    del self._tasks[task_id]

        # If still too many tasks, remove oldest completed ones
        completed_tasks = [
            (task_id, task) for task_id, task in self._tasks.items()
            if task.status in (AgentStatus.COMPLETED, AgentStatus.FAILED)
        ]
        if len(completed_tasks) > self.MAX_COMPLETED_TASKS:
            # Sort by completion time, oldest first
            sorted_tasks = sorted(
                completed_tasks,
                key=lambda x: x[1].completed_at or datetime.min.replace(tzinfo=timezone.utc)
            )
            # Remove oldest tasks until we're under the limit
            for task_id, _ in sorted_tasks[:len(completed_tasks) - self.MAX_COMPLETED_TASKS]:
                del self._tasks[task_id]

    async def run_agent(
        self,
        agent_type: AgentType,
        **kwargs,
    ) -> AgentTask:
        """
        Run an agent with the given parameters.

        Args:
            agent_type: Type of agent to run
            **kwargs: Agent-specific parameters

        Returns:
            AgentTask with results
        """
        with self._tasks_lock:
            # Clean up old tasks before adding new ones
            self._cleanup_old_tasks()

            task_id = hashlib.sha256(f"{agent_type}:{datetime.now(timezone.utc).isoformat()}".encode()).hexdigest()[:12]

            task = AgentTask(
                task_id=task_id,
                agent_type=agent_type,
                input=kwargs,
                status=AgentStatus.RUNNING,
            )
            self._tasks[task_id] = task

        try:
            agent = self._agents.get(agent_type)
            if not agent:
                raise ValueError(f"Unknown agent type: {agent_type}")

            result = await agent.execute(**kwargs)
            with self._tasks_lock:
                task.result = result.model_dump() if hasattr(result, "model_dump") else result
                task.status = AgentStatus.COMPLETED

        except Exception as e:
            logger.exception("agent_task_failed")
            with self._tasks_lock:
                task.status = AgentStatus.FAILED
                task.error = "Task failed due to an internal error"

        task.completed_at = datetime.now(timezone.utc)
        return task

    def get_task(self, task_id: str) -> Optional[AgentTask]:
        """Get task by ID."""
        return self._tasks.get(task_id)

    class _AwaitableList(list):
        """List that can also be awaited (returns itself).

        This preserves compatibility with older call sites that did `await service.list_tasks()`
        while allowing sync callers (including FastAPI route handlers) to use it directly.
        """

        def __await__(self):
            if False:  # pragma: no cover - makes this a generator
                yield None
            return self

    def list_tasks(self, agent_type: Optional[AgentType] = None, limit: int = 50) -> List[AgentTask]:
        """List recent tasks, optionally filtered by agent type."""
        with self._tasks_lock:
            tasks = list(self._tasks.values())
        if agent_type:
            tasks = [t for t in tasks if t.agent_type == agent_type]
        sorted_tasks = sorted(tasks, key=lambda t: t.created_at, reverse=True)[:limit]
        return self._AwaitableList(sorted_tasks)

    async def clear_completed_tasks(self) -> int:
        """Clear all completed and failed tasks. Returns count of cleared tasks."""
        with self._tasks_lock:
            to_remove = [
                task_id for task_id, task in self._tasks.items()
                if task.status in (AgentStatus.COMPLETED, AgentStatus.FAILED)
            ]
            for task_id in to_remove:
                del self._tasks[task_id]
        return len(to_remove)


# Singleton instances
agent_service = AgentService()


# ORCHESTRATION


# mypy: ignore-errors
"""
Data Analysis Crew — CrewAI role-based workflow.

Roles:
1. Data Explorer: Examines data structure, distributions, and anomalies
2. Statistician: Performs statistical analysis and identifies patterns
3. Narrator: Translates findings into clear, actionable narrative

Falls back to single-agent execution if CrewAI is not installed.
"""


logger = logging.getLogger("neura.agents.crews.analysis")

_crewai_available = False
try:
    from crewai import Agent, Task, Crew, Process
    _crewai_available = True
except ImportError:
    pass


@dataclass
class AnalysisCrewResult:
    """Result from the data analysis crew."""
    data_exploration: str = ""
    statistical_findings: str = ""
    narrative: str = ""
    key_insights: List[str] = field(default_factory=list)
    quality_score: float = 0.0
    charts_suggested: List[Dict[str, Any]] = field(default_factory=list)


class DataAnalysisCrew:
    """
    Multi-agent crew for data analysis using CrewAI.

    Usage:
        crew = DataAnalysisCrew()
        result = await crew.run(
            data_summary="Table stats and sample data...",
            schema_info={...},
            analysis_goal="Identify trends in quarterly sales",
        )
    """

    def __init__(self, llm_model: str = "qwen"):
        self._model = llm_model

    async def run(
        self,
        data_summary: str,
        schema_info: Optional[Dict[str, Any]] = None,
        analysis_goal: str = "",
        progress_callback=None,
    ) -> AnalysisCrewResult:
        """Execute the data analysis crew workflow."""
        if not _crewai_available:
            return await self._fallback_run(
                data_summary, schema_info, analysis_goal, progress_callback
            )
        return await self._crewai_run(
            data_summary, schema_info, analysis_goal, progress_callback
        )

    async def _crewai_run(
        self,
        data_summary, schema_info, analysis_goal, progress_callback
    ) -> AnalysisCrewResult:
        """Run with CrewAI multi-agent orchestration."""
        logger.info("analysis_crew_start", extra={"mode": "crewai"})

        data_explorer = Agent(
            role="Data Explorer",
            goal="Examine data structure, distributions, quality, and identify anomalies",
            backstory="Expert data analyst skilled at understanding datasets and spotting patterns.",
            verbose=False,
        )
        statistician = Agent(
            role="Statistician",
            goal="Perform statistical analysis, identify correlations, and validate findings",
            backstory="PhD statistician specializing in applied statistics for business intelligence.",
            verbose=False,
        )
        narrator = Agent(
            role="Narrator",
            goal="Translate analytical findings into clear, actionable business insights",
            backstory="Data storyteller who bridges the gap between technical analysis and business decisions.",
            verbose=False,
        )

        data_preview = data_summary[:3000]
        schema_str = str(schema_info)[:1500] if schema_info else "No schema provided"

        explore_task = Task(
            description=(
                f"Explore and characterize this dataset:\n{data_preview}\n\n"
                f"Schema info:\n{schema_str}\n\n"
                f"Analysis goal: {analysis_goal or 'General data exploration'}"
            ),
            agent=data_explorer,
            expected_output="Data quality assessment, distribution summary, and initial observations",
        )
        stats_task = Task(
            description=(
                f"Based on the data exploration, perform statistical analysis. "
                f"Focus on: {analysis_goal or 'key patterns and correlations'}. "
                f"Identify significant findings and suggest visualizations."
            ),
            agent=statistician,
            expected_output="Statistical findings with significance levels and suggested charts",
        )
        narrate_task = Task(
            description=(
                "Synthesize the exploration and statistical findings into a clear narrative. "
                "Include: executive summary, key insights, recommended actions, and chart descriptions."
            ),
            agent=narrator,
            expected_output="Business-ready narrative with actionable insights and chart recommendations",
        )

        crew = Crew(
            agents=[data_explorer, statistician, narrator],
            tasks=[explore_task, stats_task, narrate_task],
            process=Process.sequential,
            verbose=False,
        )

        try:
            result = crew.kickoff()
            return AnalysisCrewResult(
                data_exploration=str(explore_task.output) if hasattr(explore_task, 'output') else "",
                statistical_findings=str(stats_task.output) if hasattr(stats_task, 'output') else "",
                narrative=str(result),
                quality_score=0.8,
            )
        except Exception as exc:
            logger.error("analysis_crew_failed", extra={"error": str(exc)[:200]})
            return await self._fallback_run(
                data_summary, schema_info, analysis_goal, progress_callback
            )

    async def _fallback_run(
        self,
        data_summary, schema_info, analysis_goal, progress_callback
    ) -> AnalysisCrewResult:
        """Fallback: single-agent execution without CrewAI."""
        logger.info("analysis_crew_fallback", extra={"mode": "single_agent"})

        if progress_callback:
            progress_callback(20, "Analyzing data (single-agent mode)")

        client = get_llm_client()

        result = AnalysisCrewResult()

        schema_str = str(schema_info)[:1500] if schema_info else "No schema provided"
        prompt = (
            f"You are a data analysis expert. Analyze the following data and provide insights.\n\n"
            f"Data summary:\n{data_summary[:4000]}\n\n"
            f"Schema:\n{schema_str}\n\n"
            f"Goal: {analysis_goal or 'General analysis'}\n\n"
            f"Provide:\n1. Data exploration findings\n2. Statistical patterns\n"
            f"3. Key insights (as bullet points)\n4. Suggested charts/visualizations"
        )

        resp = client.complete(
            messages=[{"role": "user", "content": prompt}],
            description="crew-data-analysis",
        )
        from backend.app.services.llm import _extract_response_text
        result.narrative = _extract_response_text(resp)

        if progress_callback:
            progress_callback(90, "Analysis complete")

        result.quality_score = 0.7
        return result


"""
Content Repurpose Crew — CrewAI role-based workflow.

Roles:
1. Content Strategist: Analyzes source material and identifies key themes
2. Platform Specialist: Adapts content for target platform (email, social, slides)
3. Editor: Polishes language, tone, and formatting

Falls back to single-agent execution if CrewAI is not installed.
"""

from typing import List

logger = logging.getLogger("neura.agents.crews.content")

_crewai_available = False
try:
    _crewai_available = True
except ImportError:
    pass


@dataclass
class ContentCrewResult:
    """Result from the content repurpose crew."""
    strategy_analysis: str = ""
    adapted_content: str = ""
    final_output: str = ""
    target_platform: str = ""
    quality_score: float = 0.0
    suggestions: List[str] = field(default_factory=list)


class ContentRepurposeCrew:
    """
    Multi-agent crew for content repurposing using CrewAI.

    Usage:
        crew = ContentRepurposeCrew()
        result = await crew.run(
            source_content="Original report text...",
            target_platform="email",
            tone="professional",
        )
    """

    def __init__(self, llm_model: str = "qwen"):
        self._model = llm_model

    async def run(
        self,
        source_content: str,
        target_platform: str = "email",
        tone: str = "professional",
        audience: str = "general",
        progress_callback=None,
    ) -> ContentCrewResult:
        """Execute the content repurpose crew workflow."""
        if not _crewai_available:
            return await self._fallback_run(
                source_content, target_platform, tone, audience, progress_callback
            )
        return await self._crewai_run(
            source_content, target_platform, tone, audience, progress_callback
        )

    async def _crewai_run(
        self,
        source_content, target_platform, tone, audience, progress_callback
    ) -> ContentCrewResult:
        """Run with CrewAI multi-agent orchestration."""
        logger.info("content_crew_start", extra={"mode": "crewai", "platform": target_platform})

        content_strategist = Agent(
            role="Content Strategist",
            goal="Analyze source material and identify key themes, data points, and messaging",
            backstory="Expert content strategist with experience in data-driven communication.",
            verbose=False,
        )
        platform_specialist = Agent(
            role="Platform Specialist",
            goal=f"Adapt content for {target_platform} with {tone} tone for {audience} audience",
            backstory=f"Specialist in {target_platform} content creation with deep platform knowledge.",
            verbose=False,
        )
        editor = Agent(
            role="Editor",
            goal="Polish the final content for clarity, impact, and correctness",
            backstory="Senior editor with expertise in technical and business communication.",
            verbose=False,
        )

        source_preview = source_content[:3000]

        analyze_task = Task(
            description=f"Analyze this content and identify key themes, data points, and core messaging:\n{source_preview}",
            agent=content_strategist,
            expected_output="Structured analysis with key themes, critical data points, and recommended messaging angles",
        )
        adapt_task = Task(
            description=(
                f"Adapt the analyzed content for {target_platform}. "
                f"Tone: {tone}. Audience: {audience}. "
                f"Follow platform best practices for length, format, and engagement."
            ),
            agent=platform_specialist,
            expected_output=f"Content adapted for {target_platform} with proper formatting and tone",
        )
        edit_task = Task(
            description="Review and polish the adapted content. Fix any issues with clarity, grammar, flow, and impact.",
            agent=editor,
            expected_output="Final polished content ready for publication",
        )

        crew = Crew(
            agents=[content_strategist, platform_specialist, editor],
            tasks=[analyze_task, adapt_task, edit_task],
            process=Process.sequential,
            verbose=False,
        )

        try:
            result = crew.kickoff()
            return ContentCrewResult(
                strategy_analysis=str(analyze_task.output) if hasattr(analyze_task, 'output') else "",
                adapted_content=str(adapt_task.output) if hasattr(adapt_task, 'output') else "",
                final_output=str(result),
                target_platform=target_platform,
                quality_score=0.8,
            )
        except Exception as exc:
            logger.error("content_crew_failed", extra={"error": str(exc)[:200]})
            return await self._fallback_run(
                source_content, target_platform, tone, audience, progress_callback
            )

    async def _fallback_run(
        self,
        source_content, target_platform, tone, audience, progress_callback
    ) -> ContentCrewResult:
        """Fallback: single-agent execution without CrewAI."""
        logger.info("content_crew_fallback", extra={"mode": "single_agent"})

        if progress_callback:
            progress_callback(20, "Analyzing content (single-agent mode)")

        client = get_llm_client()

        result = ContentCrewResult(target_platform=target_platform)

        prompt = (
            f"You are a content repurposing expert. Analyze and adapt the following content "
            f"for {target_platform}. Tone: {tone}. Audience: {audience}.\n\n"
            f"Source content:\n{source_content[:4000]}\n\n"
            f"Provide:\n1. Key themes analysis\n2. Adapted content for {target_platform}\n3. Final polished version"
        )

        resp = client.complete(
            messages=[{"role": "user", "content": prompt}],
            description="crew-content-repurpose",
        )
        result.final_output = _extract_response_text(resp)

        if progress_callback:
            progress_callback(90, "Content repurposing complete")

        result.quality_score = 0.7
        return result


"""
Report Generation Crew — CrewAI role-based workflow.

Roles:
1. Template Analyst: Analyzes PDF template structure
2. Data Engineer: Builds optimal SQL queries from mappings
3. Report Writer: Generates narrative content for reports
4. QA Reviewer: Validates output quality and completeness

Falls back to single-agent execution if CrewAI is not installed.
"""

from typing import Any, Dict, List

logger = logging.getLogger("neura.agents.crews.report")

_crewai_available = False
try:
    _crewai_available = True
except ImportError:
    pass


@dataclass
class ReportCrewResult:
    """Result from the report generation crew."""
    template_analysis: str = ""
    sql_queries: List[str] = field(default_factory=list)
    narrative_content: str = ""
    quality_review: str = ""
    quality_score: float = 0.0
    issues: List[str] = field(default_factory=list)


class ReportGenerationCrew:
    """
    Multi-agent crew for report generation using CrewAI.

    Usage:
        crew = ReportGenerationCrew()
        result = await crew.run(
            template_fields=[...],
            schema_info={...},
            data_context="..."
        )
    """

    def __init__(self, llm_model: str = "qwen"):
        self._model = llm_model

    async def run(
        self,
        template_fields: List[Dict[str, Any]],
        schema_info: Dict[str, Any],
        data_context: str = "",
        progress_callback=None,
    ) -> ReportCrewResult:
        """Execute the report generation crew workflow."""
        if not _crewai_available:
            return await self._fallback_run(template_fields, schema_info, data_context, progress_callback)

        return await self._crewai_run(template_fields, schema_info, data_context, progress_callback)

    async def _crewai_run(
        self,
        template_fields, schema_info, data_context, progress_callback
    ) -> ReportCrewResult:
        """Run with CrewAI multi-agent orchestration."""
        logger.info("report_crew_start", extra={"mode": "crewai"})

        # Define agents
        template_analyst = Agent(
            role="Template Analyst",
            goal="Analyze the PDF template structure and identify all data binding points",
            backstory="Expert in document template analysis with deep knowledge of report layouts.",
            verbose=False,
        )
        data_engineer = Agent(
            role="Data Engineer",
            goal="Build optimal SQL queries to fetch data for each template field",
            backstory="Senior data engineer specializing in SQL optimization and schema analysis.",
            verbose=False,
        )
        report_writer = Agent(
            role="Report Writer",
            goal="Generate clear, accurate narrative content for report sections",
            backstory="Technical writer experienced in data-driven report authoring.",
            verbose=False,
        )
        qa_reviewer = Agent(
            role="QA Reviewer",
            goal="Validate report completeness, accuracy, and formatting quality",
            backstory="Quality assurance specialist for automated report generation systems.",
            verbose=False,
        )

        # Define tasks
        fields_str = str(template_fields)[:2000]
        schema_str = str(schema_info)[:2000]

        analyze_task = Task(
            description=f"Analyze template fields and identify data requirements:\n{fields_str}",
            agent=template_analyst,
            expected_output="Structured analysis of template fields with data requirements",
        )
        query_task = Task(
            description=f"Build SQL queries for the schema:\n{schema_str}\nBased on template analysis.",
            agent=data_engineer,
            expected_output="List of optimized SQL queries",
        )
        write_task = Task(
            description=f"Generate narrative content for the report using context:\n{data_context[:1000]}",
            agent=report_writer,
            expected_output="Report narrative sections",
        )
        review_task = Task(
            description="Review the complete report output for quality, accuracy, and completeness.",
            agent=qa_reviewer,
            expected_output="Quality assessment with score and issues list",
        )

        crew = Crew(
            agents=[template_analyst, data_engineer, report_writer, qa_reviewer],
            tasks=[analyze_task, query_task, write_task, review_task],
            process=Process.sequential,
            verbose=False,
        )

        try:
            result = crew.kickoff()
            return ReportCrewResult(
                template_analysis=str(analyze_task.output) if hasattr(analyze_task, 'output') else "",
                narrative_content=str(write_task.output) if hasattr(write_task, 'output') else "",
                quality_review=str(result),
                quality_score=0.8,
            )
        except Exception as exc:
            logger.error("report_crew_failed", extra={"error": str(exc)[:200]})
            return await self._fallback_run(template_fields, schema_info, data_context, progress_callback)

    async def _fallback_run(
        self,
        template_fields, schema_info, data_context, progress_callback
    ) -> ReportCrewResult:
        """Fallback: single-agent execution without CrewAI."""
        logger.info("report_crew_fallback", extra={"mode": "single_agent"})

        if progress_callback:
            progress_callback(25, "Analyzing template (single-agent mode)")

        # Use Claude Code CLI directly for each step
        client = get_llm_client()

        result = ReportCrewResult()

        # Step 1: Template analysis
        resp = client.complete(
            messages=[{"role": "user", "content": f"Analyze these template fields and describe data requirements:\n{str(template_fields)[:3000]}"}],
            description="crew-template-analysis",
        )
        result.template_analysis = _extract_response_text(resp)

        if progress_callback:
            progress_callback(75, "Generating quality review")

        result.quality_score = 0.7
        return result


# ── Registry helper ──

_CREW_REGISTRY = {
    "analysis": "DataAnalysisCrew",
    "content": "ContentCrew",
    "report": "ReportCrew",
}


def get_crew_class(name: str):
    """Look up a crew class by name."""
    class_name = _CREW_REGISTRY.get(name)
    if not class_name:
        raise ValueError(f"Unknown crew: {name}. Available: {list(_CREW_REGISTRY.keys())}")
    import sys
    mod = sys.modules[__name__]
    cls = getattr(mod, class_name, None)
    if cls is None:
        raise ValueError(f"Crew class {class_name} not found in module")
    return cls

# TEAMS (merged from teams.py)

# Teams: MappingTeam, ResearchTeam, ReportReviewTeam
# Falls back to single-agent LLM calls if AutoGen not installed


logger = logging.getLogger("neura.agents.teams")

# Graceful AutoGen availability check
_autogen_available: bool = False
try:
    from autogen_agentchat.agents import AssistantAgent  # noqa: F401
    from autogen_agentchat.teams import RoundRobinGroupChat  # noqa: F401
    from autogen_agentchat.conditions import MaxMessageTermination  # noqa: F401

    _autogen_available = True
    logger.info("AutoGen AgentChat detected — multi-agent teams enabled")
except ImportError:
    logger.info(
        "AutoGen AgentChat not installed — teams will use single-agent fallback. "
        "Install with: pip install autogen-agentchat autogen-ext[openai]"
    )

# Core types (always available)
# BaseTeam, TeamConfig, TeamResult, AgentMessage, TeamExecutionError are defined below

# Team implementations (always importable; gracefully degrade at runtime)
# ReportReviewTeam is defined below
# MappingTeam is defined below
# ResearchTeam is defined below

__all__ = [
    # Availability flag
    "_autogen_available",
    # Base types
    "BaseTeam",
    "TeamConfig",
    "TeamResult",
    "AgentMessage",
    "TeamExecutionError",
    # Teams
    "ReportReviewTeam",
    "MappingTeam",
    "ResearchTeam",
]


"""
Base Team - Abstract foundation for AutoGen multi-agent teams.

Implements the RoundRobinGroupChat + MaxMessageTermination pattern
from the BFI architecture. Each team consists of specialized agents
that collaborate in round-robin fashion until a termination condition
is met (max messages, consensus reached, or task completed).

When AutoGen is not available, provides a single-agent fallback that
uses the existing LLM client infrastructure to simulate multi-agent
collaboration through sequential prompting.

Design Principles:
- Graceful degradation: works with or without AutoGen
- Structured results via dataclasses
- Progress updates compatible with agent task persistence
- Full conversation logging for audit/debugging
- Configurable termination conditions
"""


logger = logging.getLogger("neura.agents.teams")

# AutoGen imports (graceful)
_autogen_available: bool = False
try:
    from autogen_agentchat.agents import AssistantAgent
    from autogen_agentchat.teams import RoundRobinGroupChat
    from autogen_agentchat.conditions import MaxMessageTermination

    _autogen_available = True
except ImportError:
    AssistantAgent = None  # type: ignore[assignment,misc]
    RoundRobinGroupChat = None  # type: ignore[assignment,misc]
    MaxMessageTermination = None  # type: ignore[assignment,misc]


# Data models

@dataclass
class TeamConfig:
    """Configuration for a multi-agent team.

    Attributes:
        max_rounds: Maximum number of round-robin message exchanges.
            Each round consists of one message from each agent.
        max_messages: Hard cap on total messages (rounds * agents).
            Defaults to max_rounds * 3 if not set.
        temperature: LLM sampling temperature for team agents.
        model: LLM model override. If None, uses the system default.
        timeout_seconds: Maximum wall-clock time for team execution.
        enable_conversation_log: Whether to capture full conversation.
    """
    max_rounds: int = 5
    max_messages: Optional[int] = None
    temperature: float = 0.7
    model: Optional[str] = None
    timeout_seconds: int = 300
    enable_conversation_log: bool = True

    def __post_init__(self) -> None:
        if self.max_messages is None:
            self.max_messages = self.max_rounds * 3
        if self.max_rounds < 1:
            raise ValueError("max_rounds must be >= 1")
        if self.timeout_seconds < 10:
            raise ValueError("timeout_seconds must be >= 10")


@dataclass
class AgentMessage:
    """A single message in the team conversation log.

    Attributes:
        agent_name: Name of the agent that produced this message.
        role: Agent's role in the team (e.g., "ContentReviewer").
        content: The message content.
        timestamp: When the message was produced.
        round_num: Which conversation round this belongs to.
    """
    agent_name: str
    role: str
    content: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    round_num: int = 0


@dataclass
class TeamResult:
    """Structured result from a team execution.

    Attributes:
        success: Whether the team completed successfully.
        output: The structured output from the team (team-specific schema).
        raw_output: Raw text output from the final synthesis.
        conversation_log: Full conversation between agents.
        rounds_completed: Number of rounds actually completed.
        total_messages: Total messages exchanged.
        execution_time_ms: Wall-clock execution time in milliseconds.
        used_autogen: Whether AutoGen was used or fallback was used.
        metadata: Additional team-specific metadata.
        error: Error message if success is False.
    """
    success: bool
    output: Dict[str, Any] = field(default_factory=dict)
    raw_output: str = ""
    conversation_log: List[AgentMessage] = field(default_factory=list)
    rounds_completed: int = 0
    total_messages: int = 0
    execution_time_ms: int = 0
    used_autogen: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a JSON-safe dictionary."""
        return {
            "success": self.success,
            "output": self.output,
            "raw_output": self.raw_output,
            "conversation_log": [
                {
                    "agent_name": m.agent_name,
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.isoformat(),
                    "round_num": m.round_num,
                }
                for m in self.conversation_log
            ],
            "rounds_completed": self.rounds_completed,
            "total_messages": self.total_messages,
            "execution_time_ms": self.execution_time_ms,
            "used_autogen": self.used_autogen,
            "metadata": self.metadata,
            "error": self.error,
        }


class TeamExecutionError(Exception):
    """Raised when a team execution fails irrecoverably.

    Attributes:
        message: Human-readable error message.
        code: Machine-readable error code.
        retryable: Whether the operation can be retried.
        partial_result: Any partial result produced before failure.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str = "TEAM_EXECUTION_ERROR",
        retryable: bool = True,
        partial_result: Optional[TeamResult] = None,
    ):
        self.message = message
        self.code = code
        self.retryable = retryable
        self.partial_result = partial_result
        super().__init__(message)


# Progress callback type (matches base_agent.py pattern)

@dataclass
class TeamProgressUpdate:
    """Progress update from a team execution.

    Compatible with the agent task persistence layer.
    """
    percent: int
    message: str
    current_agent: str
    round_num: int
    total_rounds: int

TeamProgressCallback = Callable[[TeamProgressUpdate], None]


# Agent definition for team composition

@dataclass
class AgentSpec:
    """Specification for an agent within a team.

    Attributes:
        name: Unique name for the agent (e.g., "ContentReviewer").
        role: Human-readable role description.
        system_prompt: The system prompt that defines agent behavior.
        description: Short description for AutoGen agent registration.
    """
    name: str
    role: str
    system_prompt: str
    description: str = ""

    def __post_init__(self) -> None:
        if not self.description:
            self.description = f"{self.name}: {self.role}"


# Base Team

class BaseTeam(ABC):
    """Abstract base class for all multi-agent teams.

    Subclasses must implement:
    - define_agents(): Returns the list of AgentSpec for the team.
    - build_task_prompt(input_data): Builds the initial task prompt.
    - parse_output(conversation): Extracts structured output from conversation.

    The base class handles:
    - AutoGen team orchestration (RoundRobinGroupChat)
    - Single-agent fallback when AutoGen is unavailable
    - Progress tracking and conversation logging
    - Timeout enforcement
    - Error handling and partial result capture
    """

    # Subclasses should set a descriptive team name
    TEAM_NAME: str = "BaseTeam"

    def __init__(self, config: Optional[TeamConfig] = None):
        self.config = config or TeamConfig()
        self._llm_client = None
        self._model: Optional[str] = None

    # ------------------------------------------------------------------
    # LLM client access (matches BaseAgentV2 pattern)
    # ------------------------------------------------------------------

    def _get_llm_client(self):
        """Get the unified LLM client lazily."""
        if self._llm_client is None:
            self._llm_client = get_llm_client()
        return self._llm_client

    def _get_model(self) -> str:
        """Get model name, preferring config override."""
        if self.config.model:
            return self.config.model
        if self._model is None:
            self._model = get_llm_config().model
        return self._model

    # ------------------------------------------------------------------
    # Abstract methods for subclasses
    # ------------------------------------------------------------------

    @abstractmethod
    def define_agents(self) -> List[AgentSpec]:
        """Define the agents that compose this team.

        Returns:
            Ordered list of AgentSpec. The order determines the
            round-robin speaking order.
        """
        ...

    @abstractmethod
    def build_task_prompt(self, input_data: Dict[str, Any]) -> str:
        """Build the initial task prompt from input data.

        This prompt is sent to the team to kick off the conversation.

        Args:
            input_data: Team-specific input parameters.

        Returns:
            The task prompt string.
        """
        ...

    @abstractmethod
    def parse_output(
        self,
        conversation: List[AgentMessage],
        input_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Extract structured output from the team conversation.

        Args:
            conversation: The full conversation log.
            input_data: The original input data for context.

        Returns:
            Structured output dictionary (team-specific schema).
        """
        ...

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def _compose_team(
        self,
        task_description: str,
        all_agents: List[AgentSpec],
    ) -> List[AgentSpec]:
        """Agent decides optimal team composition for the task.

        Given the full list of available agents (from define_agents()),
        the LLM selects 2-4 agents that form the best team.
        Falls back to the full agent list on any failure.
        """
        if len(all_agents) <= 2:
            return all_agents  # No point selecting from 2 or fewer

        try:
            client = self._get_llm_client()

            available_roles = [
                {"name": a.name, "role": a.role, "description": a.description}
                for a in all_agents
            ]

            prompt = (
                f"Task: {task_description[:1000]}\n\n"
                "Available agent roles:\n"
                + "\n".join(f"- {r['name']}: {r['description']}" for r in available_roles)
                + "\n\nSelect 2-4 agents that form the best team for this task. "
                "Consider which roles are essential and which add value vs. overhead.\n"
                'Return ONLY JSON: {"selected": ["agent_name1", "agent_name2", ...], "reason": "..."}'
            )

            loop = asyncio.get_running_loop()
            response = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: client.complete(
                        messages=[{"role": "user", "content": prompt}],
                        description=f"team_compose_{self.TEAM_NAME}",
                        max_tokens=256,
                    ),
                ),
                timeout=20,
            )

            content = (
                response.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            ) or ""

            parsed = json.loads(content.strip())
            selected_names = set(parsed.get("selected", []))

            if not selected_names:
                return all_agents

            composed = [a for a in all_agents if a.name in selected_names]

            # Ensure we have at least 2 agents
            if len(composed) < 2:
                return all_agents

            logger.info(
                "team_dynamic_composition",
                extra={
                    "team": self.TEAM_NAME,
                    "all_agents": [a.name for a in all_agents],
                    "selected": [a.name for a in composed],
                    "reason": str(parsed.get("reason", ""))[:200],
                },
            )
            return composed

        except Exception:
            logger.debug("team_compose_fallback_to_full", exc_info=True)
            return all_agents

    async def run(
        self,
        input_data: Dict[str, Any],
        progress_callback: Optional[TeamProgressCallback] = None,
    ) -> TeamResult:
        """Execute the team on the given input data.

        Attempts AutoGen-based multi-agent execution first.
        Falls back to single-agent sequential execution if AutoGen
        is unavailable.

        Args:
            input_data: Team-specific input parameters.
            progress_callback: Optional callback for progress updates.

        Returns:
            TeamResult with structured output and conversation log.

        Raises:
            TeamExecutionError: If execution fails irrecoverably.
        """
        start_time = time.monotonic()

        agents = self.define_agents()
        if not agents:
            raise TeamExecutionError(
                f"{self.TEAM_NAME}: No agents defined",
                code="NO_AGENTS",
                retryable=False,
            )

        task_prompt = self.build_task_prompt(input_data)

        # Dynamic team composition — let the LLM select the best agents
        if len(agents) > 2:
            try:
                agents = await self._compose_team(task_prompt, agents)
            except Exception:
                pass  # Use full team on failure
        logger.info(
            "%s: Starting execution with %d agents, max_rounds=%d, autogen=%s",
            self.TEAM_NAME,
            len(agents),
            self.config.max_rounds,
            _autogen_available,
        )

        if progress_callback:
            progress_callback(TeamProgressUpdate(
                percent=5,
                message=f"Initializing {self.TEAM_NAME}...",
                current_agent="system",
                round_num=0,
                total_rounds=self.config.max_rounds,
            ))

        try:
            if _autogen_available:
                result = await self._run_autogen(
                    agents=agents,
                    task_prompt=task_prompt,
                    input_data=input_data,
                    progress_callback=progress_callback,
                )
            else:
                result = await self._run_fallback(
                    agents=agents,
                    task_prompt=task_prompt,
                    input_data=input_data,
                    progress_callback=progress_callback,
                )
        except TeamExecutionError:
            raise
        except asyncio.TimeoutError:
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            raise TeamExecutionError(
                f"{self.TEAM_NAME}: Execution timed out after {self.config.timeout_seconds}s",
                code="TEAM_TIMEOUT",
                retryable=True,
                partial_result=TeamResult(
                    success=False,
                    execution_time_ms=elapsed_ms,
                    error="Timeout",
                ),
            )
        except Exception as exc:
            elapsed_ms = int((time.monotonic() - start_time) * 1000)
            logger.exception("%s: Unexpected error during execution", self.TEAM_NAME)
            raise TeamExecutionError(
                f"{self.TEAM_NAME}: {exc}",
                code="TEAM_UNEXPECTED_ERROR",
                retryable=True,
                partial_result=TeamResult(
                    success=False,
                    execution_time_ms=elapsed_ms,
                    error=str(exc),
                ),
            )

        result.execution_time_ms = int((time.monotonic() - start_time) * 1000)

        if progress_callback:
            progress_callback(TeamProgressUpdate(
                percent=100,
                message=f"{self.TEAM_NAME} completed",
                current_agent="system",
                round_num=result.rounds_completed,
                total_rounds=self.config.max_rounds,
            ))

        logger.info(
            "%s: Completed in %dms, rounds=%d, messages=%d, autogen=%s",
            self.TEAM_NAME,
            result.execution_time_ms,
            result.rounds_completed,
            result.total_messages,
            result.used_autogen,
        )

        return result

    # ------------------------------------------------------------------
    # AutoGen execution path
    # ------------------------------------------------------------------

    async def _run_autogen(
        self,
        agents: List[AgentSpec],
        task_prompt: str,
        input_data: Dict[str, Any],
        progress_callback: Optional[TeamProgressCallback] = None,
    ) -> TeamResult:
        """Execute team using AutoGen RoundRobinGroupChat.

        Creates AutoGen AssistantAgent instances, assembles them into
        a RoundRobinGroupChat, and runs the conversation with
        MaxMessageTermination.
        """
        from autogen_ext.models.openai import OpenAIChatCompletionClient

        model_name = self._get_model()

        # Build the model client for AutoGen agents
        model_client = OpenAIChatCompletionClient(
            model=model_name,
            temperature=self.config.temperature,
        )

        # Create AutoGen agents
        autogen_agents = []
        for spec in agents:
            agent = AssistantAgent(
                name=spec.name,
                description=spec.description,
                system_message=spec.system_prompt,
                model_client=model_client,
            )
            autogen_agents.append(agent)

        # Termination condition
        termination = MaxMessageTermination(max_messages=self.config.max_messages)

        # Build team
        team = RoundRobinGroupChat(
            participants=autogen_agents,
            termination_condition=termination,
        )

        # Run the team conversation
        conversation_log: List[AgentMessage] = []
        round_num = 0
        agent_count = len(agents)
        message_count = 0

        try:
            result_stream = team.run_stream(task=task_prompt)

            async for event in result_stream:
                # AutoGen events have a .source and .content attribute
                if hasattr(event, "source") and hasattr(event, "content"):
                    source_name = str(event.source) if event.source else "unknown"
                    content = str(event.content) if event.content else ""

                    if not content.strip():
                        continue

                    message_count += 1
                    current_round = (message_count - 1) // agent_count + 1

                    if current_round > round_num:
                        round_num = current_round

                    # Find the matching agent spec for role info
                    role = "unknown"
                    for spec in agents:
                        if spec.name == source_name:
                            role = spec.role
                            break

                    msg = AgentMessage(
                        agent_name=source_name,
                        role=role,
                        content=content,
                        round_num=round_num,
                    )
                    conversation_log.append(msg)

                    logger.debug(
                        "%s: [Round %d] %s: %s",
                        self.TEAM_NAME,
                        round_num,
                        source_name,
                        content[:200],
                    )

                    if progress_callback:
                        pct = min(
                            10 + int(80 * message_count / self.config.max_messages),
                            90,
                        )
                        progress_callback(TeamProgressUpdate(
                            percent=pct,
                            message=f"{source_name} is contributing...",
                            current_agent=source_name,
                            round_num=round_num,
                            total_rounds=self.config.max_rounds,
                        ))

        except asyncio.TimeoutError:
            raise
        except Exception as exc:
            logger.error(
                "%s: AutoGen execution error: %s", self.TEAM_NAME, exc,
            )
            # If we have partial results, still try to parse them
            if conversation_log:
                logger.info(
                    "%s: Attempting to parse %d partial messages",
                    self.TEAM_NAME,
                    len(conversation_log),
                )
            else:
                raise TeamExecutionError(
                    f"AutoGen execution failed: {exc}",
                    code="AUTOGEN_ERROR",
                    retryable=True,
                )

        # Parse structured output from conversation
        try:
            output = self.parse_output(conversation_log, input_data)
        except Exception as parse_exc:
            logger.warning(
                "%s: Output parsing failed: %s", self.TEAM_NAME, parse_exc,
            )
            output = {"raw_messages": [m.content for m in conversation_log]}

        raw_output = ""
        if conversation_log:
            raw_output = conversation_log[-1].content

        return TeamResult(
            success=True,
            output=output,
            raw_output=raw_output,
            conversation_log=conversation_log if self.config.enable_conversation_log else [],
            rounds_completed=round_num,
            total_messages=message_count,
            used_autogen=True,
        )

    # ------------------------------------------------------------------
    # Fallback execution path (no AutoGen)
    # ------------------------------------------------------------------

    async def _run_fallback(
        self,
        agents: List[AgentSpec],
        task_prompt: str,
        input_data: Dict[str, Any],
        progress_callback: Optional[TeamProgressCallback] = None,
    ) -> TeamResult:
        """Execute team using sequential single-agent LLM calls.

        Simulates multi-agent collaboration by running each agent's
        perspective sequentially, building on prior agents' outputs.
        This produces surprisingly good results because:
        1. Each agent has a focused system prompt (role specialization).
        2. Agents see all prior contributions (shared context).
        3. The round-robin structure is preserved.
        """
        client = self._get_llm_client()
        model = self._get_model()

        conversation_log: List[AgentMessage] = []
        round_num = 0
        message_count = 0

        for round_idx in range(self.config.max_rounds):
            round_num = round_idx + 1

            for agent_idx, spec in enumerate(agents):
                # Build conversation context for this agent
                context_messages = self._build_fallback_context(
                    task_prompt=task_prompt,
                    agent_spec=spec,
                    conversation_so_far=conversation_log,
                    round_num=round_num,
                    is_final_round=(round_idx == self.config.max_rounds - 1),
                )

                try:
                    loop = asyncio.get_running_loop()
                    response = await asyncio.wait_for(
                        loop.run_in_executor(
                            None,
                            lambda msgs=context_messages: client.complete(
                                messages=msgs,
                                description=f"team-{self.TEAM_NAME}-{spec.name}",
                                max_tokens=2048,
                                temperature=self.config.temperature,
                            ),
                        ),
                        timeout=self.config.timeout_seconds,
                    )
                except asyncio.TimeoutError:
                    raise
                except Exception as exc:
                    logger.error(
                        "%s: Fallback LLM call failed for %s: %s",
                        self.TEAM_NAME,
                        spec.name,
                        exc,
                    )
                    raise TeamExecutionError(
                        f"LLM call failed for {spec.name}: {exc}",
                        code="LLM_FALLBACK_ERROR",
                        retryable=True,
                    )

                # Extract content from response
                content = (
                    response.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                ) or ""

                message_count += 1

                msg = AgentMessage(
                    agent_name=spec.name,
                    role=spec.role,
                    content=content,
                    round_num=round_num,
                )
                conversation_log.append(msg)

                logger.debug(
                    "%s: [Fallback Round %d] %s: %s",
                    self.TEAM_NAME,
                    round_num,
                    spec.name,
                    content[:200],
                )

                if progress_callback:
                    total_steps = self.config.max_rounds * len(agents)
                    current_step = round_idx * len(agents) + agent_idx + 1
                    pct = min(10 + int(80 * current_step / total_steps), 90)
                    progress_callback(TeamProgressUpdate(
                        percent=pct,
                        message=f"{spec.name} ({spec.role}) is contributing...",
                        current_agent=spec.name,
                        round_num=round_num,
                        total_rounds=self.config.max_rounds,
                    ))

        # Parse structured output
        try:
            output = self.parse_output(conversation_log, input_data)
        except Exception as parse_exc:
            logger.warning(
                "%s: Fallback output parsing failed: %s",
                self.TEAM_NAME,
                parse_exc,
            )
            output = {"raw_messages": [m.content for m in conversation_log]}

        raw_output = ""
        if conversation_log:
            raw_output = conversation_log[-1].content

        return TeamResult(
            success=True,
            output=output,
            raw_output=raw_output,
            conversation_log=conversation_log if self.config.enable_conversation_log else [],
            rounds_completed=round_num,
            total_messages=message_count,
            used_autogen=False,
        )

    def _build_fallback_context(
        self,
        task_prompt: str,
        agent_spec: AgentSpec,
        conversation_so_far: List[AgentMessage],
        round_num: int,
        is_final_round: bool,
    ) -> List[Dict[str, str]]:
        """Build the message list for a single fallback LLM call.

        Constructs a conversation that gives the agent:
        1. Its specialized system prompt
        2. The original task
        3. All prior agent contributions
        4. Instructions for this round
        """
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": agent_spec.system_prompt},
        ]

        # Build the user message with task + conversation history
        parts: List[str] = [
            f"## Task\n{task_prompt}",
        ]

        if conversation_so_far:
            parts.append("\n## Prior Contributions")
            for msg in conversation_so_far:
                parts.append(
                    f"\n### {msg.agent_name} ({msg.role}) — Round {msg.round_num}\n"
                    f"{msg.content}"
                )

        round_instruction = (
            f"\n## Your Turn (Round {round_num})\n"
            f"You are **{agent_spec.name}** ({agent_spec.role}). "
        )

        if is_final_round:
            round_instruction += (
                "This is the FINAL round. Provide your definitive contribution, "
                "synthesizing all prior feedback and producing actionable output. "
                "If you have no further changes, confirm the current state is satisfactory."
            )
        elif round_num == 1:
            round_instruction += (
                "Provide your initial analysis and contribution based on the task. "
                "Be specific and actionable."
            )
        else:
            round_instruction += (
                "Review the prior contributions, address any concerns raised, "
                "and refine your analysis. Build on what others have said."
            )

        parts.append(round_instruction)

        messages.append({"role": "user", "content": "\n".join(parts)})

        return messages


"""
Template Mapping Team - Multi-agent team for schema-to-template mapping.

Agents:
1. SchemaAnalyst - Analyzes source schema structure, data types, and relationships.
2. MappingSpecialist - Creates field-level mappings with transformation logic.
3. Validator - Validates mappings for completeness, correctness, and edge cases.

This team is designed for the NeuraReport template mapping pipeline, where
source data schemas (SQL tables, CSV headers, API responses) need to be
mapped to report template placeholders.

The team operates in round-robin fashion:
- Round 1: SchemaAnalyst describes the source; MappingSpecialist proposes mappings;
           Validator identifies gaps and edge cases.
- Round 2+: Iterative refinement based on validator feedback.
- Final: Validated, production-ready mapping specification.
"""


logger = logging.getLogger("neura.agents.teams.mapping")


# Input / Output models

@dataclass
class FieldMapping:
    """A single field mapping from source to target.

    Attributes:
        source_field: Source field name or expression.
        target_field: Target template placeholder.
        transformation: Transformation logic (e.g., "format_currency", "date_format").
        data_type: Expected data type.
        required: Whether this mapping is required.
        default_value: Default value if source is null.
        notes: Additional notes about the mapping.
        confidence: Confidence score 0.0-1.0.
    """
    source_field: str
    target_field: str
    transformation: str = "direct"
    data_type: str = "string"
    required: bool = True
    default_value: Optional[str] = None
    notes: str = ""
    confidence: float = 1.0


@dataclass
class MappingValidationIssue:
    """A validation issue found in the mapping."""
    severity: str  # "error", "warning", "info"
    field: str  # Which field(s) this relates to
    message: str
    suggestion: str = ""


@dataclass
class MappingInput:
    """Input for the Template Mapping Team.

    Attributes:
        source_schema: Description of the source data schema.
            Can be SQL DDL, JSON schema, column headers, etc.
        target_template: Description of the target template placeholders.
            Can be a list of placeholder names or template content.
        context: Additional context about the mapping requirements.
        source_sample_data: Optional sample data from the source.
        mapping_hints: Optional hints about known mappings.
    """
    source_schema: str
    target_template: str
    context: str = ""
    source_sample_data: Optional[str] = None
    mapping_hints: List[str] = field(default_factory=list)

    def validate(self) -> None:
        """Validate input data."""
        if not self.source_schema or not self.source_schema.strip():
            raise TeamExecutionError(
                "Source schema cannot be empty",
                code="INVALID_INPUT",
                retryable=False,
            )
        if not self.target_template or not self.target_template.strip():
            raise TeamExecutionError(
                "Target template cannot be empty",
                code="INVALID_INPUT",
                retryable=False,
            )


@dataclass
class MappingOutput:
    """Structured output from the Template Mapping Team.

    Attributes:
        mappings: List of field mappings.
        unmapped_source_fields: Source fields that could not be mapped.
        unmapped_target_fields: Target placeholders without a source.
        validation_issues: Issues found during validation.
        schema_summary: Brief summary of the source schema.
        confidence_score: Overall confidence in the mapping (0.0-1.0).
        transformation_notes: Notes about complex transformations needed.
    """
    mappings: List[FieldMapping] = field(default_factory=list)
    unmapped_source_fields: List[str] = field(default_factory=list)
    unmapped_target_fields: List[str] = field(default_factory=list)
    validation_issues: List[MappingValidationIssue] = field(default_factory=list)
    schema_summary: str = ""
    confidence_score: float = 0.0
    transformation_notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "mappings": [
                {
                    "source_field": m.source_field,
                    "target_field": m.target_field,
                    "transformation": m.transformation,
                    "data_type": m.data_type,
                    "required": m.required,
                    "default_value": m.default_value,
                    "notes": m.notes,
                    "confidence": m.confidence,
                }
                for m in self.mappings
            ],
            "unmapped_source_fields": self.unmapped_source_fields,
            "unmapped_target_fields": self.unmapped_target_fields,
            "validation_issues": [
                {
                    "severity": v.severity,
                    "field": v.field,
                    "message": v.message,
                    "suggestion": v.suggestion,
                }
                for v in self.validation_issues
            ],
            "schema_summary": self.schema_summary,
            "confidence_score": self.confidence_score,
            "transformation_notes": self.transformation_notes,
        }


# Mapping Team

class MappingTeam(BaseTeam):
    """Multi-agent team for schema-to-template field mapping.

    Combines three specialized agents (SchemaAnalyst, MappingSpecialist,
    Validator) to produce accurate, validated field mappings between
    source data schemas and report template placeholders.

    Usage:
        team = MappingTeam(config=TeamConfig(max_rounds=3))
        result = await team.run(input_data={
            "source_schema": "CREATE TABLE sales (id INT, amount DECIMAL, ...)",
            "target_template": "{{total_revenue}}, {{customer_count}}, ...",
        })
    """

    TEAM_NAME = "MappingTeam"

    def define_agents(self) -> List[AgentSpec]:
        """Define the three mapping agents."""
        return [
            AgentSpec(
                name="SchemaAnalyst",
                role="Source Schema Analyst",
                description="Analyzes source data schema structure, types, and relationships",
                system_prompt=(
                    "You are a senior Schema Analyst specializing in data architecture. "
                    "Your expertise is in understanding and documenting data schemas.\n\n"
                    "Your responsibilities:\n"
                    "1. **Schema Decomposition**: Break down the source schema into fields "
                    "with their data types, constraints, and relationships.\n"
                    "2. **Semantic Analysis**: Infer the business meaning of each field "
                    "from its name, type, and context.\n"
                    "3. **Relationship Mapping**: Identify foreign keys, aggregation "
                    "opportunities, and derived fields.\n"
                    "4. **Data Quality Notes**: Flag fields that may have null values, "
                    "inconsistent formats, or require special handling.\n\n"
                    "Always provide your analysis in a structured format. When available, "
                    "use sample data to validate your understanding.\n\n"
                    "In your FINAL round response, include a JSON block:\n"
                    "```json\n"
                    '{"schema_summary": "...", "fields": [{"name": "...", "type": "...", '
                    '"semantic_meaning": "...", "nullable": true, "notes": "..."}], '
                    '"relationships": [...], "aggregation_opportunities": [...]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="MappingSpecialist",
                role="Field Mapping Specialist",
                description="Creates field-level mappings with transformation logic",
                system_prompt=(
                    "You are a Mapping Specialist with deep expertise in data transformation "
                    "and ETL pipelines. You excel at mapping source fields to target templates.\n\n"
                    "Your responsibilities:\n"
                    "1. **Field Mapping**: Map each target placeholder to its source field(s).\n"
                    "2. **Transformations**: Define transformation logic where direct mapping "
                    "is insufficient (aggregations, formatting, calculations).\n"
                    "3. **Default Values**: Specify sensible defaults for optional/nullable fields.\n"
                    "4. **Confidence Rating**: Rate your confidence in each mapping (0.0-1.0).\n\n"
                    "Transformation types to consider:\n"
                    "- `direct`: Straight copy, no transformation\n"
                    "- `format_currency`: Format as currency (e.g., $1,234.56)\n"
                    "- `format_date`: Date formatting (specify input/output formats)\n"
                    "- `format_percentage`: Format as percentage\n"
                    "- `aggregate_sum`: SUM aggregation over a group\n"
                    "- `aggregate_count`: COUNT aggregation\n"
                    "- `aggregate_avg`: AVERAGE aggregation\n"
                    "- `concatenate`: Join multiple fields\n"
                    "- `lookup`: Reference/lookup table join\n"
                    "- `calculated`: Custom expression\n"
                    "- `conditional`: IF/CASE logic\n\n"
                    "In your FINAL round response, include a JSON block:\n"
                    "```json\n"
                    '{"mappings": [{"source_field": "...", "target_field": "...", '
                    '"transformation": "direct", "data_type": "string", '
                    '"required": true, "default_value": null, "confidence": 0.95, '
                    '"notes": "..."}], "unmapped_source": [...], "unmapped_target": [...]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="Validator",
                role="Mapping Validator",
                description="Validates mappings for completeness, correctness, and edge cases",
                system_prompt=(
                    "You are a Mapping Validator specializing in data quality assurance. "
                    "Your job is to rigorously validate proposed field mappings.\n\n"
                    "Your responsibilities:\n"
                    "1. **Completeness Check**: Ensure all required target fields are mapped.\n"
                    "2. **Type Compatibility**: Verify source and target data types are compatible.\n"
                    "3. **Transformation Correctness**: Validate that transformations are correct "
                    "and handle edge cases (nulls, empty strings, overflow).\n"
                    "4. **Edge Cases**: Identify scenarios that could break mappings "
                    "(missing data, unexpected formats, encoding issues).\n"
                    "5. **Performance Concerns**: Flag mappings that may be expensive "
                    "(complex aggregations, cross-table joins).\n\n"
                    "Issue severity levels:\n"
                    "- `error`: Mapping will fail or produce incorrect results\n"
                    "- `warning`: Mapping may fail under certain conditions\n"
                    "- `info`: Suggestion for improvement, not a problem\n\n"
                    "In your FINAL round response, include a JSON block:\n"
                    "```json\n"
                    '{"validation_passed": true, "confidence_score": 0.85, '
                    '"issues": [{"severity": "warning", "field": "...", '
                    '"message": "...", "suggestion": "..."}], '
                    '"transformation_notes": [...]}\n'
                    "```"
                ),
            ),
        ]

    def build_task_prompt(self, input_data: Dict[str, Any]) -> str:
        """Build the mapping task prompt."""
        mapping_input = MappingInput(**input_data)
        mapping_input.validate()

        parts = [
            "# Template Mapping Task\n",
            "Map the source data schema to the target template placeholders.\n",
            "## Source Schema\n",
            f"```\n{mapping_input.source_schema}\n```\n",
            "## Target Template Placeholders\n",
            f"```\n{mapping_input.target_template}\n```\n",
        ]

        if mapping_input.context:
            parts.append(f"## Additional Context\n{mapping_input.context}\n")

        if mapping_input.source_sample_data:
            parts.append(
                f"## Sample Source Data\n```\n{mapping_input.source_sample_data}\n```\n"
            )

        if mapping_input.mapping_hints:
            hints_text = "\n".join(f"- {h}" for h in mapping_input.mapping_hints)
            parts.append(f"## Mapping Hints\n{hints_text}\n")

        parts.append(
            "\n---\n\n"
            "Analyze the source schema, propose field mappings with transformations, "
            "and validate the result for completeness and correctness."
        )

        return "\n".join(parts)

    def parse_output(
        self,
        conversation: List[AgentMessage],
        input_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Parse structured mapping output from the conversation.

        Extracts the MappingSpecialist's mapping definitions and
        the Validator's validation results to produce the final output.
        """
        if not conversation:
            return MappingOutput(
                schema_summary="No mapping produced — conversation was empty.",
            ).to_dict()

        # Get final messages from each agent
        agent_finals: Dict[str, AgentMessage] = {}
        for msg in conversation:
            agent_finals[msg.agent_name] = msg

        # Extract schema analysis
        schema_summary = ""
        schema_data = self._extract_json_from_agent(agent_finals.get("SchemaAnalyst"))
        if schema_data:
            schema_summary = schema_data.get("schema_summary", "")

        # Extract mappings from MappingSpecialist
        mappings: List[FieldMapping] = []
        unmapped_source: List[str] = []
        unmapped_target: List[str] = []

        mapping_data = self._extract_json_from_agent(agent_finals.get("MappingSpecialist"))
        if mapping_data:
            for m in mapping_data.get("mappings", []):
                mappings.append(FieldMapping(
                    source_field=m.get("source_field", ""),
                    target_field=m.get("target_field", ""),
                    transformation=m.get("transformation", "direct"),
                    data_type=m.get("data_type", "string"),
                    required=m.get("required", True),
                    default_value=m.get("default_value"),
                    notes=m.get("notes", ""),
                    confidence=float(m.get("confidence", 0.8)),
                ))
            unmapped_source = mapping_data.get("unmapped_source", [])
            unmapped_target = mapping_data.get("unmapped_target", [])

        # Extract validation results
        validation_issues: List[MappingValidationIssue] = []
        transformation_notes: List[str] = []
        confidence_score = 0.0

        validator_data = self._extract_json_from_agent(agent_finals.get("Validator"))
        if validator_data:
            confidence_score = float(validator_data.get("confidence_score", 0.0))
            transformation_notes = validator_data.get("transformation_notes", [])
            for issue in validator_data.get("issues", []):
                validation_issues.append(MappingValidationIssue(
                    severity=issue.get("severity", "info"),
                    field=issue.get("field", ""),
                    message=issue.get("message", ""),
                    suggestion=issue.get("suggestion", ""),
                ))

        # If no confidence from validator, estimate from mapping confidences
        if confidence_score == 0.0 and mappings:
            confidence_score = sum(m.confidence for m in mappings) / len(mappings)

        result = MappingOutput(
            mappings=mappings,
            unmapped_source_fields=unmapped_source,
            unmapped_target_fields=unmapped_target,
            validation_issues=validation_issues,
            schema_summary=schema_summary,
            confidence_score=round(confidence_score, 2),
            transformation_notes=transformation_notes,
        )

        return result.to_dict()

    def _extract_json_from_agent(
        self, msg: Optional[AgentMessage]
    ) -> Optional[Dict[str, Any]]:
        """Extract JSON block from an agent's message."""
        if msg is None:
            return None

        content = msg.content

        # Try ```json ... ``` blocks
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Try raw JSON object
        brace_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", content, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group())
            except json.JSONDecodeError:
                pass

        logger.debug(
            "MappingTeam: Could not extract JSON from %s message",
            msg.agent_name,
        )
        return None


"""
Report Review Team - Multi-agent team for collaborative report review.

Agents:
1. ContentReviewer - Reviews structure, clarity, completeness, and coherence.
2. FactChecker - Validates claims, data accuracy, and source reliability.
3. Editor - Polishes language, fixes grammar, and ensures consistent tone.

The team operates in round-robin fashion:
- Round 1: Each agent provides initial review from their perspective.
- Round 2+: Agents address issues raised by others and refine feedback.
- Final round: Each agent provides definitive assessment and scores.

Output: Structured review with per-agent feedback, overall score, and
suggested revisions.
"""


logger = logging.getLogger("neura.agents.teams.report_review")


# Input / Output models

@dataclass
class ReportReviewInput:
    """Input for the Report Review Team.

    Attributes:
        report_content: The full report text to review.
        report_title: Title of the report.
        review_criteria: Specific criteria to evaluate (optional).
        target_audience: Intended audience for the report.
        report_type: Type of report (e.g., "financial", "research", "technical").
        max_word_count: Expected maximum word count (for length checks).
    """
    report_content: str
    report_title: str = "Untitled Report"
    review_criteria: List[str] = field(default_factory=list)
    target_audience: str = "general business audience"
    report_type: str = "general"
    max_word_count: Optional[int] = None

    def validate(self) -> None:
        """Validate input data."""
        if not self.report_content or not self.report_content.strip():
            raise TeamExecutionError(
                "Report content cannot be empty",
                code="INVALID_INPUT",
                retryable=False,
            )
        if len(self.report_content) > 500_000:
            raise TeamExecutionError(
                "Report content exceeds 500,000 character limit",
                code="INPUT_TOO_LARGE",
                retryable=False,
            )


@dataclass
class ReviewFinding:
    """A single finding from the review process."""
    severity: str  # "critical", "major", "minor", "suggestion"
    category: str  # "accuracy", "clarity", "structure", "grammar", "completeness"
    description: str
    location: str = ""  # Section or paragraph reference
    suggested_fix: str = ""
    agent: str = ""  # Which agent found this


@dataclass
class AgentReview:
    """Review from a single agent."""
    agent_name: str
    role: str
    score: float  # 0.0 - 10.0
    summary: str
    findings: List[ReviewFinding] = field(default_factory=list)
    strengths: List[str] = field(default_factory=list)
    weaknesses: List[str] = field(default_factory=list)


@dataclass
class ReportReviewOutput:
    """Structured output from the Report Review Team."""
    overall_score: float  # 0.0 - 10.0 (average of agent scores)
    overall_assessment: str
    agent_reviews: List[AgentReview] = field(default_factory=list)
    all_findings: List[ReviewFinding] = field(default_factory=list)
    critical_issues: int = 0
    major_issues: int = 0
    minor_issues: int = 0
    suggestions: int = 0
    recommendation: str = ""  # "approve", "revise", "rewrite"

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "overall_score": self.overall_score,
            "overall_assessment": self.overall_assessment,
            "agent_reviews": [
                {
                    "agent_name": r.agent_name,
                    "role": r.role,
                    "score": r.score,
                    "summary": r.summary,
                    "findings": [
                        {
                            "severity": f.severity,
                            "category": f.category,
                            "description": f.description,
                            "location": f.location,
                            "suggested_fix": f.suggested_fix,
                            "agent": f.agent,
                        }
                        for f in r.findings
                    ],
                    "strengths": r.strengths,
                    "weaknesses": r.weaknesses,
                }
                for r in self.agent_reviews
            ],
            "all_findings": [
                {
                    "severity": f.severity,
                    "category": f.category,
                    "description": f.description,
                    "location": f.location,
                    "suggested_fix": f.suggested_fix,
                    "agent": f.agent,
                }
                for f in self.all_findings
            ],
            "critical_issues": self.critical_issues,
            "major_issues": self.major_issues,
            "minor_issues": self.minor_issues,
            "suggestions": self.suggestions,
            "recommendation": self.recommendation,
        }


# Report Review Team

class ReportReviewTeam(BaseTeam):
    """Multi-agent team for comprehensive report review.

    Combines three specialized agents (ContentReviewer, FactChecker, Editor)
    in a RoundRobinGroupChat to produce a thorough, multi-perspective review
    of any report.

    Usage:
        team = ReportReviewTeam(config=TeamConfig(max_rounds=3))
        result = await team.run(input_data={
            "report_content": "...",
            "report_title": "Q4 Financial Report",
            "review_criteria": ["accuracy", "completeness"],
        })
    """

    TEAM_NAME = "ReportReviewTeam"

    def define_agents(self) -> List[AgentSpec]:
        """Define the three review agents."""
        return [
            AgentSpec(
                name="ContentReviewer",
                role="Structure and Clarity Reviewer",
                description="Reviews report structure, clarity, completeness, and coherence",
                system_prompt=(
                    "You are a senior Content Reviewer specializing in report quality assessment. "
                    "Your expertise is in evaluating:\n\n"
                    "1. **Structure**: Logical flow, section organization, transitions\n"
                    "2. **Clarity**: Clear language, well-defined terms, readable prose\n"
                    "3. **Completeness**: All required topics covered, no gaps\n"
                    "4. **Coherence**: Consistent arguments, no contradictions\n\n"
                    "When reviewing, always:\n"
                    "- Reference specific sections or paragraphs\n"
                    "- Classify issues by severity (critical/major/minor/suggestion)\n"
                    "- Provide actionable feedback with specific rewording suggestions\n"
                    "- Acknowledge strengths as well as weaknesses\n\n"
                    "In your FINAL round response, provide a JSON block with your assessment:\n"
                    "```json\n"
                    '{"score": 8.5, "summary": "...", "strengths": [...], '
                    '"weaknesses": [...], "findings": [{"severity": "major", '
                    '"category": "structure", "description": "...", "location": "...", '
                    '"suggested_fix": "..."}]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="FactChecker",
                role="Accuracy and Data Validator",
                description="Validates claims, data accuracy, and logical consistency",
                system_prompt=(
                    "You are a meticulous Fact Checker and Data Validator. "
                    "Your expertise is in evaluating:\n\n"
                    "1. **Data Accuracy**: Verify numbers, percentages, and calculations\n"
                    "2. **Claim Validity**: Flag unsupported or questionable claims\n"
                    "3. **Source Reliability**: Assess whether sources are cited and credible\n"
                    "4. **Logical Consistency**: Detect contradictions or logical fallacies\n"
                    "5. **Temporal Accuracy**: Check that dates and timelines are consistent\n\n"
                    "When checking facts:\n"
                    "- Flag any claim that lacks a source or evidence\n"
                    "- Note calculations that appear incorrect\n"
                    "- Identify statements that contradict each other\n"
                    "- Rate confidence in each finding (high/medium/low)\n"
                    "- Do NOT flag opinions clearly marked as such\n\n"
                    "In your FINAL round response, provide a JSON block with your assessment:\n"
                    "```json\n"
                    '{"score": 7.0, "summary": "...", "strengths": [...], '
                    '"weaknesses": [...], "findings": [{"severity": "critical", '
                    '"category": "accuracy", "description": "...", "location": "...", '
                    '"suggested_fix": "..."}]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="Editor",
                role="Language and Style Editor",
                description="Polishes language, fixes grammar, ensures consistent tone",
                system_prompt=(
                    "You are a professional Editor with expertise in business and technical writing. "
                    "Your focus areas are:\n\n"
                    "1. **Grammar & Syntax**: Correct grammatical errors, awkward phrasing\n"
                    "2. **Tone Consistency**: Ensure uniform tone throughout the document\n"
                    "3. **Readability**: Simplify complex sentences, improve flow\n"
                    "4. **Formatting**: Consistent use of headings, lists, emphasis\n"
                    "5. **Terminology**: Consistent use of terms and abbreviations\n\n"
                    "When editing:\n"
                    "- Provide specific before/after examples for suggested changes\n"
                    "- Focus on high-impact changes first\n"
                    "- Respect the author's voice while improving quality\n"
                    "- Note patterns (recurring issues) not just individual instances\n\n"
                    "In your FINAL round response, provide a JSON block with your assessment:\n"
                    "```json\n"
                    '{"score": 8.0, "summary": "...", "strengths": [...], '
                    '"weaknesses": [...], "findings": [{"severity": "minor", '
                    '"category": "grammar", "description": "...", "location": "...", '
                    '"suggested_fix": "..."}]}\n'
                    "```"
                ),
            ),
        ]

    def build_task_prompt(self, input_data: Dict[str, Any]) -> str:
        """Build the review task prompt."""
        review_input = ReportReviewInput(**input_data)
        review_input.validate()

        criteria_text = ""
        if review_input.review_criteria:
            criteria_text = (
                "\n\n**Specific Review Criteria:**\n"
                + "\n".join(f"- {c}" for c in review_input.review_criteria)
            )

        word_count = len(review_input.report_content.split())
        word_count_note = ""
        if review_input.max_word_count:
            word_count_note = (
                f"\n\n**Word Count:** {word_count} / {review_input.max_word_count} "
                f"({'over' if word_count > review_input.max_word_count else 'within'} limit)"
            )

        return (
            f"# Report Review Task\n\n"
            f"**Title:** {review_input.report_title}\n"
            f"**Type:** {review_input.report_type}\n"
            f"**Target Audience:** {review_input.target_audience}\n"
            f"**Word Count:** {word_count} words"
            f"{word_count_note}"
            f"{criteria_text}\n\n"
            f"---\n\n"
            f"## Report Content\n\n"
            f"{review_input.report_content}\n\n"
            f"---\n\n"
            f"Please review this report from your specialized perspective. "
            f"Provide specific, actionable feedback with severity ratings."
        )

    def parse_output(
        self,
        conversation: List[AgentMessage],
        input_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Parse structured review output from the conversation.

        Extracts JSON assessment blocks from each agent's final-round
        messages, or falls back to text-based extraction.
        """
        if not conversation:
            return ReportReviewOutput(
                overall_score=0.0,
                overall_assessment="No review produced — conversation was empty.",
                recommendation="rewrite",
            ).to_dict()

        # Group messages by agent, take the last message from each
        agent_final_messages: Dict[str, AgentMessage] = {}
        for msg in conversation:
            agent_final_messages[msg.agent_name] = msg

        agent_reviews: List[AgentReview] = []
        all_findings: List[ReviewFinding] = []

        for agent_name, msg in agent_final_messages.items():
            review = self._parse_agent_review(agent_name, msg)
            agent_reviews.append(review)
            all_findings.extend(review.findings)

        # Calculate aggregate metrics
        scores = [r.score for r in agent_reviews if r.score > 0]
        overall_score = sum(scores) / len(scores) if scores else 0.0

        critical_count = sum(1 for f in all_findings if f.severity == "critical")
        major_count = sum(1 for f in all_findings if f.severity == "major")
        minor_count = sum(1 for f in all_findings if f.severity == "minor")
        suggestion_count = sum(1 for f in all_findings if f.severity == "suggestion")

        # Determine recommendation
        if critical_count > 0 or overall_score < 4.0:
            recommendation = "rewrite"
        elif major_count > 3 or overall_score < 6.0:
            recommendation = "revise"
        else:
            recommendation = "approve"

        # Build overall assessment
        summaries = [r.summary for r in agent_reviews if r.summary]
        overall_assessment = (
            f"Review by {len(agent_reviews)} agents. "
            f"Score: {overall_score:.1f}/10. "
            f"Found {critical_count} critical, {major_count} major, "
            f"{minor_count} minor issues and {suggestion_count} suggestions. "
            f"Recommendation: {recommendation}."
        )
        if summaries:
            overall_assessment += "\n\n" + "\n\n".join(
                f"**{r.agent_name}:** {r.summary}" for r in agent_reviews
            )

        result = ReportReviewOutput(
            overall_score=round(overall_score, 1),
            overall_assessment=overall_assessment,
            agent_reviews=agent_reviews,
            all_findings=all_findings,
            critical_issues=critical_count,
            major_issues=major_count,
            minor_issues=minor_count,
            suggestions=suggestion_count,
            recommendation=recommendation,
        )

        return result.to_dict()

    def _parse_agent_review(
        self,
        agent_name: str,
        msg: AgentMessage,
    ) -> AgentReview:
        """Parse a single agent's review from their message.

        Attempts to extract structured JSON first, then falls back
        to heuristic text parsing.
        """
        content = msg.content

        # Try to extract JSON block
        json_data = self._extract_json_block(content)

        if json_data:
            findings = []
            for f in json_data.get("findings", []):
                findings.append(ReviewFinding(
                    severity=f.get("severity", "minor"),
                    category=f.get("category", "general"),
                    description=f.get("description", ""),
                    location=f.get("location", ""),
                    suggested_fix=f.get("suggested_fix", ""),
                    agent=agent_name,
                ))

            return AgentReview(
                agent_name=agent_name,
                role=msg.role,
                score=float(json_data.get("score", 5.0)),
                summary=json_data.get("summary", ""),
                findings=findings,
                strengths=json_data.get("strengths", []),
                weaknesses=json_data.get("weaknesses", []),
            )

        # Fallback: heuristic text parsing
        return self._parse_review_from_text(agent_name, msg)

    def _extract_json_block(self, content: str) -> Optional[Dict[str, Any]]:
        """Extract JSON from markdown code blocks or raw JSON in content."""
        # Try ```json ... ``` blocks first
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Try finding a JSON object in the content
        brace_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", content, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group())
            except json.JSONDecodeError:
                pass

        return None

    def _parse_review_from_text(
        self,
        agent_name: str,
        msg: AgentMessage,
    ) -> AgentReview:
        """Heuristic text-based parsing when JSON extraction fails."""
        content = msg.content
        lines = content.split("\n")

        # Try to find a score mentioned in text
        score = 5.0
        score_match = re.search(r"(?:score|rating)[:\s]*(\d+(?:\.\d+)?)\s*/\s*10", content, re.IGNORECASE)
        if score_match:
            score = min(float(score_match.group(1)), 10.0)

        # Extract first paragraph as summary
        summary_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                if summary_lines:
                    break
                continue
            if stripped.startswith("#"):
                continue
            summary_lines.append(stripped)
        summary = " ".join(summary_lines[:3])

        # Look for bullet-point findings
        findings: List[ReviewFinding] = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(("- ", "* ", "• ")):
                item = stripped.lstrip("-*• ").strip()
                severity = "minor"
                if any(w in item.lower() for w in ("critical", "serious", "incorrect data")):
                    severity = "critical"
                elif any(w in item.lower() for w in ("major", "significant", "important")):
                    severity = "major"
                elif any(w in item.lower() for w in ("suggest", "consider", "could")):
                    severity = "suggestion"

                category = "general"
                if any(w in item.lower() for w in ("grammar", "spelling", "typo", "punctuation")):
                    category = "grammar"
                elif any(w in item.lower() for w in ("data", "number", "statistic", "fact", "accuracy")):
                    category = "accuracy"
                elif any(w in item.lower() for w in ("structure", "flow", "organization", "section")):
                    category = "structure"
                elif any(w in item.lower() for w in ("clarity", "unclear", "confusing", "ambiguous")):
                    category = "clarity"

                findings.append(ReviewFinding(
                    severity=severity,
                    category=category,
                    description=item,
                    agent=agent_name,
                ))

        return AgentReview(
            agent_name=agent_name,
            role=msg.role,
            score=score,
            summary=summary[:500],
            findings=findings,
            strengths=[],
            weaknesses=[],
        )


"""
Research Team - Multi-agent team for collaborative research.

Agents:
1. Researcher - Gathers information, identifies sources, explores the topic.
2. Analyst - Analyzes findings, identifies patterns, draws conclusions.
3. Writer - Synthesizes analysis into clear, structured prose.

This team is designed for deep research tasks where multiple perspectives
and iterative refinement produce higher-quality output than a single agent.

The team operates in round-robin fashion:
- Round 1: Researcher explores the topic; Analyst identifies key questions;
           Writer proposes an outline.
- Round 2+: Researcher fills gaps identified by Analyst; Analyst refines
            conclusions; Writer improves prose based on new findings.
- Final: Writer produces the definitive research output.
"""


logger = logging.getLogger("neura.agents.teams.research")


# Input / Output models

@dataclass
class ResearchInput:
    """Input for the Research Team.

    Attributes:
        topic: The research topic or question.
        depth: Research depth level.
        focus_areas: Specific areas to focus on.
        output_format: Desired output format.
        max_sections: Maximum number of sections in the output.
        context: Additional context or constraints.
        audience: Target audience for the research output.
    """
    topic: str
    depth: str = "comprehensive"  # "quick", "moderate", "comprehensive"
    focus_areas: List[str] = field(default_factory=list)
    output_format: str = "report"  # "report", "briefing", "analysis", "summary"
    max_sections: int = 6
    context: str = ""
    audience: str = "business professionals"

    def validate(self) -> None:
        """Validate input data."""
        if not self.topic or not self.topic.strip():
            raise TeamExecutionError(
                "Research topic cannot be empty",
                code="INVALID_INPUT",
                retryable=False,
            )
        if len(self.topic) > 1000:
            raise TeamExecutionError(
                "Research topic exceeds 1,000 character limit",
                code="INPUT_TOO_LARGE",
                retryable=False,
            )
        if self.depth not in ("quick", "moderate", "comprehensive"):
            raise TeamExecutionError(
                f"Invalid depth: {self.depth}. Must be quick, moderate, or comprehensive.",
                code="INVALID_INPUT",
                retryable=False,
            )


@dataclass
class ResearchSource:
    """A source referenced in the research."""
    title: str
    description: str = ""
    relevance: str = ""  # "high", "medium", "low"
    url: Optional[str] = None


@dataclass
class ResearchSection:
    """A section of the research output."""
    title: str
    content: str
    key_points: List[str] = field(default_factory=list)
    sources_referenced: List[str] = field(default_factory=list)
    word_count: int = 0

    def __post_init__(self) -> None:
        if not self.word_count and self.content:
            self.word_count = len(self.content.split())


@dataclass
class ResearchOutput:
    """Structured output from the Research Team.

    Attributes:
        title: Research report title.
        executive_summary: Brief executive summary.
        sections: Ordered sections of the research.
        key_findings: Top-level key findings.
        recommendations: Actionable recommendations.
        sources: Sources referenced throughout.
        methodology_notes: How the research was conducted.
        confidence_level: Overall confidence in findings.
        word_count: Total word count.
        gaps_identified: Known gaps in the research.
    """
    title: str = ""
    executive_summary: str = ""
    sections: List[ResearchSection] = field(default_factory=list)
    key_findings: List[str] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    sources: List[ResearchSource] = field(default_factory=list)
    methodology_notes: str = ""
    confidence_level: str = "medium"  # "high", "medium", "low"
    word_count: int = 0
    gaps_identified: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.word_count:
            total = len(self.executive_summary.split()) if self.executive_summary else 0
            for section in self.sections:
                total += section.word_count
            self.word_count = total

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dictionary."""
        return {
            "title": self.title,
            "executive_summary": self.executive_summary,
            "sections": [
                {
                    "title": s.title,
                    "content": s.content,
                    "key_points": s.key_points,
                    "sources_referenced": s.sources_referenced,
                    "word_count": s.word_count,
                }
                for s in self.sections
            ],
            "key_findings": self.key_findings,
            "recommendations": self.recommendations,
            "sources": [
                {
                    "title": s.title,
                    "description": s.description,
                    "relevance": s.relevance,
                    "url": s.url,
                }
                for s in self.sources
            ],
            "methodology_notes": self.methodology_notes,
            "confidence_level": self.confidence_level,
            "word_count": self.word_count,
            "gaps_identified": self.gaps_identified,
        }


# Research Team

class ResearchTeam(BaseTeam):
    """Multi-agent team for comprehensive research.

    Combines three specialized agents (Researcher, Analyst, Writer)
    in a RoundRobinGroupChat to produce thorough, well-structured
    research output through iterative collaboration.

    Usage:
        team = ResearchTeam(config=TeamConfig(max_rounds=3))
        result = await team.run(input_data={
            "topic": "Impact of AI on financial reporting",
            "depth": "comprehensive",
            "focus_areas": ["automation", "accuracy", "compliance"],
        })
    """

    TEAM_NAME = "ResearchTeam"

    def define_agents(self) -> List[AgentSpec]:
        """Define the three research agents."""
        return [
            AgentSpec(
                name="Researcher",
                role="Information Gatherer and Explorer",
                description="Gathers information, identifies sources, and explores the topic deeply",
                system_prompt=(
                    "You are a senior Research Specialist with expertise in systematic "
                    "information gathering and source evaluation. Your role in the team "
                    "is to provide the raw material — facts, data, perspectives, and "
                    "sources — that the Analyst and Writer will build upon.\n\n"
                    "Your responsibilities:\n"
                    "1. **Topic Exploration**: Identify key aspects, sub-topics, and "
                    "dimensions of the research question.\n"
                    "2. **Information Gathering**: Present relevant facts, statistics, "
                    "expert opinions, and case studies. Draw on your training data; "
                    "clearly distinguish established facts from inferences.\n"
                    "3. **Source Identification**: Name specific sources, studies, "
                    "frameworks, and authorities relevant to the topic.\n"
                    "4. **Gap Identification**: Explicitly note what information is "
                    "missing, uncertain, or conflicting.\n"
                    "5. **Counter-perspectives**: Present alternative viewpoints and "
                    "potential counterarguments.\n\n"
                    "Guidelines:\n"
                    "- Be specific: use names, dates, numbers, and citations\n"
                    "- Separate facts from opinions\n"
                    "- Flag information with uncertain reliability\n"
                    "- Respond to the Analyst's questions in subsequent rounds\n"
                    "- Prioritize depth over breadth in the given focus areas\n\n"
                    "In your FINAL round response, include a JSON block:\n"
                    "```json\n"
                    '{"sources": [{"title": "...", "description": "...", '
                    '"relevance": "high"}], "gaps_identified": [...], '
                    '"key_data_points": [...]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="Analyst",
                role="Critical Analyst and Pattern Identifier",
                description="Analyzes findings, identifies patterns, and draws evidence-based conclusions",
                system_prompt=(
                    "You are a senior Analyst with expertise in critical thinking, "
                    "pattern recognition, and evidence-based reasoning. Your role "
                    "is to make sense of the Researcher's findings and provide the "
                    "intellectual framework for the Writer.\n\n"
                    "Your responsibilities:\n"
                    "1. **Pattern Identification**: Spot trends, correlations, and "
                    "recurring themes across the gathered information.\n"
                    "2. **Critical Evaluation**: Assess the strength of evidence, "
                    "identify biases, and evaluate competing claims.\n"
                    "3. **Framework Development**: Organize findings into a coherent "
                    "analytical framework or narrative structure.\n"
                    "4. **Key Findings**: Distill the most important insights that "
                    "must be communicated.\n"
                    "5. **Recommendations**: Derive actionable recommendations from "
                    "the analysis.\n"
                    "6. **Confidence Assessment**: Rate the overall confidence level "
                    "of the findings (high/medium/low) with justification.\n\n"
                    "Guidelines:\n"
                    "- Challenge assumptions and unsupported claims\n"
                    "- Ask the Researcher to fill specific gaps\n"
                    "- Provide structured analysis, not just opinions\n"
                    "- Distinguish strong evidence from speculation\n"
                    "- Consider implications and second-order effects\n\n"
                    "In your FINAL round response, include a JSON block:\n"
                    "```json\n"
                    '{"key_findings": [...], "recommendations": [...], '
                    '"confidence_level": "high", "methodology_notes": "...", '
                    '"proposed_sections": [{"title": "...", "key_points": [...]}]}\n'
                    "```"
                ),
            ),
            AgentSpec(
                name="Writer",
                role="Research Writer and Synthesizer",
                description="Synthesizes research and analysis into clear, structured prose",
                system_prompt=(
                    "You are a professional Research Writer with expertise in "
                    "synthesizing complex information into clear, engaging prose. "
                    "Your role is to produce the final research output that "
                    "communicates findings effectively to the target audience.\n\n"
                    "Your responsibilities:\n"
                    "1. **Structure**: Organize the research into logical sections "
                    "with clear headings and flow.\n"
                    "2. **Synthesis**: Weave together the Researcher's data and "
                    "the Analyst's conclusions into coherent narrative.\n"
                    "3. **Clarity**: Explain complex concepts accessibly without "
                    "oversimplifying.\n"
                    "4. **Executive Summary**: Write a concise executive summary "
                    "that captures the essence.\n"
                    "5. **Actionability**: Ensure recommendations are specific "
                    "and actionable.\n\n"
                    "Guidelines:\n"
                    "- Write for the specified target audience\n"
                    "- Use clear topic sentences for each paragraph\n"
                    "- Include smooth transitions between sections\n"
                    "- Attribute claims to sources where applicable\n"
                    "- Keep the executive summary under 200 words\n"
                    "- In early rounds, propose outline; in later rounds, produce prose\n\n"
                    "In your FINAL round response, include a JSON block with the "
                    "complete research output:\n"
                    "```json\n"
                    '{"title": "...", "executive_summary": "...", '
                    '"sections": [{"title": "...", "content": "...", '
                    '"key_points": [...], "sources_referenced": [...]}], '
                    '"key_findings": [...], "recommendations": [...]}\n'
                    "```"
                ),
            ),
        ]

    def build_task_prompt(self, input_data: Dict[str, Any]) -> str:
        """Build the research task prompt."""
        research_input = ResearchInput(**input_data)
        research_input.validate()

        depth_instructions = {
            "quick": (
                "Provide a focused, concise overview. Target 500-800 words. "
                "Prioritize the most important findings and skip deep analysis."
            ),
            "moderate": (
                "Provide a thorough but focused analysis. Target 1000-2000 words. "
                "Cover key aspects with supporting evidence."
            ),
            "comprehensive": (
                "Provide an exhaustive, detailed analysis. Target 2000-4000 words. "
                "Cover all significant aspects with thorough evidence and analysis."
            ),
        }

        format_instructions = {
            "report": "Produce a formal research report with executive summary, sections, and recommendations.",
            "briefing": "Produce a concise briefing document with bullet points and key takeaways.",
            "analysis": "Produce a detailed analytical paper with evidence evaluation and conclusions.",
            "summary": "Produce a condensed summary highlighting only the most critical findings.",
        }

        parts = [
            f"# Research Task\n",
            f"**Topic:** {research_input.topic}\n",
            f"**Depth:** {research_input.depth}\n",
            f"**Target Audience:** {research_input.audience}\n",
            f"**Output Format:** {research_input.output_format}\n",
            f"**Max Sections:** {research_input.max_sections}\n",
        ]

        if research_input.focus_areas:
            focus_text = ", ".join(research_input.focus_areas)
            parts.append(f"**Focus Areas:** {focus_text}\n")

        if research_input.context:
            parts.append(f"\n## Additional Context\n{research_input.context}\n")

        parts.append(f"\n## Depth Instructions\n{depth_instructions[research_input.depth]}\n")
        parts.append(f"\n## Format Instructions\n{format_instructions.get(research_input.output_format, format_instructions['report'])}\n")

        parts.append(
            "\n---\n\n"
            "Collaborate as a research team. The Researcher gathers information, "
            "the Analyst identifies patterns and draws conclusions, and the Writer "
            "synthesizes everything into the final output. Each round builds on "
            "the previous contributions."
        )

        return "\n".join(parts)

    def parse_output(
        self,
        conversation: List[AgentMessage],
        input_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Parse structured research output from the conversation.

        Prioritizes the Writer's final output, supplemented by
        the Analyst's findings and Researcher's sources.
        """
        if not conversation:
            return ResearchOutput(
                title="Research output unavailable",
                executive_summary="No research produced — conversation was empty.",
            ).to_dict()

        # Get final messages from each agent
        agent_finals: Dict[str, AgentMessage] = {}
        for msg in conversation:
            agent_finals[msg.agent_name] = msg

        # Extract Writer's structured output (primary)
        writer_data = self._extract_json_from_agent(agent_finals.get("Writer"))

        # Extract Analyst's findings (supplementary)
        analyst_data = self._extract_json_from_agent(agent_finals.get("Analyst"))

        # Extract Researcher's sources (supplementary)
        researcher_data = self._extract_json_from_agent(agent_finals.get("Researcher"))

        # Build output primarily from Writer, filling gaps from other agents
        title = ""
        executive_summary = ""
        sections: List[ResearchSection] = []
        key_findings: List[str] = []
        recommendations: List[str] = []
        sources: List[ResearchSource] = []
        methodology_notes = ""
        confidence_level = "medium"
        gaps_identified: List[str] = []

        # Writer's contributions
        if writer_data:
            title = writer_data.get("title", "")
            executive_summary = writer_data.get("executive_summary", "")

            for s in writer_data.get("sections", []):
                sections.append(ResearchSection(
                    title=s.get("title", ""),
                    content=s.get("content", ""),
                    key_points=s.get("key_points", []),
                    sources_referenced=s.get("sources_referenced", []),
                ))

            key_findings = writer_data.get("key_findings", [])
            recommendations = writer_data.get("recommendations", [])

        # Analyst's contributions (supplement findings/recommendations if Writer didn't provide)
        if analyst_data:
            if not key_findings:
                key_findings = analyst_data.get("key_findings", [])
            if not recommendations:
                recommendations = analyst_data.get("recommendations", [])
            methodology_notes = analyst_data.get("methodology_notes", "")
            confidence_level = analyst_data.get("confidence_level", "medium")

            # If writer didn't produce sections, build from analyst's proposed sections
            if not sections:
                for s in analyst_data.get("proposed_sections", []):
                    sections.append(ResearchSection(
                        title=s.get("title", ""),
                        content="",
                        key_points=s.get("key_points", []),
                    ))

        # Researcher's contributions
        if researcher_data:
            for src in researcher_data.get("sources", []):
                sources.append(ResearchSource(
                    title=src.get("title", ""),
                    description=src.get("description", ""),
                    relevance=src.get("relevance", "medium"),
                    url=src.get("url"),
                ))
            gaps_identified = researcher_data.get("gaps_identified", [])

        # Fallback: if no structured JSON was extracted, use raw text
        if not title and not sections:
            title = f"Research: {input_data.get('topic', 'Unknown Topic')}"
            writer_msg = agent_finals.get("Writer")
            if writer_msg:
                executive_summary = writer_msg.content[:500]
                sections = [ResearchSection(
                    title="Research Findings",
                    content=writer_msg.content,
                )]
            elif conversation:
                # Use the last message as fallback
                last_msg = conversation[-1]
                executive_summary = last_msg.content[:500]
                sections = [ResearchSection(
                    title="Research Findings",
                    content=last_msg.content,
                )]

        result = ResearchOutput(
            title=title,
            executive_summary=executive_summary,
            sections=sections,
            key_findings=key_findings,
            recommendations=recommendations,
            sources=sources,
            methodology_notes=methodology_notes,
            confidence_level=confidence_level,
            gaps_identified=gaps_identified,
        )

        return result.to_dict()

    def _extract_json_from_agent(
        self, msg: Optional[AgentMessage]
    ) -> Optional[Dict[str, Any]]:
        """Extract JSON block from an agent's message."""
        if msg is None:
            return None

        content = msg.content

        # Try ```json ... ``` blocks
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Try raw JSON object
        # Use a more permissive pattern for nested objects
        start_idx = content.find("{")
        if start_idx != -1:
            depth = 0
            end_idx = start_idx
            for i in range(start_idx, len(content)):
                if content[i] == "{":
                    depth += 1
                elif content[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end_idx = i + 1
                        break

            if end_idx > start_idx:
                try:
                    return json.loads(content[start_idx:end_idx])
                except json.JSONDecodeError:
                    pass

        logger.debug(
            "ResearchTeam: Could not extract JSON from %s message",
            msg.agent_name,
        )
        return None


# ── Registry helper ──

_TEAM_REGISTRY = {
    "report_review": "ReportReviewTeam",
    "mapping": "MappingTeam",
    "research": "ResearchTeam",
}


def get_team_class(name: str):
    """Look up a team class by name."""
    class_name = _TEAM_REGISTRY.get(name)
    if not class_name:
        raise ValueError(f"Unknown team: {name}. Available: {list(_TEAM_REGISTRY.keys())}")
    # All classes defined in this module
    import sys
    mod = sys.modules[__name__]
    cls = getattr(mod, class_name, None)
    if cls is None:
        raise ValueError(f"Team class {class_name} not found in module")
    return cls


# ------------------------------------------------------------------
# Team convenience functions
# ------------------------------------------------------------------

def map_data_to_template(
    source_schema,
    template_fields,
    context: str | None = None,
    client=None,
) -> dict:
    """Map source data fields to template placeholders.

    Args:
        source_schema: Source schema (dict, list, or string description).
        template_fields: Target template fields.
        context: Optional extra context about the domain.
        client: Optional pre-configured LLM client.

    Returns:
        Dict with ``results``, ``errors``, and ``execution_summary`` keys.
    """
    team = MappingTeam(client=client)
    return team.run({
        "source_schema": source_schema,
        "template_fields": template_fields,
        "context": context or "",
    })


def research_topic(
    topic: str,
    depth: str = "standard",
    context: str | None = None,
    client=None,
) -> dict:
    """Research a topic using the three-agent research pipeline.

    Args:
        topic: The topic to research.
        depth: Research depth — ``"brief"``, ``"standard"``, or ``"deep"``.
        context: Optional additional context or constraints.
        client: Optional pre-configured LLM client.

    Returns:
        Dict with ``results``, ``errors``, and ``execution_summary`` keys.
    """
    team = ResearchTeam(client=client)
    return team.run({
        "topic": topic,
        "depth": depth,
        "context": context or "",
    })


def review_report(
    report_content: str,
    template_name: str = "",
    client=None,
) -> dict:
    """Review a report using the three-agent review pipeline.

    Args:
        report_content: The raw report text to review.
        template_name: Optional template name for context.
        client: Optional pre-configured LLM client.

    Returns:
        Dict with ``results``, ``errors``, and ``execution_summary`` keys.
    """
    team = ReportReviewTeam(client=client)
    return team.run({
        "report_content": report_content,
        "template_name": template_name or "general",
    })

# Section: all_agents


"""
Data Analyst Agent - Production-grade implementation.

Answers questions about data, generates insights, suggests charts, and
produces SQL query recommendations.  Operates over in-memory tabular data
(list of dicts), computes real statistics from the full dataset, and feeds
a stratified sample + stats to the LLM for accurate analysis.

Design Principles:
- Full-dataset statistics computed locally (not LLM-guessed)
- Stratified sampling for LLM context window efficiency
- Structured output with confidence score
- Progress callbacks for real-time updates
- Proper error categorization and cost tracking
"""


from pydantic import BaseModel, Field, field_validator


logger = logging.getLogger("neura.agents.data_analyst")


# INPUT VALIDATION

class DataAnalystInput(BaseModel):
    """Validated input for data analyst agent."""
    question: str = Field(..., min_length=5, max_length=1000)
    data: List[Dict[str, Any]] = Field(..., min_length=1)
    data_description: Optional[str] = Field(default=None, max_length=2000)
    generate_charts: bool = Field(default=True)

    @field_validator("question")
    @classmethod
    def validate_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty or whitespace")
        if len(v.split()) < 2:
            raise ValueError("Question must contain at least 2 words")
        return v

    @field_validator("data")
    @classmethod
    def validate_data(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError("Data must contain at least one row")
        if len(v) > 100_000:
            raise ValueError("Data cannot exceed 100,000 rows")
        # Ensure all rows have consistent keys
        first_keys = set(v[0].keys())
        for i, row in enumerate(v[:10]):  # Check first 10 for speed
            if set(row.keys()) != first_keys:
                raise ValueError(
                    f"Row {i} has inconsistent columns. "
                    f"Expected {sorted(first_keys)}, got {sorted(row.keys())}"
                )
        return v


# OUTPUT MODELS

class ChartSuggestion(BaseModel):
    """A suggested chart for visualising the data."""
    chart_type: str = Field(..., max_length=50)
    title: str = Field(..., max_length=200)
    x_column: Optional[str] = None
    y_columns: List[str] = Field(default_factory=list)
    description: Optional[str] = Field(default=None, max_length=500)


class DataAnalysisReport(BaseModel):
    """Complete data analysis output."""
    question: str
    answer: str = Field(..., min_length=1)
    data_summary: Dict[str, Any] = Field(default_factory=dict)
    insights: List[str] = Field(default_factory=list)
    charts: List[ChartSuggestion] = Field(default_factory=list)
    sql_queries: List[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    row_count: int = Field(default=0, ge=0)
    column_count: int = Field(default=0, ge=0)
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# DATA ANALYST AGENT


@register_agent(
    "data_analyst",
    version="2.0",
    capabilities=["data_analysis", "chart_suggestion", "sql_generation", "statistics"],
    timeout_seconds=180,
)
class DataAnalystAgent(BaseAgentV2):
    """
    Production-grade data analyst agent.

    Features:
    - Local column-level statistics from FULL dataset
    - Stratified sampling for LLM context efficiency
    - Chart generation suggestions with column mappings
    - SQL query recommendations
    - Confidence scoring
    """

    async def execute(
        self,
        question: str,
        data: List[Dict[str, Any]],
        data_description: Optional[str] = None,
        generate_charts: bool = True,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[DataAnalysisReport, Dict[str, Any]]:
        """Execute data analysis.

        Returns:
            Tuple of (DataAnalysisReport, metadata dict).
        """
        # Validate input
        try:
            validated = DataAnalystInput(
                question=question,
                data=data,
                data_description=data_description,
                generate_charts=generate_charts,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        total_steps = 2
        total_input_tokens = 0
        total_output_tokens = 0

        def report_progress(percent: int, message: str, step: str, step_num: int):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=total_steps,
                    current_step_num=step_num,
                ))

        try:
            # Step 1: Compute local statistics
            report_progress(10, "Computing dataset statistics...", "statistics", 1)

            columns = list(validated.data[0].keys())
            full_stats = self._compute_column_stats(validated.data, columns)
            sample = self._stratified_sample(validated.data, sample_size=30)
            stats_summary = json.dumps(full_stats, indent=2, default=str)
            data_sample = json.dumps(sample, indent=2, default=str)

            report_progress(30, "Statistics computed, analysing data...", "analysis", 2)

            # Step 2: LLM analysis
            system_prompt = f"""You are an expert data analyst. Reason about which statistical approaches are most relevant for the question asked. Focus on what matters — don't mechanically report all metrics.

Data Description: {validated.data_description or 'Not provided'}
Columns: {', '.join(columns)}
Total rows: {len(validated.data)}

The statistics below are computed from the FULL dataset, not just the sample.
Column Statistics (full dataset):
{stats_summary}

Provide your response as JSON:
{{
    "answer": "<direct answer to the question>",
    "data_summary": {{"key metrics": "..."}},
    "insights": ["<insight 1>", "<insight 2>"],
    "charts": [{{"chart_type": "<bar|line|scatter|pie|histogram>", "title": "<title>", "x_column": "<col>", "y_columns": ["<col>"], "description": "<why this chart>"}}],
    "sql_queries": ["<SQL query that would answer this>"],
    "confidence": <0.0-1.0>
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Data sample (stratified from full dataset):\n{data_sample}\n\nQuestion: {validated.question}",
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            total_input_tokens += result["input_tokens"]
            total_output_tokens += result["output_tokens"]
            parsed = result["parsed"]

            report_progress(90, "Compiling report...", "analysis", 2)

            charts = []
            if validated.generate_charts:
                for c in parsed.get("charts", []):
                    try:
                        charts.append(ChartSuggestion(
                            chart_type=c.get("chart_type", "bar"),
                            title=c.get("title", "Chart"),
                            x_column=c.get("x_column"),
                            y_columns=c.get("y_columns", []),
                            description=c.get("description"),
                        ))
                    except Exception:
                        pass  # Skip malformed chart suggestions

            report = DataAnalysisReport(
                question=validated.question,
                answer=parsed.get("answer", "Unable to analyse data"),
                data_summary=parsed.get("data_summary", {}),
                insights=parsed.get("insights", []),
                charts=charts,
                sql_queries=parsed.get("sql_queries", []),
                confidence=min(1.0, max(0.0, parsed.get("confidence", 0.5))),
                row_count=len(validated.data),
                column_count=len(columns),
            )

            cost_cents = self._estimate_cost_cents(total_input_tokens, total_output_tokens)
            metadata = {
                "tokens_input": total_input_tokens,
                "tokens_output": total_output_tokens,
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Analysis complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str:
                raise LLMContentFilterError(str(e))
            raise AgentError(str(e), code="DATA_ANALYSIS_FAILED", retryable=True)

    # ----- local statistics helpers (never sent to LLM, computed locally) -----

    def _compute_column_stats(
        self, data: List[Dict[str, Any]], columns: List[str]
    ) -> Dict[str, Any]:
        """Compute summary statistics for all columns in the dataset."""
        stats: Dict[str, Any] = {}
        for col in columns:
            values = [row.get(col) for row in data if row.get(col) is not None]
            if not values:
                stats[col] = {"type": "empty", "count": 0}
                continue

            numeric_values: List[float] = []
            for v in values:
                try:
                    numeric_values.append(float(v))
                except (ValueError, TypeError):
                    pass

            if len(numeric_values) > len(values) * 0.5:
                stats[col] = {
                    "type": "numeric",
                    "count": len(numeric_values),
                    "min": min(numeric_values),
                    "max": max(numeric_values),
                    "mean": round(statistics.mean(numeric_values), 2),
                    "median": round(statistics.median(numeric_values), 2),
                    "std": round(statistics.stdev(numeric_values), 2) if len(numeric_values) > 1 else 0,
                }
            else:
                value_counts = Counter(str(v) for v in values)
                top_values = value_counts.most_common(5)
                stats[col] = {
                    "type": "categorical",
                    "count": len(values),
                    "unique": len(value_counts),
                    "top_values": [{"value": v, "count": c} for v, c in top_values],
                }
        return stats

    def _stratified_sample(
        self, data: List[Dict[str, Any]], sample_size: int = 50
    ) -> List[Dict[str, Any]]:
        """Get a stratified sample from beginning, middle, and end."""
        if len(data) <= sample_size:
            return data

        n = len(data)
        indices: set[int] = set()
        indices.update(range(min(10, n)))
        indices.update(range(max(0, n - 10), n))

        remaining = sample_size - len(indices)
        if remaining > 0:
            step = max(1, n // remaining)
            for i in range(0, n, step):
                indices.add(i)
                if len(indices) >= sample_size:
                    break

        return [data[i] for i in sorted(indices)][:sample_size]


"""
Data Mapping Agent — suggests intelligent column-to-token mappings
from spreadsheet data to template schemas.

Local: exact/fuzzy string matching for obvious mappings.
LLM: contextual matching for ambiguous columns, derived column suggestions.
"""


logger = logging.getLogger("neura.agents.data_mapping")


# INPUT / OUTPUT

class DataMappingInput(BaseModel):
    columns: List[str] = Field(..., min_length=1)
    sample_rows: Optional[List[Dict[str, Any]]] = Field(default=None)
    schema_tokens: List[str] = Field(..., min_length=1)
    hints: Optional[Dict[str, str]] = Field(default=None)

    @field_validator("columns")
    @classmethod
    def validate_columns(cls, v: List[str]) -> List[str]:
        cleaned = [c.strip() for c in v if c.strip()]
        if not cleaned:
            raise ValueError("At least one column header is required")
        return cleaned

    @field_validator("schema_tokens")
    @classmethod
    def validate_tokens(cls, v: List[str]) -> List[str]:
        cleaned = [t.strip() for t in v if t.strip()]
        if not cleaned:
            raise ValueError("At least one schema token is required")
        return cleaned


class MappingProposal(BaseModel):
    column: str
    token: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    reason: str = Field(default="")


class DerivedColumnSuggestion(BaseModel):
    name: str
    expression: str
    description: str = ""


class DataMappingReport(BaseModel):
    mappings: List[MappingProposal] = Field(default_factory=list)
    unmapped_columns: List[str] = Field(default_factory=list)
    unmapped_tokens: List[str] = Field(default_factory=list)
    derived_suggestions: List[DerivedColumnSuggestion] = Field(default_factory=list)
    coverage_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "data_mapping",
    version="1.0",
    capabilities=["column_mapping", "schema_matching", "derived_columns"],
    timeout_seconds=120,
)
class DataMappingAgent(BaseAgentV2):
    """Suggests intelligent column-to-token mappings from data to template schemas."""

    async def execute(
        self,
        columns: List[str],
        schema_tokens: List[str],
        sample_rows: Optional[List[Dict[str, Any]]] = None,
        hints: Optional[Dict[str, str]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[DataMappingReport, Dict[str, Any]]:
        try:
            validated = DataMappingInput(
                columns=columns,
                schema_tokens=schema_tokens,
                sample_rows=sample_rows,
                hints=hints,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=2, current_step_num=n))

        try:
            progress(10, "Analyzing columns and tokens...", "analysis", 1)

            # Build sample data preview
            sample_preview = ""
            if validated.sample_rows:
                rows = validated.sample_rows[:5]
                sample_preview = "\n\nSample data (first 5 rows):\n"
                for i, row in enumerate(rows):
                    sample_preview += f"  Row {i+1}: {dict(list(row.items())[:20])}\n"

            hint_text = ""
            if validated.hints:
                hint_text = f"\n\nUser-provided hints: {validated.hints}"

            system_prompt = """You are a data mapping expert for an industrial report generation system. Map spreadsheet columns to template schema tokens.

Consider: column names, sample data types/values, domain knowledge (industrial sensors, batch processing, water treatment), and any hints provided.

Return JSON only:
{
    "mappings": [
        {"column": "Column Name", "token": "schema_token", "confidence": 0.95, "reason": "why this mapping"}
    ],
    "unmapped_columns": ["columns with no good match"],
    "unmapped_tokens": ["tokens with no column match"],
    "derived_suggestions": [
        {"name": "derived_col", "expression": "col_a - col_b", "description": "what this computes"}
    ]
}"""

            progress(30, "Generating mapping proposals...", "mapping", 2)

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Columns: {validated.columns}\n\nSchema tokens: {validated.schema_tokens}{sample_preview}{hint_text}",
                max_tokens=3000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(80, "Compiling results...", "mapping", 2)

            mappings = []
            for m in parsed.get("mappings", []):
                try:
                    mappings.append(MappingProposal(
                        column=m.get("column", ""),
                        token=m.get("token", ""),
                        confidence=m.get("confidence", 0.5),
                        reason=m.get("reason", ""),
                    ))
                except Exception:
                    pass

            derived = []
            for d in parsed.get("derived_suggestions", []):
                try:
                    derived.append(DerivedColumnSuggestion(
                        name=d.get("name", ""),
                        expression=d.get("expression", ""),
                        description=d.get("description", ""),
                    ))
                except Exception:
                    pass

            mapped_tokens = {m.token for m in mappings}
            coverage = round(len(mapped_tokens) / max(len(validated.schema_tokens), 1) * 100, 1)

            # Post-LLM validation: validate mapping against real schema if possible
            validation_passed = True
            validation_attempts = 0
            try:
                from backend.app.services.infra_services import validate_mapping_inline_v4

                # Build a mapping payload compatible with validate_mapping_inline_v4
                mapping_payload = {
                    "mapping": {m.token: m.column for m in mappings},
                    "tokens": {
                        "scalars": [],
                        "row_tokens": [m.token for m in mappings],
                        "totals": [],
                    },
                }

                max_validation_retries = 3
                for attempt in range(max_validation_retries):
                    validation_attempts = attempt + 1
                    try:
                        validate_mapping_inline_v4(mapping_payload)
                        logger.info(f"Mapping validation passed on attempt {attempt + 1}")
                        break
                    except Exception as val_err:
                        validation_passed = False
                        if attempt < max_validation_retries - 1:
                            # Ask LLM to fix the validation error
                            progress(85 + attempt * 3, f"Fixing validation error (attempt {attempt + 2})...", "validation", 2)
                            fix_result = await self._call_llm(
                                system_prompt="Fix the mapping validation error. Return the corrected mapping JSON only.",
                                user_prompt=(
                                    f"Validation error: {val_err}\n\n"
                                    f"Current mapping payload: {mapping_payload}\n\n"
                                    f"Columns available: {validated.columns}\n"
                                    f"Schema tokens: {validated.schema_tokens}\n\n"
                                    "Return JSON: {{\"mapping\": {{\"token\": \"column\", ...}}}}"
                                ),
                                max_tokens=2000,
                                timeout_seconds=30,
                                temperature=0.2,
                            )
                            fix_parsed = fix_result["parsed"]
                            if fix_parsed.get("mapping"):
                                mapping_payload["mapping"] = fix_parsed["mapping"]
                                # Rebuild mappings list from fixed payload
                                mappings = [
                                    MappingProposal(column=col, token=tok, confidence=0.7, reason="LLM-corrected")
                                    for tok, col in fix_parsed["mapping"].items()
                                ]
                                validation_passed = True
                        else:
                            logger.warning(f"Mapping validation failed after {max_validation_retries} attempts: {val_err}")
            except ImportError:
                logger.debug("validate_mapping_inline_v4 not available, skipping validation")

            mapped_tokens = {m.token for m in mappings}
            coverage = round(len(mapped_tokens) / max(len(validated.schema_tokens), 1) * 100, 1)

            report = DataMappingReport(
                mappings=mappings,
                unmapped_columns=parsed.get("unmapped_columns", []),
                unmapped_tokens=parsed.get("unmapped_tokens", []),
                derived_suggestions=derived,
                coverage_pct=coverage,
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
                "validation_passed": validation_passed,
                "validation_attempts": validation_attempts,
            }

            progress(100, "Data mapping complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="DATA_MAPPING_FAILED", retryable=True)


"""
Data Quality Agent — assesses data completeness, accuracy,
consistency, and validity.

Local: null rates, duplicate counts, type consistency, range validation.
LLM: interprets quality issues and suggests remediation.
"""


logger = logging.getLogger("neura.agents.data_quality")


# INPUT / OUTPUT

class DataQualityInput(BaseModel):
    data: List[Dict[str, Any]] = Field(..., min_length=1)
    expected_columns: Optional[List[str]] = Field(default=None)
    data_description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("data")
    @classmethod
    def validate_data(cls, v):
        if len(v) > 100_000:
            raise ValueError("Data exceeds 100,000 row limit")
        return v


class QualityIssue(BaseModel):
    dimension: str = Field(default="", max_length=30)  # completeness, consistency, validity, uniqueness
    column: str = Field(default="", max_length=100)
    severity: str = Field(default="warning", max_length=20)
    description: str = Field(default="", max_length=500)
    affected_rows: int = 0
    suggestion: str = Field(default="", max_length=500)


class DataQualityReport(BaseModel):
    overall_score: float = Field(default=0.0, ge=0.0, le=100.0)
    completeness_score: float = Field(default=0.0, ge=0.0, le=100.0)
    consistency_score: float = Field(default=0.0, ge=0.0, le=100.0)
    validity_score: float = Field(default=0.0, ge=0.0, le=100.0)
    uniqueness_score: float = Field(default=0.0, ge=0.0, le=100.0)
    issues: List[QualityIssue] = Field(default_factory=list)
    column_profiles: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    summary: str = ""
    recommendations: List[str] = Field(default_factory=list)
    total_rows: int = 0
    total_columns: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "data_quality",
    version="1.0",
    capabilities=["data_quality", "completeness_check", "consistency_validation"],
    timeout_seconds=180,
)
class DataQualityAgent(BaseAgentV2):
    """Assesses data completeness, consistency, validity, and uniqueness."""

    async def execute(
        self,
        data: List[Dict[str, Any]],
        expected_columns: Optional[List[str]] = None,
        data_description: Optional[str] = None,
        contract: Optional[Dict[str, Any]] = None,
        db_path: Optional[str] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[DataQualityReport, Dict[str, Any]]:
        try:
            validated = DataQualityInput(
                data=data, expected_columns=expected_columns,
                data_description=data_description,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=3, current_step_num=n))

        try:
            # Step 1: Local profiling
            progress(10, "Profiling data...", "profile", 1)
            profiles = self._profile_columns(validated.data)
            local_issues = self._detect_local_issues(validated.data, profiles, validated.expected_columns)

            # Compute dimension scores locally
            completeness = self._score_completeness(profiles)
            consistency = self._score_consistency(profiles)
            validity = self._score_validity(profiles)
            uniqueness = self._score_uniqueness(validated.data, profiles)

            # Optional: Contract dry-run validation
            dry_run_issues = []
            if contract and db_path:
                progress(25, "Running contract dry-run...", "dry_run", 1)
                try:
                    from backend.app.services.contract_builder import run_contract_dry_run
                    from backend.app.services.legacy_services import get_loader_for_ref

                    loader = get_loader_for_ref(db_path)
                    dr = run_contract_dry_run(contract, loader)
                    if not dr.success:
                        for issue in dr.issues:
                            sev = "major" if issue.severity == "error" else "minor"
                            dry_run_issues.append({
                                "dimension": "validity",
                                "column": getattr(issue, "token", ""),
                                "severity": sev,
                                "description": f"Contract dry-run: {issue.message}",
                                "affected_rows": 0,
                                "suggestion": "Check contract mapping and column references",
                            })
                        # Adjust validity score based on dry-run
                        if dr.issues:
                            error_count = sum(1 for i in dr.issues if i.severity == "error")
                            penalty = min(error_count * 10, 50)
                            validity = max(0, validity - penalty)
                    else:
                        logger.info(f"Contract dry-run passed: {dr.row_count} rows resolved")
                except ImportError:
                    logger.debug("contract_dry_run not available, skipping")
                except Exception as exc:
                    logger.debug(f"Contract dry-run failed: {exc}")
                    dry_run_issues.append({
                        "dimension": "validity",
                        "column": "",
                        "severity": "major",
                        "description": f"Contract dry-run error: {str(exc)[:200]}",
                        "affected_rows": 0,
                        "suggestion": "Review contract configuration",
                    })

            local_issues.extend(dry_run_issues)

            # Step 2: LLM analysis
            progress(40, "Analyzing quality patterns...", "analysis", 2)

            profile_summary = []
            for col, p in profiles.items():
                profile_summary.append(
                    f"  {col}: type={p['dominant_type']}, nulls={p['null_count']}/{p['total']}"
                    f" ({p['null_pct']:.1f}%), unique={p['unique_count']}, sample={p['sample_values'][:3]}"
                )

            issue_summary = [f"  {i['dimension']}: {i['description']} ({i['affected_rows']} rows)" for i in local_issues[:20]]

            desc = f"\nContext: {validated.data_description}" if validated.data_description else ""

            system_prompt = f"""You are a data quality expert. Analyze the data quality profile and provide actionable insights.

Dimension scores (computed): completeness={completeness:.0f}, consistency={consistency:.0f}, validity={validity:.0f}, uniqueness={uniqueness:.0f}{desc}

Return JSON only:
{{
    "summary": "Overall data quality assessment",
    "additional_issues": [
        {{"dimension": "completeness|consistency|validity|uniqueness", "column": "col", "severity": "critical|major|minor", "description": "...", "suggestion": "..."}}
    ],
    "recommendations": ["recommendation 1", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Rows: {len(validated.data)}, Columns: {list(profiles.keys())}\n\nColumn Profiles:\n{''.join(profile_summary)}\n\nDetected Issues ({len(local_issues)}):\n{''.join(issue_summary) if issue_summary else '  None'}",
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(80, "Compiling report...", "compile", 3)

            # Merge issues
            issues = [QualityIssue(**i) for i in local_issues]
            for ai in parsed.get("additional_issues", []):
                try:
                    issues.append(QualityIssue(
                        dimension=ai.get("dimension", ""),
                        column=ai.get("column", ""),
                        severity=ai.get("severity", "minor"),
                        description=ai.get("description", ""),
                        suggestion=ai.get("suggestion", ""),
                    ))
                except Exception:
                    pass

            overall = round((completeness + consistency + validity + uniqueness) / 4, 1)

            report = DataQualityReport(
                overall_score=overall,
                completeness_score=round(completeness, 1),
                consistency_score=round(consistency, 1),
                validity_score=round(validity, 1),
                uniqueness_score=round(uniqueness, 1),
                issues=issues,
                column_profiles=profiles,
                summary=parsed.get("summary", f"Data quality score: {overall}/100"),
                recommendations=parsed.get("recommendations", []),
                total_rows=len(validated.data),
                total_columns=len(profiles),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Data quality check complete", "done", 3)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="DATA_QUALITY_FAILED", retryable=True)

    # ----- Local computations -----

    def _profile_columns(self, data: List[Dict]) -> Dict[str, Dict]:
        if not data:
            return {}
        all_cols = set()
        for row in data:
            all_cols.update(row.keys())
        profiles = {}
        for col in sorted(all_cols):
            values = [row.get(col) for row in data]
            total = len(values)
            null_count = sum(1 for v in values if v is None or (isinstance(v, str) and v.strip() == ""))
            non_null = [v for v in values if v is not None and not (isinstance(v, str) and v.strip() == "")]
            types = Counter(type(v).__name__ for v in non_null)
            dominant_type = types.most_common(1)[0][0] if types else "null"
            unique_vals = set(str(v) for v in non_null)
            profiles[col] = {
                "total": total, "null_count": null_count,
                "null_pct": (null_count / max(total, 1)) * 100,
                "unique_count": len(unique_vals),
                "dominant_type": dominant_type,
                "type_counts": dict(types),
                "sample_values": [str(v) for v in non_null[:5]],
            }
        return profiles

    def _detect_local_issues(self, data: List[Dict], profiles: Dict, expected: Optional[List[str]]) -> List[Dict]:
        issues = []
        # Missing expected columns
        if expected:
            actual = set(profiles.keys())
            for col in expected:
                if col not in actual:
                    issues.append({
                        "dimension": "completeness", "column": col,
                        "severity": "major", "description": f"Expected column '{col}' not found",
                        "affected_rows": len(data), "suggestion": f"Add column '{col}' to the dataset",
                    })
        # High null rates
        for col, p in profiles.items():
            if p["null_pct"] > 50:
                issues.append({
                    "dimension": "completeness", "column": col,
                    "severity": "major" if p["null_pct"] > 80 else "minor",
                    "description": f"{p['null_pct']:.0f}% null values",
                    "affected_rows": p["null_count"],
                    "suggestion": "Investigate missing data source or apply imputation",
                })
            # Mixed types
            if len(p["type_counts"]) > 1:
                issues.append({
                    "dimension": "consistency", "column": col,
                    "severity": "minor",
                    "description": f"Mixed types: {p['type_counts']}",
                    "affected_rows": sum(v for k, v in p["type_counts"].items() if k != p["dominant_type"]),
                    "suggestion": "Standardize column type",
                })
        return issues

    def _score_completeness(self, profiles: Dict) -> float:
        if not profiles:
            return 100.0
        avg_fill = sum(100 - p["null_pct"] for p in profiles.values()) / len(profiles)
        return avg_fill

    def _score_consistency(self, profiles: Dict) -> float:
        if not profiles:
            return 100.0
        consistent = sum(1 for p in profiles.values() if len(p["type_counts"]) <= 1)
        return (consistent / len(profiles)) * 100

    def _score_validity(self, profiles: Dict) -> float:
        # Simple: columns with reasonable non-null rates
        if not profiles:
            return 100.0
        valid = sum(1 for p in profiles.values() if p["null_pct"] < 90)
        return (valid / len(profiles)) * 100

    def _score_uniqueness(self, data: List[Dict], profiles: Dict) -> float:
        if not data:
            return 100.0
        # Check for full row duplicates
        seen = set()
        dupes = 0
        for row in data:
            key = tuple(sorted(str(v) for v in row.values()))
            if key in seen:
                dupes += 1
            seen.add(key)
        return max(0, (1 - dupes / len(data)) * 100)


"""
Anomaly Detection Agent — finds outliers and anomalies in tabular data.

Critical for industrial monitoring: sensor readings, batch weights, water quality.

Local: IQR-based outlier detection, z-scores, null/duplicate stats.
LLM: contextual interpretation of why anomalies matter.
"""

import math
from typing import Any, Dict, List, Literal, Optional


logger = logging.getLogger("neura.agents.anomaly_detection")

MAX_ROWS = 50_000


# INPUT / OUTPUT

class AnomalyDetectionInput(BaseModel):
    data: List[Dict[str, Any]] = Field(..., min_length=3)
    target_columns: Optional[List[str]] = Field(default=None)
    sensitivity: Literal["low", "medium", "high"] = "medium"
    data_description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("data")
    @classmethod
    def validate_data(cls, v):
        if len(v) > MAX_ROWS:
            raise ValueError(f"Data exceeds max {MAX_ROWS} rows")
        if len(v) < 3:
            raise ValueError("Need at least 3 rows for anomaly detection")
        return v


class AnomalyItem(BaseModel):
    row_index: int
    column: str
    value: Any
    expected_range: str = ""
    severity: str = Field(default="warning", max_length=20)
    explanation: str = Field(default="", max_length=300)


class AnomalyReport(BaseModel):
    total_rows: int = 0
    total_anomalies: int = 0
    anomalies: List[AnomalyItem] = Field(default_factory=list)
    column_stats: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    summary: str = ""
    recommendations: List[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "anomaly_detection",
    version="1.0",
    capabilities=["anomaly_detection", "outlier_analysis", "data_monitoring"],
    timeout_seconds=180,
)
class AnomalyDetectionAgent(BaseAgentV2):
    """Finds outliers and anomalies in tabular data using statistics + LLM interpretation."""

    IQR_MULTIPLIERS = {"low": 3.0, "medium": 1.5, "high": 1.0}

    async def execute(
        self,
        data: List[Dict[str, Any]],
        target_columns: Optional[List[str]] = None,
        sensitivity: str = "medium",
        data_description: Optional[str] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[AnomalyReport, Dict[str, Any]]:
        try:
            validated = AnomalyDetectionInput(
                data=data, target_columns=target_columns,
                sensitivity=sensitivity, data_description=data_description,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=3, current_step_num=n))

        try:
            # Step 1: Local statistical analysis
            progress(10, "Computing statistics...", "stats", 1)
            columns = self._get_numeric_columns(validated.data, validated.target_columns)
            stats = self._compute_stats(validated.data, columns)
            outliers = self._detect_outliers(validated.data, columns, stats, validated.sensitivity)

            # Step 2: LLM interpretation
            progress(40, "Interpreting anomalies...", "interpret", 2)

            outlier_preview = []
            for o in outliers[:30]:
                outlier_preview.append(f"Row {o['row']}, {o['col']}: {o['value']} (expected {o['range']})")

            stats_summary = []
            for col, s in stats.items():
                stats_summary.append(f"  {col}: mean={s['mean']:.2f}, std={s['std']:.2f}, min={s['min']}, max={s['max']}, nulls={s['nulls']}")

            desc = f"\nData description: {validated.data_description}" if validated.data_description else ""

            system_prompt = """You are a data quality expert for industrial monitoring systems. Analyze the detected anomalies and provide context.

Return JSON only:
{
    "summary": "Brief assessment of data quality and anomalies found",
    "anomaly_details": [
        {"row_index": 0, "column": "col", "severity": "error|warning|info", "explanation": "why this is anomalous"}
    ],
    "recommendations": ["actionable recommendation 1", ...]
}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Rows: {len(validated.data)}, Columns analyzed: {columns}{desc}\n\nColumn Statistics:\n{''.join(stats_summary)}\n\nDetected outliers ({len(outliers)} total, showing first 30):\n" + "\n".join(outlier_preview),
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(80, "Compiling report...", "compile", 3)

            # Build anomaly items
            anomaly_items = []
            llm_details = {(d.get("row_index"), d.get("column")): d for d in parsed.get("anomaly_details", []) if isinstance(d, dict)}

            for o in outliers[:100]:
                key = (o["row"], o["col"])
                detail = llm_details.get(key, {})
                anomaly_items.append(AnomalyItem(
                    row_index=o["row"],
                    column=o["col"],
                    value=o["value"],
                    expected_range=o["range"],
                    severity=detail.get("severity", "warning"),
                    explanation=detail.get("explanation", f"Value {o['value']} outside expected range {o['range']}"),
                ))

            report = AnomalyReport(
                total_rows=len(validated.data),
                total_anomalies=len(outliers),
                anomalies=anomaly_items,
                column_stats=stats,
                summary=parsed.get("summary", f"Found {len(outliers)} anomalies across {len(columns)} columns"),
                recommendations=parsed.get("recommendations", []),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Anomaly detection complete", "done", 3)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="ANOMALY_DETECTION_FAILED", retryable=True)

    # ----- Local computations -----

    def _get_numeric_columns(self, data: List[Dict], targets: Optional[List[str]]) -> List[str]:
        if not data:
            return []
        all_cols = list(data[0].keys())
        if targets:
            all_cols = [c for c in all_cols if c in targets]
        numeric = []
        for col in all_cols:
            nums = 0
            for row in data[:50]:
                v = row.get(col)
                if v is not None:
                    try:
                        float(v)
                        nums += 1
                    except (ValueError, TypeError):
                        pass
            if nums > len(data[:50]) * 0.5:
                numeric.append(col)
        return numeric

    def _compute_stats(self, data: List[Dict], columns: List[str]) -> Dict[str, Dict]:
        stats = {}
        for col in columns:
            values = []
            nulls = 0
            for row in data:
                v = row.get(col)
                if v is None or (isinstance(v, str) and v.strip() == ""):
                    nulls += 1
                    continue
                try:
                    values.append(float(v))
                except (ValueError, TypeError):
                    nulls += 1
            if not values:
                continue
            values.sort()
            n = len(values)
            mean = sum(values) / n
            variance = sum((x - mean) ** 2 for x in values) / max(n - 1, 1)
            std = math.sqrt(variance)
            q1 = values[n // 4] if n >= 4 else values[0]
            q3 = values[3 * n // 4] if n >= 4 else values[-1]
            iqr = q3 - q1
            stats[col] = {
                "mean": round(mean, 4), "std": round(std, 4),
                "min": values[0], "max": values[-1],
                "q1": q1, "q3": q3, "iqr": round(iqr, 4),
                "nulls": nulls, "count": n,
            }
        return stats

    def _detect_outliers(self, data: List[Dict], columns: List[str], stats: Dict, sensitivity: str) -> List[Dict]:
        mult = self.IQR_MULTIPLIERS.get(sensitivity, 1.5)
        outliers = []
        for col in columns:
            s = stats.get(col)
            if not s or s["iqr"] == 0:
                continue
            lower = s["q1"] - mult * s["iqr"]
            upper = s["q3"] + mult * s["iqr"]
            for i, row in enumerate(data):
                v = row.get(col)
                if v is None:
                    continue
                try:
                    fv = float(v)
                    if fv < lower or fv > upper:
                        outliers.append({
                            "row": i, "col": col, "value": fv,
                            "range": f"{lower:.2f} – {upper:.2f}",
                        })
                except (ValueError, TypeError):
                    pass
        return outliers


"""
SQL Query Agent — generates, explains, and optimizes SQL queries
from natural language questions.

Safety: SELECT-only by default, warns on performance issues.
"""


logger = logging.getLogger("neura.agents.sql_query")


# INPUT / OUTPUT

class TableSchema(BaseModel):
    name: str = Field(..., min_length=1)
    columns: List[Dict[str, str]] = Field(default_factory=list)
    row_count: Optional[int] = None


class SQLQueryInput(BaseModel):
    question: str = Field(..., min_length=5, max_length=2000)
    tables: List[TableSchema] = Field(..., min_length=1)
    dialect: Literal["sqlite", "postgres", "mysql"] = "sqlite"
    allow_writes: bool = False

    @field_validator("question")
    @classmethod
    def validate_question(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty")
        return v


class SQLQueryResult(BaseModel):
    sql: str = Field(default="")
    explanation: str = Field(default="")
    complexity: str = Field(default="simple", max_length=20)
    safety_warnings: List[str] = Field(default_factory=list)
    optimization_tips: List[str] = Field(default_factory=list)
    tables_used: List[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "sql_query",
    version="1.0",
    capabilities=["nl2sql", "query_explanation", "query_optimization"],
    timeout_seconds=120,
)
class SQLQueryAgent(BaseAgentV2):
    """Generates and explains SQL queries from natural language questions."""

    DANGEROUS_KEYWORDS = {"drop", "delete", "truncate", "alter", "create", "insert", "update", "grant", "revoke"}

    async def execute(
        self,
        question: str,
        tables: List[Dict[str, Any]],
        dialect: str = "sqlite",
        allow_writes: bool = False,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[SQLQueryResult, Dict[str, Any]]:
        try:
            table_schemas = [TableSchema(**t) if isinstance(t, dict) else t for t in tables]
            validated = SQLQueryInput(
                question=question, tables=table_schemas,
                dialect=dialect, allow_writes=allow_writes,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=1, current_step_num=n))

        try:
            progress(10, "Generating SQL query...", "generate", 1)

            schema_desc = []
            for t in validated.tables:
                cols = ", ".join(f"{c.get('name', '?')} ({c.get('type', '?')})" for c in t.columns)
                row_info = f", ~{t.row_count} rows" if t.row_count else ""
                schema_desc.append(f"  {t.name}: [{cols}]{row_info}")

            write_policy = "SELECT queries only. Do NOT generate INSERT, UPDATE, DELETE, DROP, or any write operations." if not validated.allow_writes else "Write operations are allowed if needed."

            system_prompt = f"""You are a SQL expert. Generate a {validated.dialect.upper()} query to answer the user's question.

{write_policy}

Available tables:
{"".join(schema_desc)}

Return JSON only:
{{
    "sql": "SELECT ...",
    "explanation": "What this query does and why",
    "complexity": "simple|moderate|complex",
    "safety_warnings": ["warning if any"],
    "optimization_tips": ["tip if any"],
    "tables_used": ["table1", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=validated.question,
                max_tokens=1500,
                timeout_seconds=timeout_seconds,
                temperature=0.2,
            )

            parsed = result["parsed"]
            progress(80, "Validating query...", "generate", 1)

            sql = parsed.get("sql", "")
            warnings = list(parsed.get("safety_warnings", []))

            # Safety check
            if sql and not validated.allow_writes:
                sql_lower = sql.lower()
                for kw in self.DANGEROUS_KEYWORDS:
                    if re.search(rf"\b{kw}\b", sql_lower):
                        warnings.append(f"Query contains '{kw.upper()}' but write operations are disabled")
                        sql = f"-- BLOCKED: contains {kw.upper()}\n-- {sql}"
                        break

            # Warn on common performance issues
            if sql:
                sql_lower = sql.lower()
                if "select *" in sql_lower:
                    warnings.append("SELECT * may return unnecessary columns; consider specifying columns")
                if "cross join" in sql_lower or ("," in sql_lower and "where" not in sql_lower):
                    warnings.append("Possible cartesian join detected — verify join conditions")

            query_result = SQLQueryResult(
                sql=sql,
                explanation=parsed.get("explanation", ""),
                complexity=parsed.get("complexity", "simple"),
                safety_warnings=warnings,
                optimization_tips=parsed.get("optimization_tips", []),
                tables_used=parsed.get("tables_used", []),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Query generated", "done", 1)
            return query_result, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="SQL_QUERY_FAILED", retryable=True)

# CONTENT AGENTS (merged from content_agents.py)


logger = logging.getLogger("neura.agents.content_repurpose")


# Supported target formats with generation guidelines
FORMAT_GUIDELINES = {
    "tweet_thread": "Create a Twitter thread (max 280 chars per tweet, 5-10 tweets)",
    "linkedin_post": "Create a LinkedIn post (professional tone, 1300 chars max)",
    "blog_summary": "Create a blog-style summary (300-500 words)",
    "slides": "Create slide content (title + 3-5 bullet points per slide, max 10 slides)",
    "email_newsletter": "Create newsletter content (catchy subject, scannable body)",
    "video_script": "Create a video script (conversational, 2-3 minutes)",
    "infographic": "Create infographic copy (headline, key stats, takeaways)",
    "podcast_notes": "Create podcast show notes (summary, timestamps, links)",
    "press_release": "Create press release format (headline, lead, quotes)",
    "executive_summary": "Create executive summary (1 page, key decisions)",
}

VALID_FORMATS = set(FORMAT_GUIDELINES.keys())
MAX_TARGET_FORMATS = 10


# INPUT VALIDATION

class ContentRepurposeInput(BaseModel):
    """Validated input for content repurposing agent."""
    content: str = Field(..., min_length=20, max_length=50000)
    source_format: str = Field(..., min_length=1, max_length=50)
    target_formats: List[str] = Field(..., min_length=1, max_length=MAX_TARGET_FORMATS)
    preserve_key_points: bool = Field(default=True)
    adapt_length: bool = Field(default=True)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Content cannot be empty or whitespace")
        if len(v.split()) < 5:
            raise ValueError("Content must contain at least 5 words to repurpose")
        return v

    @field_validator("source_format")
    @classmethod
    def validate_source_format(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("target_formats")
    @classmethod
    def validate_target_formats(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("At least one target format is required")
        cleaned = []
        seen: set[str] = set()
        for fmt in v:
            fmt = fmt.strip().lower()
            if fmt and fmt not in seen:
                if fmt not in VALID_FORMATS:
                    raise ValueError(
                        f"Unknown target format: '{fmt}'. "
                        f"Valid formats: {', '.join(sorted(VALID_FORMATS))}"
                    )
                seen.add(fmt)
                cleaned.append(fmt)
        if not cleaned:
            raise ValueError("At least one valid target format is required")
        return cleaned[:MAX_TARGET_FORMATS]


# OUTPUT MODELS

class RepurposedOutput(BaseModel):
    """A single repurposed content version."""
    format: str
    content: str
    word_count: int = Field(default=0, ge=0)
    char_count: int = Field(default=0, ge=0)
    error: Optional[str] = None

    def model_post_init(self, __context):
        if not self.word_count and self.content:
            self.word_count = len(self.content.split())
        if not self.char_count and self.content:
            self.char_count = len(self.content)


class ContentRepurposeReport(BaseModel):
    """Complete content repurposing output."""
    original_format: str
    outputs: List[RepurposedOutput] = Field(default_factory=list)
    adaptations_made: List[str] = Field(default_factory=list)
    formats_requested: int = Field(default=0, ge=0)
    formats_succeeded: int = Field(default=0, ge=0)
    formats_failed: int = Field(default=0, ge=0)
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# CONTENT REPURPOSE AGENT


@register_agent(
    "content_repurpose",
    version="2.0",
    capabilities=["content_adaptation", "multi_format", "summarization"],
    timeout_seconds=600,
)
class ContentRepurposeAgentV2(BaseAgentV2):
    """
    Production-grade content repurposing agent.

    Features:
    - 10 output formats supported
    - Per-format LLM calls (isolation, no cascading failure)
    - Partial success: if some formats fail, others are still returned
    - Per-format progress tracking
    - Aggregated cost tracking
    """

    async def execute(
        self,
        content: str,
        source_format: str,
        target_formats: List[str],
        preserve_key_points: bool = True,
        adapt_length: bool = True,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[ContentRepurposeReport, Dict[str, Any]]:
        """Execute content repurposing.

        Returns:
            Tuple of (ContentRepurposeReport, metadata dict).
        """
        try:
            validated = ContentRepurposeInput(
                content=content,
                source_format=source_format,
                target_formats=target_formats,
                preserve_key_points=preserve_key_points,
                adapt_length=adapt_length,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        total_formats = len(validated.target_formats)
        total_input_tokens = 0
        total_output_tokens = 0
        outputs: List[RepurposedOutput] = []
        adaptations: List[str] = []
        succeeded = 0
        failed = 0

        def report_progress(percent: int, message: str, step: str, step_num: int):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=total_formats,
                    current_step_num=step_num,
                ))

        # Per-format timeout: divide total budget across formats, floor at 120s
        per_format_timeout = max(120, timeout_seconds // total_formats)

        try:
            for i, target_format in enumerate(validated.target_formats):
                step_num = i + 1
                progress_pct = int(10 + (80 * i / total_formats))
                report_progress(
                    progress_pct,
                    f"Converting to {target_format} ({step_num}/{total_formats})...",
                    target_format,
                    step_num,
                )

                guidelines = FORMAT_GUIDELINES.get(
                    target_format, f"Create {target_format} format content"
                )

                system_prompt = f"""You are a content repurposing expert. Adapt your approach based on the source content — different content types require different repurposing strategies.

Transform the following {validated.source_format} into {target_format} format.

Guidelines: {guidelines}
{'Preserve all key points and main ideas.' if validated.preserve_key_points else ''}
{'Adapt the length appropriately for the format.' if validated.adapt_length else ''}

Return ONLY the transformed content, no explanations."""

                try:
                    result = await self._call_llm(
                        system_prompt=system_prompt,
                        user_prompt=validated.content,
                        max_tokens=2000,
                        timeout_seconds=per_format_timeout,
                        temperature=0.7,
                        parse_json=False,
                    )

                    total_input_tokens += result["input_tokens"]
                    total_output_tokens += result["output_tokens"]

                    # For repurpose, we want the raw text output, not parsed JSON
                    transformed = result["raw"]
                    outputs.append(RepurposedOutput(
                        format=target_format,
                        content=transformed,
                    ))
                    adaptations.append(f"Converted to {target_format}")
                    succeeded += 1

                except AgentError as e:
                    # Log but don't abort — partial results are acceptable
                    logger.warning(f"Failed to repurpose to {target_format}: {e.message}")
                    outputs.append(RepurposedOutput(
                        format=target_format,
                        content="",
                        error=e.message,
                    ))
                    failed += 1

            report_progress(95, "Finalising results...", "finalise", total_formats)

            # If ALL formats failed, raise an error
            if failed == total_formats:
                raise AgentError(
                    f"All {total_formats} format conversions failed",
                    code="ALL_FORMATS_FAILED",
                    retryable=True,
                )

            report = ContentRepurposeReport(
                original_format=validated.source_format,
                outputs=outputs,
                adaptations_made=adaptations,
                formats_requested=total_formats,
                formats_succeeded=succeeded,
                formats_failed=failed,
            )

            cost_cents = self._estimate_cost_cents(total_input_tokens, total_output_tokens)
            metadata = {
                "tokens_input": total_input_tokens,
                "tokens_output": total_output_tokens,
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Repurposing complete", "done", total_formats)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str:
                raise LLMContentFilterError(str(e))
            raise AgentError(str(e), code="CONTENT_REPURPOSE_FAILED", retryable=True)


"""
Document Comparison Agent — deep comparison between two documents,
identifying additions, removals, changes, and semantic drift.

Local: word-level diff stats, length comparison.
LLM: semantic analysis of what changed and why it matters.
"""

import difflib


logger = logging.getLogger("neura.agents.document_comparison")

MAX_DOC_LENGTH = 50_000


# INPUT / OUTPUT

class DocumentComparisonInput(BaseModel):
    text_a: str = Field(..., min_length=10, max_length=MAX_DOC_LENGTH)
    text_b: str = Field(..., min_length=10, max_length=MAX_DOC_LENGTH)
    label_a: str = Field(default="Document A", max_length=100)
    label_b: str = Field(default="Document B", max_length=100)
    comparison_type: Literal["structural", "semantic", "data"] = "semantic"

    @field_validator("text_a", "text_b")
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Document text cannot be empty")
        return v


class DocumentChange(BaseModel):
    section: str = Field(default="", max_length=200)
    change_type: str = Field(default="modified", max_length=20)  # added, removed, modified
    before: str = Field(default="", max_length=1000)
    after: str = Field(default="", max_length=1000)
    impact: str = Field(default="low", max_length=20)  # low, medium, high
    explanation: str = Field(default="", max_length=500)


class DocumentComparisonReport(BaseModel):
    similarity_score: float = Field(default=0.0, ge=0.0, le=100.0)
    changes: List[DocumentChange] = Field(default_factory=list)
    additions_count: int = 0
    removals_count: int = 0
    modifications_count: int = 0
    summary: str = ""
    impact_assessment: str = ""
    recommendations: List[str] = Field(default_factory=list)
    word_count_a: int = 0
    word_count_b: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "document_comparison",
    version="1.0",
    capabilities=["document_comparison", "change_detection", "semantic_diff"],
    timeout_seconds=180,
)
class DocumentComparisonAgent(BaseAgentV2):
    """Deep comparison between two documents with semantic change analysis."""

    async def execute(
        self,
        text_a: str,
        text_b: str,
        label_a: str = "Document A",
        label_b: str = "Document B",
        comparison_type: str = "semantic",
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[DocumentComparisonReport, Dict[str, Any]]:
        try:
            validated = DocumentComparisonInput(
                text_a=text_a, text_b=text_b,
                label_a=label_a, label_b=label_b,
                comparison_type=comparison_type,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=2, current_step_num=n))

        try:
            # Step 1: Local diff stats
            progress(10, "Computing differences...", "diff", 1)
            diff_stats = self._compute_diff_stats(validated.text_a, validated.text_b)
            similarity = difflib.SequenceMatcher(None, validated.text_a, validated.text_b).ratio() * 100

            # Step 2: LLM semantic analysis
            progress(30, "Analyzing changes...", "analysis", 2)

            # Truncate for context
            text_a_preview = validated.text_a[:8000]
            text_b_preview = validated.text_b[:8000]

            type_instruction = {
                "structural": "Focus on structural changes: section additions/removals, layout changes, reorganization.",
                "semantic": "Focus on meaning changes: what information was added, removed, or altered.",
                "data": "Focus on data changes: numeric values, dates, quantities, and factual differences.",
            }

            system_prompt = f"""You are a document comparison expert. Compare two versions of a document.

{type_instruction.get(validated.comparison_type, type_instruction['semantic'])}

Local diff stats: {diff_stats}
Similarity: {similarity:.1f}%

Return JSON only:
{{
    "changes": [
        {{"section": "which part", "change_type": "added|removed|modified", "before": "original", "after": "changed to", "impact": "low|medium|high", "explanation": "why this matters"}}
    ],
    "summary": "Overall comparison summary",
    "impact_assessment": "What these changes mean overall",
    "recommendations": ["recommendation 1", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"=== {validated.label_a} ===\n{text_a_preview}\n\n=== {validated.label_b} ===\n{text_b_preview}",
                max_tokens=3000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(85, "Compiling report...", "analysis", 2)

            changes = []
            additions = removals = modifications = 0
            for c in parsed.get("changes", []):
                try:
                    ct = c.get("change_type", "modified")
                    changes.append(DocumentChange(
                        section=c.get("section", ""),
                        change_type=ct,
                        before=c.get("before", ""),
                        after=c.get("after", ""),
                        impact=c.get("impact", "low"),
                        explanation=c.get("explanation", ""),
                    ))
                    if ct == "added":
                        additions += 1
                    elif ct == "removed":
                        removals += 1
                    else:
                        modifications += 1
                except Exception:
                    pass

            report = DocumentComparisonReport(
                similarity_score=round(similarity, 1),
                changes=changes,
                additions_count=additions,
                removals_count=removals,
                modifications_count=modifications,
                summary=parsed.get("summary", ""),
                impact_assessment=parsed.get("impact_assessment", ""),
                recommendations=parsed.get("recommendations", []),
                word_count_a=len(validated.text_a.split()),
                word_count_b=len(validated.text_b.split()),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Comparison complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="DOCUMENT_COMPARISON_FAILED", retryable=True)

    @staticmethod
    def _compute_diff_stats(text_a: str, text_b: str) -> Dict[str, Any]:
        lines_a = text_a.splitlines()
        lines_b = text_b.splitlines()
        diff = list(difflib.unified_diff(lines_a, lines_b, lineterm=""))
        added = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
        return {
            "lines_a": len(lines_a), "lines_b": len(lines_b),
            "lines_added": added, "lines_removed": removed,
            "words_a": len(text_a.split()), "words_b": len(text_b.split()),
        }


"""
Document Summary Agent — generates executive summaries from text,
documents, or images.

Uses GLM-OCR for image/scanned inputs, then LLM for summarization.
"""


logger = logging.getLogger("neura.agents.document_summary")

MAX_TEXT_LENGTH = 80_000


# INPUT / OUTPUT

class DocumentSummaryInput(BaseModel):
    text: Optional[str] = Field(default=None, max_length=MAX_TEXT_LENGTH)
    image_path: Optional[str] = Field(default=None)
    summary_type: Literal["executive", "technical", "brief"] = "executive"
    max_words: int = Field(default=300, ge=50, le=2000)
    focus_areas: Optional[List[str]] = Field(default=None)

    @field_validator("text")
    @classmethod
    def validate_text(cls, v):
        if v is not None:
            v = v.strip()
            if not v:
                return None
        return v


class DocumentSummaryReport(BaseModel):
    summary: str = Field(default="")
    key_points: List[str] = Field(default_factory=list)
    action_items: List[str] = Field(default_factory=list)
    word_count: int = Field(default=0, ge=0)
    source_word_count: int = Field(default=0, ge=0)
    compression_ratio: float = Field(default=0.0)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def model_post_init(self, __context):
        if not self.word_count and self.summary:
            self.word_count = len(self.summary.split())
        if self.source_word_count and self.word_count:
            self.compression_ratio = round(self.word_count / self.source_word_count, 3)


# AGENT

@register_agent(
    "document_summary",
    version="1.0",
    capabilities=["summarization", "key_point_extraction", "action_items"],
    timeout_seconds=180,
)
class DocumentSummaryAgent(BaseAgentV2):
    """Generates executive summaries from text, documents, or images."""

    async def execute(
        self,
        text: Optional[str] = None,
        image_path: Optional[str] = None,
        summary_type: str = "executive",
        max_words: int = 300,
        focus_areas: Optional[List[str]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[DocumentSummaryReport, Dict[str, Any]]:
        try:
            validated = DocumentSummaryInput(
                text=text, image_path=image_path,
                summary_type=summary_type, max_words=max_words,
                focus_areas=focus_areas,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        if not validated.text and not validated.image_path:
            raise ValidationError("Either text or image_path must be provided", field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=2, current_step_num=n))

        try:
            # Step 1: Get text (OCR if needed)
            source_text = validated.text or ""
            if validated.image_path and not source_text:
                progress(10, "Extracting text from image...", "ocr", 1)
                ocr_text = await self._call_ocr(validated.image_path)
                if ocr_text:
                    source_text = ocr_text
                else:
                    raise AgentError("Failed to extract text from image", code="OCR_FAILED", retryable=False)

            source_word_count = len(source_text.split())

            # Step 2: LLM summarization
            progress(30, "Generating summary...", "summarize", 2)

            type_instructions = {
                "executive": "Write an executive summary suitable for senior leadership. Focus on conclusions, impact, and decisions needed.",
                "technical": "Write a technical summary preserving key details, methodologies, data points, and specifications.",
                "brief": "Write a concise brief capturing only the most essential information in as few words as possible.",
            }

            focus_text = ""
            if validated.focus_areas:
                focus_text = f"\nFocus especially on: {', '.join(validated.focus_areas)}"

            system_prompt = f"""{type_instructions.get(validated.summary_type, type_instructions['executive'])}

Target length: approximately {validated.max_words} words.{focus_text}

Return JSON only:
{{
    "summary": "The summary text",
    "key_points": ["key point 1", "key point 2", ...],
    "action_items": ["action item 1", ...]
}}"""

            # Truncate source text to fit token budget
            content = source_text[:30000]

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Summarize this document:\n\n{content}",
                max_tokens=max(validated.max_words * 3, 1000),
                timeout_seconds=timeout_seconds,
                temperature=0.4,
            )

            parsed = result["parsed"]
            progress(90, "Finalizing...", "summarize", 2)

            report = DocumentSummaryReport(
                summary=parsed.get("summary", ""),
                key_points=parsed.get("key_points", []),
                action_items=parsed.get("action_items", []),
                source_word_count=source_word_count,
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Summary complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="DOCUMENT_SUMMARY_FAILED", retryable=True)


"""
Email Draft Agent - Production-grade implementation.

Composes email responses based on context, purpose, tone, recipient info,
and previous email thread context.  Produces structured drafts with subject
lines, follow-up actions, and attachment suggestions.

Design Principles:
- Structured I/O with Pydantic validation
- Thread context is truncated to last 3 emails to stay within token budget
- Tone enforcement via explicit system prompt
- Progress callbacks + cost tracking
"""


logger = logging.getLogger("neura.agents.email_draft")

VALID_TONES = {"professional", "friendly", "formal", "casual", "empathetic", "assertive"}
MAX_THREAD_EMAILS = 3
MAX_THREAD_CHARS = 6000


# INPUT VALIDATION

class EmailDraftInput(BaseModel):
    """Validated input for email draft agent."""
    context: str = Field(..., min_length=5, max_length=5000)
    purpose: str = Field(..., min_length=3, max_length=1000)
    tone: str = Field(default="professional", max_length=30)
    recipient_info: Optional[str] = Field(default=None, max_length=2000)
    previous_emails: Optional[List[str]] = Field(default=None)
    include_subject: bool = Field(default=True)

    @field_validator("context")
    @classmethod
    def validate_context(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Context cannot be empty or whitespace")
        return v

    @field_validator("purpose")
    @classmethod
    def validate_purpose(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Purpose cannot be empty or whitespace")
        return v

    @field_validator("tone")
    @classmethod
    def validate_tone(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in VALID_TONES:
            raise ValueError(
                f"Tone must be one of: {', '.join(sorted(VALID_TONES))}. Got: {v}"
            )
        return v

    @field_validator("previous_emails")
    @classmethod
    def validate_previous_emails(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if not v:
            return v
        # Keep only last N emails and truncate total chars
        truncated = v[-MAX_THREAD_EMAILS:]
        total = 0
        result: List[str] = []
        for email in reversed(truncated):
            if total + len(email) > MAX_THREAD_CHARS:
                break
            result.insert(0, email)
            total += len(email)
        return result


# OUTPUT MODELS

class EmailDraftResult(BaseModel):
    """Complete email draft output."""
    subject: str = Field(default="", max_length=200)
    body: str = Field(..., min_length=1)
    tone: str = Field(default="professional")
    suggested_recipients: List[str] = Field(default_factory=list)
    attachments_suggested: List[str] = Field(default_factory=list)
    follow_up_actions: List[str] = Field(default_factory=list)
    word_count: int = Field(default=0, ge=0)
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def model_post_init(self, __context):
        if not self.word_count:
            self.word_count = len(self.body.split())


# EMAIL DRAFT AGENT


@register_agent(
    "email_draft",
    version="2.0",
    capabilities=["email_composition", "tone_control", "thread_context"],
    timeout_seconds=120,
)
class EmailDraftAgentV2(BaseAgentV2):
    """
    Production-grade email draft agent.

    Features:
    - Tone enforcement (professional, friendly, formal, casual, empathetic, assertive)
    - Thread context with truncation (last 3 emails, max 6000 chars)
    - Recipient context support
    - Follow-up action extraction
    - Attachment suggestions
    """

    async def execute(
        self,
        context: str,
        purpose: str,
        tone: str = "professional",
        recipient_info: Optional[str] = None,
        previous_emails: Optional[List[str]] = None,
        include_subject: bool = True,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[EmailDraftResult, Dict[str, Any]]:
        """Execute email drafting.

        Returns:
            Tuple of (EmailDraftResult, metadata dict).
        """
        try:
            validated = EmailDraftInput(
                context=context,
                purpose=purpose,
                tone=tone,
                recipient_info=recipient_info,
                previous_emails=previous_emails,
                include_subject=include_subject,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def report_progress(percent: int, message: str, step: str, step_num: int):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=1,
                    current_step_num=step_num,
                ))

        try:
            report_progress(10, "Composing email draft...", "drafting", 1)

            previous_context = ""
            if validated.previous_emails:
                previous_context = (
                    "\n\nPrevious emails in thread:\n"
                    + "\n---\n".join(validated.previous_emails)
                )

            recipient_context = ""
            if validated.recipient_info:
                recipient_context = f"\n\nRecipient information: {validated.recipient_info}"

            system_prompt = f"""You are an expert email writer. Draft an email based on the context and purpose provided.

Tone: {validated.tone}
{recipient_context}
{previous_context}

Provide your response as JSON:
{{
    "subject": "<email subject line>",
    "body": "<full email body>",
    "tone": "{validated.tone}",
    "suggested_recipients": ["<email if mentioned>"],
    "attachments_suggested": ["<suggested attachment if relevant>"],
    "follow_up_actions": ["<action items from this email>"]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Context: {validated.context}\n\nPurpose: {validated.purpose}",
                max_tokens=1500,
                timeout_seconds=timeout_seconds,
                temperature=0.7,
            )

            parsed = result["parsed"]

            report_progress(80, "Finalising draft...", "drafting", 1)

            draft = EmailDraftResult(
                subject=parsed.get("subject", "") if validated.include_subject else "",
                body=parsed.get("body", "Unable to generate email draft"),
                tone=parsed.get("tone", validated.tone),
                suggested_recipients=parsed.get("suggested_recipients", []),
                attachments_suggested=parsed.get("attachments_suggested", []),
                follow_up_actions=parsed.get("follow_up_actions", []),
            )

            cost_cents = self._estimate_cost_cents(
                result["input_tokens"], result["output_tokens"]
            )
            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Draft complete", "done", 1)
            return draft, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str:
                raise LLMContentFilterError(str(e))
            raise AgentError(str(e), code="EMAIL_DRAFT_FAILED", retryable=True)


"""
Proofreading Agent - Production-grade implementation.

Comprehensive grammar, style, and clarity checking with support for
style guides (AP, Chicago, APA, MLA), configurable focus areas,
and optional voice preservation.  Returns structured issues with
categories, original text, corrections, and explanations.

Design Principles:
- Structured issue reporting with categorisation
- Readability scoring (local calculation, not LLM-guessed)
- Voice preservation option
- Style guide enforcement
- Progress callbacks + cost tracking
"""


logger = logging.getLogger("neura.agents.proofreading")

VALID_STYLE_GUIDES = {"ap", "chicago", "apa", "mla", "none"}
VALID_FOCUS_AREAS = {
    "grammar", "spelling", "punctuation", "clarity", "conciseness",
    "tone", "consistency", "formatting", "word_choice", "structure",
}
MAX_TEXT_LENGTH = 50000
MAX_FOCUS_AREAS = 5


# INPUT VALIDATION

class ProofreadingInput(BaseModel):
    """Validated input for proofreading agent."""
    text: str = Field(..., min_length=10, max_length=MAX_TEXT_LENGTH)
    style_guide: Optional[str] = Field(default=None, max_length=20)
    focus_areas: Optional[List[str]] = Field(default=None)
    preserve_voice: bool = Field(default=True)

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Text cannot be empty or whitespace")
        if len(v.split()) < 3:
            raise ValueError("Text must contain at least 3 words for proofreading")
        return v

    @field_validator("style_guide")
    @classmethod
    def validate_style_guide(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if v not in VALID_STYLE_GUIDES:
            raise ValueError(
                f"Style guide must be one of: {', '.join(sorted(VALID_STYLE_GUIDES))}. Got: {v}"
            )
        if v == "none":
            return None
        return v

    @field_validator("focus_areas")
    @classmethod
    def validate_focus_areas(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if not v:
            return v
        cleaned = []
        seen: set[str] = set()
        for area in v:
            area = area.strip().lower()
            if area and area not in seen:
                if area not in VALID_FOCUS_AREAS:
                    raise ValueError(
                        f"Unknown focus area: '{area}'. "
                        f"Valid areas: {', '.join(sorted(VALID_FOCUS_AREAS))}"
                    )
                seen.add(area)
                cleaned.append(area)
        return cleaned[:MAX_FOCUS_AREAS]


# OUTPUT MODELS

class ProofreadingIssue(BaseModel):
    """A single proofreading issue found in the text."""
    issue_type: str = Field(..., max_length=50)
    original: str = Field(default="", max_length=500)
    correction: str = Field(default="", max_length=500)
    explanation: str = Field(default="", max_length=500)
    severity: str = Field(default="suggestion", max_length=20)


class ProofreadingReport(BaseModel):
    """Complete proofreading output."""
    original_text: str
    corrected_text: str
    issues_found: List[ProofreadingIssue] = Field(default_factory=list)
    style_suggestions: List[str] = Field(default_factory=list)
    readability_score: float = Field(default=0.0, ge=0.0, le=100.0)
    reading_level: str = Field(default="")
    word_count: int = Field(default=0, ge=0)
    issue_count: int = Field(default=0, ge=0)
    generated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def model_post_init(self, __context):
        if not self.word_count and self.original_text:
            self.word_count = len(self.original_text.split())
        if not self.issue_count:
            self.issue_count = len(self.issues_found)


# PROOFREADING AGENT


@register_agent(
    "proofreading",
    version="2.0",
    capabilities=["grammar_check", "style_enforcement", "readability_scoring"],
    timeout_seconds=120,
)
class ProofreadingAgentV2(BaseAgentV2):
    """
    Production-grade proofreading agent.

    Features:
    - Style guide support (AP, Chicago, APA, MLA)
    - Configurable focus areas (grammar, spelling, clarity, etc.)
    - Voice preservation option
    - Local readability scoring (Flesch-Kincaid)
    - Structured issue reporting with severity levels
    """

    async def execute(
        self,
        text: str,
        style_guide: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        preserve_voice: bool = True,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[ProofreadingReport, Dict[str, Any]]:
        """Execute proofreading.

        Returns:
            Tuple of (ProofreadingReport, metadata dict).
        """
        try:
            validated = ProofreadingInput(
                text=text,
                style_guide=style_guide,
                focus_areas=focus_areas,
                preserve_voice=preserve_voice,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def report_progress(percent: int, message: str, step: str, step_num: int):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=2,
                    current_step_num=step_num,
                ))

        try:
            # Step 1: Compute local readability metrics
            report_progress(10, "Computing readability metrics...", "readability", 1)
            readability_score = self._compute_readability(validated.text)
            reading_level = self._score_to_level(readability_score)

            report_progress(20, "Proofreading text...", "proofreading", 2)

            # Step 2: LLM proofreading
            style_context = (
                f"\nFollow {validated.style_guide.upper()} style guide."
                if validated.style_guide
                else ""
            )
            focus_context = (
                f"\nFocus especially on: {', '.join(validated.focus_areas)}"
                if validated.focus_areas
                else ""
            )
            voice_context = (
                "\nPreserve the author's unique voice while making corrections."
                if validated.preserve_voice
                else ""
            )

            system_prompt = f"""You are an expert editor and proofreader. Use your judgment to determine which issues matter most — not every text needs every type of correction.

Review the text for issues across grammar, spelling, punctuation, style, clarity, and consistency. Prioritize corrections that genuinely improve the text.
{style_context}{focus_context}{voice_context}

Provide your response as JSON:
{{
    "corrected_text": "<the improved text>",
    "issues_found": [
        {{
            "issue_type": "<grammar|spelling|punctuation|clarity|style|consistency>",
            "original": "<original text snippet>",
            "correction": "<corrected text>",
            "explanation": "<why this was changed>",
            "severity": "<error|warning|suggestion>"
        }}
    ],
    "style_suggestions": ["<suggestion 1>", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=validated.text,
                max_tokens=4000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]

            report_progress(85, "Compiling report...", "proofreading", 2)

            issues = []
            for issue in parsed.get("issues_found", []):
                try:
                    issues.append(ProofreadingIssue(
                        issue_type=issue.get("issue_type", "general"),
                        original=issue.get("original", ""),
                        correction=issue.get("correction", ""),
                        explanation=issue.get("explanation", ""),
                        severity=issue.get("severity", "suggestion"),
                    ))
                except Exception as exc:
                    logger.debug("Skipping malformed proofreading issue: %s", exc)

            # Fallback: if LLM didn't return issues but text was changed, diff to find them
            corrected_text = parsed.get("corrected_text", validated.text)
            if not issues and corrected_text != validated.text:
                original_words = validated.text.split()
                corrected_words = corrected_text.split()
                sm = difflib.SequenceMatcher(None, original_words, corrected_words)
                for tag, i1, i2, j1, j2 in sm.get_opcodes():
                    if tag == "equal":
                        continue
                    orig_snippet = " ".join(original_words[i1:i2]) if i1 < i2 else ""
                    corr_snippet = " ".join(corrected_words[j1:j2]) if j1 < j2 else ""
                    issues.append(ProofreadingIssue(
                        issue_type=tag,
                        original=orig_snippet,
                        correction=corr_snippet,
                        explanation=f"Text {tag}d",
                        severity="warning",
                    ))

            report = ProofreadingReport(
                original_text=validated.text,
                corrected_text=parsed.get("corrected_text", validated.text),
                issues_found=issues,
                style_suggestions=parsed.get("style_suggestions", []),
                readability_score=round(readability_score, 1),
                reading_level=reading_level,
            )

            cost_cents = self._estimate_cost_cents(
                result["input_tokens"], result["output_tokens"]
            )
            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Proofreading complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str:
                raise LLMContentFilterError(str(e))
            raise AgentError(str(e), code="PROOFREADING_FAILED", retryable=True)

    # ----- Local readability scoring (Flesch-Kincaid) -----

    @staticmethod
    def _count_syllables(word: str) -> int:
        """Estimate syllable count for an English word."""
        word = word.lower().strip()
        if not word:
            return 0
        # Simple heuristic: count vowel groups
        vowels = "aeiouy"
        count = 0
        prev_vowel = False
        for char in word:
            is_vowel = char in vowels
            if is_vowel and not prev_vowel:
                count += 1
            prev_vowel = is_vowel
        # Adjust for silent e
        if word.endswith("e") and count > 1:
            count -= 1
        return max(1, count)

    @staticmethod
    def _compute_readability(text: str) -> float:
        """Compute Flesch Reading Ease score (0-100, higher = easier)."""
        sentences = re.split(r"[.!?]+", text)
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            return 50.0

        words = re.findall(r"\b[a-zA-Z]+\b", text)
        if not words:
            return 50.0

        total_sentences = len(sentences)
        total_words = len(words)
        total_syllables = sum(
            ProofreadingAgentV2._count_syllables(w) for w in words
        )

        # Flesch Reading Ease formula
        score = (
            206.835
            - 1.015 * (total_words / total_sentences)
            - 84.6 * (total_syllables / total_words)
        )
        return max(0.0, min(100.0, score))

    @staticmethod
    def _score_to_level(score: float) -> str:
        """Convert Flesch score to reading level description."""
        if score >= 90:
            return "5th grade (very easy)"
        elif score >= 80:
            return "6th grade (easy)"
        elif score >= 70:
            return "7th grade (fairly easy)"
        elif score >= 60:
            return "8th-9th grade (standard)"
        elif score >= 50:
            return "10th-12th grade (fairly difficult)"
        elif score >= 30:
            return "College (difficult)"
        else:
            return "Professional (very difficult)"

# RESEARCH AGENTS (merged from research_agents.py)

from typing import Any, Callable, Dict, List, Literal, Optional


logger = logging.getLogger("neura.agents.research")


# ERROR TYPES — unified from base_agent.py


# OUTPUT MODELS

class ResearchSection(BaseModel):
    """A section in the research report."""
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    word_count: int = Field(default=0, ge=0)

    def model_post_init(self, __context):
        if not self.word_count:
            self.word_count = len(self.content.split())


class ResearchSource(BaseModel):
    """A source referenced in the research."""
    title: str = Field(..., min_length=1, max_length=300)
    url: Optional[str] = Field(default=None, max_length=2000)
    relevance: Optional[str] = Field(default=None, max_length=500)


class ResearchReport(BaseModel):
    """Complete research report output."""
    topic: str
    depth: str
    summary: str = Field(..., min_length=10)
    sections: List[ResearchSection] = Field(default_factory=list)
    key_findings: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    sources: List[ResearchSource] = Field(default_factory=list)
    word_count: int = Field(default=0, ge=0)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def model_post_init(self, __context):
        if not self.word_count:
            total = len(self.summary.split())
            for section in self.sections:
                total += section.word_count
            self.word_count = total


# PROGRESS CALLBACK


# INPUT VALIDATION

class ResearchInput(BaseModel):
    """Validated input for research agent."""
    topic: str = Field(..., max_length=500)
    depth: Literal["quick", "moderate", "comprehensive"] = "comprehensive"
    focus_areas: List[str] = Field(default_factory=list)
    max_sections: int = Field(default=5, ge=1, le=20)

    @field_validator('topic')
    @classmethod
    def validate_topic(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Topic cannot be empty or whitespace")
        # Must contain at least 2 words for meaningful research
        words = v.split()
        if len(words) < 2:
            raise ValueError("Topic must contain at least 2 words for meaningful research")
        # Basic content validation - reject obviously invalid topics
        if all(c in '0123456789!@#$%^&*()' for c in v.replace(' ', '')):
            raise ValueError("Topic must contain meaningful text")
        return v

    @field_validator('focus_areas')
    @classmethod
    def validate_focus_areas(cls, v: List[str]) -> List[str]:
        if not v:
            return v
        # Clean and deduplicate
        cleaned = []
        seen = set()
        for area in v:
            area = area.strip()
            if area and area.lower() not in seen:
                seen.add(area.lower())
                cleaned.append(area)
        return cleaned[:10]  # Max 10 focus areas


# RESEARCH AGENT


@register_agent(
    "research",
    version="2.0",
    capabilities=["research", "report_generation", "topic_analysis"],
    timeout_seconds=300,
)
class ResearchAgent:
    """
    Production-grade research agent.

    Features:
    - Input validation with semantic checks
    - Structured output with schema validation
    - Progress callbacks for real-time updates
    - Proper error categorization
    - Token/cost tracking
    - Timeout handling

    Usage:
        agent = ResearchAgent()
        result = await agent.execute(
            topic="AI trends in healthcare 2025",
            depth="comprehensive",
            progress_callback=lambda p: print(f"{p.percent}% - {p.message}")
        )
    """

    # Token cost estimates (per 1K tokens)
    INPUT_COST_PER_1K = 0.003  # $0.003 per 1K input tokens
    OUTPUT_COST_PER_1K = 0.015  # $0.015 per 1K output tokens

    # Timeout settings
    DEFAULT_TIMEOUT_SECONDS = 120
    MAX_TIMEOUT_SECONDS = 300

    def __init__(self):
        self._client = None
        self._model = None

    def _get_client(self):
        """Get unified LLM client (Claude Code CLI) lazily."""
        if self._client is None:
            self._client = get_llm_client()
        return self._client

    def _get_model(self) -> str:
        """Get model name from LLM config."""
        if self._model is None:
            self._model = get_llm_config().model
        return self._model

    async def execute(
        self,
        topic: str,
        depth: str = "comprehensive",
        focus_areas: Optional[List[str]] = None,
        max_sections: int = 5,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> tuple[ResearchReport, Dict[str, Any]]:
        """
        Execute research on a topic.

        Args:
            topic: Topic to research
            depth: Research depth (quick, moderate, comprehensive)
            focus_areas: Optional areas to focus on
            max_sections: Maximum number of sections
            progress_callback: Optional callback for progress updates
            timeout_seconds: Timeout for LLM calls

        Returns:
            Tuple of (ResearchReport, metadata dict with token counts and cost)

        Raises:
            ValidationError: If input validation fails
            LLMTimeoutError: If LLM request times out
            LLMRateLimitError: If rate limited
            LLMResponseError: If LLM returns invalid response
            AgentError: For other errors
        """
        # Validate input
        try:
            validated_input = ResearchInput(
                topic=topic,
                depth=depth,
                focus_areas=focus_areas or [],
                max_sections=max_sections,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        # Setup progress tracking
        total_steps = 3  # outline, sections, synthesis
        current_step = 0

        def report_progress(percent: int, message: str, step: str):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=total_steps,
                    current_step_num=current_step,
                ))

        # Track tokens and cost
        total_input_tokens = 0
        total_output_tokens = 0

        try:
            # Step 1: Generate research outline
            current_step = 1
            report_progress(10, "Generating research outline...", "outline")

            outline_result, tokens = await self._generate_outline(
                validated_input,
                timeout_seconds=timeout_seconds,
            )
            total_input_tokens += tokens["input"]
            total_output_tokens += tokens["output"]

            report_progress(25, "Outline generated", "outline")

            # Step 2: Generate sections
            current_step = 2
            sections_result, tokens = await self._generate_sections(
                validated_input,
                outline_result,
                progress_callback=lambda pct, msg: report_progress(
                    25 + int(pct * 0.5),  # 25% to 75%
                    msg,
                    "sections"
                ),
                timeout_seconds=timeout_seconds,
            )
            total_input_tokens += tokens["input"]
            total_output_tokens += tokens["output"]

            report_progress(75, "Sections generated", "sections")

            # Step 3: Synthesize and finalize
            current_step = 3
            report_progress(80, "Synthesizing findings...", "synthesis")

            final_result, tokens = await self._synthesize_report(
                validated_input,
                outline_result,
                sections_result,
                timeout_seconds=timeout_seconds,
            )
            total_input_tokens += tokens["input"]
            total_output_tokens += tokens["output"]

            report_progress(95, "Finalizing report...", "synthesis")

            # Build final report
            report = ResearchReport(
                topic=validated_input.topic,
                depth=validated_input.depth,
                summary=final_result.get("summary", ""),
                sections=[
                    ResearchSection(
                        title=s.get("title", "Untitled"),
                        content=s.get("content", ""),
                    )
                    for s in sections_result.get("sections", [])
                ],
                key_findings=final_result.get("key_findings", []),
                recommendations=final_result.get("recommendations", []),
                sources=[
                    ResearchSource(
                        title=src.get("title", "Unknown"),
                        url=src.get("url"),
                        relevance=src.get("relevance"),
                    )
                    for src in final_result.get("sources", [])
                ],
            )

            # Calculate cost
            cost_cents = int(
                (total_input_tokens / 1000 * self.INPUT_COST_PER_1K * 100) +
                (total_output_tokens / 1000 * self.OUTPUT_COST_PER_1K * 100)
            )

            metadata = {
                "tokens_input": total_input_tokens,
                "tokens_output": total_output_tokens,
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Research complete", "done")

            return report, metadata

        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            # Categorize the error
            error_str = str(e).lower()

            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str or "content_filter" in error_str:
                raise LLMContentFilterError(str(e))
            else:
                raise AgentError(
                    str(e),
                    code="RESEARCH_FAILED",
                    retryable=True,
                )

    async def _generate_outline(
        self,
        input: ResearchInput,
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        """Generate research outline."""
        focus_prompt = ""
        if input.focus_areas:
            focus_prompt = f"\nFocus on these areas: {', '.join(input.focus_areas)}"

        depth_instructions = {
            "quick": "Create a brief outline with 2-3 main topics.",
            "moderate": "Create a balanced outline with 4-5 main topics and subtopics.",
            "comprehensive": "Create a detailed outline with all major aspects, subtopics, and related concepts.",
        }

        system_prompt = f"""You are a research planning expert. Structure your research based on the topic's nature — use your expertise to determine what matters.

{depth_instructions.get(input.depth, depth_instructions['moderate'])}
{focus_prompt}

Return JSON only:
{{
    "main_topics": ["topic1", "topic2", ...],
    "subtopics": {{"topic1": ["subtopic1", ...], ...}},
    "key_questions": ["question1", ...]
}}

Maximum {input.max_sections} main topics."""

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt=f"Create a research outline for: {input.topic}",
            max_tokens=1000,
            timeout_seconds=timeout_seconds,
        )

        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    async def _generate_sections(
        self,
        input: ResearchInput,
        outline: Dict[str, Any],
        progress_callback: Callable[[float, str], None],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        """Generate research sections based on outline."""
        main_topics = outline.get("main_topics", [])[:input.max_sections]
        subtopics = outline.get("subtopics", {})

        total_input_tokens = 0
        total_output_tokens = 0
        sections = []

        for i, topic in enumerate(main_topics):
            progress = i / len(main_topics)
            progress_callback(progress, f"Researching: {topic}")

            topic_subtopics = subtopics.get(topic, [])

            system_prompt = f"""You are an expert research writer. Write a detailed section about the given topic.

Topic Context: Part of a larger report on "{input.topic}"
Section Topic: {topic}
Subtopics to cover: {', '.join(topic_subtopics) if topic_subtopics else 'General overview'}

Depth: {input.depth}
- quick: 100-200 words, key points only
- moderate: 300-500 words, balanced coverage
- comprehensive: 500-800 words, detailed analysis

Return JSON only:
{{
    "title": "Section Title",
    "content": "Full section content with paragraphs...",
    "key_points": ["point1", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Write the section about: {topic}",
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
            )

            total_input_tokens += result["input_tokens"]
            total_output_tokens += result["output_tokens"]

            sections.append(result["parsed"])

        return {"sections": sections}, {"input": total_input_tokens, "output": total_output_tokens}

    async def _synthesize_report(
        self,
        input: ResearchInput,
        outline: Dict[str, Any],
        sections: Dict[str, Any],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        """Synthesize final report with summary, findings, and recommendations."""
        section_summaries = []
        for s in sections.get("sections", []):
            title = s.get("title", "")
            points = s.get("key_points", [])
            section_summaries.append(f"- {title}: {', '.join(points[:3])}")

        system_prompt = f"""You are a research analyst. Synthesize the research sections into a final report.

Topic: {input.topic}
Research Depth: {input.depth}

Section Summaries:
{chr(10).join(section_summaries)}

Create a synthesis with:
1. Executive summary (2-3 paragraphs)
2. Key findings (5-10 bullet points)
3. Recommendations (3-5 actionable items)
4. Sources/references (if applicable)

Return JSON only:
{{
    "summary": "Executive summary...",
    "key_findings": ["finding1", ...],
    "recommendations": ["recommendation1", ...],
    "sources": [{{"title": "Source", "url": "optional url", "relevance": "why relevant"}}]
}}"""

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt="Synthesize the research into a final report.",
            max_tokens=2000,
            timeout_seconds=timeout_seconds,
        )

        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        timeout_seconds: int,
    ) -> Dict[str, Any]:
        """Make an LLM call using Claude Code CLI with proper error handling."""
        client = self._get_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]

        # Run in thread pool to avoid blocking event loop
        loop = asyncio.get_running_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.complete(
                    messages=messages,
                    description="research_agent",
                    max_tokens=max_tokens,
                    temperature=0.7,
                )
            ),
            timeout=timeout_seconds,
        )

        # Extract content from OpenAI-compatible response format
        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        ) or ""

        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        # Parse JSON from response
        parsed = self._parse_json_response(content)

        return {
            "raw": content,
            "parsed": parsed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from LLM response, handling markdown code blocks."""
        if not content or not content.strip():
            return {}

        cleaned = content.strip()

        # Handle ```json ... ``` blocks
        json_block_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if json_block_match:
            cleaned = json_block_match.group(1).strip()
        elif cleaned.startswith("```"):
            parts = cleaned.split("```", 2)
            if len(parts) >= 2:
                cleaned = parts[1].strip()
                if cleaned.startswith("json"):
                    cleaned = cleaned[4:].strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Try to find JSON object in content
        for pattern in [r"\{.*\}", r"\[.*\]"]:
            match = re.search(pattern, cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group())
                except json.JSONDecodeError:
                    continue

        logger.warning(f"Failed to parse JSON from LLM output: {content[:200]}...")
        raise LLMResponseError("Failed to parse JSON from LLM response")


"""
Report Analyst Agent — analyzes, summarizes, compares, and answers
questions about generated reports.

Follows the exact pattern of research_agent.py.
"""


from backend.app.services.reports import ReportContext, ReportContextProvider

logger = logging.getLogger("neura.agents.report_analyst")


# OUTPUT MODELS

class KeyFinding(BaseModel):
    """A key insight extracted from a report."""
    finding: str = Field(..., min_length=1)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    source_section: Optional[str] = None


class DataHighlight(BaseModel):
    """A notable data point from report tables."""
    metric: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)
    context: Optional[str] = None
    trend: Optional[str] = None  # "up", "down", "stable", "new"


class ReportAnalysis(BaseModel):
    """Complete analysis output from the Report Analyst Agent."""
    run_id: str
    analysis_type: str
    summary: str = Field(default="", min_length=0)
    key_findings: List[KeyFinding] = Field(default_factory=list)
    data_highlights: List[DataHighlight] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    comparison: Optional[Dict[str, Any]] = None  # For "compare" mode
    answer: Optional[str] = None  # For "qa" mode
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "report_analyst",
    version="1.0",
    capabilities=["report_analysis", "report_comparison", "insight_extraction", "report_qa"],
    timeout_seconds=300,
)
class ReportAnalystAgent:
    """
    Analyzes generated reports to extract insights, summarize findings,
    compare reports, and answer questions about report content.
    """

    INPUT_COST_PER_1K = 0.003
    OUTPUT_COST_PER_1K = 0.015
    DEFAULT_TIMEOUT_SECONDS = 120
    MAX_TIMEOUT_SECONDS = 300

    def __init__(self):
        self._client = None
        self._model = None
        self._context_provider = ReportContextProvider()

    def _get_client(self):
        if self._client is None:
            self._client = get_llm_client()
        return self._client

    def _get_model(self) -> str:
        if self._model is None:
            self._model = get_llm_config().model
        return self._model

    async def execute(
        self,
        run_id: str,
        analysis_type: str = "summarize",
        question: Optional[str] = None,
        compare_run_id: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> tuple[ReportAnalysis, Dict[str, Any]]:
        """
        Execute report analysis.

        Args:
            run_id: Report run to analyze
            analysis_type: "summarize" | "insights" | "compare" | "qa"
            question: Question text (required for "qa" type)
            compare_run_id: Second run_id (required for "compare" type)
            focus_areas: Optional areas to focus analysis on
            progress_callback: Optional callback for progress updates
            timeout_seconds: Timeout for LLM calls

        Returns:
            Tuple of (ReportAnalysis, metadata dict)
        """
        # Validate
        valid_types = {"summarize", "insights", "compare", "qa"}
        if analysis_type not in valid_types:
            raise ValidationError(
                f"analysis_type must be one of {valid_types}, got '{analysis_type}'",
                field="analysis_type",
            )
        if analysis_type == "qa" and not question:
            raise ValidationError("question is required for 'qa' analysis_type", field="question")
        if analysis_type == "compare" and not compare_run_id:
            raise ValidationError(
                "compare_run_id is required for 'compare' analysis_type",
                field="compare_run_id",
            )

        total_steps = 3
        current_step = 0

        def report_progress(percent: int, message: str, step: str):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=percent,
                    message=message,
                    current_step=step,
                    total_steps=total_steps,
                    current_step_num=current_step,
                ))

        total_input_tokens = 0
        total_output_tokens = 0

        try:
            # Step 1: Load report context
            current_step = 1
            report_progress(5, "Loading report data...", "load")

            context = self._context_provider.get_report_context(run_id)
            if not context:
                raise AgentError(
                    f"Report run '{run_id}' not found",
                    code="REPORT_NOT_FOUND",
                    retryable=False,
                )
            if not context.text_content and not context.tables:
                html_url = (context.artifact_urls or {}).get("html_url")
                hint = f" html_url={html_url!r}" if html_url else " (no html_url recorded)"
                raise AgentError(
                    f"Report run '{run_id}' has no readable content.{hint} — "
                    f"the HTML file may have been deleted or the report generation may not have produced one",
                    code="REPORT_EMPTY",
                    retryable=False,
                )

            compare_context = None
            if analysis_type == "compare" and compare_run_id:
                compare_context = self._context_provider.get_report_context(compare_run_id)
                if not compare_context:
                    raise AgentError(
                        f"Comparison report run '{compare_run_id}' not found",
                        code="REPORT_NOT_FOUND",
                        retryable=False,
                    )

            report_progress(10, "Report data loaded", "load")

            # Step 2: LLM analysis
            current_step = 2
            report_progress(15, f"Analyzing report ({analysis_type})...", "analyze")

            if analysis_type == "summarize":
                result, tokens = await self._analyze_summarize(
                    context, focus_areas, timeout_seconds
                )
            elif analysis_type == "insights":
                result, tokens = await self._analyze_insights(
                    context, focus_areas, timeout_seconds
                )
            elif analysis_type == "compare":
                result, tokens = await self._analyze_compare(
                    context, compare_context, focus_areas, timeout_seconds
                )
            elif analysis_type == "qa":
                result, tokens = await self._analyze_qa(
                    context, question, timeout_seconds
                )
            else:
                result, tokens = await self._analyze_summarize(
                    context, focus_areas, timeout_seconds
                )

            total_input_tokens += tokens["input"]
            total_output_tokens += tokens["output"]
            report_progress(80, "Analysis complete", "analyze")

            # Step 3: Structure results
            current_step = 3
            report_progress(85, "Structuring results...", "finalize")

            analysis = ReportAnalysis(
                run_id=run_id,
                analysis_type=analysis_type,
                summary=result.get("summary", ""),
                key_findings=[
                    KeyFinding(
                        finding=f.get("finding", f) if isinstance(f, dict) else str(f),
                        confidence=f.get("confidence", 0.8) if isinstance(f, dict) else 0.8,
                        source_section=f.get("source_section") if isinstance(f, dict) else None,
                    )
                    for f in result.get("key_findings", [])
                ],
                data_highlights=[
                    DataHighlight(
                        metric=d.get("metric", ""),
                        value=str(d.get("value", "")),
                        context=d.get("context"),
                        trend=d.get("trend"),
                    )
                    for d in result.get("data_highlights", [])
                    if isinstance(d, dict)
                ],
                recommendations=result.get("recommendations", []),
                comparison=result.get("comparison"),
                answer=result.get("answer"),
            )

            cost_cents = int(
                (total_input_tokens / 1000 * self.INPUT_COST_PER_1K * 100)
                + (total_output_tokens / 1000 * self.OUTPUT_COST_PER_1K * 100)
            )

            metadata = {
                "tokens_input": total_input_tokens,
                "tokens_output": total_output_tokens,
                "estimated_cost_cents": cost_cents,
            }

            report_progress(100, "Report analysis complete", "done")
            return analysis, metadata

        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except (ValidationError, AgentError):
            raise
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "rate_limit" in error_str:
                raise LLMRateLimitError()
            elif "timeout" in error_str:
                raise LLMTimeoutError(timeout_seconds)
            elif "content filter" in error_str or "content_filter" in error_str:
                raise LLMContentFilterError(str(e))
            else:
                raise AgentError(
                    str(e),
                    code="REPORT_ANALYSIS_FAILED",
                    retryable=True,
                )

    # ------------------------------------------------------------------
    # Analysis methods (one per analysis_type)
    # ------------------------------------------------------------------

    def _build_report_prompt_section(self, ctx: ReportContext) -> str:
        """Build the report content section for LLM prompts."""
        parts = [
            f"Report: {ctx.template_name}",
            f"Kind: {ctx.template_kind}",
            f"Period: {ctx.start_date} to {ctx.end_date}",
            f"Status: {ctx.status}",
            f"Generated: {ctx.created_at}",
        ]
        if ctx.key_values:
            parts.append(f"Parameters: {json.dumps(ctx.key_values, default=str)}")
        parts.append("")
        parts.append("--- REPORT CONTENT ---")
        parts.append(ctx.text_content or "(no text content)")

        if ctx.tables:
            parts.append("")
            parts.append("--- DATA TABLES ---")
            for i, table in enumerate(ctx.tables, 1):
                headers = table.get("headers", [])
                rows = table.get("rows", [])
                parts.append(f"\nTable {i}:")
                if headers:
                    parts.append(" | ".join(headers))
                    parts.append("-" * 40)
                for row in rows[:50]:  # Limit rows to prevent context overflow
                    parts.append(" | ".join(str(c) for c in row))
                if len(rows) > 50:
                    parts.append(f"... ({len(rows) - 50} more rows)")

        return "\n".join(parts)

    async def _analyze_summarize(
        self,
        ctx: ReportContext,
        focus_areas: Optional[List[str]],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        focus_prompt = ""
        if focus_areas:
            focus_prompt = f"\nFocus especially on: {', '.join(focus_areas)}"

        system_prompt = f"""You are an expert report analyst. Summarize the following report, extracting key findings and actionable recommendations.
{focus_prompt}

Return JSON only:
{{
    "summary": "Executive summary (2-4 paragraphs)",
    "key_findings": [
        {{"finding": "...", "confidence": 0.9, "source_section": "..."}},
        ...
    ],
    "data_highlights": [
        {{"metric": "...", "value": "...", "context": "...", "trend": "up|down|stable|new"}},
        ...
    ],
    "recommendations": ["actionable recommendation 1", ...]
}}"""

        report_content = self._build_report_prompt_section(ctx)

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt=f"Analyze and summarize this report:\n\n{report_content}",
            max_tokens=3000,
            timeout_seconds=timeout_seconds,
        )
        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    async def _analyze_insights(
        self,
        ctx: ReportContext,
        focus_areas: Optional[List[str]],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        focus_prompt = ""
        if focus_areas:
            focus_prompt = f"\nFocus especially on: {', '.join(focus_areas)}"

        system_prompt = f"""You are a data analyst expert. Extract deep insights from this report. Look for:
- Trends and patterns in the data
- Anomalies and outliers
- Correlations between metrics
- Areas of concern or opportunity
{focus_prompt}

Return JSON only:
{{
    "summary": "Brief overview of key insights",
    "key_findings": [
        {{"finding": "detailed insight", "confidence": 0.85, "source_section": "where in report"}},
        ...
    ],
    "data_highlights": [
        {{"metric": "metric name", "value": "value", "context": "why notable", "trend": "up|down|stable|new"}},
        ...
    ],
    "recommendations": ["data-driven recommendation 1", ...]
}}"""

        report_content = self._build_report_prompt_section(ctx)

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt=f"Extract deep insights from this report:\n\n{report_content}",
            max_tokens=3000,
            timeout_seconds=timeout_seconds,
        )
        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    async def _analyze_compare(
        self,
        ctx: ReportContext,
        compare_ctx: Optional[ReportContext],
        focus_areas: Optional[List[str]],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        focus_prompt = ""
        if focus_areas:
            focus_prompt = f"\nFocus comparison on: {', '.join(focus_areas)}"

        report_a = self._build_report_prompt_section(ctx)
        report_b = self._build_report_prompt_section(compare_ctx) if compare_ctx else "(no comparison report)"

        system_prompt = f"""You are an expert report analyst. Compare these two reports and identify differences, trends, and changes.
{focus_prompt}

Return JSON only:
{{
    "summary": "Comparison overview",
    "key_findings": [
        {{"finding": "key difference or similarity", "confidence": 0.85, "source_section": "..."}},
        ...
    ],
    "data_highlights": [
        {{"metric": "metric name", "value": "current vs previous", "context": "change explanation", "trend": "up|down|stable"}},
        ...
    ],
    "comparison": {{
        "report_a_period": "date range",
        "report_b_period": "date range",
        "improvements": ["improvement 1", ...],
        "regressions": ["regression 1", ...],
        "unchanged": ["unchanged area 1", ...]
    }},
    "recommendations": ["recommendation based on comparison", ...]
}}"""

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt=f"Compare these two reports:\n\n=== REPORT A ===\n{report_a}\n\n=== REPORT B ===\n{report_b}",
            max_tokens=4000,
            timeout_seconds=timeout_seconds,
        )
        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    async def _analyze_qa(
        self,
        ctx: ReportContext,
        question: Optional[str],
        timeout_seconds: int,
    ) -> tuple[Dict[str, Any], Dict[str, int]]:
        system_prompt = """You are an expert report analyst. Answer the user's question about the report accurately, citing specific data from the report when possible.

Return JSON only:
{
    "answer": "Direct, detailed answer to the question",
    "summary": "Brief context about the report relevant to the question",
    "key_findings": [
        {"finding": "supporting evidence from the report", "confidence": 0.9, "source_section": "..."},
        ...
    ],
    "data_highlights": [
        {"metric": "relevant metric", "value": "value", "context": "relevance to question"},
        ...
    ],
    "recommendations": []
}"""

        report_content = self._build_report_prompt_section(ctx)

        result = await self._call_llm(
            system_prompt=system_prompt,
            user_prompt=f"Based on this report:\n\n{report_content}\n\nQuestion: {question}",
            max_tokens=2000,
            timeout_seconds=timeout_seconds,
        )
        return result["parsed"], {"input": result["input_tokens"], "output": result["output_tokens"]}

    # ------------------------------------------------------------------
    # LLM call helper (same pattern as research_agent)
    # ------------------------------------------------------------------

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
        timeout_seconds: int,
    ) -> Dict[str, Any]:
        """Make an LLM call using Claude Code CLI with proper error handling."""
        client = self._get_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        loop = asyncio.get_running_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.complete(
                    messages=messages,
                    description="report_analyst",
                    max_tokens=max_tokens,
                    temperature=0.5,
                ),
            ),
            timeout=timeout_seconds,
        )

        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        ) or ""

        usage = response.get("usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        parsed = self._parse_json_response(content)

        return {
            "raw": content,
            "parsed": parsed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from LLM response, handling markdown code blocks."""
        if not content or not content.strip():
            return {}

        cleaned = content.strip()

        json_block_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", cleaned, re.DOTALL)
        if json_block_match:
            cleaned = json_block_match.group(1).strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Find outermost balanced braces
        start_idx = cleaned.find("{")
        if start_idx != -1:
            depth = 0
            in_string = False
            escape_next = False
            for i, char in enumerate(cleaned[start_idx:], start_idx):
                if escape_next:
                    escape_next = False
                    continue
                if char == "\\":
                    escape_next = True
                    continue
                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(cleaned[start_idx : i + 1])
                        except json.JSONDecodeError:
                            break

        logger.warning("Failed to parse JSON from LLM response: %s...", content[:200])
        return {}


"""
Report Pipeline Agent — orchestrates the full report generation pipeline,
calling real pipeline functions, diagnosing failures with LLM, and iterating
until the pipeline passes error-free.

Covers both PDF and Excel output paths.
"""


logger = logging.getLogger("neura.agents.report_pipeline")


# INPUT / OUTPUT

class PipelineRunInput(BaseModel):
    template_id: str = Field(..., min_length=1)
    connection_id: Optional[str] = Field(default=None)
    start_date: Optional[str] = Field(default=None)
    end_date: Optional[str] = Field(default=None)
    key_values: Optional[Dict[str, Any]] = Field(default=None)
    batch_ids: Optional[List[str]] = Field(default=None)
    max_retries_per_step: int = Field(default=3, ge=1, le=5)
    output_formats: List[str] = Field(default_factory=lambda: ["pdf"])
    skip_render: bool = False

    @field_validator("template_id")
    @classmethod
    def validate_template_id(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("template_id cannot be empty")
        return v


class StepReport(BaseModel):
    step_name: str = ""
    status: str = "pending"  # passed, failed, skipped, repaired
    attempts: int = 1
    elapsed_ms: float = 0.0
    error_message: str = ""
    repair_actions: List[str] = Field(default_factory=list)


class PipelineRunReport(BaseModel):
    overall_status: str = "pending"  # passed, failed
    steps: List[StepReport] = Field(default_factory=list)
    total_elapsed_ms: float = 0.0
    output_paths: Dict[str, str] = Field(default_factory=dict)
    contract_sha256: str = ""
    summary: str = ""
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# PIPELINE STEP DEFINITIONS

PIPELINE_STEPS = [
    {"name": "template_load", "deps": []},
    {"name": "mapping_validate", "deps": ["template_load"]},
    {"name": "contract_build", "deps": ["template_load"]},
    {"name": "contract_validate", "deps": ["contract_build"], "allow_fail": True},
    {"name": "contract_dry_run", "deps": ["contract_build"], "allow_fail": True},
    {"name": "contract_repair", "deps": ["contract_build"], "conditional": True},
    {"name": "discovery", "deps": ["contract_build"]},
    {"name": "render_pdf", "deps": ["contract_build"], "conditional": True},
    {"name": "render_excel", "deps": ["contract_build"], "conditional": True},
]


# AGENT

@register_agent(
    "report_pipeline",
    version="1.0",
    capabilities=[
        "pipeline_validation", "pipeline_execution",
        "contract_repair", "error_diagnosis",
        "pdf_render", "excel_render",
    ],
    timeout_seconds=600,
    max_concurrent=2,
)
class ReportPipelineAgent(BaseAgentV2):
    """Orchestrates the full report generation pipeline with LLM-driven error repair."""

    async def execute(
        self,
        template_id: str,
        connection_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        key_values: Optional[Dict[str, Any]] = None,
        batch_ids: Optional[List[str]] = None,
        max_retries_per_step: int = 3,
        output_formats: Optional[List[str]] = None,
        skip_render: bool = False,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 600,
    ) -> tuple[PipelineRunReport, Dict[str, Any]]:
        try:
            validated = PipelineRunInput(
                template_id=template_id,
                connection_id=connection_id,
                start_date=start_date,
                end_date=end_date,
                key_values=key_values,
                batch_ids=batch_ids,
                max_retries_per_step=max_retries_per_step,
                output_formats=output_formats or ["pdf"],
                skip_render=skip_render,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        # Build shared context dict that flows through all steps
        ctx: Dict[str, Any] = {
            "template_id": validated.template_id,
            "connection_id": validated.connection_id,
            "start_date": validated.start_date or "",
            "end_date": validated.end_date or "",
            "key_values": validated.key_values,
            "batch_ids": validated.batch_ids,
            "max_retries": validated.max_retries_per_step,
            "output_formats": validated.output_formats,
            "skip_render": validated.skip_render,
            "_needs_repair": False,
        }

        total_tokens_in = 0
        total_tokens_out = 0

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(
                    percent=pct, message=msg,
                    current_step=step, total_steps=len(PIPELINE_STEPS),
                    current_step_num=n,
                ))

        try:
            steps_report: List[StepReport] = []
            total_start = time.time()
            step_num = 0

            for step_def in PIPELINE_STEPS:
                step_name = step_def["name"]
                step_num += 1

                # Skip conditional steps unless needed
                if step_def.get("conditional"):
                    if step_name == "contract_repair" and not ctx.get("_needs_repair"):
                        steps_report.append(StepReport(
                            step_name=step_name, status="skipped",
                        ))
                        continue
                    if step_name == "render_pdf":
                        if "pdf" not in ctx["output_formats"] or ctx["skip_render"]:
                            steps_report.append(StepReport(
                                step_name=step_name, status="skipped",
                            ))
                            continue
                    if step_name == "render_excel":
                        if "excel" not in ctx["output_formats"] or ctx["skip_render"]:
                            steps_report.append(StepReport(
                                step_name=step_name, status="skipped",
                            ))
                            continue

                # Check dependencies
                failed_deps = [
                    s for s in steps_report
                    if s.step_name in step_def["deps"] and s.status == "failed"
                ]
                if failed_deps:
                    steps_report.append(StepReport(
                        step_name=step_name, status="skipped",
                        error_message=f"Skipped: dependency {failed_deps[0].step_name} failed",
                    ))
                    continue

                progress(
                    int((step_num / len(PIPELINE_STEPS)) * 80),
                    f"Running {step_name}...", step_name, step_num,
                )

                step_fn = getattr(self, f"_step_{step_name}", None)
                if step_fn is None:
                    steps_report.append(StepReport(
                        step_name=step_name, status="skipped",
                        error_message=f"Step method _step_{step_name} not found",
                    ))
                    continue

                # Run the step with retry logic
                step_result = await self._run_pipeline_step(
                    step_name, step_fn, ctx,
                    max_retries=ctx["max_retries"],
                    on_error=lambda sr: self._diagnose_and_fix(sr, ctx),
                )

                sr = StepReport(
                    step_name=step_name,
                    status="passed" if step_result.success else (
                        "repaired" if step_result.attempt > 1 and step_result.success else "failed"
                    ),
                    attempts=step_result.attempt,
                    elapsed_ms=round(step_result.elapsed_ms, 1),
                    error_message=step_result.error_message if not step_result.success else "",
                    repair_actions=step_result.repair_actions,
                )

                # Mark for repair if validate/dry-run found issues
                if not step_result.success and step_name in ("contract_validate", "contract_dry_run"):
                    if step_def.get("allow_fail"):
                        ctx["_needs_repair"] = True
                        sr.status = "needs_repair"

                steps_report.append(sr)

                # Update context from successful result
                if step_result.success and isinstance(step_result.result, dict):
                    ctx.update(step_result.result)

            # Generate summary via LLM
            progress(90, "Generating pipeline summary...", "summary", len(PIPELINE_STEPS))

            summary_text = self._build_summary_text(steps_report)
            try:
                llm_result = await self._call_llm(
                    system_prompt="You are a report pipeline analyst. Summarize the pipeline run results concisely.",
                    user_prompt=summary_text,
                    max_tokens=500,
                    timeout_seconds=30,
                    temperature=0.3,
                    parse_json=False,
                )
                summary = llm_result["raw"]
                total_tokens_in += llm_result["input_tokens"]
                total_tokens_out += llm_result["output_tokens"]
            except Exception:
                summary = summary_text

            overall = "passed" if all(
                s.status in ("passed", "skipped", "repaired")
                for s in steps_report
            ) else "failed"

            report = PipelineRunReport(
                overall_status=overall,
                steps=steps_report,
                total_elapsed_ms=round((time.time() - total_start) * 1000, 1),
                output_paths={
                    k: ctx.get(f"output_{k}", "")
                    for k in ctx["output_formats"]
                    if ctx.get(f"output_{k}")
                },
                contract_sha256=ctx.get("contract_sha", ""),
                summary=summary,
            )

            metadata = {
                "tokens_input": total_tokens_in,
                "tokens_output": total_tokens_out,
                "estimated_cost_cents": self._estimate_cost_cents(total_tokens_in, total_tokens_out),
            }

            progress(100, f"Pipeline {overall}", "done", len(PIPELINE_STEPS))
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="PIPELINE_FAILED", retryable=True)

    # =========================================================================
    # PIPELINE STEP IMPLEMENTATIONS
    # =========================================================================

    def _step_template_load(self, ctx: Dict) -> Dict:
        """Load template HTML and schema from template directory."""
        from backend.app.services.legacy_services import template_dir

        kind = "excel" if "excel" in ctx["output_formats"] and "pdf" not in ctx["output_formats"] else "pdf"
        tpl_dir = template_dir(ctx["template_id"], kind=kind, must_exist=True)

        # Try report_final.html first, then template_p1.html
        final_html = tpl_dir / "report_final.html"
        base_html = tpl_dir / "template_p1.html"

        if final_html.exists():
            html = final_html.read_text(encoding="utf-8")
        elif base_html.exists():
            html = base_html.read_text(encoding="utf-8")
        else:
            raise FileNotFoundError(f"No template HTML found in {tpl_dir}")

        # Load schema
        schema_path = tpl_dir / "schema_ext.json"
        schema = {}
        if schema_path.exists():
            try:
                schema = json.loads(schema_path.read_text(encoding="utf-8"))
            except Exception:
                logger.warning("Failed to parse schema_ext.json")

        # Resolve DB path
        from backend.app.services.legacy_services import db_path_from_payload_or_default
        db_path = db_path_from_payload_or_default(ctx.get("connection_id"))

        return {
            "template_dir": tpl_dir,
            "template_html": html,
            "schema": schema,
            "db_path": db_path,
            "kind": kind,
        }

    def _step_mapping_validate(self, ctx: Dict) -> Dict:
        """Validate the mapping payload against schema v4."""
        from backend.app.services.legacy_services import load_mapping_step3

        tpl_dir = ctx["template_dir"]
        mapping_doc, _ = load_mapping_step3(tpl_dir)

        if not mapping_doc:
            logger.info("No mapping_step3.json found, skipping validation")
            return {"mapping_doc": None}

        # Validate if the mapping has the expected structure
        validate_mapping_inline_v4(mapping_doc)

        return {"mapping_doc": mapping_doc, "mapping_validated": True}

    def _step_contract_build(self, ctx: Dict) -> Dict:
        """Build the execution contract via ContractBuilderV2."""
        from backend.app.services.contract_builder import build_or_load_contract_v2
        from backend.app.services.legacy_services import (
            build_catalog_from_db,
            compute_db_signature,
            load_mapping_step3,
            load_schema_ext,
        )

        tpl_dir = ctx["template_dir"]
        db_path = ctx["db_path"]

        catalog = list(dict.fromkeys(build_catalog_from_db(db_path)))
        db_sig = compute_db_signature(db_path)
        auto_mapping, _ = load_mapping_step3(tpl_dir)
        schema = load_schema_ext(tpl_dir) or ctx.get("schema", {})

        result = build_or_load_contract_v2(
            template_dir=tpl_dir,
            catalog=catalog,
            final_template_html=ctx["template_html"],
            schema=schema,
            auto_mapping_proposal=auto_mapping or {},
            mapping_override=None,
            user_instructions="",
            dialect_hint=None,
            db_signature=db_sig,
        )

        contract = result.get("contract") or result.get("meta", {}).get("contract_payload", {})

        return {
            "contract": contract,
            "contract_result": result,
            "contract_cached": result.get("cached", False),
            "catalog": catalog,
        }

    def _step_contract_validate(self, ctx: Dict) -> Dict:
        """Run schema-aware contract validation."""
        from backend.app.services.contract_builder import validate_contract
        from backend.app.services.legacy_services import build_rich_catalog_from_db

        rich_catalog = build_rich_catalog_from_db(ctx["db_path"])
        vr = validate_contract(ctx["contract"], rich_catalog)

        result = {
            "validation_report": vr,
            "rich_catalog": rich_catalog,
            "validation_error_count": vr.error_count,
            "validation_warning_count": vr.warning_count,
        }

        if vr.error_count > 0:
            issues_text = "; ".join(
                i.message for i in vr.issues if i.severity == "error"
            )[:500]
            raise RuntimeError(
                f"Contract validation: {vr.error_count} errors — {issues_text}"
            )

        return result

    def _step_contract_dry_run(self, ctx: Dict) -> Dict:
        """Execute contract dry run against real data."""

        loader = get_loader_for_ref(ctx["db_path"])
        dr = run_contract_dry_run(ctx["contract"], loader)

        result = {
            "dry_run_result": dr,
            "dry_run_success": dr.success,
            "dry_run_row_count": dr.row_count,
        }

        if not dr.success:
            issues_text = "; ".join(
                i.message for i in dr.issues if i.severity == "error"
            )[:500]
            raise RuntimeError(
                f"Dry run failed: {issues_text}"
            )

        return result

    def _step_contract_repair(self, ctx: Dict) -> Dict:
        """Repair contract issues using auto_repair_contract."""
        from backend.app.services.contract_builder import auto_repair_contract

        vr = ctx.get("validation_report")
        dr = ctx.get("dry_run_result")

        validation_dict = vr.to_dict() if vr and hasattr(vr, "to_dict") else None
        dry_run_dict = dr.to_dict() if dr and hasattr(dr, "to_dict") else None

        repaired = auto_repair_contract(
            ctx["contract"],
            dry_run_dict,
            validation_dict,
            ctx.get("rich_catalog"),
        )

        if repaired:
            logger.info("Contract repaired successfully")
            ctx["_needs_repair"] = False

        return {"contract_repaired": repaired}

    def _step_discovery(self, ctx: Dict) -> Dict:
        """Discover batches and counts from the database."""
        from backend.app.services.reports import discover_batches_and_counts

        discovery = discover_batches_and_counts(
            db_path=ctx["db_path"],
            contract=ctx["contract"],
            start_date=ctx.get("start_date", ""),
            end_date=ctx.get("end_date", ""),
            key_values=ctx.get("key_values"),
        )

        return {
            "discovery": discovery,
            "batches_count": discovery.get("batches_count", 0),
            "rows_total": discovery.get("rows_total", 0),
        }

    def _step_render_pdf(self, ctx: Dict) -> Dict:
        """Render the report as HTML + PDF."""
        from backend.app.services.reports import fill_and_print

        tpl_dir = ctx["template_dir"]
        out_dir = tpl_dir / "agent_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        ts = int(time.time())
        out_html = out_dir / f"filled_{ts}.html"
        out_pdf = out_dir / f"filled_{ts}.pdf"

        template_path = tpl_dir / "report_final.html"
        if not template_path.exists():
            template_path = tpl_dir / "template_p1.html"

        fill_and_print(
            OBJ=ctx["contract"],
            TEMPLATE_PATH=template_path,
            DB_PATH=ctx["db_path"],
            OUT_HTML=out_html,
            OUT_PDF=out_pdf,
            START_DATE=ctx.get("start_date", ""),
            END_DATE=ctx.get("end_date", ""),
            batch_ids=ctx.get("batch_ids"),
            KEY_VALUES=ctx.get("key_values"),
        )

        return {
            "output_pdf": str(out_pdf),
            "output_html": str(out_html),
        }

    def _step_render_excel(self, ctx: Dict) -> Dict:
        """Render the report as Excel."""
        from backend.app.services.reports import fill_and_print as fill_and_print_excel

        tpl_dir = ctx["template_dir"]
        out_dir = tpl_dir / "agent_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        ts = int(time.time())
        out_html = out_dir / f"filled_{ts}_excel.html"
        out_xlsx = out_dir / f"filled_{ts}.xlsx"

        template_path = tpl_dir / "report_final.html"
        if not template_path.exists():
            template_path = tpl_dir / "template_p1.html"

        fill_and_print_excel(
            OBJ=ctx["contract"],
            TEMPLATE_PATH=template_path,
            DB_PATH=ctx["db_path"],
            OUT_HTML=out_html,
            OUT_PDF=out_xlsx,  # ReportGenerateExcel uses OUT_PDF param for xlsx
            START_DATE=ctx.get("start_date", ""),
            END_DATE=ctx.get("end_date", ""),
            batch_ids=ctx.get("batch_ids"),
            KEY_VALUES=ctx.get("key_values"),
        )

        return {
            "output_excel": str(out_xlsx),
        }

    # =========================================================================
    # LLM-DRIVEN ERROR DIAGNOSIS
    # =========================================================================

    async def _diagnose_and_fix(
        self,
        step_result: PipelineStepResult,
        ctx: Dict,
    ) -> Optional[Dict]:
        """Use LLM to diagnose a pipeline step failure and suggest a fix.

        Returns modified kwargs dict for retry, or None to stop retrying.
        """
        contract_preview = json.dumps(ctx.get("contract", {}), indent=2)[:3000]
        schema_preview = json.dumps(ctx.get("schema", {}))[:1000]
        mapping_keys = str(list(ctx.get("contract", {}).get("mapping", {}).keys()))[:500]

        system_prompt = f"""You are a report pipeline debugger for NeuraReport.
The pipeline step "{step_result.step_name}" failed.

Error type: {step_result.error_type}
Error code: {step_result.error_code}
Error message: {step_result.error_message[:1000]}

Contract excerpt:
{contract_preview}

Schema: {schema_preview}
Mapped tokens: {mapping_keys}

Analyze the error and suggest a specific fix to the contract or mapping.
Return JSON only:
{{
    "diagnosis": "What went wrong and why",
    "fix_type": "contract_patch|mapping_fix|skip|no_fix",
    "patches": [
        {{"path": "mapping.TOKEN_NAME", "value": "table.column"}}
    ],
    "confidence": 0.0-1.0
}}"""

        try:
            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Diagnose and fix: {step_result.step_name} → {step_result.error_type}: {step_result.error_message[:500]}",
                max_tokens=1500,
                timeout_seconds=30,
                temperature=0.2,
            )

            parsed = result["parsed"]
            confidence = float(parsed.get("confidence", 0))
            fix_type = parsed.get("fix_type", "no_fix")

            logger.info(
                "pipeline_diagnosis",
                extra={
                    "step": step_result.step_name,
                    "fix_type": fix_type,
                    "confidence": confidence,
                    "diagnosis": str(parsed.get("diagnosis", ""))[:200],
                },
            )

            if confidence < 0.4 or fix_type in ("no_fix", "skip"):
                return None

            # Apply patches to the contract
            contract = ctx.get("contract", {})
            patches = parsed.get("patches", [])

            for patch in patches:
                path = patch.get("path", "")
                value = patch.get("value", "")
                if not path or not value:
                    continue

                parts = path.split(".", 1)
                if len(parts) == 2:
                    section, key = parts
                    if section in contract and isinstance(contract[section], dict):
                        contract[section][key] = value
                        logger.info(f"Applied patch: {path} = {value}")

            ctx["contract"] = contract
            # Return the modified ctx as the new kwargs
            return {"ctx": ctx}

        except Exception:
            logger.debug("pipeline_diagnosis_failed", exc_info=True)
            return None

    # =========================================================================
    # HELPERS
    # =========================================================================

    @staticmethod
    def _build_summary_text(steps: List[StepReport]) -> str:
        lines = ["Pipeline Run Summary:"]
        for s in steps:
            status_icon = {
                "passed": "OK",
                "failed": "FAIL",
                "skipped": "SKIP",
                "repaired": "REPAIRED",
                "needs_repair": "NEEDS_REPAIR",
            }.get(s.status, s.status)
            line = f"  [{status_icon}] {s.step_name} ({s.elapsed_ms:.0f}ms, {s.attempts} attempt(s))"
            if s.error_message:
                line += f" — {s.error_message[:100]}"
            if s.repair_actions:
                line += f" — repairs: {', '.join(s.repair_actions)}"
            lines.append(line)

        passed = sum(1 for s in steps if s.status in ("passed", "repaired"))
        failed = sum(1 for s in steps if s.status == "failed")
        lines.append(f"\nResult: {passed} passed, {failed} failed, {len(steps) - passed - failed} skipped")
        return "\n".join(lines)


"""
Schema Documentation Agent — auto-generates documentation for
database schemas, tables, columns, and relationships.
"""


logger = logging.getLogger("neura.agents.schema_documentation")


# INPUT / OUTPUT

class TableInfo(BaseModel):
    name: str = Field(..., min_length=1)
    columns: List[Dict[str, str]] = Field(default_factory=list)
    sample_values: Optional[Dict[str, List[str]]] = None
    row_count: Optional[int] = None


class SchemaDocInput(BaseModel):
    tables: List[TableInfo] = Field(..., min_length=1)
    database_name: str = Field(default="database", max_length=100)
    database_description: Optional[str] = Field(default=None, max_length=500)
    existing_docs: Optional[str] = Field(default=None, max_length=10000)

    @field_validator("tables")
    @classmethod
    def validate_tables(cls, v):
        if not v:
            raise ValueError("At least one table is required")
        return v


class TableDocumentation(BaseModel):
    table_name: str
    description: str = ""
    columns: List[Dict[str, str]] = Field(default_factory=list)  # name, type, description
    primary_key: Optional[str] = None
    usage_examples: List[str] = Field(default_factory=list)


class SchemaDocReport(BaseModel):
    database_name: str = ""
    overview: str = ""
    tables: List[TableDocumentation] = Field(default_factory=list)
    relationships: List[str] = Field(default_factory=list)
    markdown: str = ""
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "schema_documentation",
    version="1.0",
    capabilities=["schema_documentation", "data_dictionary", "relationship_mapping"],
    timeout_seconds=300,
)
class SchemaDocumentationAgent(BaseAgentV2):
    """Auto-generates documentation for database schemas."""

    async def execute(
        self,
        tables: List[Dict[str, Any]],
        database_name: str = "database",
        database_description: Optional[str] = None,
        existing_docs: Optional[str] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 180,
    ) -> tuple[SchemaDocReport, Dict[str, Any]]:
        try:
            table_infos = [TableInfo(**t) if isinstance(t, dict) else t for t in tables]
            validated = SchemaDocInput(
                tables=table_infos, database_name=database_name,
                database_description=database_description,
                existing_docs=existing_docs,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=2, current_step_num=n))

        try:
            progress(10, "Analyzing schema...", "analyze", 1)

            # Build schema description
            schema_parts = []
            for t in validated.tables:
                cols_desc = []
                for c in t.columns:
                    cols_desc.append(f"    - {c.get('name', '?')} ({c.get('type', '?')})")
                samples = ""
                if t.sample_values:
                    sample_lines = []
                    for col, vals in list(t.sample_values.items())[:5]:
                        sample_lines.append(f"    {col}: {vals[:3]}")
                    samples = f"\n  Sample values:\n" + "\n".join(sample_lines)
                row_info = f"\n  Rows: ~{t.row_count}" if t.row_count else ""
                schema_parts.append(f"Table: {t.name}{row_info}\n  Columns:\n" + "\n".join(cols_desc) + samples)

            existing_context = ""
            if validated.existing_docs:
                existing_context = f"\n\nExisting documentation (update/expand, don't contradict):\n{validated.existing_docs[:3000]}"

            desc = f"\nDatabase purpose: {validated.database_description}" if validated.database_description else ""

            system_prompt = f"""You are a database documentation expert. Generate comprehensive documentation for this schema.

Infer column purposes from names, types, and sample values. Identify likely relationships between tables (foreign keys, shared columns).{desc}

Return JSON only:
{{
    "overview": "Database overview paragraph",
    "tables": [
        {{
            "table_name": "name",
            "description": "What this table stores",
            "columns": [
                {{"name": "col", "type": "type", "description": "What this column means"}}
            ],
            "primary_key": "id_column or null",
            "usage_examples": ["SELECT ... example query"]
        }}
    ],
    "relationships": ["table_a.col_x -> table_b.col_y (relationship description)", ...]
}}"""

            progress(30, "Generating documentation...", "generate", 2)

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Document this {validated.database_name} schema:\n\n" + "\n\n".join(schema_parts) + existing_context,
                max_tokens=4000,
                timeout_seconds=timeout_seconds,
                temperature=0.4,
            )

            parsed = result["parsed"]
            progress(80, "Formatting output...", "generate", 2)

            table_docs = []
            for td in parsed.get("tables", []):
                try:
                    table_docs.append(TableDocumentation(
                        table_name=td.get("table_name", ""),
                        description=td.get("description", ""),
                        columns=td.get("columns", []),
                        primary_key=td.get("primary_key"),
                        usage_examples=td.get("usage_examples", []),
                    ))
                except Exception:
                    pass

            # Generate markdown
            md_parts = [f"# {validated.database_name} Schema Documentation\n"]
            md_parts.append(parsed.get("overview", "") + "\n")
            for td in table_docs:
                md_parts.append(f"## {td.table_name}\n")
                md_parts.append(td.description + "\n")
                if td.columns:
                    md_parts.append("| Column | Type | Description |")
                    md_parts.append("|--------|------|-------------|")
                    for c in td.columns:
                        md_parts.append(f"| {c.get('name', '')} | {c.get('type', '')} | {c.get('description', '')} |")
                    md_parts.append("")
                if td.usage_examples:
                    md_parts.append("**Examples:**\n")
                    for ex in td.usage_examples:
                        md_parts.append(f"```sql\n{ex}\n```\n")
            if parsed.get("relationships"):
                md_parts.append("## Relationships\n")
                for r in parsed["relationships"]:
                    md_parts.append(f"- {r}")

            report = SchemaDocReport(
                database_name=validated.database_name,
                overview=parsed.get("overview", ""),
                tables=table_docs,
                relationships=parsed.get("relationships", []),
                markdown="\n".join(md_parts),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Documentation complete", "done", 2)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="SCHEMA_DOC_FAILED", retryable=True)


"""
Template QA Agent — validates HTML templates for token coverage,
structural issues, and report readiness.

Uses local token extraction + LLM-powered layout/quality analysis.
Optionally uses GLM-OCR to cross-check tokens against a reference PDF image.
"""


logger = logging.getLogger("neura.agents.template_qa")

MAX_HTML_LENGTH = 200_000


# INPUT / OUTPUT

class TemplateQAInput(BaseModel):
    html_content: str = Field(..., min_length=20, max_length=MAX_HTML_LENGTH)
    schema_tokens: Optional[List[str]] = Field(default=None)
    reference_image_path: Optional[str] = Field(default=None)

    @field_validator("html_content")
    @classmethod
    def validate_html(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("HTML content cannot be empty")
        return v


class TemplateQAIssue(BaseModel):
    category: str = Field(..., max_length=50)
    severity: str = Field(default="warning", max_length=20)
    description: str = Field(..., max_length=500)
    suggestion: str = Field(default="", max_length=500)


class TemplateQAReport(BaseModel):
    qa_score: float = Field(default=0.0, ge=0.0, le=100.0)
    tokens_found: List[str] = Field(default_factory=list)
    tokens_missing: List[str] = Field(default_factory=list)
    token_coverage_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    issues: List[TemplateQAIssue] = Field(default_factory=list)
    summary: str = Field(default="")
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "template_qa",
    version="1.0",
    capabilities=["template_validation", "token_coverage", "layout_analysis"],
    timeout_seconds=180,
)
class TemplateQAAgent(BaseAgentV2):
    """Validates HTML templates for token coverage, layout quality, and report readiness."""

    async def execute(
        self,
        html_content: str,
        schema_tokens: Optional[List[str]] = None,
        reference_image_path: Optional[str] = None,
        template_dir: Optional[str] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[TemplateQAReport, Dict[str, Any]]:
        try:
            validated = TemplateQAInput(
                html_content=html_content,
                schema_tokens=schema_tokens,
                reference_image_path=reference_image_path,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=3, current_step_num=n))

        try:
            # Step 1: Local token extraction
            progress(10, "Extracting tokens from HTML...", "tokens", 1)
            found_tokens = self._extract_tokens(validated.html_content)

            # If template_dir provided, load real schema and mapping for validation
            real_schema_tokens = list(schema_tokens) if schema_tokens else []
            if template_dir:
                try:
                    from pathlib import Path
                    from backend.app.services.legacy_services import load_schema_ext
                    tpl_path = Path(template_dir)
                    schema_ext = load_schema_ext(tpl_path)
                    if schema_ext:
                        # Merge all token types from schema
                        for section in ("scalars", "row_tokens", "totals"):
                            items = schema_ext.get(section, [])
                            if isinstance(items, list):
                                real_schema_tokens.extend(
                                    t if isinstance(t, str) else t.get("token", "")
                                    for t in items
                                )
                            elif isinstance(items, dict):
                                real_schema_tokens.extend(items.keys())
                        real_schema_tokens = list(set(real_schema_tokens))
                        logger.info(f"Loaded {len(real_schema_tokens)} tokens from schema_ext.json")

                    # Also check mapping coverage
                    mapping_path = tpl_path / "mapping_pdf_labels.json"
                    if mapping_path.exists():
                        mapping_labels = json.loads(mapping_path.read_text(encoding="utf-8"))
                        if isinstance(mapping_labels, dict):
                            mapped_count = sum(1 for v in mapping_labels.values() if v)
                            logger.info(f"Mapping coverage: {mapped_count}/{len(mapping_labels)} tokens mapped")
                except Exception as exc:
                    logger.debug(f"template_dir enrichment failed: {exc}")

            effective_schema = real_schema_tokens or []

            missing_tokens = []
            coverage = 100.0
            if effective_schema:
                schema_set = set(effective_schema)
                found_set = set(found_tokens)
                missing_tokens = sorted(schema_set - found_set)
                coverage = round((len(schema_set - set(missing_tokens)) / max(len(schema_set), 1)) * 100, 1)

            # Step 2: Optional OCR cross-check
            ocr_context = ""
            if validated.reference_image_path:
                progress(30, "OCR cross-checking reference image...", "ocr", 2)
                ocr_text = await self._call_ocr(validated.reference_image_path)
                if ocr_text:
                    ocr_context = f"\n\nReference PDF OCR text (for cross-checking):\n{ocr_text[:3000]}"

            # Step 3: LLM quality analysis
            progress(50, "Analyzing template quality...", "analysis", 3)

            html_preview = validated.html_content[:8000]
            system_prompt = """You are a template quality analyst for an industrial report generation system. Evaluate this HTML template and identify issues.

Assess: structural correctness, table layout quality, token placement, accessibility, print-readiness.

Return JSON only:
{
    "qa_score": 0-100,
    "issues": [
        {"category": "layout|tokens|accessibility|structure|print", "severity": "error|warning|info", "description": "...", "suggestion": "..."}
    ],
    "summary": "Brief quality assessment"
}"""

            token_info = f"\nTokens found in HTML: {found_tokens[:50]}"
            if missing_tokens:
                token_info += f"\nTokens MISSING from schema: {missing_tokens}"

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Evaluate this template:\n\n{html_preview}\n{token_info}{ocr_context}",
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(90, "Compiling report...", "analysis", 3)

            issues = []
            for iss in parsed.get("issues", []):
                try:
                    issues.append(TemplateQAIssue(
                        category=iss.get("category", "general"),
                        severity=iss.get("severity", "warning"),
                        description=iss.get("description", ""),
                        suggestion=iss.get("suggestion", ""),
                    ))
                except Exception:
                    pass

            # Add missing token issues
            for tok in missing_tokens:
                issues.append(TemplateQAIssue(
                    category="tokens",
                    severity="error",
                    description=f"Schema token '{tok}' not found in template HTML",
                    suggestion=f"Add {{{{ {tok} }}}} placeholder in the appropriate location",
                ))

            llm_score = parsed.get("qa_score", 70)
            # Weight: 60% LLM score + 40% token coverage
            final_score = round(llm_score * 0.6 + coverage * 0.4, 1)

            report = TemplateQAReport(
                qa_score=final_score,
                tokens_found=found_tokens,
                tokens_missing=missing_tokens,
                token_coverage_pct=coverage,
                issues=issues,
                summary=parsed.get("summary", ""),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Template QA complete", "done", 3)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="TEMPLATE_QA_FAILED", retryable=True)

    @staticmethod
    def _extract_tokens(html: str) -> List[str]:
        """Extract {token_name} placeholders from HTML."""
        tokens = re.findall(r"\{(\w+)\}", html)
        return sorted(set(tokens))


"""
Trend Analysis Agent — analyzes time-series data for trends,
change points, and period-over-period comparisons.

Local: moving averages, period deltas, min/max/mean per period.
LLM: pattern interpretation and narrative generation.
"""


logger = logging.getLogger("neura.agents.trend_analysis")


# INPUT / OUTPUT

class TrendAnalysisInput(BaseModel):
    data: List[Dict[str, Any]] = Field(..., min_length=3)
    date_column: str = Field(..., min_length=1)
    value_columns: List[str] = Field(..., min_length=1)
    depth: Literal["quick", "moderate", "comprehensive"] = "moderate"
    data_description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("data")
    @classmethod
    def validate_data(cls, v):
        if len(v) < 3:
            raise ValueError("Need at least 3 data points for trend analysis")
        return v


class TrendResult(BaseModel):
    column: str
    direction: str = ""  # "increasing", "decreasing", "stable", "volatile"
    strength: float = Field(default=0.0, ge=0.0, le=1.0)
    change_pct: float = 0.0
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    avg_value: Optional[float] = None


class ChangePoint(BaseModel):
    index: int
    column: str
    before_avg: float
    after_avg: float
    change_pct: float
    description: str = ""


class TrendAnalysisReport(BaseModel):
    trends: List[TrendResult] = Field(default_factory=list)
    change_points: List[ChangePoint] = Field(default_factory=list)
    narrative: str = ""
    recommendations: List[str] = Field(default_factory=list)
    data_points: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "trend_analysis",
    version="1.0",
    capabilities=["trend_analysis", "change_detection", "period_comparison"],
    timeout_seconds=180,
)
class TrendAnalysisAgent(BaseAgentV2):
    """Analyzes time-series data for trends, change points, and patterns."""

    async def execute(
        self,
        data: List[Dict[str, Any]],
        date_column: str,
        value_columns: List[str],
        depth: str = "moderate",
        data_description: Optional[str] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[TrendAnalysisReport, Dict[str, Any]]:
        try:
            validated = TrendAnalysisInput(
                data=data, date_column=date_column,
                value_columns=value_columns, depth=depth,
                data_description=data_description,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=3, current_step_num=n))

        try:
            # Step 1: Local trend computation
            progress(10, "Computing trend statistics...", "stats", 1)
            local_trends = self._compute_trends(validated.data, validated.value_columns)
            change_points = self._detect_change_points(validated.data, validated.value_columns)

            # Step 2: LLM interpretation
            progress(40, "Analyzing patterns...", "analysis", 2)

            trend_summary = []
            for col, t in local_trends.items():
                trend_summary.append(
                    f"  {col}: direction={t['direction']}, change={t['change_pct']:.1f}%, "
                    f"min={t['min']:.2f}, max={t['max']:.2f}, avg={t['avg']:.2f}"
                )

            cp_summary = []
            for cp in change_points[:10]:
                cp_summary.append(f"  {cp['col']} at index {cp['idx']}: {cp['before_avg']:.2f} → {cp['after_avg']:.2f} ({cp['change_pct']:.1f}%)")

            desc = f"\nContext: {validated.data_description}" if validated.data_description else ""

            depth_instruction = {
                "quick": "Give a brief 2-3 sentence summary.",
                "moderate": "Provide a balanced analysis with key findings.",
                "comprehensive": "Provide detailed analysis covering all patterns, correlations, and implications.",
            }

            system_prompt = f"""You are a time-series analyst for industrial monitoring data. Interpret the computed trends and provide actionable insights.

{depth_instruction.get(validated.depth, depth_instruction['moderate'])}

Return JSON only:
{{
    "narrative": "Analysis narrative explaining what the trends mean",
    "trend_assessments": [
        {{"column": "col", "direction": "increasing|decreasing|stable|volatile", "strength": 0.0-1.0}}
    ],
    "recommendations": ["actionable recommendation 1", ...]
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Data points: {len(validated.data)}, Date column: {validated.date_column}{desc}\n\nTrend Statistics:\n{''.join(trend_summary)}\n\nChange Points ({len(change_points)}):\n{''.join(cp_summary) if cp_summary else '  None detected'}",
                max_tokens=2000,
                timeout_seconds=timeout_seconds,
                temperature=0.4,
            )

            parsed = result["parsed"]
            progress(80, "Compiling report...", "compile", 3)

            # Merge LLM assessments with local stats
            llm_assessments = {a.get("column"): a for a in parsed.get("trend_assessments", []) if isinstance(a, dict)}

            trends = []
            for col, t in local_trends.items():
                assessment = llm_assessments.get(col, {})
                trends.append(TrendResult(
                    column=col,
                    direction=assessment.get("direction", t["direction"]),
                    strength=assessment.get("strength", 0.5),
                    change_pct=t["change_pct"],
                    min_value=t["min"],
                    max_value=t["max"],
                    avg_value=t["avg"],
                ))

            cps = [ChangePoint(
                index=cp["idx"], column=cp["col"],
                before_avg=cp["before_avg"], after_avg=cp["after_avg"],
                change_pct=cp["change_pct"],
            ) for cp in change_points[:20]]

            report = TrendAnalysisReport(
                trends=trends,
                change_points=cps,
                narrative=parsed.get("narrative", ""),
                recommendations=parsed.get("recommendations", []),
                data_points=len(validated.data),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Trend analysis complete", "done", 3)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="TREND_ANALYSIS_FAILED", retryable=True)

    # ----- Local computations -----

    def _compute_trends(self, data: List[Dict], columns: List[str]) -> Dict[str, Dict]:
        trends = {}
        for col in columns:
            values = []
            for row in data:
                v = row.get(col)
                if v is None:
                    continue
                try:
                    values.append(float(v))
                except (ValueError, TypeError):
                    pass
            if len(values) < 2:
                continue
            first_third = values[:max(len(values) // 3, 1)]
            last_third = values[-max(len(values) // 3, 1):]
            avg_first = sum(first_third) / len(first_third)
            avg_last = sum(last_third) / len(last_third)
            change_pct = ((avg_last - avg_first) / max(abs(avg_first), 0.001)) * 100
            if abs(change_pct) < 5:
                direction = "stable"
            elif change_pct > 0:
                direction = "increasing"
            else:
                direction = "decreasing"
            trends[col] = {
                "direction": direction, "change_pct": round(change_pct, 2),
                "min": min(values), "max": max(values),
                "avg": round(sum(values) / len(values), 4),
            }
        return trends

    def _detect_change_points(self, data: List[Dict], columns: List[str]) -> List[Dict]:
        """Simple change point detection: find biggest mean-shift in sliding window."""
        change_points = []
        for col in columns:
            values = []
            for row in data:
                v = row.get(col)
                if v is None:
                    continue
                try:
                    values.append(float(v))
                except (ValueError, TypeError):
                    pass
            if len(values) < 10:
                continue
            best_idx, best_diff = 0, 0
            for i in range(len(values) // 4, 3 * len(values) // 4):
                before = values[:i]
                after = values[i:]
                avg_b = sum(before) / len(before)
                avg_a = sum(after) / len(after)
                diff = abs(avg_a - avg_b)
                if diff > best_diff:
                    best_diff = diff
                    best_idx = i
            if best_diff > 0:
                before = values[:best_idx]
                after = values[best_idx:]
                avg_b = sum(before) / len(before)
                avg_a = sum(after) / len(after)
                pct = ((avg_a - avg_b) / max(abs(avg_b), 0.001)) * 100
                if abs(pct) > 10:  # Only report significant changes
                    change_points.append({
                        "idx": best_idx, "col": col,
                        "before_avg": round(avg_b, 4), "after_avg": round(avg_a, 4),
                        "change_pct": round(pct, 2),
                    })
        return change_points


"""
Compliance Check Agent — validates reports and data against
industry standards and regulatory requirements.

Supports: water_treatment, manufacturing, pharma, general.
"""


logger = logging.getLogger("neura.agents.compliance_check")


INDUSTRY_STANDARDS = {
    "water_treatment": [
        "pH range 6.5-8.5", "turbidity < 1 NTU", "residual chlorine 0.2-2.0 mg/L",
        "TDS < 500 mg/L", "DO > 4 mg/L", "BOD < 30 mg/L", "COD < 250 mg/L",
        "total coliform absent", "operator certification required",
        "daily log with timestamps", "calibration records",
    ],
    "manufacturing": [
        "batch records with lot numbers", "material traceability",
        "weight tolerances documented", "start/end timestamps",
        "operator identification", "equipment calibration dates",
        "reject/rework documentation", "yield calculations",
    ],
    "pharma": [
        "GMP compliance", "batch records signed and dated",
        "deviation reports", "stability data", "CAPA tracking",
        "environmental monitoring", "equipment qualification",
        "raw material CoA", "in-process controls",
    ],
    "general": [
        "data completeness", "date/time consistency",
        "numeric range validation", "required fields present",
        "proper units documented",
    ],
}


# INPUT / OUTPUT

class ComplianceInput(BaseModel):
    content: str = Field(..., min_length=20, max_length=50000)
    industry: Literal["water_treatment", "manufacturing", "pharma", "general"] = "general"
    custom_standards: Optional[List[str]] = Field(default=None)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Content cannot be empty")
        return v


class ComplianceViolation(BaseModel):
    standard: str = Field(default="", max_length=200)
    severity: str = Field(default="warning", max_length=20)
    description: str = Field(default="", max_length=500)
    recommendation: str = Field(default="", max_length=500)


class ComplianceReport(BaseModel):
    compliance_score: float = Field(default=0.0, ge=0.0, le=100.0)
    industry: str = ""
    violations: List[ComplianceViolation] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    missing_fields: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    standards_checked: int = 0
    summary: str = ""
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# AGENT

@register_agent(
    "compliance_check",
    version="1.0",
    capabilities=["compliance_check", "regulatory_validation", "standards_enforcement"],
    timeout_seconds=180,
)
class ComplianceCheckAgent(BaseAgentV2):
    """Validates reports and data against industry standards and regulatory requirements."""

    async def execute(
        self,
        content: str,
        industry: str = "general",
        custom_standards: Optional[List[str]] = None,
        *,
        progress_callback: Optional[ProgressCallback] = None,
        timeout_seconds: int = 120,
    ) -> tuple[ComplianceReport, Dict[str, Any]]:
        try:
            validated = ComplianceInput(
                content=content, industry=industry,
                custom_standards=custom_standards,
            )
        except Exception as e:
            raise ValidationError(str(e), field="input")

        def progress(pct, msg, step, n):
            if progress_callback:
                progress_callback(ProgressUpdate(percent=pct, message=msg, current_step=step, total_steps=1, current_step_num=n))

        try:
            progress(10, "Checking compliance...", "check", 1)

            standards = list(INDUSTRY_STANDARDS.get(validated.industry, INDUSTRY_STANDARDS["general"]))
            if validated.custom_standards:
                standards.extend(validated.custom_standards)

            standards_text = "\n".join(f"  - {s}" for s in standards)
            content_preview = validated.content[:15000]

            system_prompt = f"""You are a compliance auditor for the {validated.industry.replace('_', ' ')} industry. Check this report/data against the standards listed.

Be thorough but fair — only flag genuine violations and missing requirements, not minor formatting differences.

Standards to check:
{standards_text}

Return JSON only:
{{
    "compliance_score": 0-100,
    "violations": [
        {{"standard": "which standard", "severity": "critical|major|minor", "description": "what's wrong", "recommendation": "how to fix"}}
    ],
    "warnings": ["potential concern 1", ...],
    "missing_fields": ["required field not found", ...],
    "recommendations": ["improvement suggestion", ...],
    "summary": "Overall compliance assessment"
}}"""

            result = await self._call_llm(
                system_prompt=system_prompt,
                user_prompt=f"Check this {validated.industry.replace('_', ' ')} report for compliance:\n\n{content_preview}",
                max_tokens=3000,
                timeout_seconds=timeout_seconds,
                temperature=0.3,
            )

            parsed = result["parsed"]
            progress(85, "Compiling report...", "check", 1)

            violations = []
            for v in parsed.get("violations", []):
                try:
                    violations.append(ComplianceViolation(
                        standard=v.get("standard", ""),
                        severity=v.get("severity", "minor"),
                        description=v.get("description", ""),
                        recommendation=v.get("recommendation", ""),
                    ))
                except Exception:
                    pass

            report = ComplianceReport(
                compliance_score=parsed.get("compliance_score", 50),
                industry=validated.industry,
                violations=violations,
                warnings=parsed.get("warnings", []),
                missing_fields=parsed.get("missing_fields", []),
                recommendations=parsed.get("recommendations", []),
                standards_checked=len(standards),
                summary=parsed.get("summary", ""),
            )

            metadata = {
                "tokens_input": result["input_tokens"],
                "tokens_output": result["output_tokens"],
                "estimated_cost_cents": self._estimate_cost_cents(result["input_tokens"], result["output_tokens"]),
            }

            progress(100, "Compliance check complete", "done", 1)
            return report, metadata

        except (ValidationError, AgentError):
            raise
        except asyncio.TimeoutError:
            raise LLMTimeoutError(timeout_seconds)
        except Exception as e:
            raise AgentError(str(e), code="COMPLIANCE_CHECK_FAILED", retryable=True)

# Section: agent_service

"""
Agent Service - Production-grade orchestration of AI agents.

This service:
- Accepts agent requests and creates persistent tasks
- Executes agents with proper progress tracking
- Handles errors with categorization and retry logic
- Provides task management (list, get, cancel, retry)
- Background task queue via ThreadPoolExecutor (Trade-off 1)
- SSE progress streaming support (Trade-off 2)
- Worker isolation for horizontal scaling (Trade-off 3)

Design Principles:
- All task state is persisted to database
- Idempotency support for safe retries
- Progress updates stored and queryable
- Full audit trail via events
- Proper error categorization
- Background execution via ThreadPoolExecutor for durability
"""

import os
from concurrent.futures import ThreadPoolExecutor

from backend.app.repositories import (
    AgentTaskModel,
    AgentTaskRepository,
    AgentTaskStatus,
    AgentType,
    agent_task_repository,
)


logger = logging.getLogger("neura.agents.service")

# Worker pool configuration (Trade-off 1 + 3)
_AGENT_WORKERS = max(int(os.getenv("NR_AGENT_WORKERS", "2") or "2"), 1)
_AGENT_EXECUTOR = ThreadPoolExecutor(
    max_workers=_AGENT_WORKERS,
    thread_name_prefix="agent-worker",
)

# V2: Team and Crew routing tables
_TEAM_ROUTES = {
    "research": "ResearchTeam",
    "report_analyst": "ReportReviewTeam",
    "report_review": "ReportReviewTeam",
    "mapping": "MappingTeam",
}

_CREW_ROUTES = {
    "data_analyst": "DataAnalysisCrew",
    "content_repurpose": "ContentRepurposeCrew",
    "report": "ReportCrew",
}


def route_task_to_agent(task_description: str) -> Optional[str]:
    """LLM-driven task routing — decides which agent is best for a task.

    Returns the agent type name, or None to use default routing.
    Falls back gracefully on any failure.
    """
    try:
        from backend.app.services.infra_services import extract_json_from_llm_response

        registry = get_agent_registry()
        available = {}
        for name, descriptor in registry._agents.items():
            available[name] = {
                "description": getattr(descriptor, "description", ""),
                "capabilities": getattr(descriptor, "capabilities", []),
            }

        if not available:
            return None

        client = get_llm_client()
        prompt = (
            f"Task: {task_description}\n\n"
            "Available agents:\n"
            + "\n".join(f"- {k}: {v['description']} (capabilities: {v['capabilities']})" for k, v in available.items())
            + "\n\nWhich agent is best suited for this task?\n"
            'Return ONLY JSON: {"agent": "agent_name", "reason": "brief reason"}'
        )
        resp = client.complete(
            messages=[{"role": "user", "content": prompt}],
            description="agent_task_router",
            max_tokens=200,
        )
        text = _extract_response_text(resp)
        parsed = extract_json_from_llm_response(text)
        agent_name = parsed.get("agent", "")
        if agent_name in available:
            logger.info("agent_routed", extra={"task": task_description[:100], "agent": agent_name, "reason": parsed.get("reason", "")})
            return agent_name
        return None
    except Exception:
        logger.debug("agent_routing_failed", exc_info=True)
        return None


# V2: Helper functions for team/crew execution

async def _try_team_execution(
    agent_type: str,
    input_data: Dict[str, Any],
    team_name: str,
) -> Optional[Dict[str, Any]]:
    """Attempt to execute a task via an AutoGen team.

    Returns the result dict mapped to the existing output format on success,
    or ``None`` on any failure so the caller falls back to the individual
    agent path.
    """
    try:

        from backend.app.services.infra_services import get_v2_config
        _v2_cfg = get_v2_config()

        team_cls = get_team_class(team_name)
        if team_cls is None:
            logger.debug(f"V2 team class not found: {team_name}")
            return None

        config = TeamConfig(max_rounds=_v2_cfg.team_max_rounds)
        team = team_cls(config=config)
        team_result = await team.run(input_data=input_data)

        if team_result and getattr(team_result, "success", False):
            # Map team result to existing output format
            return {
                "output": getattr(team_result, "output", None),
                "result": getattr(team_result, "result", None),
                "metadata": getattr(team_result, "metadata", {}),
                "source": f"v2_team:{team_name}",
            }
        return None
    except Exception:
        logger.debug(
            f"V2 team execution failed for {agent_type} via {team_name}",
            exc_info=True,
        )
        return None


async def _try_crew_execution(
    agent_type: str,
    input_data: Dict[str, Any],
    crew_name: str,
) -> Optional[Dict[str, Any]]:
    """Attempt to execute a task via a CrewAI crew.

    Returns the result dict mapped to the existing output format on success,
    or ``None`` on any failure so the caller falls back to the individual
    agent path.
    """
    try:

        crew_cls = get_crew_class(crew_name)
        if crew_cls is None:
            logger.debug(f"V2 crew class not found: {crew_name}")
            return None

        crew = crew_cls()
        crew_result = await crew.run(input_data=input_data)

        if crew_result and getattr(crew_result, "success", False):
            return {
                "output": getattr(crew_result, "output", None),
                "result": getattr(crew_result, "result", None),
                "metadata": getattr(crew_result, "metadata", {}),
                "source": f"v2_crew:{crew_name}",
            }
        return None
    except Exception:
        logger.debug(
            f"V2 crew execution failed for {agent_type} via {crew_name}",
            exc_info=True,
        )
        return None


class AgentService:
    """
    Central service for managing AI agent tasks.

    This service is the main entry point for:
    - Creating and executing agent tasks
    - Tracking task progress
    - Managing task lifecycle (cancel, retry)
    - Querying task history

    Example usage:
        service = AgentService()

        # Create and execute a research task
        task = await service.run_research(
            topic="AI in healthcare",
            depth="comprehensive",
            idempotency_key="user123-research-001"
        )

        # Check task status
        task = service.get_task(task.task_id)
        print(f"Status: {task.status}, Progress: {task.progress_percent}%")

        # Cancel a pending task
        service.cancel_task(task.task_id)
    """

    # Map AgentType enum values to registry names
    _AGENT_TYPE_TO_REGISTRY: Dict[str, str] = {
        "research": "research",
        "data_analyst": "data_analyst",
        "email_draft": "email_draft",
        "content_repurpose": "content_repurpose",
        "proofreading": "proofreading",
        "report_analyst": "report_analyst",
        "report_pipeline": "report_pipeline",
    }

    def __init__(self, repository: Optional[AgentTaskRepository] = None):
        """Initialize the agent service.

        Args:
            repository: Optional repository instance. Uses singleton if not provided.
        """
        self._repo = repository or agent_task_repository
        # Use the agent registry for dynamic agent discovery
        self._registry = get_agent_registry()
        # Trigger auto-discovery so @register_agent decorators are loaded
        self._registry.auto_discover()
        # Backwards-compat: some tests and legacy code expect a mapping of
        # AgentType -> agent instance.
        self._agents: Dict[AgentType, Any] = {}
        for atype in AgentType:
            registry_name = self._AGENT_TYPE_TO_REGISTRY.get(atype.value)
            if not registry_name:
                continue
            agent = self._registry.get(registry_name)
            if agent is not None:
                self._agents[atype] = agent
        # Track running task locks to prevent duplicate execution
        self._running_tasks: set[str] = set()
        self._running_tasks_lock = threading.Lock()

    # =========================================================================
    # TASK CREATION AND EXECUTION
    # =========================================================================

    async def run_research(
        self,
        topic: str,
        depth: str = "comprehensive",
        focus_areas: Optional[List[str]] = None,
        max_sections: int = 5,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """
        Run the research agent.

        Args:
            topic: Topic to research
            depth: Research depth (quick, moderate, comprehensive)
            focus_areas: Optional areas to focus on
            max_sections: Maximum number of sections
            idempotency_key: Optional key for deduplication
            user_id: Optional user identifier
            priority: Task priority (0-10)
            webhook_url: Optional webhook for completion notification
            sync: If True, wait for completion. If False, return immediately.

        Returns:
            AgentTaskModel with task info (and result if sync=True)

        Raises:
            ValidationError: If input validation fails
        """
        input_params = {
            "topic": topic,
            "depth": depth,
            "focus_areas": focus_areas or [],
            "max_sections": max_sections,
        }

        # Check idempotency
        if idempotency_key:
            task, created = self._repo.create_or_get_by_idempotency_key(
                agent_type=AgentType.RESEARCH,
                input_params=input_params,
                idempotency_key=idempotency_key,
                user_id=user_id,
                priority=priority,
                webhook_url=webhook_url,
            )
            if not created:
                logger.info(f"Returning existing task {task.task_id} for idempotency key")
                return task
        else:
            task = self._repo.create_task(
                agent_type=AgentType.RESEARCH,
                input_params=input_params,
                user_id=user_id,
                priority=priority,
                webhook_url=webhook_url,
            )

        if sync:
            # Execute synchronously and return result
            return await self._execute_task(task.task_id)
        else:
            # Enqueue onto ThreadPoolExecutor for durable background execution.
            # The executor survives individual request contexts and the task state
            # is persisted in SQLite, so even if the worker crashes mid-flight the
            # AgentTaskWorker will recover it on the next poll cycle.
            self._enqueue_background(task.task_id)
            return task

    async def run_data_analyst(
        self,
        question: str,
        data: List[Dict[str, Any]],
        data_description: Optional[str] = None,
        generate_charts: bool = True,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the data analyst agent."""
        input_params = {
            "question": question,
            "data": data,
            "data_description": data_description,
            "generate_charts": generate_charts,
        }
        return await self._create_and_run(
            agent_type=AgentType.DATA_ANALYST,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    async def run_email_draft(
        self,
        context: str,
        purpose: str,
        tone: str = "professional",
        recipient_info: Optional[str] = None,
        previous_emails: Optional[List[str]] = None,
        include_subject: bool = True,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the email draft agent."""
        input_params = {
            "context": context,
            "purpose": purpose,
            "tone": tone,
            "recipient_info": recipient_info,
            "previous_emails": previous_emails,
            "include_subject": include_subject,
        }
        return await self._create_and_run(
            agent_type=AgentType.EMAIL_DRAFT,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    async def run_content_repurpose(
        self,
        content: str,
        source_format: str,
        target_formats: List[str],
        preserve_key_points: bool = True,
        adapt_length: bool = True,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the content repurposing agent."""
        input_params = {
            "content": content,
            "source_format": source_format,
            "target_formats": target_formats,
            "preserve_key_points": preserve_key_points,
            "adapt_length": adapt_length,
        }
        return await self._create_and_run(
            agent_type=AgentType.CONTENT_REPURPOSE,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    async def run_proofreading(
        self,
        text: str,
        style_guide: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        preserve_voice: bool = True,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the proofreading agent."""
        input_params = {
            "text": text,
            "style_guide": style_guide,
            "focus_areas": focus_areas,
            "preserve_voice": preserve_voice,
        }
        return await self._create_and_run(
            agent_type=AgentType.PROOFREADING,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    async def run_report_analyst(
        self,
        run_id: str,
        analysis_type: str = "summarize",
        question: Optional[str] = None,
        compare_run_id: Optional[str] = None,
        focus_areas: Optional[List[str]] = None,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the report analyst agent."""
        input_params = {
            "run_id": run_id,
            "analysis_type": analysis_type,
            "question": question,
            "compare_run_id": compare_run_id,
            "focus_areas": focus_areas,
        }
        return await self._create_and_run(
            agent_type=AgentType.REPORT_ANALYST,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    async def run_pipeline_validation(
        self,
        template_id: str,
        connection_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        key_values: Optional[Dict] = None,
        output_formats: Optional[List[str]] = None,
        skip_render: bool = False,
        max_retries_per_step: int = 3,
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 5,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Run the report pipeline agent — iterates through the full pipeline until it passes."""
        input_params = {
            "template_id": template_id,
            "connection_id": connection_id,
            "start_date": start_date,
            "end_date": end_date,
            "key_values": key_values,
            "output_formats": output_formats or ["pdf"],
            "skip_render": skip_render,
            "max_retries_per_step": max_retries_per_step,
        }
        return await self._create_and_run(
            agent_type=AgentType.REPORT_PIPELINE,
            input_params=input_params,
            idempotency_key=idempotency_key,
            user_id=user_id,
            priority=priority,
            webhook_url=webhook_url,
            sync=sync,
        )

    # =========================================================================
    # SHARED CREATE-AND-RUN LOGIC
    # =========================================================================

    async def _create_and_run(
        self,
        agent_type: AgentType,
        input_params: Dict[str, Any],
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        webhook_url: Optional[str] = None,
        sync: bool = True,
    ) -> AgentTaskModel:
        """Shared task creation and execution for all agent types."""
        if idempotency_key:
            task, created = self._repo.create_or_get_by_idempotency_key(
                agent_type=agent_type,
                input_params=input_params,
                idempotency_key=idempotency_key,
                user_id=user_id,
                priority=priority,
                webhook_url=webhook_url,
            )
            if not created:
                logger.info(f"Returning existing task {task.task_id} for idempotency key")
                return task
        else:
            task = self._repo.create_task(
                agent_type=agent_type,
                input_params=input_params,
                user_id=user_id,
                priority=priority,
                webhook_url=webhook_url,
            )

        if sync:
            return await self._execute_task(task.task_id)
        else:
            self._enqueue_background(task.task_id)
            return task

    async def _execute_task(self, task_id: str, *, already_claimed: bool = False) -> AgentTaskModel:
        """Execute a task with proper state management.

        Args:
            task_id: Task to execute
            already_claimed: If True, skip the claim step (task already RUNNING
                via claim_batch).

        Returns:
            Updated AgentTaskModel
        """
        from backend.app.repositories import TaskConflictError

        # For the sync path (run_task with sync=True), track the task here.
        # The background path (_enqueue_background) already adds it.
        with self._running_tasks_lock:
            self._running_tasks.add(task_id)

        try:

            if already_claimed:
                task = self._repo.get_task_or_raise(task_id)
            else:
                # Claim the task — transition PENDING → RUNNING atomically.
                # A TaskConflictError means another worker legitimately claimed
                # the task first; this is an expected race, not a real error.
                try:
                    task = self._repo.claim_task(task_id)
                except TaskConflictError:
                    logger.debug(f"Task {task_id} already claimed by another worker, skipping")
                    return self._repo.get_task_or_raise(task_id)
                except Exception as e:
                    logger.error(f"Failed to claim task {task_id}: {e}")
                    raise

            # ---------------------------------------------------------------
            # V2: Try team-based or crew-based execution if enabled
            # ---------------------------------------------------------------
            agent_type_str = task.agent_type.value if hasattr(task.agent_type, "value") else str(task.agent_type)
            v2_result = None  # Will hold team/crew result if V2 path succeeds

            try:
                _v2_cfg = get_v2_config()

                # Try AutoGen team execution
                if _v2_cfg.enable_autogen_teams and agent_type_str in _TEAM_ROUTES:
                    v2_result = await _try_team_execution(
                        agent_type_str, task.input_params, _TEAM_ROUTES[agent_type_str],
                    )

                # Try CrewAI crew execution
                if v2_result is None and _v2_cfg.enable_crewai_crews and agent_type_str in _CREW_ROUTES:
                    v2_result = await _try_crew_execution(
                        agent_type_str, task.input_params, _CREW_ROUTES[agent_type_str],
                    )
            except Exception:
                logger.debug("V2 team/crew routing skipped", exc_info=True)
                # Fall through to existing individual agent path

            if v2_result is not None:
                # V2 team/crew succeeded — use its result
                result_dict = v2_result
                metadata: Dict[str, Any] = v2_result.get("metadata", {})
            else:
                # ---------------------------------------------------------------
                # Existing individual agent path (unchanged)
                # ---------------------------------------------------------------

                # Get the agent implementation.
                # Prefer the explicit AgentType -> agent mapping so tests/legacy code
                # can override implementations without touching the registry.
                agent = None
                try:
                    atype = task.agent_type
                    if isinstance(atype, str):
                        atype = AgentType(atype)
                    agent = self._agents.get(atype)
                except Exception:
                    agent = None

                if agent is None:
                    registry_name = self._AGENT_TYPE_TO_REGISTRY.get(agent_type_str, agent_type_str)
                    agent = self._registry.get(registry_name)
                    if not agent:
                        raise AgentError(
                            f"Unknown agent type: {task.agent_type} (registry key: {registry_name})",
                            code="UNKNOWN_AGENT_TYPE",
                            retryable=False,
                        )

                # Create progress callback
                def on_progress(update: ProgressUpdate):
                    try:
                        self._repo.update_progress(
                            task_id,
                            percent=update.percent,
                            message=update.message,
                            current_step=update.current_step,
                            total_steps=update.total_steps,
                            current_step_num=update.current_step_num,
                        )
                    except Exception as e:
                        logger.warning(f"Failed to update progress for {task_id}: {e}")

                # Execute the agent — extract params based on type
                agent_kwargs = self._build_agent_kwargs(task)
                result, metadata = await agent.execute(
                    **agent_kwargs,
                    progress_callback=on_progress,
                )

                # Normalize result to dict
                result_dict = result.model_dump() if hasattr(result, "model_dump") else result

            # ---------------------------------------------------------------
            # V2: Quality loop evaluation
            # ---------------------------------------------------------------
            try:
                from backend.app.services.infra_services import get_v2_config as _get_v2_cfg_q
                _v2_cfg_q = _get_v2_cfg_q()
                if _v2_cfg_q.enable_quality_loop and result_dict:
                    from backend.app.services.quality_service import QualityEvaluator
                    evaluator = QualityEvaluator()
                    content = str(result_dict.get("output", result_dict.get("result", "")))
                    if content:
                        score = await evaluator.evaluate(content, content_type="agent_output")
                        # Store quality score in task metadata
                        result_dict["quality_score"] = score.overall_score
            except Exception:
                logger.debug("V2 quality evaluation skipped", exc_info=True)

            # ---------------------------------------------------------------
            # V2: Conversation memory
            # ---------------------------------------------------------------
            try:
                from backend.app.services.infra_services import get_v2_config as _get_v2_cfg_m
                _v2_cfg_m = _get_v2_cfg_m()
                if _v2_cfg_m.enable_conversation_memory:
                    from backend.app.services.ai_services import get_conversation_memory
                    memory = get_conversation_memory()
                    # After execution: update context
                    memory.set_context("last_agent_task", {
                        "agent_type": agent_type_str,
                        "task_id": task_id,
                        "timestamp": time.time(),
                    })
            except Exception:
                logger.debug("V2 memory update skipped", exc_info=True)

            # Complete the task
            task = self._repo.complete_task(
                task_id,
                result=result_dict,
                tokens_input=metadata.get("tokens_input", 0),
                tokens_output=metadata.get("tokens_output", 0),
                estimated_cost_cents=metadata.get("estimated_cost_cents", 0),
            )

            # Trigger webhook if configured
            if task.webhook_url:
                await self._notify_webhook(task)

            return task

        except AgentError as e:
            # Fail with proper categorization
            try:
                task = self._repo.fail_task(
                    task_id,
                    error_message=e.message,
                    error_code=e.code,
                    is_retryable=e.retryable,
                )
            except TaskConflictError:
                logger.debug(f"Cannot fail task {task_id}: state already changed")
                return self._repo.get_task_or_raise(task_id)
            if task.webhook_url and task.is_terminal():
                await self._notify_webhook(task)
            return task

        except TaskConflictError:
            # Task state changed by another worker (e.g. cancelled externally,
            # or concurrent complete/fail).  This is expected, not an error.
            logger.debug(f"Task {task_id} state conflict (concurrent update), skipping")
            return self._repo.get_task_or_raise(task_id)

        except Exception as e:
            # Unexpected error - mark as retryable
            logger.exception(f"Unexpected error executing task {task_id}")
            error_message = str(e) or "Task execution failed due to an unexpected error"
            try:
                task = self._repo.fail_task(
                    task_id,
                    error_message=error_message,
                    error_code="UNEXPECTED_ERROR",
                    is_retryable=True,
                )
            except TaskConflictError:
                logger.debug(f"Cannot fail task {task_id}: state already changed")
                return self._repo.get_task_or_raise(task_id)
            if task.webhook_url and task.is_terminal():
                await self._notify_webhook(task)
            return task

        finally:
            with self._running_tasks_lock:
                self._running_tasks.discard(task_id)

    @staticmethod
    def _build_agent_kwargs(task: AgentTaskModel) -> Dict[str, Any]:
        """Extract the correct keyword arguments for an agent's execute() method.

        Each agent type has a distinct set of parameters.  This routing table
        maps ``AgentType`` → ``dict`` of keyword arguments drawn from
        ``task.input_params``.  Adding a new agent type requires only a new
        elif branch here plus the corresponding ``run_*`` method.
        """
        p = task.input_params
        atype = task.agent_type
        if isinstance(atype, str):
            atype = AgentType(atype)

        if atype == AgentType.RESEARCH:
            return {
                "topic": p.get("topic", ""),
                "depth": p.get("depth", "comprehensive"),
                "focus_areas": p.get("focus_areas"),
                "max_sections": p.get("max_sections", 5),
            }
        elif atype == AgentType.DATA_ANALYST:
            return {
                "question": p.get("question", ""),
                "data": p.get("data", []),
                "data_description": p.get("data_description"),
                "generate_charts": p.get("generate_charts", True),
            }
        elif atype == AgentType.EMAIL_DRAFT:
            return {
                "context": p.get("context", ""),
                "purpose": p.get("purpose", ""),
                "tone": p.get("tone", "professional"),
                "recipient_info": p.get("recipient_info"),
                "previous_emails": p.get("previous_emails"),
                "include_subject": p.get("include_subject", True),
            }
        elif atype == AgentType.CONTENT_REPURPOSE:
            return {
                "content": p.get("content", ""),
                "source_format": p.get("source_format", ""),
                "target_formats": p.get("target_formats", []),
                "preserve_key_points": p.get("preserve_key_points", True),
                "adapt_length": p.get("adapt_length", True),
            }
        elif atype == AgentType.PROOFREADING:
            return {
                "text": p.get("text", ""),
                "style_guide": p.get("style_guide"),
                "focus_areas": p.get("focus_areas"),
                "preserve_voice": p.get("preserve_voice", True),
            }
        elif atype == AgentType.REPORT_ANALYST:
            return {
                "run_id": p.get("run_id", ""),
                "analysis_type": p.get("analysis_type", "summarize"),
                "question": p.get("question"),
                "compare_run_id": p.get("compare_run_id"),
                "focus_areas": p.get("focus_areas"),
            }
        elif atype == AgentType.REPORT_PIPELINE:
            return {
                "template_id": p.get("template_id", ""),
                "connection_id": p.get("connection_id"),
                "start_date": p.get("start_date"),
                "end_date": p.get("end_date"),
                "key_values": p.get("key_values"),
                "batch_ids": p.get("batch_ids"),
                "max_retries_per_step": p.get("max_retries_per_step", 3),
                "output_formats": p.get("output_formats", ["pdf"]),
                "skip_render": p.get("skip_render", False),
            }
        else:
            raise AgentError(
                f"Unknown agent type: {atype}",
                code="UNKNOWN_AGENT_TYPE",
                retryable=False,
            )

    async def _notify_webhook(self, task: AgentTaskModel) -> None:
        """Send webhook notification for task completion."""
        if not task.webhook_url:
            return

        try:
            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    task.webhook_url,
                    json={
                        "event": "task_completed" if task.status == AgentTaskStatus.COMPLETED else "task_failed",
                        "task_id": task.task_id,
                        "status": task.status.value if isinstance(task.status, AgentTaskStatus) else task.status,
                        "result": task.result if task.status == AgentTaskStatus.COMPLETED else None,
                        "error": {
                            "code": task.error_code,
                            "message": task.error_message,
                        } if task.error_message else None,
                    },
                )
                logger.info(f"Webhook notification sent for task {task.task_id}")
        except Exception as e:
            logger.warning(f"Failed to send webhook for task {task.task_id}: {e}")

    # =========================================================================
    # TASK MANAGEMENT
    # =========================================================================

    def get_task(self, task_id: str) -> Optional[AgentTaskModel]:
        """Get a task by ID.

        Args:
            task_id: Task identifier

        Returns:
            AgentTaskModel or None if not found
        """
        return self._repo.get_task(task_id)

    def list_tasks(
        self,
        *,
        agent_type: Optional[str] = None,
        status: Optional[str] = None,
        user_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[AgentTaskModel]:
        """List tasks with optional filtering.

        Args:
            agent_type: Filter by agent type
            status: Filter by status
            user_id: Filter by user
            limit: Maximum number of tasks
            offset: Number to skip

        Returns:
            List of AgentTaskModel
        """
        # Convert string filters to enums
        agent_type_enum = None
        if agent_type:
            try:
                agent_type_enum = AgentType(agent_type)
            except ValueError:
                pass

        status_enum = None
        if status:
            try:
                status_enum = AgentTaskStatus(status)
            except ValueError:
                pass

        return self._repo.list_tasks(
            agent_type=agent_type_enum,
            status=status_enum,
            user_id=user_id,
            limit=limit,
            offset=offset,
        )

    def count_tasks(
        self,
        *,
        agent_type: Optional[str] = None,
        status: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> int:
        """Count tasks matching filters (for pagination total).

        Args:
            agent_type: Filter by agent type
            status: Filter by status
            user_id: Filter by user

        Returns:
            Total count of matching tasks
        """
        agent_type_enum = None
        if agent_type:
            try:
                agent_type_enum = AgentType(agent_type)
            except ValueError:
                pass

        status_enum = None
        if status:
            try:
                status_enum = AgentTaskStatus(status)
            except ValueError:
                pass

        return self._repo.count_tasks(
            agent_type=agent_type_enum,
            status=status_enum,
            user_id=user_id,
        )

    def cancel_task(self, task_id: str, reason: Optional[str] = None) -> AgentTaskModel:
        """Cancel a pending or running task.

        Args:
            task_id: Task identifier
            reason: Optional cancellation reason

        Returns:
            Updated AgentTaskModel

        Raises:
            TaskNotFoundError: If task doesn't exist
            TaskConflictError: If task cannot be cancelled
        """
        return self._repo.cancel_task(task_id, reason)

    async def retry_task(self, task_id: str) -> AgentTaskModel:
        """Manually retry a failed task.

        Args:
            task_id: Task identifier

        Returns:
            Updated AgentTaskModel

        Raises:
            TaskNotFoundError: If task doesn't exist
            TaskConflictError: If task cannot be retried
        """
        task = self._repo.get_task_or_raise(task_id)

        if not task.can_retry():
            raise TaskConflictError(
                f"Cannot retry task {task_id}: status={task.status}, "
                f"retryable={task.is_retryable}, attempts={task.attempt_count}/{task.max_attempts}"
            )

        # Reset to pending for re-execution
        # This is a simplified approach - in production, use the retry scheduling
        task = self._repo.claim_retry_task(task_id)
        return await self._execute_task(task_id)

    def get_task_events(self, task_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get audit events for a task.

        Args:
            task_id: Task identifier
            limit: Maximum number of events

        Returns:
            List of event dictionaries
        """
        events = self._repo.get_task_events(task_id, limit=limit)
        return [
            {
                "id": e.id,
                "event_type": e.event_type,
                "previous_status": e.previous_status,
                "new_status": e.new_status,
                "event_data": e.event_data,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ]

    def get_stats(self) -> Dict[str, Any]:
        """Get service statistics.

        Returns:
            Dictionary with task counts by status
        """
        return self._repo.get_stats()

    # =========================================================================
    # BACKGROUND WORKER (for task queue integration)
    # =========================================================================

    async def process_pending_tasks(self, limit: int = 5) -> int:
        """Process pending tasks (for worker mode).

        Uses ``claim_batch`` to atomically transition PENDING → RUNNING,
        eliminating the TOCTOU race between listing and claiming.  Claimed
        tasks are submitted to the ThreadPoolExecutor for parallel execution.

        Args:
            limit: Maximum number of tasks to process

        Returns:
            Number of tasks enqueued
        """
        with self._running_tasks_lock:
            exclude = set(self._running_tasks)

        claimed = self._repo.claim_batch(limit=limit, exclude_task_ids=exclude)
        enqueued = 0

        for task in claimed:
            try:
                self._enqueue_background(task.task_id, already_claimed=True)
                enqueued += 1
            except Exception as e:
                logger.error(f"Failed to enqueue claimed task {task.task_id}: {e}")

        return enqueued

    async def process_retry_tasks(self, limit: int = 5) -> int:
        """Process tasks ready for retry (for worker mode).

        Args:
            limit: Maximum number of tasks to process

        Returns:
            Number of tasks enqueued for retry
        """

        ready = self._repo.list_retrying_tasks(limit=limit)
        enqueued = 0

        for task in ready:
            with self._running_tasks_lock:
                if task.task_id in self._running_tasks:
                    continue

            try:
                self._repo.claim_retry_task(task.task_id)
                self._enqueue_background(task.task_id)
                enqueued += 1
            except TaskConflictError:
                logger.debug(f"Retry task {task.task_id} already claimed by another worker")
            except Exception as e:
                logger.error(f"Failed to enqueue retry task {task.task_id}: {e}")

        return enqueued

    # =========================================================================
    # BACKGROUND EXECUTION (Trade-off 1)
    # =========================================================================

    def execute_task_sync(self, task_id: str, agent_type: str, params: dict) -> None:
        """Synchronous entry point for Dramatiq worker execution.

        Creates an event loop and runs ``_execute_task`` to completion.
        Called from ``backend.app.services.worker_service.agent_tasks``.
        """
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._execute_task(task_id))
        finally:
            loop.close()

    # =========================================================================
    # BACKGROUND EXECUTION (Trade-off 1)
    # =========================================================================

    def _enqueue_background(self, task_id: str, *, already_claimed: bool = False) -> None:
        """Submit a task to the ThreadPoolExecutor for background execution.

        The executor runs in a daemon thread and persists across request
        lifecycles. Task state is tracked in SQLite so recovery is possible
        if the worker dies.

        If the executor has been shut down (server shutting down), the task
        remains in PENDING state and will be picked up by the AgentTaskWorker
        on next startup via ``recover_stale_tasks()``.

        Args:
            task_id: Task to execute
            already_claimed: If True, the task is already RUNNING (claimed by
                claim_batch); skip the claim step inside _execute_task.
        """
        # Mark the task as tracked BEFORE submitting to the executor so that
        # concurrent poll cycles do not enqueue the same task twice.
        with self._running_tasks_lock:
            if task_id in self._running_tasks:
                logger.debug(f"Task {task_id} already enqueued, skipping duplicate")
                return
            self._running_tasks.add(task_id)

        def _worker() -> None:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(self._execute_task(task_id, already_claimed=already_claimed))
                finally:
                    loop.close()
            except Exception:
                logger.exception(f"Background worker failed for task {task_id}")

        try:
            _AGENT_EXECUTOR.submit(_worker)
            logger.info(f"Task {task_id} enqueued for background execution")
        except RuntimeError:
            # Executor shut down — task stays PENDING in DB for recovery
            with self._running_tasks_lock:
                self._running_tasks.discard(task_id)
            logger.warning(
                f"Executor shut down, task {task_id} remains PENDING for recovery"
            )

    def recover_stale_tasks(self) -> int:
        """Recover tasks stuck in RUNNING state (server restart recovery).

        Should be called during application startup.

        Returns:
            Number of tasks recovered
        """
        recovered = self._repo.recover_stale_tasks()
        count = len(recovered)

        # Re-enqueue any tasks that were moved to RETRYING
        for task in recovered:
            if task.status == AgentTaskStatus.RETRYING:
                try:
                    self._repo.claim_retry_task(task.task_id)
                    self._enqueue_background(task.task_id)
                except Exception as e:
                    logger.error(f"Failed to re-enqueue recovered task {task.task_id}: {e}")

        if count:
            logger.info(f"Recovered {count} stale agent tasks on startup")
        return count

    # =========================================================================
    # PROGRESS SUBSCRIPTION (Trade-off 2 - SSE support)
    # =========================================================================

    async def stream_task_progress(
        self,
        task_id: str,
        *,
        poll_interval: float = 0.5,
        timeout: float = 300.0,
        heartbeat_interval: float = 15.0,
    ):
        """Async generator that yields progress events for SSE streaming.

        Polls the task at ``poll_interval`` seconds and yields NDJSON events
        whenever progress changes.  Emits periodic ``heartbeat`` events when
        no progress change is detected for ``heartbeat_interval`` seconds so
        proxies and browsers keep the connection alive.

        Terminates when the task reaches a terminal state or the timeout
        expires.

        Args:
            task_id: Task to stream
            poll_interval: Seconds between polls
            timeout: Maximum streaming duration in seconds
            heartbeat_interval: Seconds between heartbeat events when idle
        """
        start = time.monotonic()
        last_version = -1
        last_percent = -1
        last_emit_time = time.monotonic()

        while (time.monotonic() - start) < timeout:
            try:
                task = self._repo.get_task(task_id)
            except Exception as exc:
                logger.warning(f"DB error while streaming task {task_id}: {exc}")
                yield {
                    "event": "error",
                    "data": {"code": "DB_ERROR", "message": "Temporary database error, retrying..."},
                }
                await asyncio.sleep(poll_interval * 2)
                continue

            if task is None:
                yield {"event": "error", "data": {"code": "TASK_NOT_FOUND", "message": f"Task {task_id} not found"}}
                return

            # Only emit when something changed
            changed = task.version != last_version or task.progress_percent != last_percent

            if changed:
                last_version = task.version
                last_percent = task.progress_percent
                last_emit_time = time.monotonic()

                yield {
                    "event": "progress",
                    "data": {
                        "task_id": task.task_id,
                        "status": task.status.value if hasattr(task.status, "value") else task.status,
                        "progress": {
                            "percent": task.progress_percent,
                            "message": task.progress_message,
                            "current_step": task.current_step,
                            "total_steps": task.total_steps,
                            "current_step_num": task.current_step_num,
                        },
                    },
                }

                # Terminal state — send final event and stop
                if task.is_terminal():
                    final_data = {
                        "task_id": task.task_id,
                        "status": task.status.value if hasattr(task.status, "value") else task.status,
                    }
                    if task.status == AgentTaskStatus.COMPLETED:
                        final_data["result"] = task.result
                    elif task.error_message:
                        final_data["error"] = {
                            "code": task.error_code,
                            "message": task.error_message,
                        }
                    yield {"event": "complete", "data": final_data}
                    return

            elif (time.monotonic() - last_emit_time) >= heartbeat_interval:
                # Keep connection alive with heartbeat
                last_emit_time = time.monotonic()
                yield {
                    "event": "heartbeat",
                    "data": {"task_id": task_id, "timestamp": datetime.now(timezone.utc).isoformat()},
                }

            await asyncio.sleep(poll_interval)

        # Timeout
        yield {"event": "error", "data": {"code": "STREAM_TIMEOUT", "message": "Progress stream timed out"}}


class AgentTaskWorker:
    """
    Background worker that polls for pending and retryable agent tasks.

    This worker bridges the gap between the persistent task queue (SQLite)
    and the actual execution. It runs as a daemon thread and processes
    tasks from the repository.

    For horizontal scaling (Trade-off 3), multiple workers can run in
    separate processes. The ``claim_task`` / ``claim_retry_task`` methods
    use optimistic locking to prevent double-execution.

    Usage:
        worker = AgentTaskWorker(agent_service)
        worker.start()   # begins polling in background thread
        # ... on shutdown ...
        worker.stop()
    """

    DEFAULT_POLL_INTERVAL = int(os.getenv("NR_AGENT_POLL_INTERVAL", "5"))
    DEFAULT_BATCH_SIZE = int(os.getenv("NR_AGENT_BATCH_SIZE", "3"))

    def __init__(
        self,
        service: AgentService,
        *,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ):
        self._service = service
        self._poll_interval = poll_interval
        self._batch_size = batch_size
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._stats = {
            "pending_processed": 0,
            "retries_processed": 0,
            "errors": 0,
            "cycles": 0,
        }

    @property
    def is_running(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    @property
    def stats(self) -> dict:
        return dict(self._stats)

    def start(self) -> bool:
        """Start the worker polling loop in a daemon thread."""
        if self.is_running:
            logger.warning("Agent task worker already running")
            return False

        self._stop_event.clear()
        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop,
            name="AgentTaskWorker",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            f"Agent task worker started (poll={self._poll_interval}s, batch={self._batch_size})"
        )
        return True

    def stop(self, timeout: float = 10) -> bool:
        """Stop the worker."""
        if not self._running:
            return True
        self._running = False
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            if self._thread.is_alive():
                logger.warning("Agent task worker stop timed out")
                return False
        logger.info(f"Agent task worker stopped. Stats: {self._stats}")
        return True

    def _run_loop(self) -> None:
        """Main polling loop - runs in background thread."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            while self._running and not self._stop_event.is_set():
                try:
                    self._stats["cycles"] += 1

                    # Process pending tasks
                    pending = loop.run_until_complete(
                        self._service.process_pending_tasks(limit=self._batch_size)
                    )
                    self._stats["pending_processed"] += pending

                    # Process retryable tasks
                    retried = loop.run_until_complete(
                        self._service.process_retry_tasks(limit=self._batch_size)
                    )
                    self._stats["retries_processed"] += retried

                except Exception:
                    self._stats["errors"] += 1
                    logger.exception("Agent task worker cycle error")

                self._stop_event.wait(timeout=self._poll_interval)
        finally:
            loop.close()


# Singleton instances
agent_service = AgentService()
agent_task_worker = AgentTaskWorker(agent_service)

# Section: __init__

"""
AI Agents Service Module
"""
# Legacy imports for backward compatibility
from backend.app.repositories import AgentTaskStatus
from backend.app.repositories import (
    TaskConflictError,
    TaskNotFoundError,
)

# Aliases for backward compatibility
LegacyAgentService = AgentService  # noqa: keep for compat
legacy_agent_service = agent_service
LegacyResearchAgent = LegacyResearchAgentImpl
ResearchReportV2 = ResearchReport
DataAnalystAgentV2 = DataAnalystAgent
DataAnalysisReportV2 = DataAnalysisReport
EmailDraftResultV2 = EmailDraftResult
ContentRepurposeReportV2 = ContentRepurposeReport
ProofreadingReportV2 = ProofreadingReport
agent_service_v2 = agent_service
