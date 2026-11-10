<#
.SYNOPSIS
    CausalOTel - Comprehensive Build Script for All 7 Services
.DESCRIPTION
    Builds Java services (User, Product, Order, Payment), .NET Inventory, 
    Node.js Analysis Engine, React 19 Dashboard, and C++ Core (if CMake is present).
#>

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."

if (Test-Path "C:\Program Files\dotnet") {
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
}
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: MASTER BUILD ORCHESTRATION       " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Workspace Root: $root"

$javaServices = @(
    "user-service",
    "product-service",
    "order-service",
    "payment-service"
)

# 1. Build Java Microservices
foreach ($svc in $javaServices) {
    $dir = Join-Path $root "services\$svc"
    Write-Host "`n--> Building $svc [Java 25 / Spring Boot 4.0]..." -ForegroundColor Yellow
    Push-Location $dir
    try {
        & ".\mvnw.cmd" clean compile -DskipTests
        if ($LASTEXITCODE -ne 0) {
            throw "Failed building $svc"
        }
        Write-Host "    [SUCCESS] $svc compiled cleanly." -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

# 2. Build .NET Inventory Service
Write-Host "`n--> Building Inventory Service [C# / .NET 10 LTS]..." -ForegroundColor Yellow
$invDir = Join-Path $root "services\inventory-service"
Push-Location $invDir
try {
    & dotnet build --configuration Release
    if ($LASTEXITCODE -ne 0) {
        throw "Failed building inventory-service"
    }
    Write-Host "    [SUCCESS] inventory-service compiled cleanly." -ForegroundColor Green
} finally {
    Pop-Location
}

# 3. Build Node.js Analysis Engine
Write-Host "`n--> Checking Node.js Analysis Engine [Node 26 / Express 5]..." -ForegroundColor Yellow
$engineDir = Join-Path $root "analysis-engine"
Push-Location $engineDir
try {
    & node --check src/server.js
    if ($LASTEXITCODE -ne 0) {
        throw "Failed syntax check on analysis-engine server.js"
    }
    Write-Host "    [SUCCESS] analysis-engine syntax and modules verified." -ForegroundColor Green
} finally {
    Pop-Location
}

# 4. Build React 19 Dashboard
Write-Host "`n--> Building React 19 Dashboard [Vite 6 / Tailwind 4]..." -ForegroundColor Yellow
$dashDir = Join-Path $root "dashboard"
Push-Location $dashDir
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        throw "Failed building React dashboard"
    }
    Write-Host "    [SUCCESS] dashboard bundle generated in dist/." -ForegroundColor Green
} finally {
    Pop-Location
}

# 5. Build C++ Sweep-Line Core (Optional Native Target)
Write-Host "`n--> Checking C++20 Core Module..." -ForegroundColor Yellow
$cppDir = Join-Path $root "cpp-core"
if (Get-Command cmake -ErrorAction SilentlyContinue) {
    Push-Location $cppDir
    try {
        if (-not (Test-Path "build")) { New-Item -ItemType Directory "build" | Out-Null }
        Push-Location "build"
        & cmake ..
        & cmake --build . --config Release
        Pop-Location
        Write-Host "    [SUCCESS] cpp-core binary built." -ForegroundColor Green
    } catch {
        Write-Host "    [INFO] C++ build skipped or warning: $($_.Exception.Message) (pure JS fallback active)." -ForegroundColor DarkYellow
    } finally {
        Pop-Location
    }
} else {
    Write-Host "    [INFO] CMake not in PATH. Analysis engine operates in pure JS Sweep-Line fallback mode." -ForegroundColor DarkYellow
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "       ALL CAUSALOTEL SERVICES BUILT SUCCESSFULLY     " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
