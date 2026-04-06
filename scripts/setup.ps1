$ErrorActionPreference = "Stop"
$root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Check-Cmd($c,$h){ if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Fail "Missing '$c'. $h" } else { Write-Host "✔ $c found" -ForegroundColor Green } }

Write-Host "`n==> Checking prerequisites..." -ForegroundColor Cyan
Check-Cmd "python" "Install Python: https://www.python.org/downloads/"
Check-Cmd "node"   "Install Node.js LTS: https://nodejs.org/"
Check-Cmd "npm"    "npm should come with Node."

# ----- Backend -----
$backend = Join-Path $root "backend"
if (-not (Test-Path $backend)) { Fail "backend/ not found at $backend" }
Set-Location $backend

if (-not (Test-Path ".venv")) {
  Write-Host "Creating backend\.venv ..." -ForegroundColor Cyan
  python -m venv .venv
}
$venv = ".\.venv\Scripts\Activate.ps1"
if (-not (Test-Path $venv)) { Fail "Virtual env not created at $venv" }
. $venv

python -m pip install --upgrade pip wheel
if (Test-Path "requirements.txt") {
  Write-Host "Installing backend requirements ..." -ForegroundColor Cyan
  python -m pip install -r requirements.txt
  if (Test-Path "requirements-dev.txt") {
    Write-Host "Installing backend dev requirements ..." -ForegroundColor Cyan
    python -m pip install -r requirements-dev.txt
  }
} else {
  Write-Warning "backend/requirements.txt not found - skipping pip install."
}

Write-Host "Installing Playwright browser (Chromium) ..." -ForegroundColor Cyan
python -m playwright install chromium

if (-not (Test-Path ".\.env")) {
  if (Test-Path ".\.env.example") { Copy-Item ".\.env.example" ".\.env" }
  else { New-Item -ItemType File ".\.env" | Out-Null; Add-Content ".\.env" "# OPENAI_API_KEY=your_key_here" }
  Write-Host "Created backend\.env — add your keys." -ForegroundColor Yellow
}

if (-not (Test-Path ".\uploads")) { New-Item -ItemType Directory -Path ".\uploads" | Out-Null }

# ----- Frontend -----
$frontend = Join-Path $root "frontend"
if (-not (Test-Path $frontend)) { Fail "frontend/ not found at $frontend" }
Set-Location $frontend
Write-Host "Installing frontend dependencies ..." -ForegroundColor Cyan
if (Test-Path "package-lock.json") { npm ci } else { npm install }

if (-not (Test-Path ".\\.env.local") -and (Test-Path ".\\.env.example")) {
  Copy-Item ".\\.env.example" ".\\.env.local"
  Write-Host "Created frontend\\.env.local (copied from .env.example)." -ForegroundColor Yellow
}

Write-Host "`nSetup complete." -ForegroundColor Green
