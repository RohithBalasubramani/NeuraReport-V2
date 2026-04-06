"""
Alembic environment configuration for NeuraReport.

Supports both online (async) and offline migration modes.
Database URL is read from Settings (not alembic.ini) so that
environment variables (NEURA_DATABASE_URL) control the target.
"""
from __future__ import annotations

import asyncio
import logging
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel

from backend.app.services.config import get_settings

# --------------------------------------------------------------------------- #
# Import ALL models so that SQLModel.metadata knows about every table.
# If you add a new model file, import it here.
# --------------------------------------------------------------------------- #
from backend.app.repositories import (  # noqa: F401
    AgentTaskModel,
    AgentTaskEvent,
)
from backend.app.services.config import User  # noqa: F401

# --------------------------------------------------------------------------- #
# Alembic Config object (provides access to alembic.ini values)
# --------------------------------------------------------------------------- #
logger = logging.getLogger("alembic.env")

def _configure_logging() -> None:
    """Set up logging from the Alembic config file (if running under Alembic)."""
    try:
        cfg = context.config
        if cfg.config_file_name is not None:
            fileConfig(cfg.config_file_name)
    except Exception:
        pass

_configure_logging()

# --------------------------------------------------------------------------- #
# Target metadata for autogenerate support
# --------------------------------------------------------------------------- #
target_metadata = SQLModel.metadata


def _get_database_url() -> str:
    """Resolve the database URL from application settings."""
    settings = get_settings()
    url = settings.database_url
    logger.info("Using database URL dialect: %s", url.split(":")[0] if ":" in url else "unknown")
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Generates SQL script without connecting to the database.
    Useful for review or manual application of migrations.
    """
    url = _get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with the given connection (shared by online modes)."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' async mode using asyncpg / aiosqlite."""
    url = _get_database_url()
    connectable = create_async_engine(url, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (async wrapper)."""
    asyncio.run(run_async_migrations())


# --------------------------------------------------------------------------- #
# Entrypoint: choose offline vs online based on Alembic context
# --------------------------------------------------------------------------- #
if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
