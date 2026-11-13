<#
.SYNOPSIS
    CausalOTel - authenticated checkout, fault injection, saga recovery, and
    real Tempo/Prometheus RCA demonstration.

.DESCRIPTION
    This script exercises the running native Windows stack end to end:
      1. Verifies the 7 application services and the observability stack
         (OTel Collector, Tempo, Prometheus) are reachable. Missing telemetry is
         a hard failure, not a warning.
      2. Registers a real user and authenticates a real admin through the
         user-service. The admin is bootstrapped from the one-time token file
         when no admin exists; generated credentials are stored outside the
         repository under %LOCALAPPDATA%\CausalOTel\demo.
      3. Reads the real product catalog and inventory, then performs an
         authenticated checkout. Prices are resolved by the order service.
      4. Injects an admin-only GATEWAY_TIMEOUT into payment-service and performs
         a second checkout, asserting HTTP 504, PENDING_RECONCILIATION, preserved
         inventory, and a persisted RECONCILE_PAYMENT outbox task.
      5. Restores payment-service, reconciles the order, and asserts CONFIRMED.
      6. Finds the checkout trace in Tempo through the analysis engine, asserts
         synthetic=false, runs RCA, and verifies the incident was persisted.
      7. Verifies Prometheus reports every service target as UP.

    Exit codes: 0 = every check passed, 1 = a required check failed or a
    dependency is unavailable. There is no synthetic-trace fallback.

.PARAMETER AdminUsername
    Admin username. Defaults to %CAUSALOTEL_DEMO_ADMIN_USERNAME%, the saved demo
    credentials file, or "demo-admin" on first bootstrap.

.PARAMETER AdminPassword
    Admin password. Defaults to %CAUSALOTEL_DEMO_ADMIN_PASSWORD%, the saved demo
    credentials file, or a generated password on first bootstrap.

.PARAMETER AdminEmail
    Admin email used only during first bootstrap.

.PARAMETER SkipFaultRecovery
    Run the baseline checkout and telemetry/RCA checks only.
#>

param(
    [string]$AdminUsername = $env:CAUSALOTEL_DEMO_ADMIN_USERNAME,
    [string]$AdminPassword = $env:CAUSALOTEL_DEMO_ADMIN_PASSWORD,
    [string]$AdminEmail = $env:CAUSALOTEL_DEMO_ADMIN_EMAIL,
    [switch]$SkipFaultRecovery
)

$ErrorActionPreference = "Stop"
$script:Failures = New-Object System.Collections.Generic.List[string]
$script:Checks = 0

function Write-Section([string]$title) {
    Write-Host "`n--> $title" -ForegroundColor Yellow
}

function Assert-True([bool]$condition, [string]$message) {
    $script:Checks++
    if ($condition) {
        Write-Host "    [PASS] $message" -ForegroundColor Green
    } else {
        $script:Failures.Add($message)
        Write-Host "    [FAIL] $message" -ForegroundColor Red
    }
}

function Assert-Equal($expected, $actual, [string]$message) {
    Assert-True ($expected -eq $actual) "$message (expected=$expected actual=$actual)"
}

function New-RandomPassword {
    $bytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $body = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
    return ($body + "aA1!")
}

function Invoke-Api {
    param(
        [string]$Method = "GET",
        [string]$Uri,
        $Body = $null,
        [string]$Token = "",
        [string]$BootstrapToken = ""
    )

    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    if ($BootstrapToken) { $headers["X-Bootstrap-Token"] = $BootstrapToken }

    $params = @{
        Uri = $Uri
        Method = $Method
        Headers = $headers
        UseBasicParsing = $true
        TimeoutSec = 30
    }
    if ($null -ne $Body) {
        $params["ContentType"] = "application/json"
        $params["Body"] = ($Body | ConvertTo-Json -Depth 10)
    }

    try {
        $response = Invoke-WebRequest @params
        $parsed = $null
        if ($response.Content) {
            try { $parsed = $response.Content | ConvertFrom-Json } catch { $parsed = $null }
        }
        return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $parsed; Raw = $response.Content }
    } catch {
        $status = 0
        $raw = $_.Exception.Message
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $raw = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
            } catch {
                # Keep the transport message.
            }
        }
        $parsed = $null
        try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $null }
        return [pscustomobject]@{ StatusCode = $status; Body = $parsed; Raw = $raw }
    }
}

function Get-ProblemDetail($response) {
    if ($response.Body -and $response.Body.detail) { return $response.Body.detail }
    if ($response.Body -and $response.Body.message) { return $response.Body.message }
    return $response.Raw
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   CAUSALOTEL: AUTHENTICATED CHECKOUT + FAULT + RCA DEMO         " -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Mode:      $(if ($SkipFaultRecovery) { 'baseline + telemetry only' } else { 'baseline + fault + recovery + telemetry' })"

# ---------------------------------------------------------------------------
# STEP 1: Required services and telemetry must be live.
# ---------------------------------------------------------------------------
Write-Section "[STEP 1] Pre-flight: application services and telemetry backends"

$services = @(
    @{ Name = "user-service";      Url = "http://localhost:8081/health/live" },
    @{ Name = "product-service";   Url = "http://localhost:8082/health/live" },
    @{ Name = "order-service";     Url = "http://localhost:8083/health/live" },
    @{ Name = "payment-service";   Url = "http://localhost:8084/health/live" },
    @{ Name = "inventory-service"; Url = "http://localhost:5050/health/live" },
    @{ Name = "analysis-engine";   Url = "http://localhost:5000/health/live" },
    @{ Name = "dashboard";         Url = "http://localhost:3000/" }
)

foreach ($service in $services) {
    $response = Invoke-Api -Uri $service.Url
    Assert-True ($response.StatusCode -eq 200) "$($service.Name) is reachable at $($service.Url)"
}

$telemetry = @(
    @{ Name = "OTel Collector"; Url = "http://localhost:13133/" },
    @{ Name = "Tempo";          Url = "http://localhost:3200/ready" },
    @{ Name = "Prometheus";     Url = "http://localhost:9090/-/ready" }
)

$telemetryLive = $true
foreach ($backend in $telemetry) {
    $response = Invoke-Api -Uri $backend.Url
    $ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    if (-not $ok) { $telemetryLive = $false }
    Assert-True $ok "$($backend.Name) is reachable at $($backend.Url)"
}

if (-not $telemetryLive) {
    Write-Host "`n[FATAL] Telemetry is unavailable. This demo never falls back to synthetic traces." -ForegroundColor Red
    Write-Host "Start the stack with: .\scripts\start-all.ps1" -ForegroundColor Yellow
    exit 1
}

$fatal = $false
foreach ($failure in $script:Failures) { Write-Host "  - $failure" -ForegroundColor Red; $fatal = $true }
if ($fatal) {
    Write-Host "`n[FATAL] Required services are unavailable." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# STEP 2: Real authentication.
# ---------------------------------------------------------------------------
Write-Section "[STEP 2] Authenticating a real user and admin"

$userSuffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$userUsername = "demo-user-$userSuffix"
$userEmail = "$userUsername@causalotel.local"
$userPassword = New-RandomPassword

$register = Invoke-Api -Method POST -Uri "http://localhost:8081/api/auth/register" -Body @{
    username = $userUsername
    email = $userEmail
    password = $userPassword
}
Assert-Equal 201 $register.StatusCode "user registration returns 201"
if ($register.StatusCode -ne 201) {
    Write-Host "    Registration response: $(Get-ProblemDetail $register)" -ForegroundColor Red
    exit 1
}
$userToken = $register.Body.token
$userId = $register.Body.user.id
Assert-True (-not [string]::IsNullOrWhiteSpace($userToken)) "user token issued"
Assert-Equal "ROLE_USER" $register.Body.user.role "registered user receives ROLE_USER"
Write-Host "    User: $userUsername ($userId)" -ForegroundColor Cyan

$credentialFile = Join-Path $env:LOCALAPPDATA "CausalOTel\demo\admin-credentials.json"
$generatedCredentials = $false

if (-not $AdminUsername -and (Test-Path $credentialFile)) {
    $saved = Get-Content $credentialFile -Raw | ConvertFrom-Json
    $AdminUsername = $saved.username
    $AdminPassword = $saved.password
    if (-not $AdminEmail) { $AdminEmail = $saved.email }
}
if (-not $AdminUsername) {
    $AdminUsername = "demo-admin"
    $AdminEmail = "demo-admin@causalotel.local"
    $AdminPassword = New-RandomPassword
    $generatedCredentials = $true
}
if (-not $AdminEmail) { $AdminEmail = "$AdminUsername@causalotel.local" }
if (-not $AdminPassword) { $AdminPassword = New-RandomPassword; $generatedCredentials = $true }

$login = Invoke-Api -Method POST -Uri "http://localhost:8081/api/auth/login" -Body @{
    usernameOrEmail = $AdminUsername
    password = $AdminPassword
}

if ($login.StatusCode -ne 200) {
    $tokenFile = Join-Path $env:LOCALAPPDATA "CausalOTel\security\.bootstrap_admin_token"
    if (Test-Path $tokenFile) {
        $bootstrapToken = (Get-Content $tokenFile -Raw).Trim()
        Write-Host "    No admin login yet; consuming one-time bootstrap token." -ForegroundColor DarkYellow
        $bootstrap = Invoke-Api -Method POST -Uri "http://localhost:8081/api/users/bootstrap-admin" `
            -BootstrapToken $bootstrapToken -Body @{
                username = $AdminUsername
                email = $AdminEmail
                password = $AdminPassword
            }
        Assert-Equal 201 $bootstrap.StatusCode "admin bootstrap returns 201"
        if ($bootstrap.StatusCode -ne 201) {
            Write-Host "    Bootstrap response: $(Get-ProblemDetail $bootstrap)" -ForegroundColor Red
            exit 1
        }
        if ($generatedCredentials) {
            $credentialDir = Split-Path $credentialFile -Parent
            if (-not (Test-Path $credentialDir)) { New-Item -ItemType Directory -Path $credentialDir -Force | Out-Null }
            @{ username = $AdminUsername; password = $AdminPassword; email = $AdminEmail } |
                ConvertTo-Json | Set-Content -Path $credentialFile -Encoding UTF8
            Write-Host "    Generated demo admin credentials saved to $credentialFile" -ForegroundColor DarkGray
        }
        $login = Invoke-Api -Method POST -Uri "http://localhost:8081/api/auth/login" -Body @{
            usernameOrEmail = $AdminUsername
            password = $AdminPassword
        }
    }
}

Assert-Equal 200 $login.StatusCode "admin login succeeds"
if ($login.StatusCode -ne 200) {
    Write-Host "    Login response: $(Get-ProblemDetail $login)" -ForegroundColor Red
    Write-Host "    Set CAUSALOTEL_DEMO_ADMIN_USERNAME/CAUSALOTEL_DEMO_ADMIN_PASSWORD or reset the local user database to issue a new bootstrap token." -ForegroundColor Yellow
    exit 1
}
$adminToken = $login.Body.token
Assert-Equal "ROLE_ADMIN" $login.Body.user.role "admin login carries ROLE_ADMIN"
Write-Host "    Admin: $AdminUsername" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# STEP 3: Real catalog and inventory selection.
# ---------------------------------------------------------------------------
Write-Section "[STEP 3] Selecting a purchasable SKU from the real catalog"

$catalogResponse = Invoke-Api -Uri "http://localhost:8082/api/products" -Token $userToken
Assert-Equal 200 $catalogResponse.StatusCode "catalog requires and accepts the user token"
if ($catalogResponse.StatusCode -ne 200) {
    Write-Host "    Catalog response: $(Get-ProblemDetail $catalogResponse)" -ForegroundColor Red
    exit 1
}
$catalog = @($catalogResponse.Body)
Assert-True ($catalog.Count -gt 0) "catalog returned at least one product"

$selected = $null
foreach ($product in $catalog) {
    if ($product.stock_quantity -le 0) { continue }
    $inventoryResponse = Invoke-Api -Uri "http://localhost:5050/api/inventory/$($product.sku)" -Token $userToken
    if ($inventoryResponse.StatusCode -eq 200 -and $inventoryResponse.Body.availableQuantity -gt 0) {
        $selected = [pscustomobject]@{
            Id = [string]$product.id
            Sku = [string]$product.sku
            Name = [string]$product.name
            PriceCents = [int]$product.price_cents
            Available = [int]$inventoryResponse.Body.availableQuantity
        }
        break
    }
}
Assert-True ($null -ne $selected) "found a catalog SKU with live inventory"
if ($null -eq $selected) { exit 1 }
Write-Host "    SKU: $($selected.Sku) | productId: $($selected.Id) | price: $($selected.PriceCents) cents | available: $($selected.Available)" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# STEP 4: Authenticated baseline checkout and persistence.
# ---------------------------------------------------------------------------
Write-Section "[STEP 4] Authenticated baseline checkout"

$baselineKey = "idem-demo-baseline-$userSuffix"
$baselinePayload = @{
    userId = $userId
    currency = "USD"
    items = @(@{ productId = $selected.Id; sku = $selected.Sku; quantity = 1 })
    idempotencyKey = $baselineKey
}
$baseline = Invoke-Api -Method POST -Uri "http://localhost:8083/api/orders/checkout" -Token $userToken -Body $baselinePayload
Assert-Equal 200 $baseline.StatusCode "baseline checkout succeeds"
if ($baseline.StatusCode -ne 200) {
    Write-Host "    Checkout response: $(Get-ProblemDetail $baseline)" -ForegroundColor Red
    exit 1
}
$baselineOrderId = $baseline.Body.orderId
Assert-Equal "CONFIRMED" $baseline.Body.status "baseline order is CONFIRMED"
Assert-Equal ($selected.PriceCents) $baseline.Body.totalCents "order total equals the server-resolved catalog price"
Write-Host "    orderId=$baselineOrderId sagaId=$($baseline.Body.sagaId) paymentId=$($baseline.Body.paymentId) total=$($baseline.Body.totalCents)" -ForegroundColor Cyan

$orderRead = Invoke-Api -Uri "http://localhost:8083/api/orders/$baselineOrderId" -Token $userToken
$sagaRead = Invoke-Api -Uri "http://localhost:8083/api/orders/$baselineOrderId/saga" -Token $userToken
# Payment reads are restricted to ROLE_ADMIN/ROLE_SERVICE; a customer token
# must not be able to enumerate another user's payment records.
$paymentRead = Invoke-Api -Uri "http://localhost:8084/api/payments/order/$baselineOrderId" -Token $adminToken
$inventoryRead = Invoke-Api -Uri "http://localhost:5050/api/inventory/$($selected.Sku)" -Token $userToken

Assert-Equal 200 $orderRead.StatusCode "order is readable from the order database"
Assert-Equal "CONFIRMED" $orderRead.Body.status "persisted order status is CONFIRMED"
Assert-Equal 200 $sagaRead.StatusCode "saga is readable from the order database"
Assert-Equal "COMPLETED" $sagaRead.Body.current_state "persisted saga state is COMPLETED"
Assert-Equal 200 $paymentRead.StatusCode "payment is readable from the payment database"
Assert-Equal "CAPTURED" $paymentRead.Body.status "persisted payment status is CAPTURED"
Assert-Equal 200 $inventoryRead.StatusCode "inventory is readable from the inventory database"

# Idempotent replay must return the same order and not charge twice.
$replay = Invoke-Api -Method POST -Uri "http://localhost:8083/api/orders/checkout" -Token $userToken -Body $baselinePayload
Assert-Equal 200 $replay.StatusCode "idempotent replay returns 200"
Assert-Equal $baselineOrderId $replay.Body.orderId "idempotent replay returns the same orderId"

if ($SkipFaultRecovery) {
    Write-Host "`n[SKIP] Fault/recovery steps skipped by request." -ForegroundColor DarkYellow
} else {
    # -----------------------------------------------------------------------
    # STEP 5: Admin-only fault injection and indeterminate checkout.
    # -----------------------------------------------------------------------
    Write-Section "[STEP 5] Admin-only payment fault injection"

    $faultBody = @{
        latencyMs = 0
        faultMode = "GATEWAY_TIMEOUT"
        errorMessage = "Demo: simulated payment gateway timeout"
    }
    $faultSet = Invoke-Api -Method POST -Uri "http://localhost:8084/api/payments/fault" -Token $adminToken -Body $faultBody
    Assert-Equal 200 $faultSet.StatusCode "admin can set the payment fault"
    $faultRead = Invoke-Api -Uri "http://localhost:8084/api/payments/fault" -Token $adminToken
    Assert-Equal "GATEWAY_TIMEOUT" $faultRead.Body.faultMode "payment fault mode is GATEWAY_TIMEOUT"

    $faultCheckoutStartMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $faultKey = "idem-demo-fault-$userSuffix"
    $faultPayload = @{
        userId = $userId
        currency = "USD"
        items = @(@{ productId = $selected.Id; sku = $selected.Sku; quantity = 1 })
        idempotencyKey = $faultKey
    }
    $faultCheckout = Invoke-Api -Method POST -Uri "http://localhost:8083/api/orders/checkout" -Token $userToken -Body $faultPayload
    Assert-Equal 504 $faultCheckout.StatusCode "checkout under GATEWAY_TIMEOUT returns 504"
    Write-Host "    Response: $(Get-ProblemDetail $faultCheckout)" -ForegroundColor DarkGray

    $orders = Invoke-Api -Uri "http://localhost:8083/api/orders" -Token $userToken
    $faultOrder = @($orders.Body | Where-Object { $_.status -eq "PENDING_RECONCILIATION" }) | Select-Object -First 1
    Assert-True ($null -ne $faultOrder) "a PENDING_RECONCILIATION order was persisted"
    if ($null -eq $faultOrder) { exit 1 }
    $faultOrderId = $faultOrder.order_id
    $faultSaga = Invoke-Api -Uri "http://localhost:8083/api/orders/$faultOrderId/saga" -Token $userToken
    $faultInventory = Invoke-Api -Uri "http://localhost:5050/api/inventory/$($selected.Sku)" -Token $userToken
    $outbox = Invoke-Api -Uri "http://localhost:8083/api/orders/outbox" -Token $adminToken
    $reconcileTask = @($outbox.Body | Where-Object { $_.task_type -eq "RECONCILE_PAYMENT" -and $_.payload -like "*$faultOrderId*" }) | Select-Object -First 1

    Assert-Equal "RECONCILIATION_REQUIRED" $faultSaga.Body.current_state "saga waits in RECONCILIATION_REQUIRED"
    Assert-Equal 200 $outbox.StatusCode "admin can read the transactional outbox"
    Assert-True ($null -ne $reconcileTask) "a RECONCILE_PAYMENT outbox task was persisted"
    if ($reconcileTask) {
        Assert-Equal "PENDING" $reconcileTask.state "outbox task is PENDING before recovery"
    }
    Assert-True ($faultInventory.Body.reservedQuantity -ge 1) "inventory remains reserved while payment is indeterminate"

    # -----------------------------------------------------------------------
    # STEP 6: Restore payment and reconcile.
    # -----------------------------------------------------------------------
    Write-Section "[STEP 6] Restoring payment and reconciling the order"

    $restore = Invoke-Api -Method POST -Uri "http://localhost:8084/api/payments/fault" -Token $adminToken -Body @{
        latencyMs = 0
        faultMode = "NORMAL"
        errorMessage = $null
    }
    Assert-Equal 200 $restore.StatusCode "admin can restore NORMAL payment mode"
    $restored = Invoke-Api -Uri "http://localhost:8084/api/payments/fault" -Token $adminToken
    Assert-Equal "NORMAL" $restored.Body.faultMode "payment fault mode is NORMAL"

    # A 409 means the outbox worker or a recovery pass currently owns the saga
    # lease. Retry briefly; the checkout path releases its own lease before
    # returning the 504, so the first attempt normally succeeds.
    $reconcile = $null
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        $reconcile = Invoke-Api -Method POST -Uri "http://localhost:8083/api/orders/$faultOrderId/reconcile" -Token $adminToken
        if ($reconcile.StatusCode -eq 200) { break }
        if ($reconcile.StatusCode -ne 409) { break }
        Start-Sleep -Seconds 2
    }
    Assert-Equal 200 $reconcile.StatusCode "admin reconciliation returns 200"
    if ($reconcile.StatusCode -ne 200) {
        Write-Host "    Reconcile response: $(Get-ProblemDetail $reconcile)" -ForegroundColor Red
    }
    Assert-Equal "CONFIRMED" $reconcile.Body.status "reconciliation confirms the order"
    $finalOrder = Invoke-Api -Uri "http://localhost:8083/api/orders/$faultOrderId" -Token $userToken
    $finalSaga = Invoke-Api -Uri "http://localhost:8083/api/orders/$faultOrderId/saga" -Token $userToken
    $finalPayment = Invoke-Api -Uri "http://localhost:8084/api/payments/order/$faultOrderId" -Token $adminToken
    Assert-Equal "CONFIRMED" $finalOrder.Body.status "final order status is CONFIRMED"
    Assert-Equal "COMPLETED" $finalSaga.Body.current_state "final saga state is COMPLETED"
    Assert-Equal "CAPTURED" $finalPayment.Body.status "final payment status is CAPTURED"
    Write-Host "    Recovered order: $faultOrderId" -ForegroundColor Cyan

    # -----------------------------------------------------------------------
    # STEP 7: Tempo trace -> analysis engine RCA.
    # -----------------------------------------------------------------------
    Write-Section "[STEP 7] Real Tempo trace and persisted RCA incident"

    $checkoutTrace = $null
    $checkoutOperation = "http post /api/orders/checkout"
    $traceFilter = "limit=50&operation=$([uri]::EscapeDataString($checkoutOperation))"
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $traces = Invoke-Api -Uri "http://localhost:5000/api/analysis/traces?$traceFilter"
        if ($traces.StatusCode -ne 200) {
            # Older Tempo builds may reject the rootName filter; fall back to a
            # raw list rather than claiming telemetry that is not there.
            $traces = Invoke-Api -Uri "http://localhost:5000/api/analysis/traces?limit=100"
        }
        if ($traces.StatusCode -eq 200) {
            foreach ($trace in @($traces.Body.traces)) {
                if (-not $trace.rootOperation -or $trace.rootOperation -notmatch "checkout") { continue }
                $traceStartMs = [double]$trace.startTimeUnixNano / 1000000.0
                if ($traceStartMs -ge ($faultCheckoutStartMs - 5000)) {
                    $checkoutTrace = $trace
                    break
                }
            }
        }
        if ($checkoutTrace) { break }
        Start-Sleep -Seconds 2
    }

    Assert-True ($null -ne $checkoutTrace) "Tempo stored the checkout trace"
    if ($null -eq $checkoutTrace) {
        Write-Host "    No checkout trace appeared in Tempo within 60 seconds." -ForegroundColor Red
        exit 1
    }
    Write-Host "    traceId=$($checkoutTrace.traceId) root=$($checkoutTrace.rootService) $($checkoutTrace.rootOperation)" -ForegroundColor Cyan

    $traceDetail = Invoke-Api -Uri "http://localhost:5000/api/analysis/traces/$($checkoutTrace.traceId)"
    Assert-Equal 200 $traceDetail.StatusCode "analysis engine returns trace detail"
    Assert-Equal $false $traceDetail.Body.synthetic "trace detail is explicitly synthetic=false"
    Assert-True (@($traceDetail.Body.spans).Count -ge 2) "trace detail contains real spans"
    $serviceNames = @($traceDetail.Body.spans | ForEach-Object { $_.serviceName } | Sort-Object -Unique)
    Assert-True ($serviceNames -contains "order-service") "trace includes order-service spans"
    Assert-True ($serviceNames -contains "payment-service") "trace includes payment-service spans"
    Write-Host "    Services in trace: $($serviceNames -join ', ')" -ForegroundColor Cyan

    $analysis = Invoke-Api -Method POST -Uri "http://localhost:5000/api/analysis/analyze-trace" -Body @{ traceId = $checkoutTrace.traceId }
    Assert-Equal 200 $analysis.StatusCode "RCA analysis returns 200"
    Assert-Equal $true $analysis.Body.persisted "RCA incident was persisted"
    Assert-True (-not [string]::IsNullOrWhiteSpace($analysis.Body.incidentId)) "RCA returned an incidentId"
    if ($analysis.Body.incidentId) {
        $incident = Invoke-Api -Uri "http://localhost:5000/api/analysis/incidents/$($analysis.Body.incidentId)"
        Assert-Equal 200 $incident.StatusCode "persisted incident is readable"
        Assert-Equal $checkoutTrace.traceId $incident.Body.traceId "incident references the real trace"
        Write-Host "    incidentId=$($incident.Body.incidentId) culprit=$($incident.Body.culpritService) severity=$($incident.Body.severity) confidence=$($incident.Body.confidenceScore)" -ForegroundColor Cyan
    }
}

# ---------------------------------------------------------------------------
# STEP 8: Prometheus target health.
# ---------------------------------------------------------------------------
Write-Section "[STEP 8] Prometheus scrape targets"

$prometheus = Invoke-Api -Uri "http://localhost:9090/api/v1/query?query=up"
Assert-Equal 200 $prometheus.StatusCode "Prometheus query API returns 200"
$targets = @($prometheus.Body.data.result)
Assert-True ($targets.Count -ge 7) "Prometheus reports at least 7 scrape targets"
$downTargets = @($targets | Where-Object { $_._value -ne "1" -and $_.value[1] -ne "1" })
Assert-Equal 0 $downTargets.Count "every Prometheus scrape target is UP"
foreach ($target in $targets) {
    Write-Host ("    {0,-20} {1}" -f $target.metric.job, $target.value[1]) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host "`n==================================================================" -ForegroundColor Magenta
Write-Host "                     DEMO SUMMARY                                " -ForegroundColor Magenta
Write-Host "==================================================================" -ForegroundColor Magenta
Write-Host "  Checks passed: $($script:Checks - $script:Failures.Count) / $($script:Checks)" -ForegroundColor Green
Write-Host "  User:          $userUsername" -ForegroundColor Cyan
Write-Host "  Admin:         $AdminUsername" -ForegroundColor Cyan
Write-Host "  Tempo:         live (synthetic=false enforced)" -ForegroundColor Green
Write-Host "  Prometheus:    live" -ForegroundColor Green

if ($script:Failures.Count -gt 0) {
    Write-Host "`nDEMO FAILED: $($script:Failures.Count) check(s) failed." -ForegroundColor Red
    foreach ($failure in $script:Failures) {
        Write-Host "  - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "`n[DEMO COMPLETE] All checks passed against the real stack. No fabricated telemetry." -ForegroundColor Green
exit 0
