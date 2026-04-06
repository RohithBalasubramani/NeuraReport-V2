#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

check_cmd() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Missing '$cmd'. $hint"
  fi
  echo "OK: $cmd found"
}

echo
echo "==> Checking prerequisites..."
check_cmd "python3" "Install Python 3.11+."
check_cmd "node" "Install Node.js 18+ (or 20 LTS): https://nodejs.org/"
check_cmd "npm" "npm should come with Node."

# ----- Backend -----
backend_dir="$root_dir/backend"
[ -d "$backend_dir" ] || fail "backend/ not found at $backend_dir"

venv_dir="$backend_dir/.venv"
if [ ! -d "$venv_dir" ]; then
  echo "Creating backend/.venv ..."
  python3 -m venv "$venv_dir"
fi

# shellcheck disable=SC1091
source "$venv_dir/bin/activate"

python -m pip install --upgrade pip wheel

if [ -f "$backend_dir/requirements.txt" ]; then
  echo "Installing backend requirements ..."
  python -m pip install -r "$backend_dir/requirements.txt"
else
  echo "WARN: backend/requirements.txt not found - skipping pip install." >&2
fi

if [ -f "$backend_dir/requirements-dev.txt" ]; then
  echo "Installing backend dev requirements ..."
  python -m pip install -r "$backend_dir/requirements-dev.txt"
fi

echo "Installing Playwright browser (Chromium) ..."
python -m playwright install chromium || echo "WARN: Playwright install failed; rerun: python -m playwright install chromium" >&2

if [ ! -f "$backend_dir/.env" ]; then
  if [ -f "$backend_dir/.env.example" ]; then
    cp "$backend_dir/.env.example" "$backend_dir/.env"
  else
    echo "# OPENAI_API_KEY=your_key_here" >"$backend_dir/.env"
  fi
  echo "Created backend/.env - add your keys."
fi

mkdir -p "$backend_dir/uploads"

# ----- Frontend -----
frontend_dir="$root_dir/frontend"
[ -d "$frontend_dir" ] || fail "frontend/ not found at $frontend_dir"

cd "$frontend_dir"
echo "Installing frontend dependencies ..."
if [ -f "package-lock.json" ]; then
  npm ci
else
  npm install
fi

if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  cp ".env.example" ".env.local"
  echo "Created frontend/.env.local (copied from .env.example)."
fi

echo
echo "Setup complete."
