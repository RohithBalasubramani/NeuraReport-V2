# mypy: ignore-errors
"""
Observability module (merged from V1 observability/).

Provides:
- Prometheus metrics middleware for FastAPI
- OpenTelemetry tracing setup
- @trace decorator with span recording
- CostTracker for per-operation token and cost accounting

All external dependencies (prometheus_client, opentelemetry) are conditionally imported.
"""
from __future__ import annotations

import functools
import inspect
import json
import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple, TypeVar, cast

logger = logging.getLogger("neura.observability")

F = TypeVar("F", bound=Callable[..., Any])


# =========================================================================== #
#  Section 1: Prometheus Metrics                                              #
# =========================================================================== #

try:
    from prometheus_client import Counter, Gauge, Histogram, Info, REGISTRY
    from prometheus_client.openmetrics.exposition import CONTENT_TYPE_LATEST, generate_latest
    _prometheus_available = True
except ImportError:
    _prometheus_available = False
    Counter = Gauge = Histogram = Info = REGISTRY = None
    CONTENT_TYPE_LATEST = "text/plain"
    generate_latest = lambda *a, **kw: b""

try:
    from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.routing import Match
    from starlette.status import HTTP_500_INTERNAL_SERVER_ERROR
    _starlette_available = True
except ImportError:
    _starlette_available = False

try:
    from opentelemetry import trace as otel_trace
    _HAS_OTEL = True
except ImportError:
    _HAS_OTEL = False

# Create metric instances (or None placeholders)
if _prometheus_available:
    REQUESTS_TOTAL = Counter("fastapi_requests_total", "Total requests", ["method", "path", "app_name"])
    RESPONSES_TOTAL = Counter("fastapi_responses_total", "Total responses", ["method", "path", "status_code", "app_name"])
    REQUESTS_DURATION = Histogram("fastapi_requests_duration_seconds", "Request duration", ["method", "path", "app_name"], buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0))
    EXCEPTIONS_TOTAL = Counter("fastapi_exceptions_total", "Exceptions", ["method", "path", "exception_type", "app_name"])
    REQUESTS_IN_PROGRESS = Gauge("fastapi_requests_in_progress", "In-progress requests", ["method", "path", "app_name"])
    REPORTS_GENERATED = Counter("neurareport_reports_generated_total", "Reports generated", ["report_type", "status"])
    LLM_INFERENCE_DURATION = Histogram("neurareport_llm_inference_seconds", "LLM inference time", ["model", "operation"], buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0))
    LLM_TOKEN_USAGE = Counter("neurareport_llm_tokens_total", "LLM tokens consumed", ["model", "token_type"])
    QUEUE_DEPTH = Gauge("neurareport_queue_depth", "Queue depth", ["queue_name"])
    ACTIVE_WEBSOCKETS = Gauge("neurareport_active_websocket_connections", "WebSocket connections", ["connection_type"])
    BUILD_INFO = Info("neurareport_build", "Build info")
else:
    REQUESTS_TOTAL = RESPONSES_TOTAL = REQUESTS_DURATION = EXCEPTIONS_TOTAL = None
    REQUESTS_IN_PROGRESS = REPORTS_GENERATED = LLM_INFERENCE_DURATION = None
    LLM_TOKEN_USAGE = QUEUE_DEPTH = ACTIVE_WEBSOCKETS = BUILD_INFO = None


if _starlette_available and _prometheus_available:
    class PrometheusMiddleware(BaseHTTPMiddleware):
        def __init__(self, app, app_name: str = "neurareport-backend"):
            super().__init__(app)
            self.app_name = app_name
            try:
                BUILD_INFO.info({"version": "dev", "app_name": app_name})
            except Exception:
                pass

        async def dispatch(self, request, call_next):
            method = request.method
            path = request.url.path
            for route in getattr(request.app, "routes", []):
                match, _ = route.matches(request.scope)
                if match == Match.FULL:
                    path = route.path
                    break
            if path == "/metrics":
                return await call_next(request)
            REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=self.app_name).inc()
            REQUESTS_TOTAL.labels(method=method, path=path, app_name=self.app_name).inc()
            before = time.perf_counter()
            status_code = 500
            try:
                response = await call_next(request)
                status_code = response.status_code
                return response
            except BaseException as e:
                EXCEPTIONS_TOTAL.labels(method=method, path=path, exception_type=type(e).__name__, app_name=self.app_name).inc()
                raise
            finally:
                REQUESTS_DURATION.labels(method=method, path=path, app_name=self.app_name).observe(time.perf_counter() - before)
                RESPONSES_TOTAL.labels(method=method, path=path, status_code=status_code, app_name=self.app_name).inc()
                REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=self.app_name).dec()

    def metrics_endpoint(request) -> Response:
        return Response(generate_latest(REGISTRY), headers={"Content-Type": CONTENT_TYPE_LATEST})
else:
    PrometheusMiddleware = None
    metrics_endpoint = None


# =========================================================================== #
#  Section 2: Tracing setup                                                   #
# =========================================================================== #

def setup_tracing(app, service_name: str = "neurareport-backend", otlp_endpoint: str = "localhost:4317", **kwargs) -> None:
    try:
        from opentelemetry import trace as _trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.logging import LoggingInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        resource = Resource.create(attributes={"service.name": service_name})
        tracer_provider = TracerProvider(resource=resource)
        _trace.set_tracer_provider(tracer_provider)
        tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)))
        LoggingInstrumentor().instrument(set_logging_format=True)
        FastAPIInstrumentor.instrument_app(app, tracer_provider=tracer_provider)
        logger.info("tracing_configured", extra={"event": "tracing_configured", "endpoint": otlp_endpoint})
    except ImportError:
        logger.warning("opentelemetry not installed, tracing disabled")
    except Exception as exc:
        logger.warning("tracing setup failed", extra={"error": str(exc)})


# =========================================================================== #
#  Section 3: Span Collector and @trace decorator                             #
# =========================================================================== #

@dataclass
class SpanRecord:
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
    def __init__(self, maxlen: int = 1000) -> None:
        self._spans: Deque[SpanRecord] = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    def record(self, span: SpanRecord) -> None:
        with self._lock:
            self._spans.append(span)

    def get_recent(self, n: int = 100) -> List[SpanRecord]:
        with self._lock:
            return list(self._spans)[-n:]

    def get_stats(self, operation: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            spans = [s for s in self._spans if operation is None or s.operation == operation]
        if not spans:
            return {"operation": operation or "__all__", "count": 0, "success_rate": 0.0, "p50_ms": 0.0, "p95_ms": 0.0}
        durations = sorted(s.duration_ms for s in spans)
        count = len(spans)
        def _pct(vals, p):
            return round(vals[int(p / 100.0 * (len(vals) - 1))], 3)
        return {"operation": operation or "__all__", "count": count, "success_rate": round(sum(1 for s in spans if s.success) / count, 4), "p50_ms": _pct(durations, 50), "p95_ms": _pct(durations, 95)}


_collector = SpanCollector()


def get_span_collector() -> SpanCollector:
    return _collector


def trace(operation: Optional[str] = None, record_cost: bool = False) -> Callable[[F], F]:
    def decorator(fn: F) -> F:
        op_name = operation or f"{fn.__module__}.{fn.__qualname__}"
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                start = time.perf_counter()
                error_msg: Optional[str] = None
                success = True
                result: Any = None
                try:
                    result = await fn(*args, **kwargs)
                    return result
                except Exception as exc:
                    success = False
                    error_msg = f"{type(exc).__name__}: {exc}"
                    raise
                finally:
                    _finish_span(op_name=op_name, start=start, end=time.perf_counter(), success=success, error_msg=error_msg, result=result, record_cost=record_cost)
            return cast(F, async_wrapper)
        else:
            @functools.wraps(fn)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                start = time.perf_counter()
                error_msg: Optional[str] = None
                success = True
                result: Any = None
                try:
                    result = fn(*args, **kwargs)
                    return result
                except Exception as exc:
                    success = False
                    error_msg = f"{type(exc).__name__}: {exc}"
                    raise
                finally:
                    _finish_span(op_name=op_name, start=start, end=time.perf_counter(), success=success, error_msg=error_msg, result=result, record_cost=record_cost)
            return cast(F, sync_wrapper)
    return decorator


def _finish_span(*, op_name, start, end, success, error_msg, result, record_cost):
    span = SpanRecord(operation=op_name, start_time=start, end_time=end, success=success, error=error_msg, metadata={"latency_ms": round((end - start) * 1000.0, 3)})
    _collector.record(span)
    if _prometheus_available and LLM_INFERENCE_DURATION and op_name.startswith(("llm_", "agent_")):
        try:
            LLM_INFERENCE_DURATION.labels(model="unknown", operation=op_name).observe(end - start)
        except Exception:
            pass
    if record_cost and success and isinstance(result, dict):
        usage = result.get("usage")
        if isinstance(usage, dict):
            try:
                get_cost_tracker().record(operation=op_name, model=result.get("model", "unknown"), input_tokens=usage.get("prompt_tokens", 0), output_tokens=usage.get("completion_tokens", 0))
            except Exception:
                pass


# =========================================================================== #
#  Section 4: Cost Tracker                                                    #
# =========================================================================== #

def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    costs = {"qwen": {"input": 0.0, "output": 0.0}}
    c = costs.get(model, {"input": 0.0, "output": 0.0})
    return (input_tokens / 1000) * c["input"] + (output_tokens / 1000) * c["output"]


@dataclass
class OperationRecord:
    operation: str
    model: str
    input_tokens: int
    output_tokens: int
    cost: float
    timestamp: float = field(default_factory=time.time)


@dataclass
class CostBudget:
    daily_limit_usd: float = 50.0
    monthly_limit_usd: float = 1000.0
    alert_threshold_pct: float = 0.8


class CostTracker:
    def __init__(self, budget: Optional[CostBudget] = None, persist_dir: Optional[str] = None) -> None:
        self._budget = budget or CostBudget()
        self._persist_dir: Optional[Path] = Path(persist_dir) if persist_dir else None
        self._lock = threading.Lock()
        self._history: Dict[str, List[OperationRecord]] = defaultdict(list)
        self._daily_rollups: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"total_input_tokens": 0, "total_output_tokens": 0, "total_cost": 0.0, "request_count": 0, "by_operation": defaultdict(lambda: {"input_tokens": 0, "output_tokens": 0, "cost": 0.0, "count": 0})})
        if self._persist_dir:
            self._persist_dir.mkdir(parents=True, exist_ok=True)

    def record(self, operation: str, model: str, input_tokens: int, output_tokens: int) -> OperationRecord:
        cost = _estimate_cost(model, input_tokens, output_tokens)
        rec = OperationRecord(operation=operation, model=model, input_tokens=input_tokens, output_tokens=output_tokens, cost=cost)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with self._lock:
            self._history[operation].append(rec)
            rollup = self._daily_rollups[today]
            rollup["total_input_tokens"] += input_tokens
            rollup["total_output_tokens"] += output_tokens
            rollup["total_cost"] += cost
            rollup["request_count"] += 1
            op_r = rollup["by_operation"][operation]
            op_r["input_tokens"] += input_tokens
            op_r["output_tokens"] += output_tokens
            op_r["cost"] += cost
            op_r["count"] += 1
        return rec

    def get_daily_rollup(self, target_date: Optional[date] = None) -> Dict[str, Any]:
        if target_date is None:
            target_date = datetime.now(timezone.utc).date()
        ds = target_date.strftime("%Y-%m-%d")
        with self._lock:
            if ds in self._daily_rollups:
                r = self._daily_rollups[ds]
                return {"date": ds, "total_input_tokens": r["total_input_tokens"], "total_output_tokens": r["total_output_tokens"], "total_cost": round(r["total_cost"], 6), "request_count": r["request_count"]}
        return {"date": ds, "total_input_tokens": 0, "total_output_tokens": 0, "total_cost": 0.0, "request_count": 0}

    def get_all_stats(self) -> Dict[str, Any]:
        with self._lock:
            ti = to = 0
            tc = 0.0
            tr = 0
            for records in self._history.values():
                for r in records:
                    ti += r.input_tokens
                    to += r.output_tokens
                    tc += r.cost
                    tr += 1
        return {"total_input_tokens": ti, "total_output_tokens": to, "total_cost": round(tc, 6), "total_requests": tr}

    def check_budget(self) -> Dict[str, Any]:
        daily = self.get_daily_rollup()
        used = daily["total_cost"]
        limit = self._budget.daily_limit_usd
        return {"within_budget": used < limit, "daily_used": round(used, 6), "daily_limit": limit, "alert": used >= limit * self._budget.alert_threshold_pct}

    def get_operation_stats(self, operation: str) -> Dict[str, Any]:
        """Return aggregate stats for a single operation."""
        with self._lock:
            records = self._history.get(operation, [])
            ti = sum(r.input_tokens for r in records)
            to = sum(r.output_tokens for r in records)
            tc = sum(r.cost for r in records)
        return {"operation": operation, "total_input_tokens": ti, "total_output_tokens": to, "total_cost": round(tc, 6), "request_count": len(records)}

    def export_to_prometheus(self) -> None:
        """Push accumulated token counts to Prometheus LLM_TOKEN_USAGE counter."""
        try:
            from prometheus_client import Counter
            llm_usage = Counter("llm_token_usage_total", "Total LLM token usage", ["operation", "token_type"])
            with self._lock:
                for op, records in self._history.items():
                    for r in records:
                        llm_usage.labels(operation=op, token_type="input").inc(r.input_tokens)
                        llm_usage.labels(operation=op, token_type="output").inc(r.output_tokens)
        except ImportError:
            pass

    def _persist_daily(self) -> None:
        """Persist daily rollups to disk."""
        if not self._persist_dir:
            return
        with self._lock:
            for ds, rollup in self._daily_rollups.items():
                path = self._persist_dir / f"cost_{ds}.json"
                try:
                    import json
                    data = {"date": ds, "total_input_tokens": rollup["total_input_tokens"], "total_output_tokens": rollup["total_output_tokens"], "total_cost": rollup["total_cost"], "request_count": rollup["request_count"]}
                    path.write_text(json.dumps(data, indent=2))
                except Exception:
                    pass

    def _load_daily(self) -> None:
        """Load persisted daily rollups from disk."""
        if not self._persist_dir or not self._persist_dir.exists():
            return
        import json
        with self._lock:
            for path in self._persist_dir.glob("cost_*.json"):
                try:
                    data = json.loads(path.read_text())
                    ds = data.get("date", "")
                    if ds and ds not in self._daily_rollups:
                        self._daily_rollups[ds]["total_input_tokens"] = data.get("total_input_tokens", 0)
                        self._daily_rollups[ds]["total_output_tokens"] = data.get("total_output_tokens", 0)
                        self._daily_rollups[ds]["total_cost"] = data.get("total_cost", 0.0)
                        self._daily_rollups[ds]["request_count"] = data.get("request_count", 0)
                except Exception:
                    pass

    def reset(self) -> None:
        with self._lock:
            self._history.clear()
            self._daily_rollups.clear()


_cost_instance: Optional[CostTracker] = None
_cost_lock = threading.Lock()


def get_cost_tracker(budget: Optional[CostBudget] = None, persist_dir: Optional[str] = None) -> CostTracker:
    global _cost_instance
    with _cost_lock:
        if _cost_instance is None:
            _cost_instance = CostTracker(budget=budget, persist_dir=persist_dir)
    return _cost_instance


# =========================================================================== #
#  Section 5: Init helpers for FastAPI                                        #
# =========================================================================== #

def init_metrics(app, *, enabled: bool = True) -> bool:
    if not enabled or not _prometheus_available or PrometheusMiddleware is None:
        return False
    app.add_middleware(PrometheusMiddleware)
    app.add_route("/metrics", metrics_endpoint, methods=["GET"])
    logger.info("metrics_initialized")
    return True


def init_tracing(app, *, otlp_endpoint: Optional[str] = None) -> bool:
    if not otlp_endpoint:
        return False
    try:
        setup_tracing(app, otlp_endpoint=otlp_endpoint)
        return True
    except Exception:
        return False


def init_observability(app, *, otlp_endpoint: Optional[str] = None, metrics_enabled: bool = True) -> Dict[str, Any]:
    return {"tracing": init_tracing(app, otlp_endpoint=otlp_endpoint), "metrics": init_metrics(app, enabled=metrics_enabled)}


__all__ = [
    "PrometheusMiddleware", "metrics_endpoint", "setup_tracing",
    "SpanRecord", "SpanCollector", "get_span_collector", "trace",
    "CostTracker", "CostBudget", "OperationRecord", "get_cost_tracker",
    "init_metrics", "init_tracing", "init_observability",
]
