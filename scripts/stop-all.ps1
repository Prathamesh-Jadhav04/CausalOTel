<#
.SYNOPSIS
    CausalOTel - Master Service Mesh Shutdown Orchestrator
.DESCRIPTION
    Stops all running CausalOTel services by stored Process IDs and cleans up
    any lingering processes listening on service ports (8081, 8082, 8083, 8084, 5050, 5000, 3000).
#>

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$pidFile = Join-Path $root ".causalotel.pids"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: SERVICE MESH SHUTDOWN            " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Kill recorded PIDs
if (Test-Path $pidFile) {
    Write-Host "--> Reading recorded PIDs from $pidFile..." -ForegroundColor Yellow
    try {
        $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
        foreach ($item in $pids) {
            try {
                $proc = Get-Process -Id $item.PID -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host "    Stopping $($item.Name) (PID: $($item.PID))..." -ForegroundColor DarkYellow
                    Stop-Process -Id $item.PID -Force -ErrorAction SilentlyContinue
                    Write-Host "    [STOPPED] $($item.Name)" -ForegroundColor Green
                }
            } catch {
                # Ignore if process already exited
            }
        }
    } catch {
        Write-Host "    [WARN] Failed to parse $pidFile: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

# 2. Cleanup orphan processes on ports
$targetPorts = @(8081, 8082, 8083, 8084, 5050, 5000, 3000)
Write-Host "`n--> Checking for lingering processes on ports: $($targetPorts -join ', ')..." -ForegroundColor Yellow

foreach ($port in $targetPorts) {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $connections) {
            $owningPid = $conn.OwningProcess
            if ($owningPid -gt 4) { # Exclude System idle process
                Write-Host "    Terminating orphan process on port $port (PID: $owningPid)..." -ForegroundColor Red
                Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # NetTCPConnection may throw if no listener exists
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "       ALL CAUSALOTEL SERVICES STOPPED CLEANLY      " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
