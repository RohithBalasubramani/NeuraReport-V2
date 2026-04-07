"""Centralized API Router Registration.

This module registers all API routes in a single location, providing
a unified entry point for the FastAPI application.

API Versioning:
    All API routes are mounted under /api/v1/ for forward-compatible versioning.
    Health-check and auth routes are additionally mounted at the root for
    backward compatibility and infrastructure probes.
"""
from __future__ import annotations

from fastapi import APIRouter, FastAPI

from .routes import (
    agents,
    agents_v2,
    ai,
    assistant,
    analytics,
    audit,
    charts,
    connections,
    connectors,
    dashboards,
    design,
    docai,
    docqa,
    documents,
    enrichment,
    excel,
    export,
    favorites,
    feedback,
    federation,
    health,
    ingestion,
    jobs,
    knowledge,
    legacy,
    logger,
    nl2sql,
    notifications,
    recommendations,
    reports,
    schedules,
    search,
    settings,
    spreadsheets,
    state,
    summary,
    synthesis,
    templates,
    visualization,
    pipeline_data,
    widgets,
    workflows,
)
from backend.app.api.middleware import router as analyze_router
from backend.app.api.middleware import enhanced_router as _enhanced_analysis_router
from backend.app.services.config import auth_backend, fastapi_users, UserCreate, UserRead, UserUpdate

API_V1_PREFIX = "/api/v1"


def _build_v1_router() -> APIRouter:
    """Build the versioned v1 API router with all feature routes."""
    v1 = APIRouter()

    # Auth
    v1.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth/jwt", tags=["auth"])
    v1.include_router(fastapi_users.get_register_router(UserRead, UserCreate), prefix="/auth", tags=["auth"])
    v1.include_router(fastapi_users.get_users_router(UserRead, UserUpdate), prefix="/users", tags=["users"])

    # Health
    v1.include_router(health.router, tags=["health"])

    # Core
    v1.include_router(connections.router, prefix="/connections", tags=["connections"])
    v1.include_router(templates.router, prefix="/templates", tags=["templates"])
    v1.include_router(excel.router, prefix="/excel", tags=["excel"])
    v1.include_router(reports.router, prefix="/reports", tags=["reports"])
    v1.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
    v1.include_router(schedules.router, prefix="/reports/schedules", tags=["schedules"])
    v1.include_router(state.router, prefix="/state", tags=["state"])

    # Document analysis
    v1.include_router(analyze_router, prefix="/analyze", tags=["analyze"])
    v1.include_router(_enhanced_analysis_router)

    # Analytics
    v1.include_router(analytics.router, prefix="/analytics", tags=["analytics"])

    # In-product Assistant
    v1.include_router(assistant.router, prefix="/assistant", tags=["assistant"])

    # AI Features
    v1.include_router(ai.router, prefix="/ai", tags=["ai"])
    v1.include_router(nl2sql.router, prefix="/nl2sql", tags=["nl2sql"])
    v1.include_router(enrichment.router, prefix="/enrichment", tags=["enrichment"])
    v1.include_router(federation.router, prefix="/federation", tags=["federation"])
    v1.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
    v1.include_router(charts.router, prefix="/charts", tags=["charts"])
    v1.include_router(summary.router, prefix="/summary", tags=["summary"])
    v1.include_router(synthesis.router, prefix="/synthesis", tags=["synthesis"])
    v1.include_router(docqa.router, prefix="/docqa", tags=["docqa"])
    v1.include_router(docai.router, prefix="/docai", tags=["docai"])

    # Document editing and collaboration
    v1.include_router(documents.router, prefix="/documents", tags=["documents"])
    v1.include_router(documents.ws_router)
    v1.include_router(spreadsheets.router, prefix="/spreadsheets", tags=["spreadsheets"])
    v1.include_router(dashboards.router, prefix="/dashboards", tags=["dashboards"])
    v1.include_router(connectors.router, prefix="/connectors", tags=["connectors"])

    # Workflow automation
    v1.include_router(workflows.router, prefix="/workflows", tags=["workflows"])

    # Export and distribution
    v1.include_router(export.router, prefix="/export", tags=["export"])

    # Design and branding
    v1.include_router(design.router, prefix="/design", tags=["design"])

    # Knowledge management
    v1.include_router(knowledge.router, prefix="/knowledge", tags=["knowledge"])

    # Document ingestion
    v1.include_router(ingestion.router, prefix="/ingestion", tags=["ingestion"])

    # Search and discovery
    v1.include_router(search.router, prefix="/search", tags=["search"])

    # Visualization and diagrams
    v1.include_router(visualization.router, prefix="/visualization", tags=["visualization"])

    # Widget Intelligence
    v1.include_router(widgets.router, prefix="/widgets", tags=["widgets"])

    # AI Agents
    v1.include_router(agents.router, prefix="/agents", tags=["agents"])
    v1.include_router(agents_v2.router, prefix="/agents/v2", tags=["agents-v2"])

    # Logger integration
    v1.include_router(logger.router, prefix="/logger", tags=["logger"])

    # Audit trail
    v1.include_router(audit.router, prefix="/audit", tags=["audit"])

    # Quality feedback (V2)
    v1.include_router(feedback.router, prefix="/feedback", tags=["feedback"])

    # User preferences, favorites, notifications
    v1.include_router(settings.router, prefix="/settings", tags=["settings"])
    v1.include_router(settings.preferences_router, prefix="/preferences", tags=["preferences"])
    v1.include_router(favorites.router, prefix="/favorites", tags=["favorites"])
    v1.include_router(notifications.router, prefix="/notifications", tags=["notifications"])

    # Unified chat pipeline
    from backend.app.api.routes.routes_a import pipeline_router
    v1.include_router(pipeline_router, prefix="/pipeline", tags=["pipeline"])

    # Widget data endpoints (non-LLM backend widgets)
    v1.include_router(pipeline_data.router, prefix="/pipeline/data", tags=["pipeline-data"])

    return v1


def register_routes(app: FastAPI) -> None:
    """Register all API routes with the FastAPI application.

    Routes are served under both ``/api/v1/`` (versioned) and ``/`` (legacy
    backward-compatible) so existing clients continue to work while new
    clients can adopt the versioned prefix.
    """
    v1_router = _build_v1_router()

    # Mount versioned routes under /api/v1
    app.include_router(v1_router, prefix=API_V1_PREFIX)

    # Backward-compatible: mount the same v1 router at root so existing
    # clients continue to work without the /api/v1 prefix.
    # Exclude legacy root routes from the OpenAPI schema so `/api/v1` is the
    # single source of truth for client code generation.
    app.include_router(v1_router, include_in_schema=False)

    # Legacy/compatibility routes (always at root only)
    app.include_router(legacy.router, include_in_schema=False)
