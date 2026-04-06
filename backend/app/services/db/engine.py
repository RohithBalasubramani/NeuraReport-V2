"""
Database engine and session management.

Supports both PostgreSQL (production) and SQLite (development/testing).
PostgreSQL: uses asyncpg with connection pooling.
SQLite: uses aiosqlite with check_same_thread=False.

Based on: fastapi/full-stack-fastapi-template and SQLAlchemy async patterns.
"""
from __future__ import annotations

import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlmodel import SQLModel

from backend.app.services.config import get_settings

logger = logging.getLogger("neura.db")

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _build_engine_kwargs(url: str) -> dict:
    """Build engine kwargs based on database URL dialect."""
    settings = get_settings()
    kwargs: dict = {"echo": settings.database_echo}

    if url.startswith("postgresql") or url.startswith("postgres"):
        # PostgreSQL: use asyncpg with pooling
        kwargs.update({
            "pool_size": settings.database_pool_size,
            "max_overflow": settings.database_pool_max_overflow,
            "pool_timeout": settings.database_pool_timeout,
            "pool_pre_ping": True,  # verify connections before checkout
            "pool_recycle": 3600,   # recycle connections after 1 hour
        })
    elif "sqlite" in url:
        # SQLite: disable same-thread check for async
        kwargs["connect_args"] = {"check_same_thread": False}

    return kwargs


def get_engine() -> AsyncEngine:
    """Get or create the async database engine (singleton)."""
    global _engine
    if _engine is None:
        settings = get_settings()
        url = settings.database_url
        kwargs = _build_engine_kwargs(url)
        _engine = create_async_engine(url, **kwargs)
        logger.info(
            "db_engine_created",
            extra={
                "event": "db_engine_created",
                "dialect": url.split(":")[0] if ":" in url else "unknown",
                "pool_size": kwargs.get("pool_size", "N/A"),
            },
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get or create the session factory (singleton)."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a database session."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables (for development/testing). Use Alembic in production."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    logger.info("db_tables_created", extra={"event": "db_tables_created"})


async def dispose_engine() -> None:
    """Dispose of the engine (call on shutdown)."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        logger.info("db_engine_disposed", extra={"event": "db_engine_disposed"})
