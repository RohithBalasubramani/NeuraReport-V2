"""API route modules for the NeuraReport FastAPI application."""
from __future__ import annotations

import types

from .routes_a import (
    connections_router,
    templates_router,
    reports_router,
    jobs_router,
    schedules_router,
    state_router,
    legacy_router,
    charts_router,
    widgets_router,
    ai_router,
    nl2sql_router,
    enrichment_router,
    federation_router,
    recommendations_router,
    summary_router,
    synthesis_router,
    docqa_router,
    docai_router,
    agents_router,
    agents_v2_router,
    documents_router,
    ws_router,
    spreadsheets_router,
)
from .routes_b import (
    connectors_router,
    workflows_router,
    export_router,
    design_router,
    excel_router,
    knowledge_router,
    ingestion_router,
    search_router,
    visualization_router,
    health_router,
    settings_router,
    preferences_router,
    favorites_router,
    notifications_router,
    audit_router,
    logger_router,
    feedback_router,
    assistant_router,
    analytics_router,
    dashboards_router,
)

# ---------------------------------------------------------------------------
# Namespace shims so that ``router.py`` can do e.g. ``connections.router``
# ---------------------------------------------------------------------------

connections = types.SimpleNamespace(router=connections_router)
templates = types.SimpleNamespace(router=templates_router)
reports = types.SimpleNamespace(router=reports_router)
jobs = types.SimpleNamespace(router=jobs_router)
schedules = types.SimpleNamespace(router=schedules_router)
state = types.SimpleNamespace(router=state_router)

ai = types.SimpleNamespace(router=ai_router)
nl2sql = types.SimpleNamespace(router=nl2sql_router)
enrichment = types.SimpleNamespace(router=enrichment_router)
federation = types.SimpleNamespace(router=federation_router)
recommendations = types.SimpleNamespace(router=recommendations_router)
summary = types.SimpleNamespace(router=summary_router)
synthesis = types.SimpleNamespace(router=synthesis_router)
docqa = types.SimpleNamespace(router=docqa_router)
docai = types.SimpleNamespace(router=docai_router)

analytics = types.SimpleNamespace(router=analytics_router)
dashboards = types.SimpleNamespace(router=dashboards_router)

agents = types.SimpleNamespace(router=agents_router)
agents_v2 = types.SimpleNamespace(router=agents_v2_router)

knowledge = types.SimpleNamespace(router=knowledge_router)
ingestion = types.SimpleNamespace(router=ingestion_router)
search = types.SimpleNamespace(router=search_router)
visualization = types.SimpleNamespace(router=visualization_router)

connectors = types.SimpleNamespace(router=connectors_router)
workflows = types.SimpleNamespace(router=workflows_router)

export = types.SimpleNamespace(router=export_router)
design = types.SimpleNamespace(router=design_router)
excel = types.SimpleNamespace(router=excel_router)

health = types.SimpleNamespace(router=health_router)
settings = types.SimpleNamespace(router=settings_router, preferences_router=preferences_router)
favorites = types.SimpleNamespace(router=favorites_router)
notifications = types.SimpleNamespace(router=notifications_router)
audit = types.SimpleNamespace(router=audit_router)
logger = types.SimpleNamespace(router=logger_router)
feedback = types.SimpleNamespace(router=feedback_router)
assistant = types.SimpleNamespace(router=assistant_router)

documents = types.SimpleNamespace(router=documents_router, ws_router=ws_router)
spreadsheets = types.SimpleNamespace(router=spreadsheets_router)

legacy = types.SimpleNamespace(router=legacy_router)
charts = types.SimpleNamespace(router=charts_router)
widgets = types.SimpleNamespace(router=widgets_router)

__all__ = [
    "agents", "agents_v2", "ai", "assistant", "analytics", "audit",
    "charts", "connections", "connectors", "dashboards", "design",
    "docai", "docqa", "documents", "enrichment", "excel", "export",
    "favorites", "feedback", "federation", "health", "ingestion",
    "jobs", "knowledge", "legacy", "logger", "nl2sql", "notifications",
    "recommendations", "reports", "schedules", "search", "settings",
    "spreadsheets", "state", "summary", "synthesis", "templates",
    "visualization", "widgets", "workflows",
]
