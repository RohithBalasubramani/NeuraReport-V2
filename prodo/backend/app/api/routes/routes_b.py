from __future__ import annotations

"""
Connector API Routes - Database and cloud storage connector endpoints.

All connector-connection CRUD is backed by the persistent StateStore
(``state["connectors"]`` / ``state["connector_credentials"]``).
No in-memory dicts - connections survive server restarts.
"""

import io
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Path, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.services.config import require_api_key
from backend.app.services.llm import get_model
from ...services.connectors import (
    get_connector,
    list_connectors as list_available_connectors,
)
from backend.app.utils import is_read_only_sql, is_safe_external_url
from backend.app.services.config import state_store

logger = logging.getLogger("neura.api.connectors")

# Credential keys that must never appear in API responses
_SENSITIVE_KEYS = frozenset({
    "password", "secret", "token", "access_token", "refresh_token",
    "api_key", "private_key", "client_secret", "credentials",
})

def _redact_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of config with sensitive values replaced by '***'."""
    if not config:
        return {}
    redacted = {}
    for k, v in config.items():
        if k.lower() in _SENSITIVE_KEYS:
            redacted[k] = "***"
        elif isinstance(v, dict):
            redacted[k] = _redact_config(v)
        else:
            redacted[k] = v
    return redacted

connectors_router = APIRouter(tags=["connectors"], dependencies=[Depends(require_api_key)])

# Schemas

class ConnectorInfo(BaseModel):
    """Connector type information."""

    id: str
    name: str
    type: str
    auth_types: list[str]
    capabilities: list[str]
    free_tier: bool
    config_schema: dict[str, Any]

class CreateConnectionRequest(BaseModel):
    """Create connection request."""

    name: str = Field(..., min_length=1, max_length=255)
    connector_type: str
    config: dict[str, Any]

class ConnectionResponse(BaseModel):
    """Connection response."""

    id: str
    name: str
    connector_type: str
    status: str
    created_at: str
    last_used: Optional[str]
    latency_ms: Optional[float]

class TestConnectionRequest(BaseModel):
    """Test connection request."""

    connector_type: str
    config: dict[str, Any]

class TestConnectionResponse(BaseModel):
    """Test connection response."""

    success: bool
    latency_ms: Optional[float]
    error: Optional[str]
    details: Optional[dict[str, Any]]

class QueryRequest(BaseModel):
    """Query request."""

    query: str
    parameters: Optional[dict[str, Any]] = None
    limit: int = Field(1000, ge=1, le=10000)

class QueryResponse(BaseModel):
    """Query response."""

    columns: list[str]
    rows: list[list[Any]]
    row_count: int
    execution_time_ms: float
    truncated: bool
    error: Optional[str]

# Persistent connection helpers (StateStore-backed)

def _store_get_all() -> dict[str, dict]:
    """Return all connector connections from state."""
    with state_store.transaction() as state:
        return dict(state.get("connectors", {}))

def _store_get(connection_id: str) -> dict | None:
    """Return a single connector connection or *None*."""
    with state_store.transaction() as state:
        return state.get("connectors", {}).get(connection_id)

def _store_put(connection: dict) -> None:
    """Persist a connector connection (create or update).

    Raw config (which may contain credentials) is stored separately in
    ``connector_credentials`` and stripped from the main record to avoid
    accidental leakage through list/get endpoints.
    """
    with state_store.transaction() as state:
        # Store credentials separately
        if "config" in connection:
            state.setdefault("connector_credentials", {})[connection["id"]] = connection["config"]
        # Store connection metadata without raw config
        safe_record = {k: v for k, v in connection.items() if k != "config"}
        safe_record["has_credentials"] = "config" in connection
        state.setdefault("connectors", {})[connection["id"]] = safe_record

def _store_get_config(connection_id: str) -> dict[str, Any]:
    """Retrieve raw config (credentials) for a connection."""
    with state_store.transaction() as state:
        return state.get("connector_credentials", {}).get(connection_id, {})

def _store_delete(connection_id: str) -> bool:
    """Remove a connector connection. Return *True* if found."""
    with state_store.transaction() as state:
        removed = state.get("connectors", {}).pop(connection_id, None) is not None
        state.get("connector_credentials", {}).pop(connection_id, None)
        return removed

# Connector Discovery Endpoints

@connectors_router.get("/types")
async def list_connector_types() -> list[ConnectorInfo]:
    """List all available connector types."""
    return [ConnectorInfo(**c) for c in list_available_connectors()]

@connectors_router.get("/types/{connector_type}")
async def get_connector_type(connector_type: str) -> ConnectorInfo:
    """Get information about a specific connector type."""
    connectors = list_available_connectors()
    for c in connectors:
        if c["id"] == connector_type:
            return ConnectorInfo(**c)
    raise HTTPException(status_code=404, detail="Connector type not found")

@connectors_router.get("/types/by-category/{category}")
async def list_connectors_by_category(
    category: str = Path(..., pattern="^(database|cloud_storage|productivity|api)$"),
) -> list[ConnectorInfo]:
    """List connectors by category."""
    connectors = list_available_connectors()
    return [ConnectorInfo(**c) for c in connectors if c["type"] == category]

# Connection Test Endpoints

@connectors_router.post("/{connector_type}/test", response_model=TestConnectionResponse)
async def test_connection(
    connector_type: str,
    request: TestConnectionRequest,
):
    """Test a connection configuration."""
    try:
        connector = get_connector(connector_type, request.config)
        result = await connector.test_connection()
        return TestConnectionResponse(
            success=result.success,
            latency_ms=result.latency_ms,
            error=result.error,
            details=result.details,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e) or "Invalid connector configuration")
    except Exception as e:
        logger.exception("connector_test_failed", extra={"connector_type": connector_type})
        return TestConnectionResponse(
            success=False,
            latency_ms=None,
            error=f"{type(e).__name__}: Connection test failed",
            details=None,
        )

# Connection CRUD Endpoints

@connectors_router.post("/{connector_type}/connect", response_model=ConnectionResponse)
async def create_connection(
    connector_type: str,
    request: CreateConnectionRequest,
):
    """Create and save a new connection."""
    try:
        # Test connection first
        connector = get_connector(connector_type, request.config)
        test_result = await connector.test_connection()

        if not test_result.success:
            detail = "Connection failed"
            if getattr(test_result, "error", None):
                detail = f"{detail}: {test_result.error}"
            raise HTTPException(
                status_code=400,
                detail=detail,
            )

        now = datetime.now(timezone.utc).isoformat()
        connection = {
            "id": str(uuid.uuid4()),
            "name": request.name,
            "connector_type": connector_type,
            "config": request.config,
            "status": "connected",
            "created_at": now,
            "last_used": now,
            "latency_ms": test_result.latency_ms,
        }
        _store_put(connection)

        return ConnectionResponse(
            id=connection["id"],
            name=connection["name"],
            connector_type=connection["connector_type"],
            status=connection["status"],
            created_at=connection["created_at"],
            last_used=connection["last_used"],
            latency_ms=connection["latency_ms"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e) or "Invalid connection configuration")

@connectors_router.get("")
async def list_connections(
    connector_type: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List saved connections."""
    connections = list(_store_get_all().values())
    if connector_type:
        connections = [c for c in connections if c["connector_type"] == connector_type]
    connections.sort(key=lambda c: c["created_at"], reverse=True)
    return {
        "connections": [
            ConnectionResponse(
                id=c["id"],
                name=c["name"],
                connector_type=c["connector_type"],
                status=c["status"],
                created_at=c["created_at"],
                last_used=c.get("last_used"),
                latency_ms=c.get("latency_ms"),
            )
            for c in connections[offset:offset + limit]
        ],
        "total": len(connections),
        "offset": offset,
        "limit": limit,
    }

@connectors_router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Get a connection by ID.

    Note: connection_id is restricted to UUID format to disambiguate from
    /{connector_type}/... routes which use short alphanumeric names.
    """
    c = _store_get(connection_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return ConnectionResponse(
        id=c["id"],
        name=c["name"],
        connector_type=c["connector_type"],
        status=c["status"],
        created_at=c["created_at"],
        last_used=c.get("last_used"),
        latency_ms=c.get("latency_ms"),
    )

@connectors_router.delete("/{connection_id}")
async def delete_connection(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Delete a connection."""
    if not _store_delete(connection_id):
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"status": "ok", "message": "Connection deleted"}

# Connection Health & Schema Endpoints

@connectors_router.post("/{connection_id}/health", response_model=TestConnectionResponse)
async def check_connection_health(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Check if a connection is healthy."""
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    try:
        connector = get_connector(conn["connector_type"], config)
        result = await connector.test_connection()

        # Persist updated health status
        conn["status"] = "connected" if result.success else "error"
        conn["latency_ms"] = result.latency_ms
        conn["config"] = config  # include config so _store_put can re-persist credentials
        _store_put(conn)

        return TestConnectionResponse(
            success=result.success,
            latency_ms=result.latency_ms,
            error=result.error,
            details=result.details,
        )
    except Exception as e:
        logger.exception("connector_health_failed", extra={"connection_id": connection_id})
        conn["status"] = "error"
        _store_put(conn)
        return TestConnectionResponse(
            success=False,
            latency_ms=None,
            error=f"{type(e).__name__}: Health check failed",
            details=None,
        )

@connectors_router.get("/{connection_id}/schema")
async def get_connection_schema(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Get schema information for a connection."""
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()
        schema = await connector.discover_schema()
        return {
            "tables": [t.model_dump() for t in schema.tables],
            "views": [v.model_dump() for v in schema.views],
            "schemas": schema.schemas,
        }
    except Exception as e:
        logger.exception("connector_schema_failed", extra={"connection_id": connection_id})
        raise HTTPException(status_code=500, detail="Failed to retrieve schema")
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

# Query Execution Endpoints

@connectors_router.post("/{connection_id}/query", response_model=QueryResponse)
async def execute_query(
    request: QueryRequest,
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Execute a query on a connection."""
    # Validate query is read-only before execution
    is_safe, sql_error = is_read_only_sql(request.query)
    if not is_safe:
        raise HTTPException(status_code=400, detail=sql_error)

    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()
        result = await connector.execute_query(
            request.query,
            request.parameters,
            request.limit,
        )

        # Persist last-used timestamp
        conn["last_used"] = datetime.now(timezone.utc).isoformat()
        conn["config"] = config  # include config so _store_put can re-persist credentials
        _store_put(conn)

        return QueryResponse(
            columns=result.columns,
            rows=result.rows,
            row_count=result.row_count,
            execution_time_ms=result.execution_time_ms,
            truncated=result.truncated,
            error=result.error,
        )
    except Exception as e:
        logger.exception("connector_query_failed", extra={"connection_id": connection_id})
        return QueryResponse(
            columns=[],
            rows=[],
            row_count=0,
            execution_time_ms=0.0,
            truncated=False,
            error=f"{type(e).__name__}: Query execution failed",
        )
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

# OAuth Endpoints

def _validate_redirect_uri(redirect_uri: str) -> None:
    """Validate redirect_uri is a safe external URL (not internal/private)."""
    is_safe, reason = is_safe_external_url(redirect_uri)
    if not is_safe:
        raise HTTPException(
            status_code=400,
            detail="Invalid redirect_uri",
        )

def _redact_tokens(tokens: dict[str, Any] | None) -> dict[str, Any]:
    """Redact sensitive fields from OAuth tokens, keeping only metadata."""
    if not tokens:
        return {}
    redacted = {}
    for k, v in tokens.items():
        if k.lower() in _SENSITIVE_KEYS or "token" in k.lower():
            redacted[k] = "***"
        else:
            redacted[k] = v
    # Indicate tokens were received but redacted
    redacted["_redacted"] = True
    return redacted

@connectors_router.get("/{connector_type}/oauth/authorize")
async def get_oauth_url(
    connector_type: str,
    redirect_uri: str = Query(..., max_length=2000),
    state: Optional[str] = None,
):
    """Get OAuth authorization URL for a connector."""
    _validate_redirect_uri(redirect_uri)
    try:
        connector = get_connector(connector_type, {})
        if state is None:
            state = str(uuid.uuid4())
        auth_url = connector.get_oauth_url(redirect_uri, state)
        if not auth_url:
            raise HTTPException(
                status_code=400,
                detail="This connector does not support OAuth",
            )
        return {
            "authorization_url": auth_url,
            "state": state,
        }
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning("Invalid connector request: %s", e)
        raise HTTPException(status_code=400, detail="Invalid connector configuration")

@connectors_router.post("/{connector_type}/oauth/callback")
async def handle_oauth_callback(
    connector_type: str,
    code: str = Query(..., max_length=2000),
    redirect_uri: str = Query(..., max_length=2000),
    state: Optional[str] = None,
):
    """Handle OAuth callback and exchange code for tokens."""
    _validate_redirect_uri(redirect_uri)
    try:
        connector = get_connector(connector_type, {})
        tokens = connector.handle_oauth_callback(code, redirect_uri)
        return {
            "status": "ok",
            "tokens": _redact_tokens(tokens) if isinstance(tokens, dict) else {"_redacted": True},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("oauth_callback_failed", extra={"connector_type": connector_type})
        raise HTTPException(status_code=400, detail="OAuth callback failed")

# File Operations Endpoints

class FileInfoResponse(BaseModel):
    """File information response."""

    id: str
    name: str
    path: str
    size_bytes: int
    mime_type: Optional[str]
    created_at: Optional[str]
    modified_at: Optional[str]
    is_folder: bool
    download_url: Optional[str]

class FileUploadResponse(BaseModel):
    """File upload response."""

    status: str
    file: FileInfoResponse

class SyncStatusResponse(BaseModel):
    """Sync status response."""

    connection_id: str
    status: str
    started_at: Optional[str]
    completed_at: Optional[str]
    files_synced: int
    errors: list[str]

class SyncScheduleRequest(BaseModel):
    """Sync schedule request."""

    interval_minutes: int = Field(..., ge=5, le=1440)
    enabled: bool = True

class SyncScheduleResponse(BaseModel):
    """Sync schedule response."""

    connection_id: str
    interval_minutes: int
    enabled: bool
    next_run: Optional[str]

@connectors_router.get("/{connection_id}/files")
async def list_connection_files(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
    path: str = Query("/", max_length=2000),
    recursive: bool = Query(False),
) -> dict[str, Any]:
    """List files for a cloud storage connection.

    Returns files and folders at the given *path* within the connected
    cloud storage provider.
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()
        files = await connector.list_files(path=path, recursive=recursive)

        # Update last-used timestamp
        conn["last_used"] = datetime.now(timezone.utc).isoformat()
        conn["config"] = config
        _store_put(conn)

        return {
            "connection_id": connection_id,
            "path": path,
            "files": [
                FileInfoResponse(
                    id=f.id,
                    name=f.name,
                    path=f.path,
                    size_bytes=f.size_bytes,
                    mime_type=f.mime_type,
                    created_at=f.created_at,
                    modified_at=f.modified_at,
                    is_folder=f.is_folder,
                    download_url=f.download_url,
                ).model_dump()
                for f in files
            ],
            "total": len(files),
        }
    except NotImplementedError:
        raise HTTPException(
            status_code=400,
            detail="This connector does not support file listing",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("connector_list_files_failed", extra={"connection_id": connection_id})
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: Failed to list files",
        )
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

@connectors_router.get("/{connection_id}/files/download")
async def download_connection_file(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
    path: str = Query(..., min_length=1, max_length=2000),
):
    """Download a file from a cloud storage connection.

    The *path* query parameter identifies the file to download.  The
    response streams the raw file bytes with an appropriate content type.
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()
        content = await connector.download_file(file_id=path)

        # Update last-used timestamp
        conn["last_used"] = datetime.now(timezone.utc).isoformat()
        conn["config"] = config
        _store_put(conn)

        # Derive a filename from the path for the Content-Disposition header
        filename = path.rsplit("/", 1)[-1] or "download"

        return StreamingResponse(
            io.BytesIO(content),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(content)),
            },
        )
    except NotImplementedError:
        raise HTTPException(
            status_code=400,
            detail="This connector does not support file download",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("connector_download_file_failed", extra={"connection_id": connection_id, "path": path})
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: Failed to download file",
        )
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

@connectors_router.post("/{connection_id}/files/upload", response_model=FileUploadResponse)
async def upload_connection_file(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
    path: str = Query("/", max_length=2000),
    file: UploadFile = File(...),
):
    """Upload a file to a cloud storage connection.

    Accepts a multipart file upload and stores it at the given *path*
    within the connected cloud storage provider.
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()

        content = await file.read()
        file_info = await connector.upload_file(
            content=content,
            path=path,
            filename=file.filename or "upload",
            mime_type=file.content_type,
        )

        # Update last-used timestamp
        conn["last_used"] = datetime.now(timezone.utc).isoformat()
        conn["config"] = config
        _store_put(conn)

        return FileUploadResponse(
            status="ok",
            file=FileInfoResponse(
                id=file_info.id,
                name=file_info.name,
                path=file_info.path,
                size_bytes=file_info.size_bytes,
                mime_type=file_info.mime_type,
                created_at=file_info.created_at,
                modified_at=file_info.modified_at,
                is_folder=file_info.is_folder,
                download_url=file_info.download_url,
            ),
        )
    except NotImplementedError:
        raise HTTPException(
            status_code=400,
            detail="This connector does not support file upload",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("connector_upload_file_failed", extra={"connection_id": connection_id})
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: Failed to upload file",
        )
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

# Sync Endpoints

@connectors_router.post("/{connection_id}/sync")
async def start_connection_sync(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
) -> dict[str, Any]:
    """Start syncing a connection.

    Initiates a sync operation for the connection and records the sync
    status in the persistent state store under ``connector_sync_status``.
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = _store_get_config(connection_id)
    connector = None
    try:
        connector = get_connector(conn["connector_type"], config)
        await connector.connect()

        now = datetime.now(timezone.utc).isoformat()
        sync_status = {
            "connection_id": connection_id,
            "status": "in_progress",
            "started_at": now,
            "completed_at": None,
            "files_synced": 0,
            "errors": [],
        }

        # Persist initial sync status
        with state_store.transaction() as state:
            state.setdefault("connector_sync_status", {})[connection_id] = sync_status

        # Attempt sync by listing all files (implementation-dependent)
        files_synced = 0
        errors: list[str] = []
        try:
            files = await connector.list_files(path="/", recursive=True)
            files_synced = len(files)
        except NotImplementedError:
            errors.append("Connector does not support file listing for sync")
        except Exception as e:
            errors.append(f"{type(e).__name__}: {e}")

        # Update sync status with results
        completed_at = datetime.now(timezone.utc).isoformat()
        final_status = "completed" if not errors else "completed_with_errors"
        sync_status.update({
            "status": final_status,
            "completed_at": completed_at,
            "files_synced": files_synced,
            "errors": errors,
        })

        with state_store.transaction() as state:
            state.setdefault("connector_sync_status", {})[connection_id] = sync_status

        # Update last-used timestamp on the connection
        conn["last_used"] = completed_at
        conn["config"] = config
        _store_put(conn)

        return sync_status
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("connector_sync_failed", extra={"connection_id": connection_id})
        # Record failure in sync status
        error_status = {
            "connection_id": connection_id,
            "status": "failed",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "files_synced": 0,
            "errors": [f"{type(e).__name__}: {e}"],
        }
        with state_store.transaction() as state:
            state.setdefault("connector_sync_status", {})[connection_id] = error_status
        raise HTTPException(
            status_code=500,
            detail=f"{type(e).__name__}: Sync failed",
        )
    finally:
        if connector is not None:
            try:
                await connector.disconnect()
            except Exception:
                pass

@connectors_router.get("/{connection_id}/sync/status", response_model=SyncStatusResponse)
async def get_sync_status(
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Get the sync status for a connection.

    Returns the most recent sync status from the state store.  If no
    sync has been run yet, a ``never_synced`` status is returned.
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    with state_store.transaction() as state:
        sync_statuses = state.get("connector_sync_status", {})
        sync_status = sync_statuses.get(connection_id)

    if sync_status is None:
        return SyncStatusResponse(
            connection_id=connection_id,
            status="never_synced",
            started_at=None,
            completed_at=None,
            files_synced=0,
            errors=[],
        )

    return SyncStatusResponse(
        connection_id=sync_status["connection_id"],
        status=sync_status["status"],
        started_at=sync_status.get("started_at"),
        completed_at=sync_status.get("completed_at"),
        files_synced=sync_status.get("files_synced", 0),
        errors=sync_status.get("errors", []),
    )

@connectors_router.post("/{connection_id}/sync/schedule", response_model=SyncScheduleResponse)
async def schedule_connection_sync(
    request: SyncScheduleRequest,
    connection_id: str = Path(..., min_length=36, max_length=36, pattern="^[0-9a-f-]{36}$"),
):
    """Schedule periodic sync for a connection.

    Stores the schedule configuration in the state store under
    ``connector_sync_status`` so that a background worker can pick it
    up.  The *interval_minutes* field must be between 5 and 1440 (24h).
    """
    conn = _store_get(connection_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    now = datetime.now(timezone.utc)

    # Calculate next run time based on interval
    next_run = (now + timedelta(minutes=request.interval_minutes)).isoformat()

    schedule = {
        "connection_id": connection_id,
        "interval_minutes": request.interval_minutes,
        "enabled": request.enabled,
        "next_run": next_run if request.enabled else None,
        "created_at": now.isoformat(),
    }

    with state_store.transaction() as state:
        sync_status = state.setdefault("connector_sync_status", {}).get(connection_id, {})
        sync_status["schedule"] = schedule
        state.setdefault("connector_sync_status", {})[connection_id] = sync_status

    logger.info(
        "connector_sync_scheduled",
        extra={
            "connection_id": connection_id,
            "interval_minutes": request.interval_minutes,
            "enabled": request.enabled,
        },
    )

    return SyncScheduleResponse(
        connection_id=connection_id,
        interval_minutes=request.interval_minutes,
        enabled=request.enabled,
        next_run=next_run if request.enabled else None,
    )

"""Workflow API Routes.

REST API endpoints for workflow automation.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from backend.app.schemas import (
    ApprovalRequest,
    ConfigureTriggerRequest,
    CreateWorkflowRequest,
    ExecuteWorkflowRequest,
    ExecutionStatus,
    NodeType,
    TriggerType,
    UpdateWorkflowRequest,
    WorkflowEdge,
    WorkflowExecutionResponse,
    WorkflowListResponse,
    WorkflowNode,
    WorkflowResponse,
    WorkflowTrigger,
)
from backend.app.services.workflow_jobs_excel import workflow_service
from backend.app.api.middleware import limiter, RATE_LIMIT_STRICT

logger = logging.getLogger("neura.api.workflows")

workflows_router = APIRouter(tags=["workflows"], dependencies=[Depends(require_api_key)])

@workflows_router.post("", response_model=WorkflowResponse)
async def create_workflow(request: CreateWorkflowRequest):
    """Create a new workflow."""
    return await workflow_service.create_workflow(request)

@workflows_router.get("", response_model=WorkflowListResponse)
async def list_workflows(
    active_only: bool = Query(False, description="Only return active workflows"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List all workflows."""
    workflows, total = await workflow_service.list_workflows(
        active_only=active_only,
        limit=limit,
        offset=offset,
    )
    return WorkflowListResponse(workflows=workflows, total=total)

# --- Static-prefix routes (must be declared before /{workflow_id}) ---

@workflows_router.get("/approvals/pending")
async def get_pending_approvals(workflow_id: Optional[str] = None):
    """Get all pending approvals."""
    return await workflow_service.get_pending_approvals(workflow_id=workflow_id)

@workflows_router.get("/executions/{execution_id}", response_model=WorkflowExecutionResponse)
async def get_execution(execution_id: str):
    """Get execution status."""
    execution = await workflow_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    return execution

@workflows_router.post("/executions/{execution_id}/approve")
async def approve_execution(execution_id: str, request: ApprovalRequest):
    """Approve or reject a pending approval."""
    result = await workflow_service.approve_execution(
        execution_id,
        node_id=request.node_id,
        approved=request.approved,
        comment=request.comment,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Pending approval not found")
    return result

@workflows_router.get("/node-types")
async def list_node_types():
    """List available node types."""
    node_types = [
        {"type": nt.value, "label": nt.value.replace("_", " ").title()}
        for nt in NodeType
    ]
    return {"node_types": node_types, "total": len(node_types)}

@workflows_router.get("/node-types/{node_type}/schema")
async def get_node_type_schema(node_type: str):
    """Get schema for a node type."""
    try:
        nt = NodeType(node_type)
    except ValueError:
        raise HTTPException(status_code=404, detail="Node type not found")

    # Define config schemas per node type
    schemas = {
        NodeType.TRIGGER: {"properties": {"event": {"type": "string"}}},
        NodeType.WEBHOOK: {"properties": {"url": {"type": "string"}, "method": {"type": "string"}}},
        NodeType.ACTION: {"properties": {"action_type": {"type": "string"}, "message": {"type": "string"}}},
        NodeType.EMAIL: {"properties": {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}}},
        NodeType.NOTIFICATION: {"properties": {"channel": {"type": "string"}, "message": {"type": "string"}}},
        NodeType.CONDITION: {"properties": {"condition": {"type": "string"}}},
        NodeType.LOOP: {"properties": {"items_path": {"type": "string"}, "max_iterations": {"type": "integer"}}},
        NodeType.APPROVAL: {"properties": {"approver": {"type": "string"}, "timeout_hours": {"type": "integer"}}},
        NodeType.DATA_TRANSFORM: {"properties": {"transform": {"type": "object"}}},
        NodeType.DELAY: {"properties": {"delay_ms": {"type": "integer"}}},
        NodeType.HTTP_REQUEST: {"properties": {"url": {"type": "string"}, "method": {"type": "string"}, "headers": {"type": "object"}, "body": {"type": "object"}}},
        NodeType.DATABASE_QUERY: {"properties": {"query": {"type": "string"}, "connection": {"type": "string"}}},
    }

    return {
        "node_type": nt.value,
        "label": nt.value.replace("_", " ").title(),
        "config_schema": schemas.get(nt, {"properties": {}}),
    }

@workflows_router.get("/templates")
async def list_workflow_templates():
    """List workflow templates."""
    try:
        from backend.app.repositories import state_store
        with state_store.transaction() as state:
            templates = state.get("workflow_templates", {})
    except Exception:
        templates = {}

    template_list = list(templates.values())
    return {"templates": template_list, "total": len(template_list)}

class CreateFromTemplateRequest(BaseModel):
    name: Optional[str] = None
    input_data: dict[str, Any] = Field(default_factory=dict)

@workflows_router.post("/templates/{template_id}/create", response_model=WorkflowResponse)
async def create_workflow_from_template(
    template_id: str,
    request: CreateFromTemplateRequest,
):
    """Create workflow from template."""
    try:
        with state_store.transaction() as state:
            templates = state.get("workflow_templates", {})
            template = templates.get(template_id)
    except Exception:
        template = None

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    create_request = CreateWorkflowRequest(
        name=request.name or template.get("name", "Workflow from template"),
        description=template.get("description"),
        nodes=[WorkflowNode(**n) for n in template.get("nodes", [])],
        edges=[WorkflowEdge(**e) for e in template.get("edges", [])],
        triggers=[WorkflowTrigger(**t) for t in template.get("triggers", [])],
        is_active=True,
    )

    return await workflow_service.create_workflow(create_request)

# --- Parameterized routes ---

@workflows_router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str):
    """Get a workflow by ID."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow

@workflows_router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(workflow_id: str, request: UpdateWorkflowRequest):
    """Update a workflow."""
    workflow = await workflow_service.update_workflow(workflow_id, request)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow

@workflows_router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    """Delete a workflow."""
    deleted = await workflow_service.delete_workflow(workflow_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"status": "deleted", "id": workflow_id}

@workflows_router.post("/{workflow_id}/execute", response_model=WorkflowExecutionResponse)
@limiter.limit(RATE_LIMIT_STRICT)
async def execute_workflow(
    request: Request,
    workflow_id: str,
    req: ExecuteWorkflowRequest,
):
    """Execute a workflow."""
    try:
        return await workflow_service.execute_workflow(
            workflow_id,
            input_data=req.input_data,
            async_execution=req.async_execution,
        )
    except ValueError as e:
        logger.warning("Workflow not found: %s", e)
        raise HTTPException(status_code=404, detail="Workflow not found")
    except Exception as e:
        logger.error("Workflow execution failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Workflow execution failed due to an internal error.",
        )

@workflows_router.get("/{workflow_id}/executions", response_model=list[WorkflowExecutionResponse])
async def list_executions(
    workflow_id: str,
    status: Optional[ExecutionStatus] = None,
    limit: int = Query(50, ge=1, le=200),
):
    """List executions for a workflow."""
    return await workflow_service.list_executions(
        workflow_id=workflow_id,
        status=status,
        limit=limit,
    )

# Required config keys per trigger type
_TRIGGER_REQUIRED_KEYS: dict[TriggerType, set[str]] = {
    TriggerType.SCHEDULE: {"cron"},
    TriggerType.WEBHOOK: {"secret"},
    TriggerType.FILE_UPLOAD: {"path"},
    TriggerType.EVENT: {"event_name"},
    TriggerType.MANUAL: set(),
}

@workflows_router.post("/{workflow_id}/trigger", response_model=WorkflowResponse)
async def configure_trigger(workflow_id: str, request: ConfigureTriggerRequest):
    """Configure a workflow trigger."""
    # Validate trigger type is recognized
    try:
        trigger_type = TriggerType(request.trigger_type)
    except ValueError:
        valid = [t.value for t in TriggerType]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid trigger_type '{request.trigger_type}'. Must be one of: {', '.join(valid)}",
        )

    # Validate required config keys for the trigger type
    required = _TRIGGER_REQUIRED_KEYS.get(trigger_type, set())
    missing = required - set(request.config.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Trigger type '{trigger_type.value}' requires config keys: {', '.join(sorted(missing))}",
        )

    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Add or update trigger
    new_trigger = WorkflowTrigger(type=trigger_type, config=request.config)
    triggers = list(workflow.triggers)

    # Replace existing trigger of same type or add new
    found = False
    for i, t in enumerate(triggers):
        if t.type == trigger_type:
            triggers[i] = new_trigger
            found = True
            break
    if not found:
        triggers.append(new_trigger)

    update_request = UpdateWorkflowRequest(triggers=triggers)
    return await workflow_service.update_workflow(workflow_id, update_request)

# --- Execution control ---

@workflows_router.post("/{workflow_id}/executions/{execution_id}/cancel")
async def cancel_execution(workflow_id: str, execution_id: str):
    """Cancel a running execution."""
    execution = await workflow_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    if execution.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Execution not found for this workflow")

    exec_data = workflow_service._executions.get(execution_id)
    if not exec_data:
        raise HTTPException(status_code=404, detail="Execution not found")

    if exec_data["status"] in (ExecutionStatus.COMPLETED.value, ExecutionStatus.CANCELLED.value):
        raise HTTPException(status_code=400, detail="Execution is already finished")

    exec_data["status"] = ExecutionStatus.CANCELLED.value
    exec_data["finished_at"] = datetime.now(timezone.utc)
    exec_data["error"] = "Cancelled by user"

    return {"status": "cancelled", "execution_id": execution_id}

@workflows_router.post("/{workflow_id}/executions/{execution_id}/retry")
async def retry_execution(workflow_id: str, execution_id: str):
    """Retry a failed execution."""
    execution = await workflow_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    if execution.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Execution not found for this workflow")
    if execution.status != ExecutionStatus.FAILED:
        raise HTTPException(status_code=400, detail="Only failed executions can be retried")

    # Re-execute the workflow with the same input data
    try:
        new_execution = await workflow_service.execute_workflow(
            workflow_id,
            input_data=execution.input_data,
            async_execution=True,
        )
        return new_execution
    except ValueError as e:
        raise HTTPException(status_code=404, detail="Workflow not found")
    except Exception as e:
        logger.error("Retry execution failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Retry failed due to an internal error.")

@workflows_router.get("/{workflow_id}/executions/{execution_id}/logs")
async def get_execution_logs(workflow_id: str, execution_id: str):
    """Get execution logs."""
    execution = await workflow_service.get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")
    if execution.workflow_id != workflow_id:
        raise HTTPException(status_code=404, detail="Execution not found for this workflow")

    logs = []
    for result in execution.node_results:
        logs.append({
            "node_id": result.node_id,
            "status": result.status.value,
            "started_at": result.started_at.isoformat() if result.started_at else None,
            "finished_at": result.finished_at.isoformat() if result.finished_at else None,
            "error": result.error,
            "output_keys": list(result.output.keys()) if result.output else [],
        })

    return {
        "execution_id": execution_id,
        "workflow_id": workflow_id,
        "status": execution.status.value,
        "logs": logs,
    }

# --- Trigger management ---

@workflows_router.put("/{workflow_id}/triggers/{trigger_id}")
async def update_trigger(
    workflow_id: str,
    trigger_id: str,
    request: ConfigureTriggerRequest,
):
    """Update a specific trigger."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        trigger_type = TriggerType(request.trigger_type)
    except ValueError:
        valid = [t.value for t in TriggerType]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid trigger_type. Must be one of: {', '.join(valid)}",
        )

    triggers = list(workflow.triggers)
    trigger_idx = int(trigger_id) if trigger_id.isdigit() else None

    if trigger_idx is None or trigger_idx < 0 or trigger_idx >= len(triggers):
        raise HTTPException(status_code=404, detail="Trigger not found")

    triggers[trigger_idx] = WorkflowTrigger(type=trigger_type, config=request.config)
    update_request = UpdateWorkflowRequest(triggers=triggers)
    return await workflow_service.update_workflow(workflow_id, update_request)

@workflows_router.delete("/{workflow_id}/triggers/{trigger_id}")
async def delete_trigger(workflow_id: str, trigger_id: str):
    """Delete a trigger."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    triggers = list(workflow.triggers)
    trigger_idx = int(trigger_id) if trigger_id.isdigit() else None

    if trigger_idx is None or trigger_idx < 0 or trigger_idx >= len(triggers):
        raise HTTPException(status_code=404, detail="Trigger not found")

    triggers.pop(trigger_idx)
    update_request = UpdateWorkflowRequest(triggers=triggers)
    result = await workflow_service.update_workflow(workflow_id, update_request)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"status": "deleted", "trigger_id": trigger_id}

@workflows_router.post("/{workflow_id}/triggers/{trigger_id}/enable")
async def enable_trigger(workflow_id: str, trigger_id: str):
    """Enable a trigger."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    triggers = list(workflow.triggers)
    trigger_idx = int(trigger_id) if trigger_id.isdigit() else None

    if trigger_idx is None or trigger_idx < 0 or trigger_idx >= len(triggers):
        raise HTTPException(status_code=404, detail="Trigger not found")

    trigger = triggers[trigger_idx]
    updated_config = dict(trigger.config)
    updated_config["enabled"] = True
    triggers[trigger_idx] = WorkflowTrigger(type=trigger.type, config=updated_config)

    update_request = UpdateWorkflowRequest(triggers=triggers)
    await workflow_service.update_workflow(workflow_id, update_request)
    return {"status": "enabled", "trigger_id": trigger_id}

@workflows_router.post("/{workflow_id}/triggers/{trigger_id}/disable")
async def disable_trigger(workflow_id: str, trigger_id: str):
    """Disable a trigger."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    triggers = list(workflow.triggers)
    trigger_idx = int(trigger_id) if trigger_id.isdigit() else None

    if trigger_idx is None or trigger_idx < 0 or trigger_idx >= len(triggers):
        raise HTTPException(status_code=404, detail="Trigger not found")

    trigger = triggers[trigger_idx]
    updated_config = dict(trigger.config)
    updated_config["enabled"] = False
    triggers[trigger_idx] = WorkflowTrigger(type=trigger.type, config=updated_config)

    update_request = UpdateWorkflowRequest(triggers=triggers)
    await workflow_service.update_workflow(workflow_id, update_request)
    return {"status": "disabled", "trigger_id": trigger_id}

# --- Template management ---

@workflows_router.post("/{workflow_id}/save-as-template")
async def save_as_template(workflow_id: str):
    """Save workflow as a reusable template."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    template_id = str(uuid.uuid4())
    template = {
        "id": template_id,
        "name": workflow.name,
        "description": workflow.description,
        "nodes": [n.model_dump() for n in workflow.nodes],
        "edges": [e.model_dump() for e in workflow.edges],
        "triggers": [t.model_dump() for t in workflow.triggers],
        "source_workflow_id": workflow_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with state_store.transaction() as state:
            if "workflow_templates" not in state:
                state["workflow_templates"] = {}
            state["workflow_templates"][template_id] = template
    except Exception as e:
        logger.warning("Failed to persist workflow template: %s", e)

    return template

# --- Webhook management ---

class CreateWebhookRequest(BaseModel):
    name: Optional[str] = None
    events: list[str] = Field(default_factory=lambda: ["*"])

@workflows_router.post("/{workflow_id}/webhooks")
async def create_webhook(workflow_id: str, request: CreateWebhookRequest):
    """Create a webhook for a workflow."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    webhook_id = str(uuid.uuid4())
    webhook_secret = secrets.token_urlsafe(32)

    webhook = {
        "id": webhook_id,
        "workflow_id": workflow_id,
        "name": request.name or f"webhook-{webhook_id[:8]}",
        "secret": webhook_secret,
        "events": request.events,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with state_store.transaction() as state:
            key = f"workflow_webhooks:{workflow_id}"
            if key not in state:
                state[key] = {}
            state[key][webhook_id] = webhook
    except Exception as e:
        logger.warning("Failed to persist webhook: %s", e)

    return webhook

@workflows_router.get("/{workflow_id}/webhooks")
async def list_webhooks(workflow_id: str):
    """List webhooks for a workflow."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    webhooks = {}
    try:
        with state_store.transaction() as state:
            key = f"workflow_webhooks:{workflow_id}"
            webhooks = state.get(key, {})
    except Exception as e:
        logger.debug("Failed to load webhooks from state store: %s", e)

    webhook_list = list(webhooks.values())
    return {"webhooks": webhook_list, "total": len(webhook_list)}

@workflows_router.delete("/{workflow_id}/webhooks/{webhook_id}")
async def delete_webhook(workflow_id: str, webhook_id: str):
    """Delete a webhook."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        with state_store.transaction() as state:
            key = f"workflow_webhooks:{workflow_id}"
            webhooks = state.get(key, {})
            if webhook_id not in webhooks:
                raise HTTPException(status_code=404, detail="Webhook not found")
            del webhooks[webhook_id]
            state[key] = webhooks
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Failed to delete webhook from state store: %s", e)
        raise HTTPException(status_code=404, detail="Webhook not found")

    return {"status": "deleted", "webhook_id": webhook_id}

@workflows_router.post("/{workflow_id}/webhooks/{webhook_id}/regenerate-secret")
async def regenerate_webhook_secret(workflow_id: str, webhook_id: str):
    """Regenerate webhook secret."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    new_secret = secrets.token_urlsafe(32)

    try:
        with state_store.transaction() as state:
            key = f"workflow_webhooks:{workflow_id}"
            webhooks = state.get(key, {})
            if webhook_id not in webhooks:
                raise HTTPException(status_code=404, detail="Webhook not found")
            webhooks[webhook_id]["secret"] = new_secret
            state[key] = webhooks
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Failed to regenerate webhook secret: %s", e)
        raise HTTPException(status_code=404, detail="Webhook not found")

    return {"webhook_id": webhook_id, "secret": new_secret}

# --- Debug ---

class DebugWorkflowRequest(BaseModel):
    input_data: dict[str, Any] = Field(default_factory=dict)

@workflows_router.post("/{workflow_id}/debug")
async def debug_workflow(workflow_id: str, request: DebugWorkflowRequest):
    """Debug a workflow (dry run)."""
    workflow = await workflow_service.get_workflow(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    try:
        execution = await workflow_service.execute_workflow(
            workflow_id,
            input_data=request.input_data,
            async_execution=False,
        )
        return {
            "debug": True,
            "execution_id": execution.id,
            "status": execution.status.value,
            "node_results": [
                {
                    "node_id": r.node_id,
                    "status": r.status.value,
                    "output": r.output,
                    "error": r.error,
                }
                for r in execution.node_results
            ],
            "output_data": execution.output_data,
            "error": execution.error,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail="Workflow not found")
    except Exception as e:
        logger.error("Debug workflow failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Debug execution failed.")

# EXPORT ROUTES (merged from export_routes.py)

# Export API Routes - REST API endpoints for document export and distribution.

from fastapi import APIRouter, HTTPException, Request

from backend.app.api.middleware import limiter, RATE_LIMIT_STRICT, RATE_LIMIT_STANDARD

from backend.app.schemas import (
    BulkExportRequest,
    EmailCampaignRequest,
    EmbedGenerateRequest,
    EmbedResponse,
    PortalPublishRequest,
    SlackMessageRequest,
    TeamsMessageRequest,
    WebhookDeliveryRequest,
)
from backend.app.services.infra_services import distribution_service, export_service

from fastapi import Depends, Query

class ExportOptions(BaseModel):
    """Typed export options for format endpoints.

    Known fields are validated; additional fields are passed through
    to the export service to maintain forward compatibility.
    """
    model_config = {"extra": "allow"}

    page_size: Optional[str] = Field(None, max_length=20)
    orientation: Optional[str] = Field(None, pattern="^(portrait|landscape)$")
    include_toc: Optional[bool] = None
    include_cover: Optional[bool] = None
    watermark: Optional[str] = Field(None, max_length=100)
    header: Optional[str] = Field(None, max_length=500)
    footer: Optional[str] = Field(None, max_length=500)
    margin_mm: Optional[int] = Field(None, ge=0, le=100)
    quality: Optional[str] = Field(None, pattern="^(draft|standard|high)$")

class PrintRequest(BaseModel):
    """Request body for printing a document."""
    printer_id: Optional[str] = None
    copies: int = Field(1, ge=1, le=100)
    options: dict[str, Any] = Field(default_factory=dict)

export_router = APIRouter(tags=["export"], dependencies=[Depends(require_api_key)])

# ── Static-path routes (must be registered before /{document_id} routes) ──

@export_router.get("/printers")
async def list_printers():
    """List available printers."""
    printers = await export_service.list_printers()
    return {"printers": printers}

@export_router.get("/jobs")
async def list_export_jobs(
    status: Optional[str] = Query(None, description="Filter by job status"),
    format: Optional[str] = Query(None, description="Filter by export format"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of jobs to return"),
    offset: int = Query(0, ge=0, description="Number of jobs to skip"),
):
    """List all export jobs with optional filtering."""
    result = await export_service.list_export_jobs(
        status=status,
        format=format,
        limit=limit,
        offset=offset,
    )
    return result

# ── Dynamic-path routes ──

@export_router.post("/{document_id}/pdf")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_pdf(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to PDF format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="pdf",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/pdfa")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_pdfa(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to PDF/A archival format."""
    opts = options.model_dump(exclude_none=True) if options else {}
    opts["pdfa_compliant"] = True
    job = await export_service.create_export_job(
        document_id=document_id,
        format="pdfa",
        options=opts,
    )
    return job

@export_router.post("/{document_id}/docx")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_docx(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to Word DOCX format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="docx",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/pptx")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_pptx(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to PowerPoint format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="pptx",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/epub")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_epub(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to ePub format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="epub",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/latex")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_latex(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to LaTeX format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="latex",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/markdown")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_markdown(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to Markdown format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="markdown",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/{document_id}/html")
@limiter.limit(RATE_LIMIT_STANDARD)
async def export_to_html(request: Request, document_id: str, options: Optional[ExportOptions] = None):
    """Export document to HTML format."""
    job = await export_service.create_export_job(
        document_id=document_id,
        format="html",
        options=options.model_dump(exclude_none=True) if options else {},
    )
    return job

@export_router.post("/bulk")
@limiter.limit(RATE_LIMIT_STRICT)
async def bulk_export(request: Request, req: BulkExportRequest):
    """Export multiple documents as a ZIP file."""
    job = await export_service.bulk_export(
        document_ids=req.document_ids,
        format=req.format.value,
        options=req.options,
    )
    return job

@export_router.get("/jobs/{job_id}")
async def get_export_job(job_id: str):
    """Get export job status."""
    job = await export_service.get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")
    return job

# Distribution endpoints

@export_router.post("/distribution/email-campaign")
@limiter.limit(RATE_LIMIT_STRICT)
async def email_campaign(request: Request, body: EmailCampaignRequest):
    """Send documents via bulk email campaign."""
    results = []
    for doc_id in body.document_ids:
        result = await distribution_service.send_email(
            document_id=doc_id,
            recipients=body.recipients,
            subject=body.subject,
            message=body.message,
        )
        results.append(result)

    return {
        "campaign_id": results[0]["job_id"] if results else None,
        "documents_sent": len(results),
        "recipients_count": len(body.recipients),
        "results": results,
    }

@export_router.post("/distribution/portal/{document_id}")
@limiter.limit(RATE_LIMIT_STANDARD)
async def publish_to_portal(request: Request, document_id: str, body: PortalPublishRequest):
    """Publish document to portal."""
    result = await distribution_service.publish_to_portal(
        document_id=document_id,
        portal_path=body.portal_path,
        options={
            "title": body.title,
            "description": body.description,
            "tags": body.tags,
            "public": body.public,
            "password": body.password,
            "expires_at": body.expires_at,
        },
    )
    # Never echo the password back in the response
    if isinstance(result, dict):
        result.pop("password", None)
        opts = result.get("options", {})
        if isinstance(opts, dict):
            opts.pop("password", None)
        result["password_protected"] = body.password is not None
    return result

@export_router.post("/distribution/embed/{document_id}", response_model=EmbedResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def generate_embed(request: Request, document_id: str, body: EmbedGenerateRequest):
    """Generate embed code for a document."""
    result = await export_service.generate_embed_token(
        document_id=document_id,
        options={
            "width": body.width,
            "height": body.height,
            "allow_download": body.allow_download,
            "allow_print": body.allow_print,
            "show_toolbar": body.show_toolbar,
            "theme": body.theme,
        },
    )
    return EmbedResponse(**result)

@export_router.post("/distribution/slack")
@limiter.limit(RATE_LIMIT_STANDARD)
async def send_to_slack(request: Request, body: SlackMessageRequest):
    """Send document to Slack channel."""
    result = await distribution_service.send_to_slack(
        document_id=body.document_id,
        channel=body.channel,
        message=body.message,
    )
    return result

@export_router.post("/distribution/teams")
@limiter.limit(RATE_LIMIT_STANDARD)
async def send_to_teams(request: Request, req: TeamsMessageRequest):
    """Send document to Microsoft Teams."""
    result = await distribution_service.send_to_teams(
        document_id=req.document_id,
        webhook_url=req.webhook_url,
        title=req.title,
        message=req.message,
    )
    return result

@export_router.post("/distribution/webhook")
async def send_webhook(request: WebhookDeliveryRequest):
    """Deliver document via webhook."""
    result = await distribution_service.send_webhook(
        document_id=request.document_id,
        webhook_url=request.webhook_url,
        method=request.method,
        headers=request.headers,
    )
    return result

# ── Bulk export download ──

@export_router.get("/bulk/{job_id}/download")
async def download_bulk_export(job_id: str):
    """Download the result of a bulk export job."""
    job = await export_service.get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Bulk export job not found")

    if job.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Export job is not completed (current status: {job.get('status')})",
        )

    download_url = job.get("download_url")
    if not download_url:
        raise HTTPException(status_code=404, detail="Export file not available")

    # Resolve the file path from the uploads directory
    from backend.app.services.config import get_settings

    file_path = get_settings().uploads_root / download_url.lstrip("/uploads/")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Export file not found on disk")

    def _iter_file():
        with open(file_path, "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    filename = file_path.name
    return StreamingResponse(
        _iter_file(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ── Embed token management ──

@export_router.delete("/embed/{token_id}")
async def revoke_embed_token(token_id: str):
    """Revoke an embed token."""
    revoked = await export_service.revoke_embed_token(token_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="Embed token not found")
    return {"detail": "Embed token revoked", "token_id": token_id}

@export_router.get("/{document_id}/embed/tokens")
async def list_embed_tokens(document_id: str):
    """List embed tokens for a document."""
    tokens = await export_service.list_embed_tokens(document_id)
    return {"document_id": document_id, "tokens": tokens}

# ── Print endpoints ──

@export_router.post("/{document_id}/print")
@limiter.limit(RATE_LIMIT_STANDARD)
async def print_document(request: Request, document_id: str, body: PrintRequest):
    """Print a document."""
    job = await export_service.print_document(
        document_id=document_id,
        printer_id=body.printer_id,
        copies=body.copies,
        options=body.options,
    )
    return job

# ── Job management ──

@export_router.post("/jobs/{job_id}/cancel")
async def cancel_export_job(job_id: str):
    """Cancel an export job."""
    job = await export_service.cancel_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job.get("status") in ("completed", "failed"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job with status '{job.get('status')}'",
        )

    return job

"""Design API Routes.

REST API endpoints for brand kits and themes.
"""

import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse

from backend.app.schemas import (
    AccessibleColorsRequest,
    AccessibleColorsResponse,
    ApplyBrandKitRequest,
    AssetResponse,
    BrandKitCreate,
    BrandKitExport,
    BrandKitResponse,
    BrandKitUpdate,
    ColorContrastRequest,
    ColorContrastResponse,
    ColorPaletteRequest,
    ColorPaletteResponse,
    FontInfo,
    FontPairingsResponse,
    ThemeCreate,
    ThemeResponse,
    ThemeUpdate,
)
from backend.app.services.ai_services import design_service

logger = logging.getLogger("neura.api.design")

design_router = APIRouter(tags=["design"], dependencies=[Depends(require_api_key)])

def _handle_design_error(exc: Exception, operation: str) -> HTTPException:
    """Map design service errors to HTTP status codes."""
    logger.error("%s failed: %s", operation, exc, exc_info=True)
    return HTTPException(
        status_code=500,
        detail=f"{operation} failed due to an internal error.",
    )

# Brand Kit endpoints

@design_router.post("/brand-kits", response_model=BrandKitResponse)
async def create_brand_kit(request: BrandKitCreate):
    """Create a new brand kit."""
    try:
        return await design_service.create_brand_kit(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit creation") from exc

@design_router.get("/brand-kits", response_model=list[BrandKitResponse])
async def list_brand_kits(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List all brand kits."""
    try:
        all_kits = await design_service.list_brand_kits()
        return all_kits[offset:offset + limit]
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit listing") from exc

@design_router.get("/brand-kits/{kit_id}", response_model=BrandKitResponse)
async def get_brand_kit(kit_id: str):
    """Get a brand kit by ID."""
    try:
        kit = await design_service.get_brand_kit(kit_id)
        if not kit:
            raise HTTPException(status_code=404, detail="Brand kit not found")
        return kit
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit retrieval") from exc

@design_router.put("/brand-kits/{kit_id}", response_model=BrandKitResponse)
async def update_brand_kit(kit_id: str, request: BrandKitUpdate):
    """Update a brand kit."""
    try:
        kit = await design_service.update_brand_kit(kit_id, request)
        if not kit:
            raise HTTPException(status_code=404, detail="Brand kit not found")
        return kit
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit update") from exc

@design_router.delete("/brand-kits/{kit_id}")
async def delete_brand_kit(kit_id: str):
    """Delete a brand kit."""
    try:
        deleted = await design_service.delete_brand_kit(kit_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Brand kit not found")
        return {"status": "deleted", "id": kit_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit deletion") from exc

@design_router.post("/brand-kits/{kit_id}/set-default", response_model=BrandKitResponse)
async def set_default_brand_kit(kit_id: str):
    """Set a brand kit as the default."""
    try:
        kit = await design_service.set_default_brand_kit(kit_id)
        if not kit:
            raise HTTPException(status_code=404, detail="Brand kit not found")
        return kit
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Set default brand kit") from exc

@design_router.post("/brand-kits/{kit_id}/apply")
async def apply_brand_kit(kit_id: str, request: ApplyBrandKitRequest):
    """Apply brand kit to a document."""
    try:
        result = await design_service.apply_brand_kit(
            kit_id=kit_id,
            document_id=request.document_id,
            elements=request.elements,
        )
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Apply brand kit") from exc

# Color palette endpoints

@design_router.post("/color-palette", response_model=ColorPaletteResponse)
@limiter.limit(RATE_LIMIT_STRICT)
async def generate_color_palette(request: Request, req: ColorPaletteRequest):
    """Generate a color palette based on color harmony."""
    try:
        result = await asyncio.to_thread(
            design_service.generate_color_palette,
            base_color=req.base_color,
            harmony_type=req.harmony_type,
            count=req.count,
        )
        return JSONResponse(content=result.model_dump() if hasattr(result, 'model_dump') else result)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Color palette generation") from exc

# Theme endpoints

@design_router.post("/themes", response_model=ThemeResponse)
async def create_theme(request: ThemeCreate):
    """Create a new theme."""
    try:
        return await design_service.create_theme(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme creation") from exc

@design_router.get("/themes", response_model=list[ThemeResponse])
async def list_themes(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List all themes."""
    try:
        all_themes = await design_service.list_themes()
        return all_themes[offset:offset + limit]
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme listing") from exc

@design_router.get("/themes/{theme_id}", response_model=ThemeResponse)
async def get_theme(theme_id: str):
    """Get a theme by ID."""
    try:
        theme = await design_service.get_theme(theme_id)
        if not theme:
            raise HTTPException(status_code=404, detail="Theme not found")
        return theme
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme retrieval") from exc

@design_router.put("/themes/{theme_id}", response_model=ThemeResponse)
async def update_theme(theme_id: str, request: ThemeUpdate):
    """Update a theme."""
    try:
        theme = await design_service.update_theme(theme_id, request)
        if not theme:
            raise HTTPException(status_code=404, detail="Theme not found")
        return theme
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme update") from exc

@design_router.delete("/themes/{theme_id}")
async def delete_theme(theme_id: str):
    """Delete a theme."""
    try:
        deleted = await design_service.delete_theme(theme_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Theme not found")
        return {"status": "deleted", "id": theme_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme deletion") from exc

@design_router.post("/themes/{theme_id}/activate", response_model=ThemeResponse)
async def activate_theme(theme_id: str):
    """Set a theme as the active theme."""
    try:
        theme = await design_service.set_active_theme(theme_id)
        if not theme:
            raise HTTPException(status_code=404, detail="Theme not found")
        return theme
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Theme activation") from exc

# Color utility endpoints

@design_router.post("/colors/contrast", response_model=ColorContrastResponse)
@limiter.limit(RATE_LIMIT_STRICT)
async def get_color_contrast(request: Request, req: ColorContrastRequest):
    """Compute WCAG contrast ratio between two colors."""
    try:
        result = await asyncio.to_thread(
            design_service.get_color_contrast,
            color1=req.color1,
            color2=req.color2,
        )
        return JSONResponse(content=result.model_dump() if hasattr(result, 'model_dump') else result)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Color contrast check") from exc

@design_router.post("/colors/accessible", response_model=AccessibleColorsResponse)
@limiter.limit(RATE_LIMIT_STRICT)
async def suggest_accessible_colors(request: Request, req: AccessibleColorsRequest):
    """Suggest accessible text colors for a given background."""
    try:
        result = await asyncio.to_thread(
            design_service.suggest_accessible_colors,
            background_color=req.background_color,
        )
        return JSONResponse(content=result.model_dump() if hasattr(result, 'model_dump') else result)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Accessible color suggestion") from exc

# Typography endpoints

@design_router.get("/fonts", response_model=list[FontInfo])
async def list_fonts():
    """List available fonts."""
    try:
        return await asyncio.to_thread(design_service.list_fonts)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Font listing") from exc

@design_router.get("/fonts/pairings", response_model=FontPairingsResponse)
async def get_font_pairings(primary: str = Query(..., description="Primary font name")):
    """Get font pairing suggestions for a primary font."""
    try:
        return await asyncio.to_thread(
            design_service.get_font_pairings,
            primary_font=primary,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Font pairing suggestion") from exc

# Asset endpoints

@design_router.post("/assets/logo", response_model=AssetResponse)
async def upload_logo(
    file: UploadFile = File(...),
    brand_kit_id: str = Form(...),
):
    """Upload a logo asset for a brand kit."""
    try:
        MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5MB
        content = await file.read()
        if len(content) > MAX_LOGO_SIZE:
            raise HTTPException(status_code=413, detail="Logo file too large (max 5MB)")
        return await design_service.upload_logo(
            filename=file.filename or "logo",
            content=content,
            brand_kit_id=brand_kit_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Logo upload") from exc

@design_router.get("/brand-kits/{kit_id}/assets", response_model=list[AssetResponse])
async def list_assets(kit_id: str):
    """List assets for a brand kit."""
    try:
        return await design_service.list_assets(kit_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Asset listing") from exc

@design_router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str):
    """Delete a design asset."""
    try:
        deleted = await design_service.delete_asset(asset_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Asset not found")
        return {"status": "deleted", "id": asset_id}
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Asset deletion") from exc

# Import / Export endpoints

@design_router.get("/brand-kits/{kit_id}/export", response_model=BrandKitExport)
async def export_brand_kit(kit_id: str, format: str = Query("json")):
    """Export a brand kit."""
    try:
        result = await design_service.export_brand_kit(kit_id, fmt=format)
        if not result:
            raise HTTPException(status_code=404, detail="Brand kit not found")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit export") from exc

@design_router.post("/brand-kits/import", response_model=BrandKitResponse)
async def import_brand_kit(data: dict):
    """Import a brand kit from exported data."""
    try:
        return await design_service.import_brand_kit(data)
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_design_error(exc, "Brand kit import") from exc

@design_router.get("/brand-kits/{kit_id}/css")
async def get_brand_kit_css(kit_id: str):
    """Return the injectable CSS block for a brand kit.

    Useful for live previews - inject this ``<style>`` into an iframe to
    see how a template looks with the brand kit applied.
    """
    css = design_service.generate_brand_css_from_id(kit_id)
    if css is None:
        raise HTTPException(status_code=404, detail="Brand kit not found")
    return JSONResponse(content={"css": css})

@design_router.get("/brand-kits/default/css")
async def get_default_brand_kit_css():
    """Return CSS for the default brand kit (if one is set)."""
    # Ensure kits are loaded from state
    await design_service.list_brand_kits()
    css = design_service.get_default_brand_css()
    if css is None:
        return JSONResponse(content={"css": None})
    return JSONResponse(content={"css": css})

"""Excel Template API Routes.

This module contains endpoints for Excel template operations:
- Excel template verification
- Excel mapping operations
- Excel report generation
- Excel artifacts
"""

import contextlib
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from backend.app.schemas import (
    ChartSuggestPayload,
    SavedChartCreatePayload,
    SavedChartUpdatePayload,
)
from backend.app.schemas import RunPayload, DiscoverPayload
from backend.app.services.platform_services import suggest_charts as suggest_charts_service
from backend.app.services.platform_services import (
    create_saved_chart as create_saved_chart_service,
    delete_saved_chart as delete_saved_chart_service,
    list_saved_charts as list_saved_charts_service,
    update_saved_chart as update_saved_chart_service,
)
from backend.app.services.config import (
    enqueue_background_job,
    iter_ndjson_events_async,
    run_event_stream_async,
)
from backend.app.services.contract_builder import load_contract_v2
from backend.app.services.ai_services import (
    CHART_SUGGEST_PROMPT_VERSION,
    build_chart_suggestions_prompt,
)
from backend.app.services.reports import discover_batches_and_counts as discover_batches_and_counts_excel
from backend.app.services.reports import (
    build_batch_field_catalog_and_stats,
    build_batch_metrics,
)
import backend.app.services.config as state_access
from backend.app.services.templates import get_openai_client
from backend.app.services.infra_services import call_chat_completion, get_correlation_id, strip_code_fences

from backend.app.services.legacy_services import verify_excel, generator_assets
from backend.app.services.legacy_services import run_mapping_approve
from backend.app.services.legacy_services import run_corrections_preview
from backend.app.services.legacy_services import mapping_key_options as mapping_key_options_service
from backend.app.services.legacy_services import run_mapping_preview
from backend.app.services.legacy_services import artifact_head_response, artifact_manifest_response
from backend.app.services.legacy_services import queue_report_job, run_report as run_report_service
from backend.app.services.legacy_services import CorrectionsPreviewPayload, GeneratorAssetsPayload, MappingPayload
from backend.app.services.legacy_services import db_path_from_payload_or_default
from backend.app.services.legacy_services import clean_key_values
from backend.app.services.legacy_services import normalize_template_id, template_dir

logger = logging.getLogger("neura.api.excel")

excel_router = APIRouter(dependencies=[Depends(require_api_key)])

MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB

def _correlation(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)

def _request_with_correlation(correlation_id: str | None) -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(correlation_id=correlation_id))

def _wrap(payload: dict, correlation_id: str | None) -> dict:
    payload = dict(payload)
    if correlation_id is not None:
        payload["correlation_id"] = correlation_id
    return payload

def _ensure_template_exists(template_id: str) -> tuple[str, dict]:
    normalized = normalize_template_id(template_id)
    record = state_access.get_template_record(normalized)
    if not record:
        raise HTTPException(status_code=404, detail="template_not_found")
    return normalized, record

async def _persist_upload(file: UploadFile, suffix: str) -> tuple[Path, str]:
    filename = Path(file.filename or f"upload{suffix}").name
    tmp = tempfile.NamedTemporaryFile(prefix="nr-upload-", suffix=suffix, delete=False)
    tmp_path = Path(tmp.name)
    try:
        total_bytes = 0
        with tmp:
            file.file.seek(0)
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds maximum upload size of {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB",
                    )
                tmp.write(chunk)
    except HTTPException:
        # Clean up temp file on size rejection
        with contextlib.suppress(FileNotFoundError):
            tmp_path.unlink(missing_ok=True)
        raise
    except Exception:
        # Clean up temp file on any failure
        with contextlib.suppress(FileNotFoundError):
            tmp_path.unlink(missing_ok=True)
        raise
    finally:
        with contextlib.suppress(Exception):
            await file.close()
    return tmp_path, filename

# Excel Template Verification

@excel_router.post("/verify")
async def verify_excel_route(
    request: Request,
    file: UploadFile = File(...),
    connection_id: str | None = Form(None),
    background: bool = Query(False),
):
    """Verify and process an Excel template."""
    if not background:
        return verify_excel(file=file, request=request, connection_id=connection_id)

    upload_path, filename = await _persist_upload(file, suffix=".xlsx")
    correlation_id = _correlation(request)
    template_name = Path(filename).stem or filename

    async def runner(job_id: str) -> None:
        upload = UploadFile(filename=filename, file=upload_path.open("rb"))
        try:
            response = verify_excel(
                file=upload,
                request=_request_with_correlation(correlation_id),
                connection_id=connection_id,
            )
            await run_event_stream_async(job_id, iter_ndjson_events_async(response.body_iterator))
        finally:
            with contextlib.suppress(Exception):
                await upload.close()
            with contextlib.suppress(FileNotFoundError):
                upload_path.unlink(missing_ok=True)

    job = await enqueue_background_job(
        job_type="verify_excel",
        connection_id=connection_id,
        template_name=template_name,
        template_kind="excel",
        meta={"filename": filename, "background": True},
        runner=runner,
    )
    return {"status": "queued", "job_id": job["id"], "correlation_id": correlation_id}

# Excel Mapping Operations

@excel_router.post("/{template_id}/mapping/preview")
async def mapping_preview_excel(template_id: str, connection_id: str, request: Request, force_refresh: bool = False):
    """Preview mapping for an Excel template."""
    return await run_mapping_preview(template_id, connection_id, request, force_refresh, kind="excel")

@excel_router.post("/{template_id}/mapping/approve")
async def mapping_approve_excel(template_id: str, payload: MappingPayload, request: Request):
    """Approve mapping for an Excel template."""
    return await run_mapping_approve(template_id, payload, request, kind="excel")

@excel_router.post("/{template_id}/mapping/corrections-preview")
def mapping_corrections_preview_excel(template_id: str, payload: CorrectionsPreviewPayload, request: Request):
    """Preview corrections for Excel template mapping."""
    return run_corrections_preview(template_id, payload, request, kind="excel")

# Excel Generator Assets

@excel_router.post("/{template_id}/generator-assets/v1")
def generator_assets_excel_route(template_id: str, payload: GeneratorAssetsPayload, request: Request):
    """Generate assets for an Excel template."""
    return generator_assets(template_id, payload, request, kind="excel")

# Excel Key Options

@excel_router.get("/{template_id}/keys/options")
def mapping_key_options_excel(
    template_id: str,
    request: Request,
    connection_id: str | None = None,
    tokens: str | None = None,
    limit: int = Query(500, ge=1, le=5000),
    start_date: str | None = None,
    end_date: str | None = None,
    debug: bool = False,
):
    """Get available key options for Excel template filtering."""
    return mapping_key_options_service(
        template_id=template_id,
        request=request,
        connection_id=connection_id,
        tokens=tokens,
        limit=limit,
        start_date=start_date,
        end_date=end_date,
        kind="excel",
        debug=debug,
    )

# Excel Artifacts

@excel_router.get("/{template_id}/artifacts/manifest")
def get_artifact_manifest_excel(template_id: str, request: Request):
    """Get the artifact manifest for an Excel template."""
    data = artifact_manifest_response(template_id, kind="excel")
    return _wrap(data, _correlation(request))

@excel_router.get("/{template_id}/artifacts/head")
def get_artifact_head_excel(template_id: str, request: Request, name: str):
    """Get the head (preview) of a specific artifact."""
    data = artifact_head_response(template_id, name, kind="excel")
    return _wrap(data, _correlation(request))

# Charts

@excel_router.post("/{template_id}/charts/suggest")
def suggest_charts_excel_route(template_id: str, payload: ChartSuggestPayload, request: Request):
    """Get chart suggestions for an Excel template."""
    correlation_id = _correlation(request) or get_correlation_id()
    logger = logging.getLogger("neura.api")
    return suggest_charts_service(
        template_id,
        payload,
        kind="excel",
        correlation_id=correlation_id,
        template_dir_fn=lambda tpl: template_dir(tpl, kind="excel"),
        db_path_fn=db_path_from_payload_or_default,
        load_contract_fn=load_contract_v2,
        clean_key_values_fn=clean_key_values,
        discover_fn=discover_batches_and_counts_excel,
        build_field_catalog_fn=build_batch_field_catalog_and_stats,
        build_metrics_fn=build_batch_metrics,
        build_prompt_fn=build_chart_suggestions_prompt,
        call_chat_completion_fn=lambda **kwargs: call_chat_completion(
            get_openai_client(), **kwargs, description=CHART_SUGGEST_PROMPT_VERSION
        ),
        model=get_model(),
        strip_code_fences_fn=strip_code_fences,
        logger=logger,
    )

@excel_router.get("/{template_id}/charts/saved")
def list_saved_charts_excel_route(template_id: str, request: Request):
    """List saved charts for an Excel template."""
    payload = list_saved_charts_service(template_id, _ensure_template_exists)
    return _wrap(payload, _correlation(request))

@excel_router.post("/{template_id}/charts/saved")
def create_saved_chart_excel_route(
    template_id: str,
    payload: SavedChartCreatePayload,
    request: Request,
):
    """Create a saved chart for an Excel template."""
    chart = create_saved_chart_service(
        template_id,
        payload,
        ensure_template_exists=_ensure_template_exists,
        normalize_template_id=normalize_template_id,
    )
    chart_payload = chart.model_dump(mode="json") if hasattr(chart, "model_dump") else chart
    return _wrap(chart_payload, _correlation(request))

@excel_router.put("/{template_id}/charts/saved/{chart_id}")
def update_saved_chart_excel_route(
    template_id: str,
    chart_id: str,
    payload: SavedChartUpdatePayload,
    request: Request,
):
    """Update a saved chart for an Excel template."""
    chart = update_saved_chart_service(template_id, chart_id, payload, _ensure_template_exists)
    chart_payload = chart.model_dump(mode="json") if hasattr(chart, "model_dump") else chart
    return _wrap(chart_payload, _correlation(request))

@excel_router.delete("/{template_id}/charts/saved/{chart_id}")
def delete_saved_chart_excel_route(
    template_id: str,
    chart_id: str,
    request: Request,
):
    """Delete a saved chart for an Excel template."""
    payload = delete_saved_chart_service(template_id, chart_id, _ensure_template_exists)
    return _wrap(payload, _correlation(request))

# Excel Report Generation

@excel_router.post("/reports/run")
def run_report_excel(payload: RunPayload, request: Request):
    """Run an Excel report synchronously."""
    # C1: docx output is not supported
    if payload.docx:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "code": "unsupported_format",
                "message": "DOCX output is not supported. Use PDF or XLSX output instead.",
            },
        )
    # H1: validate connection_id exists
    if payload.connection_id:
        conn = state_access.get_connection_record(payload.connection_id)
        if not conn:
            raise HTTPException(
                status_code=404,
                detail={
                    "status": "error",
                    "code": "connection_not_found",
                    "message": f"Connection '{payload.connection_id}' not found.",
                },
            )
    # M4: validate date range
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(
            status_code=422,
            detail={
                "status": "error",
                "code": "invalid_date_range",
                "message": "start_date must be before or equal to end_date.",
            },
        )
    return run_report_service(payload, request, kind="excel")

@excel_router.post("/jobs/run-report")
async def enqueue_report_job_excel(payload: RunPayload | list[RunPayload], request: Request):
    """Queue an Excel report job for async generation."""
    return await queue_report_job(payload, request, kind="excel")

# Excel Report Discovery

@excel_router.post("/reports/discover")
def discover_reports_excel(payload: DiscoverPayload, request: Request):
    """Discover available batches for Excel report generation."""
    from backend.app.services.platform_services import discover_reports as discover_reports_service
    from backend.app.services.infra_services import load_manifest
    from backend.app.services.legacy_services import manifest_endpoint

    logger = logging.getLogger("neura.api")
    return discover_reports_service(
        payload,
        kind="excel",
        template_dir_fn=lambda tpl: template_dir(tpl, kind="excel"),
        db_path_fn=db_path_from_payload_or_default,
        load_contract_fn=load_contract_v2,
        clean_key_values_fn=clean_key_values,
        discover_fn=discover_batches_and_counts_excel,
        build_field_catalog_fn=build_batch_field_catalog_and_stats,
        build_batch_metrics_fn=build_batch_metrics,
        load_manifest_fn=load_manifest,
        manifest_endpoint_fn=lambda tpl: manifest_endpoint(tpl, kind="excel"),
        logger=logger,
    )

"""Knowledge Management API Routes.

REST API endpoints for document library and knowledge management.
"""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field, ValidationError

from backend.app.services.config import enqueue_background_job
from backend.app.schemas import (
    AutoTagRequest,
    CollectionCreate,
    CollectionResponse,
    CollectionUpdate,
    DocumentType,
    FAQGenerateRequest,
    KnowledgeGraphRequest,
    KnowledgeGraphResponse,
    LibraryDocumentCreate,
    LibraryDocumentResponse,
    LibraryDocumentUpdate,
    RelatedDocumentsRequest,
    RelatedDocumentsResponse,
    SearchRequest,
    SearchResponse,
    SemanticSearchRequest,
    TagCreate,
    TagResponse,
)
from backend.app.services.knowledge_service import knowledge_service
from backend.app.utils import sanitize_filename

logger = logging.getLogger("neura.api.knowledge")

knowledge_router = APIRouter(tags=["knowledge"], dependencies=[Depends(require_api_key)])

_DOCUMENT_TYPE_BY_EXTENSION: dict[str, DocumentType] = {
    ".pdf": DocumentType.PDF,
    ".docx": DocumentType.DOCX,
    ".doc": DocumentType.DOCX,
    ".xlsx": DocumentType.XLSX,
    ".xls": DocumentType.XLSX,
    ".pptx": DocumentType.PPTX,
    ".txt": DocumentType.TXT,
    ".md": DocumentType.MD,
    ".markdown": DocumentType.MD,
    ".html": DocumentType.HTML,
    ".htm": DocumentType.HTML,
    ".png": DocumentType.IMAGE,
    ".jpg": DocumentType.IMAGE,
    ".jpeg": DocumentType.IMAGE,
    ".gif": DocumentType.IMAGE,
    ".webp": DocumentType.IMAGE,
}

def _split_csv(value: Optional[str]) -> list[str]:
    if not value:
        return []
    parts = [item.strip() for item in str(value).split(",")]
    return [item for item in parts if item]

def _infer_document_type(filename: Optional[str], explicit: Optional[DocumentType]) -> DocumentType:
    if explicit is not None:
        return explicit
    suffix = Path(filename or "").suffix.lower()
    return _DOCUMENT_TYPE_BY_EXTENSION.get(suffix, DocumentType.OTHER)

def _parse_metadata_json(metadata: Optional[str]) -> dict:
    if not metadata:
        return {}
    try:
        parsed = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="metadata must be valid JSON",
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="metadata must be a JSON object",
        )
    return parsed

async def _persist_upload(file: UploadFile) -> tuple[str, str, int]:
    settings = get_settings()
    uploads_root = settings.uploads_root / "knowledge"
    uploads_root.mkdir(parents=True, exist_ok=True)

    safe_original = sanitize_filename(Path(file.filename or "document").name) or "document"
    suffix = Path(safe_original).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}" if suffix else uuid.uuid4().hex
    target_path = uploads_root / stored_name

    size = 0
    with target_path.open("wb") as fh:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            fh.write(chunk)

    return str(target_path), f"/uploads/knowledge/{stored_name}", size

# Document endpoints

@knowledge_router.post("/documents", response_model=LibraryDocumentResponse)
async def add_document(
    request: Request,
):
    """Add a document to the library.

    Supports either:
    - JSON body (`LibraryDocumentCreate`)
    - Multipart upload (`file` + optional metadata fields)
    """
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in content_type:
        try:
            payload = await request.json()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid JSON body for knowledge document",
            ) from exc
        try:
            create_payload = LibraryDocumentCreate.model_validate(payload)
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=exc.errors(),
            ) from exc
        return await knowledge_service.add_document(create_payload)

    form = await request.form()
    uploaded = form.get("file")
    if uploaded is None or not hasattr(uploaded, "read"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="multipart upload requires a file field named 'file'",
        )
    file = uploaded

    title = form.get("title")
    description = form.get("description")
    tags = form.get("tags")
    collection_id = form.get("collection_id")
    collections = form.get("collections")
    metadata = form.get("metadata")
    document_type_raw = form.get("document_type")
    explicit_document_type = None
    if document_type_raw:
        try:
            explicit_document_type = DocumentType(str(document_type_raw))
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unsupported document_type: {document_type_raw}",
            ) from exc

    file_path, file_url, file_size = await _persist_upload(file)
    parsed_collections = _split_csv(collections)
    if collection_id:
        parsed_collections.append(collection_id)
    parsed_collections = list(dict.fromkeys(parsed_collections))

    metadata_payload = _parse_metadata_json(metadata)
    metadata_payload.setdefault("original_filename", Path(file.filename or "document").name)
    metadata_payload.setdefault("uploaded_size_bytes", file_size)
    metadata_payload.setdefault("upload_source", "knowledge_multipart")

    derived_title = title or Path(file.filename or "document").stem or "Untitled document"
    create_payload = LibraryDocumentCreate(
        title=derived_title,
        description=description,
        file_path=file_path,
        file_url=file_url,
        document_type=_infer_document_type(file.filename, explicit_document_type),
        tags=_split_csv(tags),
        collections=parsed_collections,
        metadata=metadata_payload,
    )
    return await knowledge_service.add_document(create_payload)

@knowledge_router.get("/documents")
async def list_documents(
    collection_id: Optional[str] = None,
    tags: Optional[str] = Query(None, description="Comma-separated tag names"),
    document_type: Optional[DocumentType] = None,
    query: Optional[str] = Query(None, description="Search query to filter by title"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List documents with optional filtering."""
    tag_list = tags.split(",") if tags else None
    docs, total = await knowledge_service.list_documents(
        collection_id=collection_id,
        tags=tag_list,
        document_type=document_type,
        limit=limit,
        offset=offset,
    )
    if query:
        q_lower = query.lower()
        docs = [d for d in docs if q_lower in (d.title or "").lower()]
        total = len(docs)
    return {"documents": docs, "total": total, "limit": limit, "offset": offset}

@knowledge_router.get("/documents/{doc_id}", response_model=LibraryDocumentResponse)
async def get_document(doc_id: str):
    """Get a document by ID."""
    doc = await knowledge_service.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@knowledge_router.put("/documents/{doc_id}", response_model=LibraryDocumentResponse)
async def update_document(doc_id: str, request: LibraryDocumentUpdate):
    """Update a document."""
    doc = await knowledge_service.update_document(doc_id, request)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@knowledge_router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str):
    """Delete a document from the library."""
    deleted = await knowledge_service.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "deleted", "id": doc_id}

@knowledge_router.post("/documents/{doc_id}/favorite")
async def toggle_favorite(doc_id: str):
    """Toggle favorite status for a document."""
    is_favorite = await knowledge_service.toggle_favorite(doc_id)
    return {"document_id": doc_id, "is_favorite": is_favorite}

# Collection endpoints

@knowledge_router.post("/collections", response_model=CollectionResponse)
async def create_collection(request: CollectionCreate):
    """Create a new collection."""
    return await knowledge_service.create_collection(request)

@knowledge_router.get("/collections", response_model=list[CollectionResponse])
async def list_collections():
    """List all collections."""
    return await knowledge_service.list_collections()

@knowledge_router.get("/collections/{coll_id}", response_model=CollectionResponse)
async def get_collection(coll_id: str):
    """Get a collection by ID."""
    coll = await knowledge_service.get_collection(coll_id)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    return coll

@knowledge_router.put("/collections/{coll_id}", response_model=CollectionResponse)
async def update_collection(coll_id: str, request: CollectionUpdate):
    """Update a collection."""
    coll = await knowledge_service.update_collection(coll_id, request)
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found")
    return coll

@knowledge_router.delete("/collections/{coll_id}")
async def delete_collection(coll_id: str):
    """Delete a collection."""
    deleted = await knowledge_service.delete_collection(coll_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"status": "deleted", "id": coll_id}

# Tag endpoints

@knowledge_router.post("/tags", response_model=TagResponse)
async def create_tag(request: TagCreate):
    """Create a new tag."""
    return await knowledge_service.create_tag(request)

@knowledge_router.get("/tags", response_model=list[TagResponse])
async def list_tags():
    """List all tags."""
    return await knowledge_service.list_tags()

@knowledge_router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str):
    """Delete a tag."""
    deleted = await knowledge_service.delete_tag(tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"status": "deleted", "id": tag_id}

# Search endpoints

@knowledge_router.post("/search", response_model=SearchResponse)
async def search_documents(request: SearchRequest):
    """Full-text search across documents."""
    return await knowledge_service.search(
        query=request.query,
        document_types=request.document_types,
        tags=request.tags,
        collections=request.collections,
        limit=request.limit,
        offset=request.offset,
    )

@knowledge_router.get("/search", response_model=SearchResponse)
async def search_documents_get(
    query: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Full-text search (GET endpoint)."""
    return await knowledge_service.search(
        query=query,
        limit=limit,
        offset=offset,
    )

@knowledge_router.post("/search/semantic", response_model=SearchResponse)
async def semantic_search(request: SemanticSearchRequest):
    """Semantic search using embeddings."""
    return await knowledge_service.semantic_search(
        query=request.query,
        document_ids=request.document_ids,
        top_k=request.top_k,
        threshold=request.threshold,
    )

# AI-powered endpoints

@knowledge_router.post("/auto-tag")
async def auto_tag_document(request: AutoTagRequest):
    """Auto-suggest tags for a document."""
    return await knowledge_service.auto_tag(
        doc_id=request.document_id,
        max_tags=request.max_tags,
    )

@knowledge_router.post("/related", response_model=RelatedDocumentsResponse)
async def find_related_documents(request: RelatedDocumentsRequest):
    """Find documents related to a given document."""
    return await knowledge_service.find_related(
        doc_id=request.document_id,
        limit=request.limit,
    )

@knowledge_router.post("/knowledge-graph", response_model=KnowledgeGraphResponse)
async def build_knowledge_graph(request: KnowledgeGraphRequest):
    """Build a knowledge graph from documents."""
    return await knowledge_service.build_knowledge_graph(
        document_ids=request.document_ids,
        depth=request.depth,
    )

@knowledge_router.post("/faq")
async def generate_faq(
    payload: FAQGenerateRequest,
    request: Request,
    background: bool = Query(True),
):
    """Generate FAQ from documents.

    By default runs as a background job so the UI can track progress.
    Pass ?background=false for synchronous response.
    """
    correlation_id = getattr(request.state, "correlation_id", None)

    if not background:
        result = await knowledge_service.generate_faq(
            document_ids=payload.document_ids,
            max_questions=payload.max_questions,
        )
        return {"status": "ok", "faq": result, "correlation_id": correlation_id}

    async def runner(job_id: str) -> None:
        state_access.record_job_start(job_id)
        state_access.record_job_step(
            job_id, "generate_faq", status="running", label="Generating FAQ"
        )
        try:
            result = await knowledge_service.generate_faq(
                document_ids=payload.document_ids,
                max_questions=payload.max_questions,
            )
            state_access.record_job_step(
                job_id, "generate_faq", status="succeeded", progress=100.0
            )
            state_access.record_job_completion(
                job_id,
                status="succeeded",
                result={"faq": result.model_dump() if hasattr(result, "model_dump") else result},
            )
        except Exception:
            logger.exception("faq_generate_failed", extra={"job_id": job_id})
            safe_msg = "FAQ generation failed"
            state_access.record_job_step(
                job_id, "generate_faq", status="failed", error=safe_msg
            )
            state_access.record_job_completion(job_id, status="failed", error=safe_msg)

    job = await enqueue_background_job(
        job_type="faq_generate",
        steps=[{"name": "generate_faq", "label": "Generating FAQ"}],
        meta={"document_count": len(payload.document_ids), "max_questions": payload.max_questions},
        runner=runner,
    )
    return {"status": "queued", "job_id": job["id"], "correlation_id": correlation_id}

# COLLECTION-DOCUMENT ASSOCIATION ENDPOINTS

class CollectionAddDocumentRequest(BaseModel):
    document_id: str = Field(..., description="ID of the document to add")

@knowledge_router.post("/collections/{coll_id}/documents")
async def add_document_to_collection(coll_id: str, request: CollectionAddDocumentRequest):
    """Add a document to a collection."""
    try:
        result = await knowledge_service.add_document_to_collection(
            collection_id=coll_id,
            document_id=request.document_id,
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Collection or document not found",
            )
        return {"status": "added", "collection_id": coll_id, "document_id": request.document_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to add document to collection: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add document to collection",
        )

@knowledge_router.delete("/collections/{coll_id}/documents/{doc_id}")
async def remove_document_from_collection(coll_id: str, doc_id: str):
    """Remove a document from a collection."""
    try:
        result = await knowledge_service.remove_document_from_collection(
            collection_id=coll_id,
            document_id=doc_id,
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Collection or document not found",
            )
        return {"status": "removed", "collection_id": coll_id, "document_id": doc_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to remove document from collection: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove document from collection",
        )

# DOCUMENT-TAG ASSOCIATION ENDPOINTS

class DocumentAddTagRequest(BaseModel):
    tag_id: str = Field(..., description="ID of the tag to add")

@knowledge_router.post("/documents/{doc_id}/tags")
async def add_tag_to_document(doc_id: str, request: DocumentAddTagRequest):
    """Add a tag to a document."""
    try:
        result = await knowledge_service.add_tag_to_document(
            document_id=doc_id,
            tag_id=request.tag_id,
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document or tag not found",
            )
        return {"status": "added", "document_id": doc_id, "tag_id": request.tag_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to add tag to document: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to add tag to document",
        )

@knowledge_router.delete("/documents/{doc_id}/tags/{tag_id}")
async def remove_tag_from_document(doc_id: str, tag_id: str):
    """Remove a tag from a document."""
    try:
        result = await knowledge_service.remove_tag_from_document(
            document_id=doc_id,
            tag_id=tag_id,
        )
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document or tag not found",
            )
        return {"status": "removed", "document_id": doc_id, "tag_id": tag_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to remove tag from document: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove tag from document",
        )

# LIBRARY STATISTICS & ACTIVITY ENDPOINTS

@knowledge_router.get("/stats")
async def get_library_stats():
    """Get library statistics including total documents, collections, tags, and storage usage."""
    try:
        get_stats = getattr(knowledge_service, "get_stats", None)
        if callable(get_stats):
            stats = await get_stats()
            return stats if isinstance(stats, dict) else stats.model_dump()

        logger.error("knowledge_service_missing_get_stats; using compatibility fallback")
        docs, _ = await knowledge_service.list_documents(limit=10000, offset=0)
        collections = await knowledge_service.list_collections()
        tags = await knowledge_service.list_tags()

        document_types: dict[str, int] = {}
        storage_used_bytes = 0
        total_favorites = 0
        for doc in docs:
            kind = doc.document_type.value if hasattr(doc.document_type, "value") else str(doc.document_type)
            document_types[kind] = document_types.get(kind, 0) + 1
            size = doc.file_size or 0
            if isinstance(size, int) and size > 0:
                storage_used_bytes += size
            if bool(getattr(doc, "is_favorite", False)):
                total_favorites += 1

        stats = {
            "total_documents": len(docs),
            "total_collections": len(collections),
            "total_tags": len(tags),
            "total_favorites": total_favorites,
            "storage_used_bytes": storage_used_bytes,
            "document_types": document_types,
        }
        return stats if isinstance(stats, dict) else stats.model_dump()
    except Exception as e:
        logger.exception("Failed to get library stats: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve library statistics",
        )

@knowledge_router.get("/documents/{doc_id}/activity")
async def get_document_activity(doc_id: str):
    """Get the activity log for a document."""
    try:
        activity = await knowledge_service.get_document_activity(doc_id)
        if activity is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document not found",
            )
        return activity if isinstance(activity, list) else [
            a if isinstance(a, dict) else a.model_dump() for a in activity
        ]
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get document activity: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve document activity",
        )

"""
Document Ingestion API Routes
Endpoints for importing documents from various sources.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status

from backend.app.services.ingestion_service import (
    ingestion_service,
    email_ingestion_service,
    web_clipper_service,
    folder_watcher_service,
    transcription_service,
)
from backend.app.services.ingestion_service import WatcherConfig
from backend.app.services.ingestion_service import TranscriptionLanguage

import ipaddress
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

def _validate_external_url(url: str) -> str:
    """Validate URL to prevent SSRF. Raises HTTPException if URL is unsafe."""
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only HTTP/HTTPS URLs are allowed")

    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL: no hostname")

    hostname = parsed.hostname.lower()

    # Block localhost and common internal hostnames
    blocked_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "metadata.google.internal"}
    if hostname in blocked_hosts:
        raise HTTPException(status_code=400, detail="URL points to a restricted address")

    # Resolve hostname and check for private IPs
    try:
        import socket
        resolved = socket.getaddrinfo(hostname, None)
        for _, _, _, _, addr in resolved:
            ip = ipaddress.ip_address(addr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise HTTPException(status_code=400, detail="URL points to a restricted address")
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve URL hostname")
    except HTTPException:
        raise
    except Exception:
        logger.warning("URL validation failed unexpectedly")
        raise HTTPException(status_code=400, detail="URL validation failed")

    return url

ingestion_router = APIRouter(dependencies=[Depends(require_api_key)])

# Maximum upload sizes
MAX_SINGLE_FILE_BYTES = 200 * 1024 * 1024  # 200 MB
MAX_BULK_TOTAL_BYTES = 500 * 1024 * 1024   # 500 MB total for bulk

# REQUEST/RESPONSE MODELS

class IngestUrlRequest(BaseModel):
    url: str = Field(..., description="URL to download and ingest")
    filename: Optional[str] = Field(default=None, description="Override filename")

class IngestStructuredDataRequest(BaseModel):
    filename: str = Field(..., description="File name with extension")
    content: str = Field(..., description="File content (JSON/XML/YAML)")
    format_hint: Optional[str] = Field(default=None, description="Format hint")

class ClipUrlRequest(BaseModel):
    url: str = Field(..., description="URL to clip")
    include_images: bool = Field(default=True, description="Include images")
    clean_content: bool = Field(default=True, description="Clean HTML")
    output_format: str = Field(default="html", description="Output format")

class ClipSelectionRequest(BaseModel):
    url: str = Field(..., description="Source URL")
    selected_html: str = Field(..., description="Selected HTML content")
    page_title: Optional[str] = Field(default=None, description="Page title")

class CreateWatcherRequest(BaseModel):
    path: str = Field(..., description="Folder path to watch")
    recursive: bool = Field(default=True, description="Watch subdirectories")
    patterns: List[str] = Field(default=["*"], description="File patterns to match")
    ignore_patterns: List[str] = Field(default_factory=list, description="Patterns to ignore")
    auto_import: bool = Field(default=True, description="Auto-import files")
    delete_after_import: bool = Field(default=False, description="Delete after import")
    target_collection: Optional[str] = Field(default=None, description="Target collection")
    tags: List[str] = Field(default_factory=list, description="Tags to apply")

class TranscribeRequest(BaseModel):
    language: str = Field(default="auto", description="Language code or 'auto'")
    include_timestamps: bool = Field(default=True, description="Include timestamps")
    diarize_speakers: bool = Field(default=False, description="Identify speakers")

class ImapConnectRequest(BaseModel):
    host: str = Field(..., description="IMAP server hostname")
    port: int = Field(default=993, description="IMAP server port")
    username: str = Field(..., description="Account username")
    password: str = Field(..., description="Account password")
    use_ssl: bool = Field(default=True, description="Use SSL/TLS")
    folder: str = Field(default="INBOX", description="Mailbox folder to monitor")

class EmailIngestRequest(BaseModel):
    include_attachments: bool = Field(default=True, description="Process attachments")

class GenerateInboxRequest(BaseModel):
    purpose: str = Field(default="default", description="Inbox purpose label")

# FILE INGESTION ENDPOINTS

@ingestion_router.post("/upload")
@limiter.limit(RATE_LIMIT_STRICT)
async def upload_file(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    auto_ocr: bool = Form(default=True),
    generate_preview: bool = Form(default=True),
    tags: str = Form(default=""),
    collection: str = Form(default=""),
):
    """
    Upload and ingest a file with auto-detection.

    Returns:
        IngestionResult with document details
    """
    try:
        content = await file.read()
        if len(content) > MAX_SINGLE_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds maximum size of {MAX_SINGLE_FILE_BYTES // (1024*1024)} MB",
            )
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        metadata = {}
        if tags:
            metadata["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
        if collection:
            metadata["collection"] = collection

        result = await ingestion_service.ingest_file(
            filename=file.filename or "upload",
            content=content,
            metadata=metadata,
            auto_ocr=auto_ocr,
            generate_preview=generate_preview,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Upload failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Upload failed",
        )

@ingestion_router.post("/upload/bulk")
@limiter.limit(RATE_LIMIT_STRICT)
async def upload_bulk(
    request: Request,
    response: Response,
    files: List[UploadFile] = File(...),
    tags: str = Form(default=""),
    collection: str = Form(default=""),
):
    """
    Upload multiple files at once.

    Returns:
        List of IngestionResults
    """
    results = []
    errors = []
    cumulative_bytes = 0

    metadata = {}
    if tags:
        metadata["tags"] = [t.strip() for t in tags.split(",")]
    if collection:
        metadata["collection"] = collection

    for file in files:
        try:
            content = await file.read()
            cumulative_bytes += len(content)
            if cumulative_bytes > MAX_BULK_TOTAL_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Bulk upload exceeds maximum total size of {MAX_BULK_TOTAL_BYTES // (1024*1024)} MB",
                )
            result = await ingestion_service.ingest_file(
                filename=file.filename or "upload",
                content=content,
                metadata=metadata,
            )
            results.append(result.model_dump())
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Bulk upload processing failed for %s: %s", file.filename, e)
            errors.append({"filename": file.filename, "error": "Processing failed"})

    return {
        "total": len(files),
        "successful": len(results),
        "failed": len(errors),
        "results": results,
        "errors": errors,
    }

@ingestion_router.post("/upload/zip")
@limiter.limit(RATE_LIMIT_STRICT)
async def upload_zip(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    preserve_structure: bool = Form(default=True),
    flatten: bool = Form(default=False),
):
    """
    Upload and extract a ZIP archive.

    Returns:
        BulkIngestionResult with all extracted documents
    """
    try:
        content = await file.read()
        if len(content) > MAX_SINGLE_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"ZIP file exceeds maximum size of {MAX_SINGLE_FILE_BYTES // (1024*1024)} MB",
            )
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded ZIP file is empty",
            )
        result = await ingestion_service.ingest_zip_archive(
            filename=file.filename or "archive.zip",
            content=content,
            preserve_structure=preserve_structure,
            flatten=flatten,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ZIP upload failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ZIP upload failed",
        )

@ingestion_router.post("/url")
async def ingest_from_url(request: IngestUrlRequest):
    """
    Download and ingest a file from a URL.

    Returns:
        IngestionResult with document details
    """
    try:
        _validate_external_url(request.url)
        result = await ingestion_service.ingest_from_url(
            url=request.url,
            filename=request.filename,
        )
        return result.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("URL ingestion failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="URL ingestion failed",
        )

@ingestion_router.post("/structured")
async def ingest_structured_data(request: IngestStructuredDataRequest):
    """
    Import structured data (JSON/XML/YAML) as an editable table.

    Returns:
        StructuredDataImport with table details
    """
    try:
        result = await ingestion_service.import_structured_data(
            filename=request.filename,
            content=request.content.encode("utf-8"),
            format_hint=request.format_hint,
        )
        return result.model_dump()
    except Exception as e:
        logger.exception("Structured data import failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Structured data import failed",
        )

# WEB CLIPPER ENDPOINTS

@ingestion_router.post("/clip/url")
async def clip_web_page(request: ClipUrlRequest):
    """
    Clip content from a web page.

    Returns:
        ClippedContent with extracted content
    """
    try:
        _validate_external_url(request.url)
        clipped = await web_clipper_service.clip_url(
            url=request.url,
            include_images=request.include_images,
            clean_content=request.clean_content,
        )

        # Save as document
        doc_id = await web_clipper_service.save_as_document(
            clipped=clipped,
            format=request.output_format,
        )

        result = clipped.model_dump()
        result["document_id"] = doc_id
        return result
    except Exception as e:
        logger.exception("Web clip failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Web clip failed",
        )

@ingestion_router.post("/clip/selection")
async def clip_selection(request: ClipSelectionRequest):
    """
    Clip a user-selected portion of a page.

    Returns:
        ClippedContent with selected content
    """
    try:
        _validate_external_url(request.url)
        clipped = await web_clipper_service.clip_selection(
            url=request.url,
            selected_html=request.selected_html,
            page_title=request.page_title,
        )

        doc_id = await web_clipper_service.save_as_document(clipped)

        result = clipped.model_dump()
        result["document_id"] = doc_id
        return result
    except Exception as e:
        logger.exception("Selection clip failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Selection clip failed",
        )

# FOLDER WATCHER ENDPOINTS

@ingestion_router.post("/watchers")
async def create_folder_watcher(request: CreateWatcherRequest):
    """
    Create a new folder watcher.

    Returns:
        WatcherStatus
    """
    import hashlib

    watcher_path = Path(request.path).resolve()
    if not str(watcher_path).startswith(str(Path.cwd())):
        raise HTTPException(status_code=400, detail="Watcher path must be within the application directory")

    watcher_id = hashlib.sha256(f"{request.path}:{datetime.now(timezone.utc).isoformat()}".encode()).hexdigest()[:12]

    config = WatcherConfig(
        watcher_id=watcher_id,
        path=request.path,
        recursive=request.recursive,
        patterns=request.patterns,
        ignore_patterns=request.ignore_patterns,
        auto_import=request.auto_import,
        delete_after_import=request.delete_after_import,
        target_collection=request.target_collection,
        tags=request.tags,
    )

    try:
        watcher_status = await folder_watcher_service.create_watcher(config)
        return watcher_status.model_dump()
    except Exception as e:
        logger.exception("Failed to create watcher: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create watcher",
        )

@ingestion_router.get("/watchers")
async def list_folder_watchers():
    """
    List all folder watchers.

    Returns:
        List of WatcherStatus
    """
    watchers = folder_watcher_service.list_watchers()
    return [w.model_dump() for w in watchers]

@ingestion_router.get("/watchers/{watcher_id}")
async def get_watcher_status(watcher_id: str):
    """
    Get status of a folder watcher.

    Returns:
        WatcherStatus
    """
    try:
        watcher_info = folder_watcher_service.get_status(watcher_id)
        return watcher_info.model_dump()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watcher not found")

@ingestion_router.post("/watchers/{watcher_id}/start")
async def start_watcher(watcher_id: str):
    """Start a folder watcher."""
    try:
        success = await folder_watcher_service.start_watcher(watcher_id)
        return {"success": success}
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watcher not found")

@ingestion_router.post("/watchers/{watcher_id}/stop")
async def stop_watcher(watcher_id: str):
    """Stop a folder watcher."""
    success = await folder_watcher_service.stop_watcher(watcher_id)
    return {"success": success}

@ingestion_router.post("/watchers/{watcher_id}/scan")
async def scan_watched_folder(watcher_id: str):
    """
    Manually scan a watched folder for existing files.

    Returns:
        List of FileEvents
    """
    try:
        events = await folder_watcher_service.scan_folder(watcher_id)
        return [e.model_dump() for e in events]
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Watcher not found")

@ingestion_router.delete("/watchers/{watcher_id}")
async def delete_watcher(watcher_id: str):
    """Delete a folder watcher."""
    success = await folder_watcher_service.delete_watcher(watcher_id)
    return {"success": success}

# TRANSCRIPTION ENDPOINTS

@ingestion_router.post("/transcribe")
@limiter.limit(RATE_LIMIT_STRICT)
async def transcribe_file(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form(default="auto"),
    include_timestamps: bool = Form(default=True),
    diarize_speakers: bool = Form(default=False),
    output_format: str = Form(default="html"),
):
    """
    Transcribe an audio or video file.

    Returns:
        TranscriptionResult with full transcript
    """
    try:
        content = await file.read()

        lang = TranscriptionLanguage(language) if language in [l.value for l in TranscriptionLanguage] else TranscriptionLanguage.AUTO

        result = await transcription_service.transcribe_file(
            filename=file.filename or "recording",
            content=content,
            language=lang,
            include_timestamps=include_timestamps,
            diarize_speakers=diarize_speakers,
        )

        # Create document
        doc_id = await transcription_service.create_document_from_transcription(
            result=result,
            format=output_format,
            include_timestamps=include_timestamps,
        )

        response = result.model_dump()
        response["document_id"] = doc_id
        return response
    except Exception as e:
        logger.exception("Transcription failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Transcription failed",
        )

@ingestion_router.post("/transcribe/voice-memo")
async def transcribe_voice_memo(
    file: UploadFile = File(...),
    extract_action_items: bool = Form(default=True),
    extract_key_points: bool = Form(default=True),
):
    """
    Transcribe a voice memo with intelligent extraction.

    Returns:
        VoiceMemoResult with transcript and extracted items
    """
    try:
        content = await file.read()

        result = await transcription_service.transcribe_voice_memo(
            filename=file.filename or "voice_memo",
            content=content,
            extract_action_items=extract_action_items,
            extract_key_points=extract_key_points,
        )
        return result.model_dump()
    except Exception as e:
        logger.exception("Voice memo transcription failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Voice memo transcription failed",
        )

@ingestion_router.get("/transcribe/{job_id}")
async def get_transcription_status(job_id: str):
    """
    Get the status of a transcription job.

    Returns:
        Job status, progress, and result when complete
    """
    job = state_access.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transcription job not found",
        )
    return {
        "job_id": job_id,
        "status": job.get("status"),
        "progress": job.get("progress"),
        "result": job.get("result"),
    }

# EMAIL IMAP ENDPOINTS

@ingestion_router.post("/email/imap/connect")
async def connect_imap_account(request: ImapConnectRequest):
    """
    Connect an IMAP email account.

    Tests the connection and stores the account configuration.

    Returns:
        Connection result with account ID
    """
    try:
        result = await email_ingestion_service.connect_imap(
            host=request.host,
            port=request.port,
            username=request.username,
            password=request.password,
            use_ssl=request.use_ssl,
            folder=request.folder,
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.exception("IMAP connection failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="IMAP connection failed",
        )

@ingestion_router.get("/email/imap/accounts")
async def list_imap_accounts():
    """
    List connected IMAP email accounts.

    Returns:
        List of connected IMAP accounts
    """
    try:
        accounts = email_ingestion_service.list_imap_accounts()
        return [a if isinstance(a, dict) else a.model_dump() for a in accounts]
    except Exception as e:
        logger.exception("Failed to list IMAP accounts: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list IMAP accounts",
        )

@ingestion_router.post("/email/imap/accounts/{account_id}/sync")
async def sync_imap_account(account_id: str):
    """
    Sync emails from an IMAP account.

    Triggers email synchronisation for the specified account.

    Returns:
        Sync job status
    """
    try:
        result = await email_ingestion_service.sync_imap_account(account_id)
        return result
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="IMAP account not found",
        )
    except Exception as e:
        logger.exception("IMAP sync failed for account %s: %s", account_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="IMAP sync failed",
        )

# EMAIL INGESTION ENDPOINTS

@ingestion_router.post("/email/inbox")
async def generate_inbox_address(request: GenerateInboxRequest, user_id: str = "default"):
    """
    Generate a unique email inbox address for forwarding.

    Returns:
        Email address for forwarding
    """
    address = email_ingestion_service.generate_inbox_address(
        user_id=user_id,
        purpose=request.purpose,
    )
    return {"inbox_address": address}

@ingestion_router.post("/email/ingest")
async def ingest_email(
    file: UploadFile = File(...),
    include_attachments: bool = Form(default=True),
):
    """
    Ingest a raw email file (.eml).

    Returns:
        EmailDocumentResult with created document
    """
    try:
        content = await file.read()

        result = await email_ingestion_service.convert_email_to_document(
            raw_email=content,
            include_attachments=include_attachments,
        )
        return result.model_dump()
    except Exception as e:
        logger.exception("Email ingestion failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email ingestion failed",
        )

@ingestion_router.post("/email/parse")
async def parse_email(
    file: UploadFile = File(...),
    extract_action_items: bool = Form(default=True),
):
    """
    Parse an email and extract structured data.

    Returns:
        Parsed email with action items and links
    """
    try:
        content = await file.read()

        result = await email_ingestion_service.parse_incoming_email(
            raw_email=content,
            extract_action_items=extract_action_items,
        )
        return result
    except Exception as e:
        logger.exception("Email parsing failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email parsing failed",
        )

# UTILITY ENDPOINTS

@ingestion_router.post("/detect-type")
async def detect_file_type(file: UploadFile = File(...)):
    """
    Detect the type of an uploaded file.

    Returns:
        Detected file type and metadata
    """
    content = await file.read()
    file_type = ingestion_service.detect_file_type(
        filename=file.filename or "unknown",
        content=content,
    )
    return {
        "filename": file.filename,
        "detected_type": file_type.value,
        "size_bytes": len(content),
    }

@ingestion_router.get("/supported-types")
async def list_supported_types():
    """
    List all supported file types for ingestion.

    Returns:
        List of supported file types
    """
    from backend.app.services.ingestion_service import FileType

    return {
        "file_types": [t.value for t in FileType if t != FileType.UNKNOWN],
        "transcription_languages": [l.value for l in TranscriptionLanguage],
    }

"""
Search & Discovery API Routes
Endpoints for full-text, semantic, and advanced search.
"""

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.services.ai_services import search_service
from backend.app.services.ai_services import SearchType, SearchFilter

logger = logging.getLogger(__name__)
search_router = APIRouter(dependencies=[Depends(require_api_key)])

# Regex validation to prevent ReDoS attacks
MAX_REGEX_LENGTH = 100
DANGEROUS_PATTERNS = [
    r"\(\?\#",  # Comments
    r"\(\?\<",  # Named groups (can be complex)
    r"\(\?\(",  # Conditional patterns
    r"\(\?P<",  # Python named groups
]

def validate_regex_pattern(pattern: str) -> tuple[bool, str]:
    """Validate a regex pattern to prevent ReDoS attacks.

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not pattern:
        return False, "Empty pattern"

    if len(pattern) > MAX_REGEX_LENGTH:
        return False, f"Pattern too long (max {MAX_REGEX_LENGTH} characters)"

    # Check for dangerous patterns that could cause exponential backtracking
    for dangerous in DANGEROUS_PATTERNS:
        if re.search(dangerous, pattern, re.IGNORECASE):
            return False, "Pattern contains unsupported constructs"

    # Check for nested quantifiers (common ReDoS pattern)
    if re.search(r"(\+|\*|\{[0-9,]+\})\s*(\+|\*|\?|\{[0-9,]+\})", pattern):
        return False, "Nested quantifiers not allowed"

    # Check for overlapping alternation with quantifiers
    if re.search(r"\([^)]*\|[^)]*\)[\+\*]", pattern):
        # Allow simple alternation but flag potentially dangerous ones
        pass

    # Try to compile the pattern with a timeout-safe test
    try:
        compiled = re.compile(pattern)
        # Test with a simple string to catch obvious issues
        compiled.search("test" * 10)
    except re.error as e:
        return False, "Invalid regex pattern"
    except Exception as e:
        return False, "Regex validation error"

    return True, ""

# REQUEST/RESPONSE MODELS

class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query")
    search_type: str = Field(default="fulltext", description="Search type")
    filters: List[Dict[str, Any]] = Field(default_factory=list, description="Filters")
    facet_fields: List[str] = Field(default_factory=list, description="Facet fields")
    page: int = Field(default=1, ge=1, description="Page number")
    page_size: int = Field(default=20, ge=1, le=100, description="Results per page")
    highlight: bool = Field(default=True, description="Highlight matches")
    typo_tolerance: bool = Field(default=True, description="Enable typo tolerance")

class IndexDocumentRequest(BaseModel):
    document_id: str = Field(..., description="Document ID")
    title: str = Field(..., description="Document title")
    content: str = Field(..., description="Document content")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Metadata")

class SearchReplaceRequest(BaseModel):
    search_query: str = Field(..., description="Text to search")
    replace_with: str = Field(..., description="Replacement text")
    document_ids: Optional[List[str]] = Field(default=None, description="Limit to documents")
    dry_run: bool = Field(default=True, description="Preview only")

class SaveSearchRequest(BaseModel):
    name: str = Field(..., description="Search name")
    query: str = Field(..., description="Search query")
    filters: List[Dict[str, Any]] = Field(default_factory=list, description="Filters")
    notify_on_new: bool = Field(default=False, description="Notify on new results")

# SEARCH ENDPOINTS

@search_router.get("/types")
async def get_search_types():
    """
    Get available search types.

    Returns:
        List of search types with descriptions
    """
    return {
        "types": [
            {"id": "fulltext", "name": "Full-Text", "description": "Standard keyword search with stemming"},
            {"id": "semantic", "name": "Semantic", "description": "AI-powered meaning-based search"},
            {"id": "fuzzy", "name": "Fuzzy", "description": "Tolerant search with typo handling"},
            {"id": "regex", "name": "Regex", "description": "Regular expression pattern matching"},
            {"id": "boolean", "name": "Boolean", "description": "AND/OR/NOT logical operators"},
        ]
    }

@search_router.post("/search")
async def search(request: SearchRequest):
    """
    Perform a search with various options.

    Returns:
        SearchResponse with results
    """
    try:
        search_type = SearchType(request.search_type) if request.search_type in [t.value for t in SearchType] else SearchType.FULLTEXT
        filters = [SearchFilter(**f) for f in request.filters]

        result = await search_service.search(
            query=request.query,
            search_type=search_type,
            filters=filters,
            facet_fields=request.facet_fields,
            page=request.page,
            page_size=request.page_size,
            highlight=request.highlight,
            typo_tolerance=request.typo_tolerance,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Search operation failed")

@search_router.post("/search/semantic")
async def semantic_search(request: SearchRequest):
    """
    Perform semantic similarity search.

    Returns:
        SearchResponse with semantically similar results
    """
    request.search_type = "semantic"
    return await search(request)

@search_router.post("/search/regex")
async def regex_search(request: SearchRequest):
    """
    Perform regex pattern search.

    Returns:
        SearchResponse with regex matches

    Raises:
        HTTPException 400: If regex pattern is invalid or potentially dangerous
    """
    # Validate regex pattern to prevent ReDoS attacks
    is_valid, error_msg = validate_regex_pattern(request.query)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid regex pattern: {error_msg}"
        )

    request.search_type = "regex"
    return await search(request)

@search_router.post("/search/boolean")
async def boolean_search(request: SearchRequest):
    """
    Perform boolean search with AND, OR, NOT operators.

    Returns:
        SearchResponse with boolean match results
    """
    request.search_type = "boolean"
    return await search(request)

@search_router.post("/search/replace")
async def search_and_replace(request: SearchReplaceRequest):
    """
    Search and replace across documents.

    Returns:
        Replacement results
    """
    try:
        result = await search_service.search_and_replace(
            search_query=request.search_query,
            replace_with=request.replace_with,
            document_ids=request.document_ids,
            dry_run=request.dry_run,
        )
        return result
    except Exception as e:
        logger.error(f"Search and replace failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Search operation failed")

@search_router.get("/documents/{document_id}/similar")
async def find_similar_documents(document_id: str, limit: int = 10):
    """
    Find documents similar to the given document.

    Returns:
        List of similar documents
    """
    try:
        results = await search_service.find_similar(document_id, limit)
        return [r.model_dump() for r in results]
    except Exception as e:
        logger.error(f"Find similar failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Search operation failed")

# INDEXING ENDPOINTS

@search_router.post("/index")
async def index_document(request: IndexDocumentRequest):
    """
    Index a document for searching.

    Returns:
        Success status
    """
    try:
        success = await search_service.index_document(
            document_id=request.document_id,
            title=request.title,
            content=request.content,
            metadata=request.metadata,
        )
        return {"success": success}
    except Exception as e:
        logger.error(f"Index failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Search operation failed")

@search_router.delete("/index/{document_id}")
async def remove_from_index(document_id: str):
    """
    Remove a document from the search index.

    Returns:
        Success status
    """
    success = await search_service.remove_from_index(document_id)
    return {"success": success}

@search_router.post("/index/reindex")
async def reindex_all():
    """
    Reindex all documents in the search index.

    Returns:
        Reindex job status
    """
    try:
        result = await search_service.reindex_all()
        return result if isinstance(result, dict) else result.model_dump()
    except Exception as e:
        logger.error(f"Reindex failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Reindex operation failed",
        )

# SAVED SEARCHES

@search_router.post("/saved-searches")
async def save_search(request: SaveSearchRequest):
    """
    Save a search for later use.

    Returns:
        SavedSearch configuration
    """
    try:
        filters = [SearchFilter(**f) for f in request.filters]
        result = await search_service.save_search(
            name=request.name,
            query=request.query,
            filters=filters,
            notify_on_new=request.notify_on_new,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Save search failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Search operation failed")

@search_router.get("/saved-searches")
async def list_saved_searches():
    """List all saved searches."""
    searches = search_service.list_saved_searches()
    return [s.model_dump() for s in searches]

@search_router.get("/saved-searches/{search_id}")
async def get_saved_search(search_id: str):
    """
    Get a single saved search by ID.

    Returns:
        SavedSearch configuration
    """
    try:
        saved = await search_service.get_saved_search(search_id)
        if not saved:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Saved search not found",
            )
        return saved.model_dump()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get saved search failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Search operation failed",
        )

@search_router.post("/saved-searches/{search_id}/run")
async def run_saved_search(search_id: str):
    """Run a saved search."""
    try:
        result = await search_service.run_saved_search(search_id)
        return result.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found")

@search_router.delete("/saved-searches/{search_id}")
async def delete_saved_search(search_id: str):
    """Delete a saved search."""
    success = search_service.delete_saved_search(search_id)
    return {"success": success}

# ANALYTICS

@search_router.get("/analytics")
async def get_search_analytics():
    """Get search analytics."""
    analytics = await search_service.get_search_analytics()
    return analytics.model_dump()

"""
Visualization & Diagrams API Routes
Endpoints for generating charts, diagrams, and visual representations.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from backend.app.services.ai_services import visualization_service
from backend.app.services.ai_services import (
    DiagramType, ChartType, TimelineEvent, GanttTask,
)

logger = logging.getLogger(__name__)
visualization_router = APIRouter(dependencies=[Depends(require_api_key)])

# REQUEST MODELS

class FlowchartRequest(BaseModel):
    description: str = Field(..., description="Process description")
    title: Optional[str] = Field(default=None, description="Flowchart title")

class MindmapRequest(BaseModel):
    content: str = Field(..., description="Document content")
    title: Optional[str] = Field(default=None, description="Central topic")
    max_depth: int = Field(default=3, ge=1, le=5, description="Max depth")

class OrgChartRequest(BaseModel):
    org_data: List[Dict[str, Any]] = Field(..., description="Organization data")
    title: Optional[str] = Field(default=None, description="Chart title")

class TimelineRequest(BaseModel):
    events: List[Dict[str, Any]] = Field(..., description="Timeline events")
    title: Optional[str] = Field(default=None, description="Timeline title")

class GanttRequest(BaseModel):
    tasks: List[Dict[str, Any]] = Field(..., description="Project tasks")
    title: Optional[str] = Field(default=None, description="Chart title")

class NetworkGraphRequest(BaseModel):
    relationships: List[Dict[str, Any]] = Field(..., description="Relationships")
    title: Optional[str] = Field(default=None, description="Graph title")

class KanbanRequest(BaseModel):
    items: List[Dict[str, Any]] = Field(..., description="Kanban items")
    columns: Optional[List[str]] = Field(default=None, description="Column names")
    title: Optional[str] = Field(default=None, description="Board title")

class SequenceDiagramRequest(BaseModel):
    interactions: List[Dict[str, Any]] = Field(..., description="Interactions")
    title: Optional[str] = Field(default=None, description="Diagram title")

class WordcloudRequest(BaseModel):
    text: str = Field(..., description="Source text")
    max_words: int = Field(default=100, ge=10, le=500, description="Max words")
    title: Optional[str] = Field(default=None, description="Title")

class TableToChartRequest(BaseModel):
    data: List[Dict[str, Any]] = Field(..., description="Table data")
    chart_type: str = Field(default="bar", description="Chart type")
    x_column: Optional[str] = Field(default=None, description="X axis column")
    y_columns: Optional[List[str]] = Field(default=None, description="Y axis columns")
    title: Optional[str] = Field(default=None, description="Chart title")

class SparklineRequest(BaseModel):
    data: List[Dict[str, Any]] = Field(..., description="Data rows")
    value_columns: List[str] = Field(..., description="Columns for sparklines")

# DIAGRAM ENDPOINTS

@visualization_router.post("/diagrams/flowchart")
async def generate_flowchart(request: FlowchartRequest):
    """
    Generate a flowchart from a process description.

    Returns:
        DiagramSpec for the flowchart
    """
    try:
        result = await visualization_service.generate_flowchart(
            description=request.description,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Flowchart generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/mindmap")
async def generate_mindmap(request: MindmapRequest):
    """
    Generate a mind map from document content.

    Returns:
        DiagramSpec for the mind map
    """
    try:
        result = await visualization_service.generate_mindmap(
            document_content=request.content,
            title=request.title,
            max_depth=request.max_depth,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Mindmap generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/org-chart")
async def generate_org_chart(request: OrgChartRequest):
    """
    Generate an organization chart.

    Returns:
        DiagramSpec for the org chart
    """
    try:
        result = await visualization_service.generate_org_chart(
            org_data=request.org_data,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Org chart generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/timeline")
async def generate_timeline(request: TimelineRequest):
    """
    Generate a timeline visualization.

    Returns:
        DiagramSpec for the timeline
    """
    try:
        parsed_events = []
        _DATE_RE = re.compile(r"\b(\d{4}[-/]\d{2}(?:[-/]\d{2})?)\b")
        for i, e in enumerate(request.events):
            if "id" not in e:
                e["id"] = str(uuid.uuid4())[:8]
            if "title" not in e or "date" not in e:
                desc = e.get("description", "")
                m = _DATE_RE.search(desc)
                if "date" not in e:
                    e["date"] = m.group(1) if m else f"event-{i + 1}"
                if "title" not in e:
                    # Strip the date prefix (e.g. "2023-01: ") to get the title
                    title = _DATE_RE.sub("", desc).strip().lstrip(":").strip()
                    e["title"] = title or desc or f"Event {i + 1}"
            parsed_events.append(TimelineEvent(**e))
        result = await visualization_service.generate_timeline(
            events=parsed_events,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Timeline generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/gantt")
async def generate_gantt(request: GanttRequest):
    """
    Generate a Gantt chart.

    Returns:
        DiagramSpec for the Gantt chart
    """
    try:
        tasks = [GanttTask(**t) for t in request.tasks]
        result = await visualization_service.generate_gantt(
            tasks=tasks,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Gantt generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/network")
async def generate_network_graph(request: NetworkGraphRequest):
    """
    Generate a network/relationship graph.

    Returns:
        DiagramSpec for the network graph
    """
    try:
        result = await visualization_service.generate_network_graph(
            relationships=request.relationships,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Network graph generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/kanban")
async def generate_kanban(request: KanbanRequest):
    """
    Generate a Kanban board visualization.

    Returns:
        DiagramSpec for the Kanban board
    """
    try:
        result = await visualization_service.generate_kanban(
            items=request.items,
            columns=request.columns,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Kanban generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/sequence")
async def generate_sequence_diagram(request: SequenceDiagramRequest):
    """
    Generate a sequence diagram.

    Returns:
        DiagramSpec for the sequence diagram
    """
    try:
        result = await visualization_service.generate_sequence_diagram(
            interactions=request.interactions,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Sequence diagram generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/diagrams/wordcloud")
async def generate_wordcloud(request: WordcloudRequest):
    """
    Generate a word cloud from text.

    Returns:
        DiagramSpec for the word cloud
    """
    try:
        result = await visualization_service.generate_wordcloud(
            text=request.text,
            max_words=request.max_words,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Wordcloud generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

# CHART ENDPOINTS

@visualization_router.post("/charts/from-table")
async def table_to_chart(request: TableToChartRequest):
    """
    Convert table data to a chart.

    Returns:
        ChartSpec for the chart
    """
    try:
        chart_type = ChartType(request.chart_type) if request.chart_type in [t.value for t in ChartType] else ChartType.BAR

        result = await visualization_service.table_to_chart(
            data=request.data,
            chart_type=chart_type,
            x_column=request.x_column,
            y_columns=request.y_columns,
            title=request.title,
        )
        return result.model_dump()
    except Exception as e:
        logger.error(f"Chart generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.post("/charts/sparklines")
async def generate_sparklines(request: SparklineRequest):
    """
    Generate inline sparkline charts.

    Returns:
        List of ChartSpecs for sparklines
    """
    try:
        results = await visualization_service.generate_sparklines(
            data=request.data,
            value_columns=request.value_columns,
        )
        return [r.model_dump() for r in results]
    except Exception as e:
        logger.error(f"Sparkline generation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

# EXPORT ENDPOINTS

@visualization_router.get("/diagrams/{diagram_id}/mermaid")
async def export_as_mermaid(diagram_id: str):
    """
    Export diagram as Mermaid.js syntax.

    Returns:
        Mermaid.js code
    """
    try:
        code = await visualization_service.export_diagram_as_mermaid(diagram_id)
        return {"mermaid_code": code}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visualization not found")
    except Exception as e:
        logger.error(f"Mermaid export failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.get("/diagrams/{diagram_id}/svg")
async def export_as_svg(diagram_id: str):
    """
    Export diagram as SVG.

    Returns:
        SVG content
    """
    try:
        svg_content = await visualization_service.export_diagram_as_svg(diagram_id)
        return {"svg": svg_content, "diagram_id": diagram_id}
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visualization not found")
    except Exception as e:
        logger.error(f"SVG export failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

@visualization_router.get("/diagrams/{diagram_id}/png")
async def export_as_png(diagram_id: str):
    """
    Export diagram as PNG.

    Returns:
        PNG image as streaming response
    """
    try:
        png_bytes = await visualization_service.export_diagram_as_png(diagram_id)
        return StreamingResponse(
            png_bytes,
            media_type="image/png",
            headers={"Content-Disposition": f'attachment; filename="{diagram_id}.png"'},
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visualization not found")
    except Exception as e:
        logger.error(f"PNG export failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Visualization generation failed")

# EXCEL EXTRACTION ENDPOINT

@visualization_router.post("/extract-excel")
async def extract_excel(file: UploadFile = File(...)):
    """
    Extract table data from an Excel (.xlsx/.xls) or CSV file.

    Returns sheets with headers + rows, ready for chart generation.
    """
    import pandas as pd

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail=f"Unsupported file type: .{ext}. Use .xlsx, .xls, or .csv")

    try:
        content = await file.read()
        buf = io.BytesIO(content)

        if ext == "csv":
            df = pd.read_csv(buf)
            sheets = [{"name": file.filename, "headers": list(df.columns), "rows": df.fillna("").values.tolist(), "row_count": len(df), "column_count": len(df.columns)}]
        else:
            xls = pd.ExcelFile(buf, engine="openpyxl")
            sheets = []
            for sheet_name in xls.sheet_names:
                df = pd.read_excel(xls, sheet_name=sheet_name)
                if df.empty:
                    continue
                # Convert all values to JSON-safe types
                rows = []
                for _, row in df.iterrows():
                    rows.append([str(v) if pd.notna(v) else "" for v in row])
                sheets.append({
                    "name": sheet_name,
                    "headers": [str(c) for c in df.columns],
                    "rows": rows,
                    "row_count": len(df),
                    "column_count": len(df.columns),
                })

        # Also provide the first sheet as a flat JSON array (ready for charts)
        data_preview = []
        if sheets:
            s = sheets[0]
            for row in s["rows"][:200]:  # cap at 200 rows for preview
                data_preview.append(dict(zip(s["headers"], row)))

        return {
            "filename": file.filename,
            "sheets": sheets,
            "total_sheets": len(sheets),
            "data": data_preview,
        }
    except Exception as e:
        logger.error(f"Excel extraction failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract data: {str(e)}")

# UTILITY ENDPOINTS

@visualization_router.get("/types/diagrams")
async def list_diagram_types():
    """List available diagram types."""
    return {"types": [t.value for t in DiagramType]}

@visualization_router.get("/types/charts")
async def list_chart_types():
    """List available chart types."""
    return {"types": [t.value for t in ChartType]}

import time
from typing import Any, Dict

from fastapi import APIRouter, Depends, Request

logger = logging.getLogger(__name__)

from backend.app.services.config import Settings, get_settings
from backend.app.api.middleware import limiter
from backend.app.services.analyze_service import _analysis_cache
from backend.app.services.infra_services import _get_config as _get_mailer_config, refresh_mailer_config
from backend.app.services import config as state_access

health_router = APIRouter()

def _check_directory_access(path: Path) -> Dict[str, Any]:
    """Check if a directory is accessible for read/write operations."""
    try:
        if not path.exists():
            return {"status": "warning", "message": "Directory does not exist", "path": str(path)}
        if not path.is_dir():
            return {"status": "error", "message": "Path is not a directory", "path": str(path)}
        # Try to list directory contents
        list(path.iterdir())
        # Check write access
        test_file = path / f".health_check_{os.getpid()}"
        try:
            test_file.write_text("health check")
            test_file.unlink()
            return {"status": "healthy", "path": str(path), "writable": True}
        except (OSError, PermissionError):
            return {"status": "warning", "path": str(path), "writable": False, "message": "Read-only access"}
    except Exception as e:
        logger.warning("directory_check_failed", extra={"path": str(path), "error": str(e)})
        return {"status": "error", "message": "Directory check failed", "path": str(path)}

def _check_claude_code_cli() -> Dict[str, Any]:
    """Check if Claude Code CLI is available."""
    import subprocess
    try:
        result = subprocess.run(
            ["claude", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return {
                "status": "available",
                "message": "Claude Code CLI is available",
            }
        return {"status": "error", "message": "Claude Code CLI not responding"}
    except Exception as e:
        logger.warning("claude_cli_check_failed", extra={"error": str(e)})
        return {"status": "error", "message": "Claude Code CLI check failed"}

def _check_openai_connection(settings: Settings | None = None) -> Dict[str, Any]:
    """Best-effort check that OpenAI is configured (and optionally reachable).

    This is intentionally lightweight: in many environments OpenAI is a fallback
    provider, and we don't want health checks to block on external calls.
    """
    if settings is None:
        settings = get_settings()
    if not getattr(settings, "openai_api_key", None):
        return {"status": "not_configured", "message": "OpenAI API key not configured"}
    try:
        # Backwards-compatible: core "verification" code still exposes
        # TemplateVerify.get_openai_client(), even though the backend may be a
        # different provider (Claude Code CLI via unified client).
        from backend.app.services.templates import TemplateVerify

        client = TemplateVerify.get_openai_client()
        if client is None:
            return {"status": "error", "message": "OpenAI client initialization failed"}
        return {"status": "configured", "message": "OpenAI client initialized"}
    except Exception:
        logger.exception("openai_health_check_failed")
        return {"status": "error", "message": "OpenAI health check failed"}

def _get_memory_usage() -> Dict[str, Any]:
    """Get current process memory usage."""
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF)
        return {
            "max_rss_mb": usage.ru_maxrss / 1024 if hasattr(usage, 'ru_maxrss') else None,
            "status": "healthy",
        }
    except ImportError:
        # resource module not available on Windows
        try:
            import psutil
            process = psutil.Process(os.getpid())
            mem_info = process.memory_info()
            return {
                "rss_mb": mem_info.rss / 1024 / 1024,
                "vms_mb": mem_info.vms / 1024 / 1024,
                "status": "healthy",
            }
        except ImportError:
            return {"status": "unknown", "message": "Memory stats not available"}

def _check_database() -> Dict[str, Any]:
    """Check state store is reachable."""
    try:
        store = state_access.get_state_store()
        backend_name = getattr(store, "backend_name", store.__class__.__name__)
        backend_fallback = bool(getattr(store, "backend_fallback", False))
        stats = store.get_stats() if hasattr(store, "get_stats") else None
        return {
            "status": "healthy",
            "backend_name": backend_name,
            "backend_fallback": backend_fallback,
            "stats": stats,
        }
    except Exception:
        logger.exception("database_health_check_failed")
        return {"status": "error", "message": "Database health check failed"}

@limiter.exempt
@health_router.get("/health")
async def health(request: Request) -> Dict[str, Any]:
    """Basic health check - fast, for load balancer probes."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@limiter.exempt
@health_router.get("/healthz")
async def healthz() -> Dict[str, str]:
    """Kubernetes-style liveness probe."""
    return {"status": "ok"}

@limiter.exempt
@health_router.get("/ready")
async def ready() -> Dict[str, Any]:
    """Kubernetes-style readiness probe - checks if app can serve requests."""
    settings = get_settings()
    checks = {}
    overall_status = "ready"

    # Check uploads directory
    uploads_check = _check_directory_access(settings.uploads_dir)
    checks["uploads_dir"] = uploads_check
    if uploads_check["status"] == "error":
        overall_status = "not_ready"

    # Check state directory
    state_check = _check_directory_access(settings.state_dir)
    checks["state_dir"] = state_check
    if state_check["status"] == "error":
        overall_status = "not_ready"

    return {
        "status": overall_status,
        "checks": checks,
    }

@limiter.exempt
@health_router.get("/readyz")
async def readyz() -> Dict[str, Any]:
    """Compatibility alias for readiness probe."""
    return await ready()

@limiter.exempt
@health_router.get("/health/token-usage")
async def token_usage(request: Request) -> Dict[str, Any]:
    """Get LLM token usage statistics."""
    try:
        from backend.app.services.llm import get_global_usage_stats
        stats = get_global_usage_stats()
        return {
            "status": "ok",
            "usage": stats,
            "correlation_id": getattr(request.state, "correlation_id", None),
        }
    except Exception as e:
        logger.warning("token_usage_check_failed", extra={"error": str(e)})
        return {
            "status": "error",
            "message": "Token usage retrieval failed",
            "usage": {
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_tokens": 0,
                "estimated_cost_usd": 0.0,
                "request_count": 0,
            },
            "correlation_id": getattr(request.state, "correlation_id", None),
        }

def _redact_directory_check(check: Dict[str, Any]) -> Dict[str, Any]:
    """Remove raw paths from directory health checks."""
    return {
        "status": check["status"],
        "writable": check.get("writable"),
    }

@limiter.exempt
@health_router.get("/health/detailed", dependencies=[Depends(require_api_key)])
async def health_detailed(
    request: Request,
) -> Dict[str, Any]:
    """Comprehensive health check with all dependencies."""
    started = time.time()
    settings = get_settings()

    checks: Dict[str, Any] = {}
    issues: list[str] = []

    # Check critical directories (redact paths)
    uploads_check = _check_directory_access(settings.uploads_dir)
    checks["uploads_dir"] = _redact_directory_check(uploads_check)
    if uploads_check["status"] == "error":
        issues.append("Uploads directory not accessible")

    checks["excel_uploads_dir"] = _redact_directory_check(
        _check_directory_access(settings.excel_uploads_dir)
    )

    state_check = _check_directory_access(settings.state_dir)
    checks["state_dir"] = _redact_directory_check(state_check)
    if state_check["status"] == "error":
        issues.append("State directory not accessible")

    # Check Claude Code CLI
    checks["llm"] = _check_claude_code_cli()

    # Check OpenAI (optional/fallback provider)
    checks["openai"] = _check_openai_connection(settings)
    if checks["openai"]["status"] == "error":
        issues.append("OpenAI connectivity failed")

    # Check cache status
    cache = _analysis_cache()
    checks["analysis_cache"] = {
        "status": "healthy",
        "current_size": cache.size(),
        "max_size": cache.max_items,
        "ttl_seconds": cache.ttl_seconds,
    }

    # Database connectivity (state store + auth SQLite)
    checks["database"] = _check_database()

    # Memory usage
    checks["memory"] = _get_memory_usage()

    # API configuration (redact sensitive details)
    checks["configuration"] = {
        "api_key_configured": settings.api_key is not None,
        "rate_limiting_enabled": settings.rate_limit_enabled,
        "rate_limit": f"{settings.rate_limit_requests}/{settings.rate_limit_window_seconds}s",
        "request_timeout": settings.request_timeout_seconds,
        "max_upload_size_mb": settings.max_upload_bytes / 1024 / 1024,
    }

    elapsed_ms = int((time.time() - started) * 1000)

    overall_status = "healthy" if not issues else "degraded"

    return {
        "status": overall_status,
        "version": settings.api_version,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "response_time_ms": elapsed_ms,
        "checks": checks,
        "issues": issues if issues else None,
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

def _check_email_config() -> Dict[str, Any]:
    """Check email/SMTP configuration status."""
    config = _get_mailer_config()
    result: Dict[str, Any] = {
        "enabled": config.enabled,
        "host_configured": bool(config.host),
        "sender_configured": bool(config.sender),
        "auth_configured": bool(config.username and config.password),
        "use_tls": config.use_tls,
        "port": config.port,
    }

    if not config.enabled:
        result["status"] = "not_configured"
        missing = []
        if not config.host:
            missing.append("NEURA_MAIL_HOST")
        if not config.sender:
            missing.append("NEURA_MAIL_SENDER")
        result["missing_env_vars"] = missing
        result["message"] = f"Email disabled. Set {', '.join(missing)} to enable."
    else:
        result["status"] = "configured"
        result["host"] = config.host
        # Mask sender partially for security
        if config.sender:
            parts = config.sender.split("@")
            if len(parts) == 2:
                masked = parts[0][:3] + "***@" + parts[1]
                result["sender_masked"] = masked
            else:
                result["sender_masked"] = config.sender[:5] + "***"

    return result

def _test_smtp_connection() -> Dict[str, Any]:
    """Attempt to connect to SMTP server (without sending email)."""
    config = _get_mailer_config()
    if not config.enabled or not config.host:
        return {"status": "skipped", "reason": "email_not_configured"}

    import smtplib
    import ssl

    try:
        if config.use_tls:
            with smtplib.SMTP(config.host, config.port, timeout=10) as client:
                client.ehlo()
                context = ssl.create_default_context()
                client.starttls(context=context)
                client.ehlo()
                if config.username and config.password:
                    client.login(config.username, config.password)
                return {"status": "connected", "message": "SMTP connection successful"}
        else:
            with smtplib.SMTP(config.host, config.port, timeout=10) as client:
                client.ehlo()
                if config.username and config.password:
                    client.login(config.username, config.password)
                return {"status": "connected", "message": "SMTP connection successful"}
    except smtplib.SMTPAuthenticationError as e:
        logger.warning("smtp_auth_failed", extra={"error": str(e)})
        return {"status": "auth_failed", "message": "SMTP authentication failed"}
    except smtplib.SMTPConnectError as e:
        logger.warning("smtp_connect_failed", extra={"error": str(e)})
        return {"status": "connection_failed", "message": "Could not connect to SMTP server"}
    except Exception as e:
        logger.warning("smtp_test_failed", extra={"error": str(e)})
        return {"status": "error", "message": "SMTP connection test failed"}

@limiter.exempt
@health_router.get("/health/email")
async def email_health(request: Request) -> Dict[str, Any]:
    """Check email/SMTP configuration and optionally test connection."""
    config_status = _check_email_config()
    return {
        "status": "ok" if config_status.get("status") == "configured" else "warning",
        "email": config_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@limiter.exempt
@health_router.get("/health/email/test")
async def email_connection_test(request: Request) -> Dict[str, Any]:
    """Test SMTP connection (without sending an email)."""
    config_status = _check_email_config()
    connection_test = _test_smtp_connection()

    overall_status = "ok"
    if config_status.get("status") != "configured":
        overall_status = "warning"
    elif connection_test.get("status") != "connected":
        overall_status = "error"

    return {
        "status": overall_status,
        "email": config_status,
        "connection_test": connection_test,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@limiter.exempt
@health_router.post("/health/email/refresh")
async def refresh_email_config(request: Request) -> Dict[str, Any]:
    """Refresh email configuration from environment variables."""
    refresh_mailer_config()
    config_status = _check_email_config()
    return {
        "status": "ok",
        "message": "Email configuration refreshed",
        "email": config_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

@limiter.exempt
@health_router.get("/health/scheduler")
async def scheduler_health(request: Request) -> Dict[str, Any]:
    """Check scheduler status with detailed information."""
    scheduler_disabled = os.getenv("NEURA_SCHEDULER_DISABLED", "false").lower() == "true"
    poll_interval = int(os.getenv("NEURA_SCHEDULER_INTERVAL", "60") or "60")

    # Try to get scheduler instance from main app
    scheduler_running = False
    inflight_jobs: list[str] = []
    scheduler_instance = None

    try:
        import backend.api as api_module
        scheduler_instance = getattr(api_module, "SCHEDULER", None)
        if scheduler_instance is not None:
            scheduler_running = scheduler_instance._task is not None and not scheduler_instance._task.done()
            inflight_jobs = list(scheduler_instance._inflight)
    except Exception:
        pass

    # Get schedule statistics
    schedules_info = {"total": 0, "active": 0, "next_run": None}
    try:
        schedules = state_access.list_schedules()
        schedules_info["total"] = len(schedules)
        schedules_info["active"] = sum(1 for s in schedules if s.get("active", True))

        # Find next scheduled run
        now = datetime.now(timezone.utc)
        next_runs = []
        for s in schedules:
            if s.get("active", True) and s.get("next_run_at"):
                try:
                    next_run = datetime.fromisoformat(s["next_run_at"].replace("Z", "+00:00"))
                    next_runs.append((next_run, s.get("name", s.get("id"))))
                except Exception:
                    pass

        if next_runs:
            next_runs.sort(key=lambda x: x[0])
            next_run_time, next_run_name = next_runs[0]
            schedules_info["next_run"] = {
                "schedule_name": next_run_name,
                "next_run_at": next_run_time.isoformat(),
                "in_seconds": max(0, int((next_run_time - now).total_seconds())),
            }
    except Exception:
        pass

    status = "ok"
    message = None
    if scheduler_disabled:
        status = "disabled"
        message = "Scheduler is disabled via NEURA_SCHEDULER_DISABLED environment variable"
    elif not scheduler_running:
        status = "warning"
        message = "Scheduler is enabled but not currently running"

    return {
        "status": status,
        "message": message,
        "scheduler": {
            "enabled": not scheduler_disabled,
            "running": scheduler_running,
            "poll_interval_seconds": poll_interval,
            "inflight_jobs": inflight_jobs,
        },
        "schedules": schedules_info,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "correlation_id": getattr(request.state, "correlation_id", None),
    }

"""User settings and preferences API routes."""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

logger = logging.getLogger("neura.settings")

settings_router = APIRouter(dependencies=[Depends(require_api_key)])

class UpdatePreferencesRequest(BaseModel):
    updates: Optional[Dict[str, Any]] = None
    # Also accept flat keys for convenience (M11)
    timezone: Optional[str] = None
    theme: Optional[str] = None
    language: Optional[str] = None
    default_connection: Optional[str] = None

def _collect_updates(request: UpdatePreferencesRequest) -> dict:
    """Merge updates dict and flat keys into a single dict."""
    updates = dict(request.updates or {})
    for key in ("timezone", "theme", "language", "default_connection"):
        val = getattr(request, key, None)
        if val is not None:
            updates[key] = val
    return updates

@settings_router.get("")
async def get_settings():
    """Get current user preferences and settings."""
    prefs = state_access.get_user_preferences()
    return {"settings": prefs}

@settings_router.put("")
async def update_settings(request: UpdatePreferencesRequest):
    """Update user preferences. Accepts {"updates": {...}} or flat keys."""
    updates = _collect_updates(request)
    if not updates:
        return {"settings": state_access.get_user_preferences()}
    updated = state_access.update_user_preferences(updates)
    return {"settings": updated}

# Alias router: /api/v1/preferences → same as /api/v1/settings (H3)
preferences_router = APIRouter(dependencies=[Depends(require_api_key)])

@preferences_router.get("")
async def get_preferences():
    """Get current user preferences (alias for /settings)."""
    prefs = state_access.get_user_preferences()
    return {"preferences": prefs}

@preferences_router.put("")
async def update_preferences(request: UpdatePreferencesRequest):
    """Update user preferences (alias for /settings)."""
    updates = _collect_updates(request)
    if not updates:
        return {"preferences": state_access.get_user_preferences()}
    updated = state_access.update_user_preferences(updates)
    return {"preferences": updated}

# SMTP / Email configuration endpoints

class SmtpSettingsRequest(BaseModel):
    host: Optional[str] = None
    port: int = 587
    username: Optional[str] = None
    password: Optional[str] = None
    sender: Optional[str] = None
    use_tls: bool = True

@settings_router.get("/smtp")
async def get_smtp_settings():
    """Get saved SMTP settings (password masked)."""
    prefs = state_access.get_user_preferences()
    smtp = dict(prefs.get("smtp") or {})
    # Mask password in response
    if smtp.get("password"):
        smtp["password_set"] = True
        smtp["password"] = "••••••••"
    else:
        smtp["password_set"] = False
    return {"smtp": smtp}

@settings_router.put("/smtp")
async def save_smtp_settings(request: SmtpSettingsRequest):
    """Save SMTP settings to persistent state store and reload mailer."""
    smtp_data: Dict[str, Any] = {
        "host": (request.host or "").strip() or None,
        "port": request.port,
        "username": (request.username or "").strip() or None,
        "sender": (request.sender or "").strip() or None,
        "use_tls": request.use_tls,
    }
    # Only update password if a real value was provided (not the mask)
    if request.password and request.password != "••••••••":
        smtp_data["password"] = request.password
    else:
        # Keep existing password
        existing = (state_access.get_user_preferences().get("smtp") or {})
        if existing.get("password"):
            smtp_data["password"] = existing["password"]

    state_access.set_user_preference("smtp", smtp_data)
    logger.info("smtp_settings_saved", extra={"event": "smtp_settings_saved", "host": smtp_data.get("host")})

    # Reload mailer config from the updated state store
    from backend.app.services.infra_services import refresh_mailer_config
    refresh_mailer_config()

    # Return masked response
    resp = dict(smtp_data)
    if resp.get("password"):
        resp["password_set"] = True
        resp["password"] = "••••••••"
    else:
        resp["password_set"] = False
    return {"smtp": resp, "message": "SMTP settings saved"}

@settings_router.post("/smtp/test")
async def test_smtp_settings():
    """Test current SMTP connection."""
    from backend.app.services.infra_services import _get_config

    config = _get_config()
    if not config.enabled or not config.host:
        return {"status": "not_configured", "message": "SMTP not configured. Save settings first."}

    try:
        if config.use_tls:
            with smtplib.SMTP(config.host, config.port, timeout=10) as client:
                client.ehlo()
                context = ssl.create_default_context()
                client.starttls(context=context)
                client.ehlo()
                if config.username and config.password:
                    client.login(config.username, config.password)
                return {"status": "connected", "message": "SMTP connection successful"}
        else:
            with smtplib.SMTP(config.host, config.port, timeout=10) as client:
                client.ehlo()
                if config.username and config.password:
                    client.login(config.username, config.password)
                return {"status": "connected", "message": "SMTP connection successful"}
    except smtplib.SMTPAuthenticationError:
        return {"status": "auth_failed", "message": "Authentication failed. Check username/password."}
    except smtplib.SMTPConnectError:
        return {"status": "connection_failed", "message": "Could not connect to SMTP server."}
    except Exception as e:
        return {"status": "error", "message": f"Connection failed: {e}"}

"""Favorites API routes."""

from fastapi import APIRouter, Depends, HTTPException

favorites_router = APIRouter(dependencies=[Depends(require_api_key)])

# Accept both singular and plural entity type names
_ENTITY_TYPE_MAP = {
    "template": "templates",
    "templates": "templates",
    "connection": "connections",
    "connections": "connections",
    "dashboard": "dashboards",
    "dashboards": "dashboards",
    "document": "documents",
    "documents": "documents",
}

_VALID_ENTITY_TYPES = set(_ENTITY_TYPE_MAP.values())

def _normalize_entity_type(raw: str) -> str:
    """Normalize entity type, accepting singular or plural.

    Raises HTTPException 422 for unknown entity types.
    """
    normalized = _ENTITY_TYPE_MAP.get(raw.lower().strip())
    if normalized is None:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid entity_type '{raw}'. Must be one of: {', '.join(sorted(_VALID_ENTITY_TYPES))}",
        )
    return normalized

class FavoriteRequest(BaseModel):
    entity_type: str
    entity_id: str = Field(..., max_length=500)

@favorites_router.get("")
async def list_favorites():
    """List all favorites grouped by entity type."""
    favorites = state_access.get_favorites()
    return {"favorites": favorites}

@favorites_router.post("")
async def add_favorite(request: FavoriteRequest):
    """Add an item to favorites."""
    entity_type = _normalize_entity_type(request.entity_type)
    added = state_access.add_favorite(entity_type, request.entity_id)
    return {"status": "ok", "added": added}

@favorites_router.delete("/{entity_type}/{entity_id}")
async def remove_favorite(entity_type: str, entity_id: str):
    """Remove an item from favorites."""
    normalized = _normalize_entity_type(entity_type)
    removed = state_access.remove_favorite(normalized, entity_id)
    return {"status": "ok", "removed": removed}

"""Notifications API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query

notifications_router = APIRouter(dependencies=[Depends(require_api_key)])

class CreateNotificationRequest(BaseModel):
    """Create notification request body."""
    title: str = Field(..., min_length=1, max_length=255)
    message: str = Field(..., min_length=1, max_length=2000)
    type: str = Field("info", pattern="^(info|warning|error|success)$")

@notifications_router.get("")
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
):
    """List notifications."""
    notifications = state_access.get_notifications(limit=limit, unread_only=unread_only)
    return {"notifications": notifications, "total": len(notifications)}

@notifications_router.post("")
async def create_notification(request: CreateNotificationRequest):
    """Create a new notification."""
    notification = state_access.add_notification(
        title=request.title,
        message=request.message,
        notification_type=request.type,
    )
    return {"status": "ok", "notification": notification}

@notifications_router.post("/{notification_id}/read")
async def mark_read(notification_id: str):
    """Mark a notification as read."""
    result = state_access.mark_notification_read(notification_id)
    if result is False:
        raise HTTPException(
            status_code=404,
            detail={"status": "error", "code": "notification_not_found", "message": "Notification not found."},
        )
    return {"status": "ok"}

@notifications_router.delete("/{notification_id}")
async def delete_notification(notification_id: str):
    """Delete a notification."""
    result = state_access.delete_notification(notification_id)
    if result is False:
        raise HTTPException(
            status_code=404,
            detail={"status": "error", "code": "notification_not_found", "message": "Notification not found."},
        )
    return {"status": "ok"}

"""Intent Audit API Routes.

REST API endpoints for recording and updating user intent audit trails.
Used by the frontend UX governance system to track explicit user intents
and their outcomes for compliance and debugging.
"""

from fastapi import APIRouter, Depends, HTTPException, Header

logger = logging.getLogger("neura.api.audit")

audit_router = APIRouter(tags=["audit"], dependencies=[Depends(require_api_key)])

# Schemas

class RecordIntentRequest(BaseModel):
    """Record a user intent."""

    id: str = Field(..., description="Unique intent identifier")
    type: str = Field(..., description="Intent type (e.g., 'create', 'delete', 'export')")
    label: Optional[str] = Field(None, description="Human-readable label")
    correlationId: Optional[str] = Field(None, description="Correlation ID for request tracing")
    sessionId: Optional[str] = Field(None, description="User session ID")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional intent metadata")

class UpdateIntentRequest(BaseModel):
    """Update an intent with outcome."""

    status: str = Field(..., description="Intent outcome status (e.g., 'completed', 'failed', 'cancelled')")
    result: Optional[Dict[str, Any]] = Field(None, description="Result data")

class FrontendErrorReportRequest(BaseModel):
    """Frontend error event for debugging click/action failures."""

    source: str = Field(default="frontend", max_length=128)
    message: str = Field(..., min_length=1, max_length=4000)
    route: Optional[str] = Field(None, max_length=512)
    action: Optional[str] = Field(None, max_length=256)
    status_code: Optional[int] = Field(None, ge=100, le=599)
    method: Optional[str] = Field(None, max_length=16)
    request_url: Optional[str] = Field(None, max_length=2000)
    stack: Optional[str] = Field(None, max_length=12000)
    user_agent: Optional[str] = Field(None, max_length=1024)
    timestamp: Optional[str] = Field(None, max_length=64)
    context: Optional[Dict[str, Any]] = Field(None)

# State helpers

def _get_intents() -> Dict[str, Dict[str, Any]]:
    """Get all intents from state."""
    with state_store.transaction() as st:
        return dict(st.get("audit_intents", {}))

def _get_intent(intent_id: str) -> Optional[Dict[str, Any]]:
    """Get a single intent by ID."""
    with state_store.transaction() as st:
        return st.get("audit_intents", {}).get(intent_id)

def _put_intent(intent: Dict[str, Any]) -> None:
    """Persist an intent record."""
    with state_store.transaction() as st:
        st.setdefault("audit_intents", {})[intent["id"]] = intent

# Endpoints

@audit_router.post("/intent")
async def record_intent(
    request: RecordIntentRequest,
    x_idempotency_key: Optional[str] = Header(None, alias="X-Idempotency-Key"),
):
    """Record a user intent for audit trail.

    Accepts idempotency keys via headers to prevent duplicate recordings.
    """
    # Idempotency: if intent with this ID already exists, return it
    existing = _get_intent(request.id)
    if existing is not None:
        return {"status": "ok", "intent_id": request.id, "deduplicated": True}

    now = datetime.now(timezone.utc).isoformat()
    intent_record = {
        "id": request.id,
        "type": request.type,
        "label": request.label,
        "correlation_id": request.correlationId,
        "session_id": request.sessionId,
        "metadata": request.metadata,
        "status": "recorded",
        "idempotency_key": x_idempotency_key,
        "recorded_at": now,
        "updated_at": now,
    }

    _put_intent(intent_record)
    logger.info("Intent recorded", extra={"intent_id": request.id, "type": request.type})

    return {"status": "ok", "intent_id": request.id, "recorded_at": now}

@audit_router.patch("/intent/{id}")
async def update_intent(
    id: str,
    request: UpdateIntentRequest,
    x_idempotency_key: Optional[str] = Header(None, alias="X-Idempotency-Key"),
):
    """Update an intent with its outcome (completed, failed, cancelled)."""
    intent = _get_intent(id)
    if intent is None:
        raise HTTPException(status_code=404, detail="Intent not found")

    now = datetime.now(timezone.utc).isoformat()
    intent["status"] = request.status
    intent["result"] = request.result
    intent["updated_at"] = now

    _put_intent(intent)
    logger.info(
        "Intent updated",
        extra={"intent_id": id, "status": request.status},
    )

    return {"status": "ok", "intent_id": id, "updated_at": now}

@audit_router.post("/frontend-error")
async def record_frontend_error(request: FrontendErrorReportRequest):
    """Persist/log frontend runtime or action errors for operations debugging."""
    now = datetime.now(timezone.utc).isoformat()
    one_line_message = " ".join((request.message or "").split())[:1000]
    stack_preview = None
    if request.stack:
        stack_preview = request.stack.replace("\n", "\\n")[:3000]

    logger.error(
        "frontend_error source=%s route=%s action=%s method=%s status=%s message=%s stack=%s",
        request.source,
        request.route or "-",
        request.action or "-",
        request.method or "-",
        request.status_code if request.status_code is not None else "-",
        one_line_message,
        stack_preview or "-",
        extra={
            "event": "frontend_error",
            "source": request.source,
            "route": request.route,
            "action": request.action,
            "method": request.method,
            "status_code": request.status_code,
            "request_url": request.request_url,
            "user_agent": request.user_agent,
            "context": request.context,
            "client_timestamp": request.timestamp,
            "logged_at": now,
        },
    )
    return {"status": "ok", "logged_at": now}

"""
Logger Integration API Routes.

Provides endpoints for auto-discovering Logger databases and querying
Logger-specific data (devices, schemas, jobs, storage targets).
"""

logger = logging.getLogger("neura.api.logger")

logger_router = APIRouter(dependencies=[Depends(require_api_key)])

@logger_router.get("/discover")
async def discover_logger():
    """Auto-discover Logger databases on the local network."""
    from backend.app.services.platform_services import discover_logger_databases

    try:
        databases = discover_logger_databases()
        return {"status": "ok", "databases": databases}
    except Exception as exc:
        logger.exception("Logger discovery failed")
        raise HTTPException(status_code=500, detail="Logger discovery failed")

@logger_router.get("/{connection_id}/devices")
async def list_devices(connection_id: str):
    """List all PLC devices from a Logger database."""
    from backend.app.services.platform_services import get_devices

    try:
        devices = get_devices(connection_id)
        return {"status": "ok", "devices": devices}
    except Exception as exc:
        logger.exception("Failed to list devices for %s", connection_id)
        raise HTTPException(status_code=500, detail="Failed to list devices")

@logger_router.get("/{connection_id}/devices/{device_id}")
async def get_device(connection_id: str, device_id: str):
    """Get a single device with its protocol configuration."""
    from backend.app.services.platform_services import get_device_with_config

    try:
        device = get_device_with_config(connection_id, device_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        return {"status": "ok", "device": device}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to get device %s", device_id)
        raise HTTPException(status_code=500, detail="Failed to get device")

@logger_router.get("/{connection_id}/schemas")
async def list_schemas(connection_id: str):
    """List all device schemas with their fields."""
    from backend.app.services.platform_services import get_schemas

    try:
        schemas = get_schemas(connection_id)
        return {"status": "ok", "schemas": schemas}
    except Exception as exc:
        logger.exception("Failed to list schemas for %s", connection_id)
        raise HTTPException(status_code=500, detail="Failed to list schemas")

@logger_router.get("/{connection_id}/jobs")
async def list_jobs(connection_id: str):
    """List all logging jobs with their status."""
    from backend.app.services.platform_services import get_jobs

    try:
        jobs = get_jobs(connection_id)
        return {"status": "ok", "jobs": jobs}
    except Exception as exc:
        logger.exception("Failed to list jobs for %s", connection_id)
        raise HTTPException(status_code=500, detail="Failed to list jobs")

@logger_router.get("/{connection_id}/jobs/{job_id}/runs")
async def list_job_runs(
    connection_id: str,
    job_id: str,
    limit: int = Query(50, ge=1, le=500),
):
    """Get execution history for a specific logging job."""
    from backend.app.services.platform_services import get_job_runs

    try:
        runs = get_job_runs(connection_id, job_id, limit=limit)
        return {"status": "ok", "runs": runs}
    except Exception as exc:
        logger.exception("Failed to get runs for job %s", job_id)
        raise HTTPException(status_code=500, detail="Failed to get job runs")

@logger_router.get("/{connection_id}/storage-targets")
async def list_storage_targets(connection_id: str):
    """List all storage targets (external databases where data is logged)."""
    from backend.app.services.platform_services import get_storage_targets

    try:
        targets = get_storage_targets(connection_id)
        return {"status": "ok", "storage_targets": targets}
    except Exception as exc:
        logger.exception("Failed to list storage targets for %s", connection_id)
        raise HTTPException(status_code=500, detail="Failed to list storage targets")

@logger_router.get("/{connection_id}/device-tables")
async def list_device_tables(connection_id: str):
    """List all device tables (logical tables bound to schema + device + storage)."""
    from backend.app.services.platform_services import get_device_tables

    try:
        tables = get_device_tables(connection_id)
        return {"status": "ok", "device_tables": tables}
    except Exception as exc:
        logger.exception("Failed to list device tables for %s", connection_id)
        raise HTTPException(status_code=500, detail="Failed to list device tables")

@logger_router.get("/{connection_id}/device-tables/{table_id}/mappings")
async def list_field_mappings(connection_id: str, table_id: str):
    """Get field mappings for a specific device table."""
    from backend.app.services.platform_services import get_field_mappings

    try:
        mappings = get_field_mappings(connection_id, table_id)
        return {"status": "ok", "mappings": mappings}
    except Exception as exc:
        logger.exception("Failed to get mappings for table %s", table_id)
        raise HTTPException(status_code=500, detail="Failed to get field mappings")

# mypy: ignore-errors
"""
Feedback Collection API Routes (V2 Phase 7).

Endpoints for collecting user quality feedback:
- POST /feedback/thumbs — Thumbs up/down for agent tasks
- POST /feedback/rating — Star rating for reports
- POST /feedback/mapping — Mapping correction feedback
- GET  /feedback/stats — Feedback statistics
"""

from fastapi import APIRouter

logger = logging.getLogger("neura.api.feedback")

feedback_router = APIRouter(prefix="/feedback", tags=["feedback"])

# Request models
class ThumbsFeedbackRequest(BaseModel):
    entity_type: str = Field(..., description="Type of entity (agent_task, report, mapping)")
    entity_id: str = Field(..., description="ID of the entity")
    thumbs_up: bool = Field(..., description="True for positive, False for negative")
    comment: Optional[str] = Field(None, description="Optional comment")

class RatingFeedbackRequest(BaseModel):
    entity_type: str = Field(..., description="Type of entity (report, agent_output)")
    entity_id: str = Field(..., description="ID of the entity")
    rating: float = Field(..., ge=0.0, le=1.0, description="Rating from 0.0 to 1.0")
    comment: Optional[str] = Field(None, description="Optional comment")

class MappingCorrectionRequest(BaseModel):
    template_id: str = Field(..., description="Template ID")
    field_name: str = Field(..., description="Template field name")
    old_column: str = Field(..., description="Previous column mapping")
    new_column: str = Field(..., description="Corrected column mapping")

# Endpoints
@feedback_router.post("/thumbs")
async def submit_thumbs_feedback(req: ThumbsFeedbackRequest):
    """Submit thumbs up/down feedback for an entity."""
    from backend.app.services.quality_service import get_feedback_collector

    collector = get_feedback_collector()
    feedback_id = collector.record_agent_thumbs(
        task_id=req.entity_id,
        thumbs_up=req.thumbs_up,
        comment=req.comment,
    )

    logger.info("feedback_thumbs", extra={
        "entity_type": req.entity_type,
        "entity_id": req.entity_id,
        "thumbs_up": req.thumbs_up,
    })

    return {"feedback_id": feedback_id, "status": "recorded"}

@feedback_router.post("/rating")
async def submit_rating_feedback(req: RatingFeedbackRequest):
    """Submit a star rating for an entity."""

    collector = get_feedback_collector()
    feedback_id = collector.record_report_rating(
        report_id=req.entity_id,
        rating=req.rating,
        comment=req.comment,
    )

    logger.info("feedback_rating", extra={
        "entity_type": req.entity_type,
        "entity_id": req.entity_id,
        "rating": req.rating,
    })

    return {"feedback_id": feedback_id, "status": "recorded"}

@feedback_router.post("/mapping")
async def submit_mapping_correction(req: MappingCorrectionRequest):
    """Submit a mapping correction (field→column remapping)."""

    collector = get_feedback_collector()
    feedback_id = collector.record_mapping_correction(
        template_id=req.template_id,
        field_name=req.field_name,
        old_column=req.old_column,
        new_column=req.new_column,
    )

    logger.info("feedback_mapping_correction", extra={
        "template_id": req.template_id,
        "field_name": req.field_name,
        "old": req.old_column,
        "new": req.new_column,
    })

    return {"feedback_id": feedback_id, "status": "recorded"}

@feedback_router.get("/stats")
async def get_feedback_stats():
    """Get overall feedback statistics."""

    collector = get_feedback_collector()
    stats = collector.get_stats()
    return stats

@feedback_router.get("/ratings/{entity_type}")
async def get_entity_ratings(entity_type: str, entity_id: Optional[str] = None):
    """Get aggregated ratings for an entity type."""

    collector = get_feedback_collector()
    ratings = collector.get_ratings(entity_type, entity_id)
    return ratings

"""In-product AI Assistant API route.

Provides a single chat endpoint for the frontend assistant panel.
Uses LLMClient directly for low-latency responses.
"""

logger = logging.getLogger("neura.api.assistant")

assistant_router = APIRouter(dependencies=[Depends(require_api_key)])

# Request / Response models

class AssistantContext(BaseModel):
    """Frontend context sent with each assistant message.

    Includes deep state from all Zustand stores: template creator,
    documents, spreadsheets, dashboards, connectors, workflows, pipelines.
    """
    route: str = ""
    page_title: str = ""
    selected_entities: Dict[str, Any] = Field(default_factory=dict)
    workflow_state: Dict[str, Any] = Field(default_factory=dict)
    template_creator: Optional[Dict[str, Any]] = None
    document: Optional[Dict[str, Any]] = None
    spreadsheet: Optional[Dict[str, Any]] = None
    dashboard: Optional[Dict[str, Any]] = None
    connector: Optional[Dict[str, Any]] = None
    workflow: Optional[Dict[str, Any]] = None
    errors: List[Any] = Field(default_factory=list)
    loading_keys: List[str] = Field(default_factory=list)

class AssistantChatRequest(BaseModel):
    """Request body for the assistant chat endpoint."""
    messages: List[Dict[str, str]] = Field(
        ...,
        min_length=1,
        description="Conversation history. Each item has 'role' and 'content'.",
    )
    context: AssistantContext = Field(default_factory=AssistantContext)
    mode: str = Field(
        default="auto",
        description="Response mode: auto, explain, howto, troubleshoot, coaching, domain, action",
    )

class AssistantChatResponse(BaseModel):
    """Response from the assistant chat endpoint."""
    answer: str
    follow_ups: List[str] = Field(default_factory=list)
    actions: List[Dict[str, str]] = Field(default_factory=list)
    mode_used: str = "auto"
    tokens_used: int = 0

# Endpoint

@assistant_router.post(
    "/chat",
    response_model=AssistantChatResponse,
    summary="Send a message to the in-product assistant",
    description=(
        "Chat with the NeuraReport assistant. The frontend sends the current "
        "route, selected entities, and conversation history. The assistant "
        "returns a grounded, contextual response with optional follow-up "
        "suggestions and navigation actions."
    ),
)
async def assistant_chat(
    req: AssistantChatRequest,
    request: Request,
) -> AssistantChatResponse:
    from backend.app.services.assistant_service import AssistantService

    service = AssistantService()
    result = await asyncio.to_thread(
        service.chat,
        req.messages,
        req.context.model_dump(),
        req.mode,
    )
    return AssistantChatResponse(**result)

# ANALYTICS ROUTES (merged from analytics_routes.py)

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query

from backend.app.services.config import (
    normalize_job_status as _normalize_job_status,
    STATUS_SUCCEEDED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STATUS_QUEUED,
)

# Normalize singular → plural entity types for favorites endpoints
_ENTITY_TYPE_NORMALIZE = {"template": "templates", "connection": "connections"}

analytics_router = APIRouter(dependencies=[Depends(require_api_key)])

def _parse_iso(date_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO date string to datetime."""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None

def _get_date_bucket(date_str: Optional[str], bucket: str = "day") -> Optional[str]:
    """Convert date string to bucket key (day, week, month)."""
    dt = _parse_iso(date_str)
    if not dt:
        return None
    if bucket == "day":
        return dt.strftime("%Y-%m-%d")
    elif bucket == "week":
        # Get start of week (Monday)
        start = dt - timedelta(days=dt.weekday())
        return start.strftime("%Y-%m-%d")
    elif bucket == "month":
        return dt.strftime("%Y-%m")
    return dt.strftime("%Y-%m-%d")

@analytics_router.get("/dashboard")
async def get_dashboard_analytics() -> Dict[str, Any]:
    """Get comprehensive dashboard analytics."""

    # Get all data from state store (limit=0 → no cap)
    connections = state_access.list_connections()
    templates = state_access.list_templates()
    jobs = state_access.list_jobs(limit=0)
    schedules = state_access.list_schedules()

    # Calculate time boundaries
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    # Job statistics - use canonical status constants
    total_jobs = len(jobs)
    completed_jobs = [j for j in jobs if _normalize_job_status(j.get("status")) == STATUS_SUCCEEDED]
    failed_jobs = [j for j in jobs if _normalize_job_status(j.get("status")) == STATUS_FAILED]
    running_jobs = [j for j in jobs if _normalize_job_status(j.get("status")) == STATUS_RUNNING]
    pending_jobs = [j for j in jobs if _normalize_job_status(j.get("status")) == STATUS_QUEUED]

    # Helper: state_access.list_jobs() returns camelCase keys from _sanitize_job.
    # Support both camelCase and snake_case for robustness.
    def _job_created(j: dict) -> str | None:
        return j.get("createdAt") or j.get("created_at")

    def _job_template_id(j: dict) -> str | None:
        return j.get("templateId") or j.get("template_id")

    def _job_template_name(j: dict) -> str | None:
        return j.get("templateName") or j.get("template_name")

    def _job_finished(j: dict) -> str | None:
        return j.get("finishedAt") or j.get("finished_at") or j.get("completedAt") or j.get("completed_at")

    # Jobs by time period
    def count_jobs_after(job_list: list, after: datetime) -> int:
        count = 0
        for j in job_list:
            created = _parse_iso(_job_created(j))
            if created and created >= after:
                count += 1
        return count

    jobs_today = count_jobs_after(jobs, today_start)
    jobs_this_week = count_jobs_after(jobs, week_start)
    jobs_this_month = count_jobs_after(jobs, month_start)

    # Success rate
    finished_jobs = len(completed_jobs) + len(failed_jobs)
    success_rate = (len(completed_jobs) / finished_jobs * 100) if finished_jobs > 0 else 0

    # Template statistics
    pdf_templates = [t for t in templates if t.get("kind") == "pdf"]
    excel_templates = [t for t in templates if t.get("kind") == "excel"]
    approved_templates = [t for t in templates if t.get("status") == "approved"]

    # Most used templates (by job count)
    template_usage: dict[str, int] = {}
    for job in jobs:
        tid = _job_template_id(job)
        if tid:
            template_usage[tid] = template_usage.get(tid, 0) + 1

    top_templates = []
    for tid, count in sorted(template_usage.items(), key=lambda x: -x[1])[:5]:
        template = next((t for t in templates if t.get("id") == tid), None)
        if template:
            top_templates.append({
                "id": tid,
                "name": template.get("name", tid[:12]),
                "kind": template.get("kind", "pdf"),
                "runCount": count,
            })

    # Connection statistics
    active_connections = [c for c in connections if c.get("status") == "connected"]
    avg_latency = 0
    latencies = [c.get("lastLatencyMs") for c in connections if c.get("lastLatencyMs")]
    if latencies:
        avg_latency = sum(latencies) / len(latencies)

    # Schedule statistics
    active_schedules = [s for s in schedules if s.get("active")]

    # Jobs trend (last 7 days)
    jobs_trend = []
    for i in range(6, -1, -1):
        day = today_start - timedelta(days=i)
        day_end = day + timedelta(days=1)
        day_str = day.strftime("%Y-%m-%d")

        day_jobs = [
            j for j in jobs
            if (created := _parse_iso(_job_created(j))) and day <= created < day_end
        ]
        day_completed = len([j for j in day_jobs if _normalize_job_status(j.get("status")) == STATUS_SUCCEEDED])
        day_failed = len([j for j in day_jobs if _normalize_job_status(j.get("status")) == STATUS_FAILED])

        jobs_trend.append({
            "date": day_str,
            "label": day.strftime("%a"),
            "total": len(day_jobs),
            "completed": day_completed,
            "failed": day_failed,
        })

    # Recent activity (last 10 jobs)
    recent_jobs = sorted(jobs, key=lambda j: _job_created(j) or "", reverse=True)[:10]
    recent_activity = []
    for job in recent_jobs:
        recent_activity.append({
            "id": job.get("id"),
            "type": "job",
            "action": f"Report {_normalize_job_status(job.get('status'))}",
            "template": _job_template_name(job) or (_job_template_id(job) or "")[:12],
            "timestamp": _job_finished(job) or _job_created(job),
            "status": _normalize_job_status(job.get("status")),
        })

    return {
        "summary": {
            "totalConnections": len(connections),
            "activeConnections": len(active_connections),
            "totalTemplates": len(templates),
            "approvedTemplates": len(approved_templates),
            "pdfTemplates": len(pdf_templates),
            "excelTemplates": len(excel_templates),
            "totalJobs": total_jobs,
            "activeJobs": len(running_jobs) + len(pending_jobs),
            "completedJobs": len(completed_jobs),
            "failedJobs": len(failed_jobs),
            "totalSchedules": len(schedules),
            "activeSchedules": len(active_schedules),
        },
        "metrics": {
            "successRate": round(success_rate, 1),
            "avgConnectionLatency": round(avg_latency, 1),
            "jobsToday": jobs_today,
            "jobsThisWeek": jobs_this_week,
            "jobsThisMonth": jobs_this_month,
        },
        "topTemplates": top_templates,
        "jobsTrend": jobs_trend,
        "recentActivity": recent_activity,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@analytics_router.get("/usage")
async def get_usage_statistics(
    period: str = Query("week", pattern="^(day|week|month)$"),
) -> Dict[str, Any]:
    """Get detailed usage statistics over time."""

    jobs = state_access.list_jobs(limit=0)
    templates = state_access.list_templates()

    now = datetime.now(timezone.utc)

    # Determine date range based on period
    if period == "day":
        start_date = now - timedelta(days=1)
        bucket = "hour"
    elif period == "week":
        start_date = now - timedelta(days=7)
        bucket = "day"
    else:  # month
        start_date = now - timedelta(days=30)
        bucket = "day"

    # Filter jobs in date range — support both camelCase and snake_case keys
    filtered_jobs = []
    for job in jobs:
        created = _parse_iso(job.get("createdAt") or job.get("created_at"))
        if created and created >= start_date:
            filtered_jobs.append(job)

    # Group by status
    by_status = {}
    for job in filtered_jobs:
        status = _normalize_job_status(job.get("status"))
        by_status[status] = by_status.get(status, 0) + 1

    # Group by template kind — support camelCase and snake_case
    by_kind = {"pdf": 0, "excel": 0}
    for job in filtered_jobs:
        kind = job.get("templateKind") or job.get("template_kind") or "pdf"
        by_kind[kind] = by_kind.get(kind, 0) + 1

    # Group by template
    by_template = {}
    for job in filtered_jobs:
        tid = job.get("templateId") or job.get("template_id") or "unknown"
        tname = job.get("templateName") or job.get("template_name") or tid[:12]
        if tid not in by_template:
            by_template[tid] = {"name": tname, "count": 0}
        by_template[tid]["count"] += 1

    template_breakdown = sorted(
        [{"id": k, **v} for k, v in by_template.items()],
        key=lambda x: -x["count"]
    )[:10]

    return {
        "period": period,
        "totalJobs": len(filtered_jobs),
        "byStatus": by_status,
        "byKind": by_kind,
        "templateBreakdown": template_breakdown,
        "startDate": start_date.isoformat(),
        "endDate": now.isoformat(),
    }

@analytics_router.get("/reports/history")
async def get_report_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(None),
    template_id: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Get report generation history with filtering.

    Merges completed report runs (which have artifacts) with in-progress
    jobs so the timeline shows both finished and pending work.
    """

    # Report runs have artifacts, templateName, timestamps
    runs = state_access.list_report_runs(
        template_id=template_id or None,
        limit=0,  # fetch all, we paginate below
    )

    # Also include in-progress / queued jobs that haven't finished yet
    jobs = state_access.list_jobs()
    completed_job_ids: set[str] = set()
    for run in runs:
        # correlation between run id and job id varies; track run ids
        completed_job_ids.add(run.get("id", ""))

    templates = {t.get("id"): t for t in state_access.list_templates()}

    history: list[dict] = []

    # Add completed report runs
    for run in runs:
        entry = {
            "id": run.get("id"),
            "templateId": run.get("templateId"),
            "templateName": run.get("templateName") or "Unknown",
            "templateKind": run.get("templateKind") or "pdf",
            "connectionId": run.get("connectionId"),
            "connectionName": run.get("connectionName"),
            "status": _normalize_job_status(run.get("status")),
            "createdAt": run.get("createdAt"),
            "completedAt": run.get("completedAt") or run.get("createdAt"),
            "artifacts": run.get("artifacts"),
            "startDate": run.get("startDate"),
            "endDate": run.get("endDate"),
            "keyValues": run.get("keyValues"),
            "scheduleId": run.get("scheduleId"),
            "scheduleName": run.get("scheduleName"),
            "error": None,
            "source": "run",
        }
        history.append(entry)

    # Add jobs that don't have a corresponding report run entry
    for job in jobs:
        jid = job.get("id", "")
        if jid in completed_job_ids:
            continue
        job_status = _normalize_job_status(job.get("status"))
        tid = job.get("template_id")
        template = templates.get(tid, {})
        entry = {
            "id": jid,
            "templateId": tid,
            "templateName": job.get("template_name") or template.get("name") or (tid[:12] if tid else "Unknown"),
            "templateKind": job.get("template_kind") or template.get("kind") or "pdf",
            "connectionId": job.get("connection_id"),
            "connectionName": None,
            "status": job_status,
            "createdAt": job.get("created_at"),
            "completedAt": job.get("finished_at"),
            "artifacts": None,
            "startDate": None,
            "endDate": None,
            "keyValues": None,
            "scheduleId": job.get("schedule_id"),
            "scheduleName": None,
            "error": job.get("error"),
            "source": "job",
        }
        history.append(entry)

    # Filter
    if status:
        status_norm = _normalize_job_status(status)
        history = [h for h in history if h.get("status") == status_norm]
    if template_id:
        history = [h for h in history if h.get("templateId") == template_id]

    # Sort by createdAt descending
    history.sort(key=lambda h: h.get("createdAt") or "", reverse=True)

    total = len(history)
    paginated = history[offset:offset + limit]

    return {
        "history": paginated,
        "total": total,
        "limit": limit,
        "offset": offset,
        "hasMore": offset + limit < total,
    }

# Activity Log Endpoints

@analytics_router.get("/activity")
async def get_activity_log(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    entity_type: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Get the activity log with optional filtering."""
    log = state_access.get_activity_log(
        limit=limit,
        offset=offset,
        entity_type=entity_type,
        action=action,
    )
    return {
        "activities": log,
        "limit": limit,
        "offset": offset,
    }

@analytics_router.post("/activity")
async def log_activity(payload: LogActivityRequest) -> Dict[str, Any]:
    """Log an activity event."""
    entry = state_access.log_activity(
        action=payload.action,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        entity_name=payload.entity_name,
        details=payload.details,
    )
    return {"activity": entry}

@analytics_router.delete("/activity")
async def clear_activity_log(
    x_confirm_destructive: str = Header(None, alias="X-Confirm-Destructive"),
) -> Dict[str, Any]:
    """Clear all activity log entries. Requires X-Confirm-Destructive: true header."""
    if x_confirm_destructive != "true":
        raise HTTPException(
            status_code=400,
            detail="Destructive operation requires header X-Confirm-Destructive: true",
        )
    count = state_access.clear_activity_log()
    return {"cleared": count}

# Favorites Endpoints

@analytics_router.get("/favorites")
async def get_favorites() -> Dict[str, Any]:
    """Get all favorites."""
    favorites = state_access.get_favorites()

    # Enrich with template/connection details
    templates = {t.get("id"): t for t in state_access.list_templates()}
    connections = {c.get("id"): c for c in state_access.list_connections()}

    enriched_templates = []
    for tid in favorites.get("templates", []):
        template = templates.get(tid)
        if template:
            enriched_templates.append({
                "id": tid,
                "name": template.get("name"),
                "kind": template.get("kind"),
                "status": template.get("status"),
            })

    enriched_connections = []
    for cid in favorites.get("connections", []):
        conn = connections.get(cid)
        if conn:
            enriched_connections.append({
                "id": cid,
                "name": conn.get("name"),
                "dbType": conn.get("db_type"),
                "status": conn.get("status"),
            })

    return {
        "templates": enriched_templates,
        "connections": enriched_connections,
    }

@analytics_router.post("/favorites/{entity_type}/{entity_id}")
async def add_favorite(entity_type: str, entity_id: str) -> Dict[str, Any]:
    """Add an item to favorites."""
    entity_type = _ENTITY_TYPE_NORMALIZE.get(entity_type, entity_type)
    if entity_type not in ("templates", "connections"):
        raise HTTPException(status_code=400, detail=f"Invalid entity_type '{entity_type}'. Must be one of: templates, connections")

    added = state_access.add_favorite(entity_type, entity_id)

    # Log activity
    state_access.log_activity(
        action="favorite_added",
        entity_type=entity_type.rstrip("s"),  # template or connection
        entity_id=entity_id,
    )

    return {"added": added, "entityType": entity_type, "entityId": entity_id}

@analytics_router.delete("/favorites/{entity_type}/{entity_id}")
async def remove_favorite(entity_type: str, entity_id: str) -> Dict[str, Any]:
    """Remove an item from favorites."""
    entity_type = _ENTITY_TYPE_NORMALIZE.get(entity_type, entity_type)
    if entity_type not in ("templates", "connections"):
        raise HTTPException(status_code=400, detail=f"Invalid entity_type '{entity_type}'. Must be one of: templates, connections")

    removed = state_access.remove_favorite(entity_type, entity_id)

    # Log activity
    state_access.log_activity(
        action="favorite_removed",
        entity_type=entity_type.rstrip("s"),
        entity_id=entity_id,
    )

    return {"removed": removed, "entityType": entity_type, "entityId": entity_id}

@analytics_router.get("/favorites/{entity_type}/{entity_id}")
async def check_favorite(entity_type: str, entity_id: str) -> Dict[str, Any]:
    """Check if an item is a favorite."""
    entity_type = _ENTITY_TYPE_NORMALIZE.get(entity_type, entity_type)
    if entity_type not in ("templates", "connections"):
        raise HTTPException(status_code=400, detail=f"Invalid entity_type '{entity_type}'. Must be one of: templates, connections")

    is_fav = state_access.is_favorite(entity_type, entity_id)
    return {"isFavorite": is_fav, "entityType": entity_type, "entityId": entity_id}

# User Preferences Endpoints

class PreferenceValue(BaseModel):
    value: Any

class LogActivityRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=100)
    entity_type: str = Field(..., min_length=1, max_length=50)
    entity_id: Optional[str] = Field(None, max_length=255)
    entity_name: Optional[str] = Field(None, max_length=255)
    details: Optional[Dict[str, Any]] = None

class CreateNotificationRequest(BaseModel):
    title: str = Field(default="Notification", min_length=1, max_length=255)
    message: str = Field(default="", max_length=2000)
    type: str = Field(default="info", pattern="^(info|success|warning|error)$")
    link: Optional[str] = Field(None, max_length=2000)
    entityType: Optional[str] = Field(None, max_length=50)
    entityId: Optional[str] = Field(None, max_length=255)

class BulkTemplateRequest(BaseModel):
    templateIds: List[str] = Field(..., min_length=1, max_length=500)
    status: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = Field(None, max_length=100)

class BulkJobRequest(BaseModel):
    jobIds: List[str] = Field(..., min_length=1, max_length=500)

MAX_PREFERENCES_SIZE_BYTES = 50_000  # 50KB total

@analytics_router.get("/preferences")
async def get_preferences() -> Dict[str, Any]:
    """Get user preferences."""
    prefs = state_access.get_user_preferences()
    return {"preferences": prefs}

@analytics_router.put("/preferences")
async def update_preferences(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Update user preferences."""
    try:
        size = len(json.dumps(updates, default=str).encode("utf-8"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid preference data")
    if size > MAX_PREFERENCES_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Preferences payload too large (max {MAX_PREFERENCES_SIZE_BYTES} bytes)",
        )
    prefs = state_access.update_user_preferences(updates)
    return {"preferences": prefs}

@analytics_router.put("/preferences/{key}")
async def set_preference(
    key: str,
    payload: PreferenceValue | None = Body(default=None),
    value: Any = Query(default=None),
) -> Dict[str, Any]:
    """Set a single user preference."""

    # Size limits to prevent bloated state files
    MAX_KEY_LENGTH = 100
    MAX_VALUE_SIZE_BYTES = 10000  # 10KB per preference value

    # Validate key length
    if len(key) > MAX_KEY_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Preference key too long (max {MAX_KEY_LENGTH} characters)"
        )

    if payload is not None and payload.value is not None:
        pref_value = payload.value
    elif value is not None:
        pref_value = value
    else:
        raise HTTPException(status_code=422, detail="Preference value is required.")

    # Validate value size
    try:
        value_json = json.dumps(pref_value, default=str)
        if len(value_json.encode('utf-8')) > MAX_VALUE_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Preference value too large (max {MAX_VALUE_SIZE_BYTES} bytes)"
            )
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail="Invalid preference value")

    prefs = state_access.set_user_preference(key, pref_value)
    return {"preferences": prefs}

# Export/Backup Endpoints

@analytics_router.get("/export/config")
async def export_configuration() -> Dict[str, Any]:
    """Export all configuration (templates, connections, schedules, preferences) as JSON."""
    connections = state_access.list_connections()
    templates = state_access.list_templates()
    schedules = state_access.list_schedules()
    favorites = state_access.get_favorites()
    preferences = state_access.get_user_preferences()

    # Remove sensitive data from connections
    safe_connections = []
    for conn in connections:
        safe_conn = {
            "id": conn.get("id"),
            "name": conn.get("name"),
            "db_type": conn.get("db_type"),
            "summary": conn.get("summary"),
            "tags": conn.get("tags"),
        }
        safe_connections.append(safe_conn)

    return {
        "version": "1.0",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "data": {
            "connections": safe_connections,
            "templates": templates,
            "schedules": schedules,
            "favorites": favorites,
            "preferences": preferences,
        },
    }

# Global Search Endpoint

@analytics_router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=100),
    types: Optional[str] = Query(None),  # comma-separated: templates,connections,jobs
    limit: int = Query(20, ge=1, le=100),
) -> Dict[str, Any]:
    """Search across templates, connections, and jobs."""
    query = q.lower().strip()
    type_filter = set(types.split(",")) if types else {"templates", "connections", "jobs"}

    results = []

    # Search templates
    if "templates" in type_filter:
        templates = state_access.list_templates()
        for t in templates:
            name = (t.get("name") or "").lower()
            tid = (t.get("id") or "").lower()
            template_id = t.get("id")
            if query in name or query in tid:
                results.append({
                    "type": "template",
                    "id": template_id,
                    "name": t.get("name"),
                    "description": f"{t.get('kind', 'pdf').upper()} Template",
                    "url": f"/templates/{template_id}/edit" if template_id else "/templates",
                    "meta": {"kind": t.get("kind"), "status": t.get("status")},
                })

    # Search connections
    if "connections" in type_filter:
        connections = state_access.list_connections()
        for c in connections:
            name = (c.get("name") or "").lower()
            cid = (c.get("id") or "").lower()
            summary = (c.get("summary") or "").lower()
            connection_id = c.get("id")
            if query in name or query in cid or query in summary:
                results.append({
                    "type": "connection",
                    "id": connection_id,
                    "name": c.get("name"),
                    "description": c.get("summary") or c.get("db_type"),
                    "url": f"/connections?selected={connection_id}" if connection_id else "/connections",
                    "meta": {"dbType": c.get("db_type"), "status": c.get("status")},
                })

    # Search jobs
    if "jobs" in type_filter:
        jobs = state_access.list_jobs(limit=100)
        for j in jobs:
            tname = (j.get("templateName") or j.get("template_name") or "").lower()
            jid = (j.get("id") or "").lower()
            job_id = j.get("id")
            if query in tname or query in jid:
                results.append({
                    "type": "job",
                    "id": job_id,
                    "name": j.get("templateName") or j.get("template_name") or (job_id[:12] if job_id else "Job"),
                    "description": f"Job - {_normalize_job_status(j.get('status'))}",
                    "url": f"/jobs?selected={job_id}" if job_id else "/jobs",
                    "meta": {
                        "status": _normalize_job_status(j.get("status")),
                        "createdAt": j.get("createdAt") or j.get("created_at"),
                    },
                })

    # Limit results
    results = results[:limit]

    return {
        "query": q,
        "results": results,
        "total": len(results),
    }

# Notification Endpoints

@analytics_router.get("/notifications")
async def get_notifications(
    limit: int = Query(50, ge=1, le=100),
    unread_only: bool = Query(False),
) -> Dict[str, Any]:
    """Get notifications list."""
    notifications = state_access.get_notifications(limit=limit, unread_only=unread_only)
    unread_count = state_access.get_unread_count()
    return {
        "notifications": notifications,
        "unreadCount": unread_count,
        "total": len(notifications),
    }

@analytics_router.get("/notifications/unread-count")
async def get_unread_count() -> Dict[str, int]:
    """Get count of unread notifications."""
    return {"unreadCount": state_access.get_unread_count()}

@analytics_router.post("/notifications")
async def create_notification(payload: CreateNotificationRequest) -> Dict[str, Any]:
    """Create a new notification."""
    notification = state_access.add_notification(
        title=payload.title,
        message=payload.message,
        notification_type=payload.type,
        link=payload.link,
        entity_type=payload.entityType,
        entity_id=payload.entityId,
    )
    return {"notification": notification}

@analytics_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str) -> Dict[str, Any]:
    """Mark a notification as read."""
    found = state_access.mark_notification_read(notification_id)
    if not found:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"marked": True, "notificationId": notification_id}

@analytics_router.put("/notifications/read-all")
async def mark_all_read() -> Dict[str, Any]:
    """Mark all notifications as read."""
    count = state_access.mark_all_notifications_read()
    return {"markedCount": count}

@analytics_router.delete("/notifications/{notification_id}")
async def delete_notification(notification_id: str) -> Dict[str, Any]:
    """Delete a notification."""
    found = state_access.delete_notification(notification_id)
    if not found:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"deleted": True, "notificationId": notification_id}

@analytics_router.delete("/notifications")
async def clear_all_notifications(
    x_confirm_destructive: str = Header(None, alias="X-Confirm-Destructive"),
) -> Dict[str, Any]:
    """Clear all notifications. Requires X-Confirm-Destructive: true header."""
    if x_confirm_destructive != "true":
        raise HTTPException(
            status_code=400,
            detail="Destructive operation requires header X-Confirm-Destructive: true",
        )
    count = state_access.clear_notifications()
    return {"clearedCount": count}

# Bulk Operations Endpoints

@analytics_router.post("/bulk/templates/delete")
async def bulk_delete_templates(payload: BulkTemplateRequest) -> Dict[str, Any]:
    """Delete multiple templates in bulk."""
    template_ids = payload.templateIds

    deleted = []
    failed = []

    for tid in template_ids:
        try:
            state_access.delete_template(tid)
            deleted.append(tid)
            state_access.log_activity(
                action="template_deleted",
                entity_type="template",
                entity_id=tid,
            )
        except Exception as e:
            failed.append({"id": tid, "error": "Delete failed"})

    return {
        "deleted": deleted,
        "deletedCount": len(deleted),
        "failed": failed,
        "failedCount": len(failed),
    }

@analytics_router.post("/bulk/templates/update-status")
async def bulk_update_template_status(payload: BulkTemplateRequest) -> Dict[str, Any]:
    """Update status for multiple templates."""
    template_ids = payload.templateIds
    status = payload.status

    if not status:
        raise HTTPException(status_code=400, detail="Status is required")

    updated = []
    failed = []

    for tid in template_ids:
        try:
            record = state_access.get_template_record(tid)
            if not record:
                failed.append({"id": tid, "error": "Template not found"})
                continue

            state_access.upsert_template(
                tid,
                name=record.get("name") or tid,
                status=status,
                artifacts=record.get("artifacts"),
                tags=record.get("tags"),
                connection_id=record.get("last_connection_id"),
                mapping_keys=record.get("mapping_keys"),
                template_type=record.get("kind"),
                description=record.get("description"),
            )
            updated.append(tid)
            state_access.log_activity(
                action="template_status_updated",
                entity_type="template",
                entity_id=tid,
                details={"status": status},
            )
        except Exception as e:
            failed.append({"id": tid, "error": "Status update failed"})

    return {
        "updated": updated,
        "updatedCount": len(updated),
        "failed": failed,
        "failedCount": len(failed),
    }

@analytics_router.post("/bulk/templates/add-tags")
async def bulk_add_tags(payload: BulkTemplateRequest) -> Dict[str, Any]:
    """Add tags to multiple templates."""
    template_ids = payload.templateIds
    tags_to_add = payload.tags or []

    if not tags_to_add:
        raise HTTPException(status_code=400, detail="No tags provided")

    updated = []
    failed = []

    for tid in template_ids:
        try:
            record = state_access.get_template_record(tid)
            if not record:
                failed.append({"id": tid, "error": "Template not found"})
                continue

            existing_tags = list(record.get("tags") or [])
            merged_tags = sorted(set(existing_tags + tags_to_add))

            state_access.upsert_template(
                tid,
                name=record.get("name") or tid,
                status=record.get("status") or "draft",
                artifacts=record.get("artifacts"),
                tags=merged_tags,
                connection_id=record.get("last_connection_id"),
                mapping_keys=record.get("mapping_keys"),
                template_type=record.get("kind"),
                description=record.get("description"),
            )
            updated.append(tid)
        except Exception as e:
            failed.append({"id": tid, "error": "Tag update failed"})

    return {
        "updated": updated,
        "updatedCount": len(updated),
        "failed": failed,
        "failedCount": len(failed),
    }

@analytics_router.post("/bulk/jobs/cancel")
async def bulk_cancel_jobs(payload: BulkJobRequest) -> Dict[str, Any]:
    """Cancel multiple jobs."""
    job_ids = payload.jobIds

    cancelled = []
    failed = []

    for jid in job_ids:
        try:
            job = state_access.get_job(jid)
            if not job:
                failed.append({"id": jid, "error": "Job not found"})
                continue

            status = _normalize_job_status(job.get("status"))
            if status in ("succeeded", "failed", "cancelled"):
                failed.append({"id": jid, "error": f"Cannot cancel job with status: {status}"})
                continue

            state_access.update_job(jid, status="cancelled")
            cancelled.append(jid)
            state_access.log_activity(
                action="job_cancelled",
                entity_type="job",
                entity_id=jid,
            )
        except Exception as e:
            failed.append({"id": jid, "error": "Cancel failed"})

    return {
        "cancelled": cancelled,
        "cancelledCount": len(cancelled),
        "failed": failed,
        "failedCount": len(failed),
    }

@analytics_router.post("/bulk/jobs/delete")
async def bulk_delete_jobs(payload: BulkJobRequest) -> Dict[str, Any]:
    """Delete multiple jobs from history."""
    job_ids = payload.jobIds

    deleted = []
    failed = []

    for jid in job_ids:
        try:
            state_access.delete_job(jid)
            deleted.append(jid)
        except Exception as e:
            failed.append({"id": jid, "error": "Delete failed"})

    return {
        "deleted": deleted,
        "deletedCount": len(deleted),
        "failed": failed,
        "failedCount": len(failed),
    }

# AI Analytics Endpoints

from backend.app.schemas import (
    InsightsRequest,
    InsightsResponse,
    TrendRequest,
    TrendResponse,
    AnomaliesRequest,
    AnomaliesResponse,
    CorrelationsRequest,
    CorrelationsResponse,
    WhatIfRequest,
    WhatIfResponse,
)
from backend.app.services.ai_services import (
    insight_service,
    trend_service,
    anomaly_service,
    correlation_service,
    whatif_service,
)

@analytics_router.post("/insights", response_model=InsightsResponse)
async def generate_insights(request: InsightsRequest) -> InsightsResponse:
    """Generate automated insights from data.

    Analyzes data series to discover trends, anomalies, distributions,
    and other notable patterns.
    """
    return await insight_service.generate_insights(request)

@analytics_router.post("/trends", response_model=TrendResponse)
async def analyze_trends(request: TrendRequest) -> TrendResponse:
    """Analyze trends and generate forecasts.

    Uses linear regression, exponential smoothing, ARIMA, or Prophet
    to detect trends and forecast future values.
    """
    return await trend_service.analyze_trend(request)

@analytics_router.post("/anomalies", response_model=AnomaliesResponse)
async def detect_anomalies(request: AnomaliesRequest) -> AnomaliesResponse:
    """Detect anomalies in data.

    Uses statistical methods to identify point anomalies,
    contextual anomalies, and collective anomalies.
    """
    return await anomaly_service.detect_anomalies(request)

@analytics_router.post("/correlations", response_model=CorrelationsResponse)
async def analyze_correlations(request: CorrelationsRequest) -> CorrelationsResponse:
    """Analyze correlations between data series.

    Calculates Pearson, Spearman, or Kendall correlation coefficients
    between all pairs of variables.
    """
    return await correlation_service.analyze_correlations(request)

@analytics_router.post("/whatif", response_model=WhatIfResponse)
async def what_if_analysis(request: WhatIfRequest) -> WhatIfResponse:
    """Perform what-if scenario analysis.

    Evaluates how changes to input variables might affect
    a target variable based on historical relationships.
    """
    return await whatif_service.analyze_whatif(request)

"""
Dashboard API Routes - Dashboard building and analytics endpoints.

All CRUD is delegated to persistent service classes backed by the
StateStore.  No in-memory dicts — dashboards survive server restarts.
"""

from pydantic import BaseModel, Field, field_validator

from backend.app.services.dashboards_service import DashboardService
from backend.app.services.dashboards_service import WidgetService
from backend.app.services.dashboards_service import SnapshotService
from backend.app.services.dashboards_service import EmbedService
# insight_service, trend_service, anomaly_service, correlation_service already imported above
from backend.app.schemas import (
    DataSeries,
    InsightsRequest,
    TrendRequest,
    AnomaliesRequest,
    CorrelationsRequest,
    ForecastMethod,
)
from backend.app.services.ai_services import NL2SQLService
from backend.app.schemas import NL2SQLExecuteRequest
from backend.app.utils import is_read_only_sql

logger = logging.getLogger("neura.api.dashboards")

dashboards_router = APIRouter(tags=["dashboards"], dependencies=[Depends(require_api_key)])

# Maximum rows accepted by inline analytics endpoints
MAX_ANALYTICS_ROWS = 10_000

# Service singletons
_dashboard_svc = DashboardService()
_widget_svc = WidgetService()
_snapshot_svc = SnapshotService()
_embed_svc = EmbedService()
_nl2sql_svc = NL2SQLService()

# Schemas

# All valid widget types: legacy types + intelligent widget scenarios
_LEGACY_WIDGET_TYPES = {"chart", "metric", "table", "text", "filter", "map"}
_SCENARIO_WIDGET_TYPES = {
    "kpi", "alerts", "trend", "trend-multi-line", "trends-cumulative",
    "comparison", "distribution", "composition", "category-bar",
    "flow-sankey", "matrix-heatmap", "timeline", "eventlogstream",
    "narrative", "peopleview", "peoplehexgrid", "peoplenetwork",
    "supplychainglobe", "edgedevicepanel", "chatstream",
    "diagnosticpanel", "uncertaintypanel", "agentsview", "vaultview",
}

class WidgetConfig(BaseModel):
    """Widget configuration — supports both legacy types and intelligent widget scenarios."""

    type: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=255)
    data_source: Optional[str] = None
    query: Optional[str] = Field(None, max_length=10_000)
    chart_type: Optional[str] = None
    variant: Optional[str] = None
    scenario: Optional[str] = None
    options: dict[str, Any] = {}

    @field_validator("type")
    @classmethod
    def validate_widget_type(cls, v: str) -> str:
        base_type = v.split(":")[0]
        if base_type not in _LEGACY_WIDGET_TYPES and v not in _SCENARIO_WIDGET_TYPES:
            raise ValueError(
                f"Invalid widget type: {v}. Must be a legacy type "
                f"(chart, metric, table, text, filter, map) or a scenario type."
            )
        return v

    @field_validator("query")
    @classmethod
    def validate_query_is_read_only(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        ok, reason = is_read_only_sql(v)
        if not ok:
            raise ValueError(f"Widget query must be read-only: {reason}")
        return v

class DashboardWidget(BaseModel):
    """Dashboard widget with position."""

    id: str
    config: WidgetConfig
    x: int = 0
    y: int = 0
    w: int = 4
    h: int = 3

class CreateDashboardRequest(BaseModel):
    """Create dashboard request."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    widgets: list[DashboardWidget] = []
    filters: list[dict[str, Any]] = []
    theme: Optional[str] = None

class UpdateDashboardRequest(BaseModel):
    """Update dashboard request."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    widgets: Optional[list[DashboardWidget]] = None
    filters: Optional[list[dict[str, Any]]] = None
    theme: Optional[str] = None
    refresh_interval: Optional[int] = Field(None, ge=5, le=86400)
    metadata: Optional[dict[str, Any]] = None

class AddWidgetRequest(BaseModel):
    """Add widget request."""

    config: WidgetConfig
    x: int = Field(0, ge=0, le=11)
    y: int = Field(0, ge=0, le=99)
    w: int = Field(4, ge=1, le=12)
    h: int = Field(3, ge=1, le=20)

class UpdateWidgetRequest(BaseModel):
    """Update widget request — all fields optional."""

    config: Optional[WidgetConfig] = None
    x: Optional[int] = Field(None, ge=0, le=11)
    y: Optional[int] = Field(None, ge=0, le=99)
    w: Optional[int] = Field(None, ge=1, le=12)
    h: Optional[int] = Field(None, ge=1, le=20)

class WidgetLayoutItem(BaseModel):
    """Single widget layout position update."""

    widget_id: str
    x: int
    y: int
    w: int = Field(..., ge=1)
    h: int = Field(..., ge=1)

class UpdateLayoutRequest(BaseModel):
    """Update layout positions for all widgets."""

    items: list[WidgetLayoutItem]

class DashboardFilterRequest(BaseModel):
    """Add or update a dashboard filter."""

    field: str = Field(..., min_length=1, max_length=255)
    operator: str = Field(..., pattern="^(eq|neq|gt|gte|lt|lte|in|not_in|contains|between)$")
    value: Any
    label: Optional[str] = None

class DashboardVariableRequest(BaseModel):
    """Set a dashboard variable value."""

    value: Any

class WhatIfRequest(BaseModel):
    """Run a what-if simulation."""

    variable_changes: dict[str, Any]
    metrics_to_evaluate: list[str] = Field(..., min_length=1)

class ShareDashboardRequest(BaseModel):
    """Share a dashboard with users."""

    users: list[str] = Field(..., min_length=1)
    permission: str = Field("view", pattern="^(view|edit|admin)$")

class DashboardResponse(BaseModel):
    """Dashboard response."""

    id: str
    name: str
    description: Optional[str]
    widgets: list[DashboardWidget]
    filters: list[dict[str, Any]]
    theme: Optional[str]
    refresh_interval: Optional[int]
    metadata: Optional[dict[str, Any]] = None
    created_at: str
    updated_at: str

# Dashboard CRUD Endpoints

@dashboards_router.post("", response_model=DashboardResponse)
async def create_dashboard(request: CreateDashboardRequest):
    """Create a new dashboard."""
    dashboard = _dashboard_svc.create_dashboard(
        name=request.name,
        description=request.description,
        widgets=[w.model_dump() for w in request.widgets],
        filters=request.filters,
        theme=request.theme,
    )
    return DashboardResponse(**dashboard)

@dashboards_router.get("")
async def list_dashboards(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """List all dashboards."""
    return _dashboard_svc.list_dashboards(limit=limit, offset=offset)

# Static-path routes (must precede /{dashboard_id})

@dashboards_router.get("/stats")
async def get_dashboard_stats():
    """Get dashboard statistics."""
    return _dashboard_svc.get_stats()

@dashboards_router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str):
    """Get a snapshot by ID and return its URL and content hash."""
    snapshot = _snapshot_svc.get_snapshot(snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {
        "snapshot_id": snapshot["id"],
        "url": snapshot.get("url"),
        "content_hash": snapshot.get("content_hash"),
        "format": snapshot.get("format"),
        "status": snapshot.get("status", "completed"),
        "created_at": snapshot.get("created_at"),
    }

@dashboards_router.get("/templates")
async def list_dashboard_templates():
    """List available dashboard templates."""
    templates = _dashboard_svc.list_templates()
    return {"templates": templates}

@dashboards_router.post("/templates/{template_id}/create", response_model=DashboardResponse)
async def create_dashboard_from_template(
    template_id: str,
    name: Optional[str] = Query(None, min_length=1, max_length=255),
):
    """Create a new dashboard from an existing template."""
    template = _dashboard_svc.get_template(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Template not found")

    dashboard_name = name or f"{template.get('name', 'Dashboard')} (copy)"
    dashboard = _dashboard_svc.create_dashboard(
        name=dashboard_name,
        description=template.get("description"),
        widgets=template.get("widgets", []),
        filters=template.get("filters", []),
        theme=template.get("theme"),
    )
    logger.info(
        "dashboard_created_from_template",
        extra={
            "event": "dashboard_created_from_template",
            "template_id": template_id,
            "dashboard_id": dashboard["id"],
        },
    )
    return DashboardResponse(**dashboard)

@dashboards_router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(dashboard_id: str):
    """Get a dashboard by ID."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return DashboardResponse(**dashboard)

@dashboards_router.put("/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(dashboard_id: str, request: UpdateDashboardRequest):
    """Update a dashboard."""
    widgets = [w.model_dump() for w in request.widgets] if request.widgets is not None else None
    # Merge user-supplied metadata with existing (preserve sharing etc.)
    merged_metadata = request.metadata
    if merged_metadata is not None:
        existing = _dashboard_svc.get_dashboard(dashboard_id)
        if existing and existing.get("metadata"):
            merged_metadata = {**existing["metadata"], **merged_metadata}

    dashboard = _dashboard_svc.update_dashboard(
        dashboard_id,
        name=request.name,
        description=request.description,
        widgets=widgets,
        filters=request.filters,
        theme=request.theme,
        refresh_interval=request.refresh_interval,
        metadata=merged_metadata,
    )
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return DashboardResponse(**dashboard)

@dashboards_router.delete("/{dashboard_id}")
async def delete_dashboard(dashboard_id: str):
    """Delete a dashboard."""
    if not _dashboard_svc.delete_dashboard(dashboard_id):
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return {"status": "ok", "message": "Dashboard deleted"}

# Widget Endpoints

@dashboards_router.post("/{dashboard_id}/widgets")
async def add_widget(dashboard_id: str, request: AddWidgetRequest):
    """Add a widget to a dashboard."""
    try:
        widget = _widget_svc.add_widget(
            dashboard_id,
            config=request.config.model_dump(),
            x=request.x,
            y=request.y,
            w=request.w,
            h=request.h,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return widget

@dashboards_router.put("/{dashboard_id}/widgets/{widget_id}")
async def update_widget(
    dashboard_id: str,
    widget_id: str,
    request: UpdateWidgetRequest,
):
    """Update a widget."""
    widget = _widget_svc.update_widget(
        dashboard_id,
        widget_id,
        config=request.config.model_dump() if request.config else None,
        x=request.x,
        y=request.y,
        w=request.w,
        h=request.h,
    )
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")
    return widget

@dashboards_router.delete("/{dashboard_id}/widgets/{widget_id}")
async def delete_widget(dashboard_id: str, widget_id: str):
    """Delete a widget from a dashboard."""
    if not _widget_svc.delete_widget(dashboard_id, widget_id):
        raise HTTPException(status_code=404, detail="Widget not found")
    return {"status": "ok", "message": "Widget deleted"}

# Snapshot & Embed Endpoints

@dashboards_router.post("/{dashboard_id}/snapshot")
async def create_snapshot(
    dashboard_id: str,
    format: str = Query("png", pattern="^(png|pdf)$"),
):
    """Create a snapshot of the dashboard and trigger rendering."""
    try:
        snapshot = _snapshot_svc.create_snapshot(dashboard_id, format=format)
    except ValueError:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    # Render in a thread so the sync Playwright call doesn't block the
    # ASGI event loop.
    loop = asyncio.get_running_loop()
    rendered = await loop.run_in_executor(
        None, _snapshot_svc.render_snapshot, snapshot["id"]
    )

    return {
        "status": "ok",
        "snapshot_id": rendered["id"],
        "format": rendered["format"],
        "render_status": rendered.get("status", "pending"),
        "content_hash": rendered["content_hash"],
        "created_at": rendered["created_at"],
    }

@dashboards_router.post("/{dashboard_id}/embed")
async def generate_embed_token(
    dashboard_id: str,
    expires_hours: int = Query(24, ge=1, le=720),
):
    """Generate an embed token for the dashboard."""
    try:
        result = _embed_svc.generate_embed_token(
            dashboard_id,
            expires_hours=expires_hours,
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return {
        "status": "ok",
        "embed_token": result["embed_token"],
        "embed_url": result["embed_url"],
        "expires_hours": result["expires_hours"],
        "expires_at": result["expires_at"],
    }

# Analytics Endpoints

@dashboards_router.post("/{dashboard_id}/query")
async def execute_widget_query(
    dashboard_id: str,
    widget_id: str = Query(...),
    filters: Optional[dict[str, Any]] = None,
):
    """Execute a widget's query with optional filters."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widget = _widget_svc.get_widget(dashboard_id, widget_id)
    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")

    config = widget.get("config", {})
    sql_query = config.get("query")
    connection_id = config.get("data_source")

    if not sql_query or not connection_id:
        return {
            "widget_id": widget_id,
            "data": [],
            "metadata": {"reason": "Widget has no query or data_source configured"},
        }

    try:
        result = _nl2sql_svc.execute_query(
            NL2SQLExecuteRequest(
                sql=sql_query,
                connection_id=connection_id,
            ),
        )
        return {
            "widget_id": widget_id,
            "data": result.rows,
            "metadata": {
                "columns": result.columns,
                "row_count": result.row_count,
                "execution_time_ms": result.execution_time_ms,
                "truncated": result.truncated,
            },
        }
    except Exception as exc:
        logger.warning(
            "widget_query_failed",
            extra={
                "event": "widget_query_failed",
                "dashboard_id": dashboard_id,
                "widget_id": widget_id,
                "error": str(exc),
            },
        )
        logger.exception("Widget query execution failed: %s", exc)
        raise HTTPException(status_code=422, detail="Query execution failed")

@dashboards_router.post("/analytics/insights")
async def generate_insights(
    data: list[dict[str, Any]],
    context: Optional[str] = None,
):
    """Generate AI insights from data.

    Converts raw data dicts into DataSeries and delegates to the
    analytics InsightService.
    """
    if len(data) > MAX_ANALYTICS_ROWS:
        raise HTTPException(status_code=422, detail=f"Data exceeds maximum of {MAX_ANALYTICS_ROWS} rows")
    series = _dicts_to_series(data)
    if not series:
        raise HTTPException(status_code=422, detail="No numeric data series found in input")

    request = InsightsRequest(data=series, context=context)
    result = await insight_service.generate_insights(request)
    return result.model_dump()

@dashboards_router.post("/analytics/trends")
async def predict_trends(
    data: list[dict[str, Any]],
    date_column: str,
    value_column: str,
    periods: int = Query(12, ge=1, le=100),
):
    """Predict future trends from time series data.

    Extracts the named value column from the data dicts and delegates
    to the analytics TrendService.
    """
    if len(data) > MAX_ANALYTICS_ROWS:
        raise HTTPException(status_code=422, detail=f"Data exceeds maximum of {MAX_ANALYTICS_ROWS} rows")
    values = [
        float(row[value_column])
        for row in data
        if value_column in row and _is_numeric(row[value_column])
    ]
    if len(values) < 2:
        raise HTTPException(status_code=422, detail=f"Need at least 2 numeric values in '{value_column}'")

    request = TrendRequest(
        data=DataSeries(name=value_column, values=values),
        forecast_periods=periods,
        method=ForecastMethod.AUTO,
    )
    result = await trend_service.analyze_trend(request)
    return result.model_dump()

@dashboards_router.post("/analytics/anomalies")
async def detect_anomalies(
    data: list[dict[str, Any]],
    columns: list[str],
    method: str = Query("zscore", pattern="^(zscore|iqr|isolation_forest)$"),
):
    """Detect anomalies in data.

    Runs anomaly detection on each requested column via the
    analytics AnomalyService.  Results are aggregated across columns.

    Note: only ``zscore`` method is currently implemented in the
    analytics engine.  ``iqr`` and ``isolation_forest`` are accepted
    for forward compatibility but fall back to z-score with a warning.
    """
    if len(data) > MAX_ANALYTICS_ROWS:
        raise HTTPException(status_code=422, detail=f"Data exceeds maximum of {MAX_ANALYTICS_ROWS} rows")
    if method != "zscore":
        logger.warning(
            "anomaly_method_unsupported",
            extra={
                "event": "anomaly_method_unsupported",
                "requested": method,
                "fallback": "zscore",
            },
        )

    all_anomalies: list[dict[str, Any]] = []
    all_stats: dict[str, Any] = {}

    for col in columns:
        values = [
            float(row[col])
            for row in data
            if col in row and _is_numeric(row[col])
        ]
        if len(values) < 3:
            continue
        request = AnomaliesRequest(data=DataSeries(name=col, values=values))
        result = await anomaly_service.detect_anomalies(request)
        all_anomalies.extend([a.model_dump() for a in result.anomalies])
        all_stats[col] = result.baseline_stats

    return {
        "anomalies": all_anomalies,
        "statistics": all_stats,
        "method_used": "zscore",
        "narrative": (
            f"Detected {len(all_anomalies)} anomalies across {len(columns)} columns."
            if all_anomalies
            else "No anomalies detected."
        ),
    }

@dashboards_router.post("/analytics/correlations")
async def find_correlations(
    data: list[dict[str, Any]],
    columns: Optional[list[str]] = None,
):
    """Find correlations between columns.

    Extracts numeric columns from the data dicts and delegates to the
    analytics CorrelationService.
    """
    if len(data) > MAX_ANALYTICS_ROWS:
        raise HTTPException(status_code=422, detail=f"Data exceeds maximum of {MAX_ANALYTICS_ROWS} rows")
    target_cols = columns
    if not target_cols and data:
        target_cols = _detect_numeric_columns(data)

    if not target_cols or len(target_cols) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 numeric columns for correlation analysis")

    series = []
    for col in target_cols:
        values = [
            float(row.get(col, float("nan")))
            if _is_numeric(row.get(col))
            else float("nan")
            for row in data
        ]
        series.append(DataSeries(name=col, values=values))

    request = CorrelationsRequest(data=series)
    result = await correlation_service.analyze_correlations(request)
    return result.model_dump()

# ── Helpers ──────────────────────────────────────────────────────────

def _is_numeric(value: Any) -> bool:
    """Return True if value can be cast to float."""
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except (ValueError, TypeError):
            return False
    return False

def _detect_numeric_columns(data: list[dict[str, Any]]) -> list[str]:
    """Return column names that contain at least one numeric value across all rows."""
    if not data:
        return []
    all_keys: dict[str, bool] = {}
    for row in data:
        for k, v in row.items():
            if k not in all_keys and _is_numeric(v):
                all_keys[k] = True
    return list(all_keys)

def _dicts_to_series(data: list[dict[str, Any]]) -> list[DataSeries]:
    """Convert a list of row-dicts to DataSeries (one per numeric column)."""
    cols = _detect_numeric_columns(data)
    series = []
    for col in cols:
        values = [
            float(row[col]) if col in row and _is_numeric(row[col]) else float("nan")
            for row in data
        ]
        series.append(DataSeries(name=col, values=values))
    return series

# Layout, Refresh, Filters, Variables, What-If,
# Templates, Sharing, and Export Endpoints

@dashboards_router.put("/{dashboard_id}/layout")
async def update_widget_layout(dashboard_id: str, request: UpdateLayoutRequest):
    """Update widget layout positions for all widgets in a dashboard."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    updated: list[dict[str, Any]] = []
    for item in request.items:
        widget = _widget_svc.update_widget(
            dashboard_id,
            item.widget_id,
            x=item.x,
            y=item.y,
            w=item.w,
            h=item.h,
        )
        if widget is None:
            raise HTTPException(
                status_code=404,
                detail=f"Widget {item.widget_id} not found",
            )
        updated.append(widget)

    logger.info(
        "layout_updated",
        extra={
            "event": "layout_updated",
            "dashboard_id": dashboard_id,
            "widget_count": len(updated),
        },
    )
    return {"status": "ok", "updated_widgets": len(updated), "layout": updated}

@dashboards_router.post("/{dashboard_id}/refresh")
async def refresh_dashboard(dashboard_id: str):
    """Refresh all widgets in a dashboard.

    Retrieves the dashboard, iterates over its widgets, and returns
    a per-widget refresh status.
    """
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widgets = dashboard.get("widgets", [])
    results: list[dict[str, Any]] = []

    for widget in widgets:
        widget_id = widget.get("id", "unknown")
        try:
            config = widget.get("config", {})
            sql_query = config.get("query")
            connection_id = config.get("data_source")

            if sql_query and connection_id:
                _nl2sql_svc.execute_query(
                    NL2SQLExecuteRequest(
                        sql=sql_query,
                        connection_id=connection_id,
                    ),
                )
                results.append({"widget_id": widget_id, "status": "refreshed"})
            else:
                results.append({"widget_id": widget_id, "status": "skipped", "reason": "no query configured"})
        except Exception as exc:
            logger.warning(
                "widget_refresh_failed",
                extra={
                    "event": "widget_refresh_failed",
                    "dashboard_id": dashboard_id,
                    "widget_id": widget_id,
                    "error": str(exc),
                },
            )
            results.append({"widget_id": widget_id, "status": "error", "error": str(exc)})

    logger.info(
        "dashboard_refreshed",
        extra={
            "event": "dashboard_refreshed",
            "dashboard_id": dashboard_id,
            "total_widgets": len(widgets),
        },
    )
    return {
        "status": "ok",
        "dashboard_id": dashboard_id,
        "total_widgets": len(widgets),
        "results": results,
    }

@dashboards_router.post("/{dashboard_id}/filters")
async def add_dashboard_filter(dashboard_id: str, request: DashboardFilterRequest):
    """Add a filter to a dashboard."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    new_filter: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "field": request.field,
        "operator": request.operator,
        "value": request.value,
        "label": request.label or request.field,
    }

    filters = dashboard.get("filters", [])
    filters.append(new_filter)

    updated = _dashboard_svc.update_dashboard(dashboard_id, filters=filters)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update dashboard filters")

    logger.info(
        "filter_added",
        extra={
            "event": "filter_added",
            "dashboard_id": dashboard_id,
            "filter_id": new_filter["id"],
        },
    )
    return {"status": "ok", "filter": new_filter}

@dashboards_router.put("/{dashboard_id}/filters/{filter_id}")
async def update_dashboard_filter(
    dashboard_id: str,
    filter_id: str,
    request: DashboardFilterRequest,
):
    """Update an existing filter on a dashboard."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    filters = dashboard.get("filters", [])
    found = False
    for i, f in enumerate(filters):
        if f.get("id") == filter_id:
            filters[i] = {
                "id": filter_id,
                "field": request.field,
                "operator": request.operator,
                "value": request.value,
                "label": request.label or request.field,
            }
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail="Filter not found")

    updated = _dashboard_svc.update_dashboard(dashboard_id, filters=filters)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update dashboard filters")

    logger.info(
        "filter_updated",
        extra={
            "event": "filter_updated",
            "dashboard_id": dashboard_id,
            "filter_id": filter_id,
        },
    )
    return {"status": "ok", "filter": filters[i]}

@dashboards_router.delete("/{dashboard_id}/filters/{filter_id}")
async def delete_dashboard_filter(dashboard_id: str, filter_id: str):
    """Delete a filter from a dashboard."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    filters = dashboard.get("filters", [])
    original_len = len(filters)
    filters = [f for f in filters if f.get("id") != filter_id]

    if len(filters) == original_len:
        raise HTTPException(status_code=404, detail="Filter not found")

    updated = _dashboard_svc.update_dashboard(dashboard_id, filters=filters)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update dashboard filters")

    logger.info(
        "filter_deleted",
        extra={
            "event": "filter_deleted",
            "dashboard_id": dashboard_id,
            "filter_id": filter_id,
        },
    )
    return {"status": "ok", "message": "Filter deleted"}

@dashboards_router.put("/{dashboard_id}/variables/{variable_name}")
async def set_dashboard_variable(
    dashboard_id: str,
    variable_name: str,
    request: DashboardVariableRequest,
):
    """Set a dashboard variable value.

    Stores the variable in the dashboard's metadata dict so it can be
    referenced by widget queries and filters.
    """
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    metadata = dashboard.get("metadata", {})
    variables = metadata.get("variables", {})
    variables[variable_name] = request.value
    metadata["variables"] = variables

    updated = _dashboard_svc.update_dashboard(dashboard_id, metadata=metadata)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to update dashboard variable")

    logger.info(
        "variable_set",
        extra={
            "event": "variable_set",
            "dashboard_id": dashboard_id,
            "variable_name": variable_name,
        },
    )
    return {
        "status": "ok",
        "variable_name": variable_name,
        "value": request.value,
    }

@dashboards_router.post("/{dashboard_id}/what-if")
async def run_what_if_simulation(dashboard_id: str, request: WhatIfRequest):
    """Run a what-if simulation on dashboard data.

    Applies hypothetical variable changes and evaluates the requested
    metrics using the analytics services.
    """
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    simulation_results: dict[str, Any] = {}

    for metric in request.metrics_to_evaluate:
        try:
            # Collect baseline data from dashboard widgets for this metric
            baseline_values: list[float] = []
            for widget in dashboard.get("widgets", []):
                config = widget.get("config", {})
                if config.get("data_source") and config.get("query"):
                    result = _nl2sql_svc.execute_query(
                        NL2SQLExecuteRequest(
                            sql=config["query"],
                            connection_id=config["data_source"],
                        ),
                    )
                    for row in result.rows:
                        if metric in row and _is_numeric(row[metric]):
                            baseline_values.append(float(row[metric]))

            if len(baseline_values) < 2:
                simulation_results[metric] = {
                    "status": "insufficient_data",
                    "message": f"Not enough data points for metric '{metric}'",
                }
                continue

            # Apply variable changes as scaling factors
            adjusted_values = list(baseline_values)
            for var_name, change in request.variable_changes.items():
                if _is_numeric(change):
                    factor = float(change)
                    adjusted_values = [v * factor for v in adjusted_values]

            baseline_series = DataSeries(name=f"{metric}_baseline", values=baseline_values)
            adjusted_series = DataSeries(name=f"{metric}_adjusted", values=adjusted_values)

            baseline_request = InsightsRequest(data=[baseline_series], context="what-if baseline")
            adjusted_request = InsightsRequest(data=[adjusted_series], context="what-if adjusted")

            baseline_insights = await insight_service.generate_insights(baseline_request)
            adjusted_insights = await insight_service.generate_insights(adjusted_request)

            simulation_results[metric] = {
                "status": "ok",
                "baseline": baseline_insights.model_dump(),
                "adjusted": adjusted_insights.model_dump(),
                "variable_changes": request.variable_changes,
            }
        except Exception as exc:
            logger.warning(
                "what_if_metric_failed",
                extra={
                    "event": "what_if_metric_failed",
                    "dashboard_id": dashboard_id,
                    "metric": metric,
                    "error": str(exc),
                },
            )
            simulation_results[metric] = {
                "status": "error",
                "error": str(exc),
            }

    logger.info(
        "what_if_completed",
        extra={
            "event": "what_if_completed",
            "dashboard_id": dashboard_id,
            "metrics_evaluated": len(request.metrics_to_evaluate),
        },
    )
    return {
        "status": "ok",
        "dashboard_id": dashboard_id,
        "variable_changes": request.variable_changes,
        "results": simulation_results,
    }

@dashboards_router.post("/{dashboard_id}/save-as-template")
async def save_dashboard_as_template(
    dashboard_id: str,
    name: Optional[str] = Query(None, min_length=1, max_length=255),
):
    """Save an existing dashboard as a reusable template."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    template_id = str(uuid.uuid4())
    template: dict[str, Any] = {
        "id": template_id,
        "name": name or f"{dashboard.get('name', 'Dashboard')} Template",
        "description": dashboard.get("description"),
        "widgets": dashboard.get("widgets", []),
        "filters": dashboard.get("filters", []),
        "theme": dashboard.get("theme"),
        "source_dashboard_id": dashboard_id,
    }

    _dashboard_svc.save_template(template)

    logger.info(
        "template_saved",
        extra={
            "event": "template_saved",
            "dashboard_id": dashboard_id,
            "template_id": template_id,
        },
    )
    return {"status": "ok", "template_id": template_id, "template": template}

@dashboards_router.post("/{dashboard_id}/share")
async def share_dashboard(dashboard_id: str, request: ShareDashboardRequest):
    """Share a dashboard with other users."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    metadata = dashboard.get("metadata", {})
    sharing = metadata.get("sharing", [])

    for user in request.users:
        # Update existing entry or add new one
        existing = next((s for s in sharing if s.get("user") == user), None)
        if existing:
            existing["permission"] = request.permission
        else:
            sharing.append({
                "id": str(uuid.uuid4()),
                "user": user,
                "permission": request.permission,
            })

    metadata["sharing"] = sharing
    updated = _dashboard_svc.update_dashboard(dashboard_id, metadata=metadata)
    if updated is None:
        raise HTTPException(status_code=500, detail="Failed to share dashboard")

    logger.info(
        "dashboard_shared",
        extra={
            "event": "dashboard_shared",
            "dashboard_id": dashboard_id,
            "shared_with": request.users,
            "permission": request.permission,
        },
    )
    return {
        "status": "ok",
        "dashboard_id": dashboard_id,
        "shared_with": request.users,
        "permission": request.permission,
    }

@dashboards_router.get("/{dashboard_id}/export")
async def export_dashboard(dashboard_id: str):
    """Export a complete dashboard and all its data as JSON."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    widget_data: list[dict[str, Any]] = []
    for widget in dashboard.get("widgets", []):
        widget_id = widget.get("id", "unknown")
        config = widget.get("config", {})
        sql_query = config.get("query")
        connection_id = config.get("data_source")

        entry: dict[str, Any] = {
            "widget_id": widget_id,
            "config": config,
            "x": widget.get("x"),
            "y": widget.get("y"),
            "w": widget.get("w"),
            "h": widget.get("h"),
        }

        if sql_query and connection_id:
            try:
                result = _nl2sql_svc.execute_query(
                    NL2SQLExecuteRequest(
                        sql=sql_query,
                        connection_id=connection_id,
                    ),
                )
                entry["data"] = {
                    "rows": result.rows,
                    "columns": result.columns,
                    "row_count": result.row_count,
                }
            except Exception as exc:
                logger.warning(
                    "export_widget_query_failed",
                    extra={
                        "event": "export_widget_query_failed",
                        "dashboard_id": dashboard_id,
                        "widget_id": widget_id,
                        "error": str(exc),
                    },
                )
                entry["data"] = {"error": str(exc)}
        else:
            entry["data"] = None

        widget_data.append(entry)

    logger.info(
        "dashboard_exported",
        extra={
            "event": "dashboard_exported",
            "dashboard_id": dashboard_id,
            "widget_count": len(widget_data),
        },
    )
    return {
        "dashboard_id": dashboard_id,
        "name": dashboard.get("name"),
        "description": dashboard.get("description"),
        "theme": dashboard.get("theme"),
        "filters": dashboard.get("filters", []),
        "refresh_interval": dashboard.get("refresh_interval"),
        "metadata": dashboard.get("metadata", {}),
        "widgets": widget_data,
        "created_at": dashboard.get("created_at"),
        "updated_at": dashboard.get("updated_at"),
    }

# Auto-Compose (Widget Intelligence)

class AutoComposeRequest(BaseModel):
    """Auto-compose widgets for a dashboard using AI selection."""

    query: str = Field(..., min_length=1, max_length=2000)
    query_type: str = Field(default="overview")
    max_widgets: int = Field(default=8, ge=1, le=20)

@dashboards_router.post("/{dashboard_id}/auto-compose")
async def auto_compose_dashboard(dashboard_id: str, req: AutoComposeRequest):
    """Use AI to auto-compose widgets for an existing dashboard."""
    dashboard = _dashboard_svc.get_dashboard(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    from backend.app.services.widget_intelligence import WidgetIntelligenceService
    intelligence_svc = WidgetIntelligenceService()

    widgets = intelligence_svc.select_widgets(
        query=req.query,
        query_type=req.query_type,
        max_widgets=req.max_widgets,
    )
    layout = intelligence_svc.pack_grid(widgets)

    new_widgets = []
    for w, cell in zip(widgets, layout.get("cells", [])):
        demo_data = intelligence_svc.get_demo_data(w["scenario"])
        new_widgets.append({
            "id": w["id"],
            "config": {
                "type": w["scenario"],
                "title": w.get("question", w["scenario"]),
                "variant": w["variant"],
                "scenario": w["scenario"],
            },
            "x": cell["col_start"] - 1,
            "y": cell["row_start"] - 1,
            "w": cell["col_end"] - cell["col_start"],
            "h": cell["row_end"] - cell["row_start"],
            "data": demo_data,
        })

    existing_widgets = dashboard.get("widgets", [])
    updated = _dashboard_svc.update_dashboard(
        dashboard_id,
        widgets=existing_widgets + new_widgets,
    )
    return {"dashboard": updated, "added_widgets": len(new_widgets)}
