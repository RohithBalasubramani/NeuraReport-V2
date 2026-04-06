"""Consolidated Platform Services (Phase B6).

Merged from: logger, observability, ai (spreadsheet + writing),
charts (quickchart + auto_chart).
"""
from __future__ import annotations

"""
Logger Query Service.

Encapsulates SQL queries for Logger-specific data. Since Logger databases have
a known schema, we can write targeted queries for devices, schemas, jobs, etc.
"""

import logging
from typing import Any

from backend.app.repositories import get_dataframe_store, ensure_connection_loaded
from backend.app.repositories import resolve_connection_ref

logger = logging.getLogger("neura.logger.query")

def _ensure_loaded(connection_id: str) -> None:
    """Ensure the connection's DataFrames are loaded."""
    ref = resolve_connection_ref(connection_id)
    ensure_connection_loaded(
        connection_id,
        db_path=ref["db_path"],
        db_type=ref["db_type"],
        connection_url=ref["connection_url"],
    )

def _query(connection_id: str, sql: str) -> list[dict[str, Any]]:
    """Execute a query and return results as list of dicts."""
    _ensure_loaded(connection_id)
    store = get_dataframe_store()
    return store.execute_query_to_dicts(connection_id, sql)

def get_devices(connection_id: str) -> list[dict[str, Any]]:
    """Get all PLC devices with their configuration."""
    return _query(connection_id, """
        SELECT
            d.id, d.name, d.protocol, d.status, d.latency_ms,
            d.auto_reconnect, d.last_error, d.created_at, d.updated_at
        FROM app_devices d
        ORDER BY d.name
    """)

def get_device_with_config(connection_id: str, device_id: str) -> dict[str, Any] | None:
    """Get a single device with its protocol-specific configuration."""
    devices = _query(connection_id, f"""
        SELECT
            d.id, d.name, d.protocol, d.status, d.latency_ms,
            d.auto_reconnect, d.last_error
        FROM app_devices d
        WHERE CAST(d.id AS VARCHAR) = '{device_id}'
    """)
    if not devices:
        return None
    device = devices[0]

    if device.get("protocol") == "modbus":
        configs = _query(connection_id, f"""
            SELECT host, port, unit_id, timeout_ms, retries
            FROM app_modbus_configs
            WHERE CAST(device_id AS VARCHAR) = '{device_id}'
        """)
        if configs:
            device["config"] = configs[0]
    elif device.get("protocol") == "opcua":
        configs = _query(connection_id, f"""
            SELECT endpoint, auth_type, security_policy, security_mode
            FROM app_opcua_configs
            WHERE CAST(device_id AS VARCHAR) = '{device_id}'
        """)
        if configs:
            device["config"] = configs[0]

    return device

def get_schemas(connection_id: str) -> list[dict[str, Any]]:
    """Get all schemas with their fields."""
    schemas = _query(connection_id, """
        SELECT id, name, description, created_at, updated_at
        FROM app_schemas
        ORDER BY name
    """)

    for schema in schemas:
        schema_id = schema["id"]
        fields = _query(connection_id, f"""
            SELECT key, field_type, unit, scale, description
            FROM app_schema_fields
            WHERE CAST(schema_id AS VARCHAR) = CAST('{schema_id}' AS VARCHAR)
            ORDER BY key
        """)
        schema["fields"] = fields

    return schemas

def get_jobs(connection_id: str) -> list[dict[str, Any]]:
    """Get all logging jobs with status."""
    return _query(connection_id, """
        SELECT
            id, name, job_type, interval_ms, enabled, status,
            batch_size, created_at, updated_at
        FROM app_jobs
        ORDER BY name
    """)

def get_job_runs(connection_id: str, job_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Get execution history for a specific job."""
    return _query(connection_id, f"""
        SELECT
            id, started_at, stopped_at, duration_ms,
            rows_written, reads_count, read_errors, write_errors,
            avg_latency_ms, p95_latency_ms
        FROM app_job_runs
        WHERE CAST(job_id AS VARCHAR) = '{job_id}'
        ORDER BY started_at DESC
        LIMIT {int(limit)}
    """)

def get_storage_targets(connection_id: str) -> list[dict[str, Any]]:
    """Get all storage targets (external databases where data is logged)."""
    return _query(connection_id, """
        SELECT
            id, name, provider, connection_string,
            is_default, status, last_error
        FROM app_storage_targets
        ORDER BY name
    """)

def get_device_tables(connection_id: str) -> list[dict[str, Any]]:
    """Get all device tables (logical tables bound to schema + device + storage)."""
    return _query(connection_id, """
        SELECT
            dt.id, dt.name, dt.status, dt.mapping_health,
            dt.last_migrated_at
        FROM app_device_tables dt
        ORDER BY dt.name
    """)

def get_field_mappings(connection_id: str, device_table_id: str) -> list[dict[str, Any]]:
    """Get field mappings for a specific device table."""
    return _query(connection_id, f"""
        SELECT
            field_key, protocol, address, data_type,
            scale, deadband, byte_order, poll_interval_ms
        FROM app_field_mappings
        WHERE CAST(device_table_id AS VARCHAR) = '{device_table_id}'
        ORDER BY field_key
    """)

"""
Logger Database Discovery Service.

Probes known Logger database locations (LoggerDeploy / LoggerFast) and returns
available connections that NeuraReport can register as data sources.
"""

import logging
from typing import Any

from sqlalchemy import create_engine, text

logger = logging.getLogger("neura.logger.discovery")

# Known Logger database configurations
LOGGER_DATABASES = [
    {
        "key": "logger_deploy",
        "name": "Logger Deploy (neuract_db)",
        "host": "localhost",
        "port": 5434,
        "database": "neuract_db",
        "username": "neuract",
        "password": "neuract123",
        "logger_type": "deploy",
    },
    {
        "key": "logger_fast",
        "name": "Logger Fast (meta_data_fast)",
        "host": "localhost",
        "port": 5432,
        "database": "meta_data_fast",
        "username": "postgres",
        "password": "",
        "logger_type": "fast",
    },
]

def _build_url(cfg: dict) -> str:
    user = cfg["username"]
    password = cfg.get("password") or ""
    host = cfg["host"]
    port = cfg["port"]
    database = cfg["database"]
    if password:
        return f"postgresql://{user}:{password}@{host}:{port}/{database}"
    return f"postgresql://{user}@{host}:{port}/{database}"

def _can_connect(url: str) -> bool:
    """Test if a PostgreSQL database is reachable."""
    engine = create_engine(url, connect_args={"connect_timeout": 3})
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.debug(f"Cannot connect to {url}: {exc}")
        return False
    finally:
        engine.dispose()

def _count_tables(url: str) -> int:
    """Count user tables in a PostgreSQL database."""
    engine = create_engine(url, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_type = 'BASE TABLE' "
                "AND table_schema NOT IN ('pg_catalog', 'information_schema')"
            ))
            return result.scalar() or 0
    except Exception:
        return 0
    finally:
        engine.dispose()

def _get_storage_targets(url: str) -> list[dict]:
    """Query app_storage_targets from a Logger database for additional data DBs."""
    engine = create_engine(url, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT id, name, provider, connection_string, is_default, status "
                "FROM app_storage_targets ORDER BY name"
            ))
            targets = []
            for row in result:
                targets.append({
                    "id": str(row[0]),
                    "name": row[1],
                    "provider": row[2],
                    "connection_string": row[3],
                    "is_default": row[4],
                    "status": row[5],
                })
            return targets
    except Exception as exc:
        logger.debug(f"Could not query storage targets: {exc}")
        return []
    finally:
        engine.dispose()

def discover_logger_databases() -> list[dict[str, Any]]:
    """Probe for Logger databases and return discovered connections."""
    discovered = []

    for cfg in LOGGER_DATABASES:
        url = _build_url(cfg)
        if _can_connect(url):
            table_count = _count_tables(url)
            entry: dict[str, Any] = {
                "key": cfg["key"],
                "name": cfg["name"],
                "db_type": "postgresql",
                "host": cfg["host"],
                "port": cfg["port"],
                "database": cfg["database"],
                "db_url": url,
                "logger_type": cfg["logger_type"],
                "table_count": table_count,
                "status": "available",
            }

            # Try to discover storage targets from this Logger DB
            storage_targets = _get_storage_targets(url)
            if storage_targets:
                entry["storage_targets"] = storage_targets

            discovered.append(entry)
            logger.info(f"Discovered Logger database: {cfg['name']} ({table_count} tables)")

    return discovered

"""
Prometheus metrics middleware for FastAPI.

Captures:
- Request count, response count by status code
- Request duration histogram with trace ID exemplars
- Exception count, in-progress gauge
- Custom business metrics (reports, LLM, queue depth)

Based on: blueswen/fastapi-observability PrometheusMiddleware
"""

import time
import logging
from typing import Tuple

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Match
from starlette.status import HTTP_500_INTERNAL_SERVER_ERROR

try:
    from opentelemetry import trace as otel_trace
    HAS_OTEL = True
except ImportError:
    HAS_OTEL = False

from prometheus_client import Counter, Gauge, Histogram, Info, REGISTRY
from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST, generate_latest

logger = logging.getLogger("neura.observability.metrics")

# ---- HTTP Metrics ----
REQUESTS_TOTAL = Counter("fastapi_requests_total", "Total requests", ["method", "path", "app_name"])
RESPONSES_TOTAL = Counter("fastapi_responses_total", "Total responses", ["method", "path", "status_code", "app_name"])
REQUESTS_DURATION = Histogram(
    "fastapi_requests_duration_seconds", "Request duration",
    ["method", "path", "app_name"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
EXCEPTIONS_TOTAL = Counter("fastapi_exceptions_total", "Exceptions", ["method", "path", "exception_type", "app_name"])
REQUESTS_IN_PROGRESS = Gauge("fastapi_requests_in_progress", "In-progress requests", ["method", "path", "app_name"])

# ---- Business Metrics ----
REPORTS_GENERATED = Counter("neurareport_reports_generated_total", "Reports generated", ["report_type", "status"])
LLM_INFERENCE_DURATION = Histogram(
    "neurareport_llm_inference_seconds", "LLM inference time",
    ["model", "operation"],
    buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0),
)
LLM_TOKEN_USAGE = Counter("neurareport_llm_tokens_total", "LLM tokens consumed", ["model", "token_type"])
QUEUE_DEPTH = Gauge("neurareport_queue_depth", "Queue depth", ["queue_name"])
ACTIVE_WEBSOCKETS = Gauge("neurareport_active_websocket_connections", "WebSocket connections", ["connection_type"])
BUILD_INFO = Info("neurareport_build", "Build info")

# ---- V2 Enhanced Metrics (Phase 1) ----
LLM_CALLS_TOTAL = Counter(
    "neurareport_llm_calls_total", "Total LLM calls by operation and status",
    ["operation", "status", "model"],
)
LLM_ERRORS_TOTAL = Counter(
    "neurareport_llm_errors_total", "LLM errors by operation and category",
    ["operation", "error_category"],
)
LLM_COST_USD = Counter(
    "neurareport_llm_cost_usd_total", "Estimated LLM cost in USD",
    ["operation", "model"],
)
CIRCUIT_BREAKER_STATE = Gauge(
    "neurareport_circuit_breaker_state", "Circuit breaker state (0=closed, 1=half_open, 2=open)",
    ["breaker_name"],
)
PIPELINE_STAGE_DURATION = Histogram(
    "neurareport_pipeline_stage_seconds", "Pipeline stage execution time",
    ["pipeline", "stage"],
    buckets=(0.01, 0.05, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0),
)
AGENT_TASKS_TOTAL = Counter(
    "neurareport_agent_tasks_total", "Agent tasks by type and status",
    ["agent_type", "status"],
)
LLM_CACHE_OPS = Counter(
    "neurareport_llm_cache_ops_total", "LLM cache operations",
    ["operation"],  # hit, miss, eviction
)

def init_app_info(version: str = "dev", commit: str = "unknown", app_name: str = "neurareport-backend") -> None:
    """Initialize the APP_INFO gauge with version and build metadata."""
    BUILD_INFO.info({"version": version, "commit": commit, "app_name": app_name})

class PrometheusMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, app_name: str = "neurareport-backend"):
        super().__init__(app)
        self.app_name = app_name
        # Populate build info from settings if available
        try:
            from backend.app.services.config import get_settings
            settings = get_settings()
            init_app_info(version=settings.version, commit=settings.commit, app_name=app_name)
        except Exception:
            BUILD_INFO.info({"version": "dev", "app_name": app_name})

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        method = request.method
        path, is_handled = self._get_path(request)

        # Filter out /metrics endpoint from access log metrics
        if path == "/metrics":
            return await call_next(request)

        if not is_handled:
            return await call_next(request)

        REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=self.app_name).inc()
        REQUESTS_TOTAL.labels(method=method, path=path, app_name=self.app_name).inc()

        before_time = time.perf_counter()
        try:
            response = await call_next(request)
        except BaseException as e:
            status_code = HTTP_500_INTERNAL_SERVER_ERROR
            EXCEPTIONS_TOTAL.labels(method=method, path=path, exception_type=type(e).__name__, app_name=self.app_name).inc()
            raise
        else:
            status_code = response.status_code
            after_time = time.perf_counter()
            exemplar = {}
            if HAS_OTEL:
                span = otel_trace.get_current_span()
                trace_id = otel_trace.format_trace_id(span.get_span_context().trace_id)
                exemplar = {"TraceID": trace_id}
            REQUESTS_DURATION.labels(method=method, path=path, app_name=self.app_name).observe(
                after_time - before_time, exemplar=exemplar if exemplar.get("TraceID") else None,
            )
        finally:
            RESPONSES_TOTAL.labels(method=method, path=path, status_code=status_code, app_name=self.app_name).inc()
            REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=self.app_name).dec()
        return response

    @staticmethod
    def _get_path(request: Request) -> Tuple[str, bool]:
        for route in request.app.routes:
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                return route.path, True
        return request.url.path, False

def metrics_endpoint(request: Request) -> Response:
    return Response(generate_latest(REGISTRY), headers={"Content-Type": CONTENT_TYPE_LATEST})

# mypy: ignore-errors
"""
Pipeline Stage Tracer — decorator-based timing for any pipeline operation.

Inspired by BFI pipeline_v45's per-stage observability. Provides:
- Decorator for automatic timing of pipeline stages
- Correlation ID propagation for tracing across stages
- Integration with Prometheus metrics (LLM_INFERENCE_DURATION)
- Structured log output with stage context

Usage:
    from backend.app.services.platform_services import traced, PipelineTracer

    # As a decorator
    @traced("template-verify")
    async def verify_template(pdf_path):
        ...

    # As a context manager
    async with PipelineTracer("report-generate") as tracer:
        tracer.set_metadata(template_id="abc123")
        result = await do_work()
        tracer.set_metadata(row_count=42)
"""

import asyncio
import functools
import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, List, Optional

logger = logging.getLogger("neura.observability.tracer")

@dataclass
class StageRecord:
    """Record of a single pipeline stage execution."""
    stage_name: str
    correlation_id: str
    start_time: float
    end_time: Optional[float] = None
    duration_ms: Optional[float] = None
    success: bool = True
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stage": self.stage_name,
            "correlation_id": self.correlation_id,
            "duration_ms": round(self.duration_ms, 2) if self.duration_ms else None,
            "success": self.success,
            "error": self.error,
            "metadata": self.metadata,
        }

class PipelineTracer:
    """
    Context manager for tracing pipeline stages.

    Supports both sync and async usage, records timing and metadata,
    and integrates with Prometheus metrics.

    Usage:
        tracer = PipelineTracer("template-verify", correlation_id="abc-123")
        with tracer:
            tracer.set_metadata(template_id="xyz")
            result = do_work()
        print(tracer.record.to_dict())
    """

    def __init__(
        self,
        stage_name: str,
        correlation_id: Optional[str] = None,
        parent_tracer: Optional["PipelineTracer"] = None,
    ):
        self._correlation_id = correlation_id or (
            parent_tracer._correlation_id if parent_tracer else uuid.uuid4().hex[:12]
        )
        self.record = StageRecord(
            stage_name=stage_name,
            correlation_id=self._correlation_id,
            start_time=0.0,
        )
        self._parent = parent_tracer

    def set_metadata(self, **kwargs: Any) -> None:
        """Add metadata to the stage record."""
        self.record.metadata.update(kwargs)

    def __enter__(self) -> "PipelineTracer":
        self.record.start_time = time.time()
        logger.info(
            "pipeline_stage_start",
            extra={
                "event": "pipeline_stage_start",
                "stage": self.record.stage_name,
                "correlation_id": self._correlation_id,
            }
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.record.end_time = time.time()
        self.record.duration_ms = (self.record.end_time - self.record.start_time) * 1000

        if exc_type:
            self.record.success = False
            self.record.error = str(exc_val)[:500] if exc_val else exc_type.__name__

        # Publish to Prometheus
        _observe_stage_duration(self.record.stage_name, self.record.duration_ms / 1000)

        logger.info(
            "pipeline_stage_complete",
            extra={
                "event": "pipeline_stage_complete",
                "stage": self.record.stage_name,
                "correlation_id": self._correlation_id,
                "duration_ms": round(self.record.duration_ms, 2),
                "success": self.record.success,
                "error": self.record.error,
                **{f"meta_{k}": v for k, v in self.record.metadata.items()},
            }
        )

    async def __aenter__(self) -> "PipelineTracer":
        return self.__enter__()

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.__exit__(exc_type, exc_val, exc_tb)

def _observe_stage_duration(stage_name: str, duration_seconds: float) -> None:
    """Publish stage duration to Prometheus histogram."""
    try:
        from .metrics import LLM_INFERENCE_DURATION
        LLM_INFERENCE_DURATION.labels(model="pipeline", operation=stage_name).observe(duration_seconds)
    except Exception:
        pass  # Metrics may not be initialized

def traced(stage_name: str, *, capture_result: bool = False):
    """Decorator that traces a function's execution time and logs it."""
    def decorator(func: Callable) -> Callable:
        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                tracer = PipelineTracer(stage_name)
                async with tracer:
                    result = await func(*args, **kwargs)
                    if capture_result and result is not None:
                        tracer.set_metadata(result_type=type(result).__name__)
                    return result
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                tracer = PipelineTracer(stage_name)
                with tracer:
                    result = func(*args, **kwargs)
                    if capture_result and result is not None:
                        tracer.set_metadata(result_type=type(result).__name__)
                    return result
            return sync_wrapper
    return decorator

class PipelineRun:
    """
    Tracks a full pipeline execution across multiple stages.

    Usage:
        run = PipelineRun("report-generation")
        with run.stage("verify"):
            ...
        with run.stage("map"):
            ...
        print(run.summary())
    """

    def __init__(self, pipeline_name: str, correlation_id: Optional[str] = None):
        self.pipeline_name = pipeline_name
        self.correlation_id = correlation_id or uuid.uuid4().hex[:12]
        self.stages: List[StageRecord] = []
        self._start_time = time.time()
        self._end_time: Optional[float] = None

    def stage(self, stage_name: str) -> PipelineTracer:
        """Create a tracer for a pipeline stage."""
        tracer = PipelineTracer(
            stage_name=f"{self.pipeline_name}.{stage_name}",
            correlation_id=self.correlation_id,
        )
        # Hook to capture the record when stage completes
        original_exit = tracer.__exit__

        def capturing_exit(exc_type, exc_val, exc_tb):
            original_exit(exc_type, exc_val, exc_tb)
            self.stages.append(tracer.record)

        tracer.__exit__ = capturing_exit
        return tracer

    def finish(self) -> None:
        """Mark the pipeline run as finished."""
        self._end_time = time.time()

    def summary(self) -> Dict[str, Any]:
        """Get a summary of the pipeline run."""
        end = self._end_time or time.time()
        total_ms = (end - self._start_time) * 1000

        return {
            "pipeline": self.pipeline_name,
            "correlation_id": self.correlation_id,
            "total_duration_ms": round(total_ms, 2),
            "stage_count": len(self.stages),
            "all_success": all(s.success for s in self.stages),
            "stages": [s.to_dict() for s in self.stages],
            "stage_timings": {
                s.stage_name: round(s.duration_ms, 2)
                for s in self.stages
                if s.duration_ms is not None
            },
        }

# SpanRecord + SpanCollector — bounded in-memory span store
# (Ported from new-repo tracer for general-purpose span tracking)

@dataclass
class SpanRecord:
    """Timing record for a single traced invocation."""

    operation: str
    start_time: float
    end_time: float
    success: bool
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def duration_ms(self) -> float:
        return (self.end_time - self.start_time) * 1000.0

class SpanCollector:
    """
    Thread-safe, bounded in-memory store for ``SpanRecord`` objects.

    Keeps at most *maxlen* spans (default 1 000) in a ring buffer so
    memory usage stays predictable under sustained load.
    """

    def __init__(self, maxlen: int = 1000) -> None:
        self._spans: Deque[SpanRecord] = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def record(self, span: SpanRecord) -> None:
        """Append a span (thread-safe; oldest spans evicted when full)."""
        with self._lock:
            self._spans.append(span)

    def get_recent(self, n: int = 100) -> List[SpanRecord]:
        """Return the *n* most recent spans (newest last)."""
        with self._lock:
            items = list(self._spans)
        return items[-n:]

    def get_stats(self, operation: Optional[str] = None) -> Dict[str, Any]:
        """
        Compute latency percentiles, success rate, and count.

        If *operation* is given, only spans matching that name are
        considered; otherwise all recorded spans are used.
        """
        with self._lock:
            spans = [s for s in self._spans if operation is None or s.operation == operation]

        if not spans:
            return {
                "operation": operation or "__all__",
                "count": 0,
                "success_rate": 0.0,
                "p50_ms": 0.0,
                "p95_ms": 0.0,
                "p99_ms": 0.0,
            }

        durations = sorted(s.duration_ms for s in spans)
        successes = sum(1 for s in spans if s.success)
        count = len(spans)

        def _percentile(sorted_vals: List[float], pct: float) -> float:
            idx = int(pct / 100.0 * (len(sorted_vals) - 1))
            return round(sorted_vals[idx], 3)

        return {
            "operation": operation or "__all__",
            "count": count,
            "success_rate": round(successes / count, 4) if count else 0.0,
            "p50_ms": _percentile(durations, 50),
            "p95_ms": _percentile(durations, 95),
            "p99_ms": _percentile(durations, 99),
        }

# Module-level collector singleton
_span_collector = SpanCollector()

def get_span_collector() -> SpanCollector:
    """Return the module-level ``SpanCollector`` singleton."""
    return _span_collector

"""
OpenTelemetry tracing setup for FastAPI.

Configures:
1. TracerProvider with service.name resource
2. BatchSpanProcessor exporting to OTLP endpoint (Tempo/Collector)
3. Automatic FastAPI instrumentation (spans for all HTTP requests)
4. Log correlation (trace_id, span_id injected into log records)

Based on: blueswen/fastapi-observability + opentelemetry-python SDK
"""

import logging

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from starlette.types import ASGIApp

logger = logging.getLogger("neura.observability")

def setup_tracing(
    app: ASGIApp,
    service_name: str = "neurareport-backend",
    otlp_endpoint: str = "localhost:4317",
    log_correlation: bool = True,
    service_version: str = "dev",
    deployment_environment: str = "production",
) -> None:
    resource = Resource.create(attributes={
        "service.name": service_name,
        "service.version": service_version,
        "deployment.environment": deployment_environment,
    })
    tracer_provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(tracer_provider)
    tracer_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True))
    )
    if log_correlation:
        LoggingInstrumentor().instrument(set_logging_format=True)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider)
    logger.info("tracing_configured", extra={"event": "tracing_configured", "endpoint": otlp_endpoint})

"""
AI Writing Service
Provides AI-powered writing assistance using the unified LLM client for grammar
checking, summarization, rewriting, expansion, and translation.

Uses the unified LLMClient which provides:
- Circuit breaker for fault tolerance
- Response caching (memory + disk)
- Token usage tracking
- Automatic retry with exponential backoff
- Multi-provider support (OpenAI, Claude, Gemini, DeepSeek, Ollama, Azure)
"""

import asyncio
import json
import logging
import re
from typing import List, Optional
from enum import Enum

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Input limits
MAX_TEXT_CHARS = 100_000  # ~25K tokens — hard cap to prevent token overflow
MAX_TEXT_CHARS_EXPAND = 50_000  # Expansion needs output room
MIN_TEXT_CHARS = 1  # Minimum non-whitespace chars

class WritingTone(str, Enum):
    """Available writing tones for rewriting."""
    PROFESSIONAL = "professional"
    CASUAL = "casual"
    FORMAL = "formal"
    FRIENDLY = "friendly"
    ACADEMIC = "academic"
    TECHNICAL = "technical"
    PERSUASIVE = "persuasive"
    CONCISE = "concise"

# Result models

class GrammarIssue(BaseModel):
    """Represents a grammar or style issue found in text."""
    start: int = Field(..., description="Start position in text")
    end: int = Field(..., description="End position in text")
    original: str = Field(..., description="Original text")
    suggestion: str = Field(..., description="Suggested correction")
    issue_type: str = Field(..., description="Type of issue (grammar, spelling, style, etc.)")
    explanation: str = Field(..., description="Explanation of the issue")
    severity: str = Field(default="warning", description="Severity: error, warning, suggestion")

class GrammarCheckResult(BaseModel):
    """Result of grammar check operation."""
    issues: List[GrammarIssue] = Field(default_factory=list)
    corrected_text: str = Field(..., description="Text with all corrections applied")
    issue_count: int = Field(..., description="Total number of issues found")
    score: float = Field(..., description="Quality score 0-100", ge=0, le=100)

class SummarizeResult(BaseModel):
    """Result of summarization operation."""
    summary: str = Field(..., description="Summarized text")
    key_points: List[str] = Field(default_factory=list, description="Key points extracted")
    word_count_original: int = Field(..., description="Original word count")
    word_count_summary: int = Field(..., description="Summary word count")
    compression_ratio: float = Field(..., description="Compression ratio")

class RewriteResult(BaseModel):
    """Result of rewrite operation."""
    rewritten_text: str = Field(..., description="Rewritten text")
    tone: str = Field(..., description="Applied tone")
    changes_made: List[str] = Field(default_factory=list, description="Summary of changes")

class ExpandResult(BaseModel):
    """Result of expansion operation."""
    expanded_text: str = Field(..., description="Expanded text")
    sections_added: List[str] = Field(default_factory=list, description="Sections or points added")
    word_count_original: int = Field(..., description="Original word count")
    word_count_expanded: int = Field(..., description="Expanded word count")

class TranslateResult(BaseModel):
    """Result of translation operation."""
    translated_text: str = Field(..., description="Translated text")
    source_language: str = Field(..., description="Detected or specified source language")
    target_language: str = Field(..., description="Target language")
    confidence: float = Field(default=1.0, description="Translation confidence 0-1", ge=0, le=1)

# Service errors

class WritingServiceError(Exception):
    """Base error for writing service."""

class InputValidationError(WritingServiceError):
    """Raised when input text fails validation."""

class LLMResponseError(WritingServiceError):
    """Raised when LLM returns an unparseable or invalid response."""

class LLMUnavailableError(WritingServiceError):
    """Raised when the LLM service is unavailable (circuit breaker open)."""

# Helpers

def _extract_json(raw: str) -> dict:
    """Extract JSON from an LLM response that may contain markdown fences."""
    text = raw.strip()
    # Strip markdown code fences
    if text.startswith("```"):
        # Remove opening fence (optionally with language tag)
        text = re.sub(r"^```(?:json)?\s*\n?", "", text, count=1)
        text = re.sub(r"\n?```\s*$", "", text, count=1)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError(f"Expected JSON object, got {type(parsed).__name__}")
    return parsed

def _validate_grammar_positions(issues: list[dict], text_length: int) -> list[dict]:
    """Validate and fix grammar issue positions to be within text bounds."""
    valid = []
    for issue in issues:
        start = issue.get("start", 0)
        end = issue.get("end", 0)

        # Clamp to valid range
        start = max(0, min(start, text_length))
        end = max(start, min(end, text_length))

        issue["start"] = start
        issue["end"] = end
        valid.append(issue)
    return valid

# Service

class WritingService:
    """
    AI-powered writing assistance service.

    Uses the unified LLMClient for all LLM interactions, which provides
    circuit breaker, caching, retry, multi-provider support, and token tracking.
    """

    def __init__(self):
        self._llm_client = None

    def _get_llm_client(self):
        """Get the unified LLM client (lazy-loaded, singleton)."""
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        description: str = "writing_service",
    ) -> str:
        """Make an LLM call through the unified client."""
        client = self._get_llm_client()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            response = await asyncio.to_thread(
                client.complete,
                messages=messages,
                description=description,
                max_tokens=max_tokens,
            )
        except RuntimeError as exc:
            # Circuit breaker open or provider unavailable
            if "temporarily unavailable" in str(exc).lower():
                raise LLMUnavailableError(str(exc)) from exc
            raise LLMResponseError(str(exc)) from exc
        except Exception as exc:
            raise LLMResponseError(f"LLM call failed: {exc}") from exc

        # Extract content from OpenAI-compatible response dict
        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not content:
            raise LLMResponseError("LLM returned empty response")

        return content

    # ----- Grammar Check -----

    async def check_grammar(
        self,
        text: str,
        language: str = "en",
        strict: bool = False,
    ) -> GrammarCheckResult:
        """Check text for grammar, spelling, and style issues."""
        stripped = text.strip()
        if not stripped:
            return GrammarCheckResult(
                issues=[],
                corrected_text=text,
                issue_count=0,
                score=100.0,
            )

        if len(text) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Text exceeds maximum length of {MAX_TEXT_CHARS:,} characters "
                f"(got {len(text):,}). Split into smaller chunks."
            )

        system_prompt = f"""You are an expert grammar and style checker for {language} text.
Analyze the text for:
1. Grammar errors
2. Spelling mistakes
3. Punctuation issues
4. Style improvements{' (be strict — flag all style issues including passive voice, wordiness, and informal language)' if strict else ''}

Respond ONLY with valid JSON (no markdown fences):
{{
    "issues": [
        {{
            "start": <character position>,
            "end": <character position>,
            "original": "<original text>",
            "suggestion": "<corrected text>",
            "issue_type": "<grammar|spelling|punctuation|style>",
            "explanation": "<brief explanation>",
            "severity": "<error|warning|suggestion>"
        }}
    ],
    "corrected_text": "<full text with all corrections applied>",
    "score": <0-100 quality score>
}}"""

        user_prompt = f"Check this text:\n\n{text}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="grammar_check",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"Grammar check returned invalid JSON: {exc}"
            ) from exc

        raw_issues = result.get("issues", [])
        if not isinstance(raw_issues, list):
            raw_issues = []
        validated_issues = _validate_grammar_positions(raw_issues, len(text))

        issues = []
        for issue_data in validated_issues:
            try:
                issues.append(GrammarIssue(**issue_data))
            except Exception:
                # Skip malformed individual issues but don't fail the whole check
                logger.warning("Skipping malformed grammar issue: %s", issue_data)

        score = result.get("score", 100.0)
        score = max(0.0, min(100.0, float(score)))

        return GrammarCheckResult(
            issues=issues,
            corrected_text=result.get("corrected_text", text),
            issue_count=len(issues),
            score=score,
        )

    # ----- Summarize -----

    async def summarize(
        self,
        text: str,
        max_length: Optional[int] = None,
        style: str = "bullet_points",
    ) -> SummarizeResult:
        """Summarize text with optional length limit."""
        stripped = text.strip()
        if not stripped:
            return SummarizeResult(
                summary="",
                key_points=[],
                word_count_original=0,
                word_count_summary=0,
                compression_ratio=1.0,
            )

        if len(text) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Text exceeds maximum length of {MAX_TEXT_CHARS:,} characters."
            )

        word_count_original = len(text.split())
        length_instruction = f"Keep the summary under {max_length} words." if max_length else ""

        style_instructions = {
            "bullet_points": "Use bullet points for key takeaways.",
            "paragraph": "Write as a cohesive paragraph.",
            "executive": "Write an executive summary with overview and key conclusions.",
        }

        system_prompt = f"""You are an expert summarizer. Create a clear, concise summary.
{style_instructions.get(style, style_instructions['paragraph'])}
{length_instruction}

Respond ONLY with valid JSON (no markdown fences):
{{
    "summary": "<the summary>",
    "key_points": ["<point 1>", "<point 2>", ...]
}}"""

        user_prompt = f"Summarize this text:\n\n{text}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="summarize",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"Summarization returned invalid JSON: {exc}"
            ) from exc

        summary = result.get("summary", "")
        word_count_summary = len(summary.split()) if summary else 0

        return SummarizeResult(
            summary=summary,
            key_points=result.get("key_points", []),
            word_count_original=word_count_original,
            word_count_summary=word_count_summary,
            compression_ratio=word_count_summary / word_count_original if word_count_original > 0 else 1.0,
        )

    # ----- Rewrite -----

    async def rewrite(
        self,
        text: str,
        tone: WritingTone = WritingTone.PROFESSIONAL,
        preserve_meaning: bool = True,
    ) -> RewriteResult:
        """Rewrite text with specified tone."""
        stripped = text.strip()
        if not stripped:
            return RewriteResult(
                rewritten_text=text,
                tone=tone.value,
                changes_made=[],
            )

        if len(text) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Text exceeds maximum length of {MAX_TEXT_CHARS:,} characters."
            )

        tone_descriptions = {
            WritingTone.PROFESSIONAL: "professional and business-appropriate",
            WritingTone.CASUAL: "casual and conversational",
            WritingTone.FORMAL: "formal and official",
            WritingTone.FRIENDLY: "friendly and approachable",
            WritingTone.ACADEMIC: "academic and scholarly",
            WritingTone.TECHNICAL: "technical and precise",
            WritingTone.PERSUASIVE: "persuasive and compelling",
            WritingTone.CONCISE: "concise and direct",
        }

        system_prompt = f"""You are an expert writer. Rewrite the text to be {tone_descriptions.get(tone, 'professional')}.
{'Preserve the original meaning.' if preserve_meaning else 'You may adjust the meaning for clarity.'}

Respond ONLY with valid JSON (no markdown fences):
{{
    "rewritten_text": "<rewritten text>",
    "changes_made": ["<change 1>", "<change 2>", ...]
}}"""

        user_prompt = f"Rewrite this text:\n\n{text}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="rewrite",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"Rewrite returned invalid JSON: {exc}"
            ) from exc

        return RewriteResult(
            rewritten_text=result.get("rewritten_text", text),
            tone=tone.value,
            changes_made=result.get("changes_made", []),
        )

    # ----- Expand -----

    async def expand(
        self,
        text: str,
        target_length: Optional[int] = None,
        add_examples: bool = False,
        add_details: bool = True,
    ) -> ExpandResult:
        """Expand text with additional details and examples."""
        stripped = text.strip()
        if not stripped:
            return ExpandResult(
                expanded_text=text,
                sections_added=[],
                word_count_original=0,
                word_count_expanded=0,
            )

        if len(text) > MAX_TEXT_CHARS_EXPAND:
            raise InputValidationError(
                f"Text exceeds maximum length of {MAX_TEXT_CHARS_EXPAND:,} characters for expansion."
            )

        word_count_original = len(text.split())

        instructions = []
        if add_examples:
            instructions.append("Include relevant examples")
        if add_details:
            instructions.append("Add explanatory details")
        if target_length:
            instructions.append(f"Aim for approximately {target_length} words")

        system_prompt = f"""You are an expert content writer. Expand the text with more depth.
Instructions: {', '.join(instructions) if instructions else 'Expand naturally'}

Respond ONLY with valid JSON (no markdown fences):
{{
    "expanded_text": "<expanded text>",
    "sections_added": ["<section/topic added 1>", "<section/topic added 2>", ...]
}}"""

        user_prompt = f"Expand this text:\n\n{text}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            max_tokens=4000,
            description="expand",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"Expansion returned invalid JSON: {exc}"
            ) from exc

        expanded = result.get("expanded_text", text)

        return ExpandResult(
            expanded_text=expanded,
            sections_added=result.get("sections_added", []),
            word_count_original=word_count_original,
            word_count_expanded=len(expanded.split()),
        )

    # ----- Translate -----

    async def translate(
        self,
        text: str,
        target_language: str,
        source_language: Optional[str] = None,
        preserve_formatting: bool = True,
    ) -> TranslateResult:
        """Translate text to target language."""
        stripped = text.strip()
        if not stripped:
            return TranslateResult(
                translated_text=text,
                source_language=source_language or "unknown",
                target_language=target_language,
                confidence=1.0,
            )

        if len(text) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Text exceeds maximum length of {MAX_TEXT_CHARS:,} characters."
            )

        source_instruction = f"from {source_language}" if source_language else "(detect source language)"

        system_prompt = f"""You are an expert translator. Translate the text {source_instruction} to {target_language}.
{'Preserve the original formatting (line breaks, bullet points, etc.).' if preserve_formatting else ''}

Respond ONLY with valid JSON (no markdown fences):
{{
    "translated_text": "<translated text>",
    "source_language": "<detected or specified source language>",
    "confidence": <0.0-1.0 confidence score>
}}"""

        user_prompt = f"Translate:\n\n{text}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            max_tokens=4000,
            description="translate",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(
                f"Translation returned invalid JSON: {exc}"
            ) from exc

        confidence = result.get("confidence", 0.9)
        confidence = max(0.0, min(1.0, float(confidence)))

        return TranslateResult(
            translated_text=result.get("translated_text", text),
            source_language=result.get("source_language", source_language or "auto"),
            target_language=target_language,
            confidence=confidence,
        )

    # ----- Content Generation -----

    async def generate_content(
        self,
        prompt: str,
        context: Optional[str] = None,
        tone: WritingTone = WritingTone.PROFESSIONAL,
        max_length: Optional[int] = None,
    ) -> str:
        """Generate new content based on a prompt."""
        if not prompt.strip():
            raise InputValidationError("Prompt cannot be empty.")

        if len(prompt) > MAX_TEXT_CHARS:
            raise InputValidationError(
                f"Prompt exceeds maximum length of {MAX_TEXT_CHARS:,} characters."
            )

        tone_desc = {
            WritingTone.PROFESSIONAL: "professional",
            WritingTone.CASUAL: "casual",
            WritingTone.FORMAL: "formal",
            WritingTone.FRIENDLY: "friendly",
            WritingTone.ACADEMIC: "academic",
            WritingTone.TECHNICAL: "technical",
            WritingTone.PERSUASIVE: "persuasive",
            WritingTone.CONCISE: "concise",
        }

        system_prompt = f"""You are an expert content writer.
Generate content that is {tone_desc.get(tone, 'professional')} in tone.
{f'Keep the response under {max_length} words.' if max_length else ''}
{f'Context: {context}' if context else ''}"""

        return await self._call_llm(
            system_prompt,
            prompt,
            max_tokens=4000,
            description="generate_content",
        )

# Singleton instance
writing_service = WritingService()

"""
AI Spreadsheet Service
Provides AI-powered spreadsheet features using the unified LLM client for
natural language to formula conversion, data cleaning, anomaly detection,
and predictions.

Uses the unified LLMClient which provides:
- Circuit breaker for fault tolerance
- Response caching (memory + disk)
- Token usage tracking
- Multi-provider support (OpenAI, Claude, Gemini, DeepSeek, Ollama, Azure)
"""

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# NOTE: _extract_json, InputValidationError, LLMResponseError, LLMUnavailableError
# are defined earlier in this consolidated file (Writing Service section).

logger = logging.getLogger(__name__)

# Limits
MAX_DATA_ROWS = 5_000
MAX_FORMULA_LENGTH = 5_000

class FormulaResult(BaseModel):
    """Result of natural language to formula conversion."""
    formula: str = Field(..., description="Excel/spreadsheet formula")
    explanation: str = Field(..., description="Explanation of what the formula does")
    examples: List[str] = Field(default_factory=list, description="Example inputs/outputs")
    alternative_formulas: List[str] = Field(default_factory=list, description="Alternative approaches")

class DataCleaningSuggestion(BaseModel):
    """A single data cleaning suggestion."""
    column: str = Field(..., description="Column name or reference")
    issue: str = Field(..., description="Description of the data quality issue")
    suggestion: str = Field(..., description="Suggested fix")
    severity: str = Field(default="medium", description="Severity: high, medium, low")
    affected_rows: int = Field(default=0, description="Number of affected rows")
    auto_fixable: bool = Field(default=False, description="Can be auto-fixed")

class DataCleaningResult(BaseModel):
    """Result of data cleaning analysis."""
    suggestions: List[DataCleaningSuggestion] = Field(default_factory=list)
    quality_score: float = Field(..., description="Overall data quality score 0-100", ge=0, le=100)
    summary: str = Field(..., description="Summary of data quality issues")

class Anomaly(BaseModel):
    """Detected data anomaly."""
    location: str = Field(..., description="Cell reference or row number")
    value: Any = Field(..., description="The anomalous value")
    expected_range: str = Field(..., description="Expected value range")
    confidence: float = Field(..., description="Confidence that this is an anomaly 0-1", ge=0, le=1)
    explanation: str = Field(..., description="Why this is considered anomalous")
    anomaly_type: str = Field(..., description="Type: outlier, missing, inconsistent, etc.")

class AnomalyDetectionResult(BaseModel):
    """Result of anomaly detection."""
    anomalies: List[Anomaly] = Field(default_factory=list)
    total_rows_analyzed: int = Field(..., description="Number of rows analyzed")
    anomaly_count: int = Field(..., description="Number of anomalies found")
    summary: str = Field(..., description="Summary of findings")

class PredictionColumn(BaseModel):
    """Result of predictive column generation."""
    column_name: str = Field(..., description="Name for the new column")
    predictions: List[Any] = Field(default_factory=list, description="Predicted values")
    confidence_scores: List[float] = Field(default_factory=list, description="Confidence for each prediction")
    methodology: str = Field(..., description="Prediction methodology used")
    accuracy_estimate: float = Field(..., description="Estimated accuracy 0-1", ge=0, le=1)

class FormulaExplanation(BaseModel):
    """Explanation of a formula."""
    formula: str = Field(..., description="The formula being explained")
    summary: str = Field(..., description="Brief summary of what it does")
    step_by_step: List[str] = Field(default_factory=list, description="Step-by-step breakdown")
    components: Dict[str, str] = Field(default_factory=dict, description="Explanation of each component")
    potential_issues: List[str] = Field(default_factory=list, description="Potential issues or edge cases")

class SpreadsheetAIService:
    """
    AI-powered spreadsheet assistance service.
    Uses the unified LLMClient for all LLM interactions.
    """

    def __init__(self):
        self._llm_client = None

    def _get_llm_client(self):
        """Get the unified LLM client (lazy-loaded, singleton)."""
        if self._llm_client is None:
            from backend.app.services.llm import get_llm_client
            self._llm_client = get_llm_client()
        return self._llm_client

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 2000,
        description: str = "spreadsheet_ai",
    ) -> str:
        """
        Make an LLM call through the unified client.

        Runs synchronous LLMClient.complete() in a thread pool
        to avoid blocking the async event loop.
        """
        client = self._get_llm_client()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            response = await asyncio.to_thread(
                client.complete,
                messages=messages,
                description=description,
                max_tokens=max_tokens,
            )
        except RuntimeError as exc:
            if "temporarily unavailable" in str(exc).lower():
                raise LLMUnavailableError(str(exc)) from exc
            raise LLMResponseError(str(exc)) from exc
        except Exception as exc:
            raise LLMResponseError(f"LLM call failed: {exc}") from exc

        content = (
            response.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not content:
            raise LLMResponseError("LLM returned empty response")

        return content

    async def natural_language_to_formula(
        self,
        description: str,
        context: Optional[str] = None,
        spreadsheet_type: str = "excel",
    ) -> FormulaResult:
        """Convert natural language description to spreadsheet formula."""
        if not description.strip():
            raise InputValidationError("Description cannot be empty.")

        context_info = f"\n\nContext about the data:\n{context}" if context else ""

        system_prompt = f"""You are an expert {spreadsheet_type} formula writer.
Convert natural language descriptions into {spreadsheet_type} formulas.
Always provide working, accurate formulas.

Respond ONLY with valid JSON (no markdown fences):
{{
    "formula": "<the formula>",
    "explanation": "<clear explanation of what it does>",
    "examples": ["<example input/output 1>", "<example input/output 2>"],
    "alternative_formulas": ["<alternative approach 1>"]
}}"""

        user_prompt = f"Create a formula for: {description}{context_info}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="nl_to_formula",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Formula generation returned invalid JSON: {exc}") from exc

        return FormulaResult(
            formula=result.get("formula", ""),
            explanation=result.get("explanation", ""),
            examples=result.get("examples", []),
            alternative_formulas=result.get("alternative_formulas", []),
        )

    async def analyze_data_quality(
        self,
        data_sample: List[Dict[str, Any]],
        column_info: Optional[Dict[str, str]] = None,
    ) -> DataCleaningResult:
        """
        Analyze data for quality issues and provide cleaning suggestions.
        """
        if not data_sample:
            return DataCleaningResult(
                suggestions=[],
                quality_score=100.0,
                summary="No data provided for analysis",
            )

        if len(data_sample) > MAX_DATA_ROWS:
            raise InputValidationError(
                f"Data sample exceeds maximum of {MAX_DATA_ROWS:,} rows."
            )

        data_preview = json.dumps(data_sample[:20], indent=2, default=str)
        column_context = ""
        if column_info:
            column_context = f"\n\nExpected column types:\n{json.dumps(column_info, indent=2)}"

        system_prompt = """You are a data quality expert. Analyze the data for issues like:
1. Missing values
2. Inconsistent formatting
3. Invalid data types
4. Duplicates
5. Outliers
6. Inconsistent naming/spelling

Respond ONLY with valid JSON (no markdown fences):
{
    "suggestions": [
        {
            "column": "<column name>",
            "issue": "<description of issue>",
            "suggestion": "<how to fix>",
            "severity": "<high|medium|low>",
            "affected_rows": <estimated count>,
            "auto_fixable": <true|false>
        }
    ],
    "quality_score": <0-100>,
    "summary": "<overall summary>"
}"""

        user_prompt = f"Analyze this data for quality issues:\n\n{data_preview}{column_context}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="data_quality",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Data quality analysis returned invalid JSON: {exc}") from exc

        suggestions = []
        for s in result.get("suggestions", []):
            try:
                suggestions.append(DataCleaningSuggestion(**s))
            except Exception:
                logger.warning("Skipping malformed data cleaning suggestion: %s", s)

        score = result.get("quality_score", 0)
        score = max(0.0, min(100.0, float(score)))

        return DataCleaningResult(
            suggestions=suggestions,
            quality_score=score,
            summary=result.get("summary", ""),
        )

    async def detect_anomalies(
        self,
        data: List[Dict[str, Any]],
        columns_to_analyze: Optional[List[str]] = None,
        sensitivity: str = "medium",
    ) -> AnomalyDetectionResult:
        """
        Detect anomalies in data.
        """
        if not data:
            return AnomalyDetectionResult(
                anomalies=[],
                total_rows_analyzed=0,
                anomaly_count=0,
                summary="No data provided",
            )

        if len(data) > MAX_DATA_ROWS:
            raise InputValidationError(
                f"Data exceeds maximum of {MAX_DATA_ROWS:,} rows."
            )

        data_preview = json.dumps(data[:50], indent=2, default=str)
        columns_context = ""
        if columns_to_analyze:
            columns_context = f"\n\nFocus on these columns: {', '.join(columns_to_analyze)}"

        sensitivity_desc = {
            "low": "Only flag clear, obvious anomalies",
            "medium": "Flag moderately suspicious values",
            "high": "Flag any potentially unusual values",
        }

        system_prompt = f"""You are a data anomaly detection expert.
Sensitivity level: {sensitivity} - {sensitivity_desc.get(sensitivity, sensitivity_desc['medium'])}

Look for:
1. Statistical outliers
2. Missing or null values in unexpected places
3. Inconsistent patterns
4. Data entry errors
5. Values outside expected ranges

Respond ONLY with valid JSON (no markdown fences):
{{
    "anomalies": [
        {{
            "location": "<cell reference or row number>",
            "value": "<the anomalous value>",
            "expected_range": "<what was expected>",
            "confidence": <0.0-1.0>,
            "explanation": "<why it's anomalous>",
            "anomaly_type": "<outlier|missing|inconsistent|error>"
        }}
    ],
    "total_rows_analyzed": <number>,
    "summary": "<summary of findings>"
}}"""

        user_prompt = f"Detect anomalies in this data:\n\n{data_preview}{columns_context}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="anomaly_detection",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Anomaly detection returned invalid JSON: {exc}") from exc

        anomalies = []
        for a in result.get("anomalies", []):
            try:
                anomalies.append(Anomaly(**a))
            except Exception:
                logger.warning("Skipping malformed anomaly: %s", a)

        return AnomalyDetectionResult(
            anomalies=anomalies,
            total_rows_analyzed=result.get("total_rows_analyzed", len(data)),
            anomaly_count=len(anomalies),
            summary=result.get("summary", ""),
        )

    async def generate_predictive_column(
        self,
        data: List[Dict[str, Any]],
        target_description: str,
        based_on_columns: List[str],
    ) -> PredictionColumn:
        """
        Generate predictions for a new column based on existing data.
        """
        if not data:
            raise InputValidationError("Data cannot be empty for predictions.")

        if len(data) > MAX_DATA_ROWS:
            raise InputValidationError(
                f"Data exceeds maximum of {MAX_DATA_ROWS:,} rows."
            )

        if not based_on_columns:
            raise InputValidationError("At least one input column is required.")

        data_preview = json.dumps(data[:30], indent=2, default=str)

        system_prompt = """You are a predictive analytics expert.
Generate predictions based on patterns in the provided data.

Respond ONLY with valid JSON (no markdown fences):
{
    "column_name": "<suggested name for predicted column>",
    "predictions": [<predicted value for each row>],
    "confidence_scores": [<0.0-1.0 confidence for each prediction>],
    "methodology": "<explain the prediction methodology>",
    "accuracy_estimate": <0.0-1.0 estimated accuracy>
}"""

        user_prompt = f"""Generate predictions for: {target_description}
Based on columns: {', '.join(based_on_columns)}

Data sample:
{data_preview}"""

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            max_tokens=4000,
            description="predictive_column",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Prediction generation returned invalid JSON: {exc}") from exc

        accuracy = result.get("accuracy_estimate", 0)
        accuracy = max(0.0, min(1.0, float(accuracy)))

        return PredictionColumn(
            column_name=result.get("column_name", "Predicted"),
            predictions=result.get("predictions", []),
            confidence_scores=result.get("confidence_scores", []),
            methodology=result.get("methodology", ""),
            accuracy_estimate=accuracy,
        )

    async def explain_formula(
        self,
        formula: str,
        context: Optional[str] = None,
    ) -> FormulaExplanation:
        """
        Explain what a formula does in plain language.
        """
        if not formula.strip():
            raise InputValidationError("Formula cannot be empty.")

        if len(formula) > MAX_FORMULA_LENGTH:
            raise InputValidationError(
                f"Formula exceeds maximum length of {MAX_FORMULA_LENGTH:,} characters."
            )

        context_info = f"\n\nContext: {context}" if context else ""

        system_prompt = """You are a spreadsheet formula expert.
Explain formulas in clear, understandable terms.

Respond ONLY with valid JSON (no markdown fences):
{
    "formula": "<the formula>",
    "summary": "<one-sentence summary>",
    "step_by_step": ["<step 1>", "<step 2>", ...],
    "components": {
        "<component>": "<what it does>"
    },
    "potential_issues": ["<potential issue or edge case 1>", ...]
}"""

        user_prompt = f"Explain this formula: {formula}{context_info}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="explain_formula",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Formula explanation returned invalid JSON: {exc}") from exc

        return FormulaExplanation(
            formula=formula,
            summary=result.get("summary", ""),
            step_by_step=result.get("step_by_step", []),
            components=result.get("components", {}),
            potential_issues=result.get("potential_issues", []),
        )

    async def suggest_formulas(
        self,
        data_sample: List[Dict[str, Any]],
        analysis_goals: Optional[str] = None,
    ) -> List[FormulaResult]:
        """
        Suggest useful formulas based on data structure.
        """
        if not data_sample:
            return []

        if len(data_sample) > MAX_DATA_ROWS:
            raise InputValidationError(
                f"Data sample exceeds maximum of {MAX_DATA_ROWS:,} rows."
            )

        data_preview = json.dumps(data_sample[:10], indent=2, default=str)
        goals_context = f"\n\nAnalysis goals: {analysis_goals}" if analysis_goals else ""

        system_prompt = """You are a spreadsheet analytics expert.
Suggest useful formulas based on the data structure.

Respond ONLY with valid JSON (no markdown fences):
{
    "suggestions": [
        {
            "formula": "<formula>",
            "explanation": "<what it calculates>",
            "examples": ["<example>"],
            "alternative_formulas": []
        }
    ]
}"""

        user_prompt = f"Suggest useful formulas for this data:\n\n{data_preview}{goals_context}"

        raw = await self._call_llm(
            system_prompt,
            user_prompt,
            description="suggest_formulas",
        )

        try:
            result = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise LLMResponseError(f"Formula suggestion returned invalid JSON: {exc}") from exc

        suggestions = []
        for s in result.get("suggestions", []):
            try:
                suggestions.append(FormulaResult(**s))
            except Exception:
                logger.warning("Skipping malformed formula suggestion: %s", s)

        return suggestions

# Singleton instance
spreadsheet_ai_service = SpreadsheetAIService()

# mypy: ignore-errors
"""
QuickChart Integration for Server-Side Chart Generation.

QuickChart is an open-source Chart.js API that generates chart images from URLs.

Features:
- No client-side JavaScript required
- Supports all Chart.js chart types
- Returns PNG/SVG images
- Can be self-hosted

API: https://quickchart.io/
"""

import json
import logging
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger("neura.charts.quickchart")

@dataclass
class ChartConfig:
    """Configuration for a QuickChart chart."""
    type: str  # bar, line, pie, doughnut, radar, scatter, bubble
    data: Dict[str, Any]
    options: Dict[str, Any] = field(default_factory=dict)
    width: int = 500
    height: int = 300
    background_color: str = "white"
    device_pixel_ratio: float = 2.0
    format: str = "png"  # png, svg, webp, pdf

class QuickChartClient:
    """
    Client for QuickChart API.

    Can use the public API or a self-hosted instance.
    """

    DEFAULT_URL = "https://quickchart.io"

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        self.base_url = (base_url or self.DEFAULT_URL).rstrip("/")
        self.api_key = api_key

    def get_chart_url(self, config: ChartConfig) -> str:
        """
        Get a URL that renders the chart.

        The URL can be used directly in <img> tags.
        """
        chart_json = self._build_chart_json(config)
        encoded = urllib.parse.quote(json.dumps(chart_json, separators=(',', ':')))

        params = {
            "c": encoded,
            "w": str(config.width),
            "h": str(config.height),
            "bkg": config.background_color,
            "devicePixelRatio": str(config.device_pixel_ratio),
            "f": config.format,
        }

        if self.api_key:
            params["key"] = self.api_key

        query = urllib.parse.urlencode(params)
        return f"{self.base_url}/chart?{query}"

    def get_chart_bytes(self, config: ChartConfig) -> bytes:
        """
        Download the chart as bytes.

        Returns PNG/SVG bytes that can be saved to a file.
        """
        url = self.get_chart_url(config)

        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.read()
        except Exception as e:
            logger.error(f"Failed to download chart: {e}")
            raise

    def get_short_url(self, config: ChartConfig) -> str:
        """
        Get a short URL for the chart.

        Useful for sharing or embedding.
        """
        chart_json = self._build_chart_json(config)

        payload = json.dumps({
            "chart": chart_json,
            "width": config.width,
            "height": config.height,
            "backgroundColor": config.background_color,
            "devicePixelRatio": config.device_pixel_ratio,
            "format": config.format,
        }).encode("utf-8")

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-QuickChart-Api-Key"] = self.api_key

        req = urllib.request.Request(
            f"{self.base_url}/chart/create",
            data=payload,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("url", "")
        except Exception as e:
            logger.error(f"Failed to create short URL: {e}")
            raise

    def _build_chart_json(self, config: ChartConfig) -> Dict[str, Any]:
        """Build the Chart.js configuration JSON."""
        return {
            "type": config.type,
            "data": config.data,
            "options": config.options,
        }

# Convenience functions for common chart types

def create_bar_chart(
    labels: List[str],
    datasets: List[Dict[str, Any]],
    title: Optional[str] = None,
    stacked: bool = False,
    horizontal: bool = False,
    **kwargs,
) -> ChartConfig:
    """Create a bar chart configuration."""
    # Process datasets
    processed_datasets = []
    colors = [
        "rgba(54, 162, 235, 0.8)",
        "rgba(255, 99, 132, 0.8)",
        "rgba(75, 192, 192, 0.8)",
        "rgba(255, 206, 86, 0.8)",
        "rgba(153, 102, 255, 0.8)",
    ]

    for i, ds in enumerate(datasets):
        processed = {
            "label": ds.get("label", f"Dataset {i+1}"),
            "data": ds.get("data", []),
            "backgroundColor": ds.get("backgroundColor", colors[i % len(colors)]),
        }
        processed_datasets.append(processed)

    options: Dict[str, Any] = {
        "responsive": True,
        "plugins": {},
    }

    if title:
        options["plugins"]["title"] = {
            "display": True,
            "text": title,
        }

    if stacked:
        options["scales"] = {
            "x": {"stacked": True},
            "y": {"stacked": True},
        }

    chart_type = "horizontalBar" if horizontal else "bar"

    return ChartConfig(
        type=chart_type,
        data={
            "labels": labels,
            "datasets": processed_datasets,
        },
        options=options,
        **kwargs,
    )

def create_line_chart(
    labels: List[str],
    datasets: List[Dict[str, Any]],
    title: Optional[str] = None,
    fill: bool = False,
    smooth: bool = True,
    **kwargs,
) -> ChartConfig:
    """Create a line chart configuration."""
    colors = [
        "rgb(54, 162, 235)",
        "rgb(255, 99, 132)",
        "rgb(75, 192, 192)",
        "rgb(255, 206, 86)",
        "rgb(153, 102, 255)",
    ]

    processed_datasets = []
    for i, ds in enumerate(datasets):
        processed = {
            "label": ds.get("label", f"Dataset {i+1}"),
            "data": ds.get("data", []),
            "borderColor": ds.get("borderColor", colors[i % len(colors)]),
            "backgroundColor": ds.get("backgroundColor", colors[i % len(colors)].replace("rgb", "rgba").replace(")", ", 0.2)")),
            "fill": ds.get("fill", fill),
            "tension": 0.4 if smooth else 0,
        }
        processed_datasets.append(processed)

    options: Dict[str, Any] = {
        "responsive": True,
        "plugins": {},
    }

    if title:
        options["plugins"]["title"] = {
            "display": True,
            "text": title,
        }

    return ChartConfig(
        type="line",
        data={
            "labels": labels,
            "datasets": processed_datasets,
        },
        options=options,
        **kwargs,
    )

def create_pie_chart(
    labels: List[str],
    data: List[Union[int, float]],
    title: Optional[str] = None,
    doughnut: bool = False,
    **kwargs,
) -> ChartConfig:
    """Create a pie/doughnut chart configuration."""
    colors = [
        "rgba(255, 99, 132, 0.8)",
        "rgba(54, 162, 235, 0.8)",
        "rgba(255, 206, 86, 0.8)",
        "rgba(75, 192, 192, 0.8)",
        "rgba(153, 102, 255, 0.8)",
        "rgba(255, 159, 64, 0.8)",
        "rgba(199, 199, 199, 0.8)",
        "rgba(83, 102, 255, 0.8)",
    ]

    # Extend colors if needed
    while len(colors) < len(data):
        colors.extend(colors)

    options: Dict[str, Any] = {
        "responsive": True,
        "plugins": {},
    }

    if title:
        options["plugins"]["title"] = {
            "display": True,
            "text": title,
        }

    return ChartConfig(
        type="doughnut" if doughnut else "pie",
        data={
            "labels": labels,
            "datasets": [{
                "data": data,
                "backgroundColor": colors[:len(data)],
            }],
        },
        options=options,
        **kwargs,
    )

def create_scatter_chart(
    datasets: List[Dict[str, Any]],
    title: Optional[str] = None,
    x_label: Optional[str] = None,
    y_label: Optional[str] = None,
    **kwargs,
) -> ChartConfig:
    """Create a scatter plot configuration."""
    colors = [
        "rgba(255, 99, 132, 0.8)",
        "rgba(54, 162, 235, 0.8)",
        "rgba(75, 192, 192, 0.8)",
    ]

    processed_datasets = []
    for i, ds in enumerate(datasets):
        processed = {
            "label": ds.get("label", f"Dataset {i+1}"),
            "data": ds.get("data", []),
            "backgroundColor": ds.get("backgroundColor", colors[i % len(colors)]),
            "pointRadius": ds.get("pointRadius", 5),
        }
        processed_datasets.append(processed)

    options: Dict[str, Any] = {
        "responsive": True,
        "plugins": {},
        "scales": {
            "x": {"type": "linear", "position": "bottom"},
            "y": {"type": "linear"},
        },
    }

    if title:
        options["plugins"]["title"] = {
            "display": True,
            "text": title,
        }

    if x_label:
        options["scales"]["x"]["title"] = {"display": True, "text": x_label}
    if y_label:
        options["scales"]["y"]["title"] = {"display": True, "text": y_label}

    return ChartConfig(
        type="scatter",
        data={
            "datasets": processed_datasets,
        },
        options=options,
        **kwargs,
    )

# High-level functions

def generate_chart_url(
    chart_type: str,
    labels: List[str],
    data: Union[List, Dict],
    title: Optional[str] = None,
    **kwargs,
) -> str:
    """Quick function to generate a chart URL."""
    client = QuickChartClient()

    if chart_type == "bar":
        if isinstance(data, list):
            datasets = [{"label": title or "Data", "data": data}]
        else:
            datasets = data.get("datasets", [])
        config = create_bar_chart(labels, datasets, title=title, **kwargs)

    elif chart_type == "line":
        if isinstance(data, list):
            datasets = [{"label": title or "Data", "data": data}]
        else:
            datasets = data.get("datasets", [])
        config = create_line_chart(labels, datasets, title=title, **kwargs)

    elif chart_type in ("pie", "doughnut"):
        config = create_pie_chart(
            labels, data if isinstance(data, list) else [],
            title=title, doughnut=(chart_type == "doughnut"), **kwargs
        )

    elif chart_type == "scatter":
        datasets = data.get("datasets", []) if isinstance(data, dict) else []
        config = create_scatter_chart(datasets, title=title, **kwargs)

    else:
        raise ValueError(f"Unsupported chart type: {chart_type}")

    return client.get_chart_url(config)

def save_chart_image(
    chart_type: str,
    labels: List[str],
    data: Union[List, Dict],
    output_path: str,
    title: Optional[str] = None,
    **kwargs,
) -> str:
    """Generate and save a chart image to a file."""
    from pathlib import Path

    client = QuickChartClient()

    # Build config based on type
    if chart_type == "bar":
        datasets = [{"label": title or "Data", "data": data}] if isinstance(data, list) else data.get("datasets", [])
        config = create_bar_chart(labels, datasets, title=title, **kwargs)
    elif chart_type == "line":
        datasets = [{"label": title or "Data", "data": data}] if isinstance(data, list) else data.get("datasets", [])
        config = create_line_chart(labels, datasets, title=title, **kwargs)
    elif chart_type in ("pie", "doughnut"):
        config = create_pie_chart(labels, data if isinstance(data, list) else [], title=title, doughnut=(chart_type == "doughnut"), **kwargs)
    else:
        raise ValueError(f"Unsupported chart type: {chart_type}")

    # Download and save
    image_bytes = client.get_chart_bytes(config)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_bytes)

    return str(output_path)

"""Service for automatic chart generation using AI."""

import logging
from typing import Any, Dict, List, Optional

from backend.app.services.llm import get_llm_client
from backend.app.services.infra_services import extract_json_array_from_llm_response

logger = logging.getLogger("neura.domain.charts")

class AutoChartService:
    """Service for automatic chart generation."""

    def __init__(self):
        self._llm_client = None

    def _get_llm_client(self):
        if self._llm_client is None:
            self._llm_client = get_llm_client()
        return self._llm_client

    def analyze_data_for_charts(
        self,
        data: List[Dict[str, Any]],
        column_descriptions: Optional[Dict[str, str]] = None,
        max_suggestions: int = 3,
        correlation_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Analyze data and suggest appropriate chart visualizations."""
        logger.info("Analyzing data for chart suggestions", extra={"correlation_id": correlation_id})

        if not data:
            return []

        # Analyze columns
        columns = list(data[0].keys()) if data else []
        column_stats = {}

        for col in columns:
            values = [row.get(col) for row in data if row.get(col) is not None]
            if not values:
                continue

            # Determine type
            sample = values[0]
            if isinstance(sample, (int, float)):
                col_type = "numeric"
            elif isinstance(sample, bool):
                col_type = "boolean"
            else:
                unique_ratio = len(set(str(v) for v in values)) / len(values)
                col_type = "categorical" if unique_ratio < 0.5 else "text"

            column_stats[col] = {
                "type": col_type,
                "unique_count": len(set(str(v) for v in values)),
                "sample_values": [str(v) for v in values[:3]],
            }

        # Build prompt
        prompt = f"""Analyze this data structure and suggest appropriate chart visualizations.

COLUMNS:
{column_stats}

{f"COLUMN DESCRIPTIONS: {column_descriptions}" if column_descriptions else ""}

Suggest up to {max_suggestions} charts. For each chart, provide:
- type: "bar", "line", "pie", or "scatter"
- title: Descriptive chart title
- xField: Column for X-axis
- yFields: Array of columns for Y-axis
- description: Why this visualization is useful

Return a JSON array:
[
  {{
    "type": "bar",
    "title": "Chart Title",
    "xField": "column_name",
    "yFields": ["value_column"],
    "description": "Shows distribution of values"
  }}
]

Return ONLY the JSON array."""

        try:
            client = self._get_llm_client()
            response = client.complete(
                messages=[{"role": "user", "content": prompt}],
                description="chart_suggestions",
                temperature=0.5,
            )

            content = response["choices"][0]["message"]["content"]
            suggestions = extract_json_array_from_llm_response(content, default=[])
            if suggestions:
                return suggestions[:max_suggestions]

        except Exception as exc:
            logger.error(f"Chart suggestion failed: {exc}")

        # Fallback: suggest basic charts
        numeric_cols = [c for c, s in column_stats.items() if s["type"] == "numeric"]
        categorical_cols = [c for c, s in column_stats.items() if s["type"] == "categorical"]

        suggestions = []
        if numeric_cols and categorical_cols:
            suggestions.append({
                "type": "bar",
                "title": f"{numeric_cols[0]} by {categorical_cols[0]}",
                "xField": categorical_cols[0],
                "yFields": [numeric_cols[0]],
                "description": "Bar chart showing values by category",
            })

        return suggestions

    def generate_chart_config(
        self,
        data: List[Dict[str, Any]],
        chart_type: str,
        x_field: str,
        y_fields: List[str],
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a complete chart configuration."""
        return {
            "type": chart_type,
            "title": title or f"{', '.join(y_fields)} by {x_field}",
            "xField": x_field,
            "yFields": y_fields,
            "data": data,
            "config": {
                "responsive": True,
                "maintainAspectRatio": True,
            },
        }

import json
from typing import Any, Callable, Mapping, Optional

from fastapi import HTTPException

from backend.app.services.reports import build_discovery_schema, build_resample_support
from backend.app.repositories import state_store

def discover_reports(
    payload,
    *,
    kind: str,
    template_dir_fn: Callable[[str], Any],
    db_path_fn: Callable[[Optional[str]], Any],
    load_contract_fn: Callable[[Any], Any],
    clean_key_values_fn: Callable[[Optional[dict]], Optional[dict]],
    discover_fn: Callable[..., Mapping[str, Any]],
    build_field_catalog_fn: Callable[[list], tuple[list, Mapping[str, Any]]],
    build_batch_metrics_fn: Callable[[list, Mapping[str, Any]], list],
    load_manifest_fn: Callable[[Any], Mapping[str, Any]],
    manifest_endpoint_fn: Callable[[str], str],
    logger,
):
    def _normalize_field_catalog(raw_catalog) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        if not isinstance(raw_catalog, list):
            return normalized
        for entry in raw_catalog:
            if not isinstance(entry, Mapping):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            field_type = str(entry.get("type") or "unknown").strip()
            description = str(entry.get("description") or "").strip()
            source = str(entry.get("source") or entry.get("table") or "computed").strip() or "computed"
            normalized.append(
                {
                    "name": name,
                    "type": field_type,
                    "description": description,
                    "source": source,
                }
            )
        return normalized

    template_dir = template_dir_fn(payload.template_id)
    db_path = db_path_fn(payload.connection_id)
    if not db_path.exists():
        logger.error("Database not found at path %s for connection_id=%s", db_path, payload.connection_id)
        raise HTTPException(status_code=400, detail={"code": "db_not_found", "message": "Database not found for the specified connection."})

    try:
        load_contract_fn(template_dir)
    except Exception as exc:
        logger.exception(
            "contract_artifacts_load_failed",
            extra={
                "event": "contract_artifacts_load_failed",
                "template_id": payload.template_id,
            },
        )
        raise HTTPException(status_code=500, detail={"code": "contract_load_failed", "message": "Failed to load contract artifacts."})

    contract_path = template_dir / "contract.json"
    if not contract_path.exists():
        raise HTTPException(
            status_code=400,
            detail={"code": "contract_not_ready", "message": "Contract artifacts missing. Approve mapping first."},
        )
    try:
        contract_payload = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.exception("Invalid contract.json for template_id=%s", payload.template_id)
        raise HTTPException(status_code=500, detail={"code": "contract_invalid", "message": "Invalid contract configuration."})

    key_values_payload = clean_key_values_fn(payload.key_values)
    try:
        summary = discover_fn(
            db_path=db_path,
            contract=contract_payload,
            start_date=payload.start_date,
            end_date=payload.end_date,
            key_values=key_values_payload,
        )
    except Exception as exc:
        logger.exception("Discovery failed for template_id=%s, connection_id=%s", payload.template_id, payload.connection_id)
        detail_msg = f"Discovery failed: {type(exc).__name__}"
        if str(exc):
            detail_msg += f": {str(exc)[:200]}"
        raise HTTPException(status_code=500, detail={"code": "discovery_failed", "message": detail_msg})

    manifest_data = load_manifest_fn(template_dir) or {}
    manifest_url = manifest_endpoint_fn(payload.template_id)
    tpl_record = state_store.get_template_record(payload.template_id) or {}
    tpl_name = tpl_record.get("name") or f"Template {payload.template_id[:8]}"
    state_store.set_last_used(payload.connection_id, payload.template_id)

    batches_raw = summary.get("batches") or []
    if not isinstance(batches_raw, list):
        batches_raw = []

    raw_batch_metadata = summary.get("batch_metadata")
    batch_metadata: dict[str, dict[str, object]] = raw_batch_metadata if isinstance(raw_batch_metadata, Mapping) else {}

    raw_field_catalog = summary.get("field_catalog")
    raw_stats = summary.get("data_stats")
    if not isinstance(raw_field_catalog, list):
        raw_field_catalog, raw_stats = build_field_catalog_fn(batches_raw)
    field_catalog = _normalize_field_catalog(raw_field_catalog)
    if not field_catalog:
        fallback_catalog, raw_stats = build_field_catalog_fn(batches_raw)
        field_catalog = _normalize_field_catalog(fallback_catalog)
    data_stats = raw_stats if isinstance(raw_stats, Mapping) else {}

    discovery_schema = summary.get("discovery_schema")
    if not isinstance(discovery_schema, Mapping):
        discovery_schema = build_discovery_schema(field_catalog)

    batch_metrics = summary.get("batch_metrics")
    if not isinstance(batch_metrics, list):
        batch_metrics = build_batch_metrics_fn(batches_raw, batch_metadata)
    batch_metrics = batch_metrics if isinstance(batch_metrics, list) else []

    numeric_bins = summary.get("numeric_bins")
    category_groups = summary.get("category_groups")
    if not isinstance(numeric_bins, Mapping) or not isinstance(category_groups, Mapping):
        resample_support = build_resample_support(
            field_catalog,
            batch_metrics,
            schema=discovery_schema,
            default_metric=(discovery_schema or {}).get("defaults", {}).get("metric"),
        )
        numeric_bins = resample_support.get("numeric_bins", {})
        category_groups = resample_support.get("category_groups", {})

    def _time_bounds() -> tuple[str | None, str | None]:
        timestamps = []
        for meta in batch_metadata.values():
            if not isinstance(meta, Mapping):
                continue
            ts = meta.get("time")
            if ts:
                timestamps.append(ts)
        if not timestamps:
            return None, None
        try:
            ts_sorted = sorted(timestamps)
            return ts_sorted[0], ts_sorted[-1]
        except Exception:
            return None, None

    time_start, time_end = _time_bounds()

    return {
        "template_id": payload.template_id,
        "name": tpl_name,
        "batches": [
            {
                "id": b["id"],
                "rows": b["rows"],
                "parent": b["parent"],
                "selected": True,
                "time": (batch_metadata.get(str(b["id"])) or {}).get("time"),
                "category": (batch_metadata.get(str(b["id"])) or {}).get("category"),
            }
            for b in batches_raw
        ],
        "batches_count": summary["batches_count"],
        "rows_total": summary["rows_total"],
        "manifest_url": manifest_url,
        "manifest_produced_at": manifest_data.get("produced_at"),
        "field_catalog": field_catalog,
        "batch_metrics": batch_metrics,
        "discovery_schema": discovery_schema,
        "numeric_bins": numeric_bins,
        "category_groups": category_groups,
        "date_range": {
            "start": payload.start_date,
            "end": payload.end_date,
            "time_start": time_start,
            "time_end": time_end,
        },
        "data_stats": data_stats,
    }

import json
from typing import Any, Callable, Mapping, Optional, Sequence

from fastapi import HTTPException

from backend.app.services.ai_services import CHART_TEMPLATE_CATALOG
from backend.app.repositories import state_store
from backend.app.schemas import ChartSpec, ChartSuggestPayload, ChartSuggestResponse

VALID_CHART_TYPES = {"bar", "line", "pie", "scatter"}
VALID_AGGREGATIONS = {"sum", "avg", "count", "none"}
NUMERIC_TYPES = {"number", "numeric", "float", "int", "integer", "decimal"}
DATETIME_TYPES = {"datetime", "date", "timestamp", "time"}
CATEGORICAL_TYPES = {"string", "category", "categorical", "text"}

def _field_category(raw_type: Any) -> str:
    normalized = str(raw_type or "").strip().lower()
    if normalized in NUMERIC_TYPES:
        return "numeric"
    if normalized in DATETIME_TYPES:
        return "datetime"
    return "categorical"

def _build_field_lookup(field_catalog: Sequence[Mapping[str, Any]] | None) -> dict[str, tuple[str, str]]:
    lookup: dict[str, tuple[str, str]] = {}
    for field in field_catalog or []:
        if not isinstance(field, Mapping):
            continue
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        field_type = str(field.get("type") or "").strip().lower() or "string"
        lookup[name.lower()] = (name, field_type)
    return lookup

def _normalize_chart_type(raw: Any) -> str | None:
    text = str(raw or "").strip().lower()
    if not text:
        return None
    alias_map = {
        "barchart": "bar",
        "bar chart": "bar",
        "column": "bar",
        "columnchart": "bar",
        "linechart": "line",
        "line chart": "line",
        "piechart": "pie",
        "scatterplot": "scatter",
        "scatter plot": "scatter",
    }
    candidates = {
        text,
        text.replace("_", " "),
        text.replace("-", " "),
        text.replace("chart", "").strip(),
        text.replace("chart", "").replace("_", " ").replace("-", " ").strip(),
    }
    for candidate in candidates:
        candidate_clean = candidate.replace(" ", "")
        if candidate in VALID_CHART_TYPES:
            return candidate
        if candidate_clean in VALID_CHART_TYPES:
            return candidate_clean
        if candidate_clean in alias_map:
            return alias_map[candidate_clean]
    return None

def _normalize_aggregation(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if not text:
        return None
    return text if text in VALID_AGGREGATIONS else None

def _normalize_field_name(raw: Any, field_lookup: Mapping[str, tuple[str, str]]) -> tuple[str | None, str | None]:
    text = str(raw or "").strip()
    if not text:
        return None, None
    match = field_lookup.get(text.lower())
    if not match:
        return None, None
    return match

def _normalize_template_id(raw: Any, *, chart_type: str, x_category: str, y_fields: Sequence[str]) -> str | None:
    template_id = str(raw or "").strip()
    if not template_id or template_id not in CHART_TEMPLATE_CATALOG:
        return None
    if template_id == "time_series_basic":
        if x_category not in {"numeric", "datetime"} or not y_fields or chart_type not in {"line", "bar"}:
            return None
    elif template_id == "top_n_categories":
        if x_category != "categorical" or len(y_fields) != 1:
            return None
    elif template_id == "distribution_histogram":
        if x_category != "numeric" or chart_type not in {"bar", "line"}:
            return None
    return template_id

def _normalize_chart_suggestion(
    item: Mapping[str, Any],
    *,
    idx: int,
    field_lookup: Mapping[str, tuple[str, str]],
) -> ChartSpec | None:
    if not isinstance(item, Mapping):
        return None

    chart_type = _normalize_chart_type(item.get("type"))
    if not chart_type:
        return None

    x_field, x_type = _normalize_field_name(item.get("xField"), field_lookup)
    if not x_field:
        return None

    y_fields_raw = item.get("yFields")
    y_candidates: Sequence[Any] | None
    if isinstance(y_fields_raw, str):
        y_candidates = [y_fields_raw]
    elif isinstance(y_fields_raw, Sequence):
        y_candidates = y_fields_raw
    else:
        single = item.get("yField") or item.get("y")
        if isinstance(single, str) and single.strip():
            y_candidates = [single]
        else:
            return None

    y_field_info: list[tuple[str, str]] = []
    seen_y: set[str] = set()
    for raw_y in y_candidates:
        name, ftype = _normalize_field_name(raw_y, field_lookup)
        if not name or name in seen_y:
            continue
        y_field_info.append((name, ftype or "string"))
        seen_y.add(name)
    if not y_field_info:
        return None

    group_field, group_type = _normalize_field_name(item.get("groupField"), field_lookup)
    if group_field and _field_category(group_type) != "categorical":
        group_field = None

    x_category = _field_category(x_type)
    numeric_y_fields = [name for name, ftype in y_field_info if _field_category(ftype) == "numeric"]

    if chart_type == "pie":
        if x_category != "categorical":
            return None
        if not numeric_y_fields:
            return None
        y_fields = [numeric_y_fields[0]]
    else:
        if chart_type in ("line", "scatter") and x_category not in {"numeric", "datetime"}:
            return None
        if chart_type == "bar" and x_category not in {"numeric", "datetime", "categorical"}:
            return None
        if not numeric_y_fields:
            return None
        y_fields = numeric_y_fields

    aggregation = _normalize_aggregation(item.get("aggregation"))
    chart_template_id = _normalize_template_id(
        item.get("chartTemplateId"),
        chart_type=chart_type,
        x_category=x_category,
        y_fields=y_fields,
    )

    style = item.get("style")
    style_payload = dict(style) if isinstance(style, Mapping) else None

    normalized: dict[str, Any] = {
        "id": str(item.get("id") or f"chart_{idx + 1}"),
        "type": chart_type,
        "xField": x_field,
        "yFields": y_fields,
        "groupField": group_field,
        "aggregation": aggregation,
        "chartTemplateId": chart_template_id,
        "style": style_payload,
    }
    title = item.get("title")
    description = item.get("description")
    if isinstance(title, str) and title.strip():
        normalized["title"] = title.strip()
    if isinstance(description, str) and description.strip():
        normalized["description"] = description.strip()

    try:
        return ChartSpec(**normalized)
    except Exception:
        return None

def suggest_charts(
    template_id: str,
    payload: ChartSuggestPayload,
    *,
    kind: str,
    correlation_id: Optional[str],
    template_dir_fn: Callable[[str], Any],
    db_path_fn: Callable[[Optional[str]], Any],
    load_contract_fn: Callable[[Any], Any],
    clean_key_values_fn: Callable[[Optional[dict]], Optional[dict]],
    discover_fn: Callable[..., Mapping[str, Any]],
    build_field_catalog_fn: Callable[[list], tuple[list, Mapping[str, Any]]],
    build_metrics_fn: Callable[[list, Mapping[str, Any], int], list],
    build_prompt_fn: Callable[..., str],
    call_chat_completion_fn: Callable[..., Any],
    model: str,
    strip_code_fences_fn: Callable[[str], str],
    logger,
) -> ChartSuggestResponse:
    template_dir = template_dir_fn(template_id)
    db_path = db_path_fn(payload.connection_id)
    if not db_path.exists():
        logger.error("Database not found at path: %s", db_path)
        raise HTTPException(status_code=400, detail={"code": "db_not_found", "message": "Database not found for the given connection."})

    try:
        load_contract_fn(template_dir)
    except Exception as exc:
        logger.exception(
            "chart_suggest_contract_load_failed",
            extra={
                "event": "chart_suggest_contract_load_failed",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        raise HTTPException(status_code=500, detail={"code": "contract_load_failed", "message": "Failed to load contract artifacts."})

    contract_path = template_dir / "contract.json"
    if not contract_path.exists():
        raise HTTPException(
            status_code=400,
            detail={"code": "contract_not_ready", "message": "Contract artifacts missing. Approve mapping first."},
        )
    try:
        contract_payload = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.exception(
            "chart_suggest_contract_parse_failed",
            extra={
                "event": "chart_suggest_contract_parse_failed",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        raise HTTPException(status_code=500, detail={"code": "contract_invalid", "message": "Invalid contract configuration."})

    key_values_payload = clean_key_values_fn(payload.key_values)

    try:
        summary = discover_fn(
            db_path=db_path,
            contract=contract_payload,
            start_date=payload.start_date,
            end_date=payload.end_date,
            key_values=key_values_payload,
        )
    except Exception as exc:
        logger.exception(
            "chart_suggest_discovery_failed",
            extra={
                "event": "chart_suggest_discovery_failed",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        raise HTTPException(status_code=500, detail={"code": "discovery_failed", "message": "Data discovery failed."})

    batches = summary.get("batches") or []
    if not isinstance(batches, list):
        batches = []
    batch_metadata = summary.get("batch_metadata") or {}

    sample_data: list[dict[str, Any]] | None = None
    if payload.include_sample_data:
        try:
            sample_data = build_metrics_fn(batches, batch_metadata, limit=100)
        except Exception:
            sample_data = None
            logger.exception(
                "chart_suggest_sample_data_failed",
                extra={
                    "event": "chart_suggest_sample_data_failed",
                    "template_id": template_id,
                    "template_kind": kind,
                    "correlation_id": correlation_id,
                },
            )

    if not batches:
        logger.info(
            "chart_suggest_no_data",
            extra={
                "event": "chart_suggest_no_data",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        sample_payload = sample_data if payload.include_sample_data else None
        if sample_payload is None and payload.include_sample_data:
            sample_payload = []
        return ChartSuggestResponse(charts=[], sample_data=sample_payload)

    field_catalog, stats = build_field_catalog_fn(batches)

    prompt = build_prompt_fn(
        template_id=template_id,
        kind=kind,
        start_date=payload.start_date,
        end_date=payload.end_date,
        key_values=key_values_payload,
        field_catalog=field_catalog,
        data_stats=stats,
        question=payload.question,
    )

    try:
        response = call_chat_completion_fn(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        logger.exception(
            "chart_suggest_llm_failed",
            extra={
                "event": "chart_suggest_llm_failed",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        raise HTTPException(status_code=500, detail={"code": "chart_suggest_llm_failed", "message": "Chart suggestion generation failed."})

    raw_text = (response.choices[0].message.content or "").strip()
    parsed_text = strip_code_fences_fn(raw_text)

    charts: list[ChartSpec] = []
    field_lookup = _build_field_lookup(field_catalog)
    try:
        payload_json = json.loads(parsed_text)
    except Exception:
        logger.warning(
            "chart_suggest_json_parse_failed",
            extra={
                "event": "chart_suggest_json_parse_failed",
                "template_id": template_id,
                "template_kind": kind,
                "correlation_id": correlation_id,
            },
        )
        payload_json = {}

    raw_charts = payload_json.get("charts") if isinstance(payload_json, dict) else None
    if isinstance(raw_charts, list):
        for idx, item in enumerate(raw_charts):
            chart = _normalize_chart_suggestion(item, idx=idx, field_lookup=field_lookup)
            if chart:
                charts.append(chart)

    # Auto-correct: if no charts parsed, fall back to a simple default set based on available fields.
    if not charts:
        numeric_fields = [name for name, ftype in field_lookup.values() if _field_category(ftype) == "numeric"]
        time_like = [name for name, ftype in field_lookup.values() if _field_category(ftype) == "datetime"]
        categorical_fields = [name for name, ftype in field_lookup.values() if _field_category(ftype) == "categorical"]
        fallback_id = 0

        def _next_id():
            nonlocal fallback_id
            fallback_id += 1
            return f"fallback_{fallback_id}"

        if time_like and numeric_fields:
            charts.append(
                ChartSpec(
                    id=_next_id(),
                    type="line",
                    xField=time_like[0],
                    yFields=[numeric_fields[0]],
                    groupField=None,
                    aggregation="sum",
                    chartTemplateId="time_series_basic",
                    title=f"{numeric_fields[0]} over time",
                )
            )
        if categorical_fields and numeric_fields:
            charts.append(
                ChartSpec(
                    id=_next_id(),
                    type="bar",
                    xField=categorical_fields[0],
                    yFields=[numeric_fields[0]],
                    groupField=None,
                    aggregation="sum",
                    chartTemplateId="top_n_categories",
                    title=f"Top categories by {numeric_fields[0]}",
                )
            )
        if numeric_fields:
            charts.append(
                ChartSpec(
                    id=_next_id(),
                    type="bar",
                    xField=numeric_fields[0],
                    yFields=[numeric_fields[0]],
                    groupField=None,
                    aggregation="count",
                    chartTemplateId="distribution_histogram",
                    title=f"{numeric_fields[0]} distribution",
                )
            )

    state_store.set_last_used(payload.connection_id, template_id)

    logger.info(
        "chart_suggest_complete",
        extra={
            "event": "chart_suggest_complete",
            "template_id": template_id,
            "template_kind": kind,
            "charts_returned": len(charts),
            "correlation_id": correlation_id,
        },
    )
    return ChartSuggestResponse(
        charts=charts,
        sample_data=sample_data if payload.include_sample_data else None,
    )

from typing import Callable

from fastapi import HTTPException

from backend.app.repositories import state_store
from backend.app.schemas import SavedChartCreatePayload, SavedChartSpec, SavedChartUpdatePayload

def _serialize_saved_chart(record: dict) -> SavedChartSpec:
    spec_payload = record.get("spec") or {}
    return SavedChartSpec(
        id=record["id"],
        template_id=record["template_id"],
        name=record["name"],
        spec=spec_payload,
        created_at=record.get("created_at", ""),
        updated_at=record.get("updated_at", ""),
    )

EnsureTemplateExistsFn = Callable[[str], tuple[str, dict]]
NormalizeTemplateIdFn = Callable[[str], str]

def list_saved_charts(template_id: str, ensure_template_exists: EnsureTemplateExistsFn) -> dict:
    normalized, _ = ensure_template_exists(template_id)
    records = state_store.list_saved_charts(normalized)
    charts = [_serialize_saved_chart(rec) for rec in records]
    return {"charts": charts}

def create_saved_chart(
    template_id: str,
    payload: SavedChartCreatePayload,
    ensure_template_exists: EnsureTemplateExistsFn,
    normalize_template_id: NormalizeTemplateIdFn,
):
    path_template, _ = ensure_template_exists(template_id)
    body_template = normalize_template_id(payload.template_id)
    if body_template != path_template:
        raise HTTPException(status_code=400, detail={"code": "template_mismatch", "message": "template_id in path and payload must match"})
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail={"code": "name_required", "message": "Saved chart name is required."})
    record = state_store.create_saved_chart(path_template, name, payload.spec.model_dump())
    return _serialize_saved_chart(record)

def update_saved_chart(
    template_id: str,
    chart_id: str,
    payload: SavedChartUpdatePayload,
    ensure_template_exists: EnsureTemplateExistsFn,
):
    path_template, _ = ensure_template_exists(template_id)
    existing = state_store.get_saved_chart(chart_id)
    if not existing or existing.get("template_id") != path_template:
        raise HTTPException(status_code=404, detail={"code": "chart_not_found", "message": "Saved chart not found."})
    updates: dict[str, object] = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail={"code": "name_required", "message": "Saved chart name cannot be empty."})
        updates["name"] = name
    if payload.spec is not None:
        updates["spec"] = payload.spec.model_dump()
    if not updates:
        return _serialize_saved_chart(existing)
    record = state_store.update_saved_chart(chart_id, name=updates.get("name"), spec=updates.get("spec"))
    if not record:
        raise HTTPException(status_code=404, detail={"code": "chart_not_found", "message": "Saved chart not found."})
    return _serialize_saved_chart(record)

def delete_saved_chart(template_id: str, chart_id: str, ensure_template_exists: EnsureTemplateExistsFn):
    path_template, _ = ensure_template_exists(template_id)
    existing = state_store.get_saved_chart(chart_id)
    if not existing or existing.get("template_id") != path_template:
        raise HTTPException(status_code=404, detail={"code": "chart_not_found", "message": "Saved chart not found."})
    removed = state_store.delete_saved_chart(chart_id)
    if not removed:
        raise HTTPException(status_code=404, detail={"code": "chart_not_found", "message": "Saved chart not found."})
    return {"status": "ok"}
