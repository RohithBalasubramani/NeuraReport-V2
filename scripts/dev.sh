#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_activate="$root_dir/backend/.venv/bin/activate"

if [ ! -f "$backend_activate" ]; then
  echo "No venv found. Run ./scripts/setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$backend_activate"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$root_dir"
uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend PID $BACKEND_PID at http://localhost:8000"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:5173" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "http://localhost:5173" >/dev/null 2>&1 || true
fi

cd "$root_dir/frontend"
npm run dev
