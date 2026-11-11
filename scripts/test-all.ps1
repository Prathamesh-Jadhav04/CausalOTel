<#
.SYNOPSIS
    CausalOTel - Comprehensive Test Orchestration Script (isolated)
.DESCRIPTION
    Runs all automated unit, integration, and architecture tests across all services.

    Safety contract:
      * Every suite runs with LOCALAPPDATA redirected to a fresh temporary root.
      * Every SQLite-backed suite receives an explicit temporary SQLITE_DB_PATH.
      * The live %LOCALAPPDATA%\CausalOTel\data directory is fingerprinted before
        and after the run. If any live database changes, the run fails.
      * No suite is allowed to delete or migrate live application data.
#>

param(
    [switch]$KeepTestArtifacts
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."

if (Test-Path "C:\Program Files\dotnet") {
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
}

$realLocalAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$liveDataDir = Join-Path $realLocalAppData "CausalOTel\data"

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("causalotel-test-run-" + [guid]::NewGuid().ToString("N"))
$testDataDir = Join-Path $testRoot "CausalOTel\data"
$testSpoolDir = Join-Path $testRoot "CausalOTel\spool\incidents"
$testLogDir = Join-Path $testRoot "logs"
New-Item -ItemType Directory -Path $testDataDir, $testSpoolDir, $testLogDir -Force | Out-Null

function Get-LiveDatabaseFingerprint {
    param([string]$DataDirectory)

    $fingerprint = [ordered]@{}
    foreach ($name in @("user.db", "product.db", "order.db", "payment.db", "inventory.db")) {
        $path = Join-Path $DataDirectory $name
        if (Test-Path $path) {
            $file = Get-Item -LiteralPath $path
            $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            $fingerprint[$name] = "$hash|$($file.Length)|$($file.LastWriteTimeUtc.Ticks)"
        } else {
            $fingerprint[$name] = "ABSENT"
        }
    }
    return $fingerprint
}

function Get-LiveSpoolFingerprint {
    param([string]$SpoolDirectory)

    if (-not (Test-Path $SpoolDirectory)) {
        return "ABSENT"
    }

    $entries = Get-ChildItem -LiteralPath $SpoolDirectory -File -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
            $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            "$($_.Name)|$($_.Length)|$hash"
        }
    return ($entries -join ";")
}

$liveSpoolDir = Join-Path $realLocalAppData "CausalOTel\spool\incidents"
$liveBefore = Get-LiveDatabaseFingerprint -DataDirectory $liveDataDir
$liveSpoolBefore = Get-LiveSpoolFingerprint -SpoolDirectory $liveSpoolDir

# Redirect every child process away from the real application-data directory.
$env:LOCALAPPDATA = $testRoot
$env:CAUSALOTEL_TEST_MODE = "1"
$env:CAUSALOTEL_TEST_ROOT = $testRoot
$env:SPOOL_DIR = $testSpoolDir

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "     CAUSALOTEL: ISOLATED MASTER TEST RUN           " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Timestamp:        $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Test root:        $testRoot"
Write-Host "Live data:        $liveDataDir (fingerprinted, read-only)"
Write-Host "Test LOCALAPPDATA: $env:LOCALAPPDATA`n"

if ($env:LOCALAPPDATA -eq $realLocalAppData) {
    Write-Host "[FATAL] LOCALAPPDATA was not redirected; refusing to run tests." -ForegroundColor Red
    exit 2
}
if (-not ([System.IO.Path]::GetFullPath($env:LOCALAPPDATA).StartsWith([System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())))) {
    Write-Host "[FATAL] Test LOCALAPPDATA is not under the system temp directory." -ForegroundColor Red
    exit 2
}

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$totalPassed = 0
$totalFailed = 0

function Run-Suite {
    param (
        [string]$Name,
        [string]$Directory,
        [scriptblock]$Command,
        [string]$DatabaseFile
    )

    if ($DatabaseFile) {
        $env:SQLITE_DB_PATH = Join-Path $testDataDir $DatabaseFile
    } else {
        Remove-Item Env:SQLITE_DB_PATH -ErrorAction SilentlyContinue
    }

    Write-Host "--> Running $Name Tests..." -ForegroundColor Yellow
    Write-Host "    DB: $(if ($env:SQLITE_DB_PATH) { $env:SQLITE_DB_PATH } else { '(not SQLite-backed)' })" -ForegroundColor DarkGray
    Push-Location $Directory
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Command
        $exitCode = $LASTEXITCODE
        $stopwatch.Stop()
        if ($exitCode -eq 0) {
            Write-Host "    [PASS] $Name tests succeeded in $($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s" -ForegroundColor Green
            $results.Add([PSCustomObject]@{
                Service = $Name
                Status = "PASS"
                Duration = "$($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s"
            })
            $script:totalPassed++
        } else {
            Write-Host "    [FAIL] $Name tests failed with exit code $exitCode" -ForegroundColor Red
            $results.Add([PSCustomObject]@{
                Service = $Name
                Status = "FAIL"
                Duration = "$($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s"
            })
            $script:totalFailed++
        }
    } catch {
        $stopwatch.Stop()
        Write-Host "    [ERROR] $Name encountered exception: $($_.Exception.Message)" -ForegroundColor Red
        $results.Add([PSCustomObject]@{
            Service = $Name
            Status = "ERROR"
            Duration = "$($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s"
        })
        $script:totalFailed++
    } finally {
        Pop-Location
        Remove-Item Env:SQLITE_DB_PATH -ErrorAction SilentlyContinue
    }
}

try {
    # 1. User Service
    Run-Suite -Name "User Service (Spring Boot 4)" -Directory (Join-Path $root "services\user-service") -DatabaseFile "user.db" -Command {
        & ".\mvnw.cmd" test
    }

    # 2. Product Service
    Run-Suite -Name "Product Service (Spring Boot 4)" -Directory (Join-Path $root "services\product-service") -DatabaseFile "product.db" -Command {
        & ".\mvnw.cmd" test
    }

    # 3. Order Service
    Run-Suite -Name "Order Service (Spring Boot 4)" -Directory (Join-Path $root "services\order-service") -DatabaseFile "order.db" -Command {
        & ".\mvnw.cmd" test
    }

    # 4. Payment Service
    Run-Suite -Name "Payment Service (Spring Boot 4)" -Directory (Join-Path $root "services\payment-service") -DatabaseFile "payment.db" -Command {
        & ".\mvnw.cmd" test
    }

    # 5. Inventory Service (.NET 10)
    Run-Suite -Name "Inventory Service (.NET 10 LTS)" -Directory (Join-Path $root "services\inventory-service\InventoryService.Tests") -DatabaseFile "inventory.db" -Command {
        & dotnet test --verbosity normal
    }

    # 6. Analysis Engine (Node 26)
    Run-Suite -Name "Analysis Engine (Node.js 26)" -Directory (Join-Path $root "analysis-engine") -Command {
        & npm.cmd test
    }
} finally {
    Remove-Item Env:SQLITE_DB_PATH -ErrorAction SilentlyContinue
}

# Prove the live databases were not touched by the test run.
$liveAfter = Get-LiveDatabaseFingerprint -DataDirectory $liveDataDir
$liveSpoolAfter = Get-LiveSpoolFingerprint -SpoolDirectory $liveSpoolDir
$changed = @()
foreach ($name in $liveBefore.Keys) {
    if ($liveBefore[$name] -ne $liveAfter[$name]) {
        $changed += $name
    }
}
if ($liveSpoolBefore -ne $liveSpoolAfter) {
    $changed += "spool/incidents"
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "             AGGREGATE TEST SUMMARY REPORT          " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$results | Format-Table -AutoSize

Write-Host "`nLive database integrity:" -ForegroundColor Cyan
foreach ($name in $liveBefore.Keys) {
    $state = if ($liveBefore[$name] -eq $liveAfter[$name]) { "UNCHANGED" } else { "CHANGED" }
    $color = if ($state -eq "UNCHANGED") { "Green" } else { "Red" }
    Write-Host ("  {0,-16} {1}" -f $name, $state) -ForegroundColor $color
}
$spoolState = if ($liveSpoolBefore -eq $liveSpoolAfter) { "UNCHANGED" } else { "CHANGED" }
$spoolColor = if ($spoolState -eq "UNCHANGED") { "Green" } else { "Red" }
Write-Host ("  {0,-16} {1}" -f "spool/incidents", $spoolState) -ForegroundColor $spoolColor

if ($changed.Count -gt 0) {
    Write-Host "`n[ALERT] Test run changed live application database(s): $($changed -join ', ')" -ForegroundColor Red
    Write-Host "        This violates test isolation. Do not trust this run." -ForegroundColor Red
    exit 1
}

if ($totalFailed -gt 0) {
    Write-Host "`n[ALERT] One or more test suites failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`n[SUCCESS] All 6 test suites PASSED and live databases are unchanged." -ForegroundColor Green
Write-Host "Test artifacts: $testRoot" -ForegroundColor DarkGray
if (-not $KeepTestArtifacts) {
    Write-Host "Artifacts are retained for evidence; remove the directory manually when no longer needed." -ForegroundColor DarkGray
}
exit 0
