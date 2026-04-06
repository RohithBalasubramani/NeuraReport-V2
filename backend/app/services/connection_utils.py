"""Connection reference utilities -- moved from legacy_all.py.

Provides ConnectionRef, get_loader_for_ref, db_path_from_payload_or_default,
and related helpers for resolving database connections.
"""
from __future__ import annotations

import importlib
import os
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from backend.app.common import get_state_store, http_error
from backend.app.repositories import resolve_db_path, resolve_connection_ref
from backend.app.repositories import state_store as state_store_module






class ConnectionRef:
    """Connection reference that's backward-compatible with Path for SQLite.

    Wraps either a SQLite path or PostgreSQL URL so that callers that do
    ``ref.exists()`` or ``str(ref)`` continue to work, while PostgreSQL-
    aware callers can check ``ref.is_postgresql`` and use ``ref.connection_url``.
    """

    def __init__(
        self,
        db_type: str = "sqlite",
        db_path: Path | None = None,
        connection_url: str | None = None,
        connection_id: str | None = None,
    ):
        self.db_type = db_type
        self._db_path = Path(db_path) if db_path else None
        self.connection_url = connection_url
        self.connection_id = connection_id

    @property
    def is_postgresql(self) -> bool:
        return self.db_type in ("postgresql", "postgres")

    def exists(self) -> bool:
        if self.is_postgresql:
            return True  # PostgreSQL connections are verified at save time
        return self._db_path.exists() if self._db_path else False

    def __str__(self) -> str:
        if self.is_postgresql:
            return self.connection_url or f"postgresql://{self.connection_id}"
        return str(self._db_path) if self._db_path else ""

    def __fspath__(self) -> str:
        """Allow use as os.fspath() for SQLite connections."""
        if self.is_postgresql:
            raise TypeError(
                "PostgreSQL connections don't have filesystem paths. "
                "Use connection_url or get_loader_for_ref() instead."
            )
        return str(self._db_path) if self._db_path else ""

    def __repr__(self) -> str:
        if self.is_postgresql:
            return f"ConnectionRef(postgresql, url={self.connection_url!r}, id={self.connection_id!r})"
        return f"ConnectionRef(sqlite, path={self._db_path!r}, id={self.connection_id!r})"

    @property
    def name(self) -> str:
        if self.is_postgresql:
            parts = (self.connection_url or "").split("/")
            return parts[-1] if parts else "postgresql"
        return self._db_path.name if self._db_path else ""

    @property
    def parent(self) -> Path:
        if self._db_path:
            return self._db_path.parent
        return Path(".")

    # --- Convenience: allow Path(ref) for SQLite ---
    def resolve(self) -> Path:
        if self.is_postgresql:
            raise TypeError("PostgreSQL connections don't have filesystem paths.")
        return self._db_path.resolve() if self._db_path else Path(".").resolve()


def get_loader_for_ref(ref):
    """Get the appropriate DataFrame loader for any connection type.

    Returns SQLiteDataFrameLoader for SQLite, PostgresDataFrameLoader for PostgreSQL.
    Accepts ConnectionRef, Path, or str.
    """
    if isinstance(ref, ConnectionRef) and ref.is_postgresql:
        from backend.app.repositories import get_postgres_loader
        return get_postgres_loader(ref.connection_url)
    else:
        from backend.app.repositories import get_loader
        path = ref._db_path if isinstance(ref, ConnectionRef) else Path(ref)
        return get_loader(path)


def verify_connection(ref) -> None:
    """Verify a connection reference (SQLite file or PostgreSQL URL)."""
    if isinstance(ref, ConnectionRef) and ref.is_postgresql:
        from backend.app.repositories import verify_postgres
        verify_postgres(ref.connection_url)
    else:
        from backend.app.repositories import verify_sqlite
        path = ref._db_path if isinstance(ref, ConnectionRef) else Path(ref)
        verify_sqlite(path)


def display_name_for_path(db_path, db_type: str = "sqlite") -> str:
    if isinstance(db_path, ConnectionRef):
        return db_path.name
    base = Path(db_path).name if db_path else ""
    if db_type.lower() == "sqlite":
        return base
    return f"{db_type}:{base}"


def _resolve_ref_for_conn_id(conn_id: str) -> ConnectionRef | None:
    """Try to resolve a connection_id to a ConnectionRef using the new ref system."""
    try:
        ref = resolve_connection_ref(conn_id)
        if ref["db_type"] in ("postgresql", "postgres"):
            return ConnectionRef(
                db_type="postgresql",
                connection_url=ref["connection_url"],
                connection_id=conn_id,
            )
        elif ref.get("db_path"):
            return ConnectionRef(
                db_type="sqlite",
                db_path=ref["db_path"],
                connection_id=conn_id,
            )
    except Exception:
        pass
    return None


def db_path_from_payload_or_default(conn_id: Optional[str]) -> ConnectionRef:
    """
    Resolve a connection reference using the same precedence as the legacy api.py helper.
    Returns ConnectionRef (backward-compatible with Path for SQLite connections).
    """
    resolve_db_path_fn = resolve_db_path
    try:
        api_mod = importlib.import_module("backend.api")
        override = getattr(api_mod, "_db_path_from_payload_or_default", None)
        if override and override is not db_path_from_payload_or_default:
            result = override(conn_id)
            if isinstance(result, ConnectionRef):
                return result
            return ConnectionRef(db_type="sqlite", db_path=result, connection_id=conn_id)
        resolve_db_path_fn = getattr(api_mod, "resolve_db_path", resolve_db_path)
    except Exception:
        pass

    if conn_id:
        # Try the new resolve_connection_ref first (handles both SQLite and PostgreSQL)
        ref = _resolve_ref_for_conn_id(conn_id)
        if ref is not None:
            return ref

        # Legacy fallback: check secrets/records for database_path
        secrets = get_state_store().get_connection_secrets(conn_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=conn_id)
        record = get_state_store().get_connection_record(conn_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=conn_id)
        try:
            path = resolve_db_path_fn(connection_id=conn_id, db_url=None, db_path=None)
            return ConnectionRef(db_type="sqlite", db_path=path, connection_id=conn_id)
        except Exception:
            pass

    last_used = get_state_store().get_last_used()
    if last_used.get("connection_id"):
        lu_conn_id = last_used["connection_id"]
        ref = _resolve_ref_for_conn_id(lu_conn_id)
        if ref is not None:
            return ref
        secrets = get_state_store().get_connection_secrets(lu_conn_id)
        if secrets and secrets.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(secrets["database_path"]), connection_id=lu_conn_id)
        record = get_state_store().get_connection_record(lu_conn_id)
        if record and record.get("database_path"):
            return ConnectionRef(db_type="sqlite", db_path=Path(record["database_path"]), connection_id=lu_conn_id)

    env_db = os.getenv("NR_DEFAULT_DB") or os.getenv("DB_PATH")
    if env_db:
        return ConnectionRef(db_type="sqlite", db_path=Path(env_db))

    latest = get_state_store().get_latest_connection()
    if latest and latest.get("database_path"):
        return ConnectionRef(db_type="sqlite", db_path=Path(latest["database_path"]))

    raise http_error(
        400,
        "db_missing",
        "No database configured. Connect once or set NR_DEFAULT_DB/DB_PATH env.",
    )
