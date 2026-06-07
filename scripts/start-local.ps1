# ClipPilot local dev bootstrap (Windows).
# Starts Redis (Docker) + Lane A orchestrator. Requires Python venv + requirements.txt.
param(
  [switch]$SkipRedis,
  [switch]$SkipOrchestrator
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Test-Port([int]$Port) {
  try {
    return (Test-NetConnection -ComputerName localhost -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
  } catch { return $false }
}

Write-Host "ClipPilot local startup" -ForegroundColor Cyan
Write-Host "Repo: $Root"

# --- Redis (6379) ---
if (-not $SkipRedis) {
  if (Test-Port 6379) {
    Write-Host "[redis] already listening on :6379" -ForegroundColor Green
  } elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    $existing = docker ps -a --filter "name=clippilot-redis" --format "{{.Names}}"
    if ($existing -eq "clippilot-redis") {
      docker start clippilot-redis | Out-Null
    } else {
      docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest | Out-Null
    }
    Write-Host "[redis] started via Docker (clippilot-redis)" -ForegroundColor Green
  } else {
    Write-Host "[redis] NOT running and Docker not found." -ForegroundColor Yellow
    Write-Host "  Install Docker Desktop OR Memurai (https://www.memurai.com/) OR run Redis in WSL."
    Write-Host "  Set REDIS_URL=redis://localhost:6379/0 in .env"
  }
}

# --- Python venv ---
$venvPython = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  Write-Host "[python] creating .venv …" -ForegroundColor Cyan
  python -m venv .venv
  & $venvPython -m pip install -r requirements.txt
}

# --- Lane A (8000) ---
if (-not $SkipOrchestrator) {
  if (Test-Port 8000) {
    Write-Host "[lane-a] already listening on :8000" -ForegroundColor Green
  } else {
    Write-Host "[lane-a] starting discovery orchestrator on :8000 …" -ForegroundColor Cyan
    Start-Process -FilePath $venvPython -ArgumentList @(
      "-m", "uvicorn", "discovery_orchestrator.app:app", "--host", "0.0.0.0", "--port", "8000"
    ) -WorkingDirectory $Root -WindowStyle Normal
    Start-Sleep -Seconds 2
    if (Test-Port 8000) {
      Write-Host "[lane-a] up — http://localhost:8000/health" -ForegroundColor Green
    } else {
      Write-Host "[lane-a] failed to bind :8000 — check the new terminal for errors." -ForegroundColor Red
    }
  }
}

Write-Host ""
Write-Host "Dashboard: cd dashboard && npm run dev  →  http://localhost:3000" -ForegroundColor Cyan
Write-Host "Manual cycle: curl -X POST http://localhost:8000/run-once -H 'content-type: application/json' -d '{\"topic\":\"tech\"}'"
