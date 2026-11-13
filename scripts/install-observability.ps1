<#
.SYNOPSIS
    Download and verify the pinned native Windows observability binaries.
.DESCRIPTION
    Installs otelcol-contrib, Tempo, and Prometheus under tools\observability
    using the versions pinned below. SHA-256 checksums are verified before any
    archive is extracted. No Docker, WSL, or administrative install is used.
#>

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$root = Resolve-Path "$PSScriptRoot\.."
$toolRoot = Join-Path $root "tools\observability"
$downloadDir = Join-Path $toolRoot "downloads"
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

$otelVersion = "0.165.0"
$tempoVersion = "3.1.1"
$prometheusVersion = "3.16.0"

$packages = @(
    [PSCustomObject]@{
        Name = "otelcol"
        Version = $otelVersion
        Url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$otelVersion/otelcol-contrib_${otelVersion}_windows_amd64.tar.gz"
        ChecksumUrl = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$otelVersion/otelcol-contrib_${otelVersion}_windows_amd64.tar.gz.sha256"
        Archive = "otelcol-contrib_${otelVersion}_windows_amd64.tar.gz"
        ChecksumFile = "otelcol.sha256"
        Exe = "otelcol-contrib.exe"
        Destination = Join-Path $toolRoot "otelcol"
    },
    [PSCustomObject]@{
        Name = "tempo"
        Version = $tempoVersion
        Url = "https://github.com/grafana/tempo/releases/download/v$tempoVersion/tempo_${tempoVersion}_windows_amd64.tar.gz"
        ChecksumUrl = "https://github.com/grafana/tempo/releases/download/v$tempoVersion/SHA256SUMS"
        Archive = "tempo_${tempoVersion}_windows_amd64.tar.gz"
        ChecksumFile = "tempo.sha256"
        Exe = "tempo.exe"
        Destination = Join-Path $toolRoot "tempo"
    },
    [PSCustomObject]@{
        Name = "prometheus"
        Version = $prometheusVersion
        Url = "https://github.com/prometheus/prometheus/releases/download/v$prometheusVersion/prometheus-${prometheusVersion}.windows-amd64.zip"
        ChecksumUrl = "https://github.com/prometheus/prometheus/releases/download/v$prometheusVersion/sha256sums.txt"
        Archive = "prometheus-${prometheusVersion}.windows-amd64.zip"
        ChecksumFile = "prometheus.sha256"
        Exe = "prometheus.exe"
        Destination = Join-Path $toolRoot "prometheus"
    }
)

function Get-ExpectedHash {
    param([string]$ChecksumPath, [string]$ArchiveName)
    $lines = Get-Content $ChecksumPath
    foreach ($line in $lines) {
        if ($line -match "^([0-9a-fA-F]{64})\s+\*?(.+)$") {
            if ([System.IO.Path]::GetFileName($matches[2].Trim()) -eq $ArchiveName) {
                return $matches[1].ToLowerInvariant()
            }
        }
        if ($line -match "^([0-9a-fA-F]{64})$" -and $ArchiveName -like "otelcol*") {
            return $matches[1].ToLowerInvariant()
        }
    }
    throw "No SHA-256 entry for $ArchiveName in $ChecksumPath"
}

foreach ($pkg in $packages) {
    $exePath = Join-Path $pkg.Destination $pkg.Exe
    if ((Test-Path $exePath) -and -not $Force) {
        Write-Host "[SKIP] $($pkg.Name) already installed at $exePath" -ForegroundColor DarkYellow
        continue
    }

    Write-Host "`n--> Installing $($pkg.Name) $($pkg.Version)..." -ForegroundColor Yellow
    $archivePath = Join-Path $downloadDir $pkg.Archive
    $checksumPath = Join-Path $downloadDir $pkg.ChecksumFile

    if (-not (Test-Path $archivePath) -or $Force) {
        Write-Host "    Downloading $($pkg.Url)"
        Invoke-WebRequest -Uri $pkg.Url -OutFile $archivePath -UseBasicParsing
    }
    if (-not (Test-Path $checksumPath) -or $Force) {
        Invoke-WebRequest -Uri $pkg.ChecksumUrl -OutFile $checksumPath -UseBasicParsing
    }

    $expected = Get-ExpectedHash -ChecksumPath $checksumPath -ArchiveName $pkg.Archive
    $actual = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "Checksum mismatch for $($pkg.Archive): expected $expected, got $actual"
    }
    Write-Host "    [VERIFIED] SHA-256 $actual" -ForegroundColor Green

    $extractDir = Join-Path $downloadDir "$($pkg.Name)-extract"
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    if ($pkg.Archive.EndsWith(".zip")) {
        Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
    } else {
        & tar.exe -xzf $archivePath -C $extractDir
        if ($LASTEXITCODE -ne 0) { throw "tar extraction failed for $($pkg.Archive)" }
    }

    $found = Get-ChildItem -Path $extractDir -Recurse -File -Filter $pkg.Exe | Select-Object -First 1
    if (-not $found) {
        throw "$($pkg.Exe) not found in $($pkg.Archive)"
    }

    New-Item -ItemType Directory -Path $pkg.Destination -Force | Out-Null
    Copy-Item $found.FullName (Join-Path $pkg.Destination $pkg.Exe) -Force
    Set-Content -Path (Join-Path $pkg.Destination "VERSION") -Value $pkg.Version
    Write-Host "    [INSTALLED] $($pkg.Destination)\$($pkg.Exe)" -ForegroundColor Green
}

Write-Host "`nAll observability binaries are installed under $toolRoot" -ForegroundColor Cyan
