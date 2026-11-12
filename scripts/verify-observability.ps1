<#
.SYNOPSIS
    End-to-end smoke test for the native observability pipeline.
.DESCRIPTION
    Sends a real OTLP/HTTP span to the collector, confirms Tempo stores it,
    confirms Prometheus scrapes the collector, and confirms the analysis engine
    serves the trace as real (non-synthetic) telemetry.

    This script fails nonzero when any required backend is missing or when the
    pipeline does not carry the span end to end. It never creates a synthetic
    fallback trace.
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Assert-Port {
    param([int]$Port, [string]$Name)
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $listener) {
        throw "$Name is not listening on port $Port"
    }
    Write-Host "    [UP] $Name on port $Port" -ForegroundColor Green
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       CAUSALOTEL: OBSERVABILITY SMOKE TEST         " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

Assert-Port -Port 4318 -Name "OTel Collector OTLP/HTTP"
Assert-Port -Port 3200 -Name "Tempo"
Assert-Port -Port 8889 -Name "Collector Prometheus exporter"
Assert-Port -Port 9090 -Name "Prometheus"
Assert-Port -Port 5000 -Name "Analysis Engine"

$traceId = [guid]::NewGuid().ToString("N")
$spanId = ([guid]::NewGuid().ToString("N")).Substring(0, 16)
$startNanos = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() * 1000000)
$endNanos = $startNanos + 25000000

$payload = @{
    resourceSpans = @(
        @{
            resource = @{
                attributes = @(
                    @{ key = "service.name"; value = @{ stringValue = "causalotel-smoke" } }
                )
            }
            scopeSpans = @(
                @{
                    scope = @{ name = "causalotel-observability-smoke" }
                    spans = @(
                        @{
                            traceId = $traceId
                            spanId = $spanId
                            name = "observability-smoke-span"
                            kind = 1
                            startTimeUnixNano = "$startNanos"
                            endTimeUnixNano = "$endNanos"
                            status = @{ code = 1 }
                            attributes = @(
                                @{ key = "smoke.test"; value = @{ boolValue = $true } }
                            )
                        }
                    )
                }
            )
        }
    )
} | ConvertTo-Json -Depth 12

Write-Host "`n--> Sending OTLP span $traceId to the collector..." -ForegroundColor Yellow
$response = Invoke-WebRequest -Uri "http://localhost:4318/v1/traces" -Method Post `
    -ContentType "application/json" -Body $payload -TimeoutSec 10 -UseBasicParsing
if ($response.StatusCode -notin @(200, 202)) {
    throw "Collector rejected the OTLP span with HTTP $($response.StatusCode)"
}
Write-Host "    [ACCEPTED] HTTP $($response.StatusCode)" -ForegroundColor Green

Write-Host "`n--> Waiting for Tempo to expose the trace..." -ForegroundColor Yellow
$tempoBody = $null
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $tempoBody = Invoke-RestMethod -Uri "http://localhost:3200/api/traces/$traceId" -TimeoutSec 5
        if ($tempoBody) { break }
    } catch {
        # Tempo returns 404 until the trace is queryable.
    }
}
if (-not $tempoBody) {
    throw "Tempo did not return trace $traceId within 30 seconds"
}
$spanCount = 0
foreach ($batch in @($tempoBody.batches)) {
    foreach ($scope in @($batch.scopeSpans)) {
        $spanCount += @($scope.spans).Count
    }
}
if ($spanCount -lt 1) {
    throw "Tempo returned trace $traceId without any spans"
}
Write-Host "    [STORED] Tempo returned $spanCount span(s)" -ForegroundColor Green

Write-Host "`n--> Checking Prometheus scrape health..." -ForegroundColor Yellow
$upQuery = Invoke-RestMethod -Uri 'http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22otel-collector%22%7D' -TimeoutSec 10
$upResult = @($upQuery.data.result)
if ($upResult.Count -eq 0 -or $upResult[0].value[1] -ne "1") {
    throw "Prometheus is not scraping the otel-collector target successfully"
}
Write-Host "    [SCRAPING] otel-collector target is UP" -ForegroundColor Green

$targets = Invoke-RestMethod -Uri 'http://localhost:9090/api/v1/targets?state=active' -TimeoutSec 10
foreach ($target in @($targets.data.activeTargets)) {
    Write-Host ("    {0,-18} {1,-8} {2}" -f $target.labels.job, $target.health, $target.scrapeUrl) -ForegroundColor DarkGray
}

Write-Host "`n--> Verifying the analysis engine serves real telemetry..." -ForegroundColor Yellow
$traceDetail = Invoke-RestMethod -Uri "http://localhost:5000/api/analysis/traces/$traceId" -TimeoutSec 10
if ($traceDetail.source -ne "tempo") {
    throw "Analysis engine trace source is '$($traceDetail.source)', expected 'tempo'"
}
if ($traceDetail.synthetic -ne $false) {
    throw "Analysis engine marked the trace as synthetic"
}
if ([int]$traceDetail.totalSpans -lt 1) {
    throw "Analysis engine returned no spans for the smoke trace"
}
Write-Host "    [REAL] Analysis engine served $($traceDetail.totalSpans) Tempo span(s), synthetic=false" -ForegroundColor Green

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "       OBSERVABILITY PIPELINE VERIFIED              " -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Collector -> Tempo -> Analysis Engine and Collector -> Prometheus are live."
exit 0
