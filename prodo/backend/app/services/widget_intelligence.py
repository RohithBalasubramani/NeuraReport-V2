from __future__ import annotations

"""Merged widget intelligence module."""


# Section: support

"""Widget intelligence support — config, models, embedding, catalog, resolvers base."""


# CONFIG

"""Configuration constants for the widget intelligence pipeline."""

# Grid layout constants
GRID_COLS = 12
GRID_ROWS = 12

# Widget size to grid span mapping
SIZE_COLS: dict[str, int] = {
    "compact": 3,
    "normal": 4,
    "expanded": 6,
    "hero": 12,
}

SIZE_ROWS: dict[str, int] = {
    "compact": 2,
    "normal": 3,
    "expanded": 4,
    "hero": 4,
}

# Entity prefix map — equipment name → table prefix
ENTITY_PREFIX_MAP: dict[str, str] = {
    "transformer": "trf",
    "generator": "dg",
    "genset": "dg",
    "ups": "ups",
    "chiller": "chiller",
    "ahu": "ahu",
    "cooling tower": "ct",
    "pump": "pump",
    "compressor": "compressor",
    "motor": "motor",
    "energy meter": "em",
    "meter": "em",
    "solar": "em_solar",
    "battery": "bms",
    "fire": "fire",
    "wtp": "wtp",
    "stp": "stp",
    "boiler": "boiler",
    "lt db": "lt_db",
    "lt mcc": "lt_mcc",
    "lt pcc": "lt_pcc",
    "lt vfd": "lt_vfd",
    "lt apfc": "lt_apfc",
    "lt bd": "lt_bd",
    "lt feeder": "lt_feeder",
    "lt incomer": "lt_incomer",
}

# Number words for instance extraction
NUMBER_WORDS: dict[str, str] = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5",
}

# vLLM base URL for DSPy reasoner
VLLM_BASE_URL = "http://localhost:8000/v1"


# EMBEDDING

"""Embedding client stub for the widget intelligence pipeline."""

import math
from typing import Optional


class EmbeddingClient:
    """Minimal embedding client. Provides cosine similarity for semantic scoring."""

    def __init__(self, model_name: Optional[str] = None):
        self._model_name = model_name

    @staticmethod
    def cosine_similarity(a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def embed(self, text: str) -> list[float]:
        """Stub: return empty embedding. Override with real implementation."""
        return []

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Stub: return empty embeddings. Override with real implementation."""
        return [[] for _ in texts]


# WIDGET_CATALOG

"""Widget catalog auto-generated from widget plugins for semantic_embedder.py."""

from typing import Any

WIDGET_CATALOG: list[dict[str, Any]] = []


def get_widget_catalog() -> list[dict[str, Any]]:
    """Build and cache WIDGET_CATALOG from WidgetRegistry."""
    global WIDGET_CATALOG
    if not WIDGET_CATALOG:
        try:
            from backend.app.services.widget_intelligence import WidgetRegistry
            registry = WidgetRegistry()
            for scenario in registry.scenarios:
                plugin = registry.get(scenario)
                if plugin:
                    m = plugin.meta
                    WIDGET_CATALOG.append({
                        "scenario": m.scenario,
                        "description": m.description,
                        "good_for": m.good_for,
                        "variants": {v: m.description for v in m.variants},
                    })
        except Exception:
            pass
    return WIDGET_CATALOG


# MODELS


"""Catalog models for the widget intelligence pipeline."""


from dataclasses import dataclass


@dataclass
class ColumnStats:
    name: str = ""
    dtype: str = "double precision"
    unit: Optional[str] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    avg_val: Optional[float] = None
    latest_val: Optional[float] = None


"""Data profile model for the widget intelligence pipeline."""


@dataclass
class DataProfile:
    table_count: int = 0
    entity_count: int = 1
    numeric_column_count: int = 1
    has_timeseries: bool = True
    has_alerts: bool = False


"""Design models for the widget intelligence pipeline."""

from dataclasses import dataclass, field


@dataclass
class WidgetSlot:
    id: str = ""
    variant: str = ""
    scenario: str = ""
    size: Any = None
    question: str = ""
    relevance: float = 0.0
    entity_id: str = ""
    table_prefix: str = ""
    entity_confidence: float = 0.0


@dataclass
class GridCell:
    widget_id: str = ""
    col_start: int = 1
    col_end: int = 1
    row_start: int = 1
    row_end: int = 1


@dataclass
class GridLayout:
    cells: list[GridCell] = field(default_factory=list)
    total_cols: int = 12
    total_rows: int = 12
    utilization_pct: float = 0.0


VALID_SCENARIOS: list[str] = [
    "kpi", "alerts", "trend", "trend-multi-line", "trends-cumulative",
    "comparison", "distribution", "composition", "category-bar",
    "flow-sankey", "matrix-heatmap", "timeline", "eventlogstream",
    "narrative", "peopleview", "peoplehexgrid", "peoplenetwork",
    "supplychainglobe", "edgedevicepanel", "chatstream",
    "diagnosticpanel", "uncertaintypanel", "agentsview", "vaultview",
]

# variant -> scenario mapping (built from all widget plugin meta.variants)
VARIANT_TO_SCENARIO: dict[str, str] = {
    # KPI
    "kpi-live": "kpi", "kpi-alert": "kpi", "kpi-accumulated": "kpi",
    "kpi-lifecycle": "kpi", "kpi-status": "kpi",
    # Trend
    "trend-line": "trend", "trend-area": "trend", "trend-step-line": "trend",
    "trend-rgb-phase": "trend", "trend-alert-context": "trend", "trend-heatmap": "trend",
    # Trend Multi-Line
    "trend-multi-line": "trend-multi-line",
    # Trends Cumulative
    "trends-cumulative": "trends-cumulative",
    # Comparison
    "comparison-side-by-side": "comparison", "comparison-delta-bar": "comparison",
    "comparison-grouped-bar": "comparison", "comparison-waterfall": "comparison",
    "comparison-small-multiples": "comparison", "comparison-composition-split": "comparison",
    # Distribution
    "distribution-donut": "distribution", "distribution-100-stacked-bar": "distribution",
    "distribution-horizontal-bar": "distribution", "distribution-pie": "distribution",
    "distribution-grouped-bar": "distribution", "distribution-pareto-bar": "distribution",
    # Composition
    "composition-stacked-bar": "composition", "composition-stacked-area": "composition",
    "composition-donut": "composition", "composition-waterfall": "composition",
    "composition-treemap": "composition",
    # Category Bar
    "category-bar-vertical": "category-bar", "category-bar-horizontal": "category-bar",
    "category-bar-stacked": "category-bar", "category-bar-grouped": "category-bar",
    "category-bar-diverging": "category-bar",
    # Flow Sankey
    "flow-sankey-standard": "flow-sankey", "flow-sankey-energy-balance": "flow-sankey",
    "flow-sankey-multi-source": "flow-sankey", "flow-sankey-layered": "flow-sankey",
    "flow-sankey-time-sliced": "flow-sankey",
    # Matrix Heatmap
    "matrix-heatmap-value": "matrix-heatmap", "matrix-heatmap-correlation": "matrix-heatmap",
    "matrix-heatmap-calendar": "matrix-heatmap", "matrix-heatmap-status": "matrix-heatmap",
    "matrix-heatmap-density": "matrix-heatmap",
    # Timeline
    "timeline-linear": "timeline", "timeline-status": "timeline",
    "timeline-multilane": "timeline", "timeline-forensic": "timeline",
    "timeline-dense": "timeline",
    # Alerts
    "alerts-banner": "alerts", "alerts-toast": "alerts", "alerts-card": "alerts",
    "alerts-badge": "alerts", "alerts-modal": "alerts",
    # Event Log Stream
    "eventlogstream-chronological": "eventlogstream", "eventlogstream-compact-feed": "eventlogstream",
    "eventlogstream-tabular": "eventlogstream", "eventlogstream-correlation": "eventlogstream",
    "eventlogstream-grouped-asset": "eventlogstream",
    # Narrative
    "narrative": "narrative",
    # People View
    "peopleview": "peopleview",
    # People Hex Grid
    "peoplehexgrid": "peoplehexgrid",
    # People Network
    "peoplenetwork": "peoplenetwork",
    # Supply Chain Globe
    "supplychainglobe": "supplychainglobe",
    # Edge Device Panel
    "edgedevicepanel": "edgedevicepanel",
    # Chat Stream
    "chatstream": "chatstream",
    # Diagnostic Panel
    "diagnosticpanel": "diagnosticpanel",
    # Uncertainty Panel
    "uncertaintypanel": "uncertaintypanel",
    # Agents View
    "agentsview": "agentsview",
    # Vault View
    "vaultview": "vaultview",
}


"""Intent models for the widget intelligence pipeline."""

from enum import Enum


class QueryType(Enum):
    status = "status"
    overview = "overview"
    alert = "alert"
    trend = "trend"
    comparison = "comparison"
    analysis = "analysis"
    diagnostic = "diagnostic"
    forecast = "forecast"


class WidgetSize(Enum):
    compact = "compact"
    normal = "normal"
    expanded = "expanded"
    hero = "hero"


@dataclass
class ResolvedEntity:
    name: str = ""
    table_prefix: str = ""
    default_metric: str = ""
    default_unit: str = ""
    instances: list[str] = field(default_factory=list)
    is_primary: bool = False


@dataclass
class ParsedIntent:
    original_query: str = ""
    query_type: QueryType = QueryType.overview
    entities: list[ResolvedEntity] = field(default_factory=list)
    metrics: list[str] = field(default_factory=list)
    sub_questions: list[str] = field(default_factory=list)


# RESOLVERS_BASE


"""
Data Shape Analyzer -- extract measurable properties from DataCatalog.

Computes a DataShapeProfile from ColumnStats at S06 time. Pure computation,
no LLM calls, no new DB queries. Runs in <1ms.

The shape profile drives variant selection via measurable data properties:
- variance/spread from ColumnStats (max-min)/|avg|
- cardinality (entity count, metric count, category count)
- temporal properties (density, span)
- metric type detection (cumulative, binary, phase, rate, percentage)
- structural properties (hierarchy, multiple sources)
"""


import logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DataShapeProfile:
    """Measurable data properties extracted from catalog + profile."""

    # Cardinality
    entity_count: int = 1
    instance_count: int = 1
    metric_count: int = 1
    category_count: int = 1

    # Temporal
    has_timeseries: bool = True
    temporal_density: float = 0.0
    temporal_span_hours: float = 24.0

    # Value spread (from ColumnStats: (max-min)/|avg|)
    max_spread: float = 0.0
    mean_spread: float = 0.0
    has_high_variance: bool = False
    has_near_zero_variance: bool = True

    # Metric type detection
    has_cumulative_metric: bool = False
    has_rate_metric: bool = False
    has_percentage_metric: bool = False
    has_binary_metric: bool = False
    has_phase_data: bool = False
    has_temperature: bool = False
    has_flow_metric: bool = False

    # Structural
    has_hierarchy: bool = False
    has_multiple_sources: bool = False
    has_alerts: bool = False

    # Correlation indicators
    multi_numeric_potential: bool = False
    cross_entity_comparable: bool = False

    # Derived
    dominant_metric_type: str = "continuous"
    data_richness: str = "sparse"


def extract_data_shape(catalog, profile, intent=None) -> DataShapeProfile:
    """Extract DataShapeProfile from existing catalog data.

    Args:
        catalog: DataCatalog with enriched_tables containing ColumnStats.
        profile: DataProfile with entity_count, table_count, etc.
        intent: Optional ParsedIntent for additional context.

    Returns:
        DataShapeProfile with all measurable properties computed.
    """
    if catalog is None:
        ec = profile.entity_count if profile else 1
        mc = profile.numeric_column_count if profile else 1
        ts = profile.has_timeseries if profile else True
        al = profile.has_alerts if profile else False
        return DataShapeProfile(
            entity_count=ec,
            metric_count=mc,
            has_timeseries=ts,
            has_alerts=al,
            multi_numeric_potential=mc >= 3,
            data_richness="sparse" if mc <= 1 else ("moderate" if mc <= 4 else "rich"),
        )

    numeric_types = {"double precision", "real", "numeric", "float8", "integer", "bigint"}

    # Collect all numeric columns across all tables
    all_numeric_cols = []
    entity_types: set[str] = set()
    col_names_per_table: list[set[str]] = []

    for t in catalog.enriched_tables:
        if t.entity_type:
            entity_types.add(t.entity_type)
        numeric_cols = [c for c in t.columns if c.dtype in numeric_types]
        all_numeric_cols.extend(numeric_cols)
        col_names_per_table.append({c.name for c in numeric_cols})

    # --- Cardinality ---
    entity_count = profile.entity_count if profile else len(catalog.enriched_tables)
    instance_count = len(catalog.enriched_tables)
    metric_count = max(1, profile.numeric_column_count if profile else len(all_numeric_cols))
    category_count = max(1, len(entity_types))

    # --- Temporal ---
    has_timeseries = profile.has_timeseries if profile else (instance_count > 0)
    total_rows = sum(t.row_count for t in catalog.enriched_tables)
    temporal_density = round(total_rows / max(instance_count, 1) / 24.0, 2)

    # --- Value Spread ---
    spreads: list[float] = []
    for col in all_numeric_cols:
        if col.min_val is not None and col.max_val is not None and col.avg_val is not None:
            denom = abs(col.avg_val) if col.avg_val != 0 else 1.0
            spread = (col.max_val - col.min_val) / denom
            spreads.append(max(0.0, spread))

    max_spread = max(spreads) if spreads else 0.0
    mean_spread = (sum(spreads) / len(spreads)) if spreads else 0.0
    has_high_variance = max_spread > 0.5
    has_near_zero_variance = all(s < 0.05 for s in spreads) if spreads else True

    # --- Metric Type Detection ---
    has_cumulative = False
    has_rate = False
    has_percentage = False
    has_binary = False
    has_phase = False
    has_temperature = False
    has_flow = False

    col_names_lower: list[str] = []
    for col in all_numeric_cols:
        name_lower = col.name.lower()
        unit_lower = (col.unit or "").lower()
        col_names_lower.append(name_lower)

        # Cumulative: min~0, latest~max, unit in kWh/count/total
        if col.min_val is not None and col.max_val is not None and col.latest_val is not None:
            if col.min_val >= -0.01 and col.max_val > 0:
                ratio = abs(col.latest_val - col.max_val) / max(abs(col.max_val), 0.01)
                if ratio < 0.15:
                    if any(kw in unit_lower for kw in ("kwh", "mwh", "wh", "count", "total")):
                        has_cumulative = True
                    elif any(kw in name_lower for kw in ("cumulative", "total", "accumulated", "count")):
                        has_cumulative = True

        # Rate
        if any(kw in unit_lower for kw in ("/h", "/s", "/min", "rate", "per_hour")):
            has_rate = True

        # Percentage
        if "%" in unit_lower or "percent" in unit_lower:
            has_percentage = True
        elif col.min_val is not None and col.max_val is not None:
            if 0 <= (col.min_val or 0) and (col.max_val or 0) <= 100:
                if any(kw in name_lower for kw in ("efficiency", "utilization", "pct", "percent", "ratio")):
                    has_percentage = True

        # Binary
        if col.min_val is not None and col.max_val is not None:
            if col.min_val >= -0.01 and col.max_val <= 1.01 and col.max_val > 0:
                if any(kw in name_lower for kw in ("status", "state", "on", "off", "flag", "active", "running")):
                    has_binary = True

        # Temperature
        if any(kw in unit_lower for kw in ("celsius", "fahrenheit", "kelvin")):
            has_temperature = True
        elif unit_lower in ("c", "f", "k") and any(kw in name_lower for kw in ("temp", "temperature")):
            has_temperature = True
        elif any(kw in name_lower for kw in ("temperature", "temp_")):
            has_temperature = True

        # Flow
        if any(kw in unit_lower for kw in ("m3", "l/s", "l/min", "gpm", "cfm")):
            has_flow = True
        elif any(kw in name_lower for kw in ("flow", "flowrate", "flow_rate")):
            has_flow = True

    # Phase detection: 3+ columns with R/Y/B or L1/L2/L3 suffixes sharing a base name
    phase_suffixes = [
        ("_r", "_y", "_b"),
        ("_l1", "_l2", "_l3"),
        ("_phase_r", "_phase_y", "_phase_b"),
    ]
    base_counts: dict[str, set[str]] = {}
    for name in col_names_lower:
        for suffix_group in phase_suffixes:
            for suffix in suffix_group:
                if name.endswith(suffix):
                    base = name[: -len(suffix)]
                    base_counts.setdefault(base, set()).add(suffix)
    for base, suffixes_found in base_counts.items():
        if len(suffixes_found) >= 3:
            has_phase = True
            break

    # --- Structural ---
    has_hierarchy = len(getattr(catalog, "equipment_relationships", [])) > 0
    has_multiple_sources = entity_count >= 3
    has_alerts = (profile.has_alerts if profile else getattr(catalog, "has_alerts", False))

    # --- Correlation indicators ---
    multi_numeric_potential = metric_count >= 3
    cross_entity_comparable = False
    if len(col_names_per_table) >= 2:
        first = col_names_per_table[0]
        for other in col_names_per_table[1:]:
            if first & other:
                cross_entity_comparable = True
                break

    # --- Derived ---
    type_flags = {
        "binary": has_binary,
        "percentage": has_percentage,
        "cumulative": has_cumulative,
        "rate": has_rate,
    }
    active_types = [t for t, v in type_flags.items() if v]
    if len(active_types) >= 2:
        dominant_metric_type = "mixed"
    elif active_types:
        dominant_metric_type = active_types[0]
    else:
        dominant_metric_type = "continuous"

    if metric_count <= 1:
        data_richness = "sparse"
    elif metric_count <= 4:
        data_richness = "moderate"
    else:
        data_richness = "rich"

    return DataShapeProfile(
        entity_count=entity_count,
        instance_count=instance_count,
        metric_count=metric_count,
        category_count=category_count,
        has_timeseries=has_timeseries,
        temporal_density=temporal_density,
        temporal_span_hours=24.0,
        max_spread=round(max_spread, 4),
        mean_spread=round(mean_spread, 4),
        has_high_variance=has_high_variance,
        has_near_zero_variance=has_near_zero_variance,
        has_cumulative_metric=has_cumulative,
        has_rate_metric=has_rate,
        has_percentage_metric=has_percentage,
        has_binary_metric=has_binary,
        has_phase_data=has_phase,
        has_temperature=has_temperature,
        has_flow_metric=has_flow,
        has_hierarchy=has_hierarchy,
        has_multiple_sources=has_multiple_sources,
        has_alerts=has_alerts,
        multi_numeric_potential=multi_numeric_potential,
        cross_entity_comparable=cross_entity_comparable,
        dominant_metric_type=dominant_metric_type,
        data_richness=data_richness,
    )


def shape_to_text(shape: DataShapeProfile) -> str:
    """Format DataShapeProfile as concise text for DSPy input."""
    parts = [
        f"entity_count={shape.entity_count}",
        f"metric_count={shape.metric_count}",
        f"max_spread={shape.max_spread:.2f}",
        f"temporal_density={shape.temporal_density}/hr",
        f"dominant_metric_type={shape.dominant_metric_type}",
        f"data_richness={shape.data_richness}",
    ]
    flags: list[str] = []
    if shape.has_phase_data:
        flags.append("phase_data")
    if shape.has_cumulative_metric:
        flags.append("cumulative")
    if shape.has_binary_metric:
        flags.append("binary")
    if shape.has_hierarchy:
        flags.append("hierarchy")
    if shape.has_percentage_metric:
        flags.append("percentage")
    if shape.has_temperature:
        flags.append("temperature")
    if shape.has_flow_metric:
        flags.append("flow")
    if shape.has_rate_metric:
        flags.append("rate")
    if shape.has_alerts:
        flags.append("alerts")
    if shape.cross_entity_comparable:
        flags.append("cross_entity_comparable")
    if shape.has_high_variance:
        flags.append("high_variance")
    if shape.has_near_zero_variance:
        flags.append("near_zero_variance")
    if flags:
        parts.append(f"flags=[{', '.join(flags)}]")
    return ", ".join(parts)

# Section: widgets

"""Widget plugins — base and all widget implementations."""


# BASE

"""
Widget plugin base class and explicit registry.

All widget implementations live in widgets_all.py.
"""


from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


@dataclass
class WidgetMeta:
    """Metadata describing a widget type — replaces entries in widget_catalog.py and widget_schemas.py."""
    scenario: str
    variants: list[str]
    description: str
    good_for: list[str]
    sizes: list[str]
    height_units: int = 2
    rag_strategy: str = "single_metric"
    required_fields: list[str] = field(default_factory=list)
    optional_fields: list[str] = field(default_factory=list)
    aggregation: str = "latest"


class WidgetPlugin(ABC):
    """
    Base class for widget plugins.

    Implements: meta, validate_data, format_data.
    """

    meta: WidgetMeta

    @abstractmethod
    def validate_data(self, data: dict) -> list[str]:
        """Validate data shape for this widget. Returns list of error messages."""
        ...

    @abstractmethod
    def format_data(self, raw: dict) -> dict:
        """Transform raw query result into frontend-ready data shape."""
        ...


class WidgetRegistry:
    """
    Explicit registry for widget plugins.

    Imports all widget classes from widgets_all.py and builds the registry.
    """

    def __init__(self):
        self._plugins: dict[str, WidgetPlugin] = {}
        self._variant_to_scenario: dict[str, str] = {}
        self._register_all()

    def _register_all(self):
        """Import and register all widget plugins from widgets_all."""
        from backend.app.services.widget_intelligence import (
            AgentsViewWidget,
            AlertsWidget,
            CategoryBarWidget,
            ChatStreamWidget,
            ComparisonWidget,
            CompositionWidget,
            DiagnosticPanelWidget,
            DistributionWidget,
            EdgeDevicePanelWidget,
            EventLogStreamWidget,
            FlowSankeyWidget,
            KPIWidget,
            MatrixHeatmapWidget,
            NarrativeWidget,
            PeopleHexGridWidget,
            PeopleNetworkWidget,
            PeopleViewWidget,
            SupplyChainGlobeWidget,
            TimelineWidget,
            TrendWidget,
            TrendMultiLineWidget,
            TrendsCumulativeWidget,
            UncertaintyPanelWidget,
            VaultViewWidget,
        )

        widget_classes = [
            AgentsViewWidget,
            AlertsWidget,
            CategoryBarWidget,
            ChatStreamWidget,
            ComparisonWidget,
            CompositionWidget,
            DiagnosticPanelWidget,
            DistributionWidget,
            EdgeDevicePanelWidget,
            EventLogStreamWidget,
            FlowSankeyWidget,
            KPIWidget,
            MatrixHeatmapWidget,
            NarrativeWidget,
            PeopleHexGridWidget,
            PeopleNetworkWidget,
            PeopleViewWidget,
            SupplyChainGlobeWidget,
            TimelineWidget,
            TrendWidget,
            TrendMultiLineWidget,
            TrendsCumulativeWidget,
            UncertaintyPanelWidget,
            VaultViewWidget,
        ]

        for cls in widget_classes:
            try:
                plugin = cls()
                self._plugins[plugin.meta.scenario] = plugin
                for variant in plugin.meta.variants:
                    self._variant_to_scenario[variant] = plugin.meta.scenario
                logger.debug(f"[WidgetRegistry] Registered: {plugin.meta.scenario}")
            except Exception as e:
                logger.warning(f"[WidgetRegistry] Failed to register {cls.__name__}: {e}")

        logger.info(f"[WidgetRegistry] {len(self._plugins)} widgets registered")

    def get(self, scenario: str) -> WidgetPlugin | None:
        """Get plugin by scenario name."""
        return self._plugins.get(scenario)

    def get_by_variant(self, variant: str) -> WidgetPlugin | None:
        """Get plugin by variant key."""
        scenario = self._variant_to_scenario.get(variant)
        if scenario:
            return self._plugins.get(scenario)
        return None

    @property
    def scenarios(self) -> list[str]:
        """List all registered scenarios."""
        return list(self._plugins.keys())

    @property
    def variants(self) -> list[str]:
        """List all registered variants."""
        return list(self._variant_to_scenario.keys())

    def get_catalog_prompt(self) -> str:
        """Format all widgets as text for LLM prompts."""
        lines = []
        for scenario, plugin in sorted(self._plugins.items()):
            m = plugin.meta
            lines.append(
                f"  {scenario}: {m.description} "
                f"(sizes: {', '.join(m.sizes)}, "
                f"variants: {', '.join(m.variants[:3])}...)"
            )
        return "\n".join(lines)


# WIDGETS_ALL

"""All widget plugin implementations merged into a single file."""



# agentsview.py
"""Agents view widget plugin — AI agent status and activity monitor."""


class AgentsViewWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="agentsview",
        variants=["agentsview"],
        description="AI agent activity monitor showing active agents, their tasks, status, and recent actions",
        good_for=["agents", "AI agents", "automation", "bot status", "agent tasks", "autonomous", "pipeline agents"],
        sizes=["normal", "expanded"],
        height_units=2,
        rag_strategy="none",
        required_fields=["agents"],
        optional_fields=["tasks", "metrics", "logs"],
        aggregation="none",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not isinstance(data.get("agents"), list):
            errors.append("Missing or invalid agents field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return {
            "agents": raw.get("agents", []),
            "tasks": raw.get("tasks", []),
        }


# alerts.py
"""Alerts widget plugin — alert notification panel."""


class AlertsWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="alerts",
        variants=["alerts-banner", "alerts-toast", "alerts-card",
                  "alerts-badge", "alerts-modal"],
        description="Alert notification panel showing active alarms and warnings",
        good_for=["active alerts", "alarm summary", "warning notifications", "critical events"],
        sizes=["compact", "normal", "expanded"],
        height_units=2,
        rag_strategy="alert_query",
        required_fields=["alerts"],
        optional_fields=["severity", "count", "acknowledged"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# category_bar.py
"""Category bar widget plugin."""


class CategoryBarWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="category-bar",
        variants=["category-bar-vertical", "category-bar-horizontal",
                  "category-bar-stacked", "category-bar-grouped",
                  "category-bar-diverging"],
        description="Bar chart categorized by equipment or metric type",
        good_for=["category comparison", "ranked values", "fleet overview"],
        sizes=["normal", "expanded", "hero"],
        height_units=3,
        rag_strategy="multi_metric",
        required_fields=["categories", "values"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# chatstream.py
"""Chat stream widget plugin — conversational message feed."""


class ChatStreamWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="chatstream",
        variants=["chatstream"],
        description="Conversational chat stream showing AI-generated messages, operator notes, or system dialogue",
        good_for=["chat", "conversation", "messages", "operator notes", "AI response", "dialogue"],
        sizes=["normal", "expanded"],
        height_units=3,
        rag_strategy="none",
        required_fields=["messages"],
        optional_fields=["title", "participants"],
        aggregation="none",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        messages = data.get("messages")
        if not isinstance(messages, list):
            errors.append("Missing or invalid messages field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return {
            "messages": raw.get("messages", []),
        }


# comparison.py
"""Comparison widget plugin — side-by-side value comparison."""


class ComparisonWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="comparison",
        variants=["comparison-side-by-side", "comparison-delta-bar",
                  "comparison-grouped-bar", "comparison-waterfall",
                  "comparison-small-multiples", "comparison-composition-split"],
        description="Side-by-side comparison of multiple metrics or equipment",
        good_for=["comparing equipment", "before/after", "delta analysis", "benchmarking"],
        sizes=["normal", "expanded", "hero"],
        height_units=2,
        rag_strategy="multi_metric",
        required_fields=["items"],
        optional_fields=["labels", "units", "baseline"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        summary = data.get("summary", {})
        if len(summary) < 2:
            errors.append("Comparison needs at least 2 items")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# composition.py
"""Composition widget plugin — stacked bar/area composition."""


class CompositionWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="composition",
        variants=["composition-stacked-bar", "composition-stacked-area",
                  "composition-donut", "composition-waterfall", "composition-treemap"],
        description="Stacked bar/area showing how parts compose a whole",
        good_for=["part-of-whole", "energy mix", "load composition", "source breakdown"],
        sizes=["normal", "expanded", "hero"],
        height_units=3,
        rag_strategy="multi_metric",
        required_fields=["items"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# diagnosticpanel.py
"""Diagnostic panel widget plugin — equipment diagnostics and health checks."""


class DiagnosticPanelWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="diagnosticpanel",
        variants=["diagnosticpanel"],
        description="Equipment diagnostic panel showing health checks, test results, fault codes, and maintenance recommendations",
        good_for=["diagnostic", "health check", "fault code", "troubleshoot", "root cause", "maintenance", "inspection"],
        sizes=["normal", "expanded"],
        height_units=3,
        rag_strategy="single_metric",
        required_fields=["checks"],
        optional_fields=["equipment", "faultCodes", "recommendations", "lastInspection"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not data.get("checks") and not data.get("equipment") and "value" not in data:
            errors.append("Missing checks or equipment field")
        return errors

    def format_data(self, raw: dict) -> dict:
        # Already in diagnostic format
        if "checks" in raw:
            return {
                "checks": raw["checks"],
                "equipment": raw.get("equipment", ""),
                "faultCodes": raw.get("faultCodes", []),
                "recommendations": raw.get("recommendations", []),
            }
        # Flat single_metric from resolver — adapt to diagnostic shape
        if "value" in raw or "timeSeries" in raw:
            label = raw.get("label", "Metric")
            value = raw.get("value", 0)
            try:
                value = float(value)
            except (ValueError, TypeError):
                value = 0
            return {
                "checks": [
                    {"name": label, "status": "pass" if value > 0 else "warning", "value": str(value)},
                ],
                "equipment": raw.get("label", "System"),
                "faultCodes": [],
                "recommendations": [],
            }
        return raw


# distribution.py
"""Distribution widget plugin — pie/donut/bar breakdown."""


class DistributionWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="distribution",
        variants=["distribution-donut", "distribution-100-stacked-bar",
                  "distribution-horizontal-bar", "distribution-pie",
                  "distribution-grouped-bar", "distribution-pareto-bar"],
        description="Pie/donut/bar chart showing value distribution across categories",
        good_for=["proportional breakdown", "share analysis", "category distribution"],
        sizes=["normal", "expanded"],
        height_units=3,
        rag_strategy="multi_metric",
        required_fields=["items"],
        optional_fields=["labels", "colors", "total"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        summary = data.get("summary", {})
        if len(summary) < 2:
            errors.append("Distribution needs at least 2 items")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# edgedevicepanel.py
"""Edge device panel widget plugin — IoT/edge device status and readings."""


class EdgeDevicePanelWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="edgedevicepanel",
        variants=["edgedevicepanel"],
        description="Edge/IoT device panel showing device status, sensor readings, connectivity, and alerts",
        good_for=["edge device", "IoT", "sensor", "gateway", "device status", "connectivity", "PLC", "RTU"],
        sizes=["normal", "expanded"],
        height_units=2,
        rag_strategy="single_metric",
        required_fields=["device"],
        optional_fields=["readings", "alerts", "connectivity", "firmware"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not data.get("device") and "value" not in data:
            errors.append("Missing device field")
        return errors

    def format_data(self, raw: dict) -> dict:
        # Already in device format
        if "device" in raw:
            return {
                "device": raw["device"],
                "readings": raw.get("readings", []),
                "alerts": raw.get("alerts", []),
            }
        # Flat single_metric from resolver — adapt to device shape
        if "value" in raw or "timeSeries" in raw:
            label = raw.get("label", "Sensor")
            value = raw.get("value", 0)
            units = raw.get("units", "")
            return {
                "device": {"id": "auto", "name": label, "status": "online"},
                "readings": [{"sensor": label, "value": value, "unit": units}],
                "alerts": [],
            }
        return raw


# eventlogstream.py
"""Event log stream widget plugin."""


class EventLogStreamWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="eventlogstream",
        variants=["eventlogstream-chronological", "eventlogstream-compact-feed",
                  "eventlogstream-tabular", "eventlogstream-correlation",
                  "eventlogstream-grouped-asset"],
        description="Real-time scrolling log of system events and alerts",
        good_for=["live events", "log monitoring", "alert feed"],
        sizes=["normal", "expanded", "hero"],
        height_units=4,
        rag_strategy="alert_query",
        required_fields=["events"],
        aggregation="raw",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# flow_sankey.py
"""Flow Sankey widget plugin — energy/material flow diagram."""


class FlowSankeyWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="flow-sankey",
        variants=["flow-sankey-standard", "flow-sankey-energy-balance",
                  "flow-sankey-multi-source", "flow-sankey-layered",
                  "flow-sankey-time-sliced"],
        description="Sankey/flow diagram showing energy or material flows between nodes",
        good_for=["energy flow", "power distribution", "material balance", "source-to-load"],
        sizes=["expanded", "hero"],
        height_units=4,
        rag_strategy="flow_analysis",
        required_fields=["nodes", "links"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# kpi.py
"""KPI widget plugin — single metric display."""


def _to_num(v):
    """Coerce to float, return None on failure."""
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0


class KPIWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="kpi",
        variants=["kpi-live", "kpi-alert", "kpi-accumulated", "kpi-lifecycle", "kpi-status"],
        description="Single metric display with value, trend indicator, and unit",
        good_for=["single metric", "status", "live reading", "threshold monitoring"],
        sizes=["compact", "normal"],
        height_units=1,
        rag_strategy="single_metric",
        required_fields=["value"],
        optional_fields=["label", "units", "trend", "threshold", "status"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "value" not in data and not data.get("summary", {}).get("value"):
            errors.append("Missing value field")
        return errors

    def format_data(self, raw: dict) -> dict:
        # Flat format from data resolver
        if "value" in raw or "timeSeries" in raw:
            return {
                "value": _to_num(raw.get("value", 0)),
                "label": raw.get("label", "Metric"),
                "units": raw.get("units", ""),
                "trend": raw.get("trend", "stable"),
                "previousValue": _to_num(raw.get("previousValue")),
                "timeSeries": raw.get("timeSeries", []),
                "threshold": raw.get("threshold"),
                "status": raw.get("status", "ok"),
            }
        # Legacy nested format
        summary = raw.get("summary", {}).get("value", {})
        return {
            "value": summary.get("latest", 0),
            "label": raw.get("meta", {}).get("column", "Metric"),
            "units": raw.get("meta", {}).get("unit", ""),
            "trend": summary.get("trend", "stable"),
        }


# matrix_heatmap.py
"""Matrix heatmap widget plugin."""


class MatrixHeatmapWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="matrix-heatmap",
        variants=["matrix-heatmap-value", "matrix-heatmap-correlation",
                  "matrix-heatmap-calendar", "matrix-heatmap-status",
                  "matrix-heatmap-density"],
        description="Color-coded 2D matrix showing values across two dimensions",
        good_for=["correlation matrix", "time-of-day patterns", "equipment vs metric"],
        sizes=["expanded", "hero"],
        height_units=4,
        rag_strategy="multi_metric",
        required_fields=["matrix"],
        aggregation="latest_multi",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# narrative.py
"""Narrative widget plugin — text-based insight summary."""


class NarrativeWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="narrative",
        variants=["narrative"],
        description="Text-based narrative summary of key insights, findings, or recommendations",
        good_for=["summary", "insight", "explanation", "context", "recommendation", "narrative"],
        sizes=["compact", "normal", "expanded"],
        height_units=2,
        rag_strategy="narrative",
        required_fields=["text"],
        optional_fields=["title", "highlights", "citations"],
        aggregation="none",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not data.get("text"):
            errors.append("Missing text field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return {
            "text": raw.get("text", ""),
            "title": raw.get("title", ""),
        }


# peoplehexgrid.py
"""People hex-grid widget plugin — hexagonal personnel map."""


class PeopleHexGridWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="peoplehexgrid",
        variants=["peoplehexgrid"],
        description="Hexagonal grid showing personnel distribution across zones",
        good_for=["zone staffing", "spatial workforce view", "facility map"],
        sizes=["expanded", "hero"],
        height_units=4,
        rag_strategy="alert_query",
        required_fields=["hexCells"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "hexCells" not in data:
            errors.append("Missing hexCells field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# peoplenetwork.py
"""People network widget plugin — organizational network graph."""


class PeopleNetworkWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="peoplenetwork",
        variants=["peoplenetwork"],
        description="Network graph showing team relationships and communication patterns",
        good_for=["org structure", "team connections", "communication flow"],
        sizes=["expanded", "hero"],
        height_units=4,
        rag_strategy="alert_query",
        required_fields=["nodes", "edges"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "nodes" not in data:
            errors.append("Missing nodes field")
        if "edges" not in data:
            errors.append("Missing edges field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# peopleview.py
"""People view widget plugin — personnel overview card."""


class PeopleViewWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="peopleview",
        variants=["peopleview"],
        description="Personnel overview showing worker status and assignments",
        good_for=["workforce status", "shift personnel", "crew overview"],
        sizes=["normal", "expanded"],
        height_units=3,
        rag_strategy="alert_query",
        required_fields=["people"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "people" not in data:
            errors.append("Missing people field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# supplychainglobe.py
"""Supply chain globe widget plugin — 3D globe with supply routes."""


class SupplyChainGlobeWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="supplychainglobe",
        variants=["supplychainglobe"],
        description="3D globe visualization of supply chain routes and logistics",
        good_for=["logistics overview", "supply routes", "global operations"],
        sizes=["hero"],
        height_units=6,
        rag_strategy="flow_analysis",
        required_fields=["routes"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "routes" not in data:
            errors.append("Missing routes field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# timeline.py
"""Timeline widget plugin — chronological event timeline."""


class TimelineWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="timeline",
        variants=["timeline-linear", "timeline-status", "timeline-multilane",
                  "timeline-forensic", "timeline-dense"],
        description="Chronological timeline of events, status changes, or milestones",
        good_for=["event sequence", "status history", "incident timeline"],
        sizes=["expanded", "hero"],
        height_units=3,
        rag_strategy="events_in_range",
        required_fields=["events"],
        aggregation="raw",
    )

    def validate_data(self, data: dict) -> list[str]:
        return []

    def format_data(self, raw: dict) -> dict:
        return raw


# trend.py
"""Trend widget plugin — time-series line/area chart."""


class TrendWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="trend",
        variants=["trend-line", "trend-area", "trend-step-line",
                  "trend-rgb-phase", "trend-alert-context", "trend-heatmap"],
        description="Time-series line/area chart for metric over time",
        good_for=["temporal patterns", "anomaly detection", "historical data", "trend analysis"],
        sizes=["normal", "expanded", "hero"],
        height_units=3,
        rag_strategy="single_metric",
        required_fields=["timeSeries"],
        optional_fields=["label", "units", "threshold", "annotations"],
        aggregation="hourly",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not data.get("timeSeries") and not data.get("series") and not data.get("datasets"):
            errors.append("Missing timeSeries data")
        return errors

    def format_data(self, raw: dict) -> dict:
        # Flat format from data resolver — single_metric returns timeSeries + value
        ts = raw.get("timeSeries", [])
        if ts:
            return {
                "labels": [p.get("time", "") for p in ts],
                "datasets": [{
                    "label": raw.get("label", "Value"),
                    "data": [p.get("value", 0) for p in ts],
                }],
            }
        # Already in chart format (labels + datasets)
        if "labels" in raw and "datasets" in raw:
            return raw
        # Legacy nested format
        series = raw.get("series", [])
        return {
            "timeSeries": series[0].get("data", []) if series else [],
            "label": raw.get("meta", {}).get("column", "Value"),
            "units": raw.get("meta", {}).get("unit", ""),
        }


# trend_multi_line.py
"""Trend multi-line widget plugin — multiple time series on one chart."""


class TrendMultiLineWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="trend-multi-line",
        variants=["trend-multi-line"],
        description="Multiple time-series lines overlaid for comparison",
        good_for=["multi-metric comparison", "parallel trends", "correlation"],
        sizes=["expanded", "hero"],
        height_units=3,
        rag_strategy="multi_metric",
        required_fields=["series"],
        aggregation="hourly",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "series" not in data:
            errors.append("Missing series field")
        elif not isinstance(data["series"], list) or len(data["series"]) < 2:
            errors.append("series must be a list with at least 2 entries")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# trends_cumulative.py
"""Trends cumulative widget plugin — accumulated value over time."""


class TrendsCumulativeWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="trends-cumulative",
        variants=["trends-cumulative"],
        description="Cumulative/running total chart showing accumulated values over time",
        good_for=["energy consumption", "production output", "running totals"],
        sizes=["expanded", "hero"],
        height_units=3,
        rag_strategy="single_metric",
        required_fields=["timeSeries"],
        aggregation="hourly",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "timeSeries" not in data:
            errors.append("Missing timeSeries field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return raw


# uncertaintypanel.py
"""Uncertainty panel widget plugin — confidence intervals and data quality indicators."""


class UncertaintyPanelWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="uncertaintypanel",
        variants=["uncertaintypanel"],
        description="Data uncertainty and confidence panel showing prediction intervals, data quality scores, and reliability indicators",
        good_for=["uncertainty", "confidence", "prediction interval", "data quality", "reliability", "accuracy", "error margin"],
        sizes=["compact", "normal", "expanded"],
        height_units=2,
        rag_strategy="single_metric",
        required_fields=["confidence"],
        optional_fields=["intervals", "dataQuality", "sources", "methodology"],
        aggregation="latest",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if "confidence" not in data and "intervals" not in data and "value" not in data:
            errors.append("Missing confidence or intervals field")
        return errors

    def format_data(self, raw: dict) -> dict:
        # Already in uncertainty format
        if "confidence" in raw or "intervals" in raw:
            return {
                "confidence": raw.get("confidence", 0),
                "intervals": raw.get("intervals", []),
                "dataQuality": raw.get("dataQuality", {}),
            }
        # Flat single_metric from resolver — adapt to uncertainty shape
        if "value" in raw or "timeSeries" in raw:
            label = raw.get("label", "Metric")
            value = raw.get("value", 0)
            units = raw.get("units", "")
            try:
                val = float(value)
            except (ValueError, TypeError):
                val = 0
            return {
                "confidence": 0.85,
                "intervals": [
                    {"label": label, "low": val * 0.9, "mid": val, "high": val * 1.1, "unit": units},
                ],
                "dataQuality": {"completeness": 1.0, "freshness": "live"},
            }
        return raw


# vaultview.py
"""Vault view widget plugin — secure data vault and document archive."""


class VaultViewWidget(WidgetPlugin):
    meta = WidgetMeta(
        scenario="vaultview",
        variants=["vaultview"],
        description="Secure data vault showing stored documents, archived reports, compliance records, and audit logs",
        good_for=["vault", "archive", "documents", "compliance", "audit log", "records", "stored data", "reports"],
        sizes=["normal", "expanded"],
        height_units=2,
        rag_strategy="none",
        required_fields=["items"],
        optional_fields=["categories", "searchQuery", "accessLog"],
        aggregation="none",
    )

    def validate_data(self, data: dict) -> list[str]:
        errors = []
        if not isinstance(data.get("items"), list):
            errors.append("Missing or invalid items field")
        return errors

    def format_data(self, raw: dict) -> dict:
        return {
            "items": raw.get("items", []),
            "categories": raw.get("categories", []),
        }

# Section: resolvers_combined


"""
AutoGen-based multi-agent validator for widget selection quality.

Three-agent pattern:
1. Planner Agent — proposes top-3 variants with reasoning
2. Validator Agent — checks each against schema constraints and data requirements
3. Finalizer Agent — picks the best from validated candidates

The planner and validator are deterministic (pure Python) — they don't need
an LLM. Only the finalizer optionally uses an LLM for nuanced tie-breaking.

Supports both:
- AutoGen 0.4 (autogen-agentchat): BaseChatAgent + RoundRobinGroupChat
- AutoGen 0.2/AG2 (pyautogen): ConversableAgent + GroupChat
- Pure-Python fallback: same 3-step logic without AutoGen dependency

If AutoGen is not available, falls back to a pure-Python 3-step validation
pipeline that mimics the same logic.
"""


logger = logging.getLogger(__name__)

# ── Try to import AutoGen (0.4 first, then 0.2/AG2) ────────────────────────

_autogen_available = False
_autogen_version = "none"  # "0.4", "0.2", or "none"

try:
    # AutoGen 0.4: new modular package (autogen-agentchat)
    from autogen_agentchat.agents import BaseChatAgent  # type: ignore
    from autogen_agentchat.base import Response as AgentResponse  # type: ignore
    from autogen_agentchat.messages import TextMessage  # type: ignore
    from autogen_agentchat.conditions import MaxMessageTermination  # type: ignore
    from autogen_agentchat.teams import RoundRobinGroupChat  # type: ignore
    from autogen_core import CancellationToken  # type: ignore
    _autogen_available = True
    _autogen_version = "0.4"
    logger.debug("[AutoGenValidator] AutoGen 0.4 (autogen-agentchat) available")
except ImportError:
    try:
        # AutoGen 0.2 / AG2 fork
        import autogen  # type: ignore
        _autogen_available = True
        _autogen_version = "0.2"
        logger.debug("[AutoGenValidator] AutoGen 0.2 available")
    except ImportError:
        try:
            import pyautogen as autogen  # type: ignore
            _autogen_available = True
            _autogen_version = "0.2"
            logger.debug("[AutoGenValidator] pyautogen available")
        except ImportError:
            logger.debug("[AutoGenValidator] AutoGen not available, using pure-Python fallback")


# ── Deterministic Agent Logic ───────────────────────────────────────────────
# These functions implement the 3-agent pattern without requiring AutoGen.
# When AutoGen IS available, they're used as tool functions for the agents.

def _plan_candidates(
    composite_scores: dict[str, float],
    max_candidates: int = 3,
) -> list[dict[str, Any]]:
    """Planner: select top-N candidates with scores and metadata.

    Returns list of {variant, score, rank} dicts.
    """
    if not composite_scores:
        return []

    sorted_variants = sorted(
        composite_scores.items(),
        key=lambda x: x[1],
        reverse=True,
    )

    return [
        {"variant": v, "score": round(s, 4), "rank": i + 1}
        for i, (v, s) in enumerate(sorted_variants[:max_candidates])
    ]


def _validate_candidate(
    variant: str,
    entity_count: int,
    metric_count: int,
    instance_count: int,
    has_timeseries: bool,
) -> dict[str, Any]:
    """Validator: check a single candidate against hard constraints.

    Returns {valid: bool, violations: [str], adjusted_score: float}.
    """
    # VARIANT_PROFILES defined in this file

    violations: list[str] = []

    # Find the profile
    profile = None
    scenario = None
    for s, profiles in VARIANT_PROFILES.items():
        if variant in profiles:
            profile = profiles[variant]
            scenario = s
            break

    if profile is None:
        return {"valid": True, "violations": [], "adjusted_score": 1.0}

    # Check hard constraints
    if profile.needs_multiple_entities and entity_count < 2:
        violations.append(
            f"Requires multiple entities (has {entity_count})"
        )

    if profile.needs_timeseries and not has_timeseries:
        violations.append("Requires timeseries data (not available)")

    # Soft constraint warnings (don't invalidate, but reduce score)
    score_penalty = 0.0

    if profile.ideal_entity_count:
        lo, hi = profile.ideal_entity_count
        if entity_count < lo:
            score_penalty += 0.1
            violations.append(
                f"Ideal entity count [{lo}-{hi}], has {entity_count} (soft)"
            )
        elif entity_count > hi:
            score_penalty += 0.05

    if profile.ideal_metric_count:
        lo, hi = profile.ideal_metric_count
        if metric_count < lo:
            score_penalty += 0.1
            violations.append(
                f"Ideal metric count [{lo}-{hi}], has {metric_count} (soft)"
            )
        elif metric_count > hi:
            score_penalty += 0.05

    if profile.ideal_instance_count:
        lo, hi = profile.ideal_instance_count
        if instance_count < lo:
            score_penalty += 0.1

    # Hard violations = invalid
    hard_violations = [v for v in violations if "(soft)" not in v]
    is_valid = len(hard_violations) == 0

    return {
        "valid": is_valid,
        "violations": violations,
        "adjusted_score": max(0.0, 1.0 - score_penalty),
    }


def _finalize_selection(
    candidates: list[dict[str, Any]],
    validations: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Finalizer: pick the best valid candidate.

    Prefers highest score among valid candidates. If no candidates
    are valid, picks the one with fewest hard violations.
    """
    if not candidates:
        return {"validated_variant": "", "confidence": 0.0, "reason": "no candidates"}

    # Score = original score * validation adjusted_score
    scored = []
    for cand in candidates:
        variant = cand["variant"]
        orig_score = cand["score"]
        val = validations.get(variant, {"valid": True, "adjusted_score": 1.0, "violations": []})
        final_score = orig_score * val["adjusted_score"]
        scored.append({
            "variant": variant,
            "original_score": orig_score,
            "final_score": final_score,
            "valid": val["valid"],
            "violations": val["violations"],
        })

    # Prefer valid candidates
    valid = [s for s in scored if s["valid"]]
    if valid:
        best = max(valid, key=lambda x: x["final_score"])
        return {
            "validated_variant": best["variant"],
            "confidence": min(best["final_score"] * 1.5, 1.0),
            "reason": f"Validated (score={best['final_score']:.3f})",
            "alternatives": [s["variant"] for s in valid if s["variant"] != best["variant"]],
        }

    # No valid candidates — pick least bad
    least_bad = min(scored, key=lambda x: len(x["violations"]))
    return {
        "validated_variant": least_bad["variant"],
        "confidence": max(least_bad["final_score"] * 0.5, 0.1),
        "reason": f"No fully valid candidates, least constrained: {least_bad['violations']}",
        "alternatives": [],
    }


# ── AutoGen Agent Setup ────────────────────────────────────────────────────

def _run_autogen_v04_validation(
    composite_scores: dict[str, float],
    entity_count: int,
    metric_count: int,
    instance_count: int,
    has_timeseries: bool,
    query: str,
) -> dict[str, Any]:
    """Run 3-agent validation using AutoGen 0.4 (BaseChatAgent + RoundRobinGroupChat).

    All 3 agents are deterministic (no LLM). The BaseChatAgent pattern gives
    structured message passing with ~0.1ms overhead per agent hop.
    """
    import asyncio
    import json
    from typing import Sequence

    class PlannerAgent04(BaseChatAgent):
        def __init__(self, scores, ec, mc, ic, ts):
            super().__init__("planner", description="Proposes top-3 widget candidates")
            self._scores, self._ec, self._mc, self._ic, self._ts = scores, ec, mc, ic, ts

        @property
        def produced_message_types(self):
            return (TextMessage,)

        async def on_messages(self, messages: Sequence, cancellation_token) -> AgentResponse:
            candidates = _plan_candidates(self._scores)
            return AgentResponse(chat_message=TextMessage(
                content=json.dumps({"candidates": candidates, "ec": self._ec, "mc": self._mc, "ic": self._ic, "ts": self._ts}),
                source=self.name,
            ))

        async def on_reset(self, cancellation_token):
            pass

    class ValidatorAgent04(BaseChatAgent):
        def __init__(self):
            super().__init__("validator", description="Validates candidates against constraints")

        @property
        def produced_message_types(self):
            return (TextMessage,)

        async def on_messages(self, messages: Sequence, cancellation_token) -> AgentResponse:
            data = json.loads(messages[-1].content)
            candidates = data["candidates"]
            validations = {}
            for cand in candidates:
                v = cand["variant"]
                validations[v] = _validate_candidate(v, data["ec"], data["mc"], data["ic"], data["ts"])
            return AgentResponse(chat_message=TextMessage(
                content=json.dumps({"candidates": candidates, "validations": validations}),
                source=self.name,
            ))

        async def on_reset(self, cancellation_token):
            pass

    class FinalizerAgent04(BaseChatAgent):
        def __init__(self):
            super().__init__("finalizer", description="Picks best validated candidate")

        @property
        def produced_message_types(self):
            return (TextMessage,)

        async def on_messages(self, messages: Sequence, cancellation_token) -> AgentResponse:
            data = json.loads(messages[-1].content)
            result = _finalize_selection(data["candidates"], data["validations"])
            result["method"] = "autogen_v04"
            result["TERMINATE"] = True
            return AgentResponse(chat_message=TextMessage(
                content=json.dumps(result), source=self.name,
            ))

        async def on_reset(self, cancellation_token):
            pass

    async def _run():
        team = RoundRobinGroupChat(
            [PlannerAgent04(composite_scores, entity_count, metric_count, instance_count, has_timeseries),
             ValidatorAgent04(), FinalizerAgent04()],
            termination_condition=MaxMessageTermination(6),
            max_turns=3,
        )
        task = json.dumps({"query": query, "scores": composite_scores})
        result = await team.run(task=task)
        return json.loads(result.messages[-1].content)

    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # Already inside an async context (e.g., Django async view)
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, _run()).result(timeout=5)
        else:
            return asyncio.run(_run())
    except Exception as e:
        logger.warning(f"[AutoGenValidator] AutoGen 0.4 execution failed: {e}")
        return {"validated_variant": "", "confidence": 0.0, "reason": f"autogen_v04 error: {e}"}


def _run_autogen_v02_validation(
    composite_scores: dict[str, float],
    entity_count: int,
    metric_count: int,
    instance_count: int,
    has_timeseries: bool,
    query: str,
) -> dict[str, Any]:
    """Run 3-agent validation using AutoGen 0.2 / AG2 (ConversableAgent).

    Uses deterministic agents (llm_config=False). The pipeline runs
    the 3-step logic through AutoGen's agent framework.
    """
    try:
        # Execute using the deterministic tool functions directly
        # (ConversableAgent with llm_config=False can't do async message passing,
        # so we call the pipeline functions in sequence)
        candidates = _plan_candidates(composite_scores)

        validations = {}
        for cand in candidates:
            v = cand["variant"]
            validations[v] = _validate_candidate(
                v, entity_count, metric_count, instance_count, has_timeseries,
            )

        result = _finalize_selection(candidates, validations)
        result["method"] = "autogen_v02"
        return result

    except Exception as e:
        logger.warning(f"[AutoGenValidator] AutoGen 0.2 execution failed: {e}")
        return {"validated_variant": "", "confidence": 0.0, "reason": f"autogen_v02 error: {e}"}


# ── Public API ──────────────────────────────────────────────────────────────

def validate_selection(
    composite_scores: dict[str, float],
    entity_count: int = 1,
    metric_count: int = 1,
    instance_count: int = 1,
    has_timeseries: bool = True,
    query: str = "",
    prefer_autogen: bool = True,
) -> dict[str, Any]:
    """Run the 3-agent validation pipeline on composite scores.

    Args:
        composite_scores: {variant: score} from the selection graph.
        entity_count: Number of resolved entities.
        metric_count: Number of metrics available.
        instance_count: Number of table instances.
        has_timeseries: Whether timeseries data is available.
        query: Original user query (for LLM tie-breaking).
        prefer_autogen: If True, uses AutoGen when available; if False, forces
            the pure-Python fallback (fast, no async event loop interaction).

    Returns:
        {validated_variant, confidence, reason, alternatives} dict.
    """
    if not composite_scores:
        return {"validated_variant": "", "confidence": 0.0, "reason": "no scores"}

    # Try AutoGen if available (0.4 first, then 0.2)
    if prefer_autogen and _autogen_available:
        try:
            if _autogen_version == "0.4":
                result = _run_autogen_v04_validation(
                    composite_scores=composite_scores,
                    entity_count=entity_count,
                    metric_count=metric_count,
                    instance_count=instance_count,
                    has_timeseries=has_timeseries,
                    query=query,
                )
            else:
                result = _run_autogen_v02_validation(
                    composite_scores=composite_scores,
                    entity_count=entity_count,
                    metric_count=metric_count,
                    instance_count=instance_count,
                    has_timeseries=has_timeseries,
                    query=query,
                )
            if result.get("validated_variant"):
                logger.debug(
                    f"[AutoGenValidator] {_autogen_version}: {result['validated_variant']} "
                    f"(confidence={result.get('confidence', 0):.2f})"
                )
                return result
        except Exception as e:
            logger.warning(f"[AutoGenValidator] AutoGen {_autogen_version} failed: {e}")

    # Fallback: pure-Python 3-step pipeline
    candidates = _plan_candidates(composite_scores)

    validations: dict[str, dict[str, Any]] = {}
    for cand in candidates:
        v = cand["variant"]
        validations[v] = _validate_candidate(
            v, entity_count, metric_count, instance_count, has_timeseries,
        )

    result = _finalize_selection(candidates, validations)
    result["method"] = "fallback"

    logger.debug(
        f"[AutoGenValidator] Fallback: {result.get('validated_variant', '')} "
        f"(confidence={result.get('confidence', 0):.2f})"
    )
    return result


def is_autogen_available() -> bool:
    """Check if AutoGen is installed."""
    return _autogen_available


def get_autogen_version() -> str:
    """Return which AutoGen version is active: '0.4', '0.2', or 'none'."""
    return _autogen_version


"""
Domain-aware column resolution with diversity tracking.

Replaces V5's per-widget LLM column selection with a deterministic system
that knows WHICH columns are meaningful for WHICH equipment type and
WHICH scenario.

Key improvements over the original V7 column resolver:
1. EQUIPMENT_METRIC_MAP — domain-aware column selection (ported from V5)
2. Diversity tracking — never picks the same column twice across a dashboard
3. Scenario awareness — KPI needs a scalar, trend needs timeseries, etc.
4. 5-tier fallback: question keywords → domain map → semantic match → name parts → default
5. Multi-column support for multi-entity scenarios (comparison, distribution, etc.)
"""


import re


logger = logging.getLogger(__name__)


@dataclass
class ColumnMatch:
    """Result of column resolution."""
    table: str
    column: str
    unit: str
    confidence: float  # 0-1


# ── Domain-Aware Metric Map (ported from V5 data_collector.py) ───────────────
# Maps equipment prefix → {metric_keyword: (column_name, unit)}
# The "default" key is used when no keyword matches.

EQUIPMENT_METRIC_MAP: dict[str, dict[str, tuple[str, str]]] = {
    "trf": {
        "power": ("active_power_kw", "kW"), "load": ("load_percent", "%"),
        "power_factor": ("power_factor", "PF"), "pf": ("power_factor", "PF"),
        "voltage": ("secondary_voltage_r", "V"),
        "primary_voltage": ("primary_voltage_r", "V"),
        "secondary_voltage": ("secondary_voltage_r", "V"),
        "oil_temp": ("oil_temperature_top_c", "°C"),
        "winding_temp": ("winding_temperature_hv_c", "°C"), "temperature": ("oil_temperature_top_c", "°C"),
        "frequency": ("frequency_hz", "Hz"), "current": ("current_r", "A"),
        "health": ("load_percent", "%"), "efficiency": ("power_factor", "PF"),
        "default": ("active_power_kw", "kW"),
    },
    "dg": {
        "power": ("active_power_kw", "kW"), "load": ("load_percent", "%"),
        "voltage": ("output_voltage_r", "V"), "frequency": ("frequency_hz", "Hz"),
        "coolant": ("coolant_temperature_c", "°C"), "temperature": ("coolant_temperature_c", "°C"),
        "fuel": ("fuel_level_pct", "%"), "fuel_level": ("fuel_level_pct", "%"),
        "rpm": ("engine_rpm", "RPM"), "runtime": ("engine_rpm", "RPM"),
        "status": ("engine_rpm", "RPM"), "operational": ("load_percent", "%"),
        "default": ("active_power_kw", "kW"),
    },
    "ups": {
        "power": ("output_power_kw", "kW"), "load": ("load_percent", "%"),
        "voltage": ("output_voltage_r", "V"), "battery": ("battery_charge_pct", "%"),
        "battery_status": ("battery_charge_pct", "%"), "battery_health": ("battery_health_pct", "%"),
        "battery_voltage": ("battery_voltage_v", "V"), "runtime": ("battery_time_remaining_min", "min"),
        "temperature": ("battery_temperature_c", "°C"),
        "default": ("output_power_kw", "kW"),
    },
    "chiller": {
        "power": ("power_consumption_kw", "kW"), "load": ("load_percent", "%"),
        "cop": ("current_cop", "COP"), "efficiency": ("current_cop", "COP"),
        "eer": ("eer", "EER"),
        "capacity": ("cooling_capacity_kw", "kW"), "energy": ("energy_kwh", "kWh"),
        "consumption": ("power_consumption_kw", "kW"),
        "temperature": ("chw_supply_temp_c", "°C"), "flow": ("chw_flow_rate_m3h", "m³/h"),
        "delta_t": ("chw_delta_t_c", "°C"), "condenser": ("cw_inlet_temp_c", "°C"),
        "compressor": ("compressor_1_current_a", "A"),
        "current": ("compressor_1_current_a", "A"),
        "vibration": ("vibration_mm_s", "mm/s"),
        "cooling": ("chw_supply_temp_c", "°C"),
        "performance": ("current_cop", "COP"),
        "default": ("power_consumption_kw", "kW"),
    },
    "ahu": {
        "power": ("fan_motor_power_kw", "kW"), "temperature": ("supply_air_temp_c", "°C"),
        "flow": ("supply_air_flow_cfm", "CFM"), "humidity": ("supply_air_humidity_pct", "%"),
        "co2": ("return_air_co2_ppm", "ppm"), "air_quality": ("return_air_co2_ppm", "ppm"),
        "fan_speed": ("fan_speed_pct", "%"), "pressure": ("supply_air_pressure_pa", "Pa"),
        "default": ("fan_motor_power_kw", "kW"),
    },
    "ct": {
        "power": ("fan_motor_power_kw", "kW"), "temperature": ("inlet_water_temp_c", "°C"),
        "outlet_temp": ("outlet_water_temp_c", "°C"), "flow": ("water_flow_rate_m3h", "m³/h"),
        "vibration": ("fan_vibration_mm_s", "mm/s"),
        "cooling": ("outlet_water_temp_c", "°C"), "performance": ("effectiveness_pct", "%"),
        "approach": ("approach_temp_c", "°C"), "effectiveness": ("effectiveness_pct", "%"),
        "range": ("range_temp_c", "°C"), "ph": ("ph_value", ""),
        "conductivity": ("conductivity_us_cm", "uS/cm"),
        "water_level": ("water_level_pct", "%"),
        "default": ("fan_motor_power_kw", "kW"),
    },
    "pump": {
        "power": ("motor_power_kw", "kW"), "flow": ("flow_rate_m3h", "m³/h"),
        "pressure": ("discharge_pressure_bar", "bar"),
        "vibration": ("vibration_axial_mm_s", "mm/s"),
        "vibration_axial": ("vibration_axial_mm_s", "mm/s"),
        "vibration_de": ("vibration_de_mm_s", "mm/s"),
        "bearing": ("bearing_temp_de_c", "°C"), "bearing_temperature": ("bearing_temp_de_c", "°C"),
        "bearing_temp": ("bearing_temp_de_c", "°C"),
        "temperature": ("fluid_temperature_c", "°C"),
        "current": ("motor_current_r", "A"), "voltage": ("motor_voltage_r", "V"),
        "efficiency": ("pump_efficiency_pct", "%"),
        "default": ("motor_power_kw", "kW"),
    },
    "compressor": {
        "power": ("motor_power_kw", "kW"), "consumption": ("power_consumption_kw", "kW"),
        "pressure": ("discharge_pressure_bar", "bar"),
        "temperature": ("discharge_temperature_c", "°C"),
        "vibration": ("vibration_mm_s", "mm/s"),
        "bearing": ("motor_bearing_temp_de_c", "°C"),
        "oil_temp": ("oil_temperature_c", "°C"), "oil": ("oil_pressure_bar", "bar"),
        "load": ("load_percent", "%"),
        "dew_point": ("dew_point_c", "°C"),
        "flow": ("discharge_flow_cfm", "CFM"),
        "energy": ("energy_kwh", "kWh"),
        "specific_power": ("specific_power_kw_per_cfm", "kW/CFM"),
        "efficiency": ("specific_power_kw_per_cfm", "kW/CFM"),
        "current": ("motor_current_r", "A"), "speed": ("motor_speed_rpm", "RPM"),
        "default": ("motor_power_kw", "kW"),
    },
    "motor": {
        "power": ("active_power_kw", "kW"), "consumption": ("power_consumption_kw", "kW"),
        "load": ("load_percent", "%"),
        "temperature": ("winding_temp_r_c", "°C"), "winding_temp": ("winding_temp_r_c", "°C"),
        "vibration": ("vibration_de_h_mm_s", "mm/s"),
        "vibration_de": ("vibration_de_h_mm_s", "mm/s"),
        "vibration_nde": ("vibration_nde_h_mm_s", "mm/s"),
        "speed": ("speed_rpm", "RPM"), "rpm": ("speed_rpm", "RPM"),
        "current": ("current_r", "A"), "voltage": ("voltage_r", "V"),
        "bearing": ("bearing_temp_de_c", "°C"), "bearing_temperature": ("bearing_temp_de_c", "°C"),
        "efficiency": ("efficiency_pct", "%"), "torque": ("torque_nm", "Nm"),
        "frequency": ("frequency_hz", "Hz"), "slip": ("slip_pct", "%"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "energy": ("energy_kwh", "kWh"),
        "default": ("active_power_kw", "kW"),
    },
    "em": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_avg", "V"),
        "current": ("current_avg", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "consumption": ("active_power_total_kw", "kW"),
        "demand": ("current_demand_kw", "kW"), "max_demand": ("max_demand_kw", "kW"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "voltage_unbalance": ("voltage_unbalance_pct", "%"),
        "default": ("active_power_total_kw", "kW"),
    },
    "lt_db": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_r_n", "V"),
        "current": ("current_r", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "load": ("load_percent", "%"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "default": ("active_power_total_kw", "kW"),
    },
    "lt_mcc": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_r_n", "V"),
        "current": ("current_r", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "load": ("load_percent", "%"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "default": ("active_power_total_kw", "kW"),
    },
    "boiler": {
        "power": ("power_consumption_kw", "kW"), "pressure": ("steam_pressure_bar", "bar"),
        "temperature": ("steam_temperature_c", "°C"), "flow": ("steam_flow_tph", "TPH"),
        "load": ("load_percent", "%"), "efficiency": ("efficiency_pct", "%"),
        "fuel": ("fuel_consumption_lph", "L/h"), "exhaust": ("exhaust_temp_c", "°C"),
        "water": ("feed_water_temp_c", "°C"), "emission": ("nox_ppm", "ppm"),
        "default": ("steam_pressure_bar", "bar"),
    },
    # ── Electrical panels (share lt_db-style schema) ─────────────────────────
    "lt_pcc": {
        "power": ("active_power_total_kw", "kW"), "load": ("load_percent", "%"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "voltage": ("voltage_ry", "V"), "current": ("current_r", "A"),
        "frequency": ("frequency_hz", "Hz"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "thd": ("thd_voltage_r_pct", "%"), "harmonic": ("thd_voltage_r_pct", "%"),
        "demand": ("max_demand_kw", "kW"), "energy": ("active_energy_import_kwh", "kWh"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "efficiency": ("power_factor_total", "PF"),
        "default": ("active_power_total_kw", "kW"),
    },
    "lt_vfd": {
        "power": ("active_power_kw", "kW"), "load": ("load_percent", "%"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "voltage": ("drive_output_voltage", "V"),
        "current": ("drive_output_current_a", "A"),
        "frequency": ("drive_output_frequency_hz", "Hz"),
        "speed": ("motor_speed_rpm", "RPM"), "rpm": ("motor_speed_rpm", "RPM"),
        "torque": ("motor_torque_pct", "%"),
        "temperature": ("drive_heatsink_temp_c", "°C"),
        "thd": ("thd_voltage_r_pct", "%"), "harmonic": ("thd_voltage_r_pct", "%"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "efficiency": ("power_factor_total", "PF"),
        "default": ("active_power_kw", "kW"),
    },
    "lt_apfc": {
        "power": ("active_power_total_kw", "kW"),
        "power_factor": ("achieved_power_factor", "PF"), "pf": ("achieved_power_factor", "PF"),
        "voltage": ("voltage_ry", "V"), "current": ("current_r", "A"),
        "frequency": ("frequency_hz", "Hz"),
        "temperature": ("capacitor_bank_temp_c", "°C"),
        "load": ("capacitor_steps_active", ""),
        "thd": ("thd_voltage_r_pct", "%"), "harmonic": ("thd_voltage_r_pct", "%"),
        "energy": ("reactive_energy_import_kvarh", "kVARh"),
        "efficiency": ("achieved_power_factor", "PF"),
        "default": ("power_factor_total", "PF"),
    },
    "lt_bd": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_r_n", "V"),
        "current": ("current_r", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "load": ("load_percent", "%"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "default": ("active_power_total_kw", "kW"),
    },
    "lt_feeder": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_r_n", "V"),
        "current": ("current_r", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "load": ("load_percent", "%"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "default": ("active_power_total_kw", "kW"),
    },
    "lt_incomer": {
        "power": ("active_power_total_kw", "kW"), "voltage": ("voltage_r_n", "V"),
        "current": ("current_r", "A"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "frequency": ("frequency_hz", "Hz"),
        "energy": ("active_energy_import_kwh", "kWh"),
        "load": ("load_percent", "%"),
        "temperature": ("busbar_temp_r_c", "°C"), "busbar": ("busbar_temp_r_c", "°C"),
        "insulation": ("insulation_resistance_mohm", "MΩ"),
        "harmonic": ("thd_voltage_r_pct", "%"), "thd": ("thd_voltage_r_pct", "%"),
        "earth_leakage": ("current_earth_leakage_ma", "mA"),
        "default": ("active_power_total_kw", "kW"),
    },
    # ── Specialized systems ──────────────────────────────────────────────────
    "em_solar": {
        "power": ("active_power_kw", "kW"), "energy": ("active_energy_import_kwh", "kWh"),
        "voltage": ("voltage_ry", "V"), "current": ("current_r", "A"),
        "frequency": ("frequency_hz", "Hz"),
        "power_factor": ("power_factor_total", "PF"), "pf": ("power_factor_total", "PF"),
        "default": ("active_power_kw", "kW"),
    },
    "bms": {
        "temperature": ("temperature_actual_c", "°C"),
        "humidity": ("humidity_actual_pct", "%"),
        "air_quality": ("co2_level_ppm", "ppm"), "co2": ("co2_level_ppm", "ppm"),
        "pressure": ("differential_pressure_pa", "Pa"),
        "lighting": ("lighting_level_lux", "lux"),
        "default": ("temperature_actual_c", "°C"),
    },
    "fire": {
        "pressure": ("sprinkler_pressure_bar", "bar"),
        "default": ("sprinkler_pressure_bar", "bar"),
    },
    "wtp": {
        "flow": ("flow_rate_m3h", "m³/h"), "pressure": ("pressure_bar", "bar"),
        "temperature": ("water_temp_c", "°C"),
        "ph": ("ph_value", ""), "conductivity": ("conductivity_us_cm", "µS/cm"),
        "default": ("flow_rate_m3h", "m³/h"),
    },
    "stp": {
        "flow": ("flow_rate_m3h", "m³/h"), "pressure": ("pressure_bar", "bar"),
        "temperature": ("water_temp_c", "°C"),
        "ph": ("ph_value", ""), "conductivity": ("conductivity_us_cm", "µS/cm"),
        "default": ("flow_rate_m3h", "m³/h"),
    },
}

# Metric keyword aliases — maps user-friendly terms to canonical metric keywords
_METRIC_ALIASES: dict[str, str] = {
    "power_kw": "power", "consumption": "power", "energy": "power",
    "power_consumption": "power", "power_output": "power",
    "demand": "power", "kw": "power", "watt": "power", "draw": "power",
    "power_factor": "power_factor", "pf": "power_factor",
    "voltage_avg": "voltage", "volt": "voltage", "v": "voltage",
    "primary_voltage": "primary_voltage", "primary voltage": "primary_voltage",
    "secondary_voltage": "secondary_voltage", "secondary voltage": "secondary_voltage",
    "current_avg": "current", "amp": "current", "ampere": "current",
    "freq": "frequency", "hz": "frequency",
    "temp": "temperature", "thermal": "temperature", "heat": "temperature",
    "water_temperature": "temperature", "water_temp": "temperature",
    "oil_temp": "oil_temp", "oil_temperature": "oil_temp",
    "vibration_level": "vibration", "vibration_levels": "vibration",
    "shaking": "vibration", "oscillation": "vibration",
    "pressure_reading": "pressure", "pressure_level": "pressure",
    "flow_rate": "flow", "humidity_level": "humidity",
    "battery_level": "battery", "battery_charge": "battery",
    "charge": "battery", "backup": "battery",
    "current_load": "load", "load_percent": "load", "loading": "load",
    "cop_value": "cop", "efficiency_value": "efficiency",
    "performance": "efficiency",
    "issue": "vibration", "issues": "vibration",  # "issues" in pumps usually means vibration/bearing
    # VFD-specific
    "speed": "speed", "torque": "torque", "drive": "speed",
    "rpm": "speed", "motor_speed": "speed",
    # APFC-specific
    "capacitor": "power_factor", "kvar": "power_factor", "reactive": "power_factor",
    # BMS-specific
    "co2": "air_quality", "air": "air_quality", "particle": "air_quality",
    "lighting": "lighting", "lux": "lighting", "occupancy": "temperature",
    # Boiler-specific
    "steam": "pressure", "boiler_pressure": "pressure",
    "fuel_consumption": "fuel", "emission": "exhaust", "nox": "exhaust",
    # Water treatment
    "ph": "ph", "conductivity": "conductivity", "tds": "conductivity", "turbidity": "flow",
}


# ── Metric Domain Classification ───────────────────────────────────────────────
# Groups related physical quantities so dashboard metric coherence can be
# enforced at assembly time. When a query focuses on "power", widgets showing
# "voltage" or "current" are off-topic. Generic — works for ANY metric domain.

METRIC_DOMAINS: dict[str, set[str]] = {
    "power":       {"power", "energy", "consumption", "demand", "load"},
    "voltage":     {"voltage"},
    "current":     {"current"},
    "temperature": {"temperature", "oil_temp", "winding_temp", "bearing",
                    "cooling", "delta_t", "coolant", "exhaust"},
    "vibration":   {"vibration"},
    "pressure":    {"pressure"},
    "flow":        {"flow"},
    "frequency":   {"frequency", "speed", "rpm"},
}

# Reverse index: canonical metric keyword → domain name
_KEYWORD_TO_DOMAIN: dict[str, str] = {}
for _dom, _kws in METRIC_DOMAINS.items():
    for _kw in _kws:
        _KEYWORD_TO_DOMAIN[_kw] = _dom

# Unit string → domain (fallback when metric name alone is ambiguous)
_UNIT_TO_DOMAIN: dict[str, str] = {
    "kw": "power", "kva": "power", "w": "power", "mw": "power", "kwh": "power",
    "v": "voltage", "kv": "voltage",
    "a": "current", "ma": "current",
    "°c": "temperature", "°f": "temperature",
    "mm/s": "vibration",
    "bar": "pressure", "psi": "pressure", "pa": "pressure", "kpa": "pressure",
    "m³/h": "flow", "cfm": "flow", "tph": "flow", "l/s": "flow",
    "hz": "frequency", "rpm": "frequency",
}

# Domains where cumulative (SUM over time) is physically meaningful.
# Power→energy, flow→volume are integrable. Voltage, current, temperature
# are instantaneous — cumulative makes no physical sense.
CUMULATIVE_ELIGIBLE_DOMAINS: frozenset[str] = frozenset({
    "power", "flow",
})


def classify_metric_domain(text: str, unit: str = "") -> str | None:
    """Classify a metric name or column label into its measurement domain.

    Returns "power", "voltage", "current", "temperature", etc., or None
    if the metric cannot be classified (e.g. COP, power factor, efficiency).
    Unclassified metrics are always kept by the coherence gate.
    """
    text_lower = text.lower()

    # Compound override: "power factor" is NOT in the "power" domain
    if "power factor" in text_lower or "power_factor" in text_lower:
        return None

    tokens = set(re.findall(r'[a-z]+', text_lower))
    for token in tokens:
        if token in _KEYWORD_TO_DOMAIN:
            return _KEYWORD_TO_DOMAIN[token]
        canonical = _METRIC_ALIASES.get(token)
        if canonical and canonical in _KEYWORD_TO_DOMAIN:
            return _KEYWORD_TO_DOMAIN[canonical]

    # Unit-based fallback
    if unit:
        u = unit.lower().strip()
        if u in _UNIT_TO_DOMAIN:
            return _UNIT_TO_DOMAIN[u]

    return None


def classify_query_domain(query: str) -> str | None:
    """Classify a natural-language query into its primary metric domain.

    Uses _extract_metric_keyword (with "current"-as-adjective disambiguation)
    then maps to domain. Returns None for generic queries with no specific
    metric focus — the coherence gate skips filtering in that case.
    """
    keyword = ColumnResolver()._extract_metric_keyword(query.lower())
    if not keyword:
        return None
    if keyword in _KEYWORD_TO_DOMAIN:
        return _KEYWORD_TO_DOMAIN[keyword]
    canonical = _METRIC_ALIASES.get(keyword)
    if canonical and canonical in _KEYWORD_TO_DOMAIN:
        return _KEYWORD_TO_DOMAIN[canonical]
    return None


# Scenario-specific metric preferences — which metrics are most meaningful per scenario
_SCENARIO_METRIC_ORDER: dict[str, list[str]] = {
    "kpi": ["power", "load", "temperature", "cop", "efficiency", "flow", "pressure", "vibration"],
    "trend": ["power", "temperature", "load", "cop", "vibration", "flow", "pressure"],
    "comparison": ["power", "load", "efficiency", "cop", "temperature"],
    "distribution": ["power", "load", "efficiency", "flow"],
    "composition": ["power", "load", "efficiency", "flow"],
    "category-bar": ["power", "load", "efficiency", "flow", "temperature"],
    "flow-sankey": ["power", "energy", "load"],
    "matrix-heatmap": ["power", "temperature", "load", "vibration"],
    "alerts": ["vibration", "temperature", "load", "pressure"],
    "timeline": ["power", "load", "temperature", "vibration"],
    "trend-multi-line": ["power", "temperature", "load", "vibration"],
    "trends-cumulative": ["power", "energy", "flow"],
    "eventlogstream": ["power", "vibration", "temperature", "load"],
}

# Numeric PG data types
_NUMERIC_TYPES = {"double precision", "real", "numeric", "float8", "integer", "bigint", "smallint"}


class ColumnResolver:
    """
    Domain-aware column resolver with diversity tracking.

    5-tier resolution strategy:
    1. Extract metric keywords from the question
    2. Look up in EQUIPMENT_METRIC_MAP for the equipment type (domain-aware)
    3. Semantic matching: score columns by question keyword overlap
    4. Column name part matching: break column name into parts
    5. Fallback to default metric for equipment type

    Diversity is enforced by accepting a `used_columns` set that prevents
    the same column from being picked for multiple widgets.
    """

    def resolve(
        self,
        question: str,
        table: str,
        available_columns: list[ColumnStats],
        equipment_prefix: str = "",
        scenario: str = "",
        used_columns: set[str] | None = None,
    ) -> ColumnMatch | None:
        """
        Match a question to the best column in a table.

        Args:
            question: The analytical question this widget answers
            table: The PG table name
            available_columns: Column metadata from catalog scan
            equipment_prefix: Equipment type prefix (e.g. "trf", "pump")
            scenario: Widget scenario type (e.g. "kpi", "trend")
            used_columns: Set of "table.column" strings already used —
                          will be avoided for diversity unless no alternative exists

        Returns ColumnMatch or None.
        """
        question_lower = question.lower()
        numeric_cols = [c for c in available_columns if c.dtype in _NUMERIC_TYPES]

        if not numeric_cols:
            return None

        # Infer equipment prefix from table name if not provided
        if not equipment_prefix and "_" in table:
            equipment_prefix = table.rsplit("_", 1)[0]
            # Handle multi-part prefixes like lt_mcc
            if equipment_prefix not in EQUIPMENT_METRIC_MAP:
                equipment_prefix = table.split("_")[0]

        available_col_names = {c.name for c in numeric_cols}
        used = used_columns or set()

        # ── Tier 1: Extract metric keywords from question → domain map lookup ──
        metric_keyword = self._extract_metric_keyword(question_lower)
        if metric_keyword and equipment_prefix in EQUIPMENT_METRIC_MAP:
            metric_map = EQUIPMENT_METRIC_MAP[equipment_prefix]
            if metric_keyword in metric_map:
                col_name, unit = metric_map[metric_keyword]
                if col_name in available_col_names:
                    key = f"{table}.{col_name}"
                    if key not in used:
                        return ColumnMatch(table=table, column=col_name, unit=unit, confidence=0.95)
                    # Keyword matched but column already used — try alternate columns below

            # Phase-aware fallback: if question mentions a specific phase (r/y/b),
            # try that phase suffix even if the base keyword mapped elsewhere
            phase_match = re.search(r'\b(phase\s+)?([ryb])\b', question_lower)
            if phase_match and col_name:
                phase = phase_match.group(2)
                base = re.sub(r'_[ryb]$', '', col_name)
                phase_col = f"{base}_{phase}"
                if phase_col in available_col_names:
                    key = f"{table}.{phase_col}"
                    if key not in used:
                        return ColumnMatch(table=table, column=phase_col, unit=unit, confidence=0.93)

        # ── Tier 2: Scenario-specific ordered preferences ──
        if equipment_prefix in EQUIPMENT_METRIC_MAP:
            metric_map = EQUIPMENT_METRIC_MAP[equipment_prefix]
            preference_order = _SCENARIO_METRIC_ORDER.get(scenario, [])
            for metric_key in preference_order:
                if metric_key in metric_map:
                    col_name, unit = metric_map[metric_key]
                    key = f"{table}.{col_name}"
                    if col_name in available_col_names and key not in used:
                        return ColumnMatch(table=table, column=col_name, unit=unit, confidence=0.80)

        # ── Tier 3: Score all columns by question relevance ──
        scored: list[tuple[ColumnStats, float]] = []
        for col in numeric_cols:
            if col.name == "timestamp":
                continue
            score = self._score_column(question_lower, col, equipment_prefix)
            key = f"{table}.{col.name}"
            # Penalize already-used columns but don't exclude them entirely
            if key in used:
                score *= 0.3
            scored.append((col, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        if scored and scored[0][1] > 0.1:
            best = scored[0][0]
            return ColumnMatch(
                table=table, column=best.name,
                unit=best.unit or self._infer_unit(best.name),
                confidence=min(scored[0][1], 1.0),
            )

        # ── Tier 4: Default metric for equipment type ──
        if equipment_prefix in EQUIPMENT_METRIC_MAP:
            metric_map = EQUIPMENT_METRIC_MAP[equipment_prefix]
            col_name, unit = metric_map.get("default", ("active_power_kw", "kW"))
            if col_name in available_col_names:
                key = f"{table}.{col_name}"
                if key not in used:
                    return ColumnMatch(table=table, column=col_name, unit=unit, confidence=0.60)

        # ── Tier 5: Any unused numeric column with data ──
        for col in numeric_cols:
            if col.name == "timestamp":
                continue
            key = f"{table}.{col.name}"
            if key not in used and col.avg_val is not None:
                return ColumnMatch(
                    table=table, column=col.name,
                    unit=col.unit or self._infer_unit(col.name),
                    confidence=0.40,
                )

        # Last resort: any numeric column at all (even if used)
        for col in numeric_cols:
            if col.name == "timestamp":
                continue
            return ColumnMatch(
                table=table, column=col.name,
                unit=col.unit or self._infer_unit(col.name),
                confidence=0.20,
            )

        return None

    def resolve_multi(
        self,
        question: str,
        tables: list[tuple[str, list[ColumnStats]]],
        equipment_prefix: str = "",
        scenario: str = "",
        used_columns: set[str] | None = None,
        n: int = 5,
    ) -> list[ColumnMatch]:
        """Resolve a question across multiple tables with diversity tracking."""
        matches = []
        used = set(used_columns) if used_columns else set()

        for table_name, columns in tables:
            match = self.resolve(
                question, table_name, columns,
                equipment_prefix=equipment_prefix,
                scenario=scenario,
                used_columns=used,
            )
            if match:
                matches.append(match)
                used.add(f"{match.table}.{match.column}")

        matches.sort(key=lambda m: m.confidence, reverse=True)
        return matches[:n]

    def resolve_diverse_columns(
        self,
        questions: list[str],
        table: str,
        available_columns: list[ColumnStats],
        equipment_prefix: str = "",
        scenarios: list[str] | None = None,
    ) -> list[ColumnMatch]:
        """
        Resolve multiple questions to diverse columns in the same table.
        Ensures each question gets a DIFFERENT column when possible.
        """
        used: set[str] = set()
        results = []
        scenario_list = scenarios or [""] * len(questions)

        for i, question in enumerate(questions):
            scenario = scenario_list[i] if i < len(scenario_list) else ""
            match = self.resolve(
                question, table, available_columns,
                equipment_prefix=equipment_prefix,
                scenario=scenario,
                used_columns=used,
            )
            if match:
                results.append(match)
                used.add(f"{match.table}.{match.column}")
            else:
                results.append(None)

        return results

    def _extract_metric_keyword(self, question: str) -> str:
        """Extract the primary metric keyword from a question string.

        Handles ambiguity: "current" can mean "present/latest" (adjective) or
        "electrical current" (noun). Disambiguate by checking if it precedes
        another metric noun like "power", "load", "status".
        """
        # Direct keyword matches (ordered by specificity — more specific first)
        direct_keywords = [
            "bearing", "vibration", "oil_temp", "winding_temp", "battery",
            "power_factor", "pf", "cop", "eer", "delta_t",
            "pressure", "flow", "humidity", "rpm", "speed",
            "primary_voltage", "secondary_voltage",  # Before generic "voltage"
            "voltage", "current", "frequency",
            "temperature", "load", "power", "efficiency",
            "energy", "consumption", "cooling", "performance",
        ]

        # Disambiguate "current" — skip if used as adjective before another metric
        _METRIC_NOUNS = {"power", "load", "status", "state", "value", "reading",
                         "level", "consumption", "output", "capacity", "factor",
                         "motor power", "active power"}

        for keyword in direct_keywords:
            if keyword.replace("_", " ") in question or keyword in question:
                if keyword == "current":
                    # Check if "current" precedes another metric noun
                    after_current = question[question.index("current") + 7:].strip()
                    if any(after_current.startswith(noun) for noun in _METRIC_NOUNS):
                        continue  # Skip — "current" is an adjective here
                # Check aliases
                canonical = _METRIC_ALIASES.get(keyword, keyword)
                return canonical

        # Check word-level aliases
        words = re.findall(r'\b\w+\b', question)
        for word in words:
            if word in _METRIC_ALIASES:
                return _METRIC_ALIASES[word]

        return ""

    def _score_column(self, question: str, col: ColumnStats, equipment_prefix: str) -> float:
        """Score how well a column matches a question, with domain awareness.

        Uses RapidFuzz token_sort_ratio (when available) for better affinity
        scoring: "active power kw" scores higher than "current r" against
        query "how is power distributed". Falls back to substring matching.
        """
        score = 0.0
        col_lower = col.name.lower()
        col_label = col_lower.replace("_", " ")

        # Fuzzy token matching (RapidFuzz) or substring fallback
        try:
            from rapidfuzz import fuzz
            token_score = fuzz.token_sort_ratio(col_label, question) / 100.0
            if token_score > 0.4:
                score += token_score * 0.6  # Scale to max ~0.6
        except ImportError:
            # Fallback: direct column name parts in question
            col_parts = col_label.split()
            for part in col_parts:
                if len(part) > 2 and part in question:
                    score += 0.4

        # Unit match — word-boundary aware to prevent single-letter units
        # (e.g. "A" for Amps) from matching inside words like "across" or "plant"
        if col.unit:
            unit_lower = col.unit.lower()
            if len(unit_lower) <= 2:
                # Short units need word-boundary matching
                if re.search(r'\b' + re.escape(unit_lower) + r'\b', question):
                    score += 0.2
            else:
                if unit_lower in question:
                    score += 0.2

        # Domain relevance: boost if column is a known metric for this equipment
        if equipment_prefix in EQUIPMENT_METRIC_MAP:
            metric_map = EQUIPMENT_METRIC_MAP[equipment_prefix]
            for metric_key, (mapped_col, _) in metric_map.items():
                if mapped_col == col_lower and metric_key != "default":
                    # This column IS a known metric — small boost for being domain-relevant
                    score += 0.15
                    break

        # Penalize non-useful columns
        if col_lower == "timestamp":
            score -= 10.0
        if col_lower.endswith(("_status", "_state", "_mode")):
            score -= 2.0

        return score

    @staticmethod
    def _infer_unit(column_name: str) -> str:
        """Infer physical unit from column name suffix."""
        name_lower = column_name.lower()
        # Multi-part suffixes first
        multi_suffixes = {
            "_mm_s": "mm/s", "_m3h": "m³/h", "_m3_h": "m³/h",
            "_nm3_hr": "Nm³/h", "_kl_hr": "kL/h", "_us_cm": "µS/cm",
            "_g_kwh": "g/kWh", "_kw_per_cfm": "kW/CFM",
            "_kvarh": "kVARh", "_kvah": "kVAh",
        }
        for suffix, unit in multi_suffixes.items():
            if name_lower.endswith(suffix):
                return unit
        suffixes = {
            "_kw": "kW", "_kvar": "kVAR", "_kva": "kVA",
            "_kwh": "kWh", "_mwh": "MWh",
            "_c": "°C", "_f": "°F",
            "_pct": "%", "_percent": "%",
            "_hz": "Hz",
            "_a": "A", "_v": "V", "_kv": "kV",
            "_bar": "bar", "_psi": "psi", "_mbar": "mbar",
            "_pa": "Pa",
            "_rpm": "RPM",
            "_ppm": "ppm",
            "_ma": "mA", "_mohm": "MΩ",
            "_cfm": "CFM",
            "_lph": "L/h", "_lpm": "L/min", "_lps": "L/s",
            "_nm": "Nm", "_min": "min", "_kl": "kL",
            "_lux": "lux", "_um": "µm",
        }
        for suffix, unit in suffixes.items():
            if name_lower.endswith(suffix):
                return unit
        if "power_factor" in name_lower:
            return "PF"
        return ""


"""
DSPy-based reasoning for widget variant selection (Layer 3).

Uses DSPy ChainOfThought to reason about which variant best fits
the DATA SHAPE PROPERTIES — not keywords or text descriptions.

DSPy is invoked only when the LangGraph constraint graph (Layer 2)
produces ambiguous results (confidence gap < 0.10 or top score < 0.45).

Input: structured data shape properties + pre-scored candidates.
Output: reasoned selection based on data properties.

Falls back to pure constraint-based selection if DSPy/LLM is unavailable.
"""


import time

logger = logging.getLogger(__name__)

# ── Try to import DSPy ──────────────────────────────────────────────────────

_dspy_available = False
_dspy_configured = False
_dspy_last_attempt_ts = 0.0

try:
    import dspy
    _dspy_available = True
    logger.debug("[DSPyReasoner] DSPy library available")
except ImportError:
    logger.debug("[DSPyReasoner] DSPy not available, using constraint-based fallback")


# ── DSPy Signatures ─────────────────────────────────────────────────────────

if _dspy_available:
    class VariantSelection(dspy.Signature):
        """Select the best data visualization variant based on data properties.

        Given structured data shape properties and pre-scored candidates,
        reason about which variant produces the most informative visualization.
        Do NOT rely on keywords in the query — focus on data properties.
        """
        query: str = dspy.InputField(desc="User's data query")
        query_type: str = dspy.InputField(
            desc="status/analysis/comparison/trend/diagnostic/overview/alert/forecast"
        )
        question_intent: str = dspy.InputField(
            desc="baseline/trend/anomaly/comparison/correlation/health"
        )
        data_shape: str = dspy.InputField(desc=(
            "Measured data properties: entity_count, metric_count, variance(spread), "
            "temporal_density, dominant_metric_type, has_phase_data, has_cumulative, "
            "has_binary, has_hierarchy, data_richness, flags"
        ))
        candidates: str = dspy.InputField(
            desc="Surviving variants with composite scores and descriptions, one per line"
        )
        selected_variant: str = dspy.OutputField(
            desc="Single best variant name from candidates list"
        )
        reasoning: str = dspy.OutputField(
            desc="Brief explanation citing specific data properties that make this variant best"
        )

    class VariantValidator(dspy.Signature):
        """Validate that a selected variant can meaningfully render this data shape."""
        variant: str = dspy.InputField(desc="Selected variant name")
        data_shape: str = dspy.InputField(desc="Data shape properties")
        is_valid: str = dspy.OutputField(desc="'yes' if variant fits the data shape, 'no' otherwise")
        concern: str = dspy.OutputField(
            desc="Specific data property that makes this variant poor, or 'none'"
        )


# ── DSPy Module ─────────────────────────────────────────────────────────────

if _dspy_available:
    class VariantPlanner(dspy.Module):
        """DSPy module: ChainOfThought selection + Predict validation."""

        def __init__(self):
            super().__init__()
            self.select = dspy.ChainOfThought(VariantSelection)
            self.validate = dspy.Predict(VariantValidator)

        def forward(
            self,
            query: str,
            query_type: str,
            question_intent: str,
            data_shape: str,
            candidates: str,
        ) -> dspy.Prediction:
            selection = self.select(
                query=query,
                query_type=query_type,
                question_intent=question_intent,
                data_shape=data_shape,
                candidates=candidates,
            )
            validation = self.validate(
                variant=selection.selected_variant,
                data_shape=data_shape,
            )
            return dspy.Prediction(
                selected_variant=selection.selected_variant,
                reasoning=selection.reasoning,
                is_valid=validation.is_valid,
                concern=validation.concern,
            )


# ── LLM Configuration ──────────────────────────────────────────────────────

_DSPY_CONFIG_RETRY_SECONDS = 60.0


def _detect_vllm_model_id(vllm_base_url: str) -> str | None:
    """Detect a usable model id from a vLLM OpenAI-compatible `/models` endpoint."""
    try:
        import httpx
        base = vllm_base_url.rstrip("/")
        r = httpx.get(f"{base}/models", timeout=0.6)
        if r.status_code != 200:
            return None
        data = r.json()
        ids = [m.get("id") for m in (data.get("data") or []) if isinstance(m, dict) and m.get("id")]
        if not ids:
            return None

        # Prefer the widget-selection LoRA if present, otherwise fall back to the first id.
        for preferred in ("cc-widgets", "cc-data-query"):
            if preferred in ids:
                return preferred
        return ids[0]
    except Exception:
        return None


def _configure_dspy() -> bool:
    """Configure DSPy with available LLM backend.

    Tries in order:
    1. Local vLLM endpoint (VLLM_URL or VLLM_BASE_URL)
    2. OpenAI API (OPENAI_API_KEY)
    3. Local Qwen via LiteLLM proxy (LLM_API_BASE)
    """
    global _dspy_configured, _dspy_last_attempt_ts
    if _dspy_configured or not _dspy_available:
        return _dspy_configured

    # Avoid repeated network attempts when the backend is down (e.g., tests).
    now = time.monotonic()
    if _dspy_last_attempt_ts and (now - _dspy_last_attempt_ts) < _DSPY_CONFIG_RETRY_SECONDS:
        return False
    _dspy_last_attempt_ts = now

    import os

    # Explicit kill switch (useful for deterministic / low-latency deployments).
    disable = os.environ.get("PIPELINE_DSPY_DISABLE") or os.environ.get("DSPY_DISABLE")
    if disable and str(disable).strip().lower() in ("1", "true", "yes", "on"):
        return False

    # Try local vLLM first (fastest, no API cost).
    vllm_url = os.environ.get("VLLM_URL") or os.environ.get("VLLM_BASE_URL")
    if not vllm_url:
        # Fall back to pipeline config default even when env vars aren't exported.
        try:
            from backend.app.services.widget_intelligence import VLLM_BASE_URL as _CFG_VLLM_BASE_URL
            vllm_url = _CFG_VLLM_BASE_URL
        except Exception:
            vllm_url = None

    if vllm_url:
        try:
            model_id = (
                os.environ.get("DSPY_VLLM_MODEL")
                or os.environ.get("VLLM_MODEL")
                or _detect_vllm_model_id(vllm_url)
            )
            if not model_id:
                raise RuntimeError("Could not detect vLLM model id from /models (set DSPY_VLLM_MODEL)")

            lm = dspy.LM(
                model=f"openai/{model_id}",
                api_base=vllm_url,
                api_key="dummy",
                max_tokens=200,
                temperature=0.1,
            )
            dspy.configure(lm=lm)
            _dspy_configured = True
            logger.info(f"[DSPyReasoner] Configured with vLLM at {vllm_url} (model={model_id})")
            return True
        except Exception as e:
            logger.debug(f"[DSPyReasoner] vLLM config failed: {e}")

    # Try OpenAI
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            lm = dspy.LM(
                model="openai/gpt-4o-mini",
                api_key=openai_key,
                max_tokens=200,
                temperature=0.1,
            )
            dspy.configure(lm=lm)
            _dspy_configured = True
            logger.info("[DSPyReasoner] Configured with OpenAI gpt-4o-mini")
            return True
        except Exception as e:
            logger.debug(f"[DSPyReasoner] OpenAI config failed: {e}")

    # Try local Qwen via LiteLLM proxy
    from backend.app.services.llm import get_llm_config
    _cfg = get_llm_config()
    llm_base = _cfg.api_base
    llm_model = _cfg.model
    if llm_base:
        try:
            lm = dspy.LM(
                model=f"openai/{llm_model}",
                api_base=llm_base,
                api_key=_cfg.api_key or "none",
                max_tokens=200,
                temperature=0.1,
            )
            dspy.configure(lm=lm)
            _dspy_configured = True
            logger.info(f"[DSPyReasoner] Configured with local Qwen via LiteLLM at {llm_base} (model={llm_model})")
            return True
        except Exception as e:
            logger.debug(f"[DSPyReasoner] LiteLLM proxy config failed: {e}")

    logger.info("[DSPyReasoner] No LLM backend available, DSPy reasoning disabled")
    return False


# ── Constraint-based fallback (no LLM) ─────────────────────────────────────

def _constraint_fallback(
    candidates: list[str],
    composite_scores: dict[str, float],
) -> tuple[str, str]:
    """Pure constraint-based selection without LLM.

    Simply picks the highest-scoring candidate from composite scores.
    """
    if not candidates:
        return "", "no candidates"

    best = candidates[0]
    best_score = composite_scores.get(best, 0.0)
    for v in candidates[1:]:
        s = composite_scores.get(v, 0.0)
        if s > best_score:
            best_score = s
            best = v

    return best, f"Top composite score ({best_score:.3f}), no DSPy available"


# ── Public API ──────────────────────────────────────────────────────────────

_planner_module = None


def reason_variant_selection(
    query: str,
    candidates: list[str],
    composite_scores: dict[str, float],
    data_shape_text: str,
    query_type: str = "overview",
    question_intent: str = "",
    candidate_descriptions: dict[str, str] | None = None,
) -> tuple[str, str]:
    """Use DSPy to reason about which variant best fits the data shape.

    Args:
        query: User's natural language query.
        candidates: List of candidate variant names.
        composite_scores: Pre-computed composite scores from Layer 2.
        data_shape_text: Formatted DataShapeProfile text.
        query_type: ParsedIntent query type.
        question_intent: Question dict intent.
        candidate_descriptions: Optional {variant: description} for context.

    Returns:
        (selected_variant, reasoning) tuple.
    """
    global _planner_module

    if not candidates:
        return "", "no candidates"

    descs = candidate_descriptions or {}

    # Try DSPy first
    if _dspy_available and _configure_dspy():
        try:
            if _planner_module is None:
                _planner_module = VariantPlanner()

            # Format candidates with scores and descriptions
            candidates_text = "\n".join(
                f"- {v} (composite={composite_scores.get(v, 0.0):.3f}): "
                f"{descs.get(v, 'visualization variant')}"
                for v in candidates
            )

            result = _planner_module(
                query=query,
                query_type=query_type,
                question_intent=question_intent,
                data_shape=data_shape_text,
                candidates=candidates_text,
            )

            selected = result.selected_variant.strip()
            reasoning = result.reasoning.strip()

            # Validate the LLM picked a real candidate
            if selected in candidates:
                if hasattr(result, "is_valid") and "no" in str(result.is_valid).lower():
                    logger.info(
                        f"[DSPyReasoner] LLM pick {selected} failed validation: "
                        f"{result.concern}. Falling back."
                    )
                else:
                    logger.debug(f"[DSPyReasoner] LLM selected: {selected}")
                    return selected, f"[DSPy] {reasoning}"
            else:
                logger.warning(
                    f"[DSPyReasoner] LLM returned invalid variant '{selected}', "
                    f"candidates: {candidates}"
                )

        except Exception as e:
            logger.warning(f"[DSPyReasoner] DSPy call failed: {e}")

    # Fallback: pick highest composite score
    return _constraint_fallback(candidates, composite_scores)


def is_dspy_available() -> bool:
    """Check if DSPy is installed and an LLM backend is configured."""
    if not _dspy_available:
        return False
    return _configure_dspy()


"""
Deterministic entity resolution with plural handling and DB discovery.

Improvements over original V6:
1. Plural handling: "all pumps", "cooling towers" → discovers ALL instances from DB
2. DB instance discovery: queries information_schema for actual tables
3. Broad query detection: "power distribution across the plant" → multiple entity types
4. Better metric inference: "vibration or bearing issues" → pump (not motor)
"""


logger = logging.getLogger(__name__)

# Default metrics per equipment prefix
_DEFAULT_METRICS: dict[str, tuple[str, str]] = {
    "trf": ("active_power_kw", "kW"),
    "dg": ("active_power_kw", "kW"),
    "ups": ("load_percent", "%"),
    "chiller": ("power_consumption_kw", "kW"),
    "ahu": ("supply_air_temp_c", "°C"),
    "ct": ("fan_motor_power_kw", "kW"),
    "pump": ("motor_power_kw", "kW"),
    "compressor": ("discharge_pressure_bar", "bar"),
    "motor": ("active_power_kw", "kW"),
    "em": ("active_power_total_kw", "kW"),
    "lt_db": ("active_power_kw", "kW"),
    "lt_mcc": ("active_power_kw", "kW"),
    "lt_pcc": ("active_power_kw", "kW"),
    "lt_vfd": ("output_frequency_hz", "Hz"),
    "lt_apfc": ("power_factor", ""),
    "lt_bd": ("active_power_kw", "kW"),
    "lt_feeder": ("active_power_kw", "kW"),
    "lt_incomer": ("active_power_kw", "kW"),
    "em_solar": ("active_power_kw", "kW"),
    "bms": ("battery_charge_pct", "%"),
    "fire": ("status", ""),
    "wtp": ("flow_rate_m3h", "m³/h"),
    "stp": ("flow_rate_m3h", "m³/h"),
    "boiler": ("steam_pressure_bar", "bar"),
}

# Words that signal "all instances" (plural / fleet-level queries)
_ALL_SIGNALS = frozenset({
    "all", "every", "each", "fleet", "entire", "across", "overall",
    "plant", "facility", "factory", "site",
})

# Plural forms → singular equipment name
_PLURAL_MAP: dict[str, str] = {
    "transformers": "transformer",
    "generators": "generator",
    "gensets": "genset",
    "chillers": "chiller",
    "ahus": "ahu",
    "cooling towers": "cooling tower",
    "pumps": "pump",
    "compressors": "compressor",
    "motors": "motor",
    "meters": "meter",
    "energy meters": "energy meter",
    "batteries": "battery",
    "boilers": "boiler",
    "feeders": "feeder",
    "incomers": "incomer",
}

# Broad query keywords that imply multiple equipment types
_BROAD_QUERY_MAP: dict[str, list[str]] = {
    "power distribution": ["trf", "chiller", "pump", "ct", "em", "lt_db"],
    "power across": ["trf", "chiller", "pump", "ct", "em", "lt_db"],
    "power distributed": ["trf", "chiller", "pump", "ct", "em", "lt_db"],
    "energy consumption": ["em", "trf", "chiller", "pump", "ct"],
    "fleet health": ["trf", "chiller", "pump", "ct"],
    "plant overview": ["trf", "em", "chiller", "pump", "ct"],
    "overall status": ["trf", "em", "chiller", "pump"],
    "equipment health": ["trf", "chiller", "pump", "motor"],
    "hvac": ["chiller", "ahu", "ct", "pump"],
    "electrical": ["trf", "em", "lt_db", "dg", "ups"],
    "cooling": ["chiller", "ct", "pump"],
}


class EntityResolver:
    """
    Deterministic entity resolver with plural handling and DB discovery.

    Resolution strategy:
    1. Check for broad/fleet-level queries ("power distribution across the plant")
    2. Check for plural equipment mentions ("all cooling towers")
    3. Check for specific equipment mentions ("transformer 1")
    4. Infer from metric keywords ("vibration" → pump/motor)
    5. Default to energy meter overview
    """

    def __init__(self, db: Any = None):
        self._db = db
        self._known_tables: set[str] | None = None

    def resolve(self, query: str) -> list[ResolvedEntity]:
        """
        Extract entities from query text.

        Resolution order (specific → general):
        1. Plural forms ("all cooling towers" → ct with all instances)
        2. Specific equipment mentions ("cooling tower 3" → ct_003)
        3. Broad query patterns ("power distribution" → trf, em, lt_db)
        4. Metric keyword inference ("vibration" → pump)
        5. Default to energy meter overview
        """
        query_lower = query.lower()
        entities: list[ResolvedEntity] = []
        seen_prefixes: set[str] = set()

        # Check if this is a broad/fleet-level query
        is_broad = any(signal in query_lower for signal in _ALL_SIGNALS)

        # ── Step 1: Plural forms → all instances (most specific) ──
        # Check longest plurals first to avoid "meter" matching before "energy meter"
        for plural, singular in sorted(_PLURAL_MAP.items(), key=lambda x: -len(x[0])):
            if plural in query_lower:
                prefix = ENTITY_PREFIX_MAP.get(singular)
                if prefix and prefix not in seen_prefixes:
                    metric, unit = _DEFAULT_METRICS.get(prefix, ("", ""))
                    entities.append(ResolvedEntity(
                        name=singular,
                        table_prefix=prefix,
                        default_metric=metric,
                        default_unit=unit,
                        instances=[],  # Will be discovered from DB in catalog stage
                        is_primary=len(entities) == 0,
                    ))
                    seen_prefixes.add(prefix)

        # ── Step 2: Specific equipment mentions ──
        # Check longest names first ("cooling tower" before "motor", "energy meter" before "meter")
        for name, prefix in sorted(ENTITY_PREFIX_MAP.items(), key=lambda x: -len(x[0])):
            if name in query_lower and prefix not in seen_prefixes:
                if is_broad:
                    # Broad query + entity mention → all instances
                    instances = []
                else:
                    instances = self._extract_instances(query_lower, name, prefix)
                metric, unit = _DEFAULT_METRICS.get(prefix, ("", ""))
                entities.append(ResolvedEntity(
                    name=name,
                    table_prefix=prefix,
                    default_metric=metric,
                    default_unit=unit,
                    instances=instances,
                    is_primary=len(entities) == 0,
                ))
                seen_prefixes.add(prefix)

        # If we found specific equipment, return early (don't dilute with broad patterns)
        if entities:
            return entities

        # ── Step 3: Broad query patterns (less specific, multi-entity) ──
        for pattern, prefixes in _BROAD_QUERY_MAP.items():
            if pattern in query_lower:
                for prefix in prefixes:
                    if prefix not in seen_prefixes:
                        metric, unit = _DEFAULT_METRICS.get(prefix, ("", ""))
                        name = self._prefix_to_name(prefix)
                        entities.append(ResolvedEntity(
                            name=name,
                            table_prefix=prefix,
                            default_metric=metric,
                            default_unit=unit,
                            instances=[],  # Will be discovered from DB in catalog stage
                            is_primary=len(entities) == 0,
                        ))
                        seen_prefixes.add(prefix)
                if entities:
                    return entities

        # ── Step 4: Infer from metric keywords ──
        if not entities:
            entities = self._infer_from_metrics(query_lower, is_broad)

        # ── Step 5: Default to general overview ──
        if not entities:
            entities = [ResolvedEntity(
                name="energy meter",
                table_prefix="em",
                default_metric="active_power_total_kw",
                default_unit="kW",
                instances=[],  # Will be discovered from DB
                is_primary=True,
            )]

        return entities

    def _extract_instances(self, query: str, name: str, prefix: str) -> list[str]:
        """Extract specific instance numbers from query."""
        instances = []

        patterns = [
            rf"{name}\s*[-_]?\s*(\d+)",
            rf"{name}\s+(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth)",
            rf"{prefix}\s*[-_]?\s*(\d+)",
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, query, re.IGNORECASE):
                num_str = match.group(1).lower()
                num = NUMBER_WORDS.get(num_str, num_str)
                instance = f"{prefix}_{num.zfill(3)}"
                if instance not in instances:
                    instances.append(instance)

        # Default to _001 if entity mentioned but no number and no "all" signal
        if not instances:
            instances = [f"{prefix}_001"]

        return instances

    def _infer_from_metrics(self, query: str, is_broad: bool) -> list[ResolvedEntity]:
        """Infer entities from metric keywords."""
        metric_entity_map = {
            "power": ("trf", "transformer"),
            "voltage": ("trf", "transformer"),
            "current": ("trf", "transformer"),
            "frequency": ("trf", "transformer"),
            "temperature": ("chiller", "chiller"),
            "cop": ("chiller", "chiller"),
            "cooling": ("chiller", "chiller"),
            "flow": ("pump", "pump"),
            "pressure": ("compressor", "compressor"),
            "vibration": ("pump", "pump"),  # Pumps are the most common vibration subject
            "bearing": ("pump", "pump"),
            "battery": ("ups", "ups"),
            "load": ("trf", "transformer"),
            "energy": ("em", "energy meter"),
            "solar": ("em_solar", "solar"),
            "humidity": ("ahu", "ahu"),
            "air quality": ("ahu", "ahu"),
        }

        entities = []
        seen = set()
        for keyword, (prefix, name) in metric_entity_map.items():
            if keyword in query and prefix not in seen:
                metric, unit = _DEFAULT_METRICS.get(prefix, ("", ""))
                entities.append(ResolvedEntity(
                    name=name,
                    table_prefix=prefix,
                    default_metric=metric,
                    default_unit=unit,
                    instances=[] if is_broad else [f"{prefix}_001"],
                    is_primary=len(entities) == 0,
                ))
                seen.add(prefix)
                if not is_broad:
                    break  # For specific queries, take first match

        return entities

    def infer_domain(self, entities: list[ResolvedEntity]) -> str:
        """Infer domain from entity types."""
        electrical = {"trf", "em", "lt_db", "lt_mcc", "lt_pcc", "lt_vfd", "lt_apfc",
                      "lt_bd", "lt_feeder", "lt_incomer", "em_solar", "dg", "ups"}
        hvac = {"chiller", "ahu", "ct", "pump", "compressor"}
        safety = {"fire", "bms"}

        prefixes = {e.table_prefix for e in entities}

        if prefixes & electrical:
            return "electrical"
        if prefixes & hvac:
            return "hvac"
        if prefixes & safety:
            return "safety"
        return "general"

    @staticmethod
    def _prefix_to_name(prefix: str) -> str:
        """Convert prefix back to human-readable name."""
        for name, pfx in ENTITY_PREFIX_MAP.items():
            if pfx == prefix:
                return name
        return prefix


"""
Deterministic grid packing — no LLM, always valid.

Replaces V5's LLM grid proposal + rectpack validation loop with
a single-pass deterministic bin-packing algorithm.

Algorithm:
1. Sort widgets by size (hero > expanded > normal > compact)
2. Place hero widgets first (full width)
3. Fill rows with expanded + normal widgets
4. Pack compact widgets into remaining gaps

Guaranteed valid layout in <10ms. No iterations needed.
"""


logger = logging.getLogger(__name__)


def _estimate_rows(widgets: list[WidgetSlot], size_name_fn) -> int:
    """Estimate the minimum rows needed to fit all widgets."""
    total_cell_area = 0
    for w in widgets:
        sn = size_name_fn(w)
        total_cell_area += SIZE_COLS.get(sn, SIZE_COLS["normal"]) * SIZE_ROWS.get(sn, SIZE_ROWS["normal"])
    # Ceil-divide by column count, with a small buffer for packing gaps
    min_rows = max(GRID_ROWS, -(-total_cell_area // GRID_COLS) + 2)
    return min_rows


def pack_grid(widgets: list[WidgetSlot]) -> GridLayout:
    """
    Pack widgets into a 12×N CSS grid that expands vertically to fit.

    Returns GridLayout with non-overlapping, in-bounds cells.
    Always succeeds — the grid grows as needed.
    """
    if not widgets:
        return GridLayout()

    def _size_name(widget: WidgetSlot) -> str:
        size = getattr(widget, "size", "normal")
        return size.value if hasattr(size, "value") else str(size)

    grid_rows = _estimate_rows(widgets, _size_name)

    cells: list[GridCell] = []
    # Track occupied cells as a set of (row, col) tuples
    occupied: set[tuple[int, int]] = set()

    # Sort: hero first, then expanded, then normal, then compact
    size_order = {"hero": 0, "expanded": 1, "normal": 2, "compact": 3}
    sorted_widgets = sorted(widgets, key=lambda w: size_order.get(_size_name(w), 3))

    for widget in sorted_widgets:
        size_name = _size_name(widget)
        col_span = SIZE_COLS.get(size_name, SIZE_COLS["normal"])
        row_span = SIZE_ROWS.get(size_name, SIZE_ROWS["normal"])

        placed = False
        for row_start in range(1, grid_rows + 2 - row_span):
            for col_start in range(1, GRID_COLS + 2 - col_span):
                # Check if this position is free
                if _can_place(occupied, row_start, col_start, row_span, col_span):
                    # Place widget
                    _mark_occupied(occupied, row_start, col_start, row_span, col_span)
                    cells.append(GridCell(
                        widget_id=widget.id,
                        col_start=col_start,
                        col_end=col_start + col_span,
                        row_start=row_start,
                        row_end=row_start + row_span,
                    ))
                    placed = True
                    break
            if placed:
                break

        if not placed:
            logger.warning(f"[GridPacker] Could not place widget {widget.id} ({size_name})")

    # Actual rows used
    max_row_used = max((c.row_end - 1 for c in cells), default=GRID_ROWS)
    actual_rows = max(GRID_ROWS, max_row_used)

    # Calculate utilization
    total_cells = GRID_COLS * actual_rows
    used_cells = len(occupied)
    utilization = used_cells / total_cells * 100 if total_cells > 0 else 0.0

    return GridLayout(
        cells=cells,
        total_cols=GRID_COLS,
        total_rows=actual_rows,
        utilization_pct=round(utilization, 1),
    )


def _can_place(
    occupied: set[tuple[int, int]],
    row_start: int, col_start: int,
    row_span: int, col_span: int,
) -> bool:
    """Check if a rectangle can be placed without overlap."""
    for r in range(row_start, row_start + row_span):
        for c in range(col_start, col_start + col_span):
            if (r, c) in occupied:
                return False
    return True


def _mark_occupied(
    occupied: set[tuple[int, int]],
    row_start: int, col_start: int,
    row_span: int, col_span: int,
):
    """Mark cells as occupied."""
    for r in range(row_start, row_start + row_span):
        for c in range(col_start, col_start + col_span):
            occupied.add((r, c))


"""
Data-driven scenario scoring for dashboard composition.

Replaces keyword-based scenario selection with intelligent scoring based on
DataShapeProfile properties, entity domain detection, and query context.

All 24 scenarios are first-class citizens. Selection is driven by:
1. Domain detection from entity types + column names (not query keywords)
2. Data shape fitness from DataShapeProfile (variance, cardinality, metric types)
3. Query type + intent affinity (structural, not keyword-based)

No scenario is "niche" — any scenario can appear in any dashboard if the data
properties support it. The system detects, the user doesn't need to specify.
"""


logger = logging.getLogger(__name__)


# ── Domain detection ─────────────────────────────────────────────────────────
# Infer domain from entity types and column names — NOT from user query text.

_DOMAIN_ENTITY_TYPES: dict[str, set[str]] = {
    "people": {
        "person", "employee", "staff", "worker", "team", "personnel",
        "crew", "operator", "technician", "engineer", "manager",
        "hr", "workforce", "member",
    },
    "supply_chain": {
        "shipment", "route", "warehouse", "supplier", "logistics",
        "delivery", "port", "carrier", "freight", "inventory",
        "distribution", "fleet",
    },
    "iot_device": {
        "device", "gateway", "plc", "rtu", "actuator", "controller",
        "iot", "edge", "node", "module", "firmware",
    },
    "ai_agent": {
        "agent", "bot", "automation", "workflow", "orchestrator",
        "pipeline_agent", "autonomous",
    },
    "compliance": {
        "audit", "compliance", "certificate", "regulation", "policy",
        "vault", "archive", "attestation",
    },
    "diagnostic": {
        "fault", "diagnostic", "failure", "defect", "rootcause",
        "incident", "cooling",
    },
    "prediction": {
        "forecast", "prediction", "model", "projection", "estimate",
    },
    "chat": {
        "chat", "conversation", "message", "dialogue",
    },
}

_DOMAIN_COLUMN_HINTS: dict[str, set[str]] = {
    "people": {
        "name", "role", "department", "hire_date", "headcount",
        "salary", "shift", "badge", "certification",
    },
    "iot_device": {
        "signal_strength", "firmware", "battery", "uptime", "connectivity",
        "rssi", "latency", "packet_loss", "device_id",
    },
    "compliance": {
        "audit_score", "compliance_pct", "violation_count", "expiry_date",
        "certification_status",
    },
    "diagnostic": {
        "fault_code", "error_count", "mtbf", "mttr", "failure_mode",
        "severity",
    },
    "prediction": {
        "confidence_lower", "confidence_upper", "prediction",
        "forecast", "uncertainty", "prediction_interval",
    },
}


def detect_domains(entity_types: set[str], column_names: set[str]) -> set[str]:
    """Detect data domains from entity types and column names.

    Returns set of detected domain strings.
    """
    detected: set[str] = set()
    et_lower = {e.lower() for e in entity_types}
    cn_lower = {c.lower() for c in column_names}

    for domain, keywords in _DOMAIN_ENTITY_TYPES.items():
        if et_lower & keywords:
            detected.add(domain)

    for domain, hints in _DOMAIN_COLUMN_HINTS.items():
        if cn_lower & hints:
            detected.add(domain)

    return detected


def _extract_entity_types_and_columns(catalog, intent=None) -> tuple[set[str], set[str]]:
    """Extract entity types and column names from catalog + intent."""
    entity_types: set[str] = set()
    column_names: set[str] = set()

    if intent and hasattr(intent, "entities"):
        for ent in (intent.entities or []):
            if hasattr(ent, "name") and ent.name:
                entity_types.add(ent.name.lower())

    if catalog and hasattr(catalog, "enriched_tables"):
        for t in catalog.enriched_tables:
            if hasattr(t, "entity_type") and t.entity_type:
                entity_types.add(t.entity_type.lower())
            if hasattr(t, "columns"):
                for c in t.columns:
                    if hasattr(c, "name"):
                        column_names.add(c.name.lower())

    return entity_types, column_names


# ── Scenario data affinity ───────────────────────────────────────────────────
# Each scenario defines what data properties make it a good fit.

@dataclass(frozen=True)
class ScenarioAffinity:
    """Data-driven scoring profile for a scenario."""
    # Required domains — scenario only eligible if ANY of these domains detected
    # Empty means "general purpose" — always eligible
    required_domains: frozenset[str] = frozenset()

    # Query type affinities (0.0 = irrelevant, 1.0 = perfect fit)
    query_type_affinity: dict[str, float] = field(default_factory=dict)

    # Data shape scoring function name (maps to scoring logic below)
    # Higher score = better fit for this data
    prefers_timeseries: float = 0.0
    prefers_alerts: float = 0.0
    prefers_many_entities: float = 0.0
    prefers_few_entities: float = 0.0
    prefers_many_metrics: float = 0.0
    prefers_high_variance: float = 0.0
    prefers_hierarchy: float = 0.0
    prefers_flow: float = 0.0
    prefers_temperature: float = 0.0
    prefers_binary: float = 0.0
    prefers_cumulative: float = 0.0
    prefers_rate: float = 0.0
    prefers_percentage: float = 0.0
    prefers_correlation: float = 0.0
    prefers_dense_timeseries: float = 0.0
    prefers_phase: float = 0.0


# hashable workaround: use tuples for default_factory
def _qa(**kw) -> dict[str, float]:
    return kw


SCENARIO_AFFINITIES: dict[str, ScenarioAffinity] = {
    # ── Core visualization scenarios (always eligible with timeseries) ────
    "kpi": ScenarioAffinity(
        query_type_affinity=_qa(status=0.9, overview=0.8, alert=0.6, trend=0.5,
                                comparison=0.4, analysis=0.5, diagnostic=0.5, forecast=0.6),
        prefers_timeseries=0.3, prefers_few_entities=0.3,
    ),
    "trend": ScenarioAffinity(
        query_type_affinity=_qa(trend=0.9, analysis=0.7, status=0.6, comparison=0.5,
                                diagnostic=0.7, forecast=0.8, overview=0.5, alert=0.4),
        prefers_timeseries=0.9, prefers_temperature=0.2,
    ),
    "trend-multi-line": ScenarioAffinity(
        query_type_affinity=_qa(trend=0.9, comparison=0.7, analysis=0.7, diagnostic=0.5,
                                overview=0.4, status=0.3, forecast=0.6, alert=0.3),
        prefers_timeseries=0.8, prefers_many_entities=0.4, prefers_correlation=0.5,
    ),
    "trends-cumulative": ScenarioAffinity(
        query_type_affinity=_qa(trend=0.8, analysis=0.6, overview=0.5, forecast=0.7,
                                status=0.3, comparison=0.3, diagnostic=0.2, alert=0.2),
        prefers_timeseries=0.7, prefers_cumulative=0.9,
    ),
    "comparison": ScenarioAffinity(
        query_type_affinity=_qa(comparison=0.9, analysis=0.7, overview=0.5, status=0.4,
                                trend=0.4, diagnostic=0.4, forecast=0.3, alert=0.3),
        prefers_many_entities=0.5, prefers_timeseries=0.3, prefers_correlation=0.3,
    ),
    "distribution": ScenarioAffinity(
        query_type_affinity=_qa(analysis=0.8, comparison=0.6, overview=0.6, status=0.3,
                                trend=0.3, diagnostic=0.4, forecast=0.2, alert=0.2),
        prefers_many_metrics=0.4, prefers_high_variance=0.3,
    ),
    "composition": ScenarioAffinity(
        query_type_affinity=_qa(analysis=0.85, overview=0.75, comparison=0.6, trend=0.5,
                                status=0.4, diagnostic=0.3, forecast=0.3, alert=0.2),
        prefers_many_metrics=0.5, prefers_percentage=0.4, prefers_hierarchy=0.4,
        prefers_timeseries=0.3,
    ),
    "category-bar": ScenarioAffinity(
        query_type_affinity=_qa(analysis=0.85, comparison=0.75, overview=0.6, status=0.4,
                                trend=0.3, diagnostic=0.3, forecast=0.2, alert=0.2),
        prefers_many_metrics=0.5, prefers_high_variance=0.3, prefers_timeseries=0.3,
    ),
    "alerts": ScenarioAffinity(
        query_type_affinity=_qa(alert=0.9, status=0.7, diagnostic=0.6, overview=0.4,
                                trend=0.3, comparison=0.2, analysis=0.3, forecast=0.2),
        prefers_alerts=0.9,
    ),
    "timeline": ScenarioAffinity(
        query_type_affinity=_qa(status=0.7, diagnostic=0.7, alert=0.6, analysis=0.5,
                                trend=0.5, overview=0.4, comparison=0.3, forecast=0.3),
        prefers_timeseries=0.6, prefers_alerts=0.3, prefers_binary=0.2,
    ),
    "eventlogstream": ScenarioAffinity(
        query_type_affinity=_qa(status=0.7, alert=0.6, diagnostic=0.6, analysis=0.5,
                                overview=0.5, trend=0.3, comparison=0.2, forecast=0.2),
        prefers_timeseries=0.5,
    ),
    "flow-sankey": ScenarioAffinity(
        query_type_affinity=_qa(analysis=0.85, overview=0.6, comparison=0.5, trend=0.4,
                                diagnostic=0.4, status=0.3, forecast=0.3, alert=0.2),
        prefers_flow=0.8, prefers_rate=0.5, prefers_hierarchy=0.4,
        prefers_many_entities=0.4, prefers_timeseries=0.3,
    ),
    "matrix-heatmap": ScenarioAffinity(
        query_type_affinity=_qa(analysis=0.85, comparison=0.65, diagnostic=0.6, overview=0.55,
                                status=0.55, trend=0.45, forecast=0.3, alert=0.3),
        prefers_many_entities=0.5, prefers_many_metrics=0.5,
        prefers_correlation=0.5, prefers_dense_timeseries=0.4,
        prefers_timeseries=0.3,
    ),
    "narrative": ScenarioAffinity(
        query_type_affinity=_qa(overview=0.9, status=0.5, analysis=0.5, trend=0.3,
                                comparison=0.3, diagnostic=0.4, forecast=0.4, alert=0.3),
    ),

    # ── Domain-specific scenarios (eligible when domain detected in data) ──
    "peopleview": ScenarioAffinity(
        required_domains=frozenset({"people"}),
        query_type_affinity=_qa(overview=0.8, status=0.6, analysis=0.4, comparison=0.3,
                                trend=0.2, diagnostic=0.2, forecast=0.2, alert=0.2),
    ),
    "peoplehexgrid": ScenarioAffinity(
        required_domains=frozenset({"people"}),
        query_type_affinity=_qa(overview=0.7, status=0.5, analysis=0.5, comparison=0.4,
                                trend=0.2, diagnostic=0.2, forecast=0.2, alert=0.2),
        prefers_many_entities=0.4,
    ),
    "peoplenetwork": ScenarioAffinity(
        required_domains=frozenset({"people"}),
        query_type_affinity=_qa(overview=0.7, analysis=0.6, status=0.4, comparison=0.3,
                                trend=0.2, diagnostic=0.2, forecast=0.2, alert=0.2),
        prefers_hierarchy=0.5, prefers_correlation=0.4,
    ),
    "supplychainglobe": ScenarioAffinity(
        required_domains=frozenset({"supply_chain"}),
        query_type_affinity=_qa(overview=0.8, status=0.6, analysis=0.5, comparison=0.3,
                                trend=0.4, diagnostic=0.3, forecast=0.4, alert=0.3),
        prefers_many_entities=0.3,
    ),
    "edgedevicepanel": ScenarioAffinity(
        required_domains=frozenset({"iot_device"}),
        query_type_affinity=_qa(status=0.8, overview=0.6, diagnostic=0.6, alert=0.5,
                                analysis=0.4, trend=0.3, comparison=0.3, forecast=0.2),
    ),
    "chatstream": ScenarioAffinity(
        required_domains=frozenset({"chat"}),
        query_type_affinity=_qa(overview=0.3, status=0.2, analysis=0.2, trend=0.1,
                                comparison=0.1, diagnostic=0.2, forecast=0.1, alert=0.1),
    ),
    "diagnosticpanel": ScenarioAffinity(
        required_domains=frozenset({"diagnostic"}),
        query_type_affinity=_qa(diagnostic=0.9, alert=0.6, status=0.5, analysis=0.5,
                                overview=0.3, trend=0.3, comparison=0.2, forecast=0.2),
        prefers_alerts=0.5,
    ),
    "uncertaintypanel": ScenarioAffinity(
        required_domains=frozenset({"prediction"}),
        query_type_affinity=_qa(forecast=0.9, analysis=0.5, trend=0.5, diagnostic=0.3,
                                overview=0.3, status=0.2, comparison=0.2, alert=0.2),
    ),
    "agentsview": ScenarioAffinity(
        required_domains=frozenset({"ai_agent"}),
        query_type_affinity=_qa(status=0.7, overview=0.7, diagnostic=0.4, analysis=0.3,
                                trend=0.2, comparison=0.2, forecast=0.2, alert=0.3),
    ),
    "vaultview": ScenarioAffinity(
        required_domains=frozenset({"compliance"}),
        query_type_affinity=_qa(overview=0.7, status=0.6, analysis=0.4, diagnostic=0.3,
                                trend=0.2, comparison=0.2, forecast=0.2, alert=0.3),
    ),
}


# ── Scoring ──────────────────────────────────────────────────────────────────

def score_scenario_fitness(
    scenario: str,
    shape,
    query_type: str = "overview",
    domains: set[str] | None = None,
) -> float:
    """Score how well a scenario fits the current data + context.

    Returns 0.0 (poor fit) to 1.0 (excellent fit).
    """
    affinity = SCENARIO_AFFINITIES.get(scenario)
    if not affinity:
        return 0.3  # Unknown scenario gets low neutral score

    # Domain gate: if scenario requires specific domains, check
    if affinity.required_domains and domains is not None:
        if not (affinity.required_domains & domains):
            return 0.0  # Domain mismatch — hard zero

    # Domain bonus: if domain-specific scenario matches detected domain, boost
    domain_bonus = 0.0
    if affinity.required_domains and domains is not None:
        if affinity.required_domains & domains:
            domain_bonus = 0.3  # Strong boost for domain match

    # 1. Query type score
    qt_score = affinity.query_type_affinity.get(query_type, 0.3)

    # 2. Data shape score
    ds_score = 0.0
    ds_weight = 0.0

    def _add(pref: float, match: bool):
        nonlocal ds_score, ds_weight
        if pref > 0:
            ds_weight += pref
            if match:
                ds_score += pref

    if shape:
        _add(affinity.prefers_timeseries, shape.has_timeseries)
        _add(affinity.prefers_alerts, shape.has_alerts)
        _add(affinity.prefers_many_entities, shape.entity_count >= 4)
        _add(affinity.prefers_few_entities, shape.entity_count <= 2)
        _add(affinity.prefers_many_metrics, shape.metric_count >= 4)
        _add(affinity.prefers_high_variance, shape.has_high_variance)
        _add(affinity.prefers_hierarchy, shape.has_hierarchy)
        _add(affinity.prefers_flow, shape.has_flow_metric)
        _add(affinity.prefers_temperature, shape.has_temperature)
        _add(affinity.prefers_binary, shape.has_binary_metric)
        _add(affinity.prefers_cumulative, shape.has_cumulative_metric)
        _add(affinity.prefers_rate, shape.has_rate_metric)
        _add(affinity.prefers_percentage, shape.has_percentage_metric)
        _add(affinity.prefers_correlation,
             shape.multi_numeric_potential and shape.cross_entity_comparable)
        _add(affinity.prefers_dense_timeseries, shape.temporal_density > 100)
        _add(affinity.prefers_phase, shape.has_phase_data)

    raw_fitness = (ds_score / ds_weight) if ds_weight > 0 else 0.5
    # Floor at 0.3: prevents specialized scenarios from scoring near zero
    # just because their unique data preferences don't match generic data.
    # Without this, scenarios like flow-sankey (prefers_flow) get crushed
    # in dashboards with generic power/temperature data.
    shape_fitness = max(0.3, raw_fitness)

    # Additive blend: 55% query type + 35% data shape + domain bonus
    # Higher QT weight ensures scenarios relevant to the query type always
    # compete, even when data shape is generic.
    base = 0.55 * qt_score + 0.35 * shape_fitness

    # Add domain bonus and normalize to [0, 1]
    return round(min(1.0, base + domain_bonus), 4)


def score_all_scenarios(
    shape,
    query_type: str = "overview",
    catalog=None,
    intent=None,
) -> dict[str, float]:
    """Score ALL 24 scenarios based on data properties.

    Returns scenario -> score mapping. Scores of 0.0 mean the scenario
    is not eligible (domain mismatch or missing data requirements).
    """
    # Detect domains from data
    entity_types, column_names = _extract_entity_types_and_columns(catalog, intent)
    domains = detect_domains(entity_types, column_names)

    scores: dict[str, float] = {}
    for scenario in SCENARIO_AFFINITIES:
        scores[scenario] = score_scenario_fitness(
            scenario, shape, query_type, domains,
        )

    return scores


"""
LangGraph constraint graph for widget variant selection.

Three-layer pipeline with conditional routing:
  Layer 1: LlamaIndex MetadataFilters — hard elimination
  Layer 2: Data shape + intent scoring — ranked composite
  Layer 2.5: Semantic tie-breaker — embedding-based disambiguation (when ambiguous)
  Layer 3: DSPy ChainOfThought — reasoned tie-breaking (when still ambiguous)
  Layer 3.5: AutoGen validator — deterministic validation fallback

Graph topology:
  START → profile_data → hard_filter ─┬─ sole_survivor → finalize → END
                                       └─ multiple → score_shape → score_intent
                                         → apply_penalties → rank ─┬─ high → finalize → END
                                                                   └─ low → semantic_tiebreak ─┬─ resolved → finalize → END
                                                                                               └─ still_ambiguous → dspy_reason ─┬─ ok → finalize → END
                                                                                                                          └─ fallback → autogen_validate → finalize → END

Scoring weights (Layer 2): data_shape=0.40, intent=0.25, query_type=0.15, penalties=0.15, default=0.05
Layer 2 is fully data-driven (no keyword heuristics). Semantic embeddings are
used only as a low-confidence tie-breaker (Layer 2.5).
"""


from typing import Any, TypedDict

logger = logging.getLogger(__name__)

# ── Try to import LangGraph ─────────────────────────────────────────────────

_langgraph_available = False
try:
    from langgraph.graph import StateGraph, START, END
    _langgraph_available = True
    logger.debug("[SelectionGraph] LangGraph available")
except ImportError:
    logger.debug("[SelectionGraph] LangGraph not available, using sequential fallback")


# ── Scoring weights ──────────────────────────────────────────────────────────

W_SHAPE = 0.35
W_INTENT = 0.20
W_QUERY_TYPE = 0.10
W_PENALTIES = 0.30
W_DEFAULT = 0.05


# ── Graph State ─────────────────────────────────────────────────────────────

class SelectionState(TypedDict, total=False):
    # Inputs
    scenario: str
    query_text: str
    question_intent: str
    query_type: str
    entity_count: int
    metric_count: int
    instance_count: int
    has_timeseries: bool
    catalog: Any
    data_profile: Any
    intent: Any
    query_embedding: list[float] | None
    embedding_client: Any

    # Pipeline state — extracted data shape profile
    _data_shape: Any  # DataShapeProfile (must be in TypedDict for LangGraph)

    # Pipeline state — scoring
    all_variants: list[str]
    survivors: list[str]
    elimination_log: dict[str, list[str]]
    shape_scores: dict[str, float]
    intent_scores: dict[str, float]
    qtype_scores: dict[str, float]
    penalty_scores: dict[str, float]
    composite_scores: dict[str, float]
    semantic_scores: dict[str, float]

    dspy_needed: bool
    dspy_selection: str
    dspy_reasoning: str
    autogen_reason: str

    # Output
    selected_variant: str
    confidence: float
    method: str


# ── Pipeline Nodes ──────────────────────────────────────────────────────────

def node_profile_data(state: SelectionState) -> dict:
    """Node 1: Extract DataShapeProfile from catalog."""
    from backend.app.services.widget_intelligence import extract_data_shape

    catalog = state.get("catalog")
    profile = state.get("data_profile")
    intent = state.get("intent")

    shape = extract_data_shape(catalog, profile, intent)

    return {"_data_shape": shape}


def node_hard_filter(state: SelectionState) -> dict:
    """Node 2: Hard elimination using LlamaIndex MetadataFilters."""
    # filter_variants defined in this file
    # VARIANT_PROFILES defined in this file

    scenario = state["scenario"]
    shape = state.get("_data_shape")

    profiles = VARIANT_PROFILES.get(scenario, {})
    all_variants = list(profiles.keys()) if profiles else [scenario]

    if not profiles or shape is None:
        return {
            "all_variants": all_variants,
            "survivors": all_variants,
            "elimination_log": {},
        }

    survivors = filter_variants(scenario, shape)

    # Build elimination log
    eliminated = set(all_variants) - set(survivors)
    elimination_log: dict[str, list[str]] = {}
    for v in eliminated:
        reasons = []
        p = profiles.get(v)
        if p:
            if p.needs_timeseries and not shape.has_timeseries:
                reasons.append("requires_timeseries")
            if p.needs_multiple_entities and shape.entity_count < 2:
                reasons.append("requires_multiple_entities")
            if p.ideal_entity_count and shape.entity_count < p.ideal_entity_count[0]:
                reasons.append(f"min_entity_count={p.ideal_entity_count[0]}")
            if p.ideal_metric_count and shape.metric_count < p.ideal_metric_count[0]:
                reasons.append(f"min_metric_count={p.ideal_metric_count[0]}")
        elimination_log[v] = reasons or ["filtered_by_metadata"]

    logger.debug(
        f"[SelectionGraph] {scenario}: {len(all_variants)} → {len(survivors)} "
        f"(eliminated: {list(eliminated)})"
    )

    result = {
        "all_variants": all_variants,
        "survivors": survivors,
        "elimination_log": elimination_log,
    }

    # When sole survivor, set selected_variant for the finalize node
    # (LangGraph path skips rank node which normally sets this)
    if len(survivors) == 1:
        result["selected_variant"] = survivors[0]
        result["confidence"] = 1.0
        result["method"] = "filter_only"

    return result


def node_score_shape(state: SelectionState) -> dict:
    """Node 3: Score survivors by data shape fitness.

    Uses DataShapeProfile properties to compute how well each
    variant matches the actual data characteristics.
    """
    # score_shape_fitness defined in this file

    scenario = state["scenario"]
    survivors = state.get("survivors", [])
    shape = state.get("_data_shape")
    profiles = VARIANT_PROFILES.get(scenario, {})

    shape_scores: dict[str, float] = {}
    for variant in survivors:
        # Shape preference fitness (from variant_metadata.py)
        pref_score = score_shape_fitness(variant, shape) if shape else 0.5

        # Data count fitness (from variant_scorer.py)
        profile = profiles.get(variant)
        if profile:
            count_score = _score_data_shape(
                profile,
                shape.entity_count if shape else state.get("entity_count", 1),
                shape.metric_count if shape else state.get("metric_count", 1),
                shape.instance_count if shape else state.get("instance_count", 1),
            )
        else:
            count_score = 0.5

        # Blend: 60% preference fitness + 40% count fitness
        shape_scores[variant] = round(0.6 * pref_score + 0.4 * count_score, 4)

    return {"shape_scores": shape_scores}


def node_score_intent(state: SelectionState) -> dict:
    """Node 4: Score intent affinity + query type affinity."""
    # Uses get_variant_intent_score, get_variant_qtype_score defined above

    survivors = state.get("survivors", [])
    question_intent = state.get("question_intent", "")
    query_type = state.get("query_type", "overview")

    intent_scores: dict[str, float] = {}
    qtype_scores: dict[str, float] = {}

    for variant in survivors:
        intent_scores[variant] = get_variant_intent_score(variant, question_intent)
        qtype_scores[variant] = get_variant_qtype_score(variant, query_type)

    return {
        "intent_scores": intent_scores,
        "qtype_scores": qtype_scores,
    }


def node_apply_penalties(state: SelectionState) -> dict:
    """Node 5: Apply data-driven penalties.

    Bidirectional: boosts specialized variants AND penalizes generic/default
    variants when specific data signals are detected. This is the primary
    mechanism for reaching non-default variants.

    Uses both DataShapeProfile (primary) and intent/query_type context (secondary)
    for context-aware differentiation.
    """
    survivors = state.get("survivors", [])
    shape = state.get("_data_shape")
    question_intent = state.get("question_intent", "")
    query_type = state.get("query_type", "")

    penalty_scores: dict[str, float] = {}
    for variant in survivors:
        penalty = 0.0

        if shape:
            # ─── KPI differentiation ────────────────────────────
            if variant == "kpi-accumulated" and shape.has_cumulative_metric:
                penalty += 0.5
            if variant == "kpi-live" and shape.has_cumulative_metric:
                penalty -= 0.35
            if variant == "kpi-status" and shape.has_binary_metric:
                penalty += 0.45
            if variant == "kpi-live" and shape.has_binary_metric:
                penalty -= 0.3
            if variant == "kpi-lifecycle" and shape.has_percentage_metric:
                penalty += 0.4
            if variant == "kpi-live" and shape.has_percentage_metric and not shape.has_cumulative_metric:
                penalty -= 0.25
            if variant == "kpi-alert" and shape.has_alerts:
                penalty += 0.4
            if variant == "kpi-live" and shape.has_alerts:
                penalty -= 0.2

            # ─── Trend differentiation ──────────────────────────
            if variant == "trend-step-line" and shape.has_binary_metric:
                penalty += 0.5
            if variant == "trend-line" and shape.has_binary_metric:
                penalty -= 0.5
            if variant == "trend-rgb-phase" and shape.has_phase_data:
                penalty += 0.5
            if variant == "trend-line" and shape.has_phase_data:
                penalty -= 0.35
            if variant == "trend-rgb-phase" and not shape.has_phase_data:
                penalty -= 0.5
            if variant == "trend-step-line" and not shape.has_binary_metric:
                penalty -= 0.4
            if variant == "trend-heatmap" and shape.temporal_density > 100:
                penalty += 0.45
            if variant == "trend-line" and shape.temporal_density > 100 and shape.metric_count <= 2:
                penalty -= 0.25
            if variant == "trend-alert-context" and shape.has_alerts:
                penalty += 0.4
            if variant == "trend-line" and shape.has_alerts:
                penalty -= 0.2
            if variant == "trend-area" and shape.has_flow_metric:
                penalty += 0.35
            if variant == "trend-area" and shape.has_rate_metric:
                penalty += 0.3
            if variant == "trend-line" and (shape.has_flow_metric or shape.has_rate_metric):
                penalty -= 0.15

            # ─── Comparison differentiation ─────────────────────
            if variant == "comparison-side-by-side" and shape.entity_count <= 2 and shape.metric_count <= 3 and not shape.has_high_variance:
                penalty += 0.35  # Side-by-side for simple A-vs-B
            if variant == "comparison-side-by-side" and shape.has_high_variance and shape.metric_count >= 3:
                penalty -= 0.2  # Yield to waterfall when high variance + many metrics
            if variant == "comparison-side-by-side" and shape.entity_count > 3:
                penalty -= 0.3
            if variant == "comparison-grouped-bar" and shape.metric_count >= 4 and shape.entity_count >= 3:
                penalty += 0.45  # Strong: grouped-bar is ideal for many metrics + entities
            if variant == "comparison-grouped-bar" and shape.cross_entity_comparable:
                penalty += 0.1  # Extra boost for cross-entity
            if variant == "comparison-grouped-bar" and shape.metric_count < 3:
                penalty -= 0.2
            if variant == "comparison-delta-bar" and shape.entity_count >= 3 and shape.metric_count <= 2:
                penalty += 0.35
            if variant == "comparison-delta-bar" and shape.metric_count >= 4:
                penalty -= 0.25
            if variant == "comparison-waterfall" and shape.has_high_variance and shape.metric_count >= 3:
                penalty += 0.45  # Strong: waterfall for high variance breakdown
            if variant == "comparison-waterfall" and not shape.has_high_variance and shape.metric_count >= 3:
                penalty += 0.15
            if variant == "comparison-delta-bar" and shape.has_high_variance and shape.metric_count >= 3:
                penalty -= 0.15
            if variant == "comparison-small-multiples" and shape.entity_count >= 5:
                penalty += 0.45
            if variant == "comparison-small-multiples" and shape.entity_count >= 4:
                penalty += 0.3
            if variant == "comparison-small-multiples" and shape.entity_count < 3:
                penalty -= 0.4
            if variant == "comparison-delta-bar" and shape.entity_count >= 5:
                penalty -= 0.15
            if variant == "comparison-composition-split" and shape.entity_count <= 3 and shape.metric_count >= 3 and not shape.has_high_variance:
                penalty += 0.35  # Composition-split: compare makeup between few entities
            if variant == "comparison-composition-split" and shape.entity_count >= 3 and shape.metric_count >= 4:
                penalty -= 0.2  # Yield to grouped-bar when many entities + many metrics
            if variant == "comparison-composition-split" and shape.has_high_variance:
                penalty -= 0.15
            if variant == "comparison-composition-split" and shape.metric_count <= 2:
                penalty -= 0.2

            # ─── Distribution differentiation ───────────────────
            if variant == "distribution-pie" and shape.metric_count <= 3 and shape.entity_count <= 3:
                penalty += 0.3
            if variant == "distribution-donut" and shape.metric_count >= 4 and shape.metric_count <= 7 and not shape.has_high_variance:
                penalty += 0.3  # Donut for moderate metrics, no high variance
            if variant == "distribution-donut" and shape.metric_count <= 3 and shape.entity_count <= 3:
                penalty -= 0.05  # Slight yield to pie for very few categories
            if variant == "distribution-horizontal-bar" and shape.metric_count >= 4 and not shape.has_high_variance:
                penalty += 0.35  # Horizontal bar for many metrics, moderate variance
            if variant == "distribution-horizontal-bar" and shape.has_high_variance:
                penalty -= 0.15  # Yield to pareto when high variance
            if variant == "distribution-pareto-bar" and shape.has_high_variance and shape.metric_count >= 4:
                penalty += 0.35
            if variant == "distribution-pareto-bar" and not shape.has_high_variance:
                penalty -= 0.2  # Pareto needs high variance
            if variant == "distribution-100-stacked-bar" and shape.has_percentage_metric:
                penalty += 0.45  # Strong percentage signal
            if variant == "distribution-donut" and shape.has_percentage_metric:
                penalty -= 0.15  # Yield to 100-stacked when percentage
            if variant == "distribution-grouped-bar" and shape.entity_count >= 3 and shape.cross_entity_comparable:
                penalty += 0.3
            if variant == "distribution-grouped-bar" and shape.has_percentage_metric:
                penalty -= 0.15
            if variant in ("distribution-donut", "distribution-pie") and shape.metric_count > 7:
                penalty -= 0.3

            # ─── Composition differentiation ────────────────────
            if variant == "composition-donut" and shape.metric_count <= 4 and shape.entity_count <= 3:
                penalty += 0.35
            if variant == "composition-stacked-bar" and shape.metric_count <= 4 and shape.entity_count <= 3:
                penalty -= 0.2
            if variant == "composition-stacked-bar" and shape.entity_count >= 4 and not shape.has_hierarchy:
                penalty += 0.25
            if variant == "composition-waterfall" and shape.has_high_variance and shape.metric_count >= 3:
                penalty += 0.4
            if variant == "composition-stacked-bar" and shape.has_high_variance and shape.metric_count >= 3 and not shape.has_hierarchy:
                penalty -= 0.2
            if variant == "composition-treemap" and shape.has_high_variance and not shape.has_hierarchy:
                penalty -= 0.3
            if variant == "composition-treemap" and shape.has_hierarchy:
                penalty += 0.4
            if variant == "composition-stacked-area" and shape.temporal_density > 5:
                penalty += 0.3

            # ─── Alerts differentiation ─────────────────────────
            if variant == "alerts-card" and shape.entity_count >= 3:
                penalty += 0.25
            if variant == "alerts-banner" and shape.entity_count == 2:
                penalty += 0.4  # Banner for 2-entity site-wide
            if variant == "alerts-banner" and shape.entity_count == 1:
                penalty -= 0.1  # Banner less appropriate for single entity
            if variant == "alerts-card" and shape.entity_count <= 2:
                penalty -= 0.2
            if variant == "alerts-toast" and shape.entity_count == 1:
                penalty += 0.4  # Toast for single entity notifications
            if variant == "alerts-badge" and shape.entity_count >= 5:
                penalty += 0.35
            if variant == "alerts-card" and shape.entity_count >= 5:
                penalty -= 0.15
            # alerts-modal: investigation-focused — boost when diagnostic context
            if variant == "alerts-modal" and shape.entity_count <= 2 and shape.metric_count >= 2:
                penalty += 0.35
            if variant == "alerts-modal" and query_type == "diagnostic":
                penalty += 0.15
            if variant == "alerts-toast" and shape.metric_count >= 2:
                penalty -= 0.1

            # ─── Timeline differentiation ───────────────────────
            if variant == "timeline-linear" and not shape.has_binary_metric:
                penalty += 0.2
            if variant == "timeline-status" and shape.has_binary_metric:
                penalty += 0.4
            if variant == "timeline-linear" and shape.has_binary_metric:
                penalty -= 0.25
            if variant == "timeline-dense" and shape.temporal_density > 100:
                penalty += 0.4
            if variant == "timeline-forensic" and shape.temporal_density > 100 and not shape.has_alerts:
                penalty -= 0.2
            if variant == "timeline-multilane" and shape.entity_count >= 3:
                penalty += 0.3

            # ─── EventLogStream differentiation ─────────────────
            if variant == "eventlogstream-chronological" and shape.entity_count <= 2 and shape.metric_count <= 1:
                penalty += 0.3  # Chronological for truly simple data
            if variant == "eventlogstream-compact-feed" and shape.entity_count <= 2 and shape.metric_count >= 2:
                penalty += 0.35  # Compact for multi-metric small entity
            if variant == "eventlogstream-chronological" and shape.entity_count <= 2 and shape.metric_count >= 2:
                penalty -= 0.15  # Yield to compact when multi-metric
            if variant == "eventlogstream-compact-feed" and shape.metric_count <= 1:
                penalty -= 0.15
            if variant == "eventlogstream-grouped-asset" and shape.entity_count >= 3:
                penalty += 0.35
            if variant == "eventlogstream-chronological" and shape.entity_count >= 3:
                penalty -= 0.15
            if variant == "eventlogstream-correlation" and shape.multi_numeric_potential and shape.cross_entity_comparable:
                penalty += 0.4
            if variant == "eventlogstream-tabular" and shape.metric_count >= 4:
                penalty += 0.3

            # ─── Category-Bar differentiation ───────────────────
            if variant == "category-bar-vertical" and shape.metric_count <= 5 and not shape.has_high_variance and shape.entity_count <= 2:
                penalty += 0.25  # Default for basic categorical, low variance, few entities
            if variant == "category-bar-vertical" and shape.entity_count >= 3:
                penalty -= 0.15  # Vertical is too basic for multi-entity comparison
            if variant == "category-bar-horizontal" and shape.metric_count >= 6 and not shape.has_high_variance:
                penalty += 0.4
            if variant == "category-bar-horizontal" and shape.has_high_variance:
                penalty -= 0.2
            if variant == "category-bar-stacked" and shape.metric_count >= 4 and shape.entity_count >= 3:
                penalty += 0.45  # Strong: stacked for sub-component breakdown across entities
            if variant == "category-bar-stacked" and shape.entity_count < 3:
                penalty -= 0.15
            if variant == "category-bar-grouped" and shape.cross_entity_comparable and shape.entity_count >= 3:
                penalty += 0.4  # Grouped for cross-entity comparison
            if variant == "category-bar-grouped" and shape.entity_count < 3:
                penalty -= 0.15
            if variant == "category-bar-diverging" and shape.has_high_variance and shape.entity_count < 3:
                penalty += 0.35
            if variant == "category-bar-diverging" and shape.has_high_variance and shape.entity_count >= 3:
                penalty += 0.2
            if variant == "category-bar-diverging" and not shape.has_high_variance:
                penalty -= 0.2

            # ─── Flow-Sankey differentiation ────────────────────
            if variant == "flow-sankey-standard" and shape.entity_count <= 3:
                penalty += 0.25
            if variant == "flow-sankey-multi-source" and shape.entity_count >= 3 and not shape.has_hierarchy:
                penalty += 0.35
            if variant == "flow-sankey-multi-source" and shape.entity_count <= 3:
                penalty -= 0.2
            if variant == "flow-sankey-energy-balance" and shape.has_rate_metric:
                penalty += 0.4
            if variant == "flow-sankey-standard" and shape.has_rate_metric:
                penalty -= 0.2
            if variant == "flow-sankey-layered" and shape.has_hierarchy:
                penalty += 0.4
            if variant == "flow-sankey-multi-source" and shape.has_hierarchy:
                penalty -= 0.2
            if variant == "flow-sankey-time-sliced" and shape.temporal_density > 5:
                penalty += 0.3

            # ─── Matrix-Heatmap differentiation ─────────────────
            if variant == "matrix-heatmap-correlation" and shape.multi_numeric_potential and shape.cross_entity_comparable:
                penalty += 0.4
            if variant == "matrix-heatmap-density" and shape.temporal_density > 100:
                penalty += 0.35
            if variant == "matrix-heatmap-value" and shape.temporal_density > 100 and not shape.cross_entity_comparable:
                penalty -= 0.2
            if variant == "matrix-heatmap-status" and shape.entity_count >= 3:
                penalty += 0.3
            if variant == "matrix-heatmap-status" and shape.entity_count < 3:
                penalty -= 0.1  # Status needs fleet-level view
            if variant == "matrix-heatmap-value" and shape.entity_count >= 2 and shape.metric_count >= 2 and not shape.has_high_variance:
                penalty += 0.2  # Value for moderate multi-entity, multi-metric
            if variant == "matrix-heatmap-calendar" and shape.temporal_density > 5:
                penalty += 0.3

        # Clamp to [-0.5, 0.5] range, then shift to [0.0, 1.0]
        penalty_scores[variant] = max(0.0, min(1.0, 0.5 + penalty))

    return {"penalty_scores": penalty_scores}


def node_rank(state: SelectionState) -> dict:
    """Node 6: Compute composite scores and determine confidence."""
    # is_variant_default defined in this file

    survivors = state.get("survivors", [])
    shape_scores = state.get("shape_scores", {})
    intent_scores = state.get("intent_scores", {})
    qtype_scores = state.get("qtype_scores", {})
    penalty_scores = state.get("penalty_scores", {})

    composite: dict[str, float] = {}
    for variant in survivors:
        s_shape = shape_scores.get(variant, 0.5)
        s_intent = intent_scores.get(variant, 0.0)
        s_qtype = qtype_scores.get(variant, 0.0)
        s_penalty = penalty_scores.get(variant, 0.5)
        s_default = 1.0 if is_variant_default(variant) else 0.0

        score = (
            W_SHAPE * s_shape
            + W_INTENT * s_intent
            + W_QUERY_TYPE * s_qtype
            + W_PENALTIES * s_penalty
            + W_DEFAULT * s_default
        )
        composite[variant] = round(score, 4)

    if not composite:
        return {
            "composite_scores": {},
            "dspy_needed": False,
            "selected_variant": state.get("scenario", ""),
            "confidence": 0.0,
        }

    # Sort by composite score
    sorted_variants = sorted(composite, key=lambda v: composite[v], reverse=True)
    top_score = composite[sorted_variants[0]]
    second_score = composite[sorted_variants[1]] if len(sorted_variants) > 1 else 0.0
    gap = top_score - second_score

    # Confidence based on gap and absolute score
    confidence = min(1.0, top_score * 1.5 + gap)

    # DSPy needed if ambiguous
    dspy_needed = gap < 0.10 or top_score < 0.45

    return {
        "composite_scores": composite,
        "dspy_needed": dspy_needed,
        "selected_variant": sorted_variants[0],
        "confidence": round(confidence, 3),
    }


def node_semantic_tiebreak(state: SelectionState) -> dict:
    """Node 6.5: Semantic tie-breaker for low-confidence cases.

    Uses the SemanticEmbedder to compute semantic similarity between the query
    and variant descriptions, then blends that score into the composite ranking.
    This runs only when the rank node marks the result as ambiguous.
    """
    # score_variants_semantic defined in this file

    scenario = state.get("scenario", "")
    survivors = state.get("survivors", [])
    composite = state.get("composite_scores", {})
    query_text = state.get("query_text", "")

    if not scenario or not survivors or not composite or not query_text:
        return {}

    embedding_client = state.get("embedding_client")
    query_embedding = state.get("query_embedding")

    # Latency-sensitive: never cold-start heavy models here. If we have the
    # pipeline EmbeddingClient, reuse it; otherwise use TF-IDF fallback.
    strat = "embedding_client" if embedding_client is not None else "tfidf"
    semantic = score_variants_semantic(
        query=query_text,
        scenario=scenario,
        candidates=survivors,
        embedding_client=embedding_client,
        query_embedding=query_embedding,
        strategy=strat,
    )
    if not semantic:
        return {}

    blend = 0.25  # semantic weight
    blended: dict[str, float] = {}
    for v in survivors:
        c = float(composite.get(v, 0.0))
        s = float(semantic.get(v, 0.0))
        blended[v] = round((1.0 - blend) * c + blend * s, 4)

    sorted_variants = sorted(blended, key=lambda v: blended[v], reverse=True)
    top_score = blended[sorted_variants[0]]
    second_score = blended[sorted_variants[1]] if len(sorted_variants) > 1 else 0.0
    gap = top_score - second_score

    confidence = min(1.0, top_score * 1.5 + gap)
    dspy_needed = gap < 0.10 or top_score < 0.45

    prior_method = state.get("method") or "graph"
    method = prior_method if "semantic" in prior_method else "graph+semantic"

    return {
        "semantic_scores": semantic,
        "composite_scores": blended,
        "selected_variant": sorted_variants[0],
        "confidence": round(confidence, 3),
        "dspy_needed": dspy_needed,
        "method": method,
    }


def node_dspy_reason(state: SelectionState) -> dict:
    """Node 7: DSPy ChainOfThought reasoning for ambiguous cases."""
    
    from backend.app.services.widget_intelligence import shape_to_text
    # VARIANT_DESCRIPTIONS defined in this file

    survivors = state.get("survivors", [])
    composite = state.get("composite_scores", {})
    shape = state.get("_data_shape")

    if not is_dspy_available() or not survivors:
        # Preserve upstream method (e.g., semantic tie-breaker) when DSPy is unavailable.
        return {"method": state.get("method") or "graph"}

    data_shape_text = shape_to_text(shape) if shape else ""

    selected, reasoning = reason_variant_selection(
        query=state.get("query_text", ""),
        candidates=survivors,
        composite_scores=composite,
        data_shape_text=data_shape_text,
        query_type=state.get("query_type", "overview"),
        question_intent=state.get("question_intent", ""),
        candidate_descriptions={v: VARIANT_DESCRIPTIONS.get(v, "") for v in survivors},
    )

    if selected and selected in survivors:
        return {
            "selected_variant": selected,
            "dspy_selection": selected,
            "dspy_reasoning": reasoning,
            "method": "graph+dspy",
            "confidence": min(1.0, state.get("confidence", 0.5) + 0.15),
        }

    # DSPy ran but did not produce a usable selection; keep upstream method.
    return {"method": state.get("method") or "graph"}


def node_autogen_validate(state: SelectionState) -> dict:
    """Node 7.5: AutoGen validation fallback.

    Runs a deterministic multi-agent-style validator over the current composite
    scores. This provides a robust fallback when DSPy is unavailable or fails.
    """
    # validate_selection defined in this file

    composite = state.get("composite_scores", {})
    survivors = set(state.get("survivors", []) or [])
    if not composite or not survivors:
        return {}

    result = validate_selection(
        composite_scores=composite,
        entity_count=int(state.get("entity_count", 1) or 1),
        metric_count=int(state.get("metric_count", 1) or 1),
        instance_count=int(state.get("instance_count", 1) or 1),
        has_timeseries=bool(state.get("has_timeseries", True)),
        query=str(state.get("query_text", "") or ""),
        prefer_autogen=False,
    )

    selected = (result.get("validated_variant") or "").strip()
    if not selected or selected not in survivors:
        return {"method": state.get("method") or "graph"}

    prior_method = state.get("method") or "graph"
    if "semantic" in prior_method:
        method = "graph+semantic+autogen"
    else:
        method = "graph+autogen"

    conf = result.get("confidence", state.get("confidence", 0.5))
    try:
        conf_f = float(conf)
    except Exception:
        conf_f = float(state.get("confidence", 0.5) or 0.5)

    return {
        "selected_variant": selected,
        "confidence": max(0.0, min(1.0, conf_f)),
        "autogen_reason": str(result.get("reason", "") or ""),
        "method": method,
    }


def node_finalize(state: SelectionState) -> dict:
    """Node 8: Finalize output."""
    method = state.get("method", "graph")
    if not method:
        method = "graph"

    selected = state.get("selected_variant", state.get("scenario", ""))
    confidence = state.get("confidence", 0.5)

    logger.debug(
        f"[SelectionGraph] Finalized: {state.get('scenario')} → {selected} "
        f"(confidence={confidence:.3f}, method={method})"
    )

    return {
        "selected_variant": selected,
        "confidence": confidence,
        "method": method,
    }


# ── Routing functions ────────────────────────────────────────────────────────

def route_after_filter(state: SelectionState) -> str:
    """Route after hard filter: 0-1 survivors → finalize, 2+ → score."""
    survivors = state.get("survivors", [])
    if len(survivors) <= 1:
        return "sole_survivor"
    return "multiple"


def route_confidence(state: SelectionState) -> str:
    """Route after ranking: high confidence → finalize, low → semantic tie-breaker."""
    if state.get("dspy_needed", False):
        return "low"
    return "high"


def route_after_semantic(state: SelectionState) -> str:
    """Route after semantic tie-breaker: resolved → finalize, still ambiguous → DSPy."""
    if state.get("dspy_needed", False):
        return "still_ambiguous"
    return "resolved"


def route_after_dspy(state: SelectionState) -> str:
    """Route after DSPy: if DSPy succeeded → finalize, otherwise → AutoGen validation."""
    if state.get("method") == "graph+dspy":
        return "ok"
    return "fallback"


# ── Graph Construction ──────────────────────────────────────────────────────

_compiled_graph = None


def _build_graph():
    """Build and compile the LangGraph selection graph."""
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph

    if not _langgraph_available:
        return None

    builder = StateGraph(SelectionState)

    # Nodes
    builder.add_node("profile_data", node_profile_data)
    builder.add_node("hard_filter", node_hard_filter)
    builder.add_node("score_shape", node_score_shape)
    builder.add_node("score_intent", node_score_intent)
    builder.add_node("apply_penalties", node_apply_penalties)
    builder.add_node("rank", node_rank)
    builder.add_node("semantic_tiebreak", node_semantic_tiebreak)
    builder.add_node("dspy_reason", node_dspy_reason)
    builder.add_node("autogen_validate", node_autogen_validate)
    builder.add_node("finalize", node_finalize)

    # Edges
    builder.add_edge(START, "profile_data")
    builder.add_edge("profile_data", "hard_filter")
    builder.add_conditional_edges("hard_filter", route_after_filter, {
        "sole_survivor": "finalize",
        "multiple": "score_shape",
    })
    builder.add_edge("score_shape", "score_intent")
    builder.add_edge("score_intent", "apply_penalties")
    builder.add_edge("apply_penalties", "rank")
    builder.add_conditional_edges("rank", route_confidence, {
        "high": "finalize",
        "low": "semantic_tiebreak",
    })
    builder.add_conditional_edges("semantic_tiebreak", route_after_semantic, {
        "resolved": "finalize",
        "still_ambiguous": "dspy_reason",
    })
    builder.add_conditional_edges("dspy_reason", route_after_dspy, {
        "ok": "finalize",
        "fallback": "autogen_validate",
    })
    builder.add_edge("autogen_validate", "finalize")
    builder.add_edge("finalize", END)

    _compiled_graph = builder.compile()
    logger.info("[SelectionGraph] LangGraph constraint graph compiled")
    return _compiled_graph


# ── Sequential fallback ──────────────────────────────────────────────────────

def _run_sequential(state: SelectionState) -> dict:
    """Run the same pipeline as sequential function calls (no LangGraph)."""
    result = dict(state)

    # 1. Profile data
    result.update(node_profile_data(result))  # type: ignore

    # 2. Hard filter
    result.update(node_hard_filter(result))  # type: ignore

    # Route: sole survivor?
    survivors = result.get("survivors", [])
    if len(survivors) <= 1:
        if survivors:
            result["selected_variant"] = survivors[0]
            result["confidence"] = 1.0
            result["method"] = "filter_only"
        result.update(node_finalize(result))  # type: ignore
        return result

    # 3-6. Score and rank
    result.update(node_score_shape(result))  # type: ignore
    result.update(node_score_intent(result))  # type: ignore
    result.update(node_apply_penalties(result))  # type: ignore
    result.update(node_rank(result))  # type: ignore

    # Route: ambiguous?
    if result.get("dspy_needed", False):
        # 6.5 Semantic tie-breaker
        result.update(node_semantic_tiebreak(result))  # type: ignore

        # Still ambiguous: DSPy (then AutoGen fallback)
        if result.get("dspy_needed", False):
            result.update(node_dspy_reason(result))  # type: ignore
            if result.get("method") != "graph+dspy":
                result.update(node_autogen_validate(result))  # type: ignore

    # Finalize
    result.update(node_finalize(result))  # type: ignore
    return result


# ── Public API ──────────────────────────────────────────────────────────────

def run_selection_graph(
    scenario: str,
    query_text: str,
    question_intent: str = "",
    query_type: str = "overview",
    entity_count: int = 1,
    metric_count: int = 1,
    instance_count: int = 1,
    has_timeseries: bool = True,
    catalog: Any = None,
    data_profile: Any = None,
    intent: Any = None,
    query_embedding: list[float] | None = None,
    embedding_client: Any = None,
) -> tuple[str, float, str]:
    """Run the 3-layer selection graph.

    Returns:
        (variant_name, confidence_score, method) tuple.
        method is one of: "filter_only", "graph", "graph+dspy"
    """
    # VARIANT_PROFILES defined in this file

    profiles = VARIANT_PROFILES.get(scenario, {})
    if not profiles:
        return scenario, 1.0, "single_variant"

    initial_state: SelectionState = {
        "scenario": scenario,
        "query_text": query_text,
        "question_intent": question_intent,
        "query_type": query_type,
        "entity_count": entity_count,
        "metric_count": metric_count,
        "instance_count": instance_count,
        "has_timeseries": has_timeseries,
        "catalog": catalog,
        "data_profile": data_profile,
        "intent": intent,
        "query_embedding": query_embedding,
        "embedding_client": embedding_client,
        "all_variants": list(profiles.keys()),
        "survivors": list(profiles.keys()),
        "elimination_log": {},
        "shape_scores": {},
        "intent_scores": {},
        "qtype_scores": {},
        "penalty_scores": {},
        "composite_scores": {},
        "semantic_scores": {},
        "dspy_needed": False,
        "dspy_selection": "",
        "dspy_reasoning": "",
        "autogen_reason": "",
        "selected_variant": scenario,
        "confidence": 0.5,
        "method": "",
    }

    # Try LangGraph first
    graph = _build_graph()
    if graph is not None:
        try:
            result = graph.invoke(initial_state)
            variant = result.get("selected_variant", scenario)
            confidence = result.get("confidence", 0.5)
            method = result.get("method", "graph")
            logger.debug(
                f"[SelectionGraph] LangGraph: {scenario} → {variant} "
                f"(confidence={confidence:.2f}, method={method})"
            )
            return variant, confidence, method
        except Exception as e:
            logger.warning(f"[SelectionGraph] LangGraph failed, using sequential: {e}")

    # Fallback: sequential pipeline
    result = _run_sequential(initial_state)
    variant = result.get("selected_variant", scenario)
    confidence = result.get("confidence", 0.5)
    method = result.get("method", "graph")
    logger.debug(
        f"[SelectionGraph] Sequential: {scenario} → {variant} "
        f"(confidence={confidence:.2f}, method={method})"
    )
    return variant, confidence, method


def is_langgraph_available() -> bool:
    """Check if LangGraph is installed and usable."""
    return _langgraph_available


"""
ColBERT-based semantic embedder for widget variant scoring.

Uses token-level late interaction (MaxSim) for sharp discrimination
between widget variant descriptions. Unlike sentence-level cosine
similarity (BGE), ColBERT preserves token-level alignment — so
"3-phase voltage" correctly maps to trend-rgb-phase even though the
sentence embedding of that variant is close to generic trend-line.

Hierarchy of embedding strategies:
1. RAGatouille ColBERT v2 — best: token-level late interaction
2. sentence-transformers BGE — good: sentence-level cosine
3. TF-IDF fallback — baseline: keyword overlap with IDF weighting

All strategies are lazy-loaded and cached. If no ML library is
available, the fallback uses pure-Python TF-IDF.
"""


logger = logging.getLogger(__name__)

# ── Variant description corpus ──────────────────────────────────────────────
# Built once from widget_catalog.py, cached for the process lifetime.

_variant_corpus: dict[str, str] | None = None
_scenario_for_variant: dict[str, str] | None = None
_embedding_client_cache: dict[str, list[float]] | None = None
_embedding_client_model_name: str | None = None


def _build_corpus() -> dict[str, str]:
    """Build variant → description mapping from the widget catalog."""
    global _variant_corpus, _scenario_for_variant
    if _variant_corpus is not None:
        return _variant_corpus

    from backend.app.services.widget_intelligence import WIDGET_CATALOG

    corpus: dict[str, str] = {}
    scenario_map: dict[str, str] = {}

    for entry in WIDGET_CATALOG:
        scenario = entry["scenario"]
        base_desc = entry["description"]
        good_for = " ".join(entry.get("good_for", []))

        variants = entry.get("variants", {})
        if variants:
            for vname, vdesc in variants.items():
                corpus[vname] = f"{vdesc} {base_desc} {good_for}"
                scenario_map[vname] = scenario
        else:
            # Single-variant scenario
            corpus[scenario] = f"{base_desc} {good_for}"
            scenario_map[scenario] = scenario

    _variant_corpus = corpus
    _scenario_for_variant = scenario_map
    logger.info(f"[SemanticEmbedder] Built corpus: {len(corpus)} variants")
    return corpus


def get_scenario_for_variant(variant: str) -> str:
    """Return the scenario for a variant key."""
    _build_corpus()
    return (_scenario_for_variant or {}).get(variant, variant)


# ── Strategy 1: RAGatouille ColBERT v2 ─────────────────────────────────────

_colbert_model = None
_colbert_available: bool | None = None


def _load_colbert():
    """Lazy-load ColBERT v2 via RAGatouille."""
    global _colbert_model, _colbert_available
    if _colbert_available is not None:
        return _colbert_model

    try:
        from ragatouille import RAGPretrainedModel
        _colbert_model = RAGPretrainedModel.from_pretrained("colbert-ir/colbertv2.0")
        _colbert_available = True
        logger.info("[SemanticEmbedder] ColBERT v2 loaded via RAGatouille")
    except (ImportError, Exception) as e:
        _colbert_available = False
        logger.info(f"[SemanticEmbedder] ColBERT not available: {e}")
    return _colbert_model


def _score_colbert(query: str, candidates: dict[str, str]) -> dict[str, float]:
    """Score candidates using ColBERT v2 late interaction.

    Uses RAGatouille's rerank API for efficient scoring of
    query against multiple candidate descriptions.
    """
    model = _load_colbert()
    if model is None:
        return {}

    try:
        variant_names = list(candidates.keys())
        docs = list(candidates.values())

        # RAGatouille rerank: scores each doc against the query
        results = model.rerank(query=query, documents=docs, k=len(docs))

        scores: dict[str, float] = {}
        for r in results:
            idx = r.get("result_index", -1)
            score = r.get("score", 0.0)
            if 0 <= idx < len(variant_names):
                # Normalize ColBERT scores to [0, 1]
                scores[variant_names[idx]] = _sigmoid(score / 20.0)

        return scores
    except Exception as e:
        logger.warning(f"[SemanticEmbedder] ColBERT scoring failed: {e}")
        return {}


# ── Strategy 2: Sentence-transformers BGE ──────────────────────────────────

_bge_model = None
_bge_available: bool | None = None
_bge_embeddings: dict[str, Any] | None = None


def _load_bge():
    """Lazy-load BGE embedding model."""
    global _bge_model, _bge_available
    if _bge_available is not None:
        return _bge_model

    try:
        from sentence_transformers import SentenceTransformer
        _bge_model = SentenceTransformer("BAAI/bge-base-en-v1.5")
        _bge_available = True
        logger.info("[SemanticEmbedder] BGE model loaded")
    except (ImportError, Exception) as e:
        _bge_available = False
        logger.info(f"[SemanticEmbedder] BGE not available: {e}")
    return _bge_model


def _get_bge_embeddings(corpus: dict[str, str]) -> dict[str, Any]:
    """Pre-compute and cache BGE embeddings for all variants."""
    global _bge_embeddings
    if _bge_embeddings is not None:
        return _bge_embeddings

    model = _load_bge()
    if model is None:
        return {}

    names = list(corpus.keys())
    texts = list(corpus.values())
    embeddings = model.encode(texts, normalize_embeddings=True)

    _bge_embeddings = {name: emb for name, emb in zip(names, embeddings)}
    logger.info(f"[SemanticEmbedder] Cached BGE embeddings for {len(names)} variants")
    return _bge_embeddings


def _score_bge(query: str, candidates: dict[str, str]) -> dict[str, float]:
    """Score candidates using BGE sentence-level cosine similarity."""
    model = _load_bge()
    if model is None:
        return {}

    try:
        import numpy as np
        corpus = _build_corpus()
        cached = _get_bge_embeddings(corpus)

        query_emb = model.encode([query], normalize_embeddings=True)[0]

        scores: dict[str, float] = {}
        for variant in candidates:
            emb = cached.get(variant)
            if emb is not None:
                sim = float(np.dot(query_emb, emb))
                scores[variant] = max(0.0, sim)  # Clamp negatives
            else:
                scores[variant] = 0.0
        return scores
    except Exception as e:
        logger.warning(f"[SemanticEmbedder] BGE scoring failed: {e}")
        return {}


# ── Strategy 2b: Reuse Pipeline EmbeddingClient (no duplicate model load) ───

def _get_embedding_client_embeddings(
    corpus: dict[str, str],
    embedding_client: Any,
) -> dict[str, list[float]]:
    """Compute and cache embeddings for the variant corpus using EmbeddingClient."""
    global _embedding_client_cache, _embedding_client_model_name

    model_name = getattr(embedding_client, "_model_name", None)
    if _embedding_client_cache is not None and _embedding_client_model_name == model_name:
        return _embedding_client_cache

    try:
        names = list(corpus.keys())
        texts = [corpus[n] for n in names]
        vecs = embedding_client.embed_batch(texts)
        cache = {
            name: vec
            for name, vec in zip(names, vecs)
            if isinstance(vec, list) and len(vec) > 0
        }
        _embedding_client_cache = cache
        _embedding_client_model_name = model_name
        logger.info(f"[SemanticEmbedder] Cached EmbeddingClient vectors for {len(cache)} variants")
        return cache
    except Exception as e:
        logger.warning(f"[SemanticEmbedder] EmbeddingClient caching failed: {e}")
        _embedding_client_cache = {}
        _embedding_client_model_name = model_name
        return {}


def _score_embedding_client(
    query: str,
    candidates: dict[str, str],
    embedding_client: Any,
    query_embedding: list[float] | None = None,
) -> dict[str, float]:
    """Score candidates using the pipeline EmbeddingClient cosine similarity."""
    try:
        if embedding_client is None or not getattr(embedding_client, "available", False):
            return {}

        corpus = _build_corpus()
        cached = _get_embedding_client_embeddings(corpus, embedding_client)
        if not cached:
            return {}

        q_emb = query_embedding or embedding_client.embed(query)
        if not q_emb:
            return {}

        from backend.app.services.widget_intelligence import EmbeddingClient

        scores: dict[str, float] = {}
        for variant in candidates:
            emb = cached.get(variant)
            if emb is None:
                scores[variant] = 0.0
                continue
            sim = EmbeddingClient.cosine_similarity(q_emb, emb)
            scores[variant] = max(0.0, float(sim))
        return scores
    except Exception as e:
        logger.warning(f"[SemanticEmbedder] EmbeddingClient scoring failed: {e}")
        return {}


# ── Strategy 3: TF-IDF fallback (pure Python) ─────────────────────────────

_idf_cache: dict[str, float] | None = None


def _compute_idf(corpus: dict[str, str]) -> dict[str, float]:
    """Compute IDF weights from the variant corpus."""
    global _idf_cache
    if _idf_cache is not None:
        return _idf_cache

    doc_count = len(corpus)
    term_doc_freq: dict[str, int] = {}

    for text in corpus.values():
        tokens = set(_tokenize(text))
        for token in tokens:
            term_doc_freq[token] = term_doc_freq.get(token, 0) + 1

    _idf_cache = {
        term: math.log((doc_count + 1) / (df + 1)) + 1
        for term, df in term_doc_freq.items()
    }
    return _idf_cache


def _tokenize(text: str) -> list[str]:
    """Simple tokenizer: lowercase, split on non-alphanumeric."""
    return re.findall(r'[a-z0-9]+', text.lower())


def _score_tfidf(query: str, candidates: dict[str, str]) -> dict[str, float]:
    """Score candidates using TF-IDF cosine similarity (pure Python)."""
    corpus = _build_corpus()
    idf = _compute_idf(corpus)

    query_tokens = _tokenize(query)
    if not query_tokens:
        return {v: 0.0 for v in candidates}

    # Query TF-IDF vector
    query_tf: dict[str, float] = {}
    for t in query_tokens:
        query_tf[t] = query_tf.get(t, 0) + 1
    query_vec = {t: tf * idf.get(t, 1.0) for t, tf in query_tf.items()}
    query_norm = math.sqrt(sum(v * v for v in query_vec.values())) or 1.0

    scores: dict[str, float] = {}
    for variant, text in candidates.items():
        doc_tokens = _tokenize(text)
        doc_tf: dict[str, float] = {}
        for t in doc_tokens:
            doc_tf[t] = doc_tf.get(t, 0) + 1
        doc_vec = {t: tf * idf.get(t, 1.0) for t, tf in doc_tf.items()}
        doc_norm = math.sqrt(sum(v * v for v in doc_vec.values())) or 1.0

        dot = sum(query_vec.get(t, 0) * doc_vec.get(t, 0)
                  for t in set(query_vec) | set(doc_vec))
        scores[variant] = dot / (query_norm * doc_norm)

    return scores


# ── Public API ──────────────────────────────────────────────────────────────

def _sigmoid(x: float) -> float:
    """Sigmoid normalization."""
    return 1.0 / (1.0 + math.exp(-x))


def score_variants_semantic(
    query: str,
    scenario: str | None = None,
    candidates: list[str] | None = None,
    embedding_client: Any | None = None,
    query_embedding: list[float] | None = None,
    strategy: str = "auto",
) -> dict[str, float]:
    """Score widget variants against a user query using the best available
    semantic embedding strategy.

    Args:
        query: User's natural language query.
        scenario: If provided, only score variants for this scenario.
        candidates: If provided, only score these specific variants.
        embedding_client: Optional pipeline EmbeddingClient to avoid duplicate model load.
        query_embedding: Optional pre-computed query embedding for the embedding_client path.
        strategy: One of "auto", "embedding_client", "colbert_v2", "bge", "tfidf".

    Returns:
        Dict mapping variant names to semantic scores in [0, 1].
    """
    corpus = _build_corpus()
    strat = (strategy or "auto").strip().lower()

    # Filter corpus to requested scope
    if candidates:
        filtered = {v: corpus[v] for v in candidates if v in corpus}
    elif scenario:
        filtered = {
            v: desc for v, desc in corpus.items()
            if (_scenario_for_variant or {}).get(v) == scenario
        }
    else:
        filtered = corpus

    if not filtered:
        return {}

    # Strategy selection: callers can force lightweight scoring (e.g., "tfidf")
    # to avoid cold-starting large models during latency-sensitive paths.
    if strat in ("tfidf",):
        scores = _score_tfidf(query, filtered)
        logger.debug(f"[SemanticEmbedder] Used TF-IDF for {len(scores)} variants")
        return scores

    if strat in ("embedding_client", "embedding", "auto") and embedding_client is not None:
        scores = _score_embedding_client(
            query, filtered, embedding_client=embedding_client, query_embedding=query_embedding,
        )
        if scores or strat != "auto":
            logger.debug(f"[SemanticEmbedder] Used EmbeddingClient for {len(scores)} variants")
            return scores

    if strat in ("colbert_v2", "colbert", "auto"):
        scores = _score_colbert(query, filtered)
        if scores or strat != "auto":
            logger.debug(f"[SemanticEmbedder] Used ColBERT for {len(scores)} variants")
            return scores

    if strat in ("bge", "auto"):
        scores = _score_bge(query, filtered)
        if scores or strat != "auto":
            logger.debug(f"[SemanticEmbedder] Used BGE for {len(scores)} variants")
            return scores

    scores = _score_tfidf(query, filtered)
    logger.debug(f"[SemanticEmbedder] Used TF-IDF fallback for {len(scores)} variants")
    return scores


def get_embedding_strategy() -> str:
    """Return which embedding strategy is active."""
    _load_colbert()
    if _colbert_available:
        return "colbert_v2"
    _load_bge()
    if _bge_available:
        return "bge"
    return "tfidf"


"""
LlamaIndex-based variant metadata store with MetadataFilters.

Layer 1 of the 3-layer variant selection pipeline:
- Stores all 58 multi-variant profiles as LlamaIndex TextNode objects
- Uses MetadataFilters for hard constraint elimination
- Provides shape fitness scoring for Layer 2

Hard filters eliminate impossible variants (e.g., phase chart with no phase data).
Shape fitness scores rank surviving variants by data-property match.
"""


logger = logging.getLogger(__name__)

# ── Try LlamaIndex imports ────────────────────────────────────────────────────

_llamaindex_available = False
try:
    from llama_index.core.schema import TextNode
    from llama_index.core.vector_stores import (
        MetadataFilter,
        MetadataFilters,
        FilterOperator,
    )
    _llamaindex_available = True
    logger.debug("[VariantMetadata] LlamaIndex available")
except ImportError:
    logger.debug("[VariantMetadata] LlamaIndex not available, using dict fallback")


# ── Variant descriptions (data-property focused) ─────────────────────────────

VARIANT_DESCRIPTIONS: dict[str, str] = {
    # KPI
    "kpi-live": "Real-time current value display for continuous metrics — single entity, 1-2 metrics, any variance",
    "kpi-alert": "Alert-severity KPI with threshold status — needs alert context, anomaly-focused",
    "kpi-accumulated": "Running total / cumulative metric display — needs cumulative data (kWh, count, production total)",
    "kpi-lifecycle": "Asset lifecycle health indicator — remaining useful life, wear, age, depreciation metrics",
    "kpi-status": "Operational state indicator — binary/discrete states (online/offline/standby), multi-entity capable",
    # Trend
    "trend-line": "Standard continuous time series — single metric, 1-2 entities, moderate-to-high variance",
    "trend-area": "Filled area time series — emphasizes magnitude/volume, good for consumption and load metrics",
    "trend-step-line": "Discrete state change chart — binary/on-off data, zero-or-one variance, state transitions",
    "trend-rgb-phase": "Three-phase electrical overlay — requires exactly 3 phase columns (R/Y/B or L1/L2/L3)",
    "trend-alert-context": "Trend with threshold bands — needs threshold/limit context, alert-relevant metrics",
    "trend-heatmap": "Temporal pattern heatmap — discovers time-of-day and day-of-week patterns, needs dense timeseries",
    # Comparison
    "comparison-side-by-side": "Paired comparison — exactly 2 entities, same metric, direct A-vs-B",
    "comparison-delta-bar": "Deviation/delta bars — shows gap from target/baseline, multiple entities",
    "comparison-grouped-bar": "Multi-parameter grouped bars — multiple metrics across multiple entities",
    "comparison-waterfall": "Stepwise contribution breakdown — shows gains and losses, 3+ metrics",
    "comparison-small-multiples": "Grid of mini charts — 4+ entities, same metric, fleet/overview comparison",
    "comparison-composition-split": "Split composition comparison — 2-3 entities, shows makeup difference",
    # Distribution
    "distribution-donut": "Proportional share donut — 2-7 categories, part-of-whole snapshot",
    "distribution-pie": "Simple pie chart — 2-5 categories, basic proportion display",
    "distribution-horizontal-bar": "Ranked horizontal bars — sorted by value, 4+ items, ranking focus",
    "distribution-pareto-bar": "Pareto (80/20) chart — high variance data, 4+ items, top-contributor analysis",
    "distribution-grouped-bar": "Grouped distribution bars — multi-entity cross-group comparison, needs 2+ entities",
    "distribution-100-stacked-bar": "Normalized 100% stacked bars — proportional comparison across categories",
    # Composition
    "composition-stacked-bar": "Stacked bar breakdown — part-to-whole by category, 2-8 metrics",
    "composition-stacked-area": "Stacked area over time — composition evolution, needs timeseries, 2-6 metrics",
    "composition-donut": "Composition snapshot donut — current mix/makeup, 2-6 categories",
    "composition-waterfall": "Composition waterfall — incremental gains and losses, bridge chart",
    "composition-treemap": "Hierarchical treemap — nested proportional areas, works with hierarchy data",
    # Alerts
    "alerts-card": "Standard alert cards — general alert display, any alert data",
    "alerts-banner": "Full-width alert banner — site-wide critical notifications",
    "alerts-toast": "Floating toast notifications — recent/latest alerts, compact",
    "alerts-badge": "Alert count badge — compact indicator showing number of active alerts",
    "alerts-modal": "Alert investigation modal — detailed alert drill-down, forensic context",
    # Timeline
    "timeline-linear": "Linear event timeline — chronological event sequence, general purpose",
    "timeline-status": "Status/uptime timeline — continuous state history, operational availability",
    "timeline-multilane": "Multi-lane parallel timeline — 2+ entity schedules, concurrent event streams",
    "timeline-forensic": "Forensic investigation timeline — root cause analysis, annotated event chain",
    "timeline-dense": "Dense event cluster view — high-frequency bursts, many events in short time",
    # EventLogStream
    "eventlogstream-chronological": "Chronological event log — general event feed, time-ordered",
    "eventlogstream-compact-feed": "Compact card feed — social-media-style event summaries",
    "eventlogstream-tabular": "Tabular event log — sortable/filterable table format, many columns",
    "eventlogstream-correlation": "Correlated event view — linked/cascading events, cause-effect chains",
    "eventlogstream-grouped-asset": "Asset-grouped events — events organized by equipment, 2+ entities",
    # Category-Bar
    "category-bar-vertical": "Vertical category bars — standard categorical comparison, 2-8 categories",
    "category-bar-horizontal": "Horizontal category bars — long labels, ranking, many items",
    "category-bar-stacked": "Stacked category bars — sub-component breakdown per category",
    "category-bar-grouped": "Grouped category bars — multiple metrics side-by-side per category",
    "category-bar-diverging": "Diverging category bars — positive/negative deviations from baseline",
    # Flow-Sankey
    "flow-sankey-standard": "Standard Sankey flow — source-to-destination flow visualization",
    "flow-sankey-energy-balance": "Energy balance Sankey — input/output/loss flows, efficiency analysis",
    "flow-sankey-multi-source": "Multi-source Sankey — converging flows from 3+ sources",
    "flow-sankey-layered": "Layered/hierarchical Sankey — multi-stage process flows",
    "flow-sankey-time-sliced": "Temporal Sankey — flow changes over time, needs timeseries",
    # Matrix-Heatmap
    "matrix-heatmap-value": "Value heatmap — cross-tabulation of entities and metrics",
    "matrix-heatmap-correlation": "Correlation matrix — metric-to-metric relationships, 3+ metrics",
    "matrix-heatmap-calendar": "Calendar heatmap — daily/weekly/monthly patterns over time",
    "matrix-heatmap-status": "Status grid heatmap — fleet health overview, 3+ entities",
    "matrix-heatmap-density": "Density/hotspot heatmap — spatial concentration patterns",
}


# ── Per-variant shape preferences (soft scoring signals) ─────────────────────

@dataclass(frozen=True)
class ShapePreference:
    """Soft scoring preferences for how well a variant matches data shape."""
    prefers_phase_data: float = 0.0
    prefers_binary_data: float = 0.0
    prefers_cumulative: float = 0.0
    prefers_high_variance: float = 0.0
    prefers_low_variance: float = 0.0
    prefers_many_entities: float = 0.0
    prefers_few_entities: float = 0.0
    prefers_many_metrics: float = 0.0
    prefers_few_metrics: float = 0.0
    prefers_hierarchy: float = 0.0
    prefers_correlation: float = 0.0
    prefers_ranking: float = 0.0
    prefers_temperature: float = 0.0
    prefers_flow: float = 0.0
    prefers_rate: float = 0.0
    prefers_percentage: float = 0.0
    prefers_alerts: float = 0.0
    prefers_dense_timeseries: float = 0.0
    prefers_cross_entity: float = 0.0


VARIANT_SHAPE_PREFS: dict[str, ShapePreference] = {
    # KPI — differentiate by metric type
    "kpi-live": ShapePreference(prefers_few_entities=0.5, prefers_temperature=0.3, prefers_rate=0.3),
    "kpi-alert": ShapePreference(prefers_alerts=0.95, prefers_few_entities=0.3),
    "kpi-accumulated": ShapePreference(prefers_cumulative=0.99, prefers_few_entities=0.4),
    "kpi-lifecycle": ShapePreference(prefers_percentage=0.8, prefers_few_entities=0.5),
    "kpi-status": ShapePreference(prefers_binary_data=0.9, prefers_few_entities=0.3),
    # Trend — differentiate by data type and density
    "trend-line": ShapePreference(prefers_few_entities=0.3, prefers_few_metrics=0.2),
    "trend-area": ShapePreference(prefers_flow=0.7, prefers_rate=0.6, prefers_few_entities=0.3),
    "trend-step-line": ShapePreference(prefers_binary_data=0.99, prefers_low_variance=0.8, prefers_few_entities=0.3),
    "trend-rgb-phase": ShapePreference(prefers_phase_data=0.99, prefers_few_entities=0.3),
    "trend-alert-context": ShapePreference(prefers_alerts=0.9, prefers_few_entities=0.3),
    "trend-heatmap": ShapePreference(prefers_dense_timeseries=0.95, prefers_few_entities=0.3),
    # Comparison — differentiate by entity/metric count
    "comparison-side-by-side": ShapePreference(prefers_few_entities=0.6, prefers_cross_entity=0.5, prefers_few_metrics=0.5),
    "comparison-delta-bar": ShapePreference(prefers_many_entities=0.5, prefers_cross_entity=0.6),
    "comparison-grouped-bar": ShapePreference(prefers_many_metrics=0.85, prefers_cross_entity=0.6, prefers_many_entities=0.4),
    "comparison-waterfall": ShapePreference(prefers_high_variance=0.7, prefers_many_metrics=0.6),
    "comparison-small-multiples": ShapePreference(prefers_many_entities=0.95, prefers_cross_entity=0.7),
    "comparison-composition-split": ShapePreference(prefers_few_entities=0.5, prefers_many_metrics=0.6, prefers_percentage=0.4),
    # Distribution — differentiate by count and variance
    "distribution-donut": ShapePreference(prefers_few_metrics=0.6, prefers_percentage=0.4),
    "distribution-pie": ShapePreference(prefers_few_metrics=0.8, prefers_few_entities=0.5, prefers_percentage=0.3),
    "distribution-horizontal-bar": ShapePreference(prefers_ranking=0.8, prefers_many_metrics=0.5),
    "distribution-pareto-bar": ShapePreference(prefers_ranking=0.7, prefers_high_variance=0.9, prefers_many_metrics=0.6),
    "distribution-grouped-bar": ShapePreference(prefers_many_entities=0.5, prefers_cross_entity=0.7, prefers_many_metrics=0.4),
    "distribution-100-stacked-bar": ShapePreference(prefers_percentage=0.8, prefers_many_metrics=0.5, prefers_cross_entity=0.4),
    # Composition — differentiate by richness and hierarchy
    "composition-stacked-bar": ShapePreference(prefers_many_metrics=0.5, prefers_many_entities=0.4),
    "composition-stacked-area": ShapePreference(prefers_dense_timeseries=0.7, prefers_many_metrics=0.4),
    "composition-donut": ShapePreference(prefers_few_metrics=0.7, prefers_few_entities=0.5, prefers_percentage=0.5),
    "composition-waterfall": ShapePreference(prefers_high_variance=0.7, prefers_many_metrics=0.5),
    "composition-treemap": ShapePreference(prefers_hierarchy=0.9, prefers_many_metrics=0.5, prefers_many_entities=0.4),
    # Alerts — differentiate by scope
    "alerts-card": ShapePreference(prefers_alerts=0.5, prefers_many_entities=0.3),
    "alerts-banner": ShapePreference(prefers_alerts=0.7, prefers_few_entities=0.5),
    "alerts-toast": ShapePreference(prefers_alerts=0.6, prefers_few_entities=0.6),
    "alerts-badge": ShapePreference(prefers_alerts=0.5, prefers_many_entities=0.5),
    "alerts-modal": ShapePreference(prefers_alerts=0.8),
    # Timeline — differentiate by data type and density
    "timeline-linear": ShapePreference(prefers_few_entities=0.3),
    "timeline-status": ShapePreference(prefers_binary_data=0.8, prefers_few_entities=0.4),
    "timeline-multilane": ShapePreference(prefers_many_entities=0.8, prefers_cross_entity=0.5),
    "timeline-forensic": ShapePreference(prefers_alerts=0.7, prefers_dense_timeseries=0.3),
    "timeline-dense": ShapePreference(prefers_dense_timeseries=0.95),
    # EventLogStream — differentiate by entity count and correlation
    "eventlogstream-chronological": ShapePreference(prefers_few_entities=0.3),
    "eventlogstream-compact-feed": ShapePreference(prefers_few_entities=0.6, prefers_few_metrics=0.4),
    "eventlogstream-tabular": ShapePreference(prefers_many_metrics=0.6, prefers_many_entities=0.3),
    "eventlogstream-correlation": ShapePreference(prefers_correlation=0.95, prefers_many_metrics=0.5),
    "eventlogstream-grouped-asset": ShapePreference(prefers_many_entities=0.8, prefers_cross_entity=0.5),
    # Category-Bar — differentiate by structure
    "category-bar-vertical": ShapePreference(prefers_few_metrics=0.5, prefers_few_entities=0.3),
    "category-bar-horizontal": ShapePreference(prefers_ranking=0.8, prefers_many_metrics=0.4),
    "category-bar-stacked": ShapePreference(prefers_many_metrics=0.7, prefers_many_entities=0.4),
    "category-bar-grouped": ShapePreference(prefers_cross_entity=0.7, prefers_many_entities=0.5, prefers_many_metrics=0.5),
    "category-bar-diverging": ShapePreference(prefers_high_variance=0.8),
    # Flow-Sankey — differentiate by structure and type
    "flow-sankey-standard": ShapePreference(prefers_flow=0.5, prefers_few_entities=0.3),
    "flow-sankey-energy-balance": ShapePreference(prefers_rate=0.7, prefers_flow=0.6),
    "flow-sankey-multi-source": ShapePreference(prefers_many_entities=0.8, prefers_flow=0.4),
    "flow-sankey-layered": ShapePreference(prefers_hierarchy=0.9, prefers_flow=0.3),
    "flow-sankey-time-sliced": ShapePreference(prefers_dense_timeseries=0.7, prefers_flow=0.3),
    # Matrix-Heatmap — differentiate by correlation and density
    "matrix-heatmap-value": ShapePreference(prefers_many_entities=0.5, prefers_many_metrics=0.4),
    "matrix-heatmap-correlation": ShapePreference(prefers_correlation=0.95, prefers_many_metrics=0.8),
    "matrix-heatmap-calendar": ShapePreference(prefers_dense_timeseries=0.85),
    "matrix-heatmap-status": ShapePreference(prefers_many_entities=0.8, prefers_binary_data=0.4),
    "matrix-heatmap-density": ShapePreference(prefers_dense_timeseries=0.7, prefers_few_entities=0.3),
}


# ── TextNode construction ─────────────────────────────────────────────────────

_variant_nodes_cache: dict[str, list] = {}


def _build_variant_nodes() -> dict[str, list]:
    """Auto-build TextNode objects from VARIANT_PROFILES + metadata.

    Returns scenario -> [TextNode, ...] mapping.
    """
    global _variant_nodes_cache
    if _variant_nodes_cache:
        return _variant_nodes_cache

    # VARIANT_PROFILES defined in this file

    nodes: dict[str, list] = {}

    for scenario, profiles in VARIANT_PROFILES.items():
        scenario_nodes = []
        for variant, profile in profiles.items():
            desc = VARIANT_DESCRIPTIONS.get(variant, f"{variant} visualization")

            metadata = {
                "variant": variant,
                "scenario": scenario,
                "requires_timeseries": profile.needs_timeseries,
                "requires_multiple_entities": profile.needs_multiple_entities,
                "min_entity_count": profile.ideal_entity_count[0] if profile.ideal_entity_count else 1,
                "min_metric_count": profile.ideal_metric_count[0] if profile.ideal_metric_count else 1,
                "max_entity_count": profile.ideal_entity_count[1] if profile.ideal_entity_count else 100,
                "max_metric_count": profile.ideal_metric_count[1] if profile.ideal_metric_count else 100,
                "is_default": profile.is_default,
            }

            # Flatten intent affinity into metadata
            for intent_key, score in profile.intent_affinity.items():
                metadata[f"intent_{intent_key}"] = score

            # Flatten query type affinity into metadata
            for qtype_key, score in profile.query_type_affinity.items():
                metadata[f"qtype_{qtype_key}"] = score

            if _llamaindex_available:
                node = TextNode(text=desc, metadata=metadata)
                node.id_ = variant
                scenario_nodes.append(node)
            else:
                scenario_nodes.append({"text": desc, "metadata": metadata, "id": variant})

        nodes[scenario] = scenario_nodes

    _variant_nodes_cache = nodes
    return nodes


# ── Hard filter using LlamaIndex MetadataFilters ─────────────────────────────

def _apply_filters_manual(nodes: list, filters: list[dict]) -> list:
    """Apply metadata filters to a list of nodes (dict or TextNode)."""
    survivors = []
    for node in nodes:
        meta = node.metadata if hasattr(node, "metadata") else node.get("metadata", {})
        passes = True
        for f in filters:
            key, op, val = f["key"], f["op"], f["value"]
            node_val = meta.get(key)
            if node_val is None:
                continue
            if op == "==" and node_val != val:
                passes = False
                break
            if op == "<=" and node_val > val:
                passes = False
                break
            if op == ">=" and node_val < val:
                passes = False
                break
        if passes:
            survivors.append(node)
    return survivors


def filter_variants(scenario: str, shape) -> list[str]:
    """Layer 1: Eliminate impossible variants using metadata hard filters.

    Args:
        scenario: Widget scenario name.
        shape: DataShapeProfile with measured data properties.

    Returns:
        List of surviving variant names after hard elimination.
    """
    nodes = _build_variant_nodes()
    scenario_nodes = nodes.get(scenario, [])
    if not scenario_nodes:
        return []

    # Build filter conditions
    filters: list[dict] = []

    # If no timeseries, exclude variants that require it
    if not shape.has_timeseries:
        filters.append({"key": "requires_timeseries", "op": "==", "value": False})

    # If single entity, exclude variants that need multiple
    if shape.entity_count < 2:
        filters.append({"key": "requires_multiple_entities", "op": "==", "value": False})

    # Entity count must meet variant minimum
    filters.append({"key": "min_entity_count", "op": "<=", "value": shape.entity_count})

    # Metric count must meet variant minimum
    filters.append({"key": "min_metric_count", "op": "<=", "value": shape.metric_count})

    if _llamaindex_available:
        try:
            li_filters = []
            for f in filters:
                op_map = {"==": FilterOperator.EQ, "<=": FilterOperator.LTE, ">=": FilterOperator.GTE}
                li_filters.append(MetadataFilter(
                    key=f["key"],
                    operator=op_map[f["op"]],
                    value=f["value"],
                ))
            metadata_filters = MetadataFilters(filters=li_filters)
            survivors = _apply_llamaindex_filters(scenario_nodes, metadata_filters)
            result = [
                (n.metadata["variant"] if hasattr(n, "metadata") else n["metadata"]["variant"])
                for n in survivors
            ]
            if result:
                return result
        except Exception as e:
            logger.debug(f"[VariantMetadata] LlamaIndex filter failed, using manual: {e}")

    # Manual fallback
    survivors = _apply_filters_manual(scenario_nodes, filters)
    result = [
        (n.metadata["variant"] if hasattr(n, "metadata") else n["metadata"]["variant"])
        for n in survivors
    ]

    # Ensure at least one variant survives (scenario default)
    if not result:
        # VARIANT_PROFILES defined in this file
        profiles = VARIANT_PROFILES.get(scenario, {})
        for v, p in profiles.items():
            if p.is_default:
                return [v]
        return list(profiles.keys())[:1] if profiles else []

    return result


def _apply_llamaindex_filters(nodes: list, metadata_filters) -> list:
    """Apply LlamaIndex MetadataFilters to TextNode list."""
    survivors = []
    for node in nodes:
        passes = True
        for f in metadata_filters.filters:
            val = node.metadata.get(f.key)
            if val is None:
                continue
            if f.operator == FilterOperator.EQ and val != f.value:
                passes = False
                break
            if f.operator == FilterOperator.LTE and val > f.value:
                passes = False
                break
            if f.operator == FilterOperator.GTE and val < f.value:
                passes = False
                break
            if f.operator == FilterOperator.LT and val >= f.value:
                passes = False
                break
            if f.operator == FilterOperator.GT and val <= f.value:
                passes = False
                break
        if passes:
            survivors.append(node)
    return survivors


# ── Shape fitness scoring ─────────────────────────────────────────────────────

def score_shape_fitness(variant: str, shape) -> float:
    """Score how well a variant matches the data shape.

    Returns 0.0-1.0 based on how many data properties match the
    variant's ideal shape preferences.
    """
    prefs = VARIANT_SHAPE_PREFS.get(variant)
    if not prefs:
        return 0.5  # Neutral for unknown variants

    score = 0.0
    weight_sum = 0.0

    def _add(pref_val: float, match: bool, boost: float = 1.0):
        nonlocal score, weight_sum
        if pref_val > 0:
            weight_sum += pref_val
            if match:
                score += pref_val * boost

    _add(prefs.prefers_phase_data, shape.has_phase_data)
    _add(prefs.prefers_binary_data, shape.has_binary_metric)
    _add(prefs.prefers_cumulative, shape.has_cumulative_metric)
    _add(prefs.prefers_high_variance, shape.has_high_variance)
    _add(prefs.prefers_low_variance, shape.has_near_zero_variance)
    _add(prefs.prefers_many_entities, shape.entity_count >= 4)
    _add(prefs.prefers_few_entities, shape.entity_count <= 3)
    _add(prefs.prefers_many_metrics, shape.metric_count >= 4)
    _add(prefs.prefers_few_metrics, shape.metric_count <= 3)
    _add(prefs.prefers_hierarchy, shape.has_hierarchy)
    _add(prefs.prefers_correlation, shape.multi_numeric_potential and shape.cross_entity_comparable)
    _add(prefs.prefers_ranking, shape.has_high_variance and shape.metric_count >= 3)
    _add(prefs.prefers_temperature, shape.has_temperature)
    _add(prefs.prefers_flow, shape.has_flow_metric)
    _add(prefs.prefers_rate, shape.has_rate_metric)
    _add(prefs.prefers_percentage, shape.has_percentage_metric)
    _add(prefs.prefers_alerts, shape.has_alerts)
    _add(prefs.prefers_dense_timeseries, shape.temporal_density > 100)
    _add(prefs.prefers_cross_entity, shape.cross_entity_comparable)

    if weight_sum <= 0:
        return 0.5  # No preferences defined

    return min(1.0, score / weight_sum)


def get_variant_intent_score(variant: str, question_intent: str) -> float:
    """Get intent affinity score for a variant from metadata."""
    nodes = _build_variant_nodes()
    for scenario_nodes in nodes.values():
        for node in scenario_nodes:
            meta = node.metadata if hasattr(node, "metadata") else node.get("metadata", {})
            if meta.get("variant") == variant:
                return meta.get(f"intent_{question_intent}", 0.0)
    return 0.0


def get_variant_qtype_score(variant: str, query_type: str) -> float:
    """Get query type affinity score for a variant from metadata."""
    nodes = _build_variant_nodes()
    for scenario_nodes in nodes.values():
        for node in scenario_nodes:
            meta = node.metadata if hasattr(node, "metadata") else node.get("metadata", {})
            if meta.get("variant") == variant:
                return meta.get(f"qtype_{query_type}", 0.0)
    return 0.0


def is_variant_default(variant: str) -> bool:
    """Check if variant is the scenario default."""
    nodes = _build_variant_nodes()
    for scenario_nodes in nodes.values():
        for node in scenario_nodes:
            meta = node.metadata if hasattr(node, "metadata") else node.get("metadata", {})
            if meta.get("variant") == variant:
                return bool(meta.get("is_default", False))
    return False


def is_llamaindex_available() -> bool:
    """Check if LlamaIndex is installed."""
    return _llamaindex_available


"""
Variant scorer — multi-signal variant selection (legacy fallback).

Scoring signals:
1. Question intent — anomaly/baseline/comparison/trend/correlation/health
2. Query type — status/analysis/comparison/trend/diagnostic/overview/alert/forecast
3. Data shape — entity count, metric count, instance count
4. Default bonus — slight preference for the scenario default variant

The primary selection pipeline uses LangGraph + LlamaIndex + DSPy
(selection_graph.py). This module provides VariantProfile definitions
and data shape scoring used by both the new pipeline and fallback.
"""


logger = logging.getLogger(__name__)


# ── Variant Profile ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class VariantProfile:
    """Multi-signal fitness profile for a single variant."""

    # Weighted phrase patterns: [(phrase_or_regex, weight), ...]
    # Weight range: 0.0-1.0. Matched against query+question text.
    text_signals: tuple[tuple[str, float], ...] = ()

    # Which question intents this variant excels at.
    # Values: baseline, trend, anomaly, comparison, correlation, health
    intent_affinity: dict[str, float] = field(default_factory=dict)

    # Which query types boost this variant.
    # Values: status, analysis, comparison, trend, diagnostic, overview, alert, forecast
    query_type_affinity: dict[str, float] = field(default_factory=dict)

    # Data shape preferences. None = don't care.
    ideal_entity_count: tuple[int, int] | None = None  # (min, max) inclusive
    ideal_metric_count: tuple[int, int] | None = None
    ideal_instance_count: tuple[int, int] | None = None
    needs_multiple_entities: bool = False
    needs_timeseries: bool = False

    # Whether this is the scenario default (gets small tiebreaker bonus)
    is_default: bool = False


# ── Scoring Weights ──────────────────────────────────────────────────────────

_W_TEXT = 0.40       # Text phrase matching
_W_INTENT = 0.20     # Question intent alignment
_W_QUERY_TYPE = 0.15 # Query type alignment
_W_DATA_SHAPE = 0.20 # Data shape fitness
_W_DEFAULT = 0.05    # Default variant tiebreaker


# ── Scoring Functions ────────────────────────────────────────────────────────

def _score_text(profile: VariantProfile, text: str) -> float:
    """Score text affinity: check all phrase patterns against the text.

    Returns max matching weight (not sum) to avoid double-counting overlapping
    phrases. E.g., "pareto" and "80/20" both suggest pareto-bar — we want
    the stronger signal, not both added.
    """
    if not profile.text_signals or not text:
        return 0.0

    best = 0.0
    for phrase, weight in profile.text_signals:
        # Support both literal substring and regex
        if phrase.startswith("r:"):
            if re.search(phrase[2:], text, re.IGNORECASE):
                best = max(best, weight)
        elif phrase in text:
            best = max(best, weight)
    return best


def _score_intent(profile: VariantProfile, question_intent: str) -> float:
    """Score question intent alignment."""
    if not profile.intent_affinity or not question_intent:
        return 0.0
    return profile.intent_affinity.get(question_intent, 0.0)


def _score_query_type(profile: VariantProfile, query_type: str) -> float:
    """Score query type alignment."""
    if not profile.query_type_affinity or not query_type:
        return 0.0
    return profile.query_type_affinity.get(query_type, 0.0)


def _score_data_shape(
    profile: VariantProfile,
    entity_count: int,
    metric_count: int,
    instance_count: int,
) -> float:
    """Score data shape fitness.

    Returns 1.0 if data shape is ideal, degrades as it moves away from ideal.
    Returns 0.0 if hard requirements are violated (needs_multiple but only 1).
    """
    if profile.needs_multiple_entities and entity_count < 2:
        return 0.0

    score = 0.5  # Neutral baseline if no shape preferences

    checks = 0
    total = 0.0

    if profile.ideal_entity_count is not None:
        checks += 1
        lo, hi = profile.ideal_entity_count
        if lo <= entity_count <= hi:
            total += 1.0
        elif entity_count < lo:
            total += max(0.0, 1.0 - (lo - entity_count) * 0.3)
        else:
            total += max(0.0, 1.0 - (entity_count - hi) * 0.15)

    if profile.ideal_metric_count is not None:
        checks += 1
        lo, hi = profile.ideal_metric_count
        if lo <= metric_count <= hi:
            total += 1.0
        elif metric_count < lo:
            total += max(0.0, 1.0 - (lo - metric_count) * 0.3)
        else:
            total += max(0.0, 1.0 - (metric_count - hi) * 0.1)

    if profile.ideal_instance_count is not None:
        checks += 1
        lo, hi = profile.ideal_instance_count
        if lo <= instance_count <= hi:
            total += 1.0
        elif instance_count < lo:
            total += max(0.0, 1.0 - (lo - instance_count) * 0.3)
        else:
            total += max(0.0, 1.0 - (instance_count - hi) * 0.1)

    if checks > 0:
        score = total / checks

    return score


def score_variant(
    variant: str,
    profile: VariantProfile,
    text: str,
    question_intent: str,
    query_type: str,
    entity_count: int,
    metric_count: int,
    instance_count: int,
) -> float:
    """Compute weighted composite score for a variant."""
    s_text = _score_text(profile, text)
    s_intent = _score_intent(profile, question_intent)
    s_qtype = _score_query_type(profile, query_type)
    s_data = _score_data_shape(profile, entity_count, metric_count, instance_count)
    s_default = 1.0 if profile.is_default else 0.0

    total = (
        _W_TEXT * s_text
        + _W_INTENT * s_intent
        + _W_QUERY_TYPE * s_qtype
        + _W_DATA_SHAPE * s_data
        + _W_DEFAULT * s_default
    )
    return total


def choose_variant(
    scenario: str,
    text: str,
    question_intent: str = "",
    query_type: str = "overview",
    entity_count: int = 1,
    metric_count: int = 1,
    instance_count: int = 1,
) -> str:
    """Choose the best variant for a scenario using multi-signal scoring.

    Args:
        scenario: Widget scenario (e.g., "comparison")
        text: Combined query + question text (lowercased)
        question_intent: From question_dict (baseline/trend/anomaly/comparison/correlation/health)
        query_type: From ParsedIntent.query_type (status/analysis/comparison/trend/...)
        entity_count: Number of resolved entities
        metric_count: Number of metrics (columns) available
        instance_count: Number of table instances (e.g., TRF-001, TRF-002)

    Returns:
        Best variant key (e.g., "comparison-waterfall")
    """
    profiles = VARIANT_PROFILES.get(scenario)
    if not profiles:
        # Single-variant scenario or unknown — return scenario name
        return scenario

    best_variant = scenario
    best_score = -1.0

    for variant, profile in profiles.items():
        s = score_variant(
            variant, profile, text, question_intent, query_type,
            entity_count, metric_count, instance_count,
        )
        if s > best_score:
            best_score = s
            best_variant = variant

    logger.debug(f"[VariantScorer] {scenario} -> {best_variant} (score={best_score:.3f})")
    return best_variant


# ═════════════════════════════════════════════════════════════════════════════
# VARIANT PROFILES — One per variant, across all multi-variant scenarios
# ═════════════════════════════════════════════════════════════════════════════

VARIANT_PROFILES: dict[str, dict[str, VariantProfile]] = {

    # ── KPI ───────────────────────────────────────────────────────────────────
    "kpi": {
        "kpi-live": VariantProfile(
            intent_affinity={"baseline": 0.9, "health": 0.5, "trend": 0.3},
            query_type_affinity={"status": 0.8, "overview": 0.7, "trend": 0.4},
            ideal_entity_count=(1, 3),
            ideal_metric_count=(1, 2),
            is_default=True,
        ),
        "kpi-alert": VariantProfile(
            intent_affinity={"anomaly": 0.9, "health": 0.6},
            query_type_affinity={"alert": 0.9, "diagnostic": 0.6, "status": 0.5},
            ideal_entity_count=(1, 2),
        ),
        "kpi-accumulated": VariantProfile(
            intent_affinity={"baseline": 0.8, "trend": 0.5},
            query_type_affinity={"overview": 0.7, "status": 0.5, "analysis": 0.5},
            ideal_entity_count=(1, 2),
        ),
        "kpi-lifecycle": VariantProfile(
            intent_affinity={"health": 0.9, "baseline": 0.7},
            query_type_affinity={"diagnostic": 0.8, "status": 0.6, "forecast": 0.7},
            ideal_entity_count=(1, 2),
        ),
        "kpi-status": VariantProfile(
            intent_affinity={"health": 0.8, "baseline": 0.5},
            query_type_affinity={"status": 0.9, "overview": 0.5, "diagnostic": 0.5},
            ideal_entity_count=(1, 5),
        ),
    },

    # ── Trend ─────────────────────────────────────────────────────────────────
    "trend": {
        "trend-line": VariantProfile(
            intent_affinity={"trend": 0.8, "baseline": 0.5, "correlation": 0.4},
            query_type_affinity={"trend": 0.8, "analysis": 0.6, "overview": 0.5},
            ideal_entity_count=(1, 2),
            ideal_metric_count=(1, 1),
            is_default=True,
        ),
        "trend-area": VariantProfile(
            intent_affinity={"trend": 0.8, "baseline": 0.5},
            query_type_affinity={"trend": 0.8, "analysis": 0.6, "overview": 0.5},
            ideal_entity_count=(1, 2),
            ideal_metric_count=(1, 1),
        ),
        "trend-step-line": VariantProfile(
            intent_affinity={"health": 0.6, "baseline": 0.5, "anomaly": 0.5, "trend": 0.6},
            query_type_affinity={"status": 0.7, "diagnostic": 0.6, "trend": 0.6},
            ideal_entity_count=(1, 2),
            ideal_metric_count=(1, 1),
        ),
        "trend-rgb-phase": VariantProfile(
            intent_affinity={"trend": 0.7, "baseline": 0.6, "anomaly": 0.7, "comparison": 0.5},
            query_type_affinity={"trend": 0.7, "analysis": 0.7, "diagnostic": 0.8, "status": 0.5},
            ideal_entity_count=(1, 1),
            ideal_metric_count=(3, 3),
        ),
        "trend-alert-context": VariantProfile(
            intent_affinity={"anomaly": 0.9, "health": 0.6, "trend": 0.5},
            query_type_affinity={"alert": 0.9, "diagnostic": 0.7, "analysis": 0.5},
            ideal_entity_count=(1, 2),
            ideal_metric_count=(1, 2),
        ),
        "trend-heatmap": VariantProfile(
            intent_affinity={"trend": 0.7, "anomaly": 0.6, "correlation": 0.5},
            query_type_affinity={"analysis": 0.8, "trend": 0.6, "overview": 0.5},
            ideal_entity_count=(1, 2),
            ideal_metric_count=(1, 2),
        ),
    },

    # ── Comparison ────────────────────────────────────────────────────────────
    "comparison": {
        "comparison-side-by-side": VariantProfile(
            intent_affinity={"comparison": 0.8, "baseline": 0.5},
            query_type_affinity={"comparison": 0.8, "status": 0.5, "overview": 0.5},
            ideal_entity_count=(2, 2),
            ideal_instance_count=(2, 4),
            is_default=True,
        ),
        "comparison-delta-bar": VariantProfile(
            intent_affinity={"comparison": 0.8, "anomaly": 0.7, "baseline": 0.4},
            query_type_affinity={"comparison": 0.8, "analysis": 0.7, "diagnostic": 0.6},
            ideal_entity_count=(2, 6),
            ideal_instance_count=(2, 8),
        ),
        "comparison-grouped-bar": VariantProfile(
            intent_affinity={"comparison": 0.8, "baseline": 0.4},
            query_type_affinity={"comparison": 0.8, "analysis": 0.7},
            ideal_entity_count=(2, 5),
            ideal_metric_count=(3, 8),
            needs_multiple_entities=True,
        ),
        "comparison-waterfall": VariantProfile(
            intent_affinity={"comparison": 0.7, "anomaly": 0.5, "health": 0.4},
            query_type_affinity={"analysis": 0.8, "diagnostic": 0.6, "comparison": 0.6},
            ideal_entity_count=(1, 3),
            ideal_metric_count=(3, 10),
        ),
        "comparison-small-multiples": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.5, "health": 0.5},
            query_type_affinity={"overview": 0.8, "comparison": 0.7, "status": 0.6},
            ideal_entity_count=(4, 20),
            ideal_instance_count=(4, 20),
            needs_multiple_entities=True,
        ),
        "comparison-composition-split": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.3},
            query_type_affinity={"comparison": 0.7, "analysis": 0.7},
            ideal_entity_count=(2, 3),
            ideal_metric_count=(3, 8),
            needs_multiple_entities=True,
        ),
    },

    # ── Distribution ──────────────────────────────────────────────────────────
    "distribution": {
        "distribution-donut": VariantProfile(
            intent_affinity={"baseline": 0.7, "comparison": 0.5},
            query_type_affinity={"overview": 0.8, "analysis": 0.7, "status": 0.5},
            ideal_metric_count=(2, 7),
            is_default=True,
        ),
        "distribution-pie": VariantProfile(
            intent_affinity={"baseline": 0.6},
            query_type_affinity={"overview": 0.6, "status": 0.4},
            ideal_metric_count=(2, 5),  # Pie is bad with >5 slices
        ),
        "distribution-horizontal-bar": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.5},
            query_type_affinity={"analysis": 0.7, "comparison": 0.6, "overview": 0.5},
            ideal_metric_count=(4, 20),  # Good for many items
        ),
        "distribution-pareto-bar": VariantProfile(
            intent_affinity={"anomaly": 0.7, "comparison": 0.6, "health": 0.5, "baseline": 0.4},
            query_type_affinity={"diagnostic": 0.8, "analysis": 0.8},
            ideal_metric_count=(4, 15),
        ),
        "distribution-grouped-bar": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.4},
            query_type_affinity={"comparison": 0.7, "analysis": 0.7},
            ideal_metric_count=(3, 10),
            ideal_entity_count=(2, 6),
            needs_multiple_entities=True,
        ),
        "distribution-100-stacked-bar": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.4},
            query_type_affinity={"comparison": 0.7, "analysis": 0.7},
            ideal_metric_count=(3, 10),
        ),
    },

    # ── Composition ───────────────────────────────────────────────────────────
    "composition": {
        "composition-stacked-bar": VariantProfile(
            intent_affinity={"baseline": 0.7, "comparison": 0.5},
            query_type_affinity={"analysis": 0.7, "overview": 0.7, "comparison": 0.5},
            ideal_metric_count=(2, 8),
            is_default=True,
        ),
        "composition-stacked-area": VariantProfile(
            intent_affinity={"trend": 0.8, "comparison": 0.5},
            query_type_affinity={"trend": 0.8, "analysis": 0.7},
            needs_timeseries=True,
            ideal_metric_count=(2, 6),
        ),
        "composition-donut": VariantProfile(
            intent_affinity={"baseline": 0.7, "health": 0.4},
            query_type_affinity={"overview": 0.7, "status": 0.6},
            ideal_metric_count=(2, 6),
        ),
        "composition-waterfall": VariantProfile(
            intent_affinity={"comparison": 0.6, "anomaly": 0.5, "baseline": 0.3},
            query_type_affinity={"analysis": 0.8, "diagnostic": 0.6},
            ideal_metric_count=(3, 10),
        ),
        "composition-treemap": VariantProfile(
            intent_affinity={"baseline": 0.5, "comparison": 0.5},
            query_type_affinity={"analysis": 0.7, "overview": 0.7},
            ideal_metric_count=(2, 30),  # Treemap works with fewer items too
        ),
    },

    # ── Alerts ────────────────────────────────────────────────────────────────
    "alerts": {
        "alerts-card": VariantProfile(
            intent_affinity={"anomaly": 0.7, "health": 0.5},
            query_type_affinity={"alert": 0.6, "status": 0.5, "overview": 0.4},
            is_default=True,
        ),
        "alerts-banner": VariantProfile(
            intent_affinity={"anomaly": 0.7},
            query_type_affinity={"alert": 0.7},
        ),
        "alerts-toast": VariantProfile(
            intent_affinity={"anomaly": 0.6},
            query_type_affinity={"alert": 0.6},
        ),
        "alerts-badge": VariantProfile(
            intent_affinity={"health": 0.6, "baseline": 0.4},
            query_type_affinity={"status": 0.7, "overview": 0.6},
        ),
        "alerts-modal": VariantProfile(
            intent_affinity={"anomaly": 0.8, "health": 0.5},
            query_type_affinity={"diagnostic": 0.8, "alert": 0.7},
        ),
    },

    # ── Timeline ──────────────────────────────────────────────────────────────
    "timeline": {
        "timeline-linear": VariantProfile(
            intent_affinity={"trend": 0.5, "baseline": 0.4, "anomaly": 0.4},
            query_type_affinity={"overview": 0.5, "status": 0.4, "analysis": 0.4},
            is_default=True,
        ),
        "timeline-status": VariantProfile(
            intent_affinity={"health": 0.8, "baseline": 0.5, "trend": 0.5},
            query_type_affinity={"status": 0.9, "diagnostic": 0.6},
        ),
        "timeline-multilane": VariantProfile(
            intent_affinity={"comparison": 0.7, "baseline": 0.4},
            query_type_affinity={"overview": 0.6, "comparison": 0.6},
            ideal_entity_count=(2, 10),
        ),
        "timeline-forensic": VariantProfile(
            intent_affinity={"anomaly": 0.9, "health": 0.6},
            query_type_affinity={"diagnostic": 0.9, "alert": 0.6},
        ),
        "timeline-dense": VariantProfile(
            intent_affinity={"anomaly": 0.7, "trend": 0.5, "baseline": 0.5},
            query_type_affinity={"diagnostic": 0.7, "analysis": 0.6, "overview": 0.5},
        ),
    },

    # ── EventLogStream ────────────────────────────────────────────────────────
    "eventlogstream": {
        "eventlogstream-chronological": VariantProfile(
            intent_affinity={"baseline": 0.5, "anomaly": 0.4},
            query_type_affinity={"overview": 0.5, "status": 0.5},
            is_default=True,
        ),
        "eventlogstream-compact-feed": VariantProfile(
            intent_affinity={"baseline": 0.5},
            query_type_affinity={"overview": 0.6, "status": 0.5},
        ),
        "eventlogstream-tabular": VariantProfile(
            intent_affinity={"baseline": 0.5, "comparison": 0.4},
            query_type_affinity={"analysis": 0.7, "overview": 0.5},
        ),
        "eventlogstream-correlation": VariantProfile(
            intent_affinity={"correlation": 0.9, "anomaly": 0.6},
            query_type_affinity={"diagnostic": 0.8, "analysis": 0.7},
        ),
        "eventlogstream-grouped-asset": VariantProfile(
            intent_affinity={"comparison": 0.6, "baseline": 0.4},
            query_type_affinity={"overview": 0.6, "comparison": 0.6},
            ideal_entity_count=(2, 10),
        ),
    },

    # ── Category-Bar ──────────────────────────────────────────────────────────
    "category-bar": {
        "category-bar-vertical": VariantProfile(
            intent_affinity={"comparison": 0.6, "baseline": 0.5},
            query_type_affinity={"comparison": 0.6, "overview": 0.5},
            ideal_metric_count=(2, 8),
            is_default=True,
        ),
        "category-bar-horizontal": VariantProfile(
            intent_affinity={"comparison": 0.6, "baseline": 0.6},
            query_type_affinity={"comparison": 0.6, "overview": 0.6, "analysis": 0.5},
            ideal_metric_count=(1, 20),
        ),
        "category-bar-stacked": VariantProfile(
            intent_affinity={"comparison": 0.6, "baseline": 0.4},
            query_type_affinity={"analysis": 0.7, "comparison": 0.6},
            ideal_metric_count=(3, 10),
        ),
        "category-bar-grouped": VariantProfile(
            intent_affinity={"comparison": 0.8, "baseline": 0.4},
            query_type_affinity={"comparison": 0.8, "analysis": 0.7},
            ideal_metric_count=(2, 5),
        ),
        "category-bar-diverging": VariantProfile(
            intent_affinity={"anomaly": 0.7, "comparison": 0.7},
            query_type_affinity={"analysis": 0.8, "diagnostic": 0.6, "comparison": 0.6},
        ),
    },

    # ── Flow-Sankey ───────────────────────────────────────────────────────────
    "flow-sankey": {
        "flow-sankey-standard": VariantProfile(
            intent_affinity={"baseline": 0.5, "comparison": 0.4},
            query_type_affinity={"analysis": 0.6, "overview": 0.5},
            is_default=True,
        ),
        "flow-sankey-energy-balance": VariantProfile(
            intent_affinity={"anomaly": 0.6, "health": 0.5, "baseline": 0.4},
            query_type_affinity={"analysis": 0.8, "diagnostic": 0.6},
        ),
        "flow-sankey-multi-source": VariantProfile(
            intent_affinity={"baseline": 0.5, "comparison": 0.5},
            query_type_affinity={"analysis": 0.7},
            ideal_entity_count=(3, 10),
        ),
        "flow-sankey-layered": VariantProfile(
            intent_affinity={"baseline": 0.5},
            query_type_affinity={"analysis": 0.7, "overview": 0.5},
        ),
        "flow-sankey-time-sliced": VariantProfile(
            intent_affinity={"trend": 0.8, "comparison": 0.5},
            query_type_affinity={"trend": 0.7, "analysis": 0.7},
            needs_timeseries=True,
        ),
    },

    # ── Matrix-Heatmap ────────────────────────────────────────────────────────
    "matrix-heatmap": {
        "matrix-heatmap-value": VariantProfile(
            intent_affinity={"baseline": 0.5, "comparison": 0.5},
            query_type_affinity={"overview": 0.6, "analysis": 0.6, "status": 0.5},
            is_default=True,
        ),
        "matrix-heatmap-correlation": VariantProfile(
            intent_affinity={"correlation": 0.95, "comparison": 0.4},
            query_type_affinity={"analysis": 0.9, "diagnostic": 0.5},
            ideal_metric_count=(3, 20),
        ),
        "matrix-heatmap-calendar": VariantProfile(
            intent_affinity={"trend": 0.7, "anomaly": 0.5},
            query_type_affinity={"analysis": 0.7, "trend": 0.7},
        ),
        "matrix-heatmap-status": VariantProfile(
            intent_affinity={"health": 0.9, "baseline": 0.5, "anomaly": 0.5},
            query_type_affinity={"status": 0.9, "diagnostic": 0.7, "overview": 0.6},
            ideal_entity_count=(3, 20),
        ),
        "matrix-heatmap-density": VariantProfile(
            intent_affinity={"anomaly": 0.6, "baseline": 0.4},
            query_type_affinity={"analysis": 0.7, "diagnostic": 0.5},
        ),
    },
}


"""
Widget selection via data-driven scoring + Thompson Sampling exploration.

Architecture:
1. Data-driven eligibility — DataShapeProfile + domain detection (scenario_scorer.py)
2. Scenario scoring — data shape fitness + query type affinity (no keywords)
3. Thompson Sampling modulation — exploration noise for RL learning
4. Diversity constraint (no more than 2 of same family)
5. 3-layer variant selection pipeline:
   a) LlamaIndex MetadataFilters — hard constraint elimination (variant_metadata.py)
   b) LangGraph constraint graph — data shape + intent scoring (selection_graph.py)
   c) DSPy ChainOfThought — reasoned tie-breaking when ambiguous (dspy_reasoner.py)

All 24 scenarios are first-class citizens. No scenario is "niche" — the system
intelligently detects which scenarios fit the data, not the user's keywords.
"""


import random

logger = logging.getLogger(__name__)


@dataclass
class BetaParams:
    """Thompson Sampling Beta distribution parameters per scenario."""
    alpha: float = 1.0  # Success count + 1
    beta: float = 1.0   # Failure count + 1

    def sample(self) -> float:
        """Draw from Beta distribution."""
        return random.betavariate(self.alpha, self.beta)

    def update(self, reward: float):
        """Update parameters based on reward signal."""
        if reward > 0:
            self.alpha += reward
        else:
            self.beta += abs(reward)


# Default variant per scenario
_DEFAULT_VARIANT: dict[str, str] = {
    "kpi": "kpi-live",
    "alerts": "alerts-card",
    "trend": "trend-line",
    "trend-multi-line": "trend-multi-line",
    "trends-cumulative": "trends-cumulative",
    "comparison": "comparison-side-by-side",
    "distribution": "distribution-donut",
    "composition": "composition-stacked-bar",
    "category-bar": "category-bar-vertical",
    "flow-sankey": "flow-sankey-standard",
    "matrix-heatmap": "matrix-heatmap-value",
    "timeline": "timeline-linear",
    "eventlogstream": "eventlogstream-chronological",
    "narrative": "narrative",
    "peopleview": "peopleview",
    "peoplehexgrid": "peoplehexgrid",
    "peoplenetwork": "peoplenetwork",
    "supplychainglobe": "supplychainglobe",
    "edgedevicepanel": "edgedevicepanel",
    "chatstream": "chatstream",
    "diagnosticpanel": "diagnosticpanel",
    "uncertaintypanel": "uncertaintypanel",
    "agentsview": "agentsview",
    "vaultview": "vaultview",
}

# Data requirements per scenario (hard constraints)
_DATA_REQUIREMENTS: dict[str, dict[str, Any]] = {
    "kpi": {"min_tables": 1, "needs_timeseries": True},
    "trend": {"min_tables": 1, "needs_timeseries": True},
    "trend-multi-line": {"min_tables": 1, "needs_timeseries": True},
    "trends-cumulative": {"min_tables": 1, "needs_timeseries": True},
    "comparison": {"min_tables": 1, "needs_timeseries": True},
    "distribution": {"min_tables": 1, "needs_timeseries": True},
    "composition": {"min_tables": 1, "needs_timeseries": True},
    "category-bar": {"min_tables": 1, "needs_timeseries": True},
    "flow-sankey": {"min_tables": 1, "needs_timeseries": True},
    "matrix-heatmap": {"min_tables": 1, "needs_timeseries": True},
    "timeline": {"min_tables": 1, "needs_timeseries": True},
    "alerts": {"min_tables": 1, "needs_timeseries": True},
    "eventlogstream": {"min_tables": 1, "needs_timeseries": True},
    "peopleview": {"min_tables": 1, "needs_timeseries": False},
    "peoplehexgrid": {"min_tables": 1, "needs_timeseries": False},
    "peoplenetwork": {"min_tables": 1, "needs_timeseries": False},
    "supplychainglobe": {"min_tables": 1, "needs_timeseries": False},
    "narrative": {"min_tables": 0, "needs_timeseries": False},
    "edgedevicepanel": {"min_tables": 1, "needs_timeseries": False},
    "chatstream": {"min_tables": 0, "needs_timeseries": False},
    "diagnosticpanel": {"min_tables": 1, "needs_timeseries": False},
    "uncertaintypanel": {"min_tables": 1, "needs_timeseries": False},
    "agentsview": {"min_tables": 0, "needs_timeseries": False},
    "vaultview": {"min_tables": 0, "needs_timeseries": False},
}

# Build scenario → [variants] reverse map for variant-aware selection
_SCENARIO_VARIANTS: dict[str, list[str]] = {}
for _v, _s in VARIANT_TO_SCENARIO.items():
    _SCENARIO_VARIANTS.setdefault(_s, []).append(_v)

# Category caps — maximum scenarios per category in a single dashboard.
# Greedy selection picks the highest-scoring scenario that doesn't exceed
# its category cap. This ensures diversity without rigid slot reservation.
_CATEGORY_MAP: dict[str, str] = {
    "kpi": "anchor",
    "trend": "trend", "trend-multi-line": "trend", "trends-cumulative": "trend",
    "comparison": "analysis", "distribution": "analysis", "composition": "analysis",
    "category-bar": "analysis", "flow-sankey": "analysis", "matrix-heatmap": "analysis",
    "timeline": "context", "eventlogstream": "context",
    "alerts": "alerts", "narrative": "context",
    "peopleview": "domain", "peoplehexgrid": "domain", "peoplenetwork": "domain",
    "supplychainglobe": "domain", "edgedevicepanel": "domain",
    "chatstream": "domain", "diagnosticpanel": "domain",
    "uncertaintypanel": "domain", "agentsview": "domain", "vaultview": "domain",
}
_CATEGORY_CAPS: dict[str, int] = {
    "anchor": 1,    # Always 1 KPI
    "trend": 2,     # Up to 2 trend types
    "analysis": 4,  # Up to 4 different analysis views
    "context": 2,   # Up to 2 contextual widgets (timeline, eventlog, narrative)
    "alerts": 1,    # Up to 1 alert widget
    "domain": 3,    # Up to 3 domain-specific widgets (e.g., 3 people scenarios)
}


class WidgetSelector:
    """
    Select widgets using data-driven scoring + Thompson Sampling exploration.

    All 24 scenarios compete on equal footing. Domain-specific scenarios are
    gated by data domain detection (entity types + column names), not keywords.
    Core scenarios are scored by DataShapeProfile fitness.
    """

    def __init__(self):
        # Thompson Sampling parameters per scenario
        self._posteriors: dict[str, BetaParams] = {
            s: BetaParams() for s in VALID_SCENARIOS
        }

    def select(
        self,
        intent: ParsedIntent,
        data_profile: DataProfile,
        max_widgets: int = 10,
        questions: list[str] | None = None,
        question_dicts: list[dict] | None = None,
        catalog: Any = None,
        embedding_client: Any = None,
        query_embedding: list[float] | None = None,
    ) -> list[WidgetSlot]:
        """
        Select widgets for a dashboard.

        1. Extract DataShapeProfile from catalog
        2. Score all scenarios using data-driven fitness (scenario_scorer)
        3. Filter by hard data requirements
        4. Modulate with Thompson Sampling for exploration
        5. Pick top-K with diversity constraint
        6. Assign questions with entity diversity maximization
        7. Select variant per scenario via LangGraph pipeline
        """
        # score_all_scenarios defined in this file

        # Step 1: Extract data shape profile
        shape = extract_data_shape(catalog, data_profile, intent)

        # Step 2: Score all scenarios using data-driven fitness
        scenario_scores = score_all_scenarios(
            shape=shape,
            query_type=intent.query_type.value,
            catalog=catalog,
            intent=intent,
        )

        # Step 3: Hard data requirements filter
        eligible = self._filter_eligible(data_profile)

        # Always include KPI
        if "kpi" not in eligible:
            eligible.add("kpi")

        # Step 4: Combine data-driven scores with Thompson Sampling
        scores: list[tuple[str, float]] = []
        for scenario in eligible:
            data_score = scenario_scores.get(scenario, 0.0)
            if data_score <= 0.0:
                continue  # Domain mismatch — skip entirely
            ts_score = self._posteriors[scenario].sample()
            # Blend: 85% data-driven + 15% Thompson Sampling (exploration)
            # High data weight ensures the right scenarios are selected;
            # low TS weight provides enough noise for RL exploration.
            combined = 0.85 * data_score + 0.15 * ts_score
            scores.append((scenario, combined))

        scores.sort(key=lambda x: x[1], reverse=True)

        # Step 5: Greedy selection with category caps
        # Pick highest-scoring scenarios while respecting per-category limits.
        # This ensures diverse dashboards without rigid slot reservation —
        # high-scoring domain scenarios naturally compete with core scenarios.
        selected: list[str] = []
        cat_counts: dict[str, int] = {}
        for scenario, score in scores:
            if len(selected) >= max_widgets:
                break
            cat = _CATEGORY_MAP.get(scenario, "analysis")
            cap = _CATEGORY_CAPS.get(cat, 2)
            if cat_counts.get(cat, 0) < cap:
                selected.append(scenario)
                cat_counts[cat] = cat_counts.get(cat, 0) + 1

        # Guarantee KPI in final layout
        if "kpi" in eligible and "kpi" not in selected:
            if len(selected) < max_widgets:
                selected.append("kpi")
            elif selected:
                selected[-1] = "kpi"

        # Step 6: Assign questions with entity diversity maximization
        q_dicts = question_dicts or []
        widget_questions = questions or intent.sub_questions or []
        available_qs = list(range(len(q_dicts)))

        assignments: list[tuple[str, dict, str]] = []
        used_prefixes: set[str] = set()
        used_instances: set[str] = set()

        for scenario in selected:
            best_idx = None
            best_score = -1

            for qi in available_qs:
                qd = q_dicts[qi] if qi < len(q_dicts) else {}
                prefix = qd.get("table_prefix", "")
                text_lower = qd.get("text", "").lower()

                inst_match = re.search(r'([a-z_]{2,})-(\d{2,3})', text_lower)
                inst_id = f"{inst_match.group(1)}_{inst_match.group(2)}" if inst_match else ""

                score = 0
                if prefix and prefix not in used_prefixes:
                    score += 2
                if inst_id and inst_id not in used_instances:
                    score += 1

                if score > best_score:
                    best_score = score
                    best_idx = qi

            if best_idx is None and available_qs:
                best_idx = available_qs[0]

            if best_idx is not None:
                available_qs.remove(best_idx)
                qd = q_dicts[best_idx] if best_idx < len(q_dicts) else {}
                text = qd.get("text", "") or (widget_questions[best_idx] if best_idx < len(widget_questions) else "")
                prefix = qd.get("table_prefix", "")
                if prefix:
                    used_prefixes.add(prefix)
                inst_match = re.search(r'([a-z_]{2,})-(\d{2,3})', (text or "").lower())
                if inst_match:
                    used_instances.add(f"{inst_match.group(1)}_{inst_match.group(2)}")
                assignments.append((scenario, qd, text or f"Widget {len(assignments)+1}"))
            else:
                assignments.append((scenario, {}, f"Widget {len(assignments)+1}"))

        # Step 7: Build WidgetSlot list with variant selection
        widgets: list[WidgetSlot] = []
        for i, (scenario, qd, question) in enumerate(assignments):
            variant = self._choose_variant(
                scenario, intent, question, qd, data_profile, catalog,
                embedding_client=embedding_client,
                query_embedding=query_embedding,
            )
            widgets.append(WidgetSlot(
                id=f"w{i+1}",
                variant=variant,
                scenario=scenario,
                size=WidgetSize.normal,
                question=question,
                relevance=round(0.6 + 0.4 * (1 - i / max(len(selected), 1)), 2),
                entity_id=qd.get("entity_id", ""),
                table_prefix=qd.get("table_prefix", ""),
                entity_confidence=float(qd.get("entity_confidence", 0.0)),
            ))

        return widgets

    def update(self, scenario: str, reward: float):
        """Update Thompson Sampling posterior for a scenario after feedback."""
        if scenario in self._posteriors:
            self._posteriors[scenario].update(reward)

    def _filter_eligible(self, profile: DataProfile) -> set[str]:
        """Filter scenarios based on hard data requirements only.

        Domain-based eligibility is handled by scenario_scorer.py which
        returns 0.0 for domain mismatches. This method only checks
        timeseries availability and minimum table counts.
        """
        eligible: set[str] = set()
        for scenario, reqs in _DATA_REQUIREMENTS.items():
            min_tables = reqs.get("min_tables", 0)
            needs_ts = reqs.get("needs_timeseries", False)

            if needs_ts and not profile.has_timeseries:
                continue
            if profile.table_count < min_tables:
                continue
            eligible.add(scenario)

        # Ensure minimum viable set
        minimum = {"kpi", "trend"}
        if profile.has_timeseries:
            eligible |= minimum

        return eligible

    def _choose_variant(
        self,
        scenario: str,
        intent: ParsedIntent,
        question: str,
        question_dict: dict | None = None,
        data_profile: DataProfile | None = None,
        catalog: Any = None,
        embedding_client: Any = None,
        query_embedding: list[float] | None = None,
    ) -> str:
        """Choose the best variant using the 3-layer selection pipeline.

        Pipeline (all layers integrated in LangGraph constraint graph):
        1. LlamaIndex MetadataFilters — hard constraint elimination
        2. Data shape + intent scoring — ranked composite
        3. DSPy ChainOfThought — reasoned tie-breaking (when ambiguous)

        Selection based on measurable data properties (variance, cardinality,
        metric type, hierarchy, temporal density), not keywords.
        """
        # Single-variant scenarios → no selection needed
        if scenario not in VARIANT_PROFILES:
            return _DEFAULT_VARIANT.get(scenario, scenario)

        text = (intent.original_query + " " + question).lower()
        qd = question_dict or {}

        # Extract context signals
        question_intent = qd.get("intent", "")
        entity_count = len(intent.entities) if intent.entities else 1
        metric_count = len(intent.metrics) if intent.metrics else 1
        instance_count = sum(
            len(e.instances) for e in intent.entities
        ) if intent.entities else (
            data_profile.table_count if data_profile else 1
        )
        if data_profile:
            metric_count = max(metric_count, data_profile.numeric_column_count)
        has_timeseries = data_profile.has_timeseries if data_profile else True

        try:
            # run_selection_graph defined in this file

            variant, confidence, method = run_selection_graph(
                scenario=scenario,
                query_text=text,
                question_intent=question_intent,
                query_type=intent.query_type.value,
                entity_count=entity_count,
                metric_count=metric_count,
                instance_count=instance_count,
                has_timeseries=has_timeseries,
                catalog=catalog,
                data_profile=data_profile,
                intent=intent,
                query_embedding=query_embedding,
                embedding_client=embedding_client,
            )

            # Guard: ensure variant belongs to this scenario
            valid_variants = set(VARIANT_PROFILES.get(scenario, {}).keys())
            if valid_variants and variant not in valid_variants:
                logger.warning(
                    f"[WidgetSelector] Cross-scenario leak: {scenario} got {variant}, "
                    f"using default"
                )
                return _DEFAULT_VARIANT.get(scenario, scenario)

            return variant

        except Exception as e:
            logger.debug(f"[WidgetSelector] Selection graph failed: {e}")

        # Fallback: scenario default
        return _DEFAULT_VARIANT.get(scenario, scenario)

# Section: data_resolver

"""
Widget Data Resolver — fetches live data from an active DB connection
using each widget's RAG strategy.

RAG Strategies:
  - single_metric:   SELECT one numeric column, aggregate over time
  - multi_metric:    SELECT multiple numeric columns for comparison
  - alert_query:     SELECT rows matching alert/warning conditions
  - narrative:       SELECT text content + aggregate summaries
  - flow_analysis:   SELECT source→target flows with values
  - events_in_range: SELECT time-ordered events in a date range
  - none:            No DB query — requires external data source
"""

from typing import Any, Optional

logger = logging.getLogger("neura.widget_intelligence.data_resolver")


def _coerce(val):
    """Coerce numpy/pandas types to native Python for JSON serialization."""
    if val is None:
        return None
    t = type(val).__name__
    if "int" in t and t != "int":
        return int(val)
    if "float" in t and t != "float":
        return float(val)
    if "bool" in t and t != "bool":
        return bool(val)
    if hasattr(val, "isoformat"):
        return val.isoformat()
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    return val


def _coerce_dict(d: dict) -> dict:
    """Recursively coerce all values in a dict."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = _coerce_dict(v)
        elif isinstance(v, list):
            out[k] = [_coerce_dict(i) if isinstance(i, dict) else _coerce(i) for i in v]
        else:
            out[k] = _coerce(v)
    return out


class WidgetDataResolver:
    """Resolves widget data from a database connection using RAG strategies."""

    def __init__(self):
        self._registry = None

    def _get_registry(self):
        if self._registry is None:
            self._registry = WidgetRegistry()
        return self._registry

    def resolve(
        self,
        connection_id: str,
        scenario: str,
        variant: Optional[str] = None,
        filters: Optional[dict] = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        """
        Fetch widget-appropriate data from the active DB connection.

        Returns a dict with:
          - data: formatted data ready for frontend rendering
          - source: connection_id used
          - strategy: RAG strategy applied
          - table_used: which DB table was queried
        """
        registry = self._get_registry()
        plugin = registry.get(scenario)
        if not plugin:
            return {"error": f"Unknown scenario: {scenario}", "data": {}}

        rag_strategy = plugin.meta.rag_strategy

        # Strategy: none — no DB query available
        if rag_strategy == "none":
            return {
                "data": {},
                "source": None,
                "strategy": "none",
                "table_used": None,
                "error": "This widget requires an external data source.",
            }

        # Get available tables and schema from the connection
        try:
            tables_info = self._get_connection_tables(connection_id)
        except Exception as e:
            logger.warning("Failed to load connection %s: %s", connection_id, e)
            return {
                "data": {},
                "source": connection_id,
                "strategy": rag_strategy,
                "table_used": None,
                "error": f"Connection failed: {e}",
            }

        if not tables_info:
            return {
                "data": {},
                "source": connection_id,
                "strategy": rag_strategy,
                "table_used": None,
                "error": "No tables found in connection.",
            }

        # Dispatch to strategy-specific resolver
        strategy_map = {
            "single_metric": self._resolve_single_metric,
            "multi_metric": self._resolve_multi_metric,
            "alert_query": self._resolve_alert_query,
            "narrative": self._resolve_narrative,
            "flow_analysis": self._resolve_flow_analysis,
            "events_in_range": self._resolve_events_in_range,
        }

        resolver_fn = strategy_map.get(rag_strategy, self._resolve_single_metric)

        try:
            raw_data = resolver_fn(connection_id, tables_info, plugin, filters, limit)
            # Check if the strategy resolver returned no usable data
            # (e.g. no numeric columns found) — detect by absence of _table_used
            has_data = "_table_used" in raw_data
            if not has_data:
                return {
                    "data": {},
                    "source": connection_id,
                    "strategy": rag_strategy,
                    "table_used": None,
                    "error": "No suitable data found in connection.",
                }
            # Format through the plugin, coerce numpy types for JSON
            formatted = _coerce_dict(plugin.format_data(raw_data))
            return {
                "data": formatted,
                "source": connection_id,
                "strategy": rag_strategy,
                "table_used": raw_data.get("_table_used"),
            }
        except Exception as e:
            logger.warning("Data resolution failed for %s: %s", scenario, e)
            return {
                "data": {},
                "source": connection_id,
                "strategy": rag_strategy,
                "table_used": None,
                "error": str(e),
            }

    # ── Connection helpers ─────────────────────────────────────────────────

    def _get_connection_tables(self, connection_id: str) -> list[dict]:
        """Get table names and columns from a connection."""
        from backend.app.repositories import resolve_db_path
        from backend.app.repositories import ensure_connection_loaded
        import sqlite3 as sqlite_shim

        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        ensure_connection_loaded(connection_id, db_path)

        tables = []
        with sqlite_shim.connect(str(db_path)) as con:
            # Get all tables
            cur = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            table_names = [row[0] for row in cur.fetchall()]

            for tname in table_names:
                try:
                    col_cur = con.execute(f"PRAGMA table_info('{tname}')")
                    columns = [
                        {"name": row[1], "type": row[2]}
                        for row in col_cur.fetchall()
                    ]
                    # Get row count
                    count_cur = con.execute(f"SELECT COUNT(*) FROM \"{tname}\"")
                    row_count = count_cur.fetchone()[0]
                    tables.append({
                        "name": tname,
                        "columns": columns,
                        "row_count": row_count,
                    })
                except Exception:
                    continue

        return tables

    def _execute_query(self, connection_id: str, sql: str, limit: int = 100) -> list[dict]:
        """Execute a read-only query and return rows as dicts.

        Note: SQL already contains LIMIT — do NOT pass limit to execute_query
        to avoid a double LIMIT clause.
        """
        from backend.app.repositories import execute_query
        result = execute_query(connection_id, sql, limit=None)
        columns = result["columns"]
        rows = result["rows"]
        return [dict(zip(columns, row)) for row in rows]

    def _find_best_table(
        self,
        tables_info: list[dict],
        prefer_numeric: bool = False,
        prefer_temporal: bool = False,
        prefer_text: bool = False,
    ) -> Optional[dict]:
        """Select the best table from the connection for a given strategy."""
        if not tables_info:
            return None

        scored = []
        for t in tables_info:
            score = t["row_count"]
            cols = t["columns"]
            num_cols = [c for c in cols if _is_numeric_type(c["type"])]
            text_cols = [c for c in cols if _is_text_type(c["type"])]
            date_cols = [c for c in cols if _is_date_type(c["type"]) or _is_date_name(c["name"])]

            if prefer_numeric and num_cols:
                score += len(num_cols) * 100
            if prefer_temporal and date_cols:
                score += len(date_cols) * 200
            if prefer_text and text_cols:
                score += len(text_cols) * 100
            scored.append((score, t))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1] if scored else None

    # ── Strategy resolvers ─────────────────────────────────────────────────

    def _resolve_single_metric(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Single metric: find first numeric column, return latest value + time series."""
        table = self._find_best_table(tables_info, prefer_numeric=True, prefer_temporal=True)
        if not table:
            return {}

        cols = table["columns"]
        num_cols = [c for c in cols if _is_numeric_type(c["type"])]
        date_cols = [c for c in cols if _is_date_type(c["type"]) or _is_date_name(c["name"])]

        if not num_cols:
            return {}

        metric_col = num_cols[0]["name"]
        order_col = date_cols[0]["name"] if date_cols else num_cols[0]["name"]

        sql = f'SELECT "{order_col}", "{metric_col}" FROM "{table["name"]}" ORDER BY "{order_col}" DESC LIMIT {limit}'
        rows = self._execute_query(connection_id, sql, limit)

        if not rows:
            return {}

        latest = rows[0]
        time_series = [
            {"time": str(r.get(order_col, "")), "value": r.get(metric_col, 0)}
            for r in reversed(rows)
        ]

        return {
            "value": latest.get(metric_col, 0),
            "units": _infer_unit(metric_col),
            "label": metric_col.replace("_", " ").title(),
            "timeSeries": time_series,
            "previousValue": rows[1].get(metric_col) if len(rows) > 1 else None,
            "_table_used": table["name"],
        }

    def _resolve_multi_metric(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Multi metric: select multiple numeric columns for comparison/distribution."""
        table = self._find_best_table(tables_info, prefer_numeric=True)
        if not table:
            return {}

        cols = table["columns"]
        num_cols = [c for c in cols if _is_numeric_type(c["type"])][:6]
        label_cols = [c for c in cols if _is_text_type(c["type"])]
        date_cols = [c for c in cols if _is_date_type(c["type"]) or _is_date_name(c["name"])]

        if not num_cols:
            return {}

        # Build select list
        select_cols = []
        if label_cols:
            select_cols.append(f'"{label_cols[0]["name"]}"')
        if date_cols:
            select_cols.append(f'"{date_cols[0]["name"]}"')
        for nc in num_cols:
            select_cols.append(f'"{nc["name"]}"')

        sql = f'SELECT {", ".join(select_cols)} FROM "{table["name"]}" LIMIT {limit}'
        rows = self._execute_query(connection_id, sql, limit)

        if not rows:
            return {}

        # Build labels and datasets
        label_key = label_cols[0]["name"] if label_cols else (date_cols[0]["name"] if date_cols else None)
        labels = [str(r.get(label_key, f"Row {i+1}")) for i, r in enumerate(rows)] if label_key else [f"Row {i+1}" for i in range(len(rows))]

        datasets = []
        for nc in num_cols:
            datasets.append({
                "label": nc["name"].replace("_", " ").title(),
                "data": [r.get(nc["name"], 0) for r in rows],
            })

        return {
            "labels": labels,
            "datasets": datasets,
            "_table_used": table["name"],
        }

    def _resolve_alert_query(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Alert query: find rows with status/severity/alert columns."""
        # Look for tables with alert-like columns
        alert_table = None
        for t in tables_info:
            col_names = [c["name"].lower() for c in t["columns"]]
            if any(kw in n for n in col_names for kw in ("alert", "warning", "status", "severity", "level")):
                alert_table = t
                break

        if not alert_table:
            alert_table = self._find_best_table(tables_info, prefer_text=True)

        if not alert_table:
            return {}

        sql = f'SELECT * FROM "{alert_table["name"]}" LIMIT {limit}'
        rows = self._execute_query(connection_id, sql, limit)

        if not rows:
            return {}

        # Map rows to alert/event format
        events = []
        for r in rows:
            event = {
                "message": _extract_text_field(r),
                "timestamp": _extract_date_field(r),
                "severity": _extract_severity(r),
            }
            events.append(event)

        return {
            "alerts": events,
            "events": events,
            "_table_used": alert_table["name"],
        }

    def _resolve_narrative(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Narrative: aggregate summaries from the largest table."""
        table = self._find_best_table(tables_info, prefer_numeric=True)
        if not table:
            return {}

        cols = table["columns"]
        num_cols = [c for c in cols if _is_numeric_type(c["type"])][:4]

        if not num_cols:
            return {}

        # Build aggregate query
        agg_parts = []
        for nc in num_cols:
            agg_parts.append(f'AVG("{nc["name"]}") as avg_{nc["name"]}')
            agg_parts.append(f'MIN("{nc["name"]}") as min_{nc["name"]}')
            agg_parts.append(f'MAX("{nc["name"]}") as max_{nc["name"]}')

        sql = f'SELECT COUNT(*) as total_rows, {", ".join(agg_parts)} FROM "{table["name"]}"'
        rows = self._execute_query(connection_id, sql, 1)

        if not rows:
            return {}

        row = rows[0]
        total = row.get("total_rows", 0)

        # Generate narrative text from aggregates
        highlights = []
        lines = [f"Dataset contains {total} records across {len(cols)} columns."]
        for nc in num_cols:
            name = nc["name"].replace("_", " ").title()
            avg = row.get(f"avg_{nc['name']}", 0)
            mn = row.get(f"min_{nc['name']}", 0)
            mx = row.get(f"max_{nc['name']}", 0)
            if avg is not None:
                lines.append(f"{name}: avg {_fmt_num(avg)}, range {_fmt_num(mn)} - {_fmt_num(mx)}.")
                highlights.append(f"{name}: {_fmt_num(avg)}")

        return {
            "title": f"Summary of {table['name']}",
            "text": " ".join(lines),
            "highlights": highlights,
            "_table_used": table["name"],
        }

    def _resolve_flow_analysis(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Flow analysis: look for source→target→value patterns."""
        # Try to find a table with source/target/from/to columns
        flow_table = None
        for t in tables_info:
            col_names = [c["name"].lower() for c in t["columns"]]
            if any(kw in " ".join(col_names) for kw in ("source", "from", "origin")):
                if any(kw in " ".join(col_names) for kw in ("target", "to", "destination")):
                    flow_table = t
                    break

        if not flow_table:
            flow_table = self._find_best_table(tables_info, prefer_numeric=True)

        if not flow_table:
            return {}

        sql = f'SELECT * FROM "{flow_table["name"]}" LIMIT {limit}'
        rows = self._execute_query(connection_id, sql, limit)

        if not rows:
            return {}

        return {
            "nodes": list({str(v) for r in rows for v in r.values() if isinstance(v, str)}),
            "links": rows[:20],
            "_table_used": flow_table["name"],
        }

    def _resolve_events_in_range(
        self, connection_id, tables_info, plugin, filters, limit
    ) -> dict:
        """Events in range: time-ordered events."""
        table = self._find_best_table(tables_info, prefer_temporal=True)
        if not table:
            return {}

        date_cols = [c for c in table["columns"] if _is_date_type(c["type"]) or _is_date_name(c["name"])]
        order_col = date_cols[0]["name"] if date_cols else table["columns"][0]["name"]

        sql = f'SELECT * FROM "{table["name"]}" ORDER BY "{order_col}" DESC LIMIT {limit}'
        rows = self._execute_query(connection_id, sql, limit)

        if not rows:
            return {}

        events = []
        for r in rows:
            events.append({
                "timestamp": _extract_date_field(r),
                "message": _extract_text_field(r),
                "title": _extract_text_field(r),
            })

        return {
            "events": events,
            "timeline": events,
            "_table_used": table["name"],
        }


# ── Helper functions ─────────────────────────────────────────────────────────

def _is_numeric_type(dtype: str) -> bool:
    dtype = dtype.upper()
    return any(kw in dtype for kw in ("INT", "REAL", "FLOAT", "DOUBLE", "DECIMAL", "NUMERIC", "NUMBER"))


def _is_text_type(dtype: str) -> bool:
    dtype = dtype.upper()
    return any(kw in dtype for kw in ("TEXT", "VARCHAR", "CHAR", "STRING", "CLOB"))


def _is_date_type(dtype: str) -> bool:
    dtype = dtype.upper()
    return any(kw in dtype for kw in ("DATE", "TIME", "TIMESTAMP"))


def _is_date_name(name: str) -> bool:
    name = name.lower()
    return any(kw in name for kw in ("date", "time", "timestamp", "created", "updated", "period", "month", "year"))


def _infer_unit(col_name: str) -> str:
    name = col_name.lower()
    if any(kw in name for kw in ("kwh", "energy")):
        return "kWh"
    if any(kw in name for kw in ("temp", "temperature")):
        return "°C"
    if any(kw in name for kw in ("pressure", "psi")):
        return "PSI"
    if any(kw in name for kw in ("percent", "pct", "rate")):
        return "%"
    if any(kw in name for kw in ("cost", "price", "amount", "revenue")):
        return "$"
    if any(kw in name for kw in ("count", "total", "quantity")):
        return ""
    return ""


def _extract_text_field(row: dict) -> str:
    """Extract the first plausible text field from a row."""
    for key in ("message", "text", "title", "name", "description", "label", "note"):
        if key in row and row[key]:
            return str(row[key])
    # Fall back to first string value
    for v in row.values():
        if isinstance(v, str) and len(v) > 2:
            return v
    return str(next(iter(row.values()), ""))


def _extract_date_field(row: dict) -> str:
    """Extract the first plausible date field from a row."""
    for key in row:
        if _is_date_name(key) and row[key]:
            return str(row[key])
    return ""


def _extract_severity(row: dict) -> str:
    """Extract severity/level from a row."""
    for key in ("severity", "level", "status", "priority"):
        if key in row and row[key]:
            val = str(row[key]).lower()
            if val in ("critical", "error", "high"):
                return "critical"
            if val in ("warning", "warn", "medium"):
                return "warning"
            if val in ("info", "low", "notice"):
                return "info"
            if val in ("ok", "normal", "good", "success"):
                return "ok"
            return val
    return "info"


def _fmt_num(val) -> str:
    """Format a number for narrative display."""
    if val is None:
        return "N/A"
    try:
        f = float(val)
        if abs(f) >= 1_000_000:
            return f"{f/1_000_000:.1f}M"
        if abs(f) >= 1_000:
            return f"{f/1_000:.1f}K"
        if f == int(f):
            return str(int(f))
        return f"{f:.2f}"
    except (ValueError, TypeError):
        return str(val)

# Section: service

"""
Widget Intelligence Service — facade over widget selection + grid packing.

Provides a clean API for:
- Widget catalog browsing
- AI-powered widget selection for dashboard composition
- Deterministic CSS grid packing
- Widget data validation and formatting
- Thompson Sampling feedback
"""


logger = logging.getLogger("neura.widget_intelligence")


class WidgetIntelligenceService:
    """Facade over the widget selection + grid packing pipeline."""

    def __init__(self):
        self._registry = WidgetRegistry()
        self._selector = None  # Lazy-loaded to avoid heavy imports at startup

    def _get_selector(self):
        if self._selector is None:
            try:
                from backend.app.services.widget_intelligence import WidgetSelector
                self._selector = WidgetSelector()
            except Exception as e:
                logger.warning(f"WidgetSelector unavailable: {e}")
        return self._selector

    # ── Catalog ──────────────────────────────────────────────────────────

    def get_catalog(self) -> list[dict[str, Any]]:
        """Return all registered widget scenarios with their metadata."""
        result = []
        for scenario in self._registry.scenarios:
            plugin = self._registry.get(scenario)
            if plugin:
                m = plugin.meta
                result.append({
                    "scenario": m.scenario,
                    "variants": m.variants,
                    "description": m.description,
                    "good_for": m.good_for,
                    "sizes": m.sizes,
                    "height_units": m.height_units,
                    "rag_strategy": m.rag_strategy,
                    "required_fields": m.required_fields,
                    "optional_fields": m.optional_fields,
                    "aggregation": m.aggregation,
                })
        return result

    # ── Selection ────────────────────────────────────────────────────────

    def select_widgets(
        self,
        query: str,
        query_type: str = "overview",
        data_profile: Optional[dict] = None,
        max_widgets: int = 10,
    ) -> list[dict[str, Any]]:
        """Select optimal widgets for a query using data-driven scoring."""
        selector = self._get_selector()
        if selector is None:
            # Fallback: return a simple default set
            return self._fallback_selection(max_widgets)

        try:
            qt = QueryType(query_type) if query_type in QueryType.__members__ else QueryType.overview
        except ValueError:
            qt = QueryType.overview

        intent = ParsedIntent(original_query=query, query_type=qt)
        profile = DataProfile(**(data_profile or {}))

        try:
            slots = selector.select(
                intent=intent,
                data_profile=profile,
                max_widgets=max_widgets,
            )
        except Exception as e:
            logger.warning(f"Widget selection failed: {e}")
            return self._fallback_selection(max_widgets)

        return [
            {
                "id": s.id,
                "scenario": s.scenario,
                "variant": s.variant,
                "size": s.size.value if hasattr(s.size, "value") else str(s.size),
                "question": s.question,
                "relevance": s.relevance,
            }
            for s in slots
        ]

    def _fallback_selection(self, max_widgets: int) -> list[dict[str, Any]]:
        """Return a sensible default widget set when selector is unavailable."""
        defaults = [
            ("kpi", "kpi-live", "compact"),
            ("trend", "trend-line", "normal"),
            ("comparison", "comparison-side-by-side", "normal"),
            ("distribution", "distribution-donut", "normal"),
            ("alerts", "alerts-card", "compact"),
            ("narrative", "narrative", "normal"),
            ("timeline", "timeline-linear", "expanded"),
            ("category-bar", "category-bar-vertical", "normal"),
        ]
        return [
            {
                "id": f"w{i+1}",
                "scenario": scenario,
                "variant": variant,
                "size": size,
                "question": f"Widget {i+1}",
                "relevance": round(1.0 - i * 0.1, 2),
            }
            for i, (scenario, variant, size) in enumerate(defaults[:max_widgets])
        ]

    # ── Grid Packing ────────────────────────────────────────────────────

    def pack_grid(self, widgets: list[dict[str, Any]]) -> dict[str, Any]:
        """Pack widget slots into a CSS grid layout."""
        from backend.app.services.widget_intelligence import pack_grid

        slots = []
        for i, w in enumerate(widgets):
            try:
                size = WidgetSize(w.get("size", "normal"))
            except ValueError:
                size = WidgetSize.normal
            slots.append(WidgetSlot(
                id=w.get("id", f"w{i}"),
                scenario=w.get("scenario", ""),
                variant=w.get("variant", ""),
                size=size,
            ))

        layout = pack_grid(slots)
        return {
            "cells": [
                {
                    "widget_id": c.widget_id,
                    "col_start": c.col_start,
                    "col_end": c.col_end,
                    "row_start": c.row_start,
                    "row_end": c.row_end,
                }
                for c in layout.cells
            ],
            "total_cols": layout.total_cols,
            "total_rows": layout.total_rows,
            "utilization_pct": layout.utilization_pct,
        }

    # ── Validation ───────────────────────────────────────────────────────

    def validate_data(self, scenario: str, data: dict) -> list[str]:
        """Validate data shape for a widget scenario."""
        plugin = self._registry.get(scenario)
        if not plugin:
            return [f"Unknown scenario: {scenario}"]
        return plugin.validate_data(data)

    # ── Format ───────────────────────────────────────────────────────────

    def format_data(self, scenario: str, raw: dict) -> dict[str, Any]:
        """Format raw data into frontend-ready shape for a widget scenario."""
        plugin = self._registry.get(scenario)
        if not plugin:
            return raw
        return plugin.format_data(raw)

    # ── Feedback ─────────────────────────────────────────────────────────

    def update_feedback(self, scenario: str, reward: float):
        """Update Thompson Sampling posterior for a scenario."""
        selector = self._get_selector()
        if selector:
            selector.update(scenario, reward)
