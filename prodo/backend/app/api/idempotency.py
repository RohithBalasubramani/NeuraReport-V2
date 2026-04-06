"""Idempotency key store and middleware (extracted to avoid __future__ annotations conflict with SQLModel)."""
import base64
import hashlib
import os
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import Request
from fastapi.responses import Response
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, Session, SQLModel, create_engine
from starlette.middleware.base import BaseHTTPMiddleware

from backend.app.services.config import get_settings


class IdempotencyRecord(SQLModel, table=True):
    __tablename__ = "idempotency_keys"

    key: str = Field(primary_key=True)
    request_hash: str
    status_code: int
    response_body_b64: str
    response_headers: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime
    expires_at: datetime


def _idempotency_db_url() -> str:
    settings = get_settings()
    override = os.getenv("NEURA_IDEMPOTENCY_DB_PATH")
    if override:
        path = Path(override).expanduser()
    else:
        state_db = os.getenv("NEURA_STATE_DB_PATH")
        if state_db:
            path = Path(state_db).expanduser()
        else:
            if os.getenv("PYTEST_CURRENT_TEST") or "pytest" in sys.modules:
                path = Path(tempfile.gettempdir()) / f"neurareport-idempotency-{os.getpid()}-{uuid.uuid4().hex}.sqlite3"
            else:
                path = settings.state_dir / "idempotency.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


class IdempotencyStore:
    def __init__(self) -> None:
        self._engine = create_engine(
            _idempotency_db_url(),
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self._engine, tables=[IdempotencyRecord.__table__])

    def get(self, key: str, request_hash: str) -> Optional[IdempotencyRecord]:
        now = datetime.now(timezone.utc)
        with Session(self._engine) as session:
            record = session.get(IdempotencyRecord, key)
            if record is None:
                return None
            if record.request_hash != request_hash:
                return None
            expires_at = record.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= now:
                session.delete(record)
                session.commit()
                return None
            return record

    def set(
        self,
        key: str,
        request_hash: str,
        status_code: int,
        response_body: bytes,
        response_headers: dict,
        ttl_seconds: int,
    ) -> None:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=ttl_seconds)
        encoded_body = base64.b64encode(response_body or b"").decode("ascii")
        record = IdempotencyRecord(
            key=key,
            request_hash=request_hash,
            status_code=int(status_code),
            response_body_b64=encoded_body,
            response_headers=response_headers,
            created_at=now,
            expires_at=expires_at,
        )
        with Session(self._engine) as session:
            existing = session.get(IdempotencyRecord, key)
            if existing is not None:
                return
            session.add(record)
            session.commit()


class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        store: IdempotencyStore,
        ttl_seconds: int,
        header_name: str = "Idempotency-Key",
    ) -> None:
        super().__init__(app)
        self._store = store
        self._ttl_seconds = max(int(ttl_seconds), 60)
        self._header_name = header_name

    async def dispatch(self, request: Request, call_next):
        if request.method.upper() not in {"POST", "PUT", "PATCH", "DELETE"}:
            return await call_next(request)

        key = self._get_idempotency_key(request)
        if not key:
            return await call_next(request)

        body = await request.body()
        request._body = body  # type: ignore[attr-defined]
        signature = self._hash_request(request, body)

        record = await self._get_record(key, signature)
        if record is not None:
            payload = base64.b64decode(record.response_body_b64.encode("ascii"))
            headers = dict(record.response_headers or {})
            headers["Idempotency-Replay"] = "true"
            return Response(
                content=payload,
                status_code=record.status_code,
                headers=headers,
                media_type=headers.get("content-type"),
            )

        response = await call_next(request)
        payload = await self._consume_body(response)
        headers = dict(response.headers)

        if response.status_code < 500:
            await self._store_response(key, signature, response.status_code, payload, headers)

        return Response(
            content=payload,
            status_code=response.status_code,
            headers=headers,
            media_type=response.media_type,
        )

    def _hash_request(self, request: Request, body: bytes) -> str:
        hasher = hashlib.sha256()
        hasher.update(request.method.encode("utf-8"))
        hasher.update(str(request.url.path).encode("utf-8"))
        if request.url.query:
            hasher.update(str(request.url.query).encode("utf-8"))
        hasher.update(body or b"")
        return hasher.hexdigest()

    def _get_idempotency_key(self, request: Request) -> Optional[str]:
        key = request.headers.get(self._header_name)
        if key:
            return key
        fallback = "X-Idempotency-Key" if self._header_name.lower() == "idempotency-key" else "Idempotency-Key"
        return request.headers.get(fallback)

    async def _get_record(self, key: str, request_hash: str) -> Optional[IdempotencyRecord]:
        return await self._run_in_thread(self._store.get, key, request_hash)

    async def _store_response(
        self,
        key: str,
        request_hash: str,
        status_code: int,
        payload: bytes,
        headers: dict,
    ) -> None:
        await self._run_in_thread(
            self._store.set,
            key,
            request_hash,
            status_code,
            payload,
            headers,
            self._ttl_seconds,
        )

    async def _consume_body(self, response: Response) -> bytes:
        body = b""
        async for chunk in response.body_iterator:
            body += chunk if isinstance(chunk, bytes) else chunk.encode("utf-8")
        return body

    async def _run_in_thread(self, fn, *args):
        import asyncio
        return await asyncio.to_thread(fn, *args)
