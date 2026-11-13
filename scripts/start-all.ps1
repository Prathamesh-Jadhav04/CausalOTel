<#
.SYNOPSIS
    CausalOTel - Start the observability stack and every application service.
.DESCRIPTION
    Refuses to launch over an existing mesh or an occupied port, rebuilds stale
    Java/.NET artifacts, starts the analysis engine through `npm start` so its
    OpenTelemetry tracer loads, starts the native Windows observability stack,
    and exits nonzero when any component never becomes ready.
#>

param(
    [switch]$KeepAlive,
    [switch]$SkipObservability
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$pidFile = Join-Path $root ".causalotel.pids"
$observabilityPidFile = Join-Path $root ".causalotel.observability.pids"
$logDir = Join-Path $root "logs"

if (Test-Path "C:\Program Files\dotnet") {
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
}

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: SERVICE MESH STARTUP             " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Workspace Root: $root"
Write-Host "Log Directory:  $logDir`n"

# ---------------------------------------------------------------------------
# Safety: never clobber a running mesh or an occupied port.
# ---------------------------------------------------------------------------
if (Test-Path $pidFile) {
    try {
        $existing = Get-Content $pidFile -Raw | ConvertFrom-Json
        $alive = @($existing | Where-Object {
            $_.PID -and (Get-Process -Id $_.PID -ErrorAction SilentlyContinue)
        })
        if ($alive.Count -gt 0) {
            Write-Host "ERROR: A CausalOTel mesh is already recorded as running:" -ForegroundColor Red
            $alive | ForEach-Object { Write-Host "  - $($_.Name) PID $($_.PID) port $($_.Port)" -ForegroundColor Red }
            Write-Host "Run .\scripts\stop-all.ps1 first. The PID file was not modified." -ForegroundColor Red
            exit 1
        }
        Write-Host "--> Removing stale PID file (no recorded process is alive)." -ForegroundColor DarkYellow
        Remove-Item $pidFile -Force
    } catch {
        Write-Host "ERROR: Cannot parse ${pidFile}: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Delete it manually after confirming no mesh processes are running." -ForegroundColor Red
        exit 1
    }
}

$plannedPorts = @(8081, 8082, 8083, 8084, 5050, 5000, 3000)
$observabilityRunning = $false
if (Test-Path $observabilityPidFile) {
    try {
        $obsExisting = Get-Content $observabilityPidFile -Raw | ConvertFrom-Json
        $observabilityRunning = @($obsExisting | Where-Object {
            $_.PID -and (Get-Process -Id $_.PID -ErrorAction SilentlyContinue)
        }).Count -gt 0
    } catch {
        $observabilityRunning = $false
    }
}
if (-not $SkipObservability -and -not $observabilityRunning) {
    $plannedPorts += @(4317, 4318, 4320, 8889, 9090, 3200, 13133)
} elseif ($observabilityRunning) {
    Write-Host "--> Observability stack already running; reusing it." -ForegroundColor DarkYellow
}

$conflicts = @()
foreach ($port in $plannedPorts) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        if ($listener.OwningProcess -gt 4) {
            $procName = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            $conflicts += "port $port is already in use by PID $($listener.OwningProcess) ($procName)"
        }
    }
}
if ($conflicts.Count -gt 0) {
    Write-Host "ERROR: Required ports are occupied; refusing to launch:" -ForegroundColor Red
    $conflicts | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Run .\scripts\stop-all.ps1 or stop the conflicting process." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Freshness checks: never run an artifact older than its sources.
# ---------------------------------------------------------------------------
function Test-ArtifactFresh {
    param(
        [string]$Artifact,
        [string]$Directory,
        [string[]]$Patterns
    )
    if (-not (Test-Path $Artifact)) { return $false }
    $artifactTime = (Get-Item $Artifact).LastWriteTimeUtc
    foreach ($pattern in $Patterns) {
        $newer = Get-ChildItem -Path $Directory -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTimeUtc -gt $artifactTime } |
            Select-Object -First 1
        if ($newer) { return $false }
    }
    return $true
}

function Ensure-JavaArtifact {
    param([string]$Service, [string]$JarPath)
    $dir = Join-Path $root "services\$Service"
    $fresh = Test-ArtifactFresh -Artifact $JarPath -Directory $dir -Patterns @("*.java", "pom.xml", "*.yml", "*.properties", "*.sql")
    if ($fresh) {
        Write-Host "    [FRESH] $Service artifact is newer than its sources." -ForegroundColor Green
        return $true
    }
    Write-Host "    [STALE] Rebuilding $Service before launch..." -ForegroundColor Yellow
    Push-Location $dir
    try {
        & ".\mvnw.cmd" -q -DskipTests package
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $JarPath)) {
            Write-Host "    [FAIL] Could not produce $JarPath" -ForegroundColor Red
            return $false
        }
    } finally {
        Pop-Location
    }
    Write-Host "    [REBUILT] $Service artifact is current." -ForegroundColor Green
    return $true
}

function Ensure-DotnetArtifact {
    param([string]$DllPath)
    $dir = Join-Path $root "services\inventory-service"
    $fresh = Test-ArtifactFresh -Artifact $DllPath -Directory $dir -Patterns @("*.cs", "*.csproj", "appsettings*.json")
    if ($fresh) {
        Write-Host "    [FRESH] inventory-service artifact is newer than its sources." -ForegroundColor Green
        return $true
    }
    Write-Host "    [STALE] Rebuilding inventory-service before launch..." -ForegroundColor Yellow
    Push-Location $dir
    try {
        & dotnet build --configuration Release
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $DllPath)) {
            Write-Host "    [FAIL] Could not produce $DllPath" -ForegroundColor Red
            return $false
        }
    } finally {
        Pop-Location
    }
    Write-Host "    [REBUILT] inventory-service artifact is current." -ForegroundColor Green
    return $true
}

$pids = [System.Collections.Generic.List[PSCustomObject]]::new()

function Start-BackgroundService {
    param (
        [string]$Name,
        [string]$Directory,
        [string]$Command,
        [string]$Arguments,
        [int]$Port,
        [string]$HealthPath = "/health/live",
        [hashtable]$Environment = @{}
    )

    Write-Host "--> Launching $Name on port $Port..." -ForegroundColor Yellow
    $stdout = Join-Path $logDir "$Name.out.log"
    $stderr = Join-Path $logDir "$Name.err.log"

    $previousEnv = @{}
    foreach ($key in $Environment.Keys) {
        $previousEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
    }

    try {
        $proc = Start-Process -FilePath $Command -ArgumentList $Arguments -WorkingDirectory $Directory `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
            -PassThru -WindowStyle Hidden
    } finally {
        foreach ($key in $previousEnv.Keys) {
            [Environment]::SetEnvironmentVariable($key, $previousEnv[$key], 'Process')
        }
    }

    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
        Write-Host "    [FAIL] $Name exited immediately (code $($proc.ExitCode)); see $stderr" -ForegroundColor Red
        return $false
    }

    $pids.Add([PSCustomObject]@{
        Name = $Name
        PID = $proc.Id
        Port = $Port
        HealthPath = $HealthPath
    })

    Write-Host "    [LAUNCHED] PID: $($proc.Id)" -ForegroundColor Green
    return $true
}

# ---------------------------------------------------------------------------
# Observability stack (native Windows collector -> Tempo -> Prometheus).
# ---------------------------------------------------------------------------
if ($SkipObservability) {
    Write-Host "`n--> Observability stack skipped by request (-SkipObservability)." -ForegroundColor DarkYellow
    Write-Host "    Real traces/metrics will be unavailable; RCA will report explicit errors." -ForegroundColor DarkYellow
} else {
    Write-Host "`n--> Starting native observability stack..." -ForegroundColor Yellow
    $obsScript = Join-Path $PSScriptRoot "start-observability.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $obsScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Observability stack failed to start." -ForegroundColor Red
        Write-Host "Install the pinned binaries with .\scripts\install-observability.ps1, then retry." -ForegroundColor Red
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Application services.
# ---------------------------------------------------------------------------
$userJar = Join-Path $root "services\user-service\target\user-service-1.0.0-SNAPSHOT.jar"
$prodJar = Join-Path $root "services\product-service\target\product-service-1.0.0-SNAPSHOT.jar"
$orderJar = Join-Path $root "services\order-service\target\order-service-1.0.0-SNAPSHOT.jar"
$payJar = Join-Path $root "services\payment-service\target\payment-service-1.0.0-SNAPSHOT.jar"
$invDll = Join-Path $root "services\inventory-service\bin\Release\net10.0\InventoryService.dll"

foreach ($artifact in @(
    @{ Service = "user-service"; Path = $userJar },
    @{ Service = "product-service"; Path = $prodJar },
    @{ Service = "order-service"; Path = $orderJar },
    @{ Service = "payment-service"; Path = $payJar }
)) {
    if (-not (Ensure-JavaArtifact -Service $artifact.Service -JarPath $artifact.Path)) { exit 1 }
}
if (-not (Ensure-DotnetArtifact -DllPath $invDll)) { exit 1 }

if (-not (Start-BackgroundService -Name "user-service" -Directory $root -Command "java" -Arguments "-jar `"$userJar`"" -Port 8081)) { exit 1 }
if (-not (Start-BackgroundService -Name "product-service" -Directory $root -Command "java" -Arguments "-jar `"$prodJar`"" -Port 8082)) { exit 1 }
if (-not (Start-BackgroundService -Name "payment-service" -Directory $root -Command "java" -Arguments "-jar `"$payJar`"" -Port 8084 -Environment @{ PAYMENT_SIMULATION_ENABLED = "true"; SPRING_PROFILES_ACTIVE = "demo" })) { exit 1 }
if (-not (Start-BackgroundService -Name "order-service" -Directory $root -Command "java" -Arguments "-jar `"$orderJar`"" -Port 8083)) { exit 1 }
if (-not (Start-BackgroundService -Name "inventory-service" -Directory (Join-Path $root "services\inventory-service") -Command "dotnet" -Arguments "`"$invDll`" --urls http://localhost:5050" -Port 5050)) { exit 1 }

# M-09: npm start runs `node --import ./src/tracer.js src/server.js`.
if (-not (Start-BackgroundService -Name "analysis-engine" `
        -Directory (Join-Path $root "analysis-engine") `
        -Command "cmd.exe" -Arguments "/c npm.cmd start" `
        -Port 5000)) { exit 1 }

if (-not (Start-BackgroundService -Name "dashboard" `
        -Directory (Join-Path $root "dashboard") `
        -Command "cmd.exe" -Arguments "/c npm.cmd run dev -- --host --port 3000" `
        -Port 3000 -HealthPath "/")) { exit 1 }

# Save PIDs only after every launch succeeded.
$pids | ConvertTo-Json | Set-Content $pidFile -Force
Write-Host "`n--> PIDs written to $pidFile" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Readiness: fail nonzero instead of claiming a partial mesh is ready.
# ---------------------------------------------------------------------------
Write-Host "`n--> Awaiting service readiness (up to 90s)..." -ForegroundColor Yellow
$maxAttempts = 45
$attempt = 0
$allReady = $false
$lastPending = @()

while ($attempt -lt $maxAttempts -and -not $allReady) {
    Start-Sleep -Seconds 2
    $attempt++
    $pending = @()

    foreach ($svc in $pids) {
        $url = "http://localhost:$($svc.Port)$($svc.HealthPath)"
        try {
            $resp = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -ne 200) { $pending += $svc.Name }
        } catch {
            $pending += $svc.Name
        }
    }

    $lastPending = $pending
    if ($pending.Count -eq 0) {
        $allReady = $true
    } else {
        Write-Host "    [WAIT] $($pending.Count) service(s) still starting: $($pending -join ', ') ($($attempt * 2)s)" -ForegroundColor DarkGray
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
if (-not $allReady) {
    Write-Host "       STARTUP FAILED: SERVICES NOT READY            " -ForegroundColor Red
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host "Not ready: $($lastPending -join ', ')" -ForegroundColor Red
    Write-Host "Inspect logs under $logDir and run .\scripts\stop-all.ps1." -ForegroundColor Red
    exit 1
}

Write-Host "       ALL CAUSALOTEL SERVICES READY!                " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Access Points:"
Write-Host "  Dashboard:       http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Analysis Engine: http://localhost:5000/api/analysis/incidents" -ForegroundColor Cyan
Write-Host "  Tempo:           http://localhost:3200" -ForegroundColor Cyan
Write-Host "  Prometheus:      http://localhost:9090" -ForegroundColor Cyan
Write-Host "  Order Service:   http://localhost:8083/health/live" -ForegroundColor Cyan
Write-Host "  Inventory:       http://localhost:5050/health/live" -ForegroundColor Cyan
Write-Host "  Payment:         http://localhost:8084/health/live" -ForegroundColor Cyan
Write-Host "  Product:         http://localhost:8082/health/live" -ForegroundColor Cyan
Write-Host "  User:            http://localhost:8081/health/live" -ForegroundColor Cyan
Write-Host "`nTo verify the telemetry pipeline, run: .\scripts\verify-observability.ps1" -ForegroundColor DarkGray
Write-Host "To stop all services, run: .\scripts\stop-all.ps1" -ForegroundColor DarkGray

if ($KeepAlive) {
    Write-Host "`n--> Services running in KeepAlive mode. Maintaining active background mesh..." -ForegroundColor Green
    while ($true) {
        Start-Sleep -Seconds 30
    }
}

exit 0
