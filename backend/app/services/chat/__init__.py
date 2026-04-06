"""Unified chat pipeline — session, intent, orchestration, context, agent."""
from __future__ import annotations

from .session import ChatSession, PipelineState
from .intent import classify_intent
from .orchestrator import ChatPipelineOrchestrator
from .context_builder import build_pipeline_context, build_conversation_context
from .hermes_agent import HermesAgent
from .chat_history import ChatHistory
from .hermes_adapter import register_pipeline_tools, CallbackBridge

__all__ = [
    "ChatSession",
    "PipelineState",
    "classify_intent",
    "ChatPipelineOrchestrator",
    "build_pipeline_context",
    "build_conversation_context",
    "HermesAgent",
    "ChatHistory",
    "register_pipeline_tools",
    "CallbackBridge",
]
