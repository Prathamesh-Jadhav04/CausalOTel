<#
.SYNOPSIS
    CausalOTel - Comprehensive Test Orchestration Script
.DESCRIPTION
    Runs all automated unit, integration, and architecture tests across all services
    and outputs an executive summary of results.
#>

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot\.."

if (Test-Path "C:\Program Files\dotnet") {
    $env:PATH = "C:\Program Files\dotnet;$env:PATH"
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: MASTER TEST VERIFICATION         " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$totalPassed = 0
$totalFailed = 0

function Run-Suite {
    param (
        [string]$Name,
        [string]$Directory,
        [scriptblock]$Command
    )

    Write-Host "--> Running $Name Tests..." -ForegroundColor Yellow
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
        } else {
            Write-Host "    [FAIL] $Name tests failed with exit code $exitCode" -ForegroundColor Red
            $results.Add([PSCustomObject]@{
                Service = $Name
                Status = "FAIL"
                Duration = "$($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s"
            })
        }
    } catch {
        $stopwatch.Stop()
        Write-Host "    [ERROR] $Name encountered exception: $($_.Exception.Message)" -ForegroundColor Red
        $results.Add([PSCustomObject]@{
            Service = $Name
            Status = "ERROR"
            Duration = "$($stopwatch.Elapsed.TotalSeconds.ToString('0.00'))s"
        })
    } finally {
        Pop-Location
    }
}

# 1. User Service
Run-Suite -Name "User Service (Spring Boot 4)" -Directory (Join-Path $root "services\user-service") -Command {
    & ".\mvnw.cmd" test
}

# 2. Product Service
Run-Suite -Name "Product Service (Spring Boot 4)" -Directory (Join-Path $root "services\product-service") -Command {
    & ".\mvnw.cmd" test
}

# 3. Order Service
Run-Suite -Name "Order Service (Spring Boot 4)" -Directory (Join-Path $root "services\order-service") -Command {
    & ".\mvnw.cmd" test
}

# 4. Payment Service
Run-Suite -Name "Payment Service (Spring Boot 4)" -Directory (Join-Path $root "services\payment-service") -Command {
    & ".\mvnw.cmd" test
}

# 5. Inventory Service (.NET 10)
Run-Suite -Name "Inventory Service (.NET 10 LTS)" -Directory (Join-Path $root "services\inventory-service\InventoryService.Tests") -Command {
    & dotnet test --verbosity normal
}

# 6. Analysis Engine (Node 26)
Run-Suite -Name "Analysis Engine (Node.js 26)" -Directory (Join-Path $root "analysis-engine") -Command {
    & npm.cmd test
}

# Summary Table
Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "             AGGREGATE TEST SUMMARY REPORT          " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

$results | Format-Table -AutoSize

$anyFailed = $results | Where-Object { $_.Status -ne "PASS" }
if ($anyFailed) {
    Write-Host "`n[ALERT] One or more test suites failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "`n[SUCCESS] All 6 test suites PASSED with 0 errors!" -ForegroundColor Green
    exit 0
}
