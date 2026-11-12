<#
.SYNOPSIS
    CausalOTel - Build and test every runnable component.
.DESCRIPTION
    Builds the four Java services with their tests, the .NET inventory service
    with its tests, the analysis engine and dashboard test suites plus the Vite
    production bundle, and the optional C++ sweep-line target when a local
    toolchain is available.

    The script never prints a success banner when any required step failed and
    always exits nonzero on failure. The C++ target is explicitly optional
    because the analysis engine has a tested JavaScript fallback.
#>

param(
    [switch]$SkipTests,
    [switch]$SkipNative
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."
$failures = [System.Collections.Generic.List[string]]::new()
$results = [System.Collections.Generic.List[PSCustomObject]]::new()

# Windows locks target/*.jar while a service runs, so `mvn clean` cannot delete
# the directory. Detect a live mesh up front and fail with an actionable message
# instead of a misleading Maven clean error.
$pidFile = Join-Path $root ".causalotel.pids"
if (Test-Path $pidFile) {
    try {
        $recorded = Get-Content $pidFile -Raw | ConvertFrom-Json
        $live = @($recorded | Where-Object { $_.PID -and (Get-Process -Id $_.PID -ErrorAction SilentlyContinue) })
        if ($live.Count -gt 0) {
            Write-Host "BUILD BLOCKED: $($live.Count) CausalOTel service(s) are still running." -ForegroundColor Red
            Write-Host "Running services lock their target/ directories on Windows." -ForegroundColor Red
            Write-Host "Run .\scripts\stop-all.ps1 first, then re-run this build." -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Host "WARNING: Could not parse $pidFile; continuing." -ForegroundColor DarkYellow
    }
}

if (Test-Path "C:\Program Files\dotnet") {
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
}

function Write-StepResult {
    param([string]$Name, [string]$Status, [string]$Detail)
    $color = switch ($Status) {
        "PASS" { "Green" }
        "SKIP" { "DarkYellow" }
        default { "Red" }
    }
    Write-Host ("    [{0}] {1}{2}" -f $Status, $Name, $(if ($Detail) { " - $Detail" } else { "" })) -ForegroundColor $color
    $results.Add([PSCustomObject]@{ Step = $Name; Status = $Status; Detail = $Detail })
}

function Fail-Step {
    param([string]$Name, [string]$Detail)
    $failures.Add("${Name}: $Detail")
    Write-StepResult -Name $Name -Status "FAIL" -Detail $Detail
}

# OneDrive/antivirus can briefly lock files immediately after a process exits.
# Maven's clean plugin gives up after one attempt, so pre-delete with retries and
# let `mvn clean verify` operate on an already-empty target directory.
function Remove-TargetWithRetry {
    param([string]$TargetPath)
    if (-not (Test-Path $TargetPath)) { return $true }
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            Remove-Item $TargetPath -Recurse -Force -ErrorAction Stop
            return $true
        } catch {
            Start-Sleep -Milliseconds 1500
        }
    }
    return -not (Test-Path $TargetPath)
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: BUILD AND TEST ORCHESTRATION      " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Workspace Root: $root"
Write-Host "Tests:          $(if ($SkipTests) { 'SKIPPED BY REQUEST' } else { 'ENABLED' })"
Write-Host "Native target:  $(if ($SkipNative) { 'SKIPPED BY REQUEST' } else { 'AUTO-DETECT' })`n"

$javaServices = @("user-service", "product-service", "order-service", "payment-service")

foreach ($svc in $javaServices) {
    $dir = Join-Path $root "services\$svc"
    Write-Host "`n--> Building $svc [Java 25 / Spring Boot 4.0]..." -ForegroundColor Yellow
    Push-Location $dir
    try {
        $targetPath = Join-Path $dir "target"
        if (-not (Remove-TargetWithRetry -TargetPath $targetPath)) {
            Fail-Step -Name $svc -Detail "target/ is locked by another process; stop the service and retry"
            continue
        }
        if ($SkipTests) {
            & ".\mvnw.cmd" clean package -DskipTests
        } else {
            & ".\mvnw.cmd" clean verify
        }
        if ($LASTEXITCODE -ne 0) {
            Fail-Step -Name $svc -Detail "Maven exited with code $LASTEXITCODE"
        } else {
            Write-StepResult -Name $svc -Status "PASS" -Detail $(if ($SkipTests) { "packaged, tests skipped" } else { "verified with tests" })
        }
    } catch {
        Fail-Step -Name $svc -Detail $_.Exception.Message
    } finally {
        Pop-Location
    }
}

Write-Host "`n--> Building Inventory Service [C# / .NET 10 LTS]..." -ForegroundColor Yellow
$invDir = Join-Path $root "services\inventory-service"
Push-Location $invDir
try {
    if ($SkipTests) {
        & dotnet build --configuration Release
    } else {
        & dotnet test "InventoryService.Tests\InventoryService.Tests.csproj" --configuration Release
    }
    if ($LASTEXITCODE -ne 0) {
        Fail-Step -Name "inventory-service" -Detail "dotnet exited with code $LASTEXITCODE"
    } else {
        Write-StepResult -Name "inventory-service" -Status "PASS" -Detail $(if ($SkipTests) { "built, tests skipped" } else { "tested and built" })
    }
} catch {
    Fail-Step -Name "inventory-service" -Detail $_.Exception.Message
} finally {
    Pop-Location
}

Write-Host "`n--> Testing Analysis Engine [Node 26 / Express 5]..." -ForegroundColor Yellow
$engineDir = Join-Path $root "analysis-engine"
Push-Location $engineDir
try {
    & node --check src/server.js
    if ($LASTEXITCODE -ne 0) {
        Fail-Step -Name "analysis-engine syntax" -Detail "node --check failed"
    } else {
        Write-StepResult -Name "analysis-engine syntax" -Status "PASS" -Detail "server.js parses"
    }

    if (-not $SkipTests) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) {
            Fail-Step -Name "analysis-engine tests" -Detail "npm test exited with code $LASTEXITCODE"
        } else {
            Write-StepResult -Name "analysis-engine tests" -Status "PASS" -Detail "full node:test suite"
        }
    } else {
        Write-StepResult -Name "analysis-engine tests" -Status "SKIP" -Detail "requested"
    }
} catch {
    Fail-Step -Name "analysis-engine" -Detail $_.Exception.Message
} finally {
    Pop-Location
}

Write-Host "`n--> Testing and bundling Dashboard [React / Vite 6]..." -ForegroundColor Yellow
$dashDir = Join-Path $root "dashboard"
Push-Location $dashDir
try {
    if (-not $SkipTests) {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) {
            Fail-Step -Name "dashboard tests" -Detail "npm test exited with code $LASTEXITCODE"
        } else {
            Write-StepResult -Name "dashboard tests" -Status "PASS" -Detail "contract/auth suites"
        }
    } else {
        Write-StepResult -Name "dashboard tests" -Status "SKIP" -Detail "requested"
    }

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Fail-Step -Name "dashboard build" -Detail "vite build exited with code $LASTEXITCODE"
    } else {
        Write-StepResult -Name "dashboard build" -Status "PASS" -Detail "dist/ generated"
    }
} catch {
    Fail-Step -Name "dashboard" -Detail $_.Exception.Message
} finally {
    Pop-Location
}

Write-Host "`n--> Checking optional C++20 Sweep-Line Core..." -ForegroundColor Yellow
if ($SkipNative) {
    Write-StepResult -Name "cpp-core" -Status "SKIP" -Detail "requested; JS fallback remains active"
} else {
    $cmake = Get-Command cmake -ErrorAction SilentlyContinue
    $cmakeExe = if ($cmake) { $cmake.Source } else { Join-Path $root "tools\cmake\bin\cmake.exe" }
    if (-not (Test-Path $cmakeExe)) {
        Write-StepResult -Name "cpp-core" -Status "SKIP" -Detail "CMake not found; native target unverified, JS fallback active"
    } else {
        $cppDir = Join-Path $root "cpp-core"
        Push-Location $cppDir
        try {
            & $cmakeExe -S . -B build -DCMAKE_BUILD_TYPE=Release
            if ($LASTEXITCODE -ne 0) {
                Fail-Step -Name "cpp-core configure" -Detail "cmake configure exited with code $LASTEXITCODE"
            } else {
                & $cmakeExe --build build --config Release
                if ($LASTEXITCODE -ne 0) {
                    Fail-Step -Name "cpp-core build" -Detail "cmake build exited with code $LASTEXITCODE"
                } else {
                    $testExe = Join-Path $cppDir "build\Release\sweep_line_tests.exe"
                    if (-not (Test-Path $testExe)) { $testExe = Join-Path $cppDir "build\sweep_line_tests.exe" }
                    if (Test-Path $testExe) {
                        & $testExe
                        if ($LASTEXITCODE -ne 0) {
                            Fail-Step -Name "cpp-core tests" -Detail "sweep_line_tests exited with code $LASTEXITCODE"
                        } else {
                            Write-StepResult -Name "cpp-core" -Status "PASS" -Detail "native target built and tested"
                        }
                    } else {
                        Write-StepResult -Name "cpp-core" -Status "PASS" -Detail "native target built (no test executable configured)"
                    }
                }
            }
        } catch {
            Fail-Step -Name "cpp-core" -Detail $_.Exception.Message
        } finally {
            Pop-Location
        }
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "                  BUILD SUMMARY                      " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host

if ($failures.Count -gt 0) {
    Write-Host "BUILD FAILED: $($failures.Count) required step(s) failed." -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "ALL REQUIRED CAUSALOTEL COMPONENTS BUILT AND TESTED SUCCESSFULLY" -ForegroundColor Green
exit 0
