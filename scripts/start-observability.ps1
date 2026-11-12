<#
.SYNOPSIS
    Start the native Windows OpenTelemetry Collector, Tempo, and Prometheus.
.DESCRIPTION
    Uses binaries installed by scripts/install-observability.ps1. Data and
    rendered configuration live under CAUSALOTEL_DATA_ROOT (default:
    %LOCALAPPDATA%\CausalOTel), so the repository contains no user-specific
    paths. The script exits nonzero unless all three backends become ready.
#>

param(
    [string]$DataRoot = $(if ($env:CAUSALOTEL_DATA_ROOT) { $env:CAUSALOTEL_DATA_ROOT } else { Join-Path $env:LOCALAPPDATA "CausalOTel" })
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$toolRoot = Join-Path $root "tools\observability"
$pidFile = Join-Path $root ".causalotel.observability.pids"
$logDir = Join-Path $root "logs"
$configDir = Join-Path $DataRoot "config"
$obsDataDir = Join-Path $DataRoot "observability"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
New-Item -ItemType Directory -Path $obsDataDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $DataRoot "prometheus-data") -Force | Out-Null

$otelExe = if ($env:OTELCOL_PATH) { $env:OTELCOL_PATH } else { Join-Path $toolRoot "otelcol\otelcol-contrib.exe" }
$tempoExe = if ($env:TEMPO_PATH) { $env:TEMPO_PATH } else { Join-Path $toolRoot "tempo\tempo.exe" }
$promExe = if ($env:PROMETHEUS_PATH) { $env:PROMETHEUS_PATH } else { Join-Path $toolRoot "prometheus\prometheus.exe" }

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: OBSERVABILITY STACK STARTUP      " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Data Root: $DataRoot"

$missing = @()
foreach ($entry in @(
    @{ Name = "otelcol-contrib"; Path = $otelExe },
    @{ Name = "tempo"; Path = $tempoExe },
    @{ Name = "prometheus"; Path = $promExe }
)) {
    if (-not (Test-Path $entry.Path)) { $missing += "$($entry.Name): $($entry.Path)" }
}
if ($missing.Count -gt 0) {
    Write-Host "ERROR: Observability binaries are missing:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Run .\scripts\install-observability.ps1 first." -ForegroundColor Red
    exit 1
}

if (Test-Path $pidFile) {
    try {
        $existing = Get-Content $pidFile -Raw | ConvertFrom-Json
        $alive = @($existing | Where-Object { $_.PID -and (Get-Process -Id $_.PID -ErrorAction SilentlyContinue) })
        if ($alive.Count -gt 0) {
            Write-Host "Observability stack is already running (PID file $pidFile)." -ForegroundColor DarkYellow
            $alive | ForEach-Object { Write-Host "  - $($_.Name) PID $($_.PID) port $($_.Port)" }
            exit 0
        }
        Remove-Item $pidFile -Force
    } catch {
        Write-Host "ERROR: Cannot parse ${pidFile}: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

$ports = @(4317, 4318, 4320, 8889, 9090, 3200, 13133)
$conflicts = @()
foreach ($port in $ports) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -gt 4) {
            $procName = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            $conflicts += "port $port is in use by PID $($listener.OwningProcess) ($procName)"
        }
    }
}
if ($conflicts.Count -gt 0) {
    Write-Host "ERROR: Observability ports are occupied:" -ForegroundColor Red
    $conflicts | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

# Render portable configuration from repository templates.
$normalizedRoot = $DataRoot.Replace('\', '/')
$tempoTemplate = Get-Content (Join-Path $root "observability\tempo.yaml") -Raw
$tempoConfig = Join-Path $configDir "tempo.yaml"
Set-Content -Path $tempoConfig -Value $tempoTemplate.Replace('__DATA_ROOT__', $normalizedRoot) -Encoding UTF8

$collectorConfig = Join-Path $configDir "otel-collector-config.yaml"
Copy-Item (Join-Path $root "observability\otel-collector-config.yaml") $collectorConfig -Force

$promConfig = Join-Path $configDir "prometheus.yml"
Copy-Item (Join-Path $root "observability\prometheus.yml") $promConfig -Force

$pids = [System.Collections.Generic.List[PSCustomObject]]::new()

function Start-ObsProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string]$Arguments,
        [string]$WorkingDirectory,
        [int]$Port,
        [string]$HealthUrl
    )
    Write-Host "--> Launching $Name on port $Port..." -ForegroundColor Yellow
    $stdout = Join-Path $logDir "$Name.out.log"
    $stderr = Join-Path $logDir "$Name.err.log"
    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
        -PassThru -WindowStyle Hidden

    Start-Sleep -Milliseconds 700
    if ($proc.HasExited) {
        Write-Host "    [FAIL] $Name exited immediately (code $($proc.ExitCode)); see $stderr" -ForegroundColor Red
        return $false
    }
    $pids.Add([PSCustomObject]@{ Name = $Name; PID = $proc.Id; Port = $Port; HealthUrl = $HealthUrl })
    Write-Host "    [LAUNCHED] PID: $($proc.Id)" -ForegroundColor Green
    return $true
}

if (-not (Start-ObsProcess -Name "otel-collector" -FilePath $otelExe `
        -Arguments "--config `"$collectorConfig`"" -WorkingDirectory $DataRoot -Port 4318 `
        -HealthUrl "http://localhost:13133/")) {
    exit 1
}
if (-not (Start-ObsProcess -Name "tempo" -FilePath $tempoExe `
        -Arguments "-config.file=`"$tempoConfig`"" -WorkingDirectory $obsDataDir -Port 3200 `
        -HealthUrl "http://localhost:3200/ready")) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-observability.ps1") | Out-Null
    exit 1
}
if (-not (Start-ObsProcess -Name "prometheus" -FilePath $promExe `
        -Arguments "--config.file=`"$promConfig`" --storage.tsdb.path=`"$(Join-Path $DataRoot 'prometheus-data')`" --web.listen-address=0.0.0.0:9090" `
        -WorkingDirectory $DataRoot -Port 9090 -HealthUrl "http://localhost:9090/-/ready")) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-observability.ps1") | Out-Null
    exit 1
}

Write-Host "`n--> Awaiting observability readiness (up to 60s)..." -ForegroundColor Yellow
$ready = $false
$pending = @()
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 2
    $pending = @()
    foreach ($svc in $pids) {
        try {
            $resp = Invoke-WebRequest -Uri $svc.HealthUrl -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -ne 200) { $pending += $svc.Name }
        } catch {
            $pending += $svc.Name
        }
    }
    if ($pending.Count -eq 0) { $ready = $true; break }
    Write-Host "    [WAIT] $($pending -join ', ') not ready yet ($($attempt * 2)s)" -ForegroundColor DarkGray
}

if (-not $ready) {
    Write-Host "ERROR: Observability stack did not become ready: $($pending -join ', ')" -ForegroundColor Red
    Write-Host "Inspect logs under $logDir." -ForegroundColor Red
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop-observability.ps1") | Out-Null
    exit 1
}

$pids | ConvertTo-Json | Set-Content $pidFile -Force
Write-Host "`nObservability stack ready:" -ForegroundColor Green
Write-Host "  OTLP gRPC/HTTP: 4317 / 4318" -ForegroundColor Cyan
Write-Host "  Tempo OTLP:     4320  (query http://localhost:3200)" -ForegroundColor Cyan
Write-Host "  Collector prom: 8889  (health http://localhost:13133)" -ForegroundColor Cyan
Write-Host "  Prometheus:     9090" -ForegroundColor Cyan
Write-Host "PIDs written to $pidFile" -ForegroundColor DarkGray
exit 0
