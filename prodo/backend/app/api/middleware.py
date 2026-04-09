from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.datastructures import MutableHeaders
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

# IdempotencyMiddleware and IdempotencyStore are defined later in this file
try:
    from backend.app.services.platform_services import PrometheusMiddleware, metrics_endpoint
except ImportError:
    PrometheusMiddleware = None  # type: ignore
    metrics_endpoint = None  # type: ignore
from backend.app.services.infra_services import set_correlation_id
from backend.app.services.config import Settings
# UXGovernanceMiddleware and IntentHeaders are defined later in this file (merged from ux_governance.py)

logger = logging.getLogger("neura.api")

# Paths whose request_start / request_complete logs are suppressed to avoid
# bloating the log file with high-frequency polling noise.
_QUIET_PATHS: frozenset[str] = frozenset({
    "/api/v1/health",
    "/api/v1/health/ready",
    "/health",
    "/api/v1/jobs",
})

def _get_client_key(request: Request) -> str:
    """Get unique client identifier for rate limiting."""
    api_key = request.headers.get("x-api-key")
    if api_key:
        return f"key:{api_key[:16]}"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Use last entry (closest to trusted proxy)
        ip = forwarded.split(",")[-1].strip()
        if ip:
            return ip
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"

def _format_rate_limit(requests: int, window_seconds: int) -> str:
    if window_seconds <= 1:
        return f"{requests}/second"
    if window_seconds == 60:
        return f"{requests}/minute"
    if window_seconds == 3600:
        return f"{requests}/hour"
    if window_seconds == 86400:
        return f"{requests}/day"
    return f"{requests}/{window_seconds} second"

def _build_default_limits(settings: Settings) -> list[str]:
    limits: list[str] = []
    if settings.rate_limit_requests > 0 and settings.rate_limit_window_seconds > 0:
        limits.append(_format_rate_limit(settings.rate_limit_requests, settings.rate_limit_window_seconds))
    if settings.rate_limit_burst > 0:
        limits.append(f"{settings.rate_limit_burst}/second")
    return limits

limiter = Limiter(key_func=_get_client_key, default_limits=[], headers_enabled=True)

# Rate limit tier constants for per-endpoint rate limiting
RATE_LIMIT_AI = "5/minute"           # AI generation, LLM calls (most expensive)
RATE_LIMIT_STRICT = "10/minute"      # Ingestion, color generation
RATE_LIMIT_STANDARD = "60/minute"    # Standard mutations, exports
RATE_LIMIT_READ = "120/minute"       # Read-heavy endpoints, search, list
RATE_LIMIT_HEALTH = "300/minute"     # Health checks

def _configure_limiter(settings: Settings) -> None:
    limiter.default_limits = _build_default_limits(settings)

class SecurityHeadersMiddleware:
    """Pure ASGI middleware to add security headers to all responses.

    Migrated from BaseHTTPMiddleware for better performance:
    - No per-request task overhead
    - No memory spooling of response body
    - Preserves contextvars propagation
    """

    def __init__(self, app: ASGIApp, debug_mode: bool = False, csp_connect_origins: list[str] | None = None):
        self.app = app
        self.debug_mode = debug_mode
        self.csp_connect_origins = csp_connect_origins or []
        # Pre-compute CSP since it doesn't change per-request
        self._csp = self._build_csp(debug_mode, self.csp_connect_origins)

    @staticmethod
    def _build_csp(debug_mode: bool, connect_origins: list[str]) -> str:
        """Build Content Security Policy string with configurable connect-src."""
        csp_parts = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'" if debug_mode else "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        ]

        connect_src_origins = ["'self'"]
        if debug_mode:
            connect_src_origins.extend([
                "http://localhost:*",
                "http://127.0.0.1:*",
                "ws://localhost:*",
                "ws://127.0.0.1:*"
            ])
        connect_src_origins.extend(connect_origins)
        csp_parts.append(f"connect-src {' '.join(connect_src_origins)}")

        return "; ".join(csp_parts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_security_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Frame-Options"] = "DENY"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-XSS-Protection"] = "1; mode=block"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["Content-Security-Policy"] = self._csp
                headers["Permissions-Policy"] = (
                    "geolocation=(), microphone=(), camera=()"
                )
            await send(message)

        await self.app(scope, receive, send_with_security_headers)

class RequestTimeoutMiddleware:
    """Pure ASGI middleware to enforce request timeout."""

    def __init__(self, app: ASGIApp, timeout_seconds: int = 300):
        self.app = app
        self.timeout_seconds = timeout_seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        timeout = self.timeout_seconds
        _SLOW_FRAGMENTS = (
            "/stream", "/upload", "/discover",
            "/reports/run", "/jobs/run-report",
            "/excel/reports/run", "/generate-docx",
            "/export/", "/ingestion/",
            "/ai/", "/docqa/", "/docai/",
            "/synthesis/", "/nl2sql/",
            "/agents/", "/workflows/",
            "/enrichment/enrich", "/summary/generate",
        )
        if any(frag in path for frag in _SLOW_FRAGMENTS):
            timeout = timeout * 2

        try:
            await asyncio.wait_for(
                self.app(scope, receive, send),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            logger.error(
                "request_timeout",
                extra={
                    "event": "request_timeout",
                    "path": path,
                    "method": scope.get("method", ""),
                    "timeout": timeout,
                },
            )
            body = (
                b'{"status":"error","code":"request_timeout",'
                b'"message":"Request timed out. Please try again.",'
                b'"timeout_seconds":' + str(timeout).encode() + b'}'
            )
            await send({
                "type": "http.response.start",
                "status": 504,
                "headers": [
                    [b"content-type", b"application/json"],
                    [b"content-length", str(len(body)).encode()],
                ],
            })
            await send({
                "type": "http.response.body",
                "body": body,
            })

class CorrelationIdMiddleware:
    """Pure ASGI middleware for correlation ID and request logging.

    Migrated from BaseHTTPMiddleware to:
    - Preserve contextvars propagation
    - Avoid memory spooling of response body
    - Eliminate per-request task overhead
    - Use time.monotonic() for accurate elapsed measurements
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract or generate correlation ID from raw ASGI headers
        headers_raw = dict(scope.get("headers", []))
        correlation_id = (
            headers_raw.get(b"x-correlation-id", b"").decode()
            or uuid.uuid4().hex
        )

        scope["correlation_id"] = correlation_id
        set_correlation_id(correlation_id)

        path = scope.get("path", "")
        method = scope.get("method", "")
        started = time.monotonic()

        # Suppress verbose logging for high-frequency polling endpoints
        _quiet = path.rstrip("/") in _QUIET_PATHS or path.rstrip("/").startswith(("/api/v1/jobs", "/api/v1/health"))

        if not _quiet:
            logger.info(
                "request_start",
                extra={
                    "event": "request_start",
                    "path": path,
                    "method": method,
                    "correlation_id": correlation_id,
                },
            )

        status_code = 0

        async def send_wrapper(message: dict) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 0)
                headers = MutableHeaders(scope=message)
                headers["X-Correlation-ID"] = correlation_id
                headers.setdefault("X-Content-Type-Options", "nosniff")
                content_type = headers.get("content-type", "")
                if content_type.startswith(
                    ("application/json", "text/html", "application/x-ndjson")
                ):
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            elapsed = int((time.monotonic() - started) * 1000)
            logger.exception(
                "request_error",
                extra={
                    "event": "request_error",
                    "path": path,
                    "method": method,
                    "elapsed_ms": elapsed,
                    "correlation_id": correlation_id,
                },
            )
            set_correlation_id(None)
            raise

        elapsed = int((time.monotonic() - started) * 1000)
        if not _quiet:
            logger.info(
                "request_complete",
                extra={
                    "event": "request_complete",
                    "path": path,
                    "method": method,
                    "status": status_code,
                    "elapsed_ms": elapsed,
                    "correlation_id": correlation_id,
                },
            )
        set_correlation_id(None)

def add_middlewares(app: FastAPI, settings: Settings) -> None:
    """Configure all application middlewares.

    NOTE: Middleware is executed in REVERSE order of addition.
    The LAST middleware added is the FIRST to process requests.
    CORS must be added LAST so it handles OPTIONS preflight requests FIRST.
    """

    # Correlation ID and logging middleware (added first, executes last)
    app.add_middleware(CorrelationIdMiddleware)

    # Prometheus metrics middleware (after correlation ID, before other middleware)
    if settings.metrics_enabled:
        import importlib.util
        if PrometheusMiddleware is not None and importlib.util.find_spec("prometheus_client") is not None:
            app.add_middleware(PrometheusMiddleware, app_name=settings.app_name)
            app.add_route("/metrics", metrics_endpoint, methods=["GET"])
            logger.info("metrics_enabled", extra={"event": "metrics_enabled", "app_name": settings.app_name})
        else:
            logger.info("metrics_skipped", extra={"event": "metrics_skipped", "reason": "prometheus_client not installed"})

    # OpenTelemetry tracing (conditional on OTLP endpoint being configured)
    if settings.otlp_endpoint:
        from backend.app.services.platform_services import setup_tracing
        deployment_env = "development" if settings.debug_mode else "production"
        setup_tracing(
            app=app,
            service_name=settings.app_name,
            otlp_endpoint=settings.otlp_endpoint,
            service_version=settings.version,
            deployment_environment=deployment_env,
        )

    # UX Governance middleware - enforces intent headers on mutating requests
    # Set strict_mode=False initially to log warnings without rejecting requests
    # Change to strict_mode=True when frontend is fully compliant
    app.add_middleware(
        UXGovernanceMiddleware,
        strict_mode=settings.ux_governance_strict if hasattr(settings, 'ux_governance_strict') else False,
    )

    # Rate limiting middleware
    if settings.rate_limit_enabled:
        _configure_limiter(settings)
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
        app.add_middleware(SlowAPIMiddleware)

    # Request timeout middleware
    app.add_middleware(
        RequestTimeoutMiddleware,
        timeout_seconds=settings.request_timeout_seconds,
    )

    # Security headers middleware - pass debug mode and CSP origins
    app.add_middleware(
        SecurityHeadersMiddleware,
        debug_mode=settings.debug_mode,
        csp_connect_origins=settings.csp_connect_origins
    )

    # Trusted host middleware - configure properly in production
    if settings.allowed_hosts_all:
        allowed_hosts = ["*"]
    else:
        allowed_hosts = settings.trusted_hosts
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

    if settings.idempotency_enabled:
        app.add_middleware(
            IdempotencyMiddleware,
            store=IdempotencyStore(),
            ttl_seconds=settings.idempotency_ttl_seconds,
        )

    # CORS middleware - MUST be added LAST so it executes FIRST
    # This ensures OPTIONS preflight requests are handled before any other middleware
    cors_headers = [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Correlation-ID",
        "Idempotency-Key",
        "X-Idempotency-Key",  # Legacy header name
        "Accept",
        "Accept-Language",
        "Content-Language",
        "Cache-Control",
        "Pragma",
        # UX Governance headers
        IntentHeaders.INTENT_ID,
        IntentHeaders.INTENT_TYPE,
        IntentHeaders.INTENT_LABEL,
        IntentHeaders.IDEMPOTENCY_KEY,
        IntentHeaders.REVERSIBILITY,
        IntentHeaders.USER_SESSION,
        IntentHeaders.USER_ACTION,
        IntentHeaders.WORKFLOW_ID,
        IntentHeaders.WORKFLOW_STEP,
    ]
    cors_expose = [
        "X-Correlation-ID",
        "X-RateLimit-Remaining",
        "X-RateLimit-Limit",
        "Idempotency-Replay",
        "X-Intent-Processed",
    ]
    cors_methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]

    if settings.debug_mode:
        # In debug mode, use regex to allow any localhost/127.0.0.1 origin
        # Note: allow_credentials=True is incompatible with allow_origins=["*"]
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"(https?://(localhost|127\.0\.0\.1)(:\d+)?|https?://tauri\.localhost|tauri://localhost)",
            allow_methods=cors_methods,
            allow_headers=cors_headers,
            allow_credentials=True,
            expose_headers=cors_expose,
        )
    else:
        # In production, use explicit origin list
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=cors_methods,
            allow_headers=cors_headers,
            allow_credentials=True,
            expose_headers=cors_expose,
        )

# IDEMPOTENCY (merged from idempotency.py)

from backend.app.api.idempotency import IdempotencyMiddleware, IdempotencyStore, IdempotencyRecord  # noqa: F401

try:
    from backend.app.services.config import AppError
except ImportError:
    try:
        from backend.app.utils import AppError
    except ImportError:
        class AppError(Exception):
            code = "unknown"
            message = "Unknown error"
            detail = None
            status_code = 500

from fastapi.exceptions import HTTPException

# ERROR HANDLERS (merged from error_handlers.py)

logger = logging.getLogger("neura.api.errors")

async def app_error_handler(request: Request, exc: AppError):
    correlation_id = getattr(getattr(request, "state", None), "correlation_id", None)
    body = {"status": "error", "code": exc.code, "message": exc.message}
    if exc.detail:
        body["detail"] = exc.detail
    if correlation_id:
        body["correlation_id"] = correlation_id
    return JSONResponse(status_code=exc.status_code, content=body)

async def http_error_handler(request: Request, exc):
    correlation_id = getattr(getattr(request, "state", None), "correlation_id", None)
    detail = exc.detail if hasattr(exc, "detail") else str(exc)
    status_code = exc.status_code if hasattr(exc, "status_code") else 500
    if isinstance(detail, dict) and {"status", "code", "message"} <= set(detail.keys()):
        body = dict(detail)
        body.setdefault("status", "error")
        body.setdefault("code", f"http_{status_code}")
    else:
        body = {"status": "error", "code": f"http_{status_code}", "message": detail if isinstance(detail, str) else str(detail)}
    if correlation_id:
        body["correlation_id"] = correlation_id
    return JSONResponse(status_code=status_code, content=body)

async def generic_error_handler(request: Request, exc: Exception):
    """Handle any unhandled exceptions with proper logging."""
    correlation_id = getattr(getattr(request, "state", None), "correlation_id", None)

    # Log the full exception with traceback
    logger.exception(
        "unhandled_exception",
        extra={
            "event": "unhandled_exception",
            "path": request.url.path,
            "method": request.method,
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
            "correlation_id": correlation_id,
        },
    )

    # Return generic error to client (don't expose internal details)
    body = {
        "status": "error",
        "code": "internal_error",
        "message": "An unexpected error occurred. Please try again later.",
    }
    if correlation_id:
        body["correlation_id"] = correlation_id

    return JSONResponse(status_code=500, content=body)

def add_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(Exception, generic_error_handler)

# UX GOVERNANCE (merged from ux_governance.py)

# VIOLATIONS FAIL FAST - requests without proper UX context return 400.

import uuid
import collections
from datetime import datetime, timedelta, timezone
from enum import Enum
from functools import wraps
from typing import Any, Callable, Dict, List, Optional

import logging

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# INTENT HEADERS

class IntentHeaders:
    """Required headers for UX governance compliance."""

    # Intent identification
    INTENT_ID = "X-Intent-Id"
    INTENT_TYPE = "X-Intent-Type"
    INTENT_LABEL = "X-Intent-Label"

    # Idempotency
    IDEMPOTENCY_KEY = "Idempotency-Key"

    # Reversibility
    REVERSIBILITY = "X-Reversibility"

    # User context
    USER_SESSION = "X-User-Session"
    USER_ACTION = "X-User-Action"

    # Workflow context
    WORKFLOW_ID = "X-Workflow-Id"
    WORKFLOW_STEP = "X-Workflow-Step"

class IntentType(str, Enum):
    """Valid intent types from frontend."""
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    UPLOAD = "upload"
    DOWNLOAD = "download"
    GENERATE = "generate"
    ANALYZE = "analyze"
    EXECUTE = "execute"
    NAVIGATE = "navigate"
    LOGIN = "login"
    LOGOUT = "logout"

class Reversibility(str, Enum):
    """Reversibility levels."""
    FULLY_REVERSIBLE = "fully_reversible"
    PARTIALLY_REVERSIBLE = "partially_reversible"
    IRREVERSIBLE = "irreversible"
    SYSTEM_MANAGED = "system_managed"

# INTENT VALIDATION

class IntentContext(BaseModel):
    """Parsed intent context from request headers."""
    intent_id: str
    intent_type: IntentType
    intent_label: Optional[str] = None
    idempotency_key: Optional[str] = None
    reversibility: Optional[Reversibility] = None
    user_session: Optional[str] = None
    workflow_id: Optional[str] = None
    workflow_step: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

def _get_idempotency_key(request: Request) -> Optional[str]:
    return (
        request.headers.get(IntentHeaders.IDEMPOTENCY_KEY)
        or request.headers.get("X-Idempotency-Key")
    )

def _parse_reversibility(value: Optional[str]) -> Optional[Reversibility]:
    if not value:
        return None
    try:
        return Reversibility(value)
    except ValueError:
        return None

def extract_intent_context(request: Request) -> Optional[IntentContext]:
    """Extract intent context from request headers."""
    intent_id = request.headers.get(IntentHeaders.INTENT_ID)
    intent_type_str = request.headers.get(IntentHeaders.INTENT_TYPE)

    if not intent_id or not intent_type_str:
        return None

    try:
        intent_type = IntentType(intent_type_str.lower())
    except ValueError:
        return None

    return IntentContext(
        intent_id=intent_id,
        intent_type=intent_type,
        intent_label=request.headers.get(IntentHeaders.INTENT_LABEL),
        idempotency_key=_get_idempotency_key(request),
        reversibility=_parse_reversibility(request.headers.get(IntentHeaders.REVERSIBILITY)),
        user_session=request.headers.get(IntentHeaders.USER_SESSION),
        workflow_id=request.headers.get(IntentHeaders.WORKFLOW_ID),
        workflow_step=request.headers.get(IntentHeaders.WORKFLOW_STEP),
    )

# GOVERNANCE ENFORCEMENT MIDDLEWARE

# Routes that require intent headers (mutating operations)
INTENT_REQUIRED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Routes that are exempt from intent requirements (health checks, etc.)
EXEMPT_PATHS = {
    "/health",
    "/api/health",
    "/docs",
    "/redoc",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/audit/frontend-error",
    "/api/v1/audit/frontend-error",
}

# Prefix-based exemptions for routes where intent headers are unnecessary
EXEMPT_PATH_PREFIXES = (
    "/api/v1/feedback/",
)

class UXGovernanceMiddleware(BaseHTTPMiddleware):
    """
    Middleware that ENFORCES UX governance at the API level.

    Rejects requests that:
    - Are mutating (POST/PUT/PATCH/DELETE) without intent headers
    - Are non-idempotent without idempotency keys
    - Cannot be audited due to missing context
    """

    def __init__(self, app, strict_mode: bool = True):
        super().__init__(app)
        self.strict_mode = strict_mode

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip exempt paths
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        # Skip prefix-based exemptions
        if request.url.path.startswith(EXEMPT_PATH_PREFIXES):
            return await call_next(request)

        # Skip non-mutating methods
        if request.method not in INTENT_REQUIRED_METHODS:
            return await call_next(request)

        # Extract intent context
        intent = extract_intent_context(request)

        if not intent:
            if self.strict_mode:
                return JSONResponse(
                    status_code=400,
                    content={
                        "error": "UX_GOVERNANCE_VIOLATION",
                        "message": "Request missing required intent headers",
                        "required_headers": [
                            IntentHeaders.INTENT_ID,
                            IntentHeaders.INTENT_TYPE,
                        ],
                        "hint": "All mutating requests must include X-Intent-Id and X-Intent-Type headers",
                    },
                )
            else:
                # Non-strict mode: log warning but allow
                logger.warning("Request to %s missing intent headers", request.url.path)

        # Validate idempotency for non-safe operations
        if intent and request.method in {"POST", "DELETE"}:
            if not intent.idempotency_key:
                if self.strict_mode:
                    return JSONResponse(
                        status_code=400,
                        content={
                            "error": "UX_GOVERNANCE_VIOLATION",
                            "message": f"{request.method} requests require idempotency key",
                            "required_headers": [IntentHeaders.IDEMPOTENCY_KEY],
                            "hint": "Include X-Idempotency-Key header for request deduplication",
                        },
                    )

        # Store intent in request state for downstream use
        if intent:
            request.state.intent = intent

        # Call the next middleware/handler
        response = await call_next(request)

        # Add governance headers to response
        if intent:
            response.headers["X-Intent-Processed"] = intent.intent_id

        return response

# REVERSIBILITY TRACKING

class ReversibilityRecord(BaseModel):
    """Record of an operation's reversibility state."""
    operation_id: str
    intent_id: str
    operation_type: str
    reversibility: Reversibility
    created_at: datetime
    expires_at: Optional[datetime] = None
    reversed_at: Optional[datetime] = None
    reverse_data: Optional[Dict[str, Any]] = None
    reverse_endpoint: Optional[str] = None

# In-memory store (replace with database in production)
_REVERSIBILITY_STORE: Dict[str, ReversibilityRecord] = {}

def record_reversible_operation(
    operation_id: str,
    intent: IntentContext,
    operation_type: str,
    reverse_data: Optional[Dict[str, Any]] = None,
    reverse_endpoint: Optional[str] = None,
    ttl_hours: int = 24,
) -> ReversibilityRecord:
    """Record an operation that can be reversed."""
    record = ReversibilityRecord(
        operation_id=operation_id,
        intent_id=intent.intent_id,
        operation_type=operation_type,
        reversibility=intent.reversibility or Reversibility.SYSTEM_MANAGED,
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
        reverse_data=reverse_data,
        reverse_endpoint=reverse_endpoint,
    )
    _REVERSIBILITY_STORE[operation_id] = record

    # Evict entries if store exceeds size limit
    if len(_REVERSIBILITY_STORE) > 10000:
        now = datetime.now(timezone.utc)
        expired = [k for k, v in _REVERSIBILITY_STORE.items() if v.expires_at and v.expires_at <= now]
        for k in expired:
            del _REVERSIBILITY_STORE[k]
        # If still over limit, evict oldest entries
        if len(_REVERSIBILITY_STORE) > 10000:
            sorted_keys = sorted(_REVERSIBILITY_STORE.keys(), key=lambda k: _REVERSIBILITY_STORE[k].created_at)
            excess = len(_REVERSIBILITY_STORE) - 10000
            for k in sorted_keys[:excess]:
                del _REVERSIBILITY_STORE[k]

    return record

def get_reversibility_record(operation_id: str) -> Optional[ReversibilityRecord]:
    """Get reversibility record for an operation."""
    record = _REVERSIBILITY_STORE.get(operation_id)
    if record and record.expires_at and record.expires_at < datetime.now(timezone.utc):
        del _REVERSIBILITY_STORE[operation_id]
        return None
    return record

def mark_operation_reversed(operation_id: str) -> bool:
    """Mark an operation as reversed."""
    record = _REVERSIBILITY_STORE.get(operation_id)
    if not record:
        return False
    record.reversed_at = datetime.now(timezone.utc)
    return True

def can_reverse_operation(operation_id: str) -> tuple[bool, Optional[str]]:
    """Check if an operation can be reversed."""
    record = get_reversibility_record(operation_id)

    if not record:
        return False, "Operation not found or expired"

    if record.reversed_at:
        return False, "Operation already reversed"

    if record.reversibility == Reversibility.IRREVERSIBLE:
        return False, "Operation is marked as irreversible"

    if record.expires_at and record.expires_at < datetime.now(timezone.utc):
        return False, "Reversal window has expired"

    return True, None

# DECORATORS FOR ROUTE HANDLERS

def requires_intent(*allowed_types: IntentType):
    """
    Decorator that ENFORCES intent headers on a route.

    Usage:
        @router.post("/items")
        @requires_intent(IntentType.CREATE)
        async def create_item(request: Request, ...):
            intent = request.state.intent
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if not request:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if not request:
                raise HTTPException(
                    status_code=500,
                    detail="Internal error: Request object not found"
                )

            intent = getattr(request.state, "intent", None)

            if not intent:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "INTENT_REQUIRED",
                        "message": "This endpoint requires intent headers",
                        "allowed_types": [t.value for t in allowed_types],
                    }
                )

            if allowed_types and intent.intent_type not in allowed_types:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "INVALID_INTENT_TYPE",
                        "message": f"Intent type '{intent.intent_type.value}' not allowed",
                        "allowed_types": [t.value for t in allowed_types],
                    }
                )

            return await func(*args, **kwargs)

        return wrapper
    return decorator

def reversible(ttl_hours: int = 24, reverse_endpoint: Optional[str] = None):
    """
    Decorator that marks an operation as reversible and tracks it.

    Usage:
        @router.delete("/items/{item_id}")
        @reversible(ttl_hours=48, reverse_endpoint="/items/{item_id}/restore")
        async def delete_item(request: Request, item_id: str):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request = kwargs.get("request")
            if not request:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            intent = getattr(request.state, "intent", None) if request else None

            # Execute the operation
            result = await func(*args, **kwargs)

            # Record for reversibility
            if intent:
                operation_id = str(uuid.uuid4())
                record_reversible_operation(
                    operation_id=operation_id,
                    intent=intent,
                    operation_type=func.__name__,
                    reverse_data={"kwargs": kwargs},
                    reverse_endpoint=reverse_endpoint,
                    ttl_hours=ttl_hours,
                )

                # Add operation ID to response if it's a dict
                if isinstance(result, dict):
                    result["_operation_id"] = operation_id
                    result["_can_reverse"] = True
                    result["_reverse_until"] = (
                        datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
                    ).isoformat()

            return result

        return wrapper
    return decorator

# AUDIT LOGGING

class AuditEntry(BaseModel):
    """Audit log entry for UX governance."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    intent_id: str
    intent_type: str
    user_session: Optional[str] = None
    endpoint: str
    method: str
    status_code: int
    duration_ms: int
    workflow_id: Optional[str] = None
    workflow_step: Optional[str] = None
    error: Optional[str] = None

# Audit log storage (replace with database in production)
_MAX_AUDIT_ENTRIES = 10000
_AUDIT_LOG: collections.deque[AuditEntry] = collections.deque(maxlen=_MAX_AUDIT_ENTRIES)

def audit_log(entry: AuditEntry):
    """Add an entry to the audit log."""
    _AUDIT_LOG.append(entry)

def get_audit_log(
    intent_id: Optional[str] = None,
    workflow_id: Optional[str] = None,
    limit: int = 100,
) -> List[AuditEntry]:
    """Get audit log entries."""
    entries = _AUDIT_LOG

    if intent_id:
        entries = [e for e in entries if e.intent_id == intent_id]

    if workflow_id:
        entries = [e for e in entries if e.workflow_id == workflow_id]

    return entries[-limit:]

# GOVERNANCE VALIDATION UTILITIES

def validate_governance_compliance(request: Request) -> tuple[bool, Optional[str]]:
    """
    Validate that a request is fully UX governance compliant.
    Returns (is_compliant, error_message).
    """
    # Check intent headers
    intent_id = request.headers.get(IntentHeaders.INTENT_ID)
    intent_type = request.headers.get(IntentHeaders.INTENT_TYPE)

    if not intent_id:
        return False, f"Missing required header: {IntentHeaders.INTENT_ID}"

    if not intent_type:
        return False, f"Missing required header: {IntentHeaders.INTENT_TYPE}"

    # Validate intent type
    try:
        IntentType(intent_type.lower())
    except ValueError:
        return False, f"Invalid intent type: {intent_type}"

    # Check idempotency for mutating requests
    if request.method in {"POST", "DELETE"}:
        idempotency_key = _get_idempotency_key(request)
        if not idempotency_key:
            return False, f"Missing required header for {request.method}: {IntentHeaders.IDEMPOTENCY_KEY}"

    return True, None

def generate_governance_report() -> Dict[str, Any]:
    """Generate a governance compliance report."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_operations": len(_AUDIT_LOG),
        "reversible_operations": len(_REVERSIBILITY_STORE),
        "operations_by_type": _count_by_field(_AUDIT_LOG, "intent_type"),
        "operations_by_status": _count_by_field(_AUDIT_LOG, "status_code"),
        "recent_violations": [
            e for e in _AUDIT_LOG[-100:] if e.error
        ],
    }

def _count_by_field(entries: List[AuditEntry], field: str) -> Dict[str, int]:
    """Count entries by a field value."""
    counts: Dict[str, int] = {}
    for entry in entries:
        value = str(getattr(entry, field, "unknown"))
        counts[value] = counts.get(value, 0) + 1
    return counts

# SUPPORT (merged from support.py)

"""Merged API support: analyze_routes + generate_routes."""

# Merged analyze routes: analysis_routes + enhanced_analysis_routes

# --- Source: analysis_routes.py ---

# mypy: ignore-errors
"""API routes for document analysis."""

import asyncio
import contextlib
import json
import logging
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from backend.app.services.config import get_settings
from backend.app.services.config import require_api_key
from backend.app.utils import validate_file_extension
from backend.app.schemas import AnalysisSuggestChartsPayload
from backend.app.services.analyze_service import (
    analyze_document_streaming,
    get_analysis,
    get_analysis_data,
    suggest_charts_for_analysis,
)
from backend.app.services.analyze_service import extract_document_content
from backend.app.services.config import enqueue_background_job, run_event_stream_async

logger = logging.getLogger("neura.analyze.routes")

router = APIRouter(dependencies=[Depends(require_api_key)])

ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".xlsm"]
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
}
MAX_FILENAME_LENGTH = 255
READ_CHUNK_BYTES = 1024 * 1024
MAX_ANALYSIS_DATA_LIMIT = 2000

def _validate_upload(file: UploadFile) -> str:
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="Filename is required")
    if len(filename) > MAX_FILENAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Filename too long (max {MAX_FILENAME_LENGTH} characters)")
    is_valid, error = validate_file_extension(filename, ALLOWED_EXTENSIONS)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported content type '{file.content_type}'",
        )
    return filename

async def _persist_upload_with_limit(upload: UploadFile, max_bytes: int, suffix: str) -> tuple[Path, int]:
    size = 0
    tmp = tempfile.NamedTemporaryFile(prefix="nr-analysis-", suffix=suffix, delete=False)
    try:
        with tmp:
            while True:
                chunk = await upload.read(READ_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum size is {max_bytes} bytes.",
                    )
                tmp.write(chunk)
    finally:
        with contextlib.suppress(Exception):
            await upload.close()
    return Path(tmp.name), size

async def _streaming_generator(
    file_path: Path,
    file_name: str,
    template_id: Optional[str],
    connection_id: Optional[str],
    correlation_id: Optional[str],
):
    """Generate NDJSON streaming response."""
    try:
        async for event in analyze_document_streaming(
            file_path=file_path,
            file_name=file_name,
            template_id=template_id,
            connection_id=connection_id,
            correlation_id=correlation_id,
        ):
            yield json.dumps(event) + "\n"
    except Exception as exc:
        logger.exception(
            "analysis_stream_failed",
            extra={"event": "analysis_stream_failed", "error": str(exc), "correlation_id": correlation_id},
        )
        error_event = {
            "event": "error",
            "detail": "Analysis failed. Please try again.",
        }
        if correlation_id:
            error_event["correlation_id"] = correlation_id
        yield json.dumps(error_event) + "\n"
    finally:
        with contextlib.suppress(FileNotFoundError):
            file_path.unlink(missing_ok=True)

@router.post("/upload")
async def upload_and_analyze(
    request: Request,
    file: UploadFile = File(...),
    template_id: Optional[str] = Form(None),
    connection_id: Optional[str] = Form(None),
    background: bool = Query(False),
):
    """
    Upload a document (PDF or Excel) and analyze it with AI.

    Returns a streaming NDJSON response with progress updates and final results.
    Use background=true to queue the analysis as a job.

    Events:
    - stage: Progress update with stage name and percentage
    - error: Error occurred, includes detail message
    - result: Final analysis result
    """
    settings = get_settings()
    file_name = _validate_upload(file)
    correlation_id = getattr(request.state, "correlation_id", None)

    if background:
        suffix = Path(file_name).suffix or ".bin"
        upload_path, size_bytes = await _persist_upload_with_limit(file, settings.max_upload_bytes, suffix=suffix)

        async def runner(job_id: str) -> None:
            try:
                async def _events():
                    async for event in analyze_document_streaming(
                        file_path=upload_path,
                        file_name=file_name,
                        template_id=template_id,
                        connection_id=connection_id,
                        correlation_id=correlation_id,
                    ):
                        yield event

                def _result_builder(event: dict) -> dict:
                    if event.get("event") != "result":
                        return {}
                    tables = event.get("tables") or []
                    charts = event.get("chart_suggestions") or []
                    return {
                        "analysis_id": event.get("analysis_id"),
                        "document_name": event.get("document_name"),
                        "summary": event.get("summary"),
                        "table_count": len(tables),
                        "chart_count": len(charts),
                        "warnings": event.get("warnings") or [],
                    }

                await run_event_stream_async(job_id, _events(), result_builder=_result_builder)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    upload_path.unlink(missing_ok=True)

        job = await enqueue_background_job(
            job_type="analyze_document",
            template_id=template_id,
            connection_id=connection_id,
            template_name=file_name,
            meta={
                "filename": file_name,
                "size_bytes": size_bytes,
                "background": True,
            },
            runner=runner,
        )

        return {"status": "queued", "job_id": job["id"], "correlation_id": correlation_id}

    try:
        suffix = Path(file_name).suffix or ".bin"
        upload_path, _ = await _persist_upload_with_limit(file, settings.max_upload_bytes, suffix=suffix)
    finally:
        await file.close()

    return StreamingResponse(
        _streaming_generator(
            upload_path,
            file_name,
            template_id,
            connection_id,
            correlation_id,
        ),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@router.post("/extract")
async def extract_document(
    request: Request,
    file: UploadFile = File(...),
    table_limit: int = Query(50, ge=1, le=200),
    table_offset: int = Query(0, ge=0),
    text_limit: int = Query(50000, ge=0, le=200000),
    include_text: bool = Query(True),
):
    """Quickly extract raw tables and text without full AI analysis."""
    settings = get_settings()
    file_name = _validate_upload(file)
    correlation_id = getattr(request.state, "correlation_id", None)

    try:
        suffix = Path(file_name).suffix or ".bin"
        upload_path, _ = await _persist_upload_with_limit(file, settings.max_upload_bytes, suffix=suffix)
    finally:
        await file.close()

    extracted = await asyncio.to_thread(
        extract_document_content,
        file_path=upload_path,
        file_name=file_name,
    )
    with contextlib.suppress(FileNotFoundError):
        upload_path.unlink(missing_ok=True)

    total_tables = len(extracted.tables_raw or [])
    table_slice = extracted.tables_raw[table_offset:table_offset + table_limit]
    text_content = extracted.text_content or ""
    original_text_len = len(text_content)
    if not include_text:
        text_content = ""
    elif text_limit and original_text_len > text_limit:
        text_content = text_content[:text_limit]

    return {
        "status": "ok",
        "file_name": extracted.file_name,
        "document_type": extracted.document_type,
        "page_count": extracted.page_count,
        "tables": table_slice,
        "tables_total": total_tables,
        "tables_offset": table_offset,
        "tables_limit": table_limit,
        "sheets": extracted.sheets,
        "text": text_content,
        "text_length": original_text_len,
        "text_truncated": include_text and text_limit > 0 and original_text_len > text_limit,
        "errors": extracted.errors,
        "correlation_id": correlation_id,
    }

@router.get("/{analysis_id}")
async def get_analysis_result(analysis_id: str, request: Request):
    """Get a previously computed analysis result."""
    result = get_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "status": "ok",
        **result.model_dump(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@router.get("/{analysis_id}/data")
async def get_analysis_raw_data(
    analysis_id: str,
    request: Request,
    limit: int = Query(500, ge=1, le=MAX_ANALYSIS_DATA_LIMIT),
    offset: int = Query(0, ge=0),
):
    """Get raw data from an analysis for charting."""
    data = get_analysis_data(analysis_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    paginated = data[offset:offset + limit]

    return {
        "status": "ok",
        "analysis_id": analysis_id,
        "data": paginated,
        "total": len(data),
        "offset": offset,
        "limit": limit,
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@router.post("/{analysis_id}/charts/suggest")
async def suggest_charts(
    analysis_id: str,
    payload: AnalysisSuggestChartsPayload,
    request: Request,
):
    """Generate additional chart suggestions for an existing analysis."""
    result = get_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    charts = await asyncio.to_thread(suggest_charts_for_analysis, analysis_id, payload)

    sample_data = result.raw_data[:100] if payload.include_sample_data else None

    return {
        "status": "ok",
        "analysis_id": analysis_id,
        "charts": [c.model_dump() for c in charts],
        "sample_data": sample_data,
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

__all__ = ["router"]

# --- Source: enhanced_analysis_routes.py ---

# mypy: ignore-errors
"""
Enhanced Analysis API Routes - Comprehensive endpoints for AI-powered document analysis.

Provides endpoints for:
- Document upload and analysis
- Natural language Q&A
- Chart generation
- Data export
- Collaboration features
- Integrations
"""

import contextlib
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from backend.app.services.config import current_optional_user
from backend.app.services.config import get_settings
from backend.app.services.config import require_api_key
from backend.app.utils import validate_file_extension
from backend.app.schemas import (
    AnalysisDepth,
    AnalysisPreferences,
    ChartType,
    ExportFormat,
    SummaryMode,
)
from backend.app.services.analyze_service import (
    get_orchestrator,
)
from backend.app.services.analyze_service import DataSourceType
from backend.app.services.config import enqueue_background_job, run_event_stream_async

logger = logging.getLogger("neura.analyze.routes")

enhanced_router = APIRouter(prefix="/analyze/v2", tags=["Enhanced Analysis"], dependencies=[Depends(require_api_key)])

ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".xlsm"]
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
    "application/octet-stream",
}
MAX_FILENAME_LENGTH = 255
READ_CHUNK_BYTES = 1024 * 1024

# REQUEST/RESPONSE MODELS

class AnalyzePreferencesRequest(BaseModel):
    """Request model for analysis preferences."""
    analysis_depth: str = "standard"
    focus_areas: List[str] = []
    output_format: str = "executive"
    language: str = "en"
    industry: Optional[str] = None
    enable_predictions: bool = True
    enable_recommendations: bool = True
    auto_chart_generation: bool = True
    max_charts: int = 10
    summary_mode: str = "executive"

class QuestionRequest(BaseModel):
    """Request model for asking questions."""
    question: str
    include_sources: bool = True
    max_context_chunks: int = 5

class ChartRequest(BaseModel):
    """Request model for generating charts."""
    query: str
    chart_type: Optional[str] = None
    include_trends: bool = True
    include_forecasts: bool = False

class ExportRequest(BaseModel):
    """Request model for exporting analysis."""
    format: str = "json"
    include_raw_data: bool = True
    include_charts: bool = True

class CompareRequest(BaseModel):
    """Request model for comparing documents."""
    analysis_id_1: str
    analysis_id_2: str

class CommentRequest(BaseModel):
    """Request model for adding comments."""
    content: str
    element_type: Optional[str] = None
    element_id: Optional[str] = None
    user_id: Optional[str] = None
    user_name: Optional[str] = None

class ShareRequest(BaseModel):
    """Request model for creating share links."""
    access_level: str = "view"
    expires_hours: Optional[int] = None
    password_protected: bool = False
    allowed_emails: List[str] = []

class IntegrationRequest(BaseModel):
    name: str
    integration_type: str
    config: Dict[str, Any] = {}

class IntegrationMessageRequest(BaseModel):
    message: str
    data: Optional[Dict[str, Any]] = None

class IntegrationItemRequest(BaseModel):
    data: Dict[str, Any] = {}

class DataSourceRequest(BaseModel):
    name: str
    source_type: str
    config: Dict[str, Any] = {}

class DataFetchRequest(BaseModel):
    query: Optional[str] = None

class TriggerRequest(BaseModel):
    name: str
    trigger_type: str
    config: Dict[str, Any] = {}
    action: str

class PipelineRequest(BaseModel):
    name: str
    steps: List[Dict[str, Any]] = []

class PipelineExecuteRequest(BaseModel):
    input_data: Dict[str, Any] = {}

class ScheduleRequest(BaseModel):
    name: str
    source_config: Dict[str, Any] = {}
    schedule: str
    analysis_config: Dict[str, Any] = {}
    notifications: List[str] = []

class WebhookRequest(BaseModel):
    url: str
    events: List[str] = []
    secret: Optional[str] = None

class WebhookSendRequest(BaseModel):
    event: str
    payload: Dict[str, Any] = {}

# DOCUMENT ANALYSIS ENDPOINTS

def _validate_upload(file: UploadFile) -> str:
    filename = Path(file.filename or "").name
    if not filename:
        raise HTTPException(status_code=400, detail="No file provided")
    if len(filename) > MAX_FILENAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Filename too long (max {MAX_FILENAME_LENGTH} characters)")
    is_valid, error = validate_file_extension(filename, ALLOWED_EXTENSIONS)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error)
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported content type '{file.content_type}'")
    return filename

async def _persist_upload_with_limit(upload: UploadFile, max_bytes: int, suffix: str) -> tuple[Path, int]:
    size = 0
    tmp = tempfile.NamedTemporaryFile(prefix="nr-analyze-v2-", suffix=suffix, delete=False)
    try:
        with tmp:
            while True:
                chunk = await upload.read(READ_CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(status_code=413, detail=f"File too large (max {max_bytes} bytes)")
                tmp.write(chunk)
    finally:
        with contextlib.suppress(Exception):
            await upload.close()
    return Path(tmp.name), size

@enhanced_router.post("/upload")
async def analyze_document(
    file: UploadFile = File(...),
    preferences: Optional[str] = Form(None),
    background: bool = Query(False, description="Run in background"),
    background_tasks: BackgroundTasks = None,
):
    """
    Upload and analyze a document with AI-powered analysis.

    Returns streaming NDJSON events with progress and final result.

    **Features:**
    - Intelligent table extraction with cross-page stitching
    - Entity and metric extraction (dates, money, percentages, etc.)
    - Form and invoice parsing
    - Multi-mode summaries (executive, data, comprehensive, etc.)
    - Sentiment and tone analysis
    - Statistical analysis with outlier detection
    - Auto-generated visualizations
    - AI-powered insights, risks, and opportunities
    - Predictive analytics
    """
    settings = get_settings()
    file_name = _validate_upload(file)

    # Parse preferences
    prefs = None
    if preferences:
        try:
            prefs_dict = json.loads(preferences)
            prefs = AnalysisPreferences(
                analysis_depth=AnalysisDepth[prefs_dict.get("analysis_depth", "standard").upper()],
                focus_areas=prefs_dict.get("focus_areas", []),
                output_format=prefs_dict.get("output_format", "executive"),
                language=prefs_dict.get("language", "en"),
                industry=prefs_dict.get("industry"),
                enable_predictions=prefs_dict.get("enable_predictions", True),
                enable_recommendations=prefs_dict.get("enable_recommendations", True),
                auto_chart_generation=prefs_dict.get("auto_chart_generation", True),
                max_charts=prefs_dict.get("max_charts", 10),
                summary_mode=SummaryMode[prefs_dict.get("summary_mode", "executive").upper()],
            )
        except Exception as e:
            logger.warning(f"Failed to parse preferences: {e}")

    orchestrator = get_orchestrator()

    if background:
        suffix = Path(file_name).suffix or ".bin"
        upload_path, size_bytes = await _persist_upload_with_limit(file, settings.max_upload_bytes, suffix=suffix)
        analysis_id = orchestrator.new_analysis_id()

        async def runner(job_id: str) -> None:
            try:
                async def _events():
                    async for event in orchestrator.analyze_document_streaming(
                        file_bytes=None,
                        file_name=file_name,
                        file_path=upload_path,
                        preferences=prefs,
                        analysis_id=analysis_id,
                    ):
                        yield event

                def _result_builder(event: dict) -> dict:
                    if event.get("event") != "result":
                        return {}
                    tables = event.get("tables") or []
                    charts = event.get("chart_suggestions") or []
                    return {
                        "analysis_id": event.get("analysis_id"),
                        "document_name": event.get("document_name"),
                        "table_count": len(tables),
                        "chart_count": len(charts),
                        "warnings": event.get("warnings") or [],
                    }

                await run_event_stream_async(job_id, _events(), result_builder=_result_builder)
            finally:
                with contextlib.suppress(FileNotFoundError):
                    upload_path.unlink(missing_ok=True)

        job = await enqueue_background_job(
            job_type="enhanced_analyze_document",
            template_name=file_name,
            meta={
                "filename": file_name,
                "size_bytes": size_bytes,
                "analysis_id": analysis_id,
                "background": True,
            },
            runner=runner,
        )

        return {
            "status": "queued",
            "job_id": job["id"],
            "analysis_id": analysis_id,
        }

    suffix = Path(file_name).suffix or ".bin"
    upload_path, _ = await _persist_upload_with_limit(file, settings.max_upload_bytes, suffix=suffix)

    async def generate_events():
        try:
            async for event in orchestrator.analyze_document_streaming(
                file_bytes=None,
                file_name=file_name,
                file_path=upload_path,
                preferences=prefs,
            ):
                yield json.dumps(event) + "\n"
        finally:
            with contextlib.suppress(FileNotFoundError):
                upload_path.unlink(missing_ok=True)

    return StreamingResponse(
        generate_events(),
        media_type="application/x-ndjson",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

# STATIC GET ROUTES — must precede /{analysis_id} catch-all

@enhanced_router.get("/integrations")
async def list_integrations():
    """List registered external integrations."""
    orchestrator = get_orchestrator()
    return {"integrations": orchestrator.integration_service.list_integrations()}

@enhanced_router.get("/sources")
async def list_data_sources():
    """List registered data sources."""
    orchestrator = get_orchestrator()
    sources = orchestrator.integration_service.list_data_sources()
    return {
        "sources": [
            {
                "id": s.id,
                "name": s.name,
                "type": s.type.value,
                "created_at": s.created_at.isoformat(),
                "last_used": s.last_used.isoformat() if s.last_used else None,
                "is_active": s.is_active,
            }
            for s in sources
        ]
    }

@enhanced_router.get("/{analysis_id}")
async def get_analysis(analysis_id: str):
    """Get a previously computed analysis result."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return result.model_dump()

@enhanced_router.get("/{analysis_id}/summary/{mode}")
async def get_summary(
    analysis_id: str,
    mode: str,
):
    """Get a specific summary mode for an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    summary = result.summaries.get(mode)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Summary mode '{mode}' not found")

    return summary.model_dump()

# QUESTION & ANSWER ENDPOINTS

@enhanced_router.post("/{analysis_id}/ask")
async def ask_question(
    analysis_id: str,
    request: QuestionRequest,
):
    """
    Ask a natural language question about the analyzed document.

    Uses RAG (Retrieval-Augmented Generation) to find relevant context
    and generate accurate answers with source citations.
    """
    orchestrator = get_orchestrator()

    response = await orchestrator.ask_question(
        analysis_id=analysis_id,
        question=request.question,
        include_sources=request.include_sources,
        max_context_chunks=request.max_context_chunks,
    )

    return response.model_dump()

@enhanced_router.get("/{analysis_id}/suggested-questions")
async def get_suggested_questions(analysis_id: str):
    """Get AI-generated suggested questions for an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    questions = orchestrator.ux_service.generate_suggested_questions(
        tables=result.tables,
        metrics=result.metrics,
        entities=result.entities,
    )

    return {"questions": questions}

# VISUALIZATION ENDPOINTS

@enhanced_router.post("/{analysis_id}/charts/generate")
async def generate_charts(
    analysis_id: str,
    request: ChartRequest,
):
    """
    Generate charts from natural language query.

    Examples:
    - "Show me revenue by quarter as a line chart"
    - "Compare sales across regions"
    - "Create a pie chart of market share"
    """
    orchestrator = get_orchestrator()

    result = await orchestrator.generate_charts_from_query(
        analysis_id=analysis_id,
        query=request.query,
        include_trends=request.include_trends,
        include_forecasts=request.include_forecasts,
    )

    return result

@enhanced_router.get("/{analysis_id}/charts")
async def get_charts(analysis_id: str):
    """Get all charts for an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "charts": [c.model_dump() for c in result.chart_suggestions],
        "suggestions": [s.model_dump() for s in result.visualization_suggestions],
    }

# DATA ENDPOINTS

@enhanced_router.get("/{analysis_id}/tables")
async def get_tables(
    analysis_id: str,
    limit: int = Query(10, ge=1, le=50),
):
    """Get extracted tables from an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "tables": [t.model_dump() for t in result.tables[:limit]],
        "total": len(result.tables),
    }

@enhanced_router.get("/{analysis_id}/metrics")
async def get_metrics(analysis_id: str):
    """Get extracted metrics from an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "metrics": [m.model_dump() for m in result.metrics],
        "total": len(result.metrics),
    }

@enhanced_router.get("/{analysis_id}/entities")
async def get_entities(analysis_id: str):
    """Get extracted entities from an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "entities": [e.model_dump() for e in result.entities],
        "total": len(result.entities),
    }

@enhanced_router.get("/{analysis_id}/insights")
async def get_insights(analysis_id: str):
    """Get AI-generated insights, risks, and opportunities."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "insights": [i.model_dump() for i in result.insights],
        "risks": [r.model_dump() for r in result.risks],
        "opportunities": [o.model_dump() for o in result.opportunities],
        "action_items": [a.model_dump() for a in result.action_items],
    }

@enhanced_router.get("/{analysis_id}/quality")
async def get_data_quality(analysis_id: str):
    """Get data quality assessment for an analysis."""
    orchestrator = get_orchestrator()
    result = orchestrator.get_analysis(analysis_id)

    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if not result.data_quality:
        raise HTTPException(status_code=404, detail="Data quality assessment not available")

    return result.data_quality.model_dump()

# EXPORT ENDPOINTS

@enhanced_router.post("/{analysis_id}/export")
async def export_analysis(
    analysis_id: str,
    request: ExportRequest,
):
    """
    Export analysis in various formats.

    Supported formats:
    - json: Full analysis as JSON
    - csv: Tables as CSV
    - excel: Formatted Excel workbook
    - pdf: PDF report
    - markdown: Markdown document
    - html: HTML report
    """
    orchestrator = get_orchestrator()

    try:
        format_enum = ExportFormat[request.format.upper()]
    except KeyError:
        raise HTTPException(status_code=400, detail=f"Invalid format: {request.format}")

    try:
        content, filename = await orchestrator.export_analysis(
            analysis_id=analysis_id,
            format=format_enum,
            include_raw_data=request.include_raw_data,
            include_charts=request.include_charts,
        )
    except ValueError as e:
        logger.warning("Export not found: %s", e)
        raise HTTPException(status_code=404, detail="Analysis not found for export")
    except RuntimeError as e:
        logger.error("Export not implemented: %s", e)
        raise HTTPException(status_code=501, detail="Export format not supported")

    # Determine content type
    content_types = {
        ExportFormat.JSON: "application/json",
        ExportFormat.CSV: "text/csv",
        ExportFormat.EXCEL: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ExportFormat.PDF: "application/pdf",
        ExportFormat.MARKDOWN: "text/markdown",
        ExportFormat.HTML: "text/html",
    }

    return Response(
        content=content,
        media_type=content_types.get(format_enum, "application/octet-stream"),
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

# COMPARISON ENDPOINTS

@enhanced_router.post("/compare")
async def compare_documents(request: CompareRequest):
    """Compare two analyzed documents."""
    orchestrator = get_orchestrator()

    result = await orchestrator.compare_documents(
        analysis_id_1=request.analysis_id_1,
        analysis_id_2=request.analysis_id_2,
    )

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    return result

# COLLABORATION ENDPOINTS

@enhanced_router.post("/{analysis_id}/comments")
async def add_comment(
    analysis_id: str,
    request: CommentRequest,
    user=Depends(current_optional_user),
    settings=Depends(get_settings),
):
    """Add a comment to an analysis."""
    orchestrator = get_orchestrator()

    # Verify analysis exists
    result = orchestrator.get_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if user is not None:
        user_id = str(user.id)
        user_name = user.full_name or user.email or "User"
    else:
        user_id = "anonymous" if settings.allow_anonymous_api else "api-key"
        user_name = "Anonymous" if settings.allow_anonymous_api else "API Key"

    comment = orchestrator.ux_service.add_comment(
        analysis_id=analysis_id,
        user_id=user_id,
        user_name=user_name,
        content=request.content,
        element_type=request.element_type,
        element_id=request.element_id,
    )

    return {
        "id": comment.id,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
    }

@enhanced_router.get("/{analysis_id}/comments")
async def get_comments(analysis_id: str):
    """Get all comments for an analysis."""
    orchestrator = get_orchestrator()

    comments = orchestrator.ux_service.get_comments(analysis_id)

    return {
        "comments": [
            {
                "id": c.id,
                "content": c.content,
                "user_name": c.user_name,
                "element_type": c.element_type,
                "element_id": c.element_id,
                "created_at": c.created_at.isoformat(),
                "replies": [
                    {"id": r.id, "content": r.content, "user_name": r.user_name}
                    for r in c.replies
                ],
            }
            for c in comments
        ]
    }

@enhanced_router.post("/{analysis_id}/share")
async def create_share_link(
    analysis_id: str,
    request: ShareRequest,
):
    """Create a shareable link for an analysis."""
    orchestrator = get_orchestrator()

    # Verify analysis exists
    result = orchestrator.get_analysis(analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    share = orchestrator.ux_service.create_share_link(
        analysis_id=analysis_id,
        created_by="api",
        access_level=request.access_level,
        expires_hours=request.expires_hours,
        password_protected=request.password_protected,
        allowed_emails=request.allowed_emails,
    )

    return {
        "share_id": share.id,
        "share_url": f"/analyze/v2/shared/{share.id}",
        "access_level": share.access_level,
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
    }

@enhanced_router.get("/shared/{share_id}")
async def get_shared_analysis(share_id: str):
    """Retrieve a shared analysis by share link."""
    orchestrator = get_orchestrator()
    share = orchestrator.ux_service.get_share(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    if share.expires_at and share.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share link expired")

    result = orchestrator.get_analysis(share.analysis_id)
    if not result:
        raise HTTPException(status_code=404, detail="Analysis not found")

    try:
        orchestrator.ux_service.record_share_access(share_id)
    except Exception:
        pass

    return {
        "share_id": share.id,
        "analysis_id": share.analysis_id,
        "access_level": share.access_level,
        "analysis": result.model_dump(),
    }

# INTEGRATION ENDPOINTS
# (GET /integrations moved before /{analysis_id} catch-all above)

@enhanced_router.post("/integrations")
async def register_integration(request: IntegrationRequest):
    """Register an external integration (Slack/Teams/Jira/Email)."""
    orchestrator = get_orchestrator()
    try:
        integration_id = orchestrator.integration_service.register_integration(
            name=request.name,
            integration_type=request.integration_type,
            config=request.config,
        )
    except ValueError as exc:
        logger.warning("Invalid integration config: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid integration configuration")

    return {"id": integration_id, "type": request.integration_type}

@enhanced_router.post("/integrations/{integration_id}/notify")
async def send_integration_notification(
    integration_id: str,
    request: IntegrationMessageRequest,
):
    """Send a notification through an integration."""
    orchestrator = get_orchestrator()
    success = await orchestrator.integration_service.send_notification(
        integration_id,
        request.message,
        **(request.data or {}),
    )
    if not success:
        raise HTTPException(status_code=404, detail="Integration not found or notification failed")
    return {"status": "sent", "integration_id": integration_id}

@enhanced_router.post("/integrations/{integration_id}/items")
async def create_integration_item(
    integration_id: str,
    request: IntegrationItemRequest,
):
    """Create an item (ticket/task) in an external integration."""
    orchestrator = get_orchestrator()
    item_id = await orchestrator.integration_service.create_external_item(
        integration_id,
        request.data or {},
    )
    if not item_id:
        raise HTTPException(status_code=404, detail="Integration not found or create failed")
    return {"status": "created", "integration_id": integration_id, "item_id": item_id}

# (GET /sources moved before /{analysis_id} catch-all above)

@enhanced_router.post("/sources")
async def register_data_source(request: DataSourceRequest):
    """Register a data source connection."""
    orchestrator = get_orchestrator()
    try:
        source_type = DataSourceType(request.source_type)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Unknown data source type: {request.source_type}")

    connection = orchestrator.integration_service.register_data_source(
        name=request.name,
        source_type=source_type,
        config=request.config,
    )
    return {
        "id": connection.id,
        "name": connection.name,
        "type": connection.type.value,
        "created_at": connection.created_at.isoformat(),
    }

@enhanced_router.post("/sources/{connection_id}/fetch")
async def fetch_data_from_source(connection_id: str, request: DataFetchRequest):
    """Fetch data from a registered data source."""
    orchestrator = get_orchestrator()
    result = await orchestrator.integration_service.fetch_from_source(
        connection_id=connection_id,
        query=request.query,
    )
    return {
        "success": result.success,
        "data": result.data,
        "error": result.error,
        "metadata": result.metadata,
    }

@enhanced_router.post("/triggers")
async def create_trigger(request: TriggerRequest):
    """Create a workflow trigger."""
    orchestrator = get_orchestrator()
    trigger = orchestrator.integration_service.create_trigger(
        name=request.name,
        trigger_type=request.trigger_type,
        config=request.config,
        action=request.action,
    )
    return {
        "id": trigger.id,
        "name": trigger.name,
        "trigger_type": trigger.trigger_type,
        "action": trigger.action,
        "enabled": trigger.enabled,
    }

@enhanced_router.post("/pipelines")
async def create_pipeline(request: PipelineRequest):
    """Create a workflow pipeline."""
    orchestrator = get_orchestrator()
    pipeline = orchestrator.integration_service.create_pipeline(
        name=request.name,
        steps=request.steps,
    )
    return {"id": pipeline.id, "name": pipeline.name, "step_count": len(pipeline.steps)}

@enhanced_router.post("/pipelines/{pipeline_id}/execute")
async def execute_pipeline(pipeline_id: str, request: PipelineExecuteRequest):
    """Execute a workflow pipeline."""
    orchestrator = get_orchestrator()
    try:
        execution = await orchestrator.integration_service.execute_pipeline(
            pipeline_id=pipeline_id,
            input_data=request.input_data,
        )
    except ValueError as exc:
        logger.warning("Pipeline not found: %s", exc)
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return {
        "id": execution.id,
        "pipeline_id": execution.pipeline_id,
        "status": execution.status,
        "started_at": execution.started_at.isoformat(),
        "completed_at": execution.completed_at.isoformat() if execution.completed_at else None,
        "step_results": execution.step_results,
        "error": execution.error,
    }

@enhanced_router.post("/schedules")
async def schedule_analysis(request: ScheduleRequest):
    """Schedule a recurring analysis workflow."""
    orchestrator = get_orchestrator()
    scheduled = orchestrator.integration_service.schedule_analysis(
        name=request.name,
        source_config=request.source_config,
        schedule=request.schedule,
        analysis_config=request.analysis_config,
        notifications=request.notifications,
    )
    return scheduled.model_dump()

@enhanced_router.post("/webhooks")
async def register_webhook(request: WebhookRequest):
    """Register a webhook for analysis events."""
    orchestrator = get_orchestrator()
    webhook = orchestrator.integration_service.register_webhook(
        url=request.url,
        events=request.events,
        secret=request.secret,
    )
    return webhook.model_dump()

@enhanced_router.post("/webhooks/{webhook_id}/send")
async def send_webhook_test(webhook_id: str, request: WebhookSendRequest):
    """Send a test webhook event."""
    orchestrator = get_orchestrator()
    success = await orchestrator.integration_service.send_webhook(
        webhook_id=webhook_id,
        event=request.event,
        payload=request.payload,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Webhook not found or send failed")
    return {"status": "sent", "webhook_id": webhook_id}

# CONFIGURATION ENDPOINTS

@enhanced_router.get("/config/industries")
async def get_industry_options():
    """Get available industry options for analysis configuration."""
    orchestrator = get_orchestrator()
    return {"industries": orchestrator.get_industry_options()}

@enhanced_router.get("/config/export-formats")
async def get_export_formats():
    """Get available export formats."""
    orchestrator = get_orchestrator()
    return {"formats": orchestrator.get_export_formats()}

@enhanced_router.get("/config/chart-types")
async def get_chart_types():
    """Get available chart types."""
    return {
        "chart_types": [
            {"value": ct.value, "label": ct.value.replace("_", " ").title()}
            for ct in ChartType
        ]
    }

@enhanced_router.get("/config/summary-modes")
async def get_summary_modes():
    """Get available summary modes."""
    return {
        "modes": [
            {
                "value": sm.value,
                "label": sm.value.replace("_", " ").title(),
                "description": {
                    "executive": "C-suite 3-bullet overview",
                    "data": "Key figures and trends",
                    "quick": "One sentence essence",
                    "comprehensive": "Full structured analysis",
                    "action_items": "To-dos and next steps",
                    "risks": "Potential issues and concerns",
                    "opportunities": "Growth areas identified",
                }.get(sm.value, ""),
            }
            for sm in SummaryMode
        ]
    }

# Merged generate routes

# --- Source: run_routes.py ---

from fastapi import APIRouter, Request

from backend.app.schemas import RunPayload

def build_run_router(
    *,
    reports_run_fn,
    enqueue_job_fn,
) -> APIRouter:
    """
    Build router for run endpoints while delegating to existing handlers.
    """
    router = APIRouter()

    @router.post("/reports/run")
    def start_run(payload: RunPayload, request: Request):
        return reports_run_fn(payload, request, kind="pdf")

    @router.post("/excel/reports/run")
    def start_run_excel(payload: RunPayload, request: Request):
        return reports_run_fn(payload, request, kind="excel")

    @router.post("/jobs/run-report")
    async def enqueue_report_job(payload: RunPayload | list[RunPayload], request: Request):
        return await enqueue_job_fn(payload, request, kind="pdf")

    @router.post("/excel/jobs/run-report")
    async def enqueue_report_job_excel(payload: RunPayload | list[RunPayload], request: Request):
        return await enqueue_job_fn(payload, request, kind="excel")

    return router

# --- Source: discover_routes.py ---

from fastapi import APIRouter, Request

from backend.app.schemas import DiscoverPayload
from backend.app.services.platform_services import discover_reports as discover_reports_service

def build_discover_router(
    *,
    template_dir_fn,
    db_path_fn,
    load_contract_fn,
    clean_key_values_fn,
    discover_pdf_fn,
    discover_excel_fn,
    build_field_catalog_fn,
    build_batch_metrics_fn,
    load_manifest_fn,
    manifest_endpoint_fn_pdf,
    manifest_endpoint_fn_excel,
    logger,
) -> APIRouter:
    router = APIRouter()

    def _discover(kind: str, payload: DiscoverPayload):
        discover_fn = discover_pdf_fn if kind == "pdf" else discover_excel_fn
        manifest_endpoint_fn = manifest_endpoint_fn_pdf if kind == "pdf" else manifest_endpoint_fn_excel
        return discover_reports_service(
            payload,
            kind=kind,
            template_dir_fn=lambda tpl: template_dir_fn(tpl, kind=kind),
            db_path_fn=db_path_fn,
            load_contract_fn=load_contract_fn,
            clean_key_values_fn=clean_key_values_fn,
            discover_fn=discover_fn,
            build_field_catalog_fn=build_field_catalog_fn,
            build_batch_metrics_fn=build_batch_metrics_fn,
            load_manifest_fn=lambda tdir: load_manifest_fn(tdir),
            manifest_endpoint_fn=lambda tpl: manifest_endpoint_fn(tpl, kind=kind),
            logger=logger,
        )

    @router.post("/reports/discover")
    def discover_reports(payload: DiscoverPayload, _request: Request):
        return _discover("pdf", payload)

    @router.post("/excel/reports/discover")
    def discover_reports_excel(payload: DiscoverPayload, _request: Request):
        return _discover("excel", payload)

    return router

# --- Source: chart_suggest_routes.py ---

from fastapi import APIRouter, Request

from backend.app.schemas import ChartSuggestPayload
from backend.app.services.platform_services import suggest_charts as suggest_charts_service

def build_chart_suggest_router(
    *,
    template_dir_fn,
    db_path_fn,
    load_contract_fn,
    clean_key_values_fn,
    discover_pdf_fn,
    discover_excel_fn,
    build_field_catalog_fn,
    build_metrics_fn,
    build_prompt_fn,
    call_chat_completion_fn,
    model,
    strip_code_fences_fn,
    get_correlation_id_fn,
    logger,
) -> APIRouter:
    router = APIRouter()

    def _route(template_id: str, payload: ChartSuggestPayload, request: Request, kind: str):
        correlation_id = getattr(request.state, "correlation_id", None) or get_correlation_id_fn()
        discover_fn = discover_pdf_fn if kind == "pdf" else discover_excel_fn
        return suggest_charts_service(
            template_id,
            payload,
            kind=kind,
            correlation_id=correlation_id,
            template_dir_fn=lambda tpl: template_dir_fn(tpl, kind=kind),
            db_path_fn=db_path_fn,
            load_contract_fn=load_contract_fn,
            clean_key_values_fn=clean_key_values_fn,
            discover_fn=discover_fn,
            build_field_catalog_fn=build_field_catalog_fn,
            build_metrics_fn=build_metrics_fn,
            build_prompt_fn=build_prompt_fn,
            call_chat_completion_fn=call_chat_completion_fn,
            model=model,
            strip_code_fences_fn=strip_code_fences_fn,
            logger=logger,
        )

    @router.post("/templates/{template_id}/charts/suggest")
    def suggest_charts(template_id: str, payload: ChartSuggestPayload, request: Request):
        return _route(template_id, payload, request, kind="pdf")

    @router.post("/excel/{template_id}/charts/suggest")
    def suggest_charts_excel(template_id: str, payload: ChartSuggestPayload, request: Request):
        return _route(template_id, payload, request, kind="excel")

    return router

# --- Source: saved_charts_routes.py ---

from fastapi import APIRouter

from backend.app.schemas import SavedChartCreatePayload, SavedChartUpdatePayload
from backend.app.services.platform_services import (
    create_saved_chart as create_saved_chart_service,
    delete_saved_chart as delete_saved_chart_service,
    list_saved_charts as list_saved_charts_service,
    update_saved_chart as update_saved_chart_service,
)

def build_saved_charts_router(ensure_template_exists, normalize_template_id) -> APIRouter:
    router = APIRouter()

    @router.get("/templates/{template_id}/charts/saved")
    def list_saved_charts(template_id: str):
        return list_saved_charts_service(template_id, ensure_template_exists)

    @router.post("/templates/{template_id}/charts/saved")
    def create_saved_chart(template_id: str, payload: SavedChartCreatePayload):
        return create_saved_chart_service(
            template_id,
            payload,
            ensure_template_exists=ensure_template_exists,
            normalize_template_id=normalize_template_id,
        )

    @router.put("/templates/{template_id}/charts/saved/{chart_id}")
    def update_saved_chart(template_id: str, chart_id: str, payload: SavedChartUpdatePayload):
        return update_saved_chart_service(template_id, chart_id, payload, ensure_template_exists)

    @router.delete("/templates/{template_id}/charts/saved/{chart_id}")
    def delete_saved_chart(template_id: str, chart_id: str):
        return delete_saved_chart_service(template_id, chart_id, ensure_template_exists)

    @router.get("/excel/{template_id}/charts/saved")
    def list_saved_charts_excel(template_id: str):
        return list_saved_charts_service(template_id, ensure_template_exists)

    @router.post("/excel/{template_id}/charts/saved")
    def create_saved_chart_excel(template_id: str, payload: SavedChartCreatePayload):
        return create_saved_chart_service(
            template_id,
            payload,
            ensure_template_exists=ensure_template_exists,
            normalize_template_id=normalize_template_id,
        )

    @router.put("/excel/{template_id}/charts/saved/{chart_id}")
    def update_saved_chart_excel(template_id: str, chart_id: str, payload: SavedChartUpdatePayload):
        return update_saved_chart_service(template_id, chart_id, payload, ensure_template_exists)

    @router.delete("/excel/{template_id}/charts/saved/{chart_id}")
    def delete_saved_chart_excel(template_id: str, chart_id: str):
        return delete_saved_chart_service(template_id, chart_id, ensure_template_exists)

    return router
