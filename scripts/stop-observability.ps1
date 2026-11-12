<#
.SYNOPSIS
    Stop the native observability stack started by start-observability.ps1.
#>

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$pidFile = Join-Path $root ".causalotel.observability.pids"

Write-Host "--> Stopping observability stack..." -ForegroundColor Yellow

if (Test-Path $pidFile) {
    try {
        $items = Get-Content $pidFile -Raw | ConvertFrom-Json
        foreach ($item in $items) {
            $proc = Get-Process -Id $item.PID -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "    Stopping $($item.Name) (PID: $($item.PID))..." -ForegroundColor DarkYellow
                Stop-Process -Id $item.PID -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Write-Host "    [WARN] Failed to parse ${pidFile}: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

foreach ($port in @(4317, 4318, 4320, 8889, 9090, 3200, 13133)) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess -gt 4) {
            $procName = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            if ($procName -match "otelcol|tempo|prometheus") {
                Write-Host "    Terminating $procName on port $port (PID: $($conn.OwningProcess))..." -ForegroundColor Red
                Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

Write-Host "    [STOPPED] Observability stack" -ForegroundColor Green
