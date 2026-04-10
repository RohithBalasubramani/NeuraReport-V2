from __future__ import annotations

"""Merged schemas module."""

"""Core schemas — api, analytics, content, workflows."""

# API_SCHEMAS

from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.utils import is_safe_id, is_safe_name, sanitize_id, sanitize_filename

# Connection Schemas (from schemas/connections)

class ConnectionTestRequest(BaseModel):
    db_url: Optional[str] = Field(None, max_length=1000)
    database: Optional[str] = Field(None, max_length=500)
    db_type: str = Field(default="sqlite", max_length=50)

    @field_validator("db_type")
    @classmethod
    def enforce_supported_type(cls, value: str) -> str:
        supported = {"sqlite", "postgresql", "postgres"}
        if (value or "").lower() not in supported:
            raise ValueError(f"Only {', '.join(sorted(supported))} are supported")
        v = value.lower()
        return "postgresql" if v == "postgres" else v

    @field_validator("database")
    @classmethod
    def validate_database_path(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        # Ensure no path traversal
        if ".." in value:
            raise ValueError("Path traversal not allowed")
        return value

class ConnectionUpsertRequest(ConnectionTestRequest):
    id: Optional[str] = Field(None, max_length=64)
    name: Optional[str] = Field(None, max_length=100)
    status: Optional[str] = Field(None, max_length=50)
    latency_ms: Optional[float] = Field(None, ge=0, le=1000000)
    tags: Optional[list[str]] = Field(None, max_length=20)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not is_safe_id(value):
            raise ValueError("ID must be alphanumeric with dashes/underscores only")
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not is_safe_name(value):
            raise ValueError("Name contains invalid characters")
        return value

    @field_validator("tags")
    @classmethod
    def validate_tag(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        for i, tag in enumerate(value):
            if len(tag) > 50:
                raise ValueError("Tag must be 50 characters or less")
            value[i] = tag.strip()
        return value

class ConnectionResponse(BaseModel):
    id: str
    name: str
    db_type: str
    database_path: Optional[Path] = None
    status: str
    latency_ms: Optional[float] = None

# Federation Schemas (from schemas/federation)

class TableReference(BaseModel):
    """Reference to a table in a connection."""
    connection_id: str
    table_name: str
    alias: Optional[str] = None

class JoinCondition(BaseModel):
    """A join condition between two tables."""
    left_table: str
    left_column: str
    right_table: str
    right_column: str
    join_type: str = "INNER"  # INNER, LEFT, RIGHT, FULL

class JoinSuggestion(BaseModel):
    """AI-suggested join between tables."""
    left_connection_id: str
    left_table: str
    left_column: str
    right_connection_id: str
    right_table: str
    right_column: str
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    suggested_join_type: str = "INNER"

class VirtualSchema(BaseModel):
    """A virtual schema spanning multiple databases."""
    id: str
    name: str
    description: Optional[str] = None
    connections: List[str]  # Connection IDs
    tables: List[TableReference]
    joins: List[JoinCondition]
    created_at: str
    updated_at: str

class VirtualSchemaCreate(BaseModel):
    """Request to create a virtual schema."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    connection_ids: List[str] = Field(..., min_length=1, max_length=10)

class SuggestJoinsRequest(BaseModel):
    """Request to suggest joins between connections."""
    connection_ids: List[str] = Field(..., min_length=2, max_length=10)

class FederatedQueryRequest(BaseModel):
    """Request to execute a federated query."""
    virtual_schema_id: str
    sql: str = Field(..., min_length=1, max_length=10000)
    limit: int = Field(default=100, ge=1, le=1000)

# Synthesis Schemas (from schemas/synthesis)

class SynthesisDocumentType(str, Enum):
    PDF = "pdf"
    EXCEL = "excel"
    WORD = "word"
    TEXT = "text"
    JSON = "json"

# Keep the original name as an alias for backward compatibility
SynthesisDocType = SynthesisDocumentType

class SynthesisDocument(BaseModel):
    """A document added to a synthesis session."""

    id: str
    name: str
    doc_type: SynthesisDocumentType
    content_hash: str
    extracted_text: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Inconsistency(BaseModel):
    """An inconsistency found between documents."""

    id: str
    description: str
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    documents_involved: List[str]
    field_or_topic: str
    values: Dict[str, Any]  # doc_id -> value
    suggested_resolution: Optional[str] = None

class SynthesisSession(BaseModel):
    """A synthesis session containing multiple documents."""

    id: str
    name: str
    documents: List[SynthesisDocument] = Field(default_factory=list)
    inconsistencies: List[Inconsistency] = Field(default_factory=list)
    synthesis_result: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = Field(default="active", pattern="^(active|processing|completed|error)$")

class SynthesisRequest(BaseModel):
    """Request to synthesize documents in a session."""

    focus_topics: Optional[List[str]] = Field(None, max_length=10)
    output_format: str = Field(default="structured", pattern="^(structured|narrative|comparison)$")
    include_sources: bool = Field(default=True)
    max_length: int = Field(default=5000, ge=500, le=20000)

class SynthesisResult(BaseModel):
    """Result of document synthesis."""

    session_id: str
    synthesis: Dict[str, Any]
    inconsistencies: List[Inconsistency]
    source_references: List[Dict[str, Any]]
    confidence: float = Field(ge=0.0, le=1.0)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# DocQA Schemas (from schemas/docqa)

class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"

class FeedbackType(str, Enum):
    HELPFUL = "helpful"
    NOT_HELPFUL = "not_helpful"

class MessageFeedback(BaseModel):
    """Feedback on a message."""

    feedback_type: FeedbackType
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    comment: Optional[str] = None

class Citation(BaseModel):
    """A citation to a document source."""

    document_id: str
    document_name: str
    page_number: Optional[int] = None
    section: Optional[str] = None
    quote: str
    relevance_score: float = Field(default=1.0, ge=0.0, le=1.0)

class ChatMessage(BaseModel):
    """A message in the Q&A chat."""

    id: str
    role: MessageRole
    content: str
    citations: List[Citation] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = Field(default_factory=dict)
    feedback: Optional[MessageFeedback] = None

class DocumentReference(BaseModel):
    """A document added to a Q&A session."""

    id: str
    name: str
    content_preview: str
    full_content: str
    page_count: Optional[int] = None
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DocQASession(BaseModel):
    """A Document Q&A chat session."""

    id: str
    name: str
    documents: List[DocumentReference] = Field(default_factory=list)
    messages: List[ChatMessage] = Field(default_factory=list)
    context_window: int = Field(default=10, ge=1, le=50)  # Messages to include in context
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AskRequest(BaseModel):
    """Request to ask a question."""

    question: str = Field(..., min_length=3, max_length=2000)
    include_citations: bool = Field(default=True)
    max_response_length: int = Field(default=2000, ge=100, le=10000)

class AskResponse(BaseModel):
    """Response to a question."""

    message: ChatMessage
    processing_time_ms: int
    tokens_used: Optional[int] = None

class FeedbackRequest(BaseModel):
    """Request to submit feedback on a message."""

    feedback_type: FeedbackType
    comment: Optional[str] = None

class RegenerateRequest(BaseModel):
    """Request to regenerate a response."""

    include_citations: bool = Field(default=True)
    max_response_length: int = Field(default=2000, ge=100, le=10000)

# NL2SQL Schemas (from schemas/nl2sql)

class NL2SQLGenerateRequest(BaseModel):
    """Request to generate SQL from natural language."""
    question: str = Field(..., min_length=3, max_length=2000)
    connection_id: str = Field(..., min_length=1, max_length=64)
    tables: Optional[List[str]] = Field(None, max_length=50)
    context: Optional[str] = Field(None, max_length=1000)

    @field_validator("connection_id")
    @classmethod
    def validate_nl2sql_gen_connection_id(cls, value: str) -> str:
        if not is_safe_id(value):
            raise ValueError("Connection ID must be alphanumeric with dashes/underscores only")
        return value

    @field_validator("tables")
    @classmethod
    def validate_table_name(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        for i, name in enumerate(value):
            if not name or len(name) > 128:
                raise ValueError("Table name must be 1-128 characters")
            value[i] = name.strip()
        return value

class NL2SQLExecuteRequest(BaseModel):
    """Request to execute a SQL query."""
    sql: str = Field(..., min_length=1, max_length=10000)
    connection_id: str = Field(..., min_length=1, max_length=64)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    include_total: bool = Field(default=False)

    @field_validator("connection_id")
    @classmethod
    def validate_nl2sql_exec_connection_id(cls, value: str) -> str:
        if not is_safe_id(value):
            raise ValueError("Connection ID must be alphanumeric with dashes/underscores only")
        return value

class NL2SQLSaveRequest(BaseModel):
    """Request to save a query as a reusable data source."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sql: str = Field(..., min_length=1, max_length=10000)
    connection_id: str = Field(..., min_length=1, max_length=64)
    original_question: Optional[str] = Field(None, max_length=2000)
    tags: Optional[List[str]] = Field(None, max_length=20)

    @field_validator("name")
    @classmethod
    def validate_nl2sql_save_name(cls, value: str) -> str:
        if not is_safe_name(value):
            raise ValueError("Name contains invalid characters")
        return value.strip()

    @field_validator("connection_id")
    @classmethod
    def validate_nl2sql_save_connection_id(cls, value: str) -> str:
        if not is_safe_id(value):
            raise ValueError("Connection ID must be alphanumeric with dashes/underscores only")
        return value

    @field_validator("tags")
    @classmethod
    def validate_nl2sql_save_tag(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        for i, tag in enumerate(value):
            if len(tag) > 50:
                raise ValueError("Tag must be 50 characters or less")
            value[i] = tag.strip()
        return value

class NL2SQLResult(BaseModel):
    """Result from SQL generation."""
    sql: str
    explanation: str
    confidence: float = Field(ge=0.0, le=1.0)
    warnings: List[str] = Field(default_factory=list)
    original_question: str

class QueryExecutionResult(BaseModel):
    """Result from query execution."""
    columns: List[str]
    rows: List[Dict[str, Any]]
    row_count: int
    total_count: Optional[int] = None
    execution_time_ms: int
    truncated: bool = False

class SavedQuery(BaseModel):
    """A saved SQL query."""
    id: str
    name: str
    description: Optional[str] = None
    sql: str
    connection_id: str
    original_question: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    last_run_at: Optional[str] = None
    run_count: int = 0

class QueryHistoryEntry(BaseModel):
    """An entry in the query history."""
    id: str
    question: str
    sql: str
    connection_id: str
    confidence: float
    success: bool
    error: Optional[str] = None
    execution_time_ms: Optional[int] = None
    row_count: Optional[int] = None
    created_at: str

# Enrichment Schemas (from schemas/enrichment)

class EnrichmentSourceType(str, Enum):
    """Types of enrichment sources."""
    COMPANY_INFO = "company_info"
    ADDRESS = "address"
    EXCHANGE_RATE = "exchange_rate"
    CUSTOM = "custom"

class EnrichmentSource(BaseModel):
    """Configuration for an enrichment source."""
    id: str
    name: str
    type: EnrichmentSourceType
    description: Optional[str] = None
    enabled: bool = True
    config: Dict[str, Any] = Field(default_factory=dict)
    cache_ttl_hours: int = Field(default=24, ge=1, le=720)  # 1 hour to 30 days
    created_at: str
    updated_at: str

class EnrichmentSourceCreate(BaseModel):
    """Request to create an enrichment source."""
    name: str = Field(..., min_length=1, max_length=100)
    type: EnrichmentSourceType
    description: Optional[str] = Field(None, max_length=500)
    config: Dict[str, Any] = Field(default_factory=dict)
    cache_ttl_hours: int = Field(default=24, ge=1, le=720)

    @field_validator("name")
    @classmethod
    def validate_enrichment_source_name(cls, value: str) -> str:
        if not is_safe_name(value):
            raise ValueError("Name contains invalid characters")
        return value.strip()

class EnrichmentFieldMapping(BaseModel):
    """Mapping of source field to enrichment lookup."""
    source_field: str = Field(..., min_length=1, max_length=128)
    enrichment_source_id: str = Field(..., min_length=1, max_length=64)
    target_fields: List[str] = Field(..., min_length=1, max_length=20)
    lookup_key: Optional[str] = None  # Optional override for the lookup key

class EnrichmentRequest(BaseModel):
    """Request to enrich data."""
    data: List[Dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    mappings: List[EnrichmentFieldMapping] = Field(..., min_length=1, max_length=20)
    use_cache: bool = Field(default=True)

class EnrichedField(BaseModel):
    """A single enriched field."""
    field: str
    original_value: Any
    enriched_value: Any
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    source: str
    cached: bool = False

class EnrichmentResult(BaseModel):
    """Result of enrichment for a single row."""
    row_index: int
    enriched_fields: List[EnrichedField]
    errors: List[str] = Field(default_factory=list)

class EnrichmentResponse(BaseModel):
    """Response from enrichment operation."""
    total_rows: int
    enriched_rows: int
    results: List[EnrichmentResult]
    cache_hits: int = 0
    cache_misses: int = 0
    processing_time_ms: int

class EnrichmentPreviewRequest(BaseModel):
    """Request to preview enrichment without persisting."""
    sample_data: List[Dict[str, Any]] = Field(..., min_length=1, max_length=10)
    mappings: List[EnrichmentFieldMapping] = Field(..., min_length=1, max_length=20)

class EnrichmentConfig(BaseModel):
    """Global enrichment configuration."""
    default_cache_ttl_hours: int = Field(default=24, ge=1, le=720)
    max_batch_size: int = Field(default=100, ge=1, le=1000)
    rate_limit_per_minute: int = Field(default=60, ge=1, le=1000)

# Simplified request schemas for frontend compatibility
class SimpleEnrichmentRequest(BaseModel):
    """Simplified request to enrich data (frontend-compatible)."""
    data: List[Dict[str, Any]] = Field(..., min_length=1, max_length=1000)
    sources: List[str] = Field(..., min_length=1, max_length=10)  # Source type names
    options: Dict[str, Any] = Field(default_factory=dict)

class SimplePreviewRequest(BaseModel):
    """Simplified preview request (frontend-compatible)."""
    data: List[Dict[str, Any]] = Field(..., min_length=1, max_length=100)
    sources: List[str] = Field(..., min_length=1, max_length=10)  # Source type names
    sample_size: int = Field(default=5, ge=1, le=10)

# Template Schemas (from schemas/templates)

class TemplateImportResult(BaseModel):
    template_id: str
    name: str
    kind: str
    artifacts: dict
    correlation_id: Optional[str] = None

# ANALYTICS_SCHEMAS

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# Analytics Schemas (from schemas/analytics/analytics.py)

class DataPoint(BaseModel):
    """A single data point with timestamp and value."""
    timestamp: Optional[datetime] = None
    index: Optional[int] = None
    value: float
    label: Optional[str] = None

class DataSeries(BaseModel):
    """A time series or data series."""
    name: str
    values: List[float]
    timestamps: Optional[List[datetime]] = None
    labels: Optional[List[str]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

# Insights

class InsightType(str, Enum):
    """Types of insights that can be generated."""
    SUMMARY = "summary"
    TREND = "trend"
    ANOMALY = "anomaly"
    CORRELATION = "correlation"
    COMPARISON = "comparison"
    DISTRIBUTION = "distribution"
    RANKING = "ranking"
    MILESTONE = "milestone"

class InsightSeverity(str, Enum):
    """Severity/importance of an insight."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class Insight(BaseModel):
    """A generated insight."""
    id: str
    type: InsightType
    title: str
    description: str
    severity: InsightSeverity = InsightSeverity.MEDIUM
    confidence: float = Field(ge=0.0, le=1.0)
    related_columns: List[str] = Field(default_factory=list)
    data: Optional[Dict[str, Any]] = None
    visualization_hint: Optional[str] = None  # e.g., "line_chart", "bar_chart"

class InsightsRequest(BaseModel):
    """Request for generating insights."""
    data: List[DataSeries]
    columns: Optional[List[str]] = None
    max_insights: int = Field(default=10, ge=1, le=50)
    insight_types: Optional[List[InsightType]] = None
    time_column: Optional[str] = None
    context: Optional[str] = None  # Business context for better insights

class InsightsResponse(BaseModel):
    """Response containing generated insights."""
    insights: List[Insight]
    summary: str
    data_quality_score: float = Field(ge=0.0, le=1.0)
    processing_time_ms: int

# Trends

class TrendDirection(str, Enum):
    """Direction of a trend."""
    UP = "up"
    DOWN = "down"
    STABLE = "stable"
    VOLATILE = "volatile"

class ForecastMethod(str, Enum):
    """Methods for forecasting."""
    LINEAR = "linear"
    EXPONENTIAL = "exponential"
    ARIMA = "arima"
    PROPHET = "prophet"
    HOLT_WINTERS = "holt_winters"
    AUTO = "auto"

class TrendResult(BaseModel):
    """Result of trend analysis."""
    direction: TrendDirection
    slope: float
    strength: float = Field(ge=0.0, le=1.0)
    seasonality: Optional[str] = None  # e.g., "daily", "weekly", "monthly"
    change_points: List[int] = Field(default_factory=list)
    description: str

class ForecastPoint(BaseModel):
    """A forecasted point with confidence interval."""
    timestamp: Optional[datetime] = None
    index: int
    predicted: float
    lower_bound: float
    upper_bound: float

class TrendRequest(BaseModel):
    """Request for trend analysis and forecasting."""
    data: DataSeries
    forecast_periods: int = Field(default=10, ge=1, le=365)
    method: ForecastMethod = ForecastMethod.AUTO
    confidence_level: float = Field(default=0.95, ge=0.5, le=0.99)
    detect_seasonality: bool = True
    detect_change_points: bool = True

class TrendResponse(BaseModel):
    """Response containing trend analysis and forecast."""
    trend: TrendResult
    forecast: List[ForecastPoint]
    model_accuracy: float = Field(ge=0.0, le=1.0)
    method_used: ForecastMethod
    processing_time_ms: int

# Anomalies

class AnomalyType(str, Enum):
    """Types of anomalies."""
    POINT = "point"  # Single point anomaly
    CONTEXTUAL = "contextual"  # Anomaly given context
    COLLECTIVE = "collective"  # Pattern anomaly
    TREND = "trend"  # Sudden trend change

class AnomalySeverity(str, Enum):
    """Severity of anomaly."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class Anomaly(BaseModel):
    """A detected anomaly."""
    id: str
    type: AnomalyType
    severity: AnomalySeverity
    index: int
    timestamp: Optional[datetime] = None
    value: float
    expected_value: float
    deviation: float  # Standard deviations from expected
    description: str
    possible_causes: List[str] = Field(default_factory=list)

class AnomaliesRequest(BaseModel):
    """Request for anomaly detection."""
    data: DataSeries
    sensitivity: float = Field(default=0.95, ge=0.5, le=0.999)
    min_severity: AnomalySeverity = AnomalySeverity.LOW
    context_window: int = Field(default=10, ge=3, le=100)
    detect_collective: bool = True

class AnomaliesResponse(BaseModel):
    """Response containing detected anomalies."""
    anomalies: List[Anomaly]
    anomaly_rate: float  # Percentage of data points that are anomalies
    baseline_stats: Dict[str, float]  # mean, std, etc.
    processing_time_ms: int

# Correlations

class CorrelationType(str, Enum):
    """Types of correlation."""
    PEARSON = "pearson"
    SPEARMAN = "spearman"
    KENDALL = "kendall"

class CorrelationStrength(str, Enum):
    """Strength of correlation."""
    STRONG_POSITIVE = "strong_positive"
    MODERATE_POSITIVE = "moderate_positive"
    WEAK_POSITIVE = "weak_positive"
    NONE = "none"
    WEAK_NEGATIVE = "weak_negative"
    MODERATE_NEGATIVE = "moderate_negative"
    STRONG_NEGATIVE = "strong_negative"

class CorrelationPair(BaseModel):
    """Correlation between two variables."""
    variable_a: str
    variable_b: str
    correlation: float = Field(ge=-1.0, le=1.0)
    p_value: float
    strength: CorrelationStrength
    significant: bool
    description: str

class CorrelationsRequest(BaseModel):
    """Request for correlation analysis."""
    data: List[DataSeries]
    method: CorrelationType = CorrelationType.PEARSON
    min_correlation: float = Field(default=0.3, ge=0.0, le=1.0)
    significance_level: float = Field(default=0.05, ge=0.01, le=0.1)

class CorrelationsResponse(BaseModel):
    """Response containing correlation analysis."""
    correlations: List[CorrelationPair]
    correlation_matrix: Dict[str, Dict[str, float]]
    strongest_positive: Optional[CorrelationPair] = None
    strongest_negative: Optional[CorrelationPair] = None
    processing_time_ms: int

# What-If Analysis

class WhatIfScenario(BaseModel):
    """A what-if scenario definition."""
    name: str
    variable: str
    change_type: str  # "absolute", "percentage", "value"
    change_value: float

class WhatIfResult(BaseModel):
    """Result of a what-if scenario."""
    scenario_name: str
    original_value: float
    projected_value: float
    change: float
    change_percentage: float
    confidence: float = Field(ge=0.0, le=1.0)
    affected_metrics: Dict[str, float] = Field(default_factory=dict)

class WhatIfRequest(BaseModel):
    """Request for what-if analysis."""
    data: List[DataSeries]
    target_variable: str
    scenarios: List[WhatIfScenario]
    model_type: str = "linear"  # linear, polynomial, neural

class WhatIfResponse(BaseModel):
    """Response containing what-if analysis results."""
    results: List[WhatIfResult]
    baseline: float
    model_r_squared: float
    processing_time_ms: int

# Spreadsheet Schemas (from schemas/spreadsheets/spreadsheet.py)

# Spreadsheet CRUD Schemas

class CreateSpreadsheetRequest(BaseModel):
    """Request to create a new spreadsheet."""

    name: str = Field(..., min_length=1, max_length=255)
    initial_data: Optional[list[list[Any]]] = None

class UpdateSpreadsheetRequest(BaseModel):
    """Request to update spreadsheet metadata."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    metadata: Optional[dict[str, Any]] = None

class CellFormat(BaseModel):
    """Cell formatting options."""

    bold: bool = False
    italic: bool = False
    underline: bool = False
    font_size: int = 11
    font_color: str = "#000000"
    background_color: Optional[str] = None
    horizontal_align: str = "left"
    vertical_align: str = "middle"
    number_format: Optional[str] = None

class SheetResponse(BaseModel):
    """Sheet response model."""

    id: str
    name: str
    index: int
    row_count: int
    col_count: int
    frozen_rows: int
    frozen_cols: int

class SpreadsheetResponse(BaseModel):
    """Spreadsheet response model."""

    id: str
    name: str
    sheets: list[SheetResponse]
    created_at: str
    updated_at: str
    owner_id: Optional[str]
    metadata: dict[str, Any]

class SpreadsheetListResponse(BaseModel):
    """List of spreadsheets response."""

    spreadsheets: list[SpreadsheetResponse]
    total: int
    offset: int
    limit: int

class SpreadsheetDataResponse(BaseModel):
    """Spreadsheet with full data response."""

    id: str
    name: str
    sheet_id: str
    sheet_name: str
    data: list[list[Any]]
    formats: dict[str, CellFormat]
    column_widths: dict[int, int]
    row_heights: dict[int, int]
    frozen_rows: int
    frozen_cols: int

# Cell Operations

class CellUpdate(BaseModel):
    """Single cell update."""

    row: int = Field(..., ge=0)
    col: int = Field(..., ge=0)
    value: Any

class CellUpdateRequest(BaseModel):
    """Request to update cells."""

    updates: list[CellUpdate] = Field(..., min_length=1, max_length=10000)

class CellFormatRequest(BaseModel):
    """Request to format cells."""

    range: str = Field(..., pattern=r"^[A-Z]+[0-9]+:[A-Z]+[0-9]+$")
    format: CellFormat

# Sheet Operations

class AddSheetRequest(BaseModel):
    """Request to add a new sheet."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)

class RenameSheetRequest(BaseModel):
    """Request to rename a sheet."""

    name: str = Field(..., min_length=1, max_length=100)

class FreezePanesRequest(BaseModel):
    """Request to freeze panes."""

    rows: int = Field(default=0, ge=0, le=100)
    cols: int = Field(default=0, ge=0, le=26)

# Conditional Formatting

class ConditionalFormatRule(BaseModel):
    """Conditional format rule."""

    type: str = Field(..., pattern="^(greaterThan|lessThan|equals|between|text|custom)$")
    value: Any
    value2: Optional[Any] = None
    format: CellFormat

class ConditionalFormatRequest(BaseModel):
    """Request to add conditional formatting."""

    range: str = Field(..., pattern=r"^[A-Z]+[0-9]+:[A-Z]+[0-9]+$")
    rules: list[ConditionalFormatRule] = Field(..., min_length=1)

# Data Validation

class DataValidationRequest(BaseModel):
    """Request to add data validation."""

    range: str = Field(..., pattern=r"^[A-Z]+[0-9]+:[A-Z]+[0-9]+$")
    type: str = Field(..., pattern="^(list|number|date|text|custom)$")
    criteria: str = Field(default="equals")
    value: Any
    value2: Optional[Any] = None
    allow_blank: bool = True
    show_dropdown: bool = True
    error_message: Optional[str] = None

# Import/Export

class ImportRequest(BaseModel):
    """Request to import data."""

    format: str = Field(default="csv", pattern="^(csv|tsv|xlsx|xls)$")
    delimiter: str = Field(default=",", max_length=1)
    has_headers: bool = True

class SpreadsheetExportRequest(BaseModel):
    """Request to export data."""

    format: str = Field(default="csv", pattern="^(csv|tsv|xlsx)$")
    sheet_index: int = Field(default=0, ge=0)
    delimiter: str = Field(default=",", max_length=1)

# Keep the original name as an alias for backward compatibility
ExportRequest = SpreadsheetExportRequest

class ExportResponse(BaseModel):
    """Export response."""

    content: str
    filename: str
    mime_type: str

# Pivot Tables

class PivotValue(BaseModel):
    """Pivot table value aggregation."""

    field: str
    aggregation: str = Field(default="SUM", pattern="^(SUM|COUNT|AVERAGE|MIN|MAX|COUNTUNIQUE)$")
    alias: Optional[str] = None

class PivotFilter(BaseModel):
    """Pivot table filter."""

    field: str
    values: list[Any]
    exclude: bool = False

class PivotTableRequest(BaseModel):
    """Request to create pivot table."""

    name: str = Field(default="PivotTable1")
    source_range: str = Field(..., pattern=r"^[A-Z]+[0-9]+:[A-Z]+[0-9]+$")
    row_fields: list[str] = Field(default=[])
    column_fields: list[str] = Field(default=[])
    value_fields: list[PivotValue] = Field(..., min_length=1)
    filters: list[PivotFilter] = Field(default=[])
    show_grand_totals: bool = True
    show_row_totals: bool = True
    show_col_totals: bool = True

class PivotTableResponse(BaseModel):
    """Pivot table response."""

    id: str
    name: str
    headers: list[str]
    rows: list[list[Any]]
    column_totals: Optional[list[Any]]
    grand_total: Optional[Any]

# AI Features

class AIFormulaRequest(BaseModel):
    """Request for natural language to formula conversion."""

    description: str = Field(..., min_length=5, max_length=500)
    available_columns: list[str] = Field(default=[])
    sheet_context: Optional[str] = None

class AIFormulaResponse(BaseModel):
    """AI formula response."""

    formula: str
    explanation: str
    example_result: Optional[str] = None
    confidence: float = 1.0
    alternatives: list[str] = []

class AICleanRequest(BaseModel):
    """Request for AI data cleaning suggestions."""

    sample_data: list[list[Any]] = Field(..., min_length=2)
    columns: list[str] = Field(default=[])

class AICleanResponse(BaseModel):
    """AI data cleaning response."""

    issues: list[dict[str, Any]]
    suggestions: list[dict[str, Any]]
    cleaned_data: Optional[list[list[Any]]] = None

class AIAnomalyRequest(BaseModel):
    """Request for anomaly detection."""

    column: str
    data: list[Any]
    method: str = Field(default="zscore", pattern="^(zscore|iqr|isolation_forest)$")

class AIAnomalyResponse(BaseModel):
    """Anomaly detection response."""

    anomalies: list[dict[str, Any]]
    statistics: dict[str, float]
    narrative: str

class AIExplainFormulaRequest(BaseModel):
    """Request to explain a formula."""

    formula: str = Field(..., min_length=2)

class AIExplainFormulaResponse(BaseModel):
    """Formula explanation response."""

    formula: str
    explanation: str
    step_by_step: list[str]
    functions_used: list[dict[str, str]]

# CONTENT

import re
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.app.utils import is_safe_external_url

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

def _validate_hex(v: str) -> str:
    if not _HEX_COLOR_RE.match(v):
        raise ValueError(f"Invalid hex color: {v}. Must be in format #RRGGBB")
    return v

# Brand Kit / Design Schemas (from schemas/design/brand_kit.py)

class BrandColor(BaseModel):
    """A brand color definition."""
    name: str
    hex: str
    rgb: Optional[tuple[int, int, int]] = None

class Typography(BaseModel):
    """Typography settings."""
    font_family: str = "Inter"
    heading_font: Optional[str] = None
    body_font: Optional[str] = None
    code_font: str = "Source Code Pro"
    base_size: int = 16
    scale_ratio: float = 1.25

class BrandKitCreate(BaseModel):
    """Request to create a brand kit."""
    name: str
    description: Optional[str] = None
    logo_url: Optional[str] = None
    logo_dark_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: str = "#1976d2"
    secondary_color: str = "#dc004e"
    accent_color: str = "#ff9800"
    text_color: str = "#333333"
    background_color: str = "#ffffff"
    colors: list[BrandColor] = Field(default_factory=list)
    typography: Typography = Field(default_factory=Typography)

    @field_validator("primary_color", "secondary_color", "accent_color", "text_color", "background_color")
    @classmethod
    def validate_hex_color(cls, v: str) -> str:
        return _validate_hex(v)

class BrandKitUpdate(BaseModel):
    """Request to update a brand kit."""
    name: Optional[str] = None
    description: Optional[str] = None
    logo_url: Optional[str] = None
    logo_dark_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    accent_color: Optional[str] = None
    text_color: Optional[str] = None
    background_color: Optional[str] = None
    colors: Optional[list[BrandColor]] = None
    typography: Optional[Typography] = None

    @field_validator("primary_color", "secondary_color", "accent_color", "text_color", "background_color")
    @classmethod
    def validate_hex_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return _validate_hex(v)
        return v

class BrandKitResponse(BaseModel):
    """Brand kit response model."""
    id: str
    name: str
    description: Optional[str]
    logo_url: Optional[str]
    logo_dark_url: Optional[str]
    favicon_url: Optional[str]
    primary_color: str
    secondary_color: str
    accent_color: str
    text_color: str
    background_color: str
    colors: list[BrandColor]
    typography: Typography
    created_at: datetime
    updated_at: datetime
    is_default: bool = False

class ThemeCreate(BaseModel):
    """Request to create a theme."""
    name: str
    description: Optional[str] = None
    brand_kit_id: Optional[str] = None
    mode: str = "light"  # light, dark, auto
    colors: dict[str, str] = Field(default_factory=dict)
    typography: dict[str, Any] = Field(default_factory=dict)
    spacing: dict[str, Any] = Field(default_factory=dict)
    borders: dict[str, Any] = Field(default_factory=dict)
    shadows: dict[str, Any] = Field(default_factory=dict)

class ThemeUpdate(BaseModel):
    """Request to update a theme."""
    name: Optional[str] = None
    description: Optional[str] = None
    brand_kit_id: Optional[str] = None
    mode: Optional[str] = None
    colors: Optional[dict[str, str]] = None
    typography: Optional[dict[str, Any]] = None
    spacing: Optional[dict[str, Any]] = None
    borders: Optional[dict[str, Any]] = None
    shadows: Optional[dict[str, Any]] = None

class ThemeResponse(BaseModel):
    """Theme response model."""
    id: str
    name: str
    description: Optional[str]
    brand_kit_id: Optional[str]
    mode: str
    colors: dict[str, str]
    typography: dict[str, Any]
    spacing: dict[str, Any]
    borders: dict[str, Any]
    shadows: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    is_active: bool = False

class ColorPaletteRequest(BaseModel):
    """Request to generate a color palette."""
    base_color: str
    harmony_type: str = "complementary"  # complementary, analogous, triadic, split-complementary, tetradic
    count: int = 5

class ColorPaletteResponse(BaseModel):
    """Generated color palette."""
    base_color: str
    harmony_type: str
    colors: list[BrandColor]

class ApplyBrandKitRequest(BaseModel):
    """Request to apply brand kit to a document."""
    document_id: str
    elements: list[str] = Field(default_factory=list)  # Which elements to apply to

# Color utility schemas

class ColorContrastRequest(BaseModel):
    """Request to compute WCAG contrast ratio between two colors."""
    color1: str
    color2: str

class ColorContrastResponse(BaseModel):
    """WCAG contrast ratio result."""
    color1: str
    color2: str
    contrast_ratio: float
    wcag_aa_normal: bool
    wcag_aa_large: bool
    wcag_aaa_normal: bool
    wcag_aaa_large: bool

class AccessibleColorsRequest(BaseModel):
    """Request to suggest accessible text colors for a background."""
    background_color: str

class AccessibleColorSuggestion(BaseModel):
    """A single accessible color suggestion."""
    hex: str
    label: str
    contrast_ratio: float

class AccessibleColorsResponse(BaseModel):
    """Suggested accessible text colors for a background."""
    background_color: str
    colors: list[AccessibleColorSuggestion]

# Typography schemas

class FontInfo(BaseModel):
    """Information about a font."""
    name: str
    category: str  # serif, sans-serif, monospace, display, handwriting
    weights: list[int] = Field(default_factory=lambda: [400, 700])

class FontPairing(BaseModel):
    """A font pairing suggestion."""
    font: str
    category: str
    reason: str

class FontPairingsResponse(BaseModel):
    """Font pairing suggestions for a primary font."""
    primary: str
    pairings: list[FontPairing]

# Asset schemas

class AssetResponse(BaseModel):
    """An uploaded design asset."""
    id: str
    filename: str
    brand_kit_id: str
    asset_type: str  # logo, icon, image
    size_bytes: int
    created_at: datetime

# Import / Export schemas

class BrandKitExport(BaseModel):
    """Exported brand kit data."""
    format: str = "json"
    brand_kit: BrandKitResponse

# Export / Distribution Schemas (from schemas/export/export.py)

class ExportFormat(str, Enum):
    """Supported export formats."""
    PDF = "pdf"
    PDFA = "pdfa"
    DOCX = "docx"
    XLSX = "xlsx"
    PPTX = "pptx"
    EPUB = "epub"
    LATEX = "latex"
    MARKDOWN = "markdown"
    HTML = "html"
    PNG = "png"
    JPG = "jpg"
    TEXT = "text"

class DistributionChannel(str, Enum):
    """Distribution channels."""
    EMAIL = "email"
    SLACK = "slack"
    TEAMS = "teams"
    WEBHOOK = "webhook"
    PORTAL = "portal"
    EMBED = "embed"

class ExportStatus(str, Enum):
    """Export job status."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class ExportOptions(BaseModel):
    """Common export options."""
    quality: str = "high"  # low, medium, high
    include_metadata: bool = True
    include_toc: bool = False
    password: Optional[str] = None

class PDFExportOptions(ExportOptions):
    """PDF-specific export options."""
    pdfa_compliant: bool = False
    watermark: Optional[str] = None
    header: Optional[str] = None
    footer: Optional[str] = None
    page_numbers: bool = True
    compress_images: bool = True

class DocxExportOptions(ExportOptions):
    """Word document export options."""
    track_changes: bool = False
    template_path: Optional[str] = None

class PptxExportOptions(ExportOptions):
    """PowerPoint export options."""
    slide_layout: str = "title_and_content"
    include_speaker_notes: bool = False

class EpubExportOptions(ExportOptions):
    """ePub export options."""
    cover_image: Optional[str] = None
    author: Optional[str] = None
    publisher: Optional[str] = None
    isbn: Optional[str] = None

class LatexExportOptions(ExportOptions):
    """LaTeX export options."""
    document_class: str = "article"
    packages: list[str] = Field(default_factory=list)
    bibliography_style: Optional[str] = None

class MarkdownExportOptions(ExportOptions):
    """Markdown export options."""
    flavor: str = "gfm"  # gfm, commonmark, pandoc
    include_frontmatter: bool = True
    image_handling: str = "embed"  # embed, link, download

class ExportExportRequest(BaseModel):
    """Request to export a document."""
    document_id: str
    format: ExportFormat
    options: dict[str, Any] = Field(default_factory=dict)
    filename: Optional[str] = None

# Keep the original name as alias
ExportRequest = ExportExportRequest

class BulkExportRequest(BaseModel):
    """Request to export multiple documents."""
    document_ids: list[str] = Field(..., min_length=1, max_length=100)
    format: ExportFormat
    options: dict[str, Any] = Field(default_factory=dict)
    zip_filename: Optional[str] = None

class ExportResponse(BaseModel):
    """Export response."""
    job_id: str
    status: ExportStatus
    format: ExportFormat
    document_id: str
    download_url: Optional[str] = None
    file_size: Optional[int] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None

class DistributionRequest(BaseModel):
    """Request to distribute a document."""
    document_id: str
    channel: DistributionChannel
    recipients: list[str] = Field(default_factory=list)
    message: Optional[str] = None
    subject: Optional[str] = None
    schedule_at: Optional[datetime] = None
    options: dict[str, Any] = Field(default_factory=dict)

class EmailCampaignRequest(BaseModel):
    """Request for bulk email distribution."""
    document_ids: list[str] = Field(..., min_length=1, max_length=50)
    recipients: list[str] = Field(..., min_length=1, max_length=500)
    subject: str = Field(..., min_length=1, max_length=500)
    message: str = Field(..., max_length=10_000)
    from_name: Optional[str] = None
    reply_to: Optional[str] = None
    attach_documents: bool = True
    track_opens: bool = True

class PortalPublishRequest(BaseModel):
    """Request to publish document to portal."""
    document_id: str
    portal_path: str
    title: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    public: bool = False
    password: Optional[str] = None
    expires_at: Optional[datetime] = None

class EmbedGenerateRequest(BaseModel):
    """Request to generate embed code."""
    document_id: str
    width: int = 800
    height: int = 600
    allow_download: bool = False
    allow_print: bool = False
    show_toolbar: bool = True
    theme: str = "light"

class EmbedResponse(BaseModel):
    """Embed code response."""
    embed_code: str
    embed_url: str
    token: str
    expires_at: Optional[datetime] = None

class WebhookDeliveryRequest(BaseModel):
    """Request to deliver via webhook."""
    document_id: str
    webhook_url: str
    method: str = "POST"
    headers: dict[str, str] = Field(default_factory=dict)
    include_content: bool = True
    payload_template: Optional[str] = None

    @field_validator("webhook_url")
    @classmethod
    def validate_webhook_url(cls, v: str) -> str:
        is_safe, error = is_safe_external_url(v)
        if not is_safe:
            raise ValueError(f"Unsafe webhook URL: {error}")
        return v

class SlackMessageRequest(BaseModel):
    """Request to send to Slack."""
    document_id: str
    channel: str
    message: Optional[str] = None
    thread_ts: Optional[str] = None
    upload_file: bool = True

class TeamsMessageRequest(BaseModel):
    """Request to send to Microsoft Teams."""
    document_id: str
    webhook_url: str
    title: Optional[str] = None
    message: Optional[str] = None
    mention_users: list[str] = Field(default_factory=list)

    @field_validator("webhook_url")
    @classmethod
    def validate_webhook_url(cls, v: str) -> str:
        is_safe, error = is_safe_external_url(v)
        if not is_safe:
            raise ValueError(f"Unsafe webhook URL: {error}")
        return v

class DistributionResponse(BaseModel):
    """Distribution response."""
    job_id: str
    channel: DistributionChannel
    status: str
    recipients_count: int
    sent_at: Optional[datetime] = None
    error: Optional[str] = None

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

class DocumentCategory(str, Enum):
    """Document classification categories."""
    INVOICE = "invoice"
    CONTRACT = "contract"
    RESUME = "resume"
    RECEIPT = "receipt"
    REPORT = "report"
    LETTER = "letter"
    FORM = "form"
    PRESENTATION = "presentation"
    SPREADSHEET = "spreadsheet"
    OTHER = "other"

class ConfidenceLevel(str, Enum):
    """Confidence level for extracted data."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

# Invoice Parsing Schemas

class InvoiceLineItem(BaseModel):
    """Line item from an invoice."""
    description: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    amount: float
    tax: Optional[float] = None
    confidence: ConfidenceLevel = ConfidenceLevel.MEDIUM

class InvoiceAddress(BaseModel):
    """Address structure for invoice parties."""
    name: Optional[str] = None
    street: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

class InvoiceParseRequest(BaseModel):
    """Request to parse an invoice."""
    file_path: Optional[str] = None
    content: Optional[str] = None  # Base64 encoded
    extract_line_items: bool = True
    extract_addresses: bool = True
    language: str = "en"

class InvoiceParseResponse(BaseModel):
    """Parsed invoice data."""
    invoice_number: Optional[str] = None
    invoice_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    vendor: Optional[InvoiceAddress] = None
    bill_to: Optional[InvoiceAddress] = None
    ship_to: Optional[InvoiceAddress] = None
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    subtotal: Optional[float] = None
    tax_total: Optional[float] = None
    discount: Optional[float] = None
    total: Optional[float] = None
    currency: str = "USD"
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    raw_text: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    processing_time_ms: int

# Contract Analysis Schemas

class ContractClauseType(str, Enum):
    """Types of contract clauses."""
    TERMINATION = "termination"
    INDEMNIFICATION = "indemnification"
    LIMITATION_OF_LIABILITY = "limitation_of_liability"
    CONFIDENTIALITY = "confidentiality"
    INTELLECTUAL_PROPERTY = "intellectual_property"
    FORCE_MAJEURE = "force_majeure"
    GOVERNING_LAW = "governing_law"
    DISPUTE_RESOLUTION = "dispute_resolution"
    ASSIGNMENT = "assignment"
    AMENDMENT = "amendment"
    SEVERABILITY = "severability"
    NOTICE = "notice"
    PAYMENT = "payment"
    WARRANTY = "warranty"
    INSURANCE = "insurance"
    OTHER = "other"

class RiskLevel(str, Enum):
    """Risk assessment levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFORMATIONAL = "informational"

class ContractClause(BaseModel):
    """Extracted contract clause."""
    clause_type: ContractClauseType
    title: str
    text: str
    page_number: Optional[int] = None
    start_position: Optional[int] = None
    end_position: Optional[int] = None
    risk_level: RiskLevel = RiskLevel.INFORMATIONAL
    risk_explanation: Optional[str] = None
    suggestions: List[str] = Field(default_factory=list)
    confidence: ConfidenceLevel = ConfidenceLevel.MEDIUM

class ContractParty(BaseModel):
    """Party to a contract."""
    name: str
    role: str  # e.g., "Buyer", "Seller", "Licensor"
    address: Optional[str] = None
    contact: Optional[str] = None

class ContractAnalyzeRequest(BaseModel):
    """Request to analyze a contract."""
    file_path: Optional[str] = None
    content: Optional[str] = None  # Base64 encoded
    analyze_risks: bool = True
    extract_obligations: bool = True
    compare_to_standard: bool = False
    language: str = "en"

class ContractObligation(BaseModel):
    """Obligation extracted from contract."""
    party: str
    obligation: str
    deadline: Optional[str] = None
    penalty: Optional[str] = None
    clause_reference: Optional[str] = None

class ContractAnalyzeResponse(BaseModel):
    """Analyzed contract data."""
    title: Optional[str] = None
    contract_type: Optional[str] = None
    effective_date: Optional[datetime] = None
    expiration_date: Optional[datetime] = None
    parties: List[ContractParty] = Field(default_factory=list)
    clauses: List[ContractClause] = Field(default_factory=list)
    obligations: List[ContractObligation] = Field(default_factory=list)
    key_dates: Dict[str, datetime] = Field(default_factory=dict)
    total_value: Optional[float] = None
    currency: Optional[str] = None
    risk_summary: Dict[str, int] = Field(default_factory=dict)
    overall_risk_level: RiskLevel = RiskLevel.INFORMATIONAL
    recommendations: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    processing_time_ms: int

# Resume Parsing Schemas

class Education(BaseModel):
    """Education entry from resume."""
    institution: str
    degree: Optional[str] = None
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    gpa: Optional[float] = None
    honors: Optional[str] = None

class WorkExperience(BaseModel):
    """Work experience entry from resume."""
    company: str
    title: str
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_current: bool = False
    description: Optional[str] = None
    achievements: List[str] = Field(default_factory=list)

class ResumeParseRequest(BaseModel):
    """Request to parse a resume."""
    file_path: Optional[str] = None
    content: Optional[str] = None  # Base64 encoded
    extract_skills: bool = True
    match_job_description: Optional[str] = None
    language: str = "en"

class ResumeParseResponse(BaseModel):
    """Parsed resume data."""
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    summary: Optional[str] = None
    education: List[Education] = Field(default_factory=list)
    experience: List[WorkExperience] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    total_years_experience: Optional[float] = None
    job_match_score: Optional[float] = None
    job_match_details: Optional[Dict[str, Any]] = None
    raw_text: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    processing_time_ms: int

# Receipt Scanning Schemas

class ReceiptItem(BaseModel):
    """Item from a receipt."""
    name: str
    quantity: float = 1.0
    unit_price: Optional[float] = None
    total_price: float
    category: Optional[str] = None

class ReceiptScanRequest(BaseModel):
    """Request to scan a receipt."""
    file_path: Optional[str] = None
    content: Optional[str] = None  # Base64 encoded
    categorize_items: bool = True
    language: str = "en"

class ReceiptScanResponse(BaseModel):
    """Scanned receipt data."""
    merchant_name: Optional[str] = None
    merchant_address: Optional[str] = None
    merchant_phone: Optional[str] = None
    date: Optional[datetime] = None
    time: Optional[str] = None
    items: List[ReceiptItem] = Field(default_factory=list)
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    tip: Optional[float] = None
    total: float
    payment_method: Optional[str] = None
    card_last_four: Optional[str] = None
    currency: str = "USD"
    category: Optional[str] = None
    raw_text: Optional[str] = None
    confidence_score: float = Field(ge=0.0, le=1.0)
    processing_time_ms: int

# Document Classification Schemas

class ClassifyRequest(BaseModel):
    """Request to classify a document."""
    file_path: Optional[str] = None
    content: Optional[str] = None  # Base64 encoded
    categories: Optional[List[str]] = None  # Custom categories

class ClassifyResponse(BaseModel):
    """Document classification result."""
    category: DocumentCategory
    confidence: float = Field(ge=0.0, le=1.0)
    all_scores: Dict[str, float] = Field(default_factory=dict)
    suggested_parsers: List[str] = Field(default_factory=list)
    processing_time_ms: int

# Entity Extraction Schemas

class EntityType(str, Enum):
    """Named entity types."""
    PERSON = "person"
    ORGANIZATION = "organization"
    LOCATION = "location"
    DATE = "date"
    MONEY = "money"
    PERCENTAGE = "percentage"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    ADDRESS = "address"
    PRODUCT = "product"
    EVENT = "event"

class ExtractedEntity(BaseModel):
    """An extracted named entity."""
    text: str
    entity_type: EntityType
    start: int
    end: int
    confidence: float = Field(ge=0.0, le=1.0)
    normalized_value: Optional[str] = None

class EntityExtractRequest(BaseModel):
    """Request to extract entities."""
    file_path: Optional[str] = None
    content: Optional[str] = None
    text: Optional[str] = None
    entity_types: Optional[List[EntityType]] = None

class EntityExtractResponse(BaseModel):
    """Entity extraction result."""
    entities: List[ExtractedEntity] = Field(default_factory=list)
    entity_counts: Dict[str, int] = Field(default_factory=dict)
    processing_time_ms: int

# Semantic Search Schemas

class SemanticSearchRequest(BaseModel):
    """Request for semantic search."""
    query: str
    document_ids: Optional[List[str]] = None
    top_k: int = Field(default=10, ge=1, le=100)
    threshold: float = Field(default=0.5, ge=0.0, le=1.0)

class SearchResult(BaseModel):
    """A semantic search result."""
    document_id: str
    chunk_text: str
    score: float
    page_number: Optional[int] = None
    section: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class SemanticSearchResponse(BaseModel):
    """Semantic search results."""
    query: str
    results: List[SearchResult] = Field(default_factory=list)
    total_results: int
    processing_time_ms: int

# Document Comparison Schemas

class DiffType(str, Enum):
    """Types of differences in document comparison."""
    ADDITION = "addition"
    DELETION = "deletion"
    MODIFICATION = "modification"

class DocumentDiff(BaseModel):
    """A difference between documents."""
    diff_type: DiffType
    section: Optional[str] = None
    original_text: Optional[str] = None
    modified_text: Optional[str] = None
    page_number: Optional[int] = None
    significance: str = "low"  # low, medium, high

class CompareRequest(BaseModel):
    """Request to compare documents."""
    document_a_path: Optional[str] = None
    document_a_content: Optional[str] = None
    document_b_path: Optional[str] = None
    document_b_content: Optional[str] = None
    highlight_changes: bool = True
    semantic_comparison: bool = False

class CompareResponse(BaseModel):
    """Document comparison result."""
    similarity_score: float = Field(ge=0.0, le=1.0)
    differences: List[DocumentDiff] = Field(default_factory=list)
    summary: str
    significant_changes: List[str] = Field(default_factory=list)
    processing_time_ms: int

# Compliance Check Schemas

class ComplianceRule(BaseModel):
    """A compliance rule."""
    rule_id: str
    name: str
    description: str
    regulation: str  # e.g., "GDPR", "HIPAA", "SOC2"

class ComplianceViolation(BaseModel):
    """A compliance violation."""
    rule: ComplianceRule
    location: str
    description: str
    severity: RiskLevel
    remediation: str

class ComplianceCheckRequest(BaseModel):
    """Request to check compliance."""
    file_path: Optional[str] = None
    content: Optional[str] = None
    regulations: List[str] = Field(default_factory=list)  # e.g., ["GDPR", "HIPAA"]

class ComplianceCheckResponse(BaseModel):
    """Compliance check result."""
    compliant: bool
    violations: List[ComplianceViolation] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)
    checked_regulations: List[str] = Field(default_factory=list)
    processing_time_ms: int

# Multi-document Summary Schemas

class MultiDocSummarizeRequest(BaseModel):
    """Request to summarize multiple documents."""
    document_ids: List[str]
    max_length: int = Field(default=500, ge=100, le=2000)
    focus_topics: Optional[List[str]] = None
    include_sources: bool = True

class SummarySource(BaseModel):
    """Source reference in summary."""
    document_id: str
    document_title: Optional[str] = None
    page_number: Optional[int] = None
    excerpt: str

class MultiDocSummarizeResponse(BaseModel):
    """Multi-document summary result."""
    summary: str
    key_points: List[str] = Field(default_factory=list)
    common_themes: List[str] = Field(default_factory=list)
    sources: List[SummarySource] = Field(default_factory=list)
    document_count: int
    processing_time_ms: int

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

# Document CRUD Schemas (from schemas/documents/document.py)

class DocumentContent(BaseModel):
    """TipTap document content structure."""

    type: str = "doc"
    content: list[dict[str, Any]] = []

class CreateDocumentRequest(BaseModel):
    """Request to create a new document."""

    name: str = Field(..., min_length=1, max_length=255)
    content: Optional[DocumentContent] = None
    is_template: bool = False
    tags: list[str] = []
    metadata: dict[str, Any] = {}

class UpdateDocumentRequest(BaseModel):
    """Request to update a document."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    content: Optional[DocumentContent] = None
    tags: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None
    track_changes_enabled: Optional[bool] = None

class DocumentResponse(BaseModel):
    """Document response model."""

    id: str
    name: str
    content: DocumentContent
    content_type: str
    version: int
    created_at: str
    updated_at: str
    owner_id: Optional[str]
    is_template: bool
    track_changes_enabled: bool
    collaboration_enabled: bool
    tags: list[str]
    metadata: dict[str, Any]

class DocumentListResponse(BaseModel):
    """List of documents response."""

    documents: list[DocumentResponse]
    total: int
    offset: int
    limit: int

class DocumentVersionResponse(BaseModel):
    """Document version response."""

    id: str
    document_id: str
    version: int
    content: DocumentContent
    created_at: str
    created_by: Optional[str]
    change_summary: Optional[str]

# Comment Schemas

class CommentRequest(BaseModel):
    """Request to add a comment."""

    selection_start: int = Field(..., ge=0)
    selection_end: int = Field(..., ge=0)
    text: str = Field(..., min_length=1, max_length=5000)

class CommentResponse(BaseModel):
    """Comment response model."""

    id: str
    document_id: str
    selection_start: int
    selection_end: int
    text: str
    author_id: Optional[str]
    author_name: Optional[str]
    created_at: str
    resolved: bool
    replies: list["CommentResponse"] = []

class ResolveCommentRequest(BaseModel):
    """Request to resolve a comment."""

    resolved: bool = True

# Collaboration Schemas

class StartCollaborationRequest(BaseModel):
    """Request to start collaboration session."""

    user_name: Optional[str] = None

class CollaborationSessionResponse(BaseModel):
    """Collaboration session response."""

    id: str
    document_id: str
    websocket_url: str
    created_at: str
    participants: list[str]
    is_active: bool

class PresenceUpdateRequest(BaseModel):
    """Request to update presence."""

    cursor_position: Optional[int] = None
    selection_start: Optional[int] = None
    selection_end: Optional[int] = None

class CollaboratorPresenceResponse(BaseModel):
    """Collaborator presence response."""

    user_id: str
    user_name: str
    cursor_position: Optional[int]
    selection_start: Optional[int]
    selection_end: Optional[int]
    color: str
    last_seen: str

# PDF Operation Schemas

class PDFReorderRequest(BaseModel):
    """Request to reorder PDF pages."""

    page_order: list[int] = Field(..., min_length=1)

class PDFWatermarkRequest(BaseModel):
    """Request to add watermark to PDF."""

    text: str = Field(..., min_length=1, max_length=100)
    position: str = Field(default="center", pattern="^(center|diagonal|top|bottom)$")
    font_size: int = Field(default=48, ge=8, le=200)
    opacity: float = Field(default=0.3, ge=0.1, le=1.0)
    color: str = Field(default="#808080", pattern="^#[0-9A-Fa-f]{6}$")

class RedactionRegion(BaseModel):
    """Region to redact."""

    page: int = Field(..., ge=0)
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)

class PDFRedactRequest(BaseModel):
    """Request to redact regions in PDF."""

    regions: list[RedactionRegion] = Field(..., min_length=1)

class PDFMergeRequest(BaseModel):
    """Request to merge PDFs."""

    document_ids: list[str] = Field(..., min_length=2)

class PDFOperationResponse(BaseModel):
    """Response for PDF operations."""

    success: bool
    output_path: Optional[str] = None
    page_count: Optional[int] = None
    error: Optional[str] = None

# AI Writing Schemas

class AIWritingRequest(BaseModel):
    """Request for AI writing assistance."""

    text: str = Field(..., min_length=1, max_length=50000)
    instruction: Optional[str] = None
    options: dict[str, Any] = {}

class GrammarCheckRequest(AIWritingRequest):
    """Request for grammar check."""

    pass

class SummarizeRequest(AIWritingRequest):
    """Request to summarize text."""

    length: str = Field(default="medium", pattern="^(short|medium|long)$")
    style: str = Field(default="paragraph", pattern="^(paragraph|bullets|key_points)$")

class RewriteRequest(AIWritingRequest):
    """Request to rewrite text."""

    tone: str = Field(default="professional", pattern="^(professional|casual|formal|friendly|academic)$")
    style: str = Field(default="clear", pattern="^(clear|concise|detailed|simple)$")

class ExpandRequest(AIWritingRequest):
    """Request to expand text."""

    target_length: str = Field(default="double", pattern="^(double|triple|paragraph)$")

class TranslateRequest(AIWritingRequest):
    """Request to translate text."""

    target_language: str = Field(..., min_length=2, max_length=50)
    preserve_formatting: bool = True

class ToneAdjustRequest(AIWritingRequest):
    """Request to adjust tone."""

    target_tone: str = Field(..., pattern="^(formal|casual|professional|friendly|academic|persuasive)$")

class AIWritingResponse(BaseModel):
    """Response for AI writing operations."""

    original_text: str
    result_text: str
    suggestions: list[dict[str, Any]] = []
    confidence: float = 1.0
    metadata: dict[str, Any] = {}

# Additional Request Schemas

class CommentReplyRequest(BaseModel):
    """Request to reply to a comment."""

    text: str = Field(..., min_length=1, max_length=5000)

class PresenceUpdateBody(BaseModel):
    """Request body for updating user presence."""

    user_id: str = Field(..., min_length=1)
    cursor_position: Optional[int] = None
    selection: Optional[dict[str, int]] = None

class PDFSplitRequest(BaseModel):
    """Request to split a PDF at specific pages."""

    split_at_pages: list[int] = Field(..., min_length=1)

class PDFRotateRequest(BaseModel):
    """Request to rotate pages in a PDF."""

    pages: list[int] = Field(..., min_length=1)
    angle: int = Field(..., description="Rotation angle: 0, 90, 180, or 270")

class CreateFromTemplateRequest(BaseModel):
    """Request to create a document from a template."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)

# Knowledge Library Schemas (from schemas/knowledge/library.py)

class KnowledgeDocumentType(str, Enum):
    """Supported document types."""
    PDF = "pdf"
    DOCX = "docx"
    XLSX = "xlsx"
    PPTX = "pptx"
    TXT = "txt"
    MD = "md"
    HTML = "html"
    IMAGE = "image"
    OTHER = "other"

# Keep the original name as an alias for backward compatibility
DocumentType = KnowledgeDocumentType

class LibraryDocumentCreate(BaseModel):
    """Request to add a document to the library."""
    title: str
    description: Optional[str] = None
    content: Optional[str] = None
    file_path: Optional[str] = None
    file_url: Optional[str] = None
    document_type: KnowledgeDocumentType = KnowledgeDocumentType.OTHER
    tags: list[str] = Field(default_factory=list)
    collections: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

class LibraryDocumentUpdate(BaseModel):
    """Request to update a library document."""
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    collections: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None

class LibraryDocumentResponse(BaseModel):
    """Library document response model."""
    id: str
    title: str
    description: Optional[str]
    file_path: Optional[str]
    file_url: Optional[str]
    document_type: KnowledgeDocumentType
    file_size: Optional[int]
    tags: list[str]
    collections: list[str]
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    last_accessed_at: Optional[datetime]
    is_favorite: bool = False

class CollectionCreate(BaseModel):
    """Request to create a collection."""
    name: str
    description: Optional[str] = None
    document_ids: list[str] = Field(default_factory=list)
    is_smart: bool = False
    smart_filter: Optional[dict[str, Any]] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class CollectionUpdate(BaseModel):
    """Request to update a collection."""
    name: Optional[str] = None
    description: Optional[str] = None
    document_ids: Optional[list[str]] = None
    is_smart: Optional[bool] = None
    smart_filter: Optional[dict[str, Any]] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class CollectionResponse(BaseModel):
    """Collection response model."""
    id: str
    name: str
    description: Optional[str]
    document_ids: list[str]
    document_count: int
    is_smart: bool
    smart_filter: Optional[dict[str, Any]]
    icon: Optional[str]
    color: Optional[str]
    created_at: datetime
    updated_at: datetime

class TagCreate(BaseModel):
    """Request to create a tag."""
    name: str
    color: Optional[str] = None
    description: Optional[str] = None

class TagResponse(BaseModel):
    """Tag response model."""
    id: str
    name: str
    color: Optional[str]
    description: Optional[str]
    document_count: int
    created_at: datetime

class SearchRequest(BaseModel):
    """Search request model."""
    query: str
    content: Optional[str] = None
    document_types: list[KnowledgeDocumentType] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    collections: list[str] = Field(default_factory=list)
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    limit: int = 50
    offset: int = 0

class SemanticSearchRequest(BaseModel):
    """Semantic search request model."""
    query: str
    document_ids: list[str] = Field(default_factory=list)
    top_k: int = 10
    threshold: float = 0.5

class SearchResult(BaseModel):
    """Search result model."""
    document: LibraryDocumentResponse
    score: float
    highlights: list[str] = Field(default_factory=list)

class SearchResponse(BaseModel):
    """Search response model."""
    results: list[SearchResult]
    total: int
    query: str
    took_ms: float

class AutoTagRequest(BaseModel):
    """Request to auto-tag a document."""
    document_id: str
    max_tags: int = 5

class AutoTagResponse(BaseModel):
    """Auto-tag response model."""
    document_id: str
    suggested_tags: list[str]
    confidence_scores: dict[str, float]

class RelatedDocumentsRequest(BaseModel):
    """Request to find related documents."""
    document_id: str
    limit: int = 10

class RelatedDocumentsResponse(BaseModel):
    """Related documents response model."""
    document_id: str
    related: list[SearchResult]

class KnowledgeGraphRequest(BaseModel):
    """Request to build a knowledge graph."""
    document_ids: list[str] = Field(default_factory=list)
    depth: int = 2
    include_entities: bool = True
    include_relationships: bool = True

class KnowledgeGraphNode(BaseModel):
    """Knowledge graph node."""
    id: str
    type: str  # document, entity, concept
    label: str
    properties: dict[str, Any] = Field(default_factory=dict)

class KnowledgeGraphEdge(BaseModel):
    """Knowledge graph edge."""
    source: str
    target: str
    type: str
    weight: float = 1.0
    properties: dict[str, Any] = Field(default_factory=dict)

class KnowledgeGraphResponse(BaseModel):
    """Knowledge graph response model."""
    nodes: list[KnowledgeGraphNode]
    edges: list[KnowledgeGraphEdge]
    metadata: dict[str, Any] = Field(default_factory=dict)

class FAQGenerateRequest(BaseModel):
    """Request to generate FAQ from documents."""
    document_ids: list[str]
    max_questions: int = 10
    categories: list[str] = Field(default_factory=list)

class FAQItem(BaseModel):
    """FAQ item model."""
    question: str
    answer: str
    source_document_id: str
    confidence: float
    category: Optional[str] = None

class FAQResponse(BaseModel):
    """FAQ response model."""
    items: list[FAQItem]
    source_documents: list[str]

# WORKFLOWS

"""Workflow Schemas.

Pydantic models for workflow automation.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

class NodeType(str, Enum):
    """Types of workflow nodes."""
    TRIGGER = "trigger"
    WEBHOOK = "webhook"
    ACTION = "action"
    EMAIL = "email"
    NOTIFICATION = "notification"
    CONDITION = "condition"
    LOOP = "loop"
    APPROVAL = "approval"
    DATA_TRANSFORM = "data_transform"
    DELAY = "delay"
    HTTP_REQUEST = "http_request"
    DATABASE_QUERY = "database_query"

class TriggerType(str, Enum):
    """Types of workflow triggers."""
    MANUAL = "manual"
    SCHEDULE = "schedule"
    WEBHOOK = "webhook"
    FILE_UPLOAD = "file_upload"
    EVENT = "event"

class ExecutionStatus(str, Enum):
    """Workflow execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    WAITING_APPROVAL = "waiting_approval"

class WorkflowNode(BaseModel):
    """A single node in a workflow."""
    id: str
    type: NodeType
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})

class WorkflowEdge(BaseModel):
    """Connection between workflow nodes."""
    id: str
    source: str
    target: str
    source_handle: Optional[str] = None
    target_handle: Optional[str] = None
    condition: Optional[str] = None

class WorkflowTrigger(BaseModel):
    """Workflow trigger configuration."""
    type: TriggerType
    config: dict[str, Any] = Field(default_factory=dict)

class CreateWorkflowRequest(BaseModel):
    """Request to create a workflow."""
    model_config = {"extra": "forbid"}

    name: str
    description: Optional[str] = None
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    triggers: list[WorkflowTrigger] = Field(default_factory=list)
    is_active: bool = True

class UpdateWorkflowRequest(BaseModel):
    """Request to update a workflow."""
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[list[WorkflowNode]] = None
    edges: Optional[list[WorkflowEdge]] = None
    triggers: Optional[list[WorkflowTrigger]] = None
    is_active: Optional[bool] = None

class WorkflowResponse(BaseModel):
    """Workflow response model."""
    id: str
    name: str
    description: Optional[str]
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    triggers: list[WorkflowTrigger]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_run_at: Optional[datetime] = None
    run_count: int = 0

class WorkflowListResponse(BaseModel):
    """List of workflows response."""
    workflows: list[WorkflowResponse]
    total: int

class ExecuteWorkflowRequest(BaseModel):
    """Request to execute a workflow."""
    input_data: dict[str, Any] = Field(default_factory=dict)
    async_execution: bool = True

class NodeExecutionResult(BaseModel):
    """Result of executing a single node."""
    node_id: str
    status: ExecutionStatus
    output: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None

class WorkflowExecutionResponse(BaseModel):
    """Workflow execution status response."""
    id: str
    workflow_id: str
    status: ExecutionStatus
    input_data: dict[str, Any]
    output_data: Optional[dict[str, Any]] = None
    node_results: list[NodeExecutionResult] = Field(default_factory=list)
    error: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None

class ApprovalRequest(BaseModel):
    """Request for workflow approval action."""
    execution_id: str
    node_id: str
    approved: bool
    comment: Optional[str] = None

class ConfigureTriggerRequest(BaseModel):
    """Request to configure a workflow trigger."""
    trigger_type: TriggerType
    config: dict[str, Any] = Field(default_factory=dict)

# mypy: ignore-errors

from typing import Any, Optional

from pydantic import BaseModel, Field


class ExtractedTable(BaseModel):
    """A table extracted from the document."""

    id: str
    title: Optional[str] = None
    headers: list[str]
    rows: list[list[Any]]  # Values can be str, int, float, None, etc.
    data_types: Optional[list[str]] = None
    source_page: Optional[int] = None
    source_sheet: Optional[str] = None

class ExtractedDataPoint(BaseModel):
    """A key metric or data point extracted from the document."""

    key: str
    value: Any
    data_type: str = "text"  # "numeric", "date", "text", "percentage", "currency"
    unit: Optional[str] = None
    confidence: float = 1.0
    context: Optional[str] = None

class TimeSeriesCandidate(BaseModel):
    """Information about potential time series data in the document."""

    date_column: str
    value_columns: list[str]
    frequency: Optional[str] = None  # "daily", "weekly", "monthly", "yearly"
    table_id: Optional[str] = None

class FieldInfo(BaseModel):
    """Metadata about a field in the extracted data."""

    name: str
    type: str  # "datetime", "numeric", "text", "category"
    description: Optional[str] = None
    sample_values: Optional[list[Any]] = None

class AnalysisPayload(BaseModel):
    """Request payload for document analysis."""

    template_id: Optional[str] = None
    connection_id: Optional[str] = None
    analysis_mode: str = Field(
        default="standalone",
        description="'standalone' for ad-hoc analysis, 'template_linked' for template association",
    )

class AnalysisResult(BaseModel):
    """Complete result of document analysis."""

    analysis_id: str
    document_name: str
    document_type: str  # "pdf" | "excel"
    processing_time_ms: int
    summary: Optional[str] = None

    tables: list[ExtractedTable] = Field(default_factory=list)
    data_points: list[ExtractedDataPoint] = Field(default_factory=list)
    time_series_candidates: list[TimeSeriesCandidate] = Field(default_factory=list)
    chart_suggestions: list[ChartSpec] = Field(default_factory=list)

    raw_data: list[dict[str, Any]] = Field(default_factory=list)
    field_catalog: list[FieldInfo] = Field(default_factory=list)

    template_id: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)

class AnalysisSuggestChartsPayload(BaseModel):
    """Request payload for chart suggestions on an existing analysis."""

    question: Optional[str] = None
    include_sample_data: bool = True
    table_ids: Optional[list[str]] = None
    date_range: Optional[dict[str, str]] = None

# mypy: ignore-errors
"""
Enhanced Analysis Schemas - Comprehensive data models for AI-powered document analysis.

Covers:
- Intelligent Data Extraction (entities, metrics, forms, invoices)
- Analysis Engines (summaries, sentiment, comparisons)
- Visualization specifications
- Export configurations
- Integration settings
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field

# ENUMS

class AnalyzeDocumentType(str, Enum):
    PDF = "pdf"
    EXCEL = "excel"
    CSV = "csv"
    IMAGE = "image"
    WORD = "word"
    TEXT = "text"
    UNKNOWN = "unknown"

class EntityType(str, Enum):
    PERSON = "person"
    ORGANIZATION = "organization"
    LOCATION = "location"
    DATE = "date"
    MONEY = "money"
    PERCENTAGE = "percentage"
    PRODUCT = "product"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    CUSTOM = "custom"

class MetricType(str, Enum):
    CURRENCY = "currency"
    PERCENTAGE = "percentage"
    COUNT = "count"
    RATIO = "ratio"
    DURATION = "duration"
    QUANTITY = "quantity"
    SCORE = "score"
    RATE = "rate"

class SummaryMode(str, Enum):
    EXECUTIVE = "executive"
    DATA = "data"
    QUICK = "quick"
    COMPREHENSIVE = "comprehensive"
    ACTION_ITEMS = "action_items"
    RISKS = "risks"
    OPPORTUNITIES = "opportunities"

class SentimentLevel(str, Enum):
    VERY_POSITIVE = "very_positive"
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    NEGATIVE = "negative"
    VERY_NEGATIVE = "very_negative"

class ChartType(str, Enum):
    LINE = "line"
    BAR = "bar"
    PIE = "pie"
    SCATTER = "scatter"
    AREA = "area"
    HISTOGRAM = "histogram"
    BOX = "box"
    HEATMAP = "heatmap"
    TREEMAP = "treemap"
    SANKEY = "sankey"
    FUNNEL = "funnel"
    RADAR = "radar"
    CANDLESTICK = "candlestick"
    BUBBLE = "bubble"
    SUNBURST = "sunburst"
    WATERFALL = "waterfall"
    GAUGE = "gauge"

class ExportFormat(str, Enum):
    EXCEL = "excel"
    PDF = "pdf"
    CSV = "csv"
    JSON = "json"
    HTML = "html"
    MARKDOWN = "markdown"
    POWERPOINT = "powerpoint"
    WORD = "word"

class AnalysisDepth(str, Enum):
    QUICK = "quick"
    STANDARD = "standard"
    COMPREHENSIVE = "comprehensive"
    DEEP = "deep"

class RiskLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    MINIMAL = "minimal"

class Priority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

# EXTRACTION MODELS

class ExtractedEntity(BaseModel):
    """An extracted named entity from the document."""
    id: str
    type: EntityType
    value: str
    normalized_value: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    context: Optional[str] = None
    page: Optional[int] = None
    position: Optional[Dict[str, int]] = None  # {"start": 0, "end": 10}
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ExtractedMetric(BaseModel):
    """A key metric or KPI extracted from the document."""
    id: str
    name: str
    value: Union[float, int, str, None] = None
    raw_value: str
    metric_type: MetricType
    unit: Optional[str] = None
    currency: Optional[str] = None
    period: Optional[str] = None  # "Q3 2025", "FY2024", etc.
    normalized_period: Optional[str] = None  # ISO date range
    change: Optional[float] = None  # % change if mentioned
    change_direction: Optional[str] = None  # "increase", "decrease"
    comparison_base: Optional[str] = None  # "vs last year"
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    context: Optional[str] = None
    page: Optional[int] = None
    importance_score: float = Field(ge=0.0, le=1.0, default=0.5)

class FormField(BaseModel):
    """An extracted form field."""
    id: str
    label: str
    value: Optional[str] = None
    field_type: str = "text"  # text, checkbox, radio, date, signature, dropdown
    required: bool = False
    section: Optional[str] = None
    validation_pattern: Optional[str] = None
    options: Optional[List[str]] = None  # For dropdown/radio
    is_filled: bool = False
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class ExtractedForm(BaseModel):
    """Structured form data."""
    id: str
    title: Optional[str] = None
    form_type: Optional[str] = None
    fields: List[FormField] = Field(default_factory=list)
    sections: List[Dict[str, Any]] = Field(default_factory=list)
    submission_status: str = "incomplete"
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class InvoiceLineItem(BaseModel):
    """A line item from an invoice."""
    id: str
    description: str
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    total: Optional[float] = None
    tax: Optional[float] = None
    discount: Optional[float] = None
    sku: Optional[str] = None
    category: Optional[str] = None

class ExtractedInvoice(BaseModel):
    """Structured invoice data."""
    id: str
    vendor_name: Optional[str] = None
    vendor_address: Optional[str] = None
    vendor_tax_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_address: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    due_date: Optional[str] = None
    purchase_order: Optional[str] = None
    line_items: List[InvoiceLineItem] = Field(default_factory=list)
    subtotal: Optional[float] = None
    tax_total: Optional[float] = None
    discount_total: Optional[float] = None
    grand_total: Optional[float] = None
    currency: str = "USD"
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class ContractClause(BaseModel):
    """A clause from a contract."""
    id: str
    clause_type: str  # "term", "obligation", "termination", "confidentiality", "liability", etc.
    title: Optional[str] = None
    content: str
    section: Optional[str] = None
    page: Optional[int] = None
    obligations: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    importance: str = "medium"  # low, medium, high, critical
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class ExtractedContract(BaseModel):
    """Structured contract data."""
    id: str
    contract_type: Optional[str] = None
    parties: List[Dict[str, str]] = Field(default_factory=list)
    effective_date: Optional[str] = None
    expiration_date: Optional[str] = None
    auto_renewal: bool = False
    renewal_terms: Optional[str] = None
    key_terms: List[str] = Field(default_factory=list)
    clauses: List[ContractClause] = Field(default_factory=list)
    obligations: List[Dict[str, Any]] = Field(default_factory=list)
    termination_clauses: List[str] = Field(default_factory=list)
    governing_law: Optional[str] = None
    signatures: List[Dict[str, Any]] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class TableRelationship(BaseModel):
    """Relationship between tables (for cross-page stitching)."""
    table1_id: str
    table2_id: str
    relationship_type: str  # "continuation", "related", "parent_child"
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)

class EnhancedExtractedTable(BaseModel):
    """Enhanced table with additional metadata."""
    id: str
    title: Optional[str] = None
    headers: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)
    data_types: List[str] = Field(default_factory=list)
    column_descriptions: List[str] = Field(default_factory=list)
    source_page: Optional[int] = None
    source_sheet: Optional[str] = None
    is_nested: bool = False
    parent_table_id: Optional[str] = None
    related_tables: List[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0, default=0.9)
    row_count: int = 0
    column_count: int = 0
    has_totals_row: bool = False
    has_header_row: bool = True
    statistics: Dict[str, Any] = Field(default_factory=dict)

# ANALYSIS ENGINE MODELS

class DocumentSummary(BaseModel):
    """Multi-mode document summary."""
    mode: SummaryMode
    title: str
    content: str
    bullet_points: List[str] = Field(default_factory=list)
    key_figures: List[Dict[str, Any]] = Field(default_factory=list)
    word_count: int = 0
    reading_time_minutes: float = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SentimentAnalysis(BaseModel):
    """Document sentiment analysis results."""
    overall_sentiment: SentimentLevel
    overall_score: float = Field(ge=-1.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    section_sentiments: List[Dict[str, Any]] = Field(default_factory=list)
    emotional_tone: str = "neutral"  # formal, casual, urgent, optimistic, etc.
    urgency_level: str = "normal"  # low, normal, high, critical
    bias_indicators: List[str] = Field(default_factory=list)
    key_phrases: Dict[str, List[str]] = Field(default_factory=dict)  # positive/negative phrases

class TextAnalytics(BaseModel):
    """Text analytics results."""
    word_count: int = 0
    sentence_count: int = 0
    paragraph_count: int = 0
    avg_sentence_length: float = 0
    readability_score: float = 0  # Flesch-Kincaid
    readability_grade: str = ""  # Grade level
    keywords: List[Dict[str, Any]] = Field(default_factory=list)  # [{word, frequency, importance}]
    topics: List[Dict[str, Any]] = Field(default_factory=list)  # Topic modeling results
    named_entities_summary: Dict[str, int] = Field(default_factory=dict)  # Entity type counts
    language: str = "en"
    language_confidence: float = 0.95

class FinancialAnalysis(BaseModel):
    """Financial analysis results."""
    metrics_found: int = 0
    currency: str = "USD"

    # Profitability ratios
    gross_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    net_margin: Optional[float] = None
    roe: Optional[float] = None  # Return on Equity
    roa: Optional[float] = None  # Return on Assets

    # Liquidity ratios
    current_ratio: Optional[float] = None
    quick_ratio: Optional[float] = None
    cash_ratio: Optional[float] = None

    # Efficiency ratios
    inventory_turnover: Optional[float] = None
    receivables_turnover: Optional[float] = None
    asset_turnover: Optional[float] = None

    # Growth metrics
    revenue_growth: Optional[float] = None
    profit_growth: Optional[float] = None
    yoy_comparison: Dict[str, Any] = Field(default_factory=dict)

    # Variance analysis
    variance_analysis: List[Dict[str, Any]] = Field(default_factory=list)

    # Insights
    insights: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)

class StatisticalAnalysis(BaseModel):
    """Statistical analysis of numeric data."""
    column_stats: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    # Per column: mean, median, std, min, max, percentiles, skewness, kurtosis

    correlations: List[Dict[str, Any]] = Field(default_factory=list)
    # [{col1, col2, correlation, p_value}]

    outliers: List[Dict[str, Any]] = Field(default_factory=list)
    # [{column, value, row_index, zscore}]

    distributions: Dict[str, str] = Field(default_factory=dict)
    # {column: "normal", "uniform", "exponential", etc.}

    trends: List[Dict[str, Any]] = Field(default_factory=list)
    # [{column, trend_direction, slope, r_squared}]

class ComparativeAnalysis(BaseModel):
    """Comparison between documents or versions."""
    comparison_type: str  # "version_diff", "multi_doc", "benchmark"
    documents_compared: List[str] = Field(default_factory=list)

    # Differences found
    additions: List[Dict[str, Any]] = Field(default_factory=list)
    deletions: List[Dict[str, Any]] = Field(default_factory=list)
    modifications: List[Dict[str, Any]] = Field(default_factory=list)

    # Metric comparisons
    metric_changes: List[Dict[str, Any]] = Field(default_factory=list)

    # Summary
    similarity_score: float = Field(ge=0.0, le=1.0, default=0.0)
    change_summary: str = ""
    significant_changes: List[str] = Field(default_factory=list)

# VISUALIZATION MODELS

class ChartDataSeries(BaseModel):
    """A data series for charting."""
    name: str
    data: List[Any] = Field(default_factory=list)
    color: Optional[str] = None
    type: Optional[str] = None  # For mixed charts
    y_axis: Optional[int] = None  # For dual-axis charts

class ChartAnnotation(BaseModel):
    """Annotation on a chart."""
    type: str  # "point", "line", "region", "text"
    label: str
    value: Optional[Any] = None
    position: Optional[Dict[str, Any]] = None
    style: Dict[str, Any] = Field(default_factory=dict)

class EnhancedChartSpec(BaseModel):
    """Enhanced chart specification with AI insights."""
    id: str
    type: ChartType
    title: str
    description: Optional[str] = None

    # Data configuration
    x_field: str
    y_fields: List[str] = Field(default_factory=list)
    group_field: Optional[str] = None
    size_field: Optional[str] = None  # For bubble charts
    color_field: Optional[str] = None

    # Data
    data: List[Dict[str, Any]] = Field(default_factory=list)
    series: List[ChartDataSeries] = Field(default_factory=list)

    # Axes
    x_axis_label: Optional[str] = None
    y_axis_label: Optional[str] = None
    x_axis_type: str = "category"  # category, time, linear, log
    y_axis_type: str = "linear"

    # Styling
    colors: List[str] = Field(default_factory=list)
    show_legend: bool = True
    show_grid: bool = True
    show_labels: bool = False

    # AI-powered features
    trend_line: Optional[Dict[str, Any]] = None
    forecast: Optional[Dict[str, Any]] = None
    anomalies: List[Dict[str, Any]] = Field(default_factory=list)
    annotations: List[ChartAnnotation] = Field(default_factory=list)
    ai_insights: List[str] = Field(default_factory=list)

    # Interactivity
    is_interactive: bool = True
    drill_down_enabled: bool = False

    # Metadata
    source_table_id: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.8)
    suggested_by_ai: bool = True

class VisualizationSuggestion(BaseModel):
    """AI suggestion for a visualization."""
    chart_spec: EnhancedChartSpec
    rationale: str
    relevance_score: float = Field(ge=0.0, le=1.0)
    complexity: str = "simple"  # simple, moderate, complex
    insights_potential: List[str] = Field(default_factory=list)

# INSIGHTS & RECOMMENDATIONS

class Insight(BaseModel):
    """An AI-generated insight."""
    id: str
    type: str  # "finding", "trend", "anomaly", "recommendation", "warning"
    title: str
    description: str
    priority: Priority
    confidence: float = Field(ge=0.0, le=1.0)
    supporting_data: List[Dict[str, Any]] = Field(default_factory=list)
    source_references: List[str] = Field(default_factory=list)  # Page/table references
    actionable: bool = False
    suggested_actions: List[str] = Field(default_factory=list)

class RiskItem(BaseModel):
    """An identified risk."""
    id: str
    title: str
    description: str
    risk_level: RiskLevel
    category: str  # financial, operational, compliance, market, etc.
    probability: float = Field(ge=0.0, le=1.0, default=0.5)
    impact: float = Field(ge=0.0, le=1.0, default=0.5)
    risk_score: float = Field(ge=0.0, le=1.0, default=0.0)
    mitigation_suggestions: List[str] = Field(default_factory=list)
    source_references: List[str] = Field(default_factory=list)

class OpportunityItem(BaseModel):
    """An identified opportunity."""
    id: str
    title: str
    description: str
    opportunity_type: str  # growth, efficiency, cost_saving, innovation
    potential_value: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)
    requirements: List[str] = Field(default_factory=list)
    suggested_actions: List[str] = Field(default_factory=list)
    source_references: List[str] = Field(default_factory=list)

class ActionItem(BaseModel):
    """A recommended action."""
    id: str
    title: str
    description: str
    priority: Priority
    category: str
    assignee_suggestion: Optional[str] = None
    due_date_suggestion: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list)
    expected_outcome: Optional[str] = None
    effort_estimate: Optional[str] = None  # "low", "medium", "high"

# EXPORT & TRANSFORMATION

class DataTransformation(BaseModel):
    """Data transformation operation."""
    operation: str  # "clean", "normalize", "merge", "split", "aggregate", "pivot"
    source_columns: List[str] = Field(default_factory=list)
    target_column: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    description: str = ""

class DataQualityIssue(BaseModel):
    """A specific data quality issue."""
    id: str
    issue_type: str  # "missing", "duplicate", "invalid", "outlier", "inconsistent"
    severity: str = "medium"  # low, medium, high, critical
    column: Optional[str] = None
    row_indices: List[int] = Field(default_factory=list)
    description: str
    suggested_fix: Optional[str] = None
    affected_count: int = 0

class DataQualityReport(BaseModel):
    """Data quality assessment."""
    total_rows: int = 0
    total_columns: int = 0

    # Issues list
    issues: List[DataQualityIssue] = Field(default_factory=list)

    # Completeness
    missing_values: Dict[str, int] = Field(default_factory=dict)
    missing_percentage: Dict[str, float] = Field(default_factory=dict)

    # Uniqueness
    duplicate_rows: int = 0
    unique_values_per_column: Dict[str, int] = Field(default_factory=dict)

    # Validity
    invalid_values: Dict[str, List[Any]] = Field(default_factory=dict)
    type_mismatches: Dict[str, List[int]] = Field(default_factory=dict)

    # Consistency
    format_inconsistencies: Dict[str, List[str]] = Field(default_factory=dict)

    # Outliers
    outliers_detected: Dict[str, List[int]] = Field(default_factory=dict)

    # Overall score
    quality_score: float = Field(ge=0.0, le=1.0, default=0.0)
    recommendations: List[str] = Field(default_factory=list)

class ExportConfiguration(BaseModel):
    """Export configuration."""
    format: ExportFormat
    include_raw_data: bool = True
    include_charts: bool = True
    include_analysis: bool = True
    include_insights: bool = True
    sections: List[str] = Field(default_factory=list)  # Empty = all
    styling: Dict[str, Any] = Field(default_factory=dict)
    filename: Optional[str] = None

# USER PREFERENCES & SETTINGS

class AnalysisPreferences(BaseModel):
    """User preferences for analysis."""
    analysis_depth: AnalysisDepth = AnalysisDepth.STANDARD
    focus_areas: List[str] = Field(default_factory=list)  # financial, operational, etc.
    output_format: str = "executive"  # executive, technical, visual
    language: str = "en"
    industry: Optional[str] = None
    company_size: Optional[str] = None
    currency_preference: str = "USD"
    date_format: str = "YYYY-MM-DD"
    number_format: str = "1,234.56"
    timezone: str = "UTC"
    enable_predictions: bool = True
    enable_recommendations: bool = True
    auto_chart_generation: bool = True
    max_charts: int = 10
    summary_mode: SummaryMode = SummaryMode.EXECUTIVE

# INTEGRATION MODELS

class WebhookConfig(BaseModel):
    """Webhook configuration for notifications."""
    url: str
    events: List[str] = Field(default_factory=list)  # analysis_complete, risk_detected, etc.
    secret: Optional[str] = None
    enabled: bool = True

class IntegrationConfig(BaseModel):
    """External integration configuration."""
    type: str  # slack, teams, email, jira, salesforce, etc.
    enabled: bool = True
    credentials: Dict[str, str] = Field(default_factory=dict)
    settings: Dict[str, Any] = Field(default_factory=dict)

class ScheduledAnalysis(BaseModel):
    """Scheduled analysis configuration."""
    id: str
    name: str
    source_type: str  # upload, url, database, api
    source_config: Dict[str, Any] = Field(default_factory=dict)
    schedule: str  # Cron expression
    analysis_config: AnalysisPreferences = Field(default_factory=AnalysisPreferences)
    notifications: List[str] = Field(default_factory=list)  # Email addresses
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    enabled: bool = True

# MAIN ANALYSIS RESULT

class EnhancedAnalysisResult(BaseModel):
    """Complete enhanced analysis result."""
    # Identifiers
    analysis_id: str
    document_name: str
    document_type: AnalyzeDocumentType
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    processing_time_ms: int = 0

    # Extraction results
    tables: List[EnhancedExtractedTable] = Field(default_factory=list)
    entities: List[ExtractedEntity] = Field(default_factory=list)
    metrics: List[ExtractedMetric] = Field(default_factory=list)
    forms: List[FormField] = Field(default_factory=list)
    invoices: List[ExtractedInvoice] = Field(default_factory=list)
    contracts: List[ExtractedContract] = Field(default_factory=list)
    table_relationships: List[TableRelationship] = Field(default_factory=list)

    # Analysis results
    summaries: Dict[str, DocumentSummary] = Field(default_factory=dict)
    sentiment: Optional[SentimentAnalysis] = None
    text_analytics: Optional[TextAnalytics] = None
    financial_analysis: Optional[FinancialAnalysis] = None
    statistical_analysis: Optional[StatisticalAnalysis] = None
    comparative_analysis: Optional[ComparativeAnalysis] = None

    # Visualizations
    chart_suggestions: List[EnhancedChartSpec] = Field(default_factory=list)
    visualization_suggestions: List[VisualizationSuggestion] = Field(default_factory=list)

    # Insights & recommendations
    insights: List[Insight] = Field(default_factory=list)
    risks: List[RiskItem] = Field(default_factory=list)
    opportunities: List[OpportunityItem] = Field(default_factory=list)
    action_items: List[ActionItem] = Field(default_factory=list)

    # Data quality
    data_quality: Optional[DataQualityReport] = None

    # Metadata
    page_count: int = 0
    total_tables: int = 0
    total_entities: int = 0
    total_metrics: int = 0
    confidence_score: float = Field(ge=0.0, le=1.0, default=0.8)

    # Settings used
    preferences: Optional[AnalysisPreferences] = None

    # Warnings and errors
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)

# API REQUEST/RESPONSE MODELS

class AnalyzeRequest(BaseModel):
    """Request to analyze a document."""
    preferences: Optional[AnalysisPreferences] = None
    focus_areas: List[str] = Field(default_factory=list)
    comparison_document_ids: List[str] = Field(default_factory=list)
    custom_prompts: Dict[str, str] = Field(default_factory=dict)

class ChartGenerationRequest(BaseModel):
    """Request to generate charts."""
    analysis_id: str
    natural_language_query: Optional[str] = None
    chart_type: Optional[ChartType] = None
    data_columns: List[str] = Field(default_factory=list)
    include_trends: bool = True
    include_forecasts: bool = False

class ExportRequest(BaseModel):
    """Request to export analysis."""
    analysis_id: str
    config: ExportConfiguration

class QuestionRequest(BaseModel):
    """Request to ask a question about the document."""
    analysis_id: str
    question: str
    include_sources: bool = True
    max_context_chunks: int = 5

class QuestionResponse(BaseModel):
    """Response to a document question."""
    answer: str
    confidence: float
    sources: List[Dict[str, Any]] = Field(default_factory=list)
    suggested_followups: List[str] = Field(default_factory=list)

class QAResponse(BaseModel):
    """Enhanced Q&A response with detailed source information."""
    answer: str
    confidence: float = Field(ge=0.0, le=1.0)
    sources: List[Dict[str, Any]] = Field(default_factory=list)
    context_used: List[str] = Field(default_factory=list)
    suggested_followups: List[str] = Field(default_factory=list)
    reasoning: Optional[str] = None
    citations: List[Dict[str, Any]] = Field(default_factory=list)

class TransformRequest(BaseModel):
    """Request to transform data."""
    analysis_id: str
    transformations: List[DataTransformation]
    output_format: str = "json"

from typing import Any, Optional

from pydantic import BaseModel

class ChartSpec(BaseModel):
    id: Optional[str] = None
    type: str  # "bar", "line", "pie", "scatter"
    xField: str
    yFields: list[str]
    groupField: Optional[str] = None
    aggregation: Optional[str] = None
    chartTemplateId: Optional[str] = None
    style: Optional[dict[str, Any]] = None
    title: Optional[str] = None
    description: Optional[str] = None

class ChartSuggestPayload(BaseModel):
    connection_id: Optional[str] = None
    start_date: str
    end_date: str
    key_values: Optional[dict[str, Any]] = None
    question: str
    include_sample_data: bool = False

class ChartSuggestResponse(BaseModel):
    charts: list[ChartSpec]
    sample_data: Optional[list[dict[str, Any]]] = None

class SavedChartSpec(BaseModel):
    id: str
    template_id: str
    name: str
    spec: ChartSpec
    created_at: str
    updated_at: str

class SavedChartCreatePayload(BaseModel):
    template_id: str
    name: str
    spec: ChartSpec

class SavedChartUpdatePayload(BaseModel):
    name: Optional[str] = None
    spec: Optional[ChartSpec] = None

from typing import Any, Optional

from pydantic import BaseModel

class RunPayload(BaseModel):
    template_id: str
    connection_id: Optional[str] = None
    connection_ids: Optional[list[str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    batch_ids: Optional[list[str]] = None
    key_values: Optional[dict[str, Any]] = None
    brand_kit_id: Optional[str] = None
    docx: bool = False
    xlsx: Optional[bool] = None
    email_recipients: Optional[list[str]] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    schedule_id: Optional[str] = None
    schedule_name: Optional[str] = None

class DiscoverPayload(BaseModel):
    template_id: str
    connection_id: Optional[str] = None
    connection_ids: Optional[list[str]] = None
    start_date: str
    end_date: str
    key_values: Optional[dict[str, Any]] = None


# ── Legacy schema classes (moved from legacy_all.py) ──────────────────────────

class TestPayload(BaseModel):
    db_url: Optional[str] = None
    db_type: Optional[str] = None
    database: Optional[str] = None

class ConnectionUpsertPayload(BaseModel):
    id: Optional[str] = None
    name: str
    db_type: str
    db_url: Optional[str] = None
    database: Optional[str] = None
    status: Optional[str] = None
    latency_ms: Optional[float] = None
    tags: Optional[list[str]] = None

class ScheduleCreatePayload(BaseModel):
    template_id: str
    connection_id: str
    start_date: str
    end_date: str
    key_values: Optional[dict[str, Any]] = None
    batch_ids: Optional[list[str]] = None
    docx: bool = False
    xlsx: bool = False
    email_recipients: Optional[list[str]] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    frequency: str = "daily"
    interval_minutes: Optional[int] = None
    run_time: Optional[str] = None  # HH:MM (24h) -- time of day to run
    name: Optional[str] = None
    active: bool = True

class ScheduleUpdatePayload(BaseModel):
    """All fields optional for partial updates."""
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    key_values: Optional[dict[str, Any]] = None
    batch_ids: Optional[list[str]] = None
    docx: Optional[bool] = None
    xlsx: Optional[bool] = None
    email_recipients: Optional[list[str]] = None
    email_subject: Optional[str] = None
    email_message: Optional[str] = None
    frequency: Optional[str] = None
    interval_minutes: Optional[int] = None
    run_time: Optional[str] = None  # HH:MM (24h) -- time of day to run
    active: Optional[bool] = None

class TemplateManualEditPayload(BaseModel):
    html: str

class TemplateAiEditPayload(BaseModel):
    instructions: str
    html: Optional[str] = None

class MappingPayload(BaseModel):
    mapping: dict[str, str]
    connection_id: Optional[str] = None
    connection_ids: Optional[list[str]] = None
    user_values_text: Optional[str] = None
    user_instructions: Optional[str] = None
    dialect_hint: Optional[str] = None
    catalog_allowlist: Optional[list[str]] = None
    params_spec: Optional[list[str]] = None
    sample_params: Optional[dict[str, Any]] = None
    generator_dialect: Optional[str] = None
    force_generator_rebuild: bool = False
    keys: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")

class GeneratorAssetsPayload(BaseModel):
    step4_output: Optional[dict[str, Any]] = None
    contract: Optional[dict[str, Any]] = None
    overview_md: Optional[str] = None
    final_template_html: Optional[str] = None
    reference_pdf_image: Optional[str] = None
    catalog: Optional[list[str]] = None
    dialect: Optional[str] = "duckdb"
    params: Optional[list[str]] = None
    sample_params: Optional[dict[str, Any]] = None
    force_rebuild: bool = False
    key_tokens: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")

class CorrectionsPreviewPayload(BaseModel):
    user_input: Optional[str] = ""
    page: int = 1
    mapping_override: Optional[dict[str, Any]] = None
    sample_tokens: Optional[list[str]] = None
    model_selector: Optional[str] = None

    model_config = ConfigDict(extra="allow")

class TemplateRecommendPayload(BaseModel):
    requirement: str
    kind: Optional[str] = None
    domain: Optional[str] = None
    kinds: Optional[list[str]] = None
    domains: Optional[list[str]] = None
    schema_snapshot: Optional[dict[str, Any]] = None
    tables: Optional[list[str]] = None

    model_config = ConfigDict(extra="allow")

class TemplateRecommendation(BaseModel):
    template: dict[str, Any]
    explanation: str
    score: float

class TemplateRecommendResponse(BaseModel):
    recommendations: list[TemplateRecommendation]

class LastUsedPayload(BaseModel):
    connection_id: Optional[str] = None
    template_id: Optional[str] = None

class TemplateUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    status: Optional[str] = None

    model_config = ConfigDict(extra="allow")

class TemplateChatMessage(BaseModel):
    """A single message in the template editing chat conversation."""
    role: str  # 'user' | 'assistant'
    content: str

class TemplateChatPayload(BaseModel):
    """Payload for conversational template editing."""
    messages: list[TemplateChatMessage]
    html: Optional[str] = None  # Current HTML state (optional, uses saved if not provided)

    model_config = ConfigDict(extra="allow")

class TemplateChatResponse(BaseModel):
    """Response from conversational template editing."""
    message: str  # Assistant's response message
    ready_to_apply: bool  # Whether LLM has gathered enough info to apply changes
    proposed_changes: Optional[list[str]] = None  # List of proposed changes when ready
    updated_html: Optional[str] = None  # The updated HTML if ready_to_apply is True
    follow_up_questions: Optional[list[str]] = None  # Questions to ask user if not ready

class TemplateCreateFromChatPayload(BaseModel):
    """Payload for creating a template from a chat conversation."""
    name: str
    html: str
    kind: str = "pdf"

class UnifiedChatPayload(BaseModel):
    """Payload for the unified chat pipeline endpoint."""
    session_id: Optional[str] = None
    template_id: Optional[str] = None
    connection_id: Optional[str] = None
    connection_ids: Optional[list[str]] = None  # Multi-DB: list of connection IDs
    messages: list[TemplateChatMessage]
    html: Optional[str] = None
    action: Optional[str] = None          # explicit action hint from UI buttons
    action_params: Optional[dict] = None  # action-specific params
    workspace_mode: bool = False           # True = open workspace (all tools, no pipeline gates)
    model_config = ConfigDict(extra="allow")


class MergedSchemaRequest(BaseModel):
    """Request body for the merged-schema endpoint."""
    connection_ids: list[str] = Field(..., min_length=1, max_length=10)

class UnifiedChatResponse(BaseModel):
    """Response from the unified chat pipeline endpoint."""
    message: str
    ready_to_apply: bool = False
    proposed_changes: Optional[list[str]] = None
    updated_html: Optional[str] = None
    follow_up_questions: Optional[list[str]] = None
    session_id: str
    template_id: Optional[str] = None
    pipeline_state: str
    action_performed: Optional[str] = None
    action_result: Optional[dict] = None
    artifacts: Optional[dict[str, str]] = None


# DOMAIN (merged from domain.py)
"""Domain entities for the NeuraReport application.

Pure business logic: no I/O, no framework dependencies.
Consolidated from connections, jobs, schedules, and templates.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

# ────────────────────────────────────────────────────────────
# Originally: connections.py
# ────────────────────────────────────────────────────────────

class ConnectionStatus(str, Enum):
    UNKNOWN = "unknown"
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"

@dataclass(frozen=True, slots=True)
class Connection:
    id: str
    name: str
    db_type: str
    status: ConnectionStatus = ConnectionStatus.UNKNOWN
    created_at: datetime | None = None
    updated_at: datetime | None = None
    latency_ms: float | None = None

# ────────────────────────────────────────────────────────────
# Originally: jobs.py
# ────────────────────────────────────────────────────────────

class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELED = "canceled"

class JobStepStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass(frozen=True, slots=True)
class JobStep:
    id: str
    job_id: str
    name: str
    label: str
    status: JobStepStatus = JobStepStatus.QUEUED
    progress: float = 0.0
    error: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None

@dataclass(frozen=True, slots=True)
class Job:
    id: str
    type: str
    status: JobStatus = JobStatus.QUEUED
    template_id: str | None = None
    connection_id: str | None = None
    schedule_id: str | None = None
    idempotency_key: str | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    cancellation_requested_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: str | None = None

    def is_terminal(self) -> bool:
        return self.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED}

# ────────────────────────────────────────────────────────────
# Originally: schedules.py
# ────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class Schedule:
    id: str
    name: str
    template_id: str
    connection_id: str | None
    interval_minutes: int
    active: bool = True
    start_date: datetime | None = None
    end_date: datetime | None = None
    next_run_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

# ────────────────────────────────────────────────────────────
# Originally: templates.py
# ────────────────────────────────────────────────────────────

class TemplateStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"

class TemplateKind(str, Enum):
    PDF = "pdf"
    EXCEL = "excel"

@dataclass(frozen=True, slots=True)
class Template:
    id: str
    name: str
    kind: TemplateKind
    status: TemplateStatus = TemplateStatus.DRAFT
    description: str | None = None
    connection_id: str | None = None
    connection_ids: list[str] | None = None
    artifacts: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

