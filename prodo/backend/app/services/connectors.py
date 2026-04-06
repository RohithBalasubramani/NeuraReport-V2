from __future__ import annotations

"""Merged connectors module."""

"""Connector infrastructure — base classes, registry, resilience."""

# BASE

"""
Connector Base - Abstract base class for all connectors.
"""

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

class ConnectorType(str, Enum):
    """Types of connectors."""

    DATABASE = "database"
    CLOUD_STORAGE = "cloud_storage"
    PRODUCTIVITY = "productivity"
    API = "api"

class AuthType(str, Enum):
    """Authentication types."""

    NONE = "none"
    BASIC = "basic"
    API_KEY = "api_key"
    OAUTH2 = "oauth2"
    SERVICE_ACCOUNT = "service_account"
    CONNECTION_STRING = "connection_string"

class ConnectorCapability(str, Enum):
    """Connector capabilities."""

    READ = "read"
    WRITE = "write"
    STREAM = "stream"
    SCHEMA_DISCOVERY = "schema_discovery"
    QUERY = "query"
    SYNC = "sync"
    WEBHOOK = "webhook"

class ConnectionTest(BaseModel):
    """Result of connection test."""

    success: bool
    latency_ms: Optional[float] = None
    error: Optional[str] = None
    details: Optional[dict[str, Any]] = None

class SchemaInfo(BaseModel):
    """Database/storage schema information."""

    tables: list[TableInfo] = []
    views: list[TableInfo] = []
    schemas: list[str] = []

class TableInfo(BaseModel):
    """Table/collection information."""

    name: str
    schema_name: Optional[str] = None
    columns: list[ColumnInfo] = []
    row_count: Optional[int] = None
    size_bytes: Optional[int] = None

class ColumnInfo(BaseModel):
    """Column information."""

    name: str
    data_type: str
    nullable: bool = True
    primary_key: bool = False
    foreign_key: Optional[str] = None
    default_value: Optional[Any] = None

class QueryResult(BaseModel):
    """Result of a query execution."""

    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    execution_time_ms: float
    truncated: bool = False
    error: Optional[str] = None

class FileInfo(BaseModel):
    """File/object information for cloud storage."""

    id: str
    name: str
    path: str
    size_bytes: int
    mime_type: Optional[str] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    is_folder: bool = False
    download_url: Optional[str] = None

class ConnectorBase(ABC):
    """
    Abstract base class for all connectors.

    All connectors must implement the core methods:
    - connect: Establish connection
    - disconnect: Clean up resources
    - test_connection: Verify connection health
    """

    # Class attributes to be overridden by subclasses
    connector_id: str = ""
    connector_name: str = ""
    connector_type: ConnectorType = ConnectorType.DATABASE
    auth_types: list[AuthType] = [AuthType.BASIC]
    capabilities: list[ConnectorCapability] = [ConnectorCapability.READ]
    free_tier: bool = True  # All connectors must be free

    def __init__(self, config: dict[str, Any]):
        """
        Initialize connector with configuration.

        Args:
            config: Connector-specific configuration dict
        """
        self.config = config
        self._connected = False
        self._credentials: Optional[dict] = None

    @property
    def is_connected(self) -> bool:
        """Check if connector is connected."""
        return self._connected

    @abstractmethod
    async def connect(self) -> bool:
        """
        Establish connection to the data source.

        Returns:
            True if connection successful
        """
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """Clean up connection resources."""
        pass

    @abstractmethod
    async def test_connection(self) -> ConnectionTest:
        """
        Test if connection is healthy.

        Returns:
            ConnectionTest with success status and latency
        """
        pass

    async def discover_schema(self) -> SchemaInfo:
        """
        Discover available data structures (tables, collections, etc.).

        Returns:
            SchemaInfo with discovered structures
        """
        raise NotImplementedError(f"{self.connector_name} does not support schema discovery")

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """
        Execute a query and return results.

        Args:
            query: Query string (SQL, API path, etc.)
            parameters: Query parameters
            limit: Maximum rows to return

        Returns:
            QueryResult with data
        """
        raise NotImplementedError(f"{self.connector_name} does not support queries")

    async def list_files(
        self,
        path: str = "/",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """
        List files in cloud storage.

        Args:
            path: Directory path
            recursive: Include subdirectories

        Returns:
            List of FileInfo objects
        """
        raise NotImplementedError(f"{self.connector_name} does not support file listing")

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """
        Download a file from cloud storage.

        Args:
            file_id: File identifier
            destination: Local path to save file

        Returns:
            File content as bytes
        """
        raise NotImplementedError(f"{self.connector_name} does not support file download")

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """
        Upload a file to cloud storage.

        Args:
            content: File content
            path: Destination path
            filename: File name
            mime_type: MIME type

        Returns:
            FileInfo of uploaded file
        """
        raise NotImplementedError(f"{self.connector_name} does not support file upload")

    def get_oauth_url(
        self,
        redirect_uri: str,
        state: str,
    ) -> Optional[str]:
        """
        Get OAuth authorization URL if applicable.

        Args:
            redirect_uri: OAuth callback URL
            state: State parameter for security

        Returns:
            Authorization URL or None
        """
        return None

    def handle_oauth_callback(
        self,
        code: str,
        redirect_uri: str,
    ) -> dict[str, Any]:
        """
        Handle OAuth callback and exchange code for tokens.

        Args:
            code: Authorization code
            redirect_uri: Same redirect_uri used in auth URL

        Returns:
            Token dictionary
        """
        raise NotImplementedError(f"{self.connector_name} does not support OAuth")

    async def refresh_token(self) -> dict[str, Any]:
        """
        Refresh OAuth access token.

        Returns:
            New token dictionary
        """
        raise NotImplementedError(f"{self.connector_name} does not support token refresh")

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        """
        Get JSON schema for connector configuration.

        Returns:
            JSON schema dictionary
        """
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }

    @classmethod
    def get_connector_info(cls) -> dict[str, Any]:
        """
        Get connector metadata.

        Returns:
            Connector information dictionary
        """
        return {
            "id": cls.connector_id,
            "name": cls.connector_name,
            "type": cls.connector_type.value,
            "auth_types": [at.value for at in cls.auth_types],
            "capabilities": [cap.value for cap in cls.capabilities],
            "free_tier": cls.free_tier,
            "config_schema": cls.get_config_schema(),
        }

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(id={self.connector_id}, connected={self._connected})>"

# REGISTRY

"""
Connector Registry - Central registry for all connector types.
"""

import logging
from typing import Any, Type


logger = logging.getLogger("neura.connectors.registry")

# Global registry of connector classes
CONNECTOR_REGISTRY: dict[str, Type[ConnectorBase]] = {}

def register_connector(connector_class: Type[ConnectorBase]) -> Type[ConnectorBase]:
    """
    Decorator to register a connector class.

    Usage:
        @register_connector
        class PostgreSQLConnector(ConnectorBase):
            connector_id = "postgresql"
            ...
    """
    connector_id = connector_class.connector_id
    if not connector_id:
        raise ValueError(f"Connector class {connector_class.__name__} must have a connector_id")

    if connector_id in CONNECTOR_REGISTRY:
        logger.warning(f"Overwriting existing connector: {connector_id}")

    CONNECTOR_REGISTRY[connector_id] = connector_class
    logger.info(f"Registered connector: {connector_id}")
    return connector_class

def get_connector(connector_id: str, config: dict[str, Any]) -> ConnectorBase:
    """
    Factory function to create a connector instance.

    Args:
        connector_id: ID of the connector type
        config: Connector configuration

    Returns:
        Connector instance

    Raises:
        ValueError: If connector_id is not registered
    """
    if connector_id not in CONNECTOR_REGISTRY:
        available = ", ".join(CONNECTOR_REGISTRY.keys())
        raise ValueError(f"Unknown connector: {connector_id}. Available: {available}")

    connector_class = CONNECTOR_REGISTRY[connector_id]
    return connector_class(config)

def list_connectors() -> list[dict[str, Any]]:
    """
    List all registered connectors with their metadata.

    Returns:
        List of connector info dictionaries
    """
    return [
        connector_class.get_connector_info()
        for connector_class in CONNECTOR_REGISTRY.values()
    ]

def get_connector_info(connector_id: str) -> dict[str, Any] | None:
    """
    Get info for a specific connector.

    Args:
        connector_id: ID of the connector

    Returns:
        Connector info or None if not found
    """
    if connector_id not in CONNECTOR_REGISTRY:
        return None
    return CONNECTOR_REGISTRY[connector_id].get_connector_info()

def list_connectors_by_type(connector_type: str) -> list[dict[str, Any]]:
    """
    List connectors filtered by type.

    Args:
        connector_type: Type to filter by (database, cloud_storage, etc.)

    Returns:
        Filtered list of connector info
    """
    return [
        connector_class.get_connector_info()
        for connector_class in CONNECTOR_REGISTRY.values()
        if connector_class.connector_type.value == connector_type
    ]

# Explicit imports to trigger @register_connector decorators
def _register_all_connectors():
    """Import mega-merged connector modules to trigger registration."""
    try:
        from . import databases_all  # noqa: F401 — triggers @register_connector
    except ImportError as e:
        logger.debug(f"Could not import database connectors: {e}")

    try:
        from . import storage_all  # noqa: F401 — triggers @register_connector
    except ImportError as e:
        logger.debug(f"Could not import storage connectors: {e}")

# Run registration on module import
try:
    _register_all_connectors()
except Exception as e:
    logger.warning(f"Error during connector registration: {e}")

# RESILIENCE

"""
Resilience utilities for database connectors.

Implements retry logic with exponential backoff and error classification
following state-of-the-art patterns from Tenacity, Sidekiq, and AWS.
"""

import asyncio
import logging
import random
import time
from functools import wraps
from typing import Any, Callable, Optional, Tuple, Type, TypeVar

logger = logging.getLogger("neura.connectors.resilience")

# Type variable for generic decorator
T = TypeVar("T")

# Error Classification

# Transient errors that should be retried (temporary failures)
TRANSIENT_ERRORS: Tuple[Type[Exception], ...] = (
    ConnectionError,
    ConnectionRefusedError,
    ConnectionResetError,
    ConnectionAbortedError,
    TimeoutError,
    asyncio.TimeoutError,
    OSError,  # Network errors often raise OSError
)

# Permanent errors that should NOT be retried (will never succeed)
PERMANENT_ERRORS: Tuple[Type[Exception], ...] = (
    ValueError,  # Invalid configuration
    TypeError,   # Type errors in config
    KeyError,    # Missing required config
    PermissionError,  # Permission denied
)

def is_transient_error(exception: Exception) -> bool:
    """
    Check if an exception represents a transient (retriable) error.

    Args:
        exception: The exception to classify

    Returns:
        True if the error is transient and should be retried
    """
    # Check exception type
    if isinstance(exception, PERMANENT_ERRORS):
        return False

    if isinstance(exception, TRANSIENT_ERRORS):
        return True

    # Check error message for common patterns
    error_msg = str(exception).lower()

    # Permanent patterns (check first)
    permanent_patterns = [
        "authentication failed",
        "permission denied",
        "access denied",
        "invalid credentials",
        "invalid password",
        "invalid username",
        "not found",
        "does not exist",
        "invalid configuration",
    ]
    for pattern in permanent_patterns:
        if pattern in error_msg:
            return False

    # Transient patterns
    transient_patterns = [
        "connection refused",
        "connection reset",
        "connection timed out",
        "timeout",
        "temporarily unavailable",
        "too many connections",
        "database is locked",
        "deadlock",
        "try again",
        "service unavailable",
        "503",
        "502",
        "504",
    ]
    for pattern in transient_patterns:
        if pattern in error_msg:
            return True

    # Default: unknown errors are considered transient (optimistic)
    logger.debug(f"Unknown error type, treating as transient: {type(exception).__name__}")
    return True

def is_permanent_error(exception: Exception) -> bool:
    """
    Check if an exception represents a permanent (non-retriable) error.

    Args:
        exception: The exception to classify

    Returns:
        True if the error is permanent and should not be retried
    """
    return not is_transient_error(exception)

# Retry Decorator

def with_retry(
    max_attempts: int = 3,
    min_wait: float = 1.0,
    max_wait: float = 30.0,
    exponential_base: float = 2.0,
    jitter: bool = True,
    retry_on: Optional[Tuple[Type[Exception], ...]] = None,
    on_retry: Optional[Callable[[Exception, int], None]] = None,
    health: Optional[ConnectionHealth] = None,
):
    """
    Decorator for database operations with retry logic.

    Implements exponential backoff with optional jitter to prevent
    thundering herd problems.

    Args:
        max_attempts: Maximum number of retry attempts (default: 3)
        min_wait: Minimum wait time between retries in seconds (default: 1.0)
        max_wait: Maximum wait time between retries in seconds (default: 30.0)
        exponential_base: Base for exponential backoff calculation (default: 2.0)
        jitter: Add random jitter to wait times (default: True)
        retry_on: Tuple of exception types to retry on (default: TRANSIENT_ERRORS)
        on_retry: Optional callback called before each retry with (exception, attempt)

    Returns:
        Decorated function with retry logic

    Example:
        @with_retry(max_attempts=3, min_wait=1, max_wait=30)
        async def connect_to_database():
            ...
    """
    if retry_on is None:
        retry_on = TRANSIENT_ERRORS

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Optional[Exception] = None

            for attempt in range(1, max_attempts + 1):
                # Circuit breaker check
                if health is not None and not health.allow_request():
                    raise ConnectionError(
                        f"Circuit breaker open for {func.__name__}: "
                        f"{health.consecutive_failures} consecutive failures, "
                        f"last error: {health.last_error}"
                    )

                try:
                    result = await func(*args, **kwargs)
                    if health is not None:
                        health.record_success(0)
                    return result
                except Exception as e:
                    last_exception = e
                    if health is not None:
                        health.record_failure(e)

                    # Check if this is a permanent error
                    if is_permanent_error(e):
                        logger.warning(
                            f"Permanent error on {func.__name__}, not retrying: {e}"
                        )
                        raise

                    # Check if we should retry on this exception type
                    if not isinstance(e, retry_on) and not is_transient_error(e):
                        logger.warning(
                            f"Non-retriable error on {func.__name__}: {e}"
                        )
                        raise

                    # Last attempt - don't retry
                    if attempt >= max_attempts:
                        logger.error(
                            f"Max retries ({max_attempts}) exceeded for {func.__name__}: {e}"
                        )
                        raise

                    # Calculate wait time with exponential backoff
                    wait_time = min(
                        max_wait,
                        max(min_wait, min_wait * (exponential_base ** (attempt - 1)))
                    )

                    # Add jitter (0-50% of wait time)
                    if jitter:
                        wait_time = wait_time * (1 + random.uniform(0, 0.5))

                    logger.info(
                        f"Retry {attempt}/{max_attempts} for {func.__name__} "
                        f"after {wait_time:.2f}s: {e}"
                    )

                    # Call retry callback if provided
                    if on_retry:
                        try:
                            on_retry(e, attempt)
                        except Exception as callback_error:
                            logger.debug(f"Retry callback error: {callback_error}")

                    await asyncio.sleep(wait_time)

            # Should not reach here, but raise last exception if we do
            if last_exception:
                raise last_exception
            raise RuntimeError(f"Unexpected state in retry decorator for {func.__name__}")

        @wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Optional[Exception] = None

            for attempt in range(1, max_attempts + 1):
                # Circuit breaker check
                if health is not None and not health.allow_request():
                    raise ConnectionError(
                        f"Circuit breaker open for {func.__name__}: "
                        f"{health.consecutive_failures} consecutive failures, "
                        f"last error: {health.last_error}"
                    )

                try:
                    result = func(*args, **kwargs)
                    if health is not None:
                        health.record_success(0)
                    return result
                except Exception as e:
                    last_exception = e
                    if health is not None:
                        health.record_failure(e)

                    # Check if this is a permanent error
                    if is_permanent_error(e):
                        logger.warning(
                            f"Permanent error on {func.__name__}, not retrying: {e}"
                        )
                        raise

                    # Check if we should retry on this exception type
                    if not isinstance(e, retry_on) and not is_transient_error(e):
                        logger.warning(
                            f"Non-retriable error on {func.__name__}: {e}"
                        )
                        raise

                    # Last attempt - don't retry
                    if attempt >= max_attempts:
                        logger.error(
                            f"Max retries ({max_attempts}) exceeded for {func.__name__}: {e}"
                        )
                        raise

                    # Calculate wait time with exponential backoff
                    wait_time = min(
                        max_wait,
                        max(min_wait, min_wait * (exponential_base ** (attempt - 1)))
                    )

                    # Add jitter (0-50% of wait time)
                    if jitter:
                        wait_time = wait_time * (1 + random.uniform(0, 0.5))

                    logger.info(
                        f"Retry {attempt}/{max_attempts} for {func.__name__} "
                        f"after {wait_time:.2f}s: {e}"
                    )

                    # Call retry callback if provided
                    if on_retry:
                        try:
                            on_retry(e, attempt)
                        except Exception as callback_error:
                            logger.debug(f"Retry callback error: {callback_error}")

                    time.sleep(wait_time)

            # Should not reach here, but raise last exception if we do
            if last_exception:
                raise last_exception
            raise RuntimeError(f"Unexpected state in retry decorator for {func.__name__}")

        # Return appropriate wrapper based on function type
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator

# Connection Pool Health

class ConnectionHealth:
    """Track connection health metrics with circuit breaker behaviour.

    When ``consecutive_failures`` reaches ``failure_threshold`` the circuit
    *opens* and ``allow_request()`` returns ``False``.  After
    ``cooldown_seconds`` the circuit moves to *half-open*, allowing one
    probe request through.  A success closes the circuit; a failure
    re-opens it.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        cooldown_seconds: float = 60.0,
    ):
        self.total_requests: int = 0
        self.successful_requests: int = 0
        self.failed_requests: int = 0
        self.total_latency_ms: float = 0.0
        self.consecutive_failures: int = 0
        self.last_error: Optional[str] = None
        # Circuit breaker state
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._circuit_opened_at: Optional[float] = None
        self._half_open: bool = False

    def record_success(self, latency_ms: float) -> None:
        """Record a successful operation.  Closes circuit if half-open."""
        self.total_requests += 1
        self.successful_requests += 1
        self.total_latency_ms += latency_ms
        self.consecutive_failures = 0
        self._circuit_opened_at = None
        self._half_open = False

    def record_failure(self, error: Exception) -> None:
        """Record a failed operation.  Opens circuit when threshold reached."""
        self.total_requests += 1
        self.failed_requests += 1
        self.consecutive_failures += 1
        self.last_error = str(error)
        if (
            self.consecutive_failures >= self._failure_threshold
            and self._circuit_opened_at is None
        ):
            self._circuit_opened_at = time.monotonic()
            self._half_open = False
            logger.info(
                f"Circuit opened after {self.consecutive_failures} consecutive failures"
            )

    def allow_request(self) -> bool:
        """Return ``True`` if a request should be allowed through.

        * Circuit closed → always allow
        * Circuit open, cooldown not expired → deny
        * Circuit open, cooldown expired → half-open, allow one probe
        """
        if self._circuit_opened_at is None:
            return True

        elapsed = time.monotonic() - self._circuit_opened_at
        if elapsed >= self._cooldown_seconds:
            if not self._half_open:
                self._half_open = True
                logger.info("Circuit half-open, allowing probe request")
                return True
            return False

        return False

    @property
    def circuit_state(self) -> str:
        """Return the current circuit breaker state."""
        if self._circuit_opened_at is None:
            return "closed"
        elapsed = time.monotonic() - self._circuit_opened_at
        if elapsed >= self._cooldown_seconds:
            return "half_open"
        return "open"

    @property
    def success_rate(self) -> float:
        """Calculate success rate as a percentage."""
        if self.total_requests == 0:
            return 100.0
        return (self.successful_requests / self.total_requests) * 100

    @property
    def average_latency_ms(self) -> float:
        """Calculate average latency in milliseconds."""
        if self.successful_requests == 0:
            return 0.0
        return self.total_latency_ms / self.successful_requests

    @property
    def status(self) -> str:
        """Determine overall health status."""
        if self.consecutive_failures >= 5:
            return "unhealthy"
        if self.consecutive_failures >= 2 or self.success_rate < 90:
            return "degraded"
        return "healthy"

    def to_dict(self) -> dict:
        """Convert health metrics to dictionary."""
        return {
            "status": self.status,
            "circuit_state": self.circuit_state,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "success_rate": round(self.success_rate, 2),
            "average_latency_ms": round(self.average_latency_ms, 2),
            "consecutive_failures": self.consecutive_failures,
            "last_error": self.last_error,
        }

# Convenience Functions

def retry_on_connection_error(func: Callable[..., T]) -> Callable[..., T]:
    """
    Simple decorator to retry on connection errors with default settings.

    Equivalent to @with_retry() with defaults.
    """
    return with_retry()(func)

def retry_with_longer_backoff(func: Callable[..., T]) -> Callable[..., T]:
    """
    Decorator for operations that need longer backoff (e.g., rate-limited APIs).
    """
    return with_retry(max_attempts=5, min_wait=2.0, max_wait=60.0)(func)

# Export all public symbols
__all__ = [
    "TRANSIENT_ERRORS",
    "PERMANENT_ERRORS",
    "is_transient_error",
    "is_permanent_error",
    "with_retry",
    "retry_on_connection_error",
    "retry_with_longer_backoff",
    "ConnectionHealth",
]

# Init re-exports
# Connector Services
"""
Services for database and cloud storage connectors.
"""

# base, registry, resilience are now defined above in this file

# Database Connectors (same-file, originally from .databases_all)
# Storage Connectors (same-file, originally from .storage_all)

__all__ = [
    # Base
    "ConnectorBase",
    "ConnectorType",
    "AuthType",
    "ConnectorCapability",
    "get_connector",
    "list_connectors",
    "register_connector",
    # Resilience
    "with_retry",
    "retry_on_connection_error",
    "retry_with_longer_backoff",
    "is_transient_error",
    "is_permanent_error",
    "ConnectionHealth",
    "TRANSIENT_ERRORS",
    "PERMANENT_ERRORS",
    # Database Connectors
    "PostgreSQLConnector",
    "MySQLConnector",
    "MongoDBConnector",
    "SQLServerConnector",
    "BigQueryConnector",
    "SnowflakeConnector",
    "ElasticsearchConnector",
    "DuckDBConnector",
    # Storage Connectors
    "AWSS3Connector",
    "AzureBlobConnector",
    "DropboxConnector",
    "GoogleDriveConnector",
    "OneDriveConnector",
    "SFTPConnector",
]

"""All database connector implementations merged into a single file."""

# bigquery.py
"""Google BigQuery Connector.

Connector for Google BigQuery using google-cloud-bigquery.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


@register_connector
class BigQueryConnector(ConnectorBase):
    """Google BigQuery database connector."""

    connector_id = "bigquery"
    connector_name = "Google BigQuery"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.SERVICE_ACCOUNT]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.QUERY,
        ConnectorCapability.SCHEMA_DISCOVERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._client = None

    async def connect(self) -> bool:
        """Establish connection to BigQuery."""
        try:
            from google.cloud import bigquery
            from google.oauth2 import service_account

            credentials_path = self.config.get("credentials_path")
            credentials_json = self.config.get("credentials_json")
            project_id = self.config.get("project_id")

            if credentials_json:
                import json
                if isinstance(credentials_json, str):
                    try:
                        credentials_json = json.loads(credentials_json)
                    except json.JSONDecodeError:
                        raise ConnectionError("Invalid credentials JSON format")
                credentials = service_account.Credentials.from_service_account_info(
                    credentials_json
                )
            elif credentials_path:
                credentials = service_account.Credentials.from_service_account_file(
                    credentials_path
                )
            else:
                # Use default credentials
                credentials = None

            self._client = bigquery.Client(
                project=project_id,
                credentials=credentials,
            )
            self._connected = True
            return True
        except ConnectionError:
            self._connected = False
            raise
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to BigQuery") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._client:
            self._client.close()
            self._client = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            # Run a simple query
            query = "SELECT 1"
            query_job = self._client.query(query)
            list(query_job.result())

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(success=True, latency_ms=latency)
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def discover_schema(self) -> SchemaInfo:
        """Discover database schema."""
        if not self._connected:
            await self.connect()

        tables: list[TableInfo] = []
        schemas: list[str] = []

        # List datasets (schemas)
        datasets = list(self._client.list_datasets())
        schemas = [ds.dataset_id for ds in datasets]

        # For each dataset, list tables
        for dataset in datasets:
            dataset_id = dataset.dataset_id
            dataset_tables = list(self._client.list_tables(dataset_id))

            for table_ref in dataset_tables:
                table = self._client.get_table(table_ref)
                columns = [
                    ColumnInfo(
                        name=field.name,
                        data_type=field.field_type,
                        nullable=field.mode == "NULLABLE",
                    )
                    for field in table.schema
                ]
                tables.append(TableInfo(
                    name=table.table_id,
                    schema_name=dataset_id,
                    columns=columns,
                    row_count=table.num_rows,
                    size_bytes=table.num_bytes,
                ))

        return SchemaInfo(tables=tables, schemas=schemas)

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._connected:
            await self.connect()

        start_time = time.time()

        try:
            from google.cloud import bigquery

            # Add LIMIT if not present
            query_upper = query.upper().strip()
            if query_upper.startswith("SELECT") and "LIMIT" not in query_upper:
                query = f"{query} LIMIT {limit}"

            job_config = bigquery.QueryJobConfig()
            if parameters:
                job_config.query_parameters = [
                    bigquery.ScalarQueryParameter(k, "STRING", v)
                    for k, v in parameters.items()
                ]

            query_job = self._client.query(query, job_config=job_config)
            results = query_job.result()

            columns = [field.name for field in results.schema]
            rows = [[cell for cell in row.values()] for row in results]

            execution_time = (time.time() - start_time) * 1000

            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time,
                truncated=len(rows) >= limit,
            )
        except Exception as e:
            logger.exception("query_execution_failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=(time.time() - start_time) * 1000,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "GCP Project ID"},
                "credentials_path": {"type": "string", "description": "Path to service account JSON"},
                "credentials_json": {"type": "object", "description": "Service account credentials JSON"},
            },
            "required": ["project_id"],
        }

# duckdb.py
"""DuckDB Database Connector.

Connector for DuckDB - an in-process analytical database.
"""

import logging
import os
import re
import time
from typing import Any, Optional

logger = logging.getLogger("neura.connectors.duckdb")

# Identifiers must be alphanumeric / underscores (with optional dots for schema.table)
_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

def _validate_identifier(value: str, label: str = "identifier") -> str:
    """Validate a SQL identifier to prevent injection.

    Only allows alphanumeric characters and underscores.
    Returns the value double-quoted for safe use in SQL.
    """
    if not value or not _SAFE_IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL {label}: {value!r}")
    return f'"{value}"'


@register_connector
class DuckDBConnector(ConnectorBase):
    """DuckDB database connector."""

    connector_id = "duckdb"
    connector_name = "DuckDB"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.NONE]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.QUERY,
        ConnectorCapability.SCHEMA_DISCOVERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._connection = None

    async def connect(self) -> bool:
        """Establish connection to DuckDB."""
        try:
            import duckdb

            database_path = self.config.get("database", ":memory:")
            read_only = self.config.get("read_only", False)

            # Validate database_path: reject path traversal for non-memory DBs
            if database_path != ":memory:":
                normalised = os.path.normpath(database_path)
                if ".." in normalised.split(os.sep):
                    raise ValueError("Database path traversal not allowed")

            self._connection = duckdb.connect(
                database=database_path,
                read_only=read_only,
            )
            self._connected = True
            return True
        except ValueError:
            raise
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to DuckDB") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._connection:
            self._connection.close()
            self._connection = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            self._connection.execute("SELECT 1")
            self._connection.fetchone()

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(success=True, latency_ms=latency)
        except Exception as e:
            return ConnectionTest(success=False, error="Connection test failed")

    async def discover_schema(self) -> SchemaInfo:
        """Discover database schema."""
        if not self._connected:
            await self.connect()

        tables: list[TableInfo] = []
        views: list[TableInfo] = []
        schemas: list[str] = []

        # Get schemas
        result = self._connection.execute("""
            SELECT schema_name FROM information_schema.schemata
        """)
        schemas = [row[0] for row in result.fetchall()]

        # Get tables
        result = self._connection.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
        """)
        for schema_name, table_name in result.fetchall():
            columns = await self._get_columns(schema_name, table_name)
            tables.append(TableInfo(
                name=table_name,
                schema_name=schema_name,
                columns=columns,
            ))

        # Get views
        result = self._connection.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'VIEW'
        """)
        for schema_name, view_name in result.fetchall():
            views.append(TableInfo(
                name=view_name,
                schema_name=schema_name,
            ))

        return SchemaInfo(tables=tables, views=views, schemas=schemas)

    async def _get_columns(self, schema_name: str, table_name: str) -> list[ColumnInfo]:
        """Get columns for a table."""
        result = self._connection.execute(
            """
            SELECT
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            """,
            [schema_name, table_name],
        )

        columns = []
        for name, dtype, nullable in result.fetchall():
            columns.append(ColumnInfo(
                name=name,
                data_type=dtype,
                nullable=nullable == "YES",
            ))

        return columns

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._connected:
            await self.connect()

        start_time = time.time()

        try:
            # Add LIMIT if not present
            query_upper = query.upper().strip()
            if query_upper.startswith("SELECT") and "LIMIT" not in query_upper:
                query = f"{query} LIMIT {limit}"

            if parameters:
                result = self._connection.execute(query, list(parameters.values()))
            else:
                result = self._connection.execute(query)

            if result.description:
                columns = [desc[0] for desc in result.description]
                rows = [list(row) for row in result.fetchall()]
            else:
                columns = []
                rows = []

            execution_time = (time.time() - start_time) * 1000

            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time,
                truncated=len(rows) >= limit,
            )
        except Exception as e:
            logger.exception("query_execution_failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=(time.time() - start_time) * 1000,
                error="Query execution failed",
            )

    async def load_parquet(self, file_path: str, table_name: str) -> bool:
        """Load a Parquet file into DuckDB."""
        if not self._connected:
            await self.connect()

        safe_table = _validate_identifier(table_name, "table name")
        try:
            self._connection.execute(
                f"CREATE OR REPLACE TABLE {safe_table} AS SELECT * FROM read_parquet(?)",
                [file_path],
            )
            return True
        except Exception:
            return False

    async def load_csv(
        self,
        file_path: str,
        table_name: str,
        header: bool = True,
        delimiter: str = ",",
    ) -> bool:
        """Load a CSV file into DuckDB."""
        if not self._connected:
            await self.connect()

        safe_table = _validate_identifier(table_name, "table name")
        # Delimiter must be a single character
        if len(delimiter) != 1:
            raise ValueError("CSV delimiter must be a single character")
        header_str = "true" if header else "false"
        try:
            self._connection.execute(
                f"CREATE OR REPLACE TABLE {safe_table} AS SELECT * FROM read_csv(?, header={header_str}, delim=?)",
                [file_path, delimiter],
            )
            return True
        except Exception:
            return False

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "database": {
                    "type": "string",
                    "default": ":memory:",
                    "description": "Database file path or :memory: for in-memory",
                },
                "read_only": {
                    "type": "boolean",
                    "default": False,
                    "description": "Open in read-only mode",
                },
            },
            "required": [],
        }

# elasticsearch.py
"""Elasticsearch Connector.

Connector for Elasticsearch using elasticsearch-py.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


@register_connector
class ElasticsearchConnector(ConnectorBase):
    """Elasticsearch connector."""

    connector_id = "elasticsearch"
    connector_name = "Elasticsearch"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC, AuthType.API_KEY, AuthType.NONE]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.QUERY,
        ConnectorCapability.SCHEMA_DISCOVERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._client = None

    async def connect(self) -> bool:
        """Establish connection to Elasticsearch."""
        try:
            from elasticsearch import Elasticsearch

            hosts = self.config.get("hosts", ["http://localhost:9200"])
            if isinstance(hosts, str):
                hosts = [hosts]

            auth_type = self.config.get("auth_type", "none")

            if auth_type == "basic":
                self._client = Elasticsearch(
                    hosts,
                    basic_auth=(
                        self.config.get("username"),
                        self.config.get("password"),
                    ),
                    verify_certs=self.config.get("verify_certs", True),
                )
            elif auth_type == "api_key":
                self._client = Elasticsearch(
                    hosts,
                    api_key=self.config.get("api_key"),
                    verify_certs=self.config.get("verify_certs", True),
                )
            else:
                self._client = Elasticsearch(
                    hosts,
                    verify_certs=self.config.get("verify_certs", False),
                )

            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to Elasticsearch") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._client:
            self._client.close()
            self._client = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            info = self._client.info()
            latency = (time.time() - start_time) * 1000

            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={
                    "cluster_name": info.get("cluster_name"),
                    "version": info.get("version", {}).get("number"),
                },
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def discover_schema(self) -> SchemaInfo:
        """Discover indices (tables) and their mappings."""
        if not self._connected:
            await self.connect()

        tables: list[TableInfo] = []

        # Get all indices
        indices = self._client.indices.get_alias(index="*")

        for index_name in indices.keys():
            # Skip system indices
            if index_name.startswith("."):
                continue

            # Get mapping
            mapping = self._client.indices.get_mapping(index=index_name)
            properties = mapping.get(index_name, {}).get("mappings", {}).get("properties", {})

            columns = []
            for field_name, field_info in properties.items():
                columns.append(ColumnInfo(
                    name=field_name,
                    data_type=field_info.get("type", "object"),
                    nullable=True,
                ))

            # Get document count
            count_response = self._client.count(index=index_name)
            row_count = count_response.get("count", 0)

            tables.append(TableInfo(
                name=index_name,
                columns=columns,
                row_count=row_count,
            ))

        return SchemaInfo(tables=tables)

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a search query."""
        if not self._connected:
            await self.connect()

        start_time = time.time()

        try:
            import json

            # Parse query - expect JSON or simple index search
            index = None
            if query.strip().startswith("{"):
                query_body = json.loads(query)
            else:
                # Simple search on index
                parts = query.split(":", 1)
                if len(parts) == 2:
                    index = parts[0].strip()
                    search_term = parts[1].strip()
                    query_body = {
                        "query": {
                            "query_string": {"query": search_term}
                        }
                    }
                else:
                    index = query.strip()
                    query_body = {"query": {"match_all": {}}}

            if index is None:
                index = parameters.get("index", "*") if parameters else "*"

            response = self._client.search(
                index=index,
                body=query_body,
                size=limit,
            )

            hits = response.get("hits", {}).get("hits", [])

            if hits:
                # Extract columns from first hit
                first_source = hits[0].get("_source", {})
                columns = ["_id", "_index"] + list(first_source.keys())

                rows = []
                for hit in hits:
                    source = hit.get("_source", {})
                    row = [hit.get("_id"), hit.get("_index")]
                    row.extend(source.get(col) for col in list(first_source.keys()))
                    rows.append(row)
            else:
                columns = []
                rows = []

            execution_time = (time.time() - start_time) * 1000

            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time,
                truncated=len(rows) >= limit,
            )
        except Exception as e:
            logger.exception("query_execution_failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=(time.time() - start_time) * 1000,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "hosts": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": ["http://localhost:9200"],
                    "description": "Elasticsearch hosts",
                },
                "auth_type": {
                    "type": "string",
                    "enum": ["none", "basic", "api_key"],
                    "default": "none",
                },
                "username": {"type": "string"},
                "password": {"type": "string", "format": "password"},
                "api_key": {"type": "string"},
                "verify_certs": {"type": "boolean", "default": True},
            },
            "required": ["hosts"],
        }

# mongodb.py
"""
MongoDB Connector - Connect to MongoDB databases.
"""

import logging
import time
from typing import Any, Optional


logger = logging.getLogger("neura.connectors.mongodb")

@register_connector
class MongoDBConnector(ConnectorBase):
    """MongoDB database connector using pymongo."""

    connector_id = "mongodb"
    connector_name = "MongoDB"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC, AuthType.CONNECTION_STRING]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.SCHEMA_DISCOVERY,
        ConnectorCapability.QUERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._client = None
        self._db = None

    async def connect(self) -> bool:
        """Establish connection to MongoDB."""
        try:
            from pymongo import MongoClient

            # Check if connection string provided
            if "connection_string" in self.config:
                self._client = MongoClient(self.config["connection_string"])
            else:
                host = self.config.get("host", "localhost")
                port = self.config.get("port", 27017)
                username = self.config.get("username")
                password = self.config.get("password")

                if username and password:
                    uri = f"mongodb://{username}:{password}@{host}:{port}/"
                else:
                    uri = f"mongodb://{host}:{port}/"

                self._client = MongoClient(uri)

            # Select database
            database = self.config.get("database", "test")
            self._db = self._client[database]

            # Test connection
            self._client.server_info()

            self._connected = True
            logger.info(f"Connected to MongoDB: {self.config.get('host', 'unknown')}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            self._connected = False
            raise

    async def disconnect(self) -> None:
        """Close MongoDB connection."""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None
        self._connected = False
        logger.info("Disconnected from MongoDB")

    async def test_connection(self) -> ConnectionTest:
        """Test MongoDB connection."""
        start = time.perf_counter()
        try:
            if not self._client:
                await self.connect()

            self._client.server_info()

            latency_ms = (time.perf_counter() - start) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency_ms,
                details={"version": "MongoDB"},
            )
        except Exception as e:
            logger.exception("MongoDB connection test failed")
            return ConnectionTest(
                success=False,
                error="Connection test failed",
            )

    async def discover_schema(self) -> SchemaInfo:
        """Discover MongoDB collections and sample schema."""
        if not self._db:
            await self.connect()

        tables = []  # Collections in MongoDB

        # Get collection names
        collection_names = self._db.list_collection_names()

        for coll_name in collection_names:
            collection = self._db[coll_name]

            # Sample documents to infer schema
            sample = collection.find_one()
            columns = []

            if sample:
                for key, value in sample.items():
                    data_type = self._infer_type(value)
                    columns.append(ColumnInfo(
                        name=key,
                        data_type=data_type,
                        nullable=True,
                        primary_key=(key == "_id"),
                    ))

            # Get estimated count
            try:
                row_count = collection.estimated_document_count()
            except Exception as e:
                logger.debug("Failed to get collection count: %s", e)
                row_count = None

            tables.append(TableInfo(
                name=coll_name,
                columns=columns,
                row_count=row_count,
            ))

        return SchemaInfo(
            tables=tables,
            schemas=[self.config.get("database", "test")],
        )

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """
        Execute a MongoDB query.

        Query format: collection_name or JSON query spec
        """
        if not self._db:
            await self.connect()

        start = time.perf_counter()
        try:
            import json

            # Parse query
            # Format: {"collection": "users", "filter": {"age": {"$gt": 25}}}
            # Or just collection name: "users"
            if query.startswith("{"):
                query_spec = json.loads(query)
                collection_name = query_spec.get("collection")
                filter_spec = query_spec.get("filter", {})
                projection = query_spec.get("projection")
                sort = query_spec.get("sort")
            else:
                collection_name = query.strip()
                filter_spec = parameters or {}
                projection = None
                sort = None

            collection = self._db[collection_name]

            # Build query
            cursor = collection.find(filter_spec, projection)

            if sort:
                cursor = cursor.sort(list(sort.items()))

            cursor = cursor.limit(limit)

            # Fetch results
            documents = list(cursor)
            execution_time = (time.perf_counter() - start) * 1000

            if not documents:
                return QueryResult(
                    columns=[],
                    rows=[],
                    row_count=0,
                    execution_time_ms=execution_time,
                )

            # Extract column names from first document
            columns = list(documents[0].keys())

            # Convert to list of lists
            data = []
            for doc in documents:
                row = []
                for col in columns:
                    val = doc.get(col)
                    # Convert ObjectId to string
                    if hasattr(val, "__str__") and type(val).__name__ == "ObjectId":
                        val = str(val)
                    row.append(val)
                data.append(row)

            return QueryResult(
                columns=columns,
                rows=data,
                row_count=len(data),
                execution_time_ms=execution_time,
                truncated=len(data) >= limit,
            )
        except Exception as e:
            execution_time = (time.perf_counter() - start) * 1000
            logger.exception("MongoDB query execution failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=execution_time,
                error="Query execution failed",
            )

    def _infer_type(self, value: Any) -> str:
        """Infer MongoDB field type from value."""
        if value is None:
            return "null"
        elif isinstance(value, bool):
            return "boolean"
        elif isinstance(value, int):
            return "int"
        elif isinstance(value, float):
            return "double"
        elif isinstance(value, str):
            return "string"
        elif isinstance(value, list):
            return "array"
        elif isinstance(value, dict):
            return "object"
        elif hasattr(value, "__class__"):
            type_name = type(value).__name__
            if type_name == "ObjectId":
                return "objectId"
            elif type_name == "datetime":
                return "date"
        return "unknown"

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        """Get configuration schema for MongoDB."""
        return {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "Database host",
                    "default": "localhost",
                },
                "port": {
                    "type": "integer",
                    "description": "Database port",
                    "default": 27017,
                },
                "database": {
                    "type": "string",
                    "description": "Database name",
                    "default": "test",
                },
                "username": {
                    "type": "string",
                    "description": "Username (optional)",
                },
                "password": {
                    "type": "string",
                    "format": "password",
                    "description": "Password (optional)",
                },
                "connection_string": {
                    "type": "string",
                    "description": "Full MongoDB connection string (alternative)",
                },
            },
            "required": ["database"],
        }

# mysql.py
"""
MySQL Connector - Connect to MySQL/MariaDB databases.
"""

import logging
import time
from typing import Any, Optional


logger = logging.getLogger("neura.connectors.mysql")

@register_connector
class MySQLConnector(ConnectorBase):
    """MySQL/MariaDB database connector using pymysql."""

    connector_id = "mysql"
    connector_name = "MySQL / MariaDB"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.SCHEMA_DISCOVERY,
        ConnectorCapability.QUERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._connection = None

    async def connect(self) -> bool:
        """Establish connection to MySQL."""
        try:
            import pymysql

            self._connection = pymysql.connect(
                host=self.config.get("host", "localhost"),
                port=self.config.get("port", 3306),
                user=self.config.get("username"),
                password=self.config.get("password"),
                database=self.config.get("database"),
                charset=self.config.get("charset", "utf8mb4"),
                cursorclass=pymysql.cursors.DictCursor,
                ssl=self.config.get("ssl"),
            )

            self._connected = True
            logger.info(f"Connected to MySQL: {self.config.get('host', 'unknown')}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to MySQL: {e}")
            self._connected = False
            raise

    async def disconnect(self) -> None:
        """Close MySQL connection."""
        if self._connection:
            self._connection.close()
            self._connection = None
        self._connected = False
        logger.info("Disconnected from MySQL")

    async def test_connection(self) -> ConnectionTest:
        """Test MySQL connection."""
        start = time.perf_counter()
        try:
            if not self._connection:
                await self.connect()

            with self._connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()

            latency_ms = (time.perf_counter() - start) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency_ms,
                details={"version": "MySQL/MariaDB"},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(
                success=False,
                error="Connection test failed",
            )

    async def discover_schema(self) -> SchemaInfo:
        """Discover MySQL schema."""
        if not self._connection:
            await self.connect()

        tables = []
        views = []
        database = self.config.get("database")

        with self._connection.cursor() as cursor:
            # Get tables
            cursor.execute("""
                SELECT TABLE_NAME, TABLE_TYPE
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = %s
                ORDER BY TABLE_NAME
            """, (database,))
            table_rows = cursor.fetchall()

            for row in table_rows:
                table_name = row["TABLE_NAME"]

                # Get columns
                cursor.execute("""
                    SELECT
                        COLUMN_NAME,
                        DATA_TYPE,
                        IS_NULLABLE,
                        COLUMN_DEFAULT,
                        COLUMN_KEY
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                    ORDER BY ORDINAL_POSITION
                """, (database, table_name))
                column_rows = cursor.fetchall()

                columns = [
                    ColumnInfo(
                        name=col["COLUMN_NAME"],
                        data_type=col["DATA_TYPE"],
                        nullable=col["IS_NULLABLE"] == "YES",
                        primary_key=col["COLUMN_KEY"] == "PRI",
                        default_value=col["COLUMN_DEFAULT"],
                    )
                    for col in column_rows
                ]

                table_info = TableInfo(
                    name=table_name,
                    schema_name=database,
                    columns=columns,
                )

                if row["TABLE_TYPE"] == "VIEW":
                    views.append(table_info)
                else:
                    tables.append(table_info)

        return SchemaInfo(tables=tables, views=views, schemas=[database])

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._connection:
            await self.connect()

        start = time.perf_counter()
        try:
            # Add LIMIT if not present
            query_lower = query.lower().strip()
            if query_lower.startswith("select") and "limit" not in query_lower:
                query = f"{query} LIMIT {limit}"

            with self._connection.cursor() as cursor:
                if parameters:
                    cursor.execute(query, tuple(parameters.values()))
                else:
                    cursor.execute(query)

                rows = cursor.fetchall()
                execution_time = (time.perf_counter() - start) * 1000

                if not rows:
                    return QueryResult(
                        columns=[],
                        rows=[],
                        row_count=0,
                        execution_time_ms=execution_time,
                    )

                # Extract column names
                columns = list(rows[0].keys())

                # Convert to list of lists
                data = [[row[col] for col in columns] for row in rows]

                return QueryResult(
                    columns=columns,
                    rows=data,
                    row_count=len(data),
                    execution_time_ms=execution_time,
                    truncated=len(data) >= limit,
                )
        except Exception as e:
            logger.exception("query_execution_failed")
            execution_time = (time.perf_counter() - start) * 1000
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=execution_time,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        """Get configuration schema for MySQL."""
        return {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "Database host",
                    "default": "localhost",
                },
                "port": {
                    "type": "integer",
                    "description": "Database port",
                    "default": 3306,
                },
                "database": {
                    "type": "string",
                    "description": "Database name",
                },
                "username": {
                    "type": "string",
                    "description": "Username",
                },
                "password": {
                    "type": "string",
                    "format": "password",
                    "description": "Password",
                },
                "charset": {
                    "type": "string",
                    "description": "Character set",
                    "default": "utf8mb4",
                },
            },
            "required": ["database", "username", "password"],
        }

# postgresql.py
"""
PostgreSQL Connector - Connect to PostgreSQL databases.
"""

import logging
import time
from typing import Any, Optional


logger = logging.getLogger("neura.connectors.postgresql")

@register_connector
class PostgreSQLConnector(ConnectorBase):
    """PostgreSQL database connector using asyncpg."""

    connector_id = "postgresql"
    connector_name = "PostgreSQL"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC, AuthType.CONNECTION_STRING]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.SCHEMA_DISCOVERY,
        ConnectorCapability.QUERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._pool = None

    async def connect(self) -> bool:
        """Establish connection to PostgreSQL."""
        try:
            import asyncpg

            # Check if connection string provided
            if "connection_string" in self.config:
                self._pool = await asyncpg.create_pool(
                    self.config["connection_string"],
                    min_size=1,
                    max_size=5,
                )
            else:
                self._pool = await asyncpg.create_pool(
                    host=self.config.get("host", "localhost"),
                    port=self.config.get("port", 5432),
                    user=self.config.get("username"),
                    password=self.config.get("password"),
                    database=self.config.get("database"),
                    ssl=self.config.get("ssl", False),
                    min_size=1,
                    max_size=5,
                )

            self._connected = True
            logger.info(f"Connected to PostgreSQL: {self.config.get('host', 'unknown')}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            self._connected = False
            raise

    async def disconnect(self) -> None:
        """Close PostgreSQL connection."""
        if self._pool:
            await self._pool.close()
            self._pool = None
        self._connected = False
        logger.info("Disconnected from PostgreSQL")

    async def test_connection(self) -> ConnectionTest:
        """Test PostgreSQL connection."""
        start = time.perf_counter()
        try:
            if not self._pool:
                await self.connect()

            async with self._pool.acquire() as conn:
                result = await conn.fetchval("SELECT 1")

            latency_ms = (time.perf_counter() - start) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency_ms,
                details={"version": "PostgreSQL"},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(
                success=False,
                error="Connection test failed",
            )

    async def discover_schema(self) -> SchemaInfo:
        """Discover PostgreSQL schema."""
        if not self._pool:
            await self.connect()

        tables = []
        views = []
        schemas = []

        async with self._pool.acquire() as conn:
            # Get schemas
            schema_rows = await conn.fetch("""
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY schema_name
            """)
            schemas = [row["schema_name"] for row in schema_rows]

            # Get tables
            table_rows = await conn.fetch("""
                SELECT
                    t.table_schema,
                    t.table_name,
                    t.table_type
                FROM information_schema.tables t
                WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY t.table_schema, t.table_name
            """)

            for row in table_rows:
                # Get columns for this table
                column_rows = await conn.fetch("""
                    SELECT
                        c.column_name,
                        c.data_type,
                        c.is_nullable,
                        c.column_default,
                        CASE WHEN pk.column_name IS NOT NULL THEN TRUE ELSE FALSE END as is_primary_key
                    FROM information_schema.columns c
                    LEFT JOIN (
                        SELECT ku.column_name, ku.table_name, ku.table_schema
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku
                            ON tc.constraint_name = ku.constraint_name
                            AND tc.table_schema = ku.table_schema
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                    ) pk ON c.column_name = pk.column_name
                        AND c.table_name = pk.table_name
                        AND c.table_schema = pk.table_schema
                    WHERE c.table_schema = $1 AND c.table_name = $2
                    ORDER BY c.ordinal_position
                """, row["table_schema"], row["table_name"])

                columns = [
                    ColumnInfo(
                        name=col["column_name"],
                        data_type=col["data_type"],
                        nullable=col["is_nullable"] == "YES",
                        primary_key=col["is_primary_key"],
                        default_value=col["column_default"],
                    )
                    for col in column_rows
                ]

                table_info = TableInfo(
                    name=row["table_name"],
                    schema_name=row["table_schema"],
                    columns=columns,
                )

                if row["table_type"] == "VIEW":
                    views.append(table_info)
                else:
                    tables.append(table_info)

        return SchemaInfo(tables=tables, views=views, schemas=schemas)

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._pool:
            await self.connect()

        start = time.perf_counter()
        try:
            async with self._pool.acquire() as conn:
                # Add LIMIT if not present
                query_lower = query.lower().strip()
                if query_lower.startswith("select") and "limit" not in query_lower:
                    query = f"{query} LIMIT {limit}"

                # Execute query
                if parameters:
                    rows = await conn.fetch(query, *parameters.values())
                else:
                    rows = await conn.fetch(query)

                execution_time = (time.perf_counter() - start) * 1000

                if not rows:
                    return QueryResult(
                        columns=[],
                        rows=[],
                        row_count=0,
                        execution_time_ms=execution_time,
                    )

                # Extract column names
                columns = list(rows[0].keys())

                # Convert to list of lists
                data = [[row[col] for col in columns] for row in rows]

                return QueryResult(
                    columns=columns,
                    rows=data,
                    row_count=len(data),
                    execution_time_ms=execution_time,
                    truncated=len(data) >= limit,
                )
        except Exception as e:
            logger.exception("query_execution_failed")
            execution_time = (time.perf_counter() - start) * 1000
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=execution_time,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        """Get configuration schema for PostgreSQL."""
        return {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "Database host",
                    "default": "localhost",
                },
                "port": {
                    "type": "integer",
                    "description": "Database port",
                    "default": 5432,
                },
                "database": {
                    "type": "string",
                    "description": "Database name",
                },
                "username": {
                    "type": "string",
                    "description": "Username",
                },
                "password": {
                    "type": "string",
                    "format": "password",
                    "description": "Password",
                },
                "ssl": {
                    "type": "boolean",
                    "description": "Use SSL connection",
                    "default": False,
                },
                "connection_string": {
                    "type": "string",
                    "description": "Full connection string (alternative to individual fields)",
                },
            },
            "required": ["database", "username", "password"],
        }

# snowflake.py
"""Snowflake Database Connector.

Connector for Snowflake using snowflake-connector-python.
"""

import logging
import re
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Identifiers must be alphanumeric / underscores
_SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

def _quote_identifier(value: str, label: str = "identifier") -> str:
    """Validate and double-quote a SQL identifier to prevent injection."""
    if not value or not _SAFE_IDENTIFIER_RE.match(value):
        raise ValueError(f"Invalid SQL {label}: {value!r}")
    return f'"{value}"'


@register_connector
class SnowflakeConnector(ConnectorBase):
    """Snowflake database connector."""

    connector_id = "snowflake"
    connector_name = "Snowflake"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC, AuthType.API_KEY]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.QUERY,
        ConnectorCapability.SCHEMA_DISCOVERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._connection = None

    async def connect(self) -> bool:
        """Establish connection to Snowflake."""
        try:
            import snowflake.connector

            self._connection = snowflake.connector.connect(
                user=self.config.get("username"),
                password=self.config.get("password"),
                account=self.config.get("account"),
                warehouse=self.config.get("warehouse"),
                database=self.config.get("database"),
                schema=self.config.get("schema", "PUBLIC"),
                role=self.config.get("role"),
            )
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to Snowflake") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._connection:
            self._connection.close()
            self._connection = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            cursor = self._connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(success=True, latency_ms=latency)
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def discover_schema(self) -> SchemaInfo:
        """Discover database schema."""
        if not self._connected:
            await self.connect()

        tables: list[TableInfo] = []
        views: list[TableInfo] = []
        schemas: list[str] = []

        cursor = self._connection.cursor()

        # Get schemas
        cursor.execute("SHOW SCHEMAS")
        schemas = [row[1] for row in cursor.fetchall()]

        # Get tables
        cursor.execute("SHOW TABLES")
        for row in cursor.fetchall():
            table_name = row[1]
            schema_name = row[3]
            columns = await self._get_columns(schema_name, table_name)
            tables.append(TableInfo(
                name=table_name,
                schema_name=schema_name,
                columns=columns,
            ))

        # Get views
        cursor.execute("SHOW VIEWS")
        for row in cursor.fetchall():
            view_name = row[1]
            schema_name = row[3]
            views.append(TableInfo(
                name=view_name,
                schema_name=schema_name,
            ))

        cursor.close()
        return SchemaInfo(tables=tables, views=views, schemas=schemas)

    async def _get_columns(self, schema_name: str, table_name: str) -> list[ColumnInfo]:
        """Get columns for a table."""
        safe_schema = _quote_identifier(schema_name, "schema name")
        safe_table = _quote_identifier(table_name, "table name")
        cursor = self._connection.cursor()
        cursor.execute(f"DESCRIBE TABLE {safe_schema}.{safe_table}")

        columns = []
        for row in cursor.fetchall():
            columns.append(ColumnInfo(
                name=row[0],
                data_type=row[1],
                nullable=row[3] == "Y",
                primary_key=row[5] == "Y",
                default_value=row[4],
            ))

        cursor.close()
        return columns

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._connected:
            await self.connect()

        start_time = time.time()
        cursor = self._connection.cursor()

        try:
            # Add LIMIT if not present
            query_upper = query.upper().strip()
            if query_upper.startswith("SELECT") and "LIMIT" not in query_upper:
                query = f"{query} LIMIT {limit}"

            if parameters:
                cursor.execute(query, parameters)
            else:
                cursor.execute(query)

            if cursor.description:
                columns = [desc[0] for desc in cursor.description]
                rows = [list(row) for row in cursor.fetchall()]
            else:
                columns = []
                rows = []

            execution_time = (time.time() - start_time) * 1000
            cursor.close()

            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time,
                truncated=len(rows) >= limit,
            )
        except Exception as e:
            cursor.close()
            logger.exception("query_execution_failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=(time.time() - start_time) * 1000,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "account": {"type": "string", "description": "Snowflake account identifier"},
                "username": {"type": "string"},
                "password": {"type": "string", "format": "password"},
                "warehouse": {"type": "string"},
                "database": {"type": "string"},
                "schema": {"type": "string", "default": "PUBLIC"},
                "role": {"type": "string"},
            },
            "required": ["account", "username", "password", "warehouse", "database"],
        }

# sqlserver.py
"""SQL Server Database Connector.

Connector for Microsoft SQL Server using pymssql.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


@register_connector
class SQLServerConnector(ConnectorBase):
    """Microsoft SQL Server database connector."""

    connector_id = "sqlserver"
    connector_name = "Microsoft SQL Server"
    connector_type = ConnectorType.DATABASE
    auth_types = [AuthType.BASIC, AuthType.CONNECTION_STRING]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.QUERY,
        ConnectorCapability.SCHEMA_DISCOVERY,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._connection = None

    async def connect(self) -> bool:
        """Establish connection to SQL Server."""
        try:
            import pymssql

            self._connection = pymssql.connect(
                server=self.config.get("host", "localhost"),
                port=self.config.get("port", 1433),
                user=self.config.get("username"),
                password=self.config.get("password"),
                database=self.config.get("database"),
                as_dict=False,
            )
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to SQL Server") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._connection:
            self._connection.close()
            self._connection = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            cursor = self._connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(success=True, latency_ms=latency)
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def discover_schema(self) -> SchemaInfo:
        """Discover database schema."""
        if not self._connected:
            await self.connect()

        tables: list[TableInfo] = []
        views: list[TableInfo] = []
        schemas: list[str] = []

        cursor = self._connection.cursor()

        # Get schemas
        cursor.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('sys', 'guest', 'INFORMATION_SCHEMA')
        """)
        schemas = [row[0] for row in cursor.fetchall()]

        # Get tables
        cursor.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
        """)
        for schema_name, table_name in cursor.fetchall():
            columns = await self._get_columns(schema_name, table_name)
            tables.append(TableInfo(
                name=table_name,
                schema_name=schema_name,
                columns=columns,
            ))

        # Get views
        cursor.execute("""
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'VIEW'
        """)
        for schema_name, view_name in cursor.fetchall():
            views.append(TableInfo(
                name=view_name,
                schema_name=schema_name,
            ))

        cursor.close()
        return SchemaInfo(tables=tables, views=views, schemas=schemas)

    async def _get_columns(self, schema_name: str, table_name: str) -> list[ColumnInfo]:
        """Get columns for a table."""
        cursor = self._connection.cursor()
        cursor.execute("""
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (schema_name, table_name))

        columns = []
        for name, dtype, nullable, default in cursor.fetchall():
            columns.append(ColumnInfo(
                name=name,
                data_type=dtype,
                nullable=nullable == "YES",
                default_value=default,
            ))

        cursor.close()
        return columns

    async def execute_query(
        self,
        query: str,
        parameters: Optional[dict] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute a SQL query."""
        if not self._connected:
            await self.connect()

        start_time = time.time()
        cursor = self._connection.cursor()

        try:
            # Add TOP clause if not present
            query_upper = query.upper().strip()
            if query_upper.startswith("SELECT") and "TOP" not in query_upper:
                query = query.replace("SELECT", f"SELECT TOP {limit}", 1)

            if parameters:
                cursor.execute(query, tuple(parameters.values()))
            else:
                cursor.execute(query)

            if cursor.description:
                columns = [desc[0] for desc in cursor.description]
                rows = [list(row) for row in cursor.fetchall()]
            else:
                columns = []
                rows = []

            execution_time = (time.time() - start_time) * 1000
            cursor.close()

            return QueryResult(
                columns=columns,
                rows=rows,
                row_count=len(rows),
                execution_time_ms=execution_time,
                truncated=len(rows) >= limit,
            )
        except Exception as e:
            cursor.close()
            logger.exception("query_execution_failed")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                execution_time_ms=(time.time() - start_time) * 1000,
                error="Query execution failed",
            )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "host": {"type": "string", "description": "Server hostname"},
                "port": {"type": "integer", "default": 1433},
                "username": {"type": "string"},
                "password": {"type": "string", "format": "password"},
                "database": {"type": "string"},
            },
            "required": ["host", "username", "password", "database"],
        }

"""All storage connector implementations merged into a single file."""

# aws_s3.py
"""AWS S3 Cloud Storage Connector.

Connector for Amazon S3 using boto3.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class AWSS3Connector(ConnectorBase):
    """AWS S3 cloud storage connector."""

    connector_id = "aws_s3"
    connector_name = "Amazon S3"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.API_KEY, AuthType.SERVICE_ACCOUNT]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._client = None
        self._bucket = None

    async def connect(self) -> bool:
        """Establish connection to AWS S3."""
        try:
            import boto3

            self._client = boto3.client(
                "s3",
                aws_access_key_id=self.config.get("access_key_id"),
                aws_secret_access_key=self.config.get("secret_access_key"),
                region_name=self.config.get("region", "us-east-1"),
            )
            self._bucket = self.config.get("bucket")
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to AWS S3") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        self._client = None
        self._bucket = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            # Try to list bucket contents (head bucket)
            self._client.head_bucket(Bucket=self._bucket)

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={"bucket": self._bucket},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = "",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in S3 bucket."""
        if not self._connected:
            await self.connect()

        files: list[FileInfo] = []
        prefix = path.lstrip("/")

        paginator = self._client.get_paginator("list_objects_v2")
        params = {"Bucket": self._bucket, "Prefix": prefix}

        if not recursive:
            params["Delimiter"] = "/"

        for page in paginator.paginate(**params):
            # Add folders (common prefixes)
            for prefix_info in page.get("CommonPrefixes", []):
                folder_path = prefix_info["Prefix"]
                files.append(FileInfo(
                    id=folder_path,
                    name=folder_path.rstrip("/").split("/")[-1],
                    path=folder_path,
                    size_bytes=0,
                    is_folder=True,
                ))

            # Add files
            for obj in page.get("Contents", []):
                key = obj["Key"]
                files.append(FileInfo(
                    id=key,
                    name=key.split("/")[-1],
                    path=key,
                    size_bytes=obj["Size"],
                    modified_at=obj["LastModified"].isoformat() if obj.get("LastModified") else None,
                    is_folder=False,
                ))

        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from S3."""
        if not self._connected:
            await self.connect()

        response = self._client.get_object(Bucket=self._bucket, Key=file_id)
        content = response["Body"].read()

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to S3."""
        if not self._connected:
            await self.connect()

        key = f"{path.strip('/')}/{filename}" if path else filename
        extra_args = {}
        if mime_type:
            extra_args["ContentType"] = mime_type

        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=content,
            **extra_args,
        )

        return FileInfo(
            id=key,
            name=filename,
            path=key,
            size_bytes=len(content),
            mime_type=mime_type,
            is_folder=False,
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from S3."""
        if not self._connected:
            await self.connect()

        try:
            self._client.delete_object(Bucket=self._bucket, Key=file_id)
            return True
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    async def get_presigned_url(
        self,
        file_id: str,
        expires_in: int = 3600,
    ) -> str:
        """Generate a presigned URL for downloading."""
        if not self._connected:
            await self.connect()

        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": file_id},
            ExpiresIn=expires_in,
        )

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "access_key_id": {"type": "string", "description": "AWS Access Key ID"},
                "secret_access_key": {"type": "string", "format": "password", "description": "AWS Secret Access Key"},
                "region": {"type": "string", "default": "us-east-1", "description": "AWS Region"},
                "bucket": {"type": "string", "description": "S3 Bucket name"},
            },
            "required": ["access_key_id", "secret_access_key", "bucket"],
        }

# azure_blob.py
"""Azure Blob Storage Connector.

Connector for Azure Blob Storage using azure-storage-blob.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class AzureBlobConnector(ConnectorBase):
    """Azure Blob Storage connector."""

    connector_id = "azure_blob"
    connector_name = "Azure Blob Storage"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.CONNECTION_STRING, AuthType.API_KEY]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._blob_service_client = None
        self._container_client = None

    async def connect(self) -> bool:
        """Establish connection to Azure Blob Storage."""
        try:
            from azure.storage.blob import BlobServiceClient

            connection_string = self.config.get("connection_string")
            account_name = self.config.get("account_name")
            account_key = self.config.get("account_key")
            container_name = self.config.get("container")

            if connection_string:
                self._blob_service_client = BlobServiceClient.from_connection_string(
                    connection_string
                )
            elif account_name and account_key:
                account_url = f"https://{account_name}.blob.core.windows.net"
                self._blob_service_client = BlobServiceClient(
                    account_url=account_url,
                    credential=account_key,
                )
            else:
                raise ValueError("Connection string or account credentials required")

            if container_name:
                self._container_client = self._blob_service_client.get_container_client(
                    container_name
                )

            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to Azure Blob Storage") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        self._blob_service_client = None
        self._container_client = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            # Try to get container properties
            if self._container_client:
                props = self._container_client.get_container_properties()
                container_info = {"container": props.name}
            else:
                # List containers
                containers = list(self._blob_service_client.list_containers(max_results=1))
                container_info = {"containers": len(containers)}

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details=container_info,
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = "",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in Azure Blob container."""
        if not self._connected:
            await self.connect()

        files: list[FileInfo] = []
        prefix = path.strip("/") + "/" if path and not path.endswith("/") else path.lstrip("/")

        if recursive:
            blobs = self._container_client.list_blobs(name_starts_with=prefix or None)
        else:
            blobs = self._container_client.walk_blobs(name_starts_with=prefix or None)

        for blob in blobs:
            # Check if it's a prefix (folder)
            if hasattr(blob, "prefix"):
                files.append(FileInfo(
                    id=blob.prefix,
                    name=blob.prefix.rstrip("/").split("/")[-1],
                    path=blob.prefix,
                    size_bytes=0,
                    is_folder=True,
                ))
            else:
                files.append(FileInfo(
                    id=blob.name,
                    name=blob.name.split("/")[-1],
                    path=blob.name,
                    size_bytes=blob.size or 0,
                    mime_type=blob.content_settings.content_type if blob.content_settings else None,
                    created_at=str(blob.creation_time) if blob.creation_time else None,
                    modified_at=str(blob.last_modified) if blob.last_modified else None,
                    is_folder=False,
                ))

        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from Azure Blob Storage."""
        if not self._connected:
            await self.connect()

        blob_client = self._container_client.get_blob_client(file_id)
        content = blob_client.download_blob().readall()

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to Azure Blob Storage."""
        if not self._connected:
            await self.connect()

        from azure.storage.blob import ContentSettings

        blob_name = f"{path.strip('/')}/{filename}" if path else filename

        blob_client = self._container_client.get_blob_client(blob_name)

        content_settings = None
        if mime_type:
            content_settings = ContentSettings(content_type=mime_type)

        blob_client.upload_blob(
            content,
            overwrite=True,
            content_settings=content_settings,
        )

        return FileInfo(
            id=blob_name,
            name=filename,
            path=blob_name,
            size_bytes=len(content),
            mime_type=mime_type,
            is_folder=False,
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from Azure Blob Storage."""
        if not self._connected:
            await self.connect()

        try:
            blob_client = self._container_client.get_blob_client(file_id)
            blob_client.delete_blob()
            return True
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    async def get_sas_url(
        self,
        file_id: str,
        expires_in: int = 3600,
    ) -> str:
        """Generate a SAS URL for downloading."""
        if not self._connected:
            await self.connect()

        from datetime import datetime, timedelta, timezone
        from azure.storage.blob import generate_blob_sas, BlobSasPermissions

        blob_client = self._container_client.get_blob_client(file_id)

        sas_token = generate_blob_sas(
            account_name=self._blob_service_client.account_name,
            container_name=self._container_client.container_name,
            blob_name=file_id,
            account_key=self.config.get("account_key"),
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc) + timedelta(seconds=expires_in),
        )

        return f"{blob_client.url}?{sas_token}"

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "connection_string": {"type": "string", "description": "Azure connection string"},
                "account_name": {"type": "string", "description": "Storage account name"},
                "account_key": {"type": "string", "format": "password", "description": "Storage account key"},
                "container": {"type": "string", "description": "Container name"},
            },
            "required": ["container"],
        }

# dropbox.py
"""Dropbox Cloud Storage Connector.

Connector for Dropbox using dropbox SDK.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class DropboxConnector(ConnectorBase):
    """Dropbox cloud storage connector."""

    connector_id = "dropbox"
    connector_name = "Dropbox"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.OAUTH2, AuthType.API_KEY]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._client = None

    async def connect(self) -> bool:
        """Establish connection to Dropbox."""
        try:
            import dropbox

            access_token = self.config.get("access_token")
            refresh_token = self.config.get("refresh_token")
            app_key = self.config.get("app_key")
            app_secret = self.config.get("app_secret")

            if refresh_token and app_key and app_secret:
                self._client = dropbox.Dropbox(
                    oauth2_refresh_token=refresh_token,
                    app_key=app_key,
                    app_secret=app_secret,
                )
            elif access_token:
                self._client = dropbox.Dropbox(access_token)
            else:
                raise ValueError("Access token or refresh token required")

            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to Dropbox") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        self._client = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            account = self._client.users_get_current_account()
            latency = (time.time() - start_time) * 1000

            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={"email": account.email},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = "",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in Dropbox."""
        if not self._connected:
            await self.connect()

        import dropbox

        files: list[FileInfo] = []
        folder_path = path if path else ""

        result = self._client.files_list_folder(folder_path, recursive=recursive)

        while True:
            for entry in result.entries:
                is_folder = isinstance(entry, dropbox.files.FolderMetadata)
                files.append(FileInfo(
                    id=entry.id if hasattr(entry, "id") else entry.path_display,
                    name=entry.name,
                    path=entry.path_display,
                    size_bytes=getattr(entry, "size", 0),
                    modified_at=getattr(entry, "server_modified", None),
                    is_folder=is_folder,
                ))

            if not result.has_more:
                break
            result = self._client.files_list_folder_continue(result.cursor)

        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from Dropbox."""
        if not self._connected:
            await self.connect()

        # file_id can be either an ID or a path
        metadata, response = self._client.files_download(file_id)
        content = response.content

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to Dropbox."""
        if not self._connected:
            await self.connect()

        import dropbox

        upload_path = f"{path}/{filename}" if path else f"/{filename}"

        metadata = self._client.files_upload(
            content,
            upload_path,
            mode=dropbox.files.WriteMode.overwrite,
        )

        return FileInfo(
            id=metadata.id,
            name=metadata.name,
            path=metadata.path_display,
            size_bytes=metadata.size,
            modified_at=str(metadata.server_modified) if metadata.server_modified else None,
            is_folder=False,
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from Dropbox."""
        if not self._connected:
            await self.connect()

        try:
            self._client.files_delete_v2(file_id)
            return True
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    async def get_shared_link(self, file_id: str) -> str:
        """Get a shared link for a file."""
        if not self._connected:
            await self.connect()

        try:
            shared_link = self._client.sharing_create_shared_link_with_settings(file_id)
            return shared_link.url
        except Exception:
            # Link might already exist
            links = self._client.sharing_list_shared_links(path=file_id)
            if links.links:
                return links.links[0].url
            raise

    def get_oauth_url(self, redirect_uri: str, state: str) -> Optional[str]:
        """Get OAuth authorization URL."""
        import dropbox

        flow = dropbox.DropboxOAuth2Flow(
            consumer_key=self.config.get("app_key"),
            consumer_secret=self.config.get("app_secret"),
            redirect_uri=redirect_uri,
            session={},
            csrf_token_session_key="dropbox-csrf-token",
            token_access_type="offline",
        )

        return flow.start(state=state)

    def handle_oauth_callback(
        self,
        code: str,
        redirect_uri: str,
    ) -> dict[str, Any]:
        """Handle OAuth callback."""
        import dropbox

        flow = dropbox.DropboxOAuth2Flow(
            consumer_key=self.config.get("app_key"),
            consumer_secret=self.config.get("app_secret"),
            redirect_uri=redirect_uri,
            session={},
            csrf_token_session_key="dropbox-csrf-token",
            token_access_type="offline",
        )

        # In a real implementation, you would use flow.finish() with the query params
        # For now, we'll do a manual token exchange
        import requests
        response = requests.post(
            "https://api.dropboxapi.com/oauth2/token",
            data={
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
                "client_id": self.config.get("app_key"),
                "client_secret": self.config.get("app_secret"),
            },
        )
        result = response.json()

        return {
            "access_token": result.get("access_token"),
            "refresh_token": result.get("refresh_token"),
            "expires_in": result.get("expires_in"),
            "token_type": result.get("token_type"),
        }

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "app_key": {"type": "string", "description": "Dropbox App Key"},
                "app_secret": {"type": "string", "format": "password", "description": "Dropbox App Secret"},
                "access_token": {"type": "string", "description": "OAuth access token"},
                "refresh_token": {"type": "string", "description": "OAuth refresh token"},
            },
            "required": ["app_key", "app_secret"],
        }

# google_drive.py
"""Google Drive Cloud Storage Connector.

Connector for Google Drive using google-api-python-client.
"""

import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class GoogleDriveConnector(ConnectorBase):
    """Google Drive cloud storage connector."""

    connector_id = "google_drive"
    connector_name = "Google Drive"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.OAUTH2, AuthType.SERVICE_ACCOUNT]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    # OAuth scopes
    SCOPES = [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
    ]

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._service = None
        self._credentials = None

    async def connect(self) -> bool:
        """Establish connection to Google Drive."""
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            credentials_json = self.config.get("credentials_json")
            credentials_path = self.config.get("credentials_path")

            if credentials_json:
                import json
                if isinstance(credentials_json, str):
                    credentials_json = json.loads(credentials_json)
                self._credentials = service_account.Credentials.from_service_account_info(
                    credentials_json,
                    scopes=self.SCOPES,
                )
            elif credentials_path:
                self._credentials = service_account.Credentials.from_service_account_file(
                    credentials_path,
                    scopes=self.SCOPES,
                )
            else:
                # Use OAuth tokens if available
                from google.oauth2.credentials import Credentials
                self._credentials = Credentials(
                    token=self.config.get("access_token"),
                    refresh_token=self.config.get("refresh_token"),
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=self.config.get("client_id"),
                    client_secret=self.config.get("client_secret"),
                )

            self._service = build("drive", "v3", credentials=self._credentials)
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to Google Drive") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        self._service = None
        self._credentials = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            # Get about info
            about = self._service.about().get(fields="user").execute()
            latency = (time.time() - start_time) * 1000

            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={"user": about.get("user", {}).get("emailAddress")},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = "root",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in Google Drive."""
        if not self._connected:
            await self.connect()

        files: list[FileInfo] = []
        parent_id = path if path != "/" else "root"

        query = f"'{parent_id}' in parents and trashed = false"
        fields = "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webContentLink)"

        page_token = None
        while True:
            response = self._service.files().list(
                q=query,
                pageSize=100,
                fields=fields,
                pageToken=page_token,
            ).execute()

            for item in response.get("files", []):
                is_folder = item["mimeType"] == "application/vnd.google-apps.folder"
                files.append(FileInfo(
                    id=item["id"],
                    name=item["name"],
                    path=f"/{item['name']}",
                    size_bytes=int(item.get("size", 0)),
                    mime_type=item["mimeType"],
                    created_at=item.get("createdTime"),
                    modified_at=item.get("modifiedTime"),
                    is_folder=is_folder,
                    download_url=item.get("webContentLink"),
                ))

            page_token = response.get("nextPageToken")
            if not page_token:
                break

        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from Google Drive."""
        if not self._connected:
            await self.connect()

        from googleapiclient.http import MediaIoBaseDownload
        import io

        request = self._service.files().get_media(fileId=file_id)
        file_buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(file_buffer, request)

        done = False
        while not done:
            _, done = downloader.next_chunk()

        content = file_buffer.getvalue()

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to Google Drive."""
        if not self._connected:
            await self.connect()

        from googleapiclient.http import MediaInMemoryUpload

        file_metadata = {"name": filename}
        if path and path != "/":
            file_metadata["parents"] = [path]

        media = MediaInMemoryUpload(
            content,
            mimetype=mime_type or "application/octet-stream",
        )

        file = self._service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id, name, mimeType, size, createdTime, webContentLink",
        ).execute()

        return FileInfo(
            id=file["id"],
            name=file["name"],
            path=f"/{file['name']}",
            size_bytes=len(content),
            mime_type=file.get("mimeType"),
            created_at=file.get("createdTime"),
            is_folder=False,
            download_url=file.get("webContentLink"),
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from Google Drive."""
        if not self._connected:
            await self.connect()

        try:
            self._service.files().delete(fileId=file_id).execute()
            return True
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    def get_oauth_url(self, redirect_uri: str, state: str) -> Optional[str]:
        """Get OAuth authorization URL."""
        from google_auth_oauthlib.flow import Flow

        client_config = {
            "web": {
                "client_id": self.config.get("client_id"),
                "client_secret": self.config.get("client_secret"),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

        flow = Flow.from_client_config(client_config, scopes=self.SCOPES)
        flow.redirect_uri = redirect_uri

        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            state=state,
        )

        return auth_url

    def handle_oauth_callback(
        self,
        code: str,
        redirect_uri: str,
    ) -> dict[str, Any]:
        """Handle OAuth callback."""
        from google_auth_oauthlib.flow import Flow

        client_config = {
            "web": {
                "client_id": self.config.get("client_id"),
                "client_secret": self.config.get("client_secret"),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

        flow = Flow.from_client_config(client_config, scopes=self.SCOPES)
        flow.redirect_uri = redirect_uri

        flow.fetch_token(code=code)
        credentials = flow.credentials

        return {
            "access_token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "token_uri": credentials.token_uri,
            "client_id": credentials.client_id,
            "client_secret": credentials.client_secret,
            "expiry": credentials.expiry.isoformat() if credentials.expiry else None,
        }

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "client_id": {"type": "string", "description": "OAuth Client ID"},
                "client_secret": {"type": "string", "format": "password", "description": "OAuth Client Secret"},
                "credentials_path": {"type": "string", "description": "Path to service account JSON"},
                "credentials_json": {"type": "object", "description": "Service account credentials JSON"},
                "access_token": {"type": "string", "description": "OAuth access token"},
                "refresh_token": {"type": "string", "description": "OAuth refresh token"},
            },
            "required": [],
        }

# onedrive.py
"""OneDrive Cloud Storage Connector.

Connector for Microsoft OneDrive using MSAL and Graph API.
"""

import logging
import posixpath
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class OneDriveConnector(ConnectorBase):
    """Microsoft OneDrive cloud storage connector."""

    connector_id = "onedrive"
    connector_name = "Microsoft OneDrive"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.OAUTH2]
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    GRAPH_API_URL = "https://graph.microsoft.com/v1.0"
    SCOPES = ["Files.ReadWrite.All", "User.Read", "offline_access"]

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._access_token = None
        self._session = None

    @staticmethod
    def _safe_path(path: str) -> str:
        """Normalise *path* and reject directory-traversal attempts.

        Strips leading/trailing slashes, collapses ``..`` via
        ``posixpath.normpath`` and raises ``ValueError`` if the result
        still escapes the root (i.e. starts with ``..``).
        """
        cleaned = path.strip("/")
        if not cleaned:
            return ""
        normalised = posixpath.normpath(cleaned)
        # normpath("../../x") → "../../x"  — still escapes root
        if normalised.startswith(".."):
            raise ValueError(
                f"Path traversal not allowed: {path!r}"
            )
        return normalised

    async def connect(self) -> bool:
        """Establish connection to OneDrive."""
        try:
            import httpx

            self._access_token = self.config.get("access_token")
            if not self._access_token:
                # Try to get token using client credentials
                await self._get_token_with_msal()

            self._session = httpx.AsyncClient(
                headers={"Authorization": f"Bearer {self._access_token}"}
            )
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to OneDrive") from e

    async def _get_token_with_msal(self) -> None:
        """Get access token using MSAL."""
        import msal

        app = msal.ConfidentialClientApplication(
            self.config.get("client_id"),
            authority=f"https://login.microsoftonline.com/{self.config.get('tenant_id', 'common')}",
            client_credential=self.config.get("client_secret"),
        )

        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])

        if "access_token" in result:
            self._access_token = result["access_token"]
        else:
            raise ConnectionError(f"Failed to acquire token: {result.get('error_description')}")

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._session:
            await self._session.aclose()
            self._session = None
        self._access_token = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            response = await self._session.get(f"{self.GRAPH_API_URL}/me")
            response.raise_for_status()
            user = response.json()

            latency = (time.time() - start_time) * 1000
            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={"user": user.get("userPrincipalName")},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = "/",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in OneDrive."""
        if not self._connected:
            await self.connect()

        files: list[FileInfo] = []

        if path == "/" or path == "root":
            url = f"{self.GRAPH_API_URL}/me/drive/root/children"
        else:
            safe = self._safe_path(path)
            url = f"{self.GRAPH_API_URL}/me/drive/root:/{safe}:/children"

        while url:
            response = await self._session.get(url)
            response.raise_for_status()
            data = response.json()

            for item in data.get("value", []):
                is_folder = "folder" in item
                files.append(FileInfo(
                    id=item["id"],
                    name=item["name"],
                    path=item.get("parentReference", {}).get("path", "") + "/" + item["name"],
                    size_bytes=item.get("size", 0),
                    mime_type=item.get("file", {}).get("mimeType"),
                    created_at=item.get("createdDateTime"),
                    modified_at=item.get("lastModifiedDateTime"),
                    is_folder=is_folder,
                    download_url=item.get("@microsoft.graph.downloadUrl"),
                ))

            url = data.get("@odata.nextLink")

        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from OneDrive."""
        if not self._connected:
            await self.connect()

        response = await self._session.get(
            f"{self.GRAPH_API_URL}/me/drive/items/{file_id}/content"
        )
        response.raise_for_status()
        content = response.content

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to OneDrive."""
        if not self._connected:
            await self.connect()

        safe_dir = self._safe_path(path) if path and path != "/" else ""
        upload_path = f"{safe_dir}/{filename}" if safe_dir else filename

        response = await self._session.put(
            f"{self.GRAPH_API_URL}/me/drive/root:/{upload_path}:/content",
            content=content,
            headers={"Content-Type": mime_type or "application/octet-stream"},
        )
        response.raise_for_status()
        item = response.json()

        return FileInfo(
            id=item["id"],
            name=item["name"],
            path=item.get("parentReference", {}).get("path", "") + "/" + item["name"],
            size_bytes=item.get("size", len(content)),
            mime_type=item.get("file", {}).get("mimeType"),
            created_at=item.get("createdDateTime"),
            is_folder=False,
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from OneDrive."""
        if not self._connected:
            await self.connect()

        try:
            response = await self._session.delete(
                f"{self.GRAPH_API_URL}/me/drive/items/{file_id}"
            )
            return response.status_code == 204
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    def get_oauth_url(self, redirect_uri: str, state: str) -> Optional[str]:
        """Get OAuth authorization URL."""
        import urllib.parse

        params = {
            "client_id": self.config.get("client_id"),
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_mode": "query",
            "state": state,
        }

        base_url = f"https://login.microsoftonline.com/{self.config.get('tenant_id', 'common')}/oauth2/v2.0/authorize"
        return f"{base_url}?{urllib.parse.urlencode(params)}"

    def handle_oauth_callback(
        self,
        code: str,
        redirect_uri: str,
    ) -> dict[str, Any]:
        """Handle OAuth callback."""
        import msal

        app = msal.ConfidentialClientApplication(
            self.config.get("client_id"),
            authority=f"https://login.microsoftonline.com/{self.config.get('tenant_id', 'common')}",
            client_credential=self.config.get("client_secret"),
        )

        result = app.acquire_token_by_authorization_code(
            code,
            scopes=self.SCOPES,
            redirect_uri=redirect_uri,
        )

        return {
            "access_token": result.get("access_token"),
            "refresh_token": result.get("refresh_token"),
            "expires_in": result.get("expires_in"),
            "token_type": result.get("token_type"),
        }

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "client_id": {"type": "string", "description": "Azure App Client ID"},
                "client_secret": {"type": "string", "format": "password", "description": "Azure App Client Secret"},
                "tenant_id": {"type": "string", "default": "common", "description": "Azure Tenant ID"},
                "access_token": {"type": "string", "description": "OAuth access token"},
                "refresh_token": {"type": "string", "description": "OAuth refresh token"},
            },
            "required": ["client_id", "client_secret"],
        }

# sftp.py
"""SFTP Cloud Storage Connector.

Connector for SFTP/FTP servers using paramiko.
"""

import logging
import posixpath
import stat
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

from backend.app.utils import validate_hostname

class SFTPConnector(ConnectorBase):
    """SFTP/FTP cloud storage connector."""

    connector_id = "sftp"
    connector_name = "SFTP/FTP"
    connector_type = ConnectorType.CLOUD_STORAGE
    auth_types = [AuthType.BASIC, AuthType.API_KEY]  # API_KEY for key-based auth
    capabilities = [
        ConnectorCapability.READ,
        ConnectorCapability.WRITE,
        ConnectorCapability.STREAM,
    ]
    free_tier = True

    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self._transport = None
        self._sftp = None

    async def connect(self) -> bool:
        """Establish connection to SFTP server."""
        try:
            import paramiko

            host = self.config.get("host")
            port = self.config.get("port", 22)
            validate_hostname(host, port)
            username = self.config.get("username")
            password = self.config.get("password")
            private_key_path = self.config.get("private_key_path")
            private_key_string = self.config.get("private_key")

            self._transport = paramiko.Transport((host, port))

            if private_key_string:
                import io
                key_file = io.StringIO(private_key_string)
                pkey = paramiko.RSAKey.from_private_key(key_file)
                self._transport.connect(username=username, pkey=pkey)
            elif private_key_path:
                pkey = paramiko.RSAKey.from_private_key_file(private_key_path)
                self._transport.connect(username=username, pkey=pkey)
            else:
                self._transport.connect(username=username, password=password)

            self._sftp = paramiko.SFTPClient.from_transport(self._transport)
            self._connected = True
            return True
        except Exception as e:
            self._connected = False
            raise ConnectionError("Failed to connect to SFTP server") from e

    async def disconnect(self) -> None:
        """Close the connection."""
        if self._sftp:
            self._sftp.close()
            self._sftp = None
        if self._transport:
            self._transport.close()
            self._transport = None
        self._connected = False

    async def test_connection(self) -> ConnectionTest:
        """Test the connection."""
        start_time = time.time()
        try:
            if not self._connected:
                await self.connect()

            # Try to list current directory
            self._sftp.listdir(".")
            latency = (time.time() - start_time) * 1000

            return ConnectionTest(
                success=True,
                latency_ms=latency,
                details={"cwd": self._sftp.getcwd() or "/"},
            )
        except Exception as e:
            logger.warning("connection_test_failed", exc_info=True)
            return ConnectionTest(success=False, error="Connection test failed")

    async def list_files(
        self,
        path: str = ".",
        recursive: bool = False,
    ) -> list[FileInfo]:
        """List files in SFTP directory."""
        if not self._connected:
            await self.connect()

        files: list[FileInfo] = []
        path = path or "."

        def _list_dir(dir_path: str) -> None:
            try:
                entries = self._sftp.listdir_attr(dir_path)
                for entry in entries:
                    full_path = f"{dir_path}/{entry.filename}".replace("//", "/")
                    is_folder = stat.S_ISDIR(entry.st_mode)

                    files.append(FileInfo(
                        id=full_path,
                        name=entry.filename,
                        path=full_path,
                        size_bytes=entry.st_size or 0,
                        modified_at=str(entry.st_mtime) if entry.st_mtime else None,
                        is_folder=is_folder,
                    ))

                    if recursive and is_folder:
                        _list_dir(full_path)
            except PermissionError:
                pass  # Skip directories we can't access

        _list_dir(path)
        return files

    async def download_file(
        self,
        file_id: str,
        destination: Optional[str] = None,
    ) -> bytes:
        """Download a file from SFTP."""
        normalized = posixpath.normpath(file_id)
        if '..' in normalized.split('/'):
            raise ValueError("Path traversal not allowed")

        if not self._connected:
            await self.connect()

        import io
        buffer = io.BytesIO()
        self._sftp.getfo(file_id, buffer)
        content = buffer.getvalue()

        if destination:
            with open(destination, "wb") as f:
                f.write(content)

        return content

    async def upload_file(
        self,
        content: bytes,
        path: str,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file to SFTP."""
        normalized = posixpath.normpath(f"{path}/{filename}" if path else filename)
        if '..' in normalized.split('/'):
            raise ValueError("Path traversal not allowed")

        if not self._connected:
            await self.connect()

        import io

        remote_path = f"{path}/{filename}" if path else filename
        remote_path = remote_path.replace("//", "/")

        buffer = io.BytesIO(content)
        self._sftp.putfo(buffer, remote_path)

        # Get file info
        try:
            file_stat = self._sftp.stat(remote_path)
            size = file_stat.st_size
        except Exception:
            size = len(content)

        return FileInfo(
            id=remote_path,
            name=filename,
            path=remote_path,
            size_bytes=size,
            is_folder=False,
        )

    async def delete_file(self, file_id: str) -> bool:
        """Delete a file from SFTP."""
        normalized = posixpath.normpath(file_id)
        if '..' in normalized.split('/'):
            raise ValueError("Path traversal not allowed")

        if not self._connected:
            await self.connect()

        try:
            self._sftp.remove(file_id)
            return True
        except Exception:
            logger.warning("delete_file_failed", exc_info=True)
            return False

    async def mkdir(self, path: str) -> bool:
        """Create a directory."""
        if not self._connected:
            await self.connect()

        try:
            self._sftp.mkdir(path)
            return True
        except Exception:
            return False

    async def rmdir(self, path: str) -> bool:
        """Remove a directory."""
        if not self._connected:
            await self.connect()

        try:
            self._sftp.rmdir(path)
            return True
        except Exception:
            return False

    @classmethod
    def get_config_schema(cls) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "host": {"type": "string", "description": "SFTP server hostname"},
                "port": {"type": "integer", "default": 22, "description": "SFTP port"},
                "username": {"type": "string", "description": "Username"},
                "password": {"type": "string", "format": "password", "description": "Password"},
                "private_key_path": {"type": "string", "description": "Path to private key file"},
                "private_key": {"type": "string", "description": "Private key content"},
            },
            "required": ["host", "username"],
        }
