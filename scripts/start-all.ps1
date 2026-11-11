<#
.SYNOPSIS
    CausalOTel - Master Service Mesh Startup Orchestrator
.DESCRIPTION
    Starts all 6 backend services and the Vite frontend dashboard in background processes,
    records their Process IDs to .causalotel.pids, and polls health checks until ready.
#>

param(
    [switch]$KeepAlive
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$pidFile = Join-Path $root ".causalotel.pids"
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

$pids = [System.Collections.Generic.List[PSCustomObject]]::new()

function Start-BackgroundService {
    param (
        [string]$Name,
        [string]$Directory,
        [string]$Command,
        [string]$Arguments,
        [int]$Port,
        [string]$HealthPath = "/health/live"
    )

    Write-Host "--> Launching $Name on port $Port..." -ForegroundColor Yellow
    $stdout = Join-Path $logDir "$Name.out.log"
    $stderr = Join-Path $logDir "$Name.err.log"

    $proc = Start-Process -FilePath $Command -ArgumentList $Arguments -WorkingDirectory $Directory `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
        -PassThru -WindowStyle Hidden

    $pids.Add([PSCustomObject]@{
        Name = $Name
        PID = $proc.Id
        Port = $Port
        HealthPath = $HealthPath
    })

    Write-Host "    [LAUNCHED] PID: $($proc.Id)" -ForegroundColor Green
}

# 1. User Service (Java 25, port 8081)
$userJar = Join-Path $root "services\user-service\target\user-service-1.0.0-SNAPSHOT.jar"
if (Test-Path $userJar) {
    Start-BackgroundService -Name "user-service" -Directory $root -Command "java" -Arguments "-jar `"$userJar`"" -Port 8081
} else {
    Start-BackgroundService -Name "user-service" -Directory (Join-Path $root "services\user-service") -Command "cmd.exe" -Arguments "/c mvnw.cmd spring-boot:run" -Port 8081
}

# 2. Product Service (Java 25, port 8082)
$prodJar = Join-Path $root "services\product-service\target\product-service-1.0.0-SNAPSHOT.jar"
if (Test-Path $prodJar) {
    Start-BackgroundService -Name "product-service" -Directory $root -Command "java" -Arguments "-jar `"$prodJar`"" -Port 8082
} else {
    Start-BackgroundService -Name "product-service" -Directory (Join-Path $root "services\product-service") -Command "cmd.exe" -Arguments "/c mvnw.cmd spring-boot:run" -Port 8082
}

# 3. Payment Service (Java 25, port 8084)
$payJar = Join-Path $root "services\payment-service\target\payment-service-1.0.0-SNAPSHOT.jar"
if (Test-Path $payJar) {
    Start-BackgroundService -Name "payment-service" -Directory $root -Command "java" -Arguments "-jar `"$payJar`"" -Port 8084
} else {
    Start-BackgroundService -Name "payment-service" -Directory (Join-Path $root "services\payment-service") -Command "cmd.exe" -Arguments "/c mvnw.cmd spring-boot:run" -Port 8084
}

# 4. Order Service (Java 25, port 8083)
$orderJar = Join-Path $root "services\order-service\target\order-service-1.0.0-SNAPSHOT.jar"
if (Test-Path $orderJar) {
    Start-BackgroundService -Name "order-service" -Directory $root -Command "java" -Arguments "-jar `"$orderJar`"" -Port 8083
} else {
    Start-BackgroundService -Name "order-service" -Directory (Join-Path $root "services\order-service") -Command "cmd.exe" -Arguments "/c mvnw.cmd spring-boot:run" -Port 8083
}

# 5. Inventory Service (.NET 10, port 5050)
$invDll = Join-Path $root "services\inventory-service\bin\Release\net10.0\InventoryService.dll"
if (Test-Path $invDll) {
    Start-BackgroundService -Name "inventory-service" -Directory (Join-Path $root "services\inventory-service") -Command "dotnet" -Arguments "`"$invDll`" --urls http://localhost:5050" -Port 5050
} else {
    Start-BackgroundService -Name "inventory-service" -Directory (Join-Path $root "services\inventory-service") -Command "dotnet" -Arguments "run --urls http://localhost:5050" -Port 5050
}

# 6. Analysis Engine (Node 26, port 5000)
Start-BackgroundService -Name "analysis-engine" `
    -Directory (Join-Path $root "analysis-engine") `
    -Command "node" -Arguments "src/server.js" `
    -Port 5000

# 7. Dashboard (Vite 6, port 3000)
Start-BackgroundService -Name "dashboard" `
    -Directory (Join-Path $root "dashboard") `
    -Command "cmd.exe" -Arguments "/c npm.cmd run dev -- --host --port 3000" `
    -Port 3000 -HealthPath "/"

# Save PIDs to file for reliable shutdown
$pids | ConvertTo-Json | Set-Content $pidFile -Force
Write-Host "`n--> PIDs written to $pidFile" -ForegroundColor Cyan

# Poll Health Probes
Write-Host "`n--> Awaiting service readiness (up to 45s)..." -ForegroundColor Yellow
$maxAttempts = 45
$attempt = 0
$allReady = $false

while ($attempt -lt $maxAttempts -and -not $allReady) {
    Start-Sleep -Seconds 2
    $attempt++
    $pending = 0

    foreach ($svc in $pids) {
        $url = "http://localhost:$($svc.Port)$($svc.HealthPath)"
        try {
            $resp = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -ne 200) { $pending++ }
        } catch {
            $pending++
        }
    }

    if ($pending -eq 0) {
        $allReady = $true
    } else {
        Write-Host "    [WAIT] $pending services still starting up... ($($attempt * 2)s)" -ForegroundColor DarkGray
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
if ($allReady) {
    Write-Host "       ALL 7 CAUSALOTEL SERVICES READY!             " -ForegroundColor Green
} else {
    Write-Host "       SERVICES LAUNCHED (SOME HEALTH PROBES PENDING)" -ForegroundColor Yellow
}
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Access Points:"
Write-Host "  Dashboard:       http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Analysis Engine: http://localhost:5000/api/analysis/incidents" -ForegroundColor Cyan
Write-Host "  Order Service:   http://localhost:8083/health/live" -ForegroundColor Cyan
Write-Host "  Inventory:       http://localhost:5050/health/live" -ForegroundColor Cyan
Write-Host "  Payment:         http://localhost:8084/health/live" -ForegroundColor Cyan
Write-Host "  Product:         http://localhost:8082/health/live" -ForegroundColor Cyan
Write-Host "  User:            http://localhost:8081/health/live" -ForegroundColor Cyan
Write-Host "`nTo stop all services, run: .\scripts\stop-all.ps1" -ForegroundColor DarkGray

if ($KeepAlive) {
    Write-Host "`n--> Services running in KeepAlive mode. Maintaining active background mesh..." -ForegroundColor Green
    while ($true) {
        Start-Sleep -Seconds 30
    }
}
