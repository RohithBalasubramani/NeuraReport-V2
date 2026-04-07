#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_activate="$root_dir/backend/.venv/bin/activate"
log_dir="$root_dir/scripts/dev-helpers/logs"
pid_dir="$root_dir/scripts/dev-helpers"

BACKEND_PORT=8500
FRONTEND_PORT=5190

mkdir -p "$log_dir"

stop_servers() {
  local stopped=0
  for name in backend frontend; do
    local pf="$pid_dir/${name}.pid"
    if [ -f "$pf" ]; then
      local pid
      pid=$(cat "$pf")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        echo "Stopped $name (PID $pid)"
        stopped=1
      fi
      rm -f "$pf"
    fi
  done
  [ "$stopped" -eq 0 ] && echo "No servers running."
}

if [ "${1:-}" = "stop" ]; then
  stop_servers
  exit 0
fi

# Stop any existing instances first
stop_servers 2>/dev/null || true

if [ ! -f "$backend_activate" ]; then
  echo "No venv found. Run ./scripts/setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$backend_activate"

# Start backend
cd "$root_dir"
nohup uvicorn backend.api:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload \
  > "$log_dir/backend.log" 2>&1 &
echo $! > "$pid_dir/backend.pid"
echo "Backend  started → http://localhost:$BACKEND_PORT  (PID $!, log: scripts/dev-helpers/logs/backend.log)"

# Start frontend
cd "$root_dir/frontend"
export NEURA_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
nohup npm run dev -- --port "$FRONTEND_PORT" \
  > "$log_dir/frontend.log" 2>&1 &
echo $! > "$pid_dir/frontend.pid"
echo "Frontend started → http://localhost:$FRONTEND_PORT (PID $!, log: scripts/dev-helpers/logs/frontend.log)"

echo ""
echo "Both servers running as daemons. Stop with: ./scripts/dev.sh stop"
