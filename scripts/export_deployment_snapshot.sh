#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-prodo}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[snapshot] repo_root=$REPO_ROOT"
echo "[snapshot] dest=$DEST"

mkdir -p "$DEST"

# --- Frontend build ---
echo "[snapshot] building frontend"
pushd "$REPO_ROOT/frontend" >/dev/null
  if command -v npm >/dev/null 2>&1; then
    npm ci
    npm run build
  else
    echo "[snapshot] ERROR: npm not found" >&2
    exit 1
  fi
popd >/dev/null

echo "[snapshot] copying frontend dist"
mkdir -p "$DEST/frontend"
rsync -a --delete "$REPO_ROOT/frontend/dist/" "$DEST/frontend/"

# --- Backend code copy (exclude runtime/state/secrets/venvs) ---
echo "[snapshot] copying backend code"
mkdir -p "$DEST/backend"
rsync -a --delete \
  --exclude '.venv/' \
  --exclude 'venv/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude 'state/' \
  --exclude 'uploads/' \
  --exclude 'uploads_excel/' \
  "$REPO_ROOT/backend/" "$DEST/backend/"

# Create empty runtime directories expected by ops wiring.
mkdir -p "$DEST/config" "$DEST/logs" "$DEST/state"

echo "[snapshot] done"

