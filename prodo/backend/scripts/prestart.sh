#!/usr/bin/env bash
set -e

echo "==> Running prestart checks..."

# Wait for database to be ready (retry for up to 60 seconds)
echo "==> Waiting for database..."
for i in $(seq 1 60); do
    python -c "
from backend.app.services.config import get_settings
from sqlalchemy import create_engine, text
settings = get_settings()
url = settings.database_url.replace('+asyncpg', '').replace('+aiosqlite', '')
engine = create_engine(url)
with engine.connect() as conn:
    conn.execute(text('SELECT 1'))
print('Database is ready.')
" && break
    echo "  Attempt $i/60: Database not ready, retrying in 1s..."
    sleep 1
done

# Run Alembic migrations
echo "==> Running migrations..."
cd "$(dirname "$0")/.." && alembic upgrade head

# Initialize auth tables
echo "==> Initializing auth database..."
python -c "
import asyncio
from backend.app.services.auth import init_auth_db
asyncio.run(init_auth_db())
"

echo "==> Prestart completed successfully."
