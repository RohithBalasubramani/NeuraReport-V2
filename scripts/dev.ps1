$ErrorActionPreference = "Stop"
$root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }

# Backend
$backend = Join-Path $root "backend"
$venv = Join-Path $backend ".venv\Scripts\Activate.ps1"
if (-not (Test-Path $venv)) { Write-Error "No venv. Run scripts\setup.ps1 first."; exit 1 }
$backendCmd = "Set-Location `"$root`"; . `"$venv`"; uvicorn backend.api:app --host 0.0.0.0 --port 8000 --reload"
$bp = Start-Process powershell -ArgumentList "-NoLogo","-NoProfile","-Command",$backendCmd -PassThru
Write-Host "Backend PID $($bp.Id) at http://localhost:8000" -ForegroundColor Green

# Frontend
$frontend = Join-Path $root "frontend"
$frontendCmd = "Set-Location `"$frontend`"; npm run dev"
$fp = Start-Process powershell -ArgumentList "-NoLogo","-NoProfile","-Command",$frontendCmd -PassThru
Write-Host "Frontend PID $($fp.Id) at http://localhost:5173" -ForegroundColor Green

Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"
