# AUDIT_REPORT — CausalOTel

> **Audit-only baseline.** Sections 1–9 record the repository as found at commit
> `a10bf0ba238ccc038901f9c772c3958b956fa015` (branch `feature/complete-causalotel`) on 2026-11-11.
> That audit was read-only: no source, test, schema, or runtime configuration was modified.
>
> **Remediation update (2026-11-13).** All findings were subsequently remediated on
> `feature/complete-causalotel`. Section 10 records the final status of all 34 findings with
> verification evidence. The baseline sections are preserved unchanged so the audit trail remains
> honest; where they describe a defect, treat the defect as historical and consult Section 10 for
> the current state.

## 1. Executive summary

The repository is a working local demo of a five-service checkout flow with a partially connected
RCA dashboard. It is **not** the production-grade, real-telemetry, zero-simulation platform described
by its README and demo script.

The audit found **34 distinct issues: 4 Critical, 15 High, 11 Medium, and 4 Low**. The highest-risk
findings are:

1. **The checkout trust boundary is missing.** Item prices come from the HTTP request and are used
   verbatim for the order total and payment charge (C-02). Fault-injection and business endpoints
   have no authentication at all (H-01, H-02).
2. **The observability/RCA half is not real at this baseline.** Tempo failures are silently replaced
   with fabricated traces (C-03), Prometheus metrics are random or hardcoded (H-10), the telemetry
   plane has configuration files but no deployable stack and is not running (C-04), and several
   dashboard screens display mock or static data (H-14, M-07, M-08).
3. **Durability and recovery are unsafe.** The incident spool accepts a client-controlled path
   component and permits writes outside its directory (C-01). Incident persistence is broken (H-11).
   The saga/outbox path swallows persistence failures (H-06), races its own recovery worker (H-07),
   and retries without effective backoff (M-01).
4. **Inventory and idempotency are not concurrency-safe.** Reservation idempotency is a
   check-then-act race (H-04) with incomplete state handling (H-05), and checkout's idempotency hash
   does not cover item identity (H-03).
5. **Verification is not trustworthy.** Test suites run against the live `%LOCALAPPDATA%` databases
   and one test deletes real user rows (H-15). Build/start/demo scripts can report success while
   launching stale artifacts or omitting the tracer (M-09, M-10, M-11).

**Bottom line:** the happy-path checkout is real and has automated coverage, but the system cannot
be treated as secure, financially correct, crash-consistent, or observability-backed without the
remediation described in §8. Every finding below is source-confirmed unless explicitly marked as
runtime-verified or unverified.

## 2. Scope and method

### 2.1 Scope

Reviewed:

- All five business services: `user-service`, `product-service`, `order-service`,
  `payment-service` (Java/Spring Boot) and `inventory-service` (.NET).
- `analysis-engine` (Node/Express), including spool, incident store, Tempo client, Prometheus
  client, RCA engine, graph, and server routes.
- `dashboard` (React/Vite), including all routed pages and API calls.
- Schemas/migrations, `observability/` configuration, `cpp-core/`, `simulation/`, and all scripts.
- Existing unit/integration tests and the claims in `README.md` and `scripts/demo-checkout-rca.ps1`.

### 2.2 Method

1. Inspected Git state and the full working tree at the audit baseline.
2. Read the source and traced each request path end to end (dashboard → service → database/telemetry).
3. Ran non-destructive probes against the already-running local services. No service was stopped or
   restarted, and no live database was intentionally mutated.
4. Ran the automated suites in an **isolated** `LOCALAPPDATA` directory with a pre-created
   `CausalOTel\data` folder. The order suite was rerun from a clean build after a stale-artifact
   failure. Logs are under `C:\Users\prath\AppData\Local\Temp\causalotel-audit-tests\`.
5. Reproduced the spool path traversal and the malformed spool filename in temporary directories
   outside the repository.
6. Classified each issue by real risk, not by whether the build or an existing test passes.

### 2.3 Runtime baseline

| Component | Port | Observed state |
|---|---|---|
| Dashboard (Vite) | 3000 | Listening; build succeeds |
| user-service | 8081 | Listening; `/health/live` 200 |
| product-service | 8082 | Listening; `/health/live` 200 |
| order-service | 8083 | Listening; `/health/live` 200 |
| payment-service | 8084 | Listening; `/health/live` 200 |
| inventory-service | 5050 | Listening; `/health/live` 200 |
| analysis-engine | 5000 | Listening; `/health/live` 200; `/health/ready` **503** |
| OTel Collector | 4317/4318 | **Closed** |
| Tempo | 3200/4320 | **Closed** |
| Prometheus | 9090 | **Closed** |
| Collector metrics exporter | 8889 | **Closed** |
| MongoDB | 27017 | Not running (not separately probed) |

The analysis engine's readiness probe is tied to MongoDB, which the application never uses for
incident persistence; see H-11 and M-08.

## 3. Severity model

| Severity | Definition |
|---|---|
| **Critical** | Exploitable security defect, direct financial/data-integrity violation, or a claimed core capability that is fundamentally non-functional or fabricated. |
| **High** | Major correctness, security, availability, or data-loss risk that can occur in normal operation or with a small number of requests. |
| **Medium** | Incorrect or degraded behavior, operational fragility, or misleading surfaces that require specific conditions or cause slower/partial failure. |
| **Low** | Limited-impact defect, documentation/UI inconsistency, or an unverified path that does not currently affect the running demo. |

Verification labels used below:

- **RUNTIME-VERIFIED** — observed against the running system or reproduced in an isolated temp path.
- **CODE-CONFIRMED** — proven by source inspection; runtime reproduction would mutate live data or
  stop a service, so it was intentionally not performed.
- **PARTIALLY VERIFIED** — some behavior observed, but a complete reproduction was not safe/possible.

## 4. Finding summary

| ID | Severity | Component | Finding |
|---|---|---|---|
| C-01 | Critical | analysis-engine | Unauthenticated path traversal in incident spool write |
| C-02 | Critical | order-service | Client-supplied item prices drive order total and payment charge |
| C-03 | Critical | analysis-engine | Tempo failures silently fabricate synthetic traces |
| C-04 | Critical | observability | Telemetry plane has configs but no deployment and is not running |
| H-01 | High | payment/inventory | Unauthenticated runtime fault-injection endpoints |
| H-02 | High | all services | No authentication or authorization on business APIs |
| H-03 | High | order-service | Checkout idempotency hash ignores item identity and price |
| H-04 | High | inventory-service | Reservation idempotency check is a check-then-act race |
| H-05 | High | inventory-service | Reservation idempotency/state transitions permit duplicate or wrong reservations |
| H-06 | High | order-service | Saga/outbox persistence errors are swallowed |
| H-07 | High | order-service | Stale-saga recovery races active checkout and outbox work |
| H-08 | High | inventory-service | Expiry worker holds a DB write transaction across HTTP calls |
| H-09 | High | order-service | Downstream HTTP client has no connect/read timeouts |
| H-10 | High | analysis-engine | Metrics endpoint returns random and hardcoded data |
| H-11 | High | analysis-engine | Incident persistence is broken and MongoDB is unused |
| H-12 | High | dashboard | Dashboard RCA/incident contract does not match the backend |
| H-13 | High | dashboard | Dashboard fault payloads do not match either backend |
| H-14 | High | dashboard | Dashboard displays mock or static operational data |
| H-15 | High | tests/scripts | Test suites mutate live databases and are not isolated |
| M-01 | Medium | order-service | Outbox retry backoff is ineffective |
| M-02 | Medium | order/payment | In-flight lock maps are removed or used unsafely |
| M-03 | Medium | order-service | Refund/compensation outbox path is dead code |
| M-04 | Medium | user/order | User IDs are UUID strings but read/checkout paths expect integers |
| M-05 | Medium | analysis-engine | Dependency graph endpoint is a static hardcoded topology |
| M-06 | Medium | order-service | Checkout validation permits integer overflow and duplicate/unverified SKUs |
| M-07 | Medium | dashboard | Metrics page expects a different shape and silently keeps mock data |
| M-08 | Medium | dashboard/analysis | Health/status surfaces are static or tied to unused Mongo |
| M-09 | Medium | scripts | `start-all.ps1` launches stale artifacts and omits the tracer |
| M-10 | Medium | scripts | `build-all.ps1` reports success without tests and hides C++ failures |
| M-11 | Medium | docs/scripts | README/demo claim production-grade and zero-simulation behavior the code lacks |
| L-01 | Low | dashboard | Settings shows the wrong native binary path |
| L-02 | Low | payment-service | Payment simulation is enabled by default outside prod profiles |
| L-03 | Low | dashboard | TraceDetail RCA button targets a nonexistent route |
| L-04 | Low | cpp-core | C++ core is unbuilt and unverified |

## 5. Detailed findings

### Critical

#### C-01 — Unauthenticated path traversal in the incident spool write

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Verification** | RUNTIME-VERIFIED in an isolated temporary spool directory |
| **Location** | `analysis-engine/src/spool.js:90-122` (`IncidentSpool.spoolIncident`), especially `:105-107`; `analysis-engine/src/server.js:149-160` (`POST /api/analysis/spool`) |
| **Class/method** | `IncidentSpool.spoolIncident(incidentId, data)` |

**Impact.** `incidentId` is accepted directly from the request body and interpolated into a
filesystem path: `path.join(this.spoolDir, `${timestamp}_${incidentId}.json`)`. An unauthenticated
caller can include `/` or `\` segments and `..` to escape the spool directory. With enough `..`
segments the write can land anywhere the Node process can write, including the repository, user
profile, or startup configuration. The `.json` suffix constrains the final name, but existing JSON
files can be overwritten and new files created. The quota check only counts files inside the spool
directory, so out-of-directory writes bypass the quota. The same endpoint also lets an attacker
create a valid incident in memory without any authentication.

**Reproduction (isolated).**

1. Start the analysis engine with `SPOOL_DIR` pointing at a temporary directory, e.g.
   `C:\Temp\audit\spool`.
2. Send `POST /api/analysis/spool` with:
   `{"incidentId":"x/../../escaped","data":{"probe":true}}`.
3. Observe `C:\Temp\audit\escaped.json` (outside `spool`) and no corresponding file inside
   `spool`. The audit reproduced the escape with a temporary spool root; no repository file was
   touched.

**Fix.** Treat the incident ID as untrusted input. Generate a server-side UUID, or reject anything
that is not `^[A-Za-z0-9._-]{1,128}$` and is not `.`/`..`. After building the target path, resolve
it and require `resolved.startsWith(path.resolve(spoolDir) + path.sep)`. Use `path.basename` as a
defense in depth. Reject absolute paths, both separator styles, NUL bytes, and overlong names. Do not
echo a client path back in errors.

**Regression test.** A table-driven test posts `../`, `..\\`, `x/../../escaped`, absolute paths,
mixed separators, encoded traversal, NUL bytes, and long names; assert HTTP 400 and assert that no
file was created outside the spool root. A property test should generate random IDs and verify the
resolved path is always contained. A valid UUID must still spool and be readable.

---

#### C-02 — Client-supplied item prices drive the order total and payment charge

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:36-37` (DTOs), `:60-66` (total), `:133-149` (order/items insert), `:213` (payment charge); `OrderController.java:31` |
| **Class/method** | `SagaOrchestrator.checkout(CheckoutRequest)` |

**Impact.** `OrderItemDto` contains `priceCents`, and checkout computes
`totalCents += item.quantity() * item.priceCents()` using the request value. That total is stored in
`orders.total_cents` and sent to payment as `amountCents`. The order service never calls the product
service or looks up a catalog price, so an unauthenticated caller can buy any SKU for one cent (or
zero), corrupt revenue/accounting, and make the payment service charge an amount unrelated to the
catalog. This is a direct financial-integrity violation, not a display bug.

**Reproduction.** With an isolated order/payment database, POST `/api/orders/checkout`:

```json
{"userId":1,"items":[{"productId":"PROD-001","sku":"SKU-LAPTOP-001","quantity":1,"priceCents":1}],"idempotencyKey":"audit-price-1"}
```

The response and `orders.total_cents` show `1`, and the payment record is for one cent. This was not
executed against the live database because it would create a real order and charge; the path is
proven by the source lines above.

**Fix.** Resolve the authoritative unit price from the product service by SKU inside checkout,
ignore any client-supplied price (or accept `expectedPriceCents` only to detect a mismatch and
return 409). Compute with `long`/`BigDecimal`, enforce a positive bounded total, and persist the
server-resolved unit price snapshot. The payment amount must be derived from the persisted total,
never from the request.

**Regression test.** Tampered price (`0`, `1`, negative, max-int) must be rejected or replaced with
the catalog price before any order/payment write. A catalog price change between quote and checkout
must be handled deterministically (reject or re-quote). Assert the payment amount equals the
server-computed total. Add a contract test that `productId`/`sku` exists and is purchasable.

---

#### C-03 — Tempo failures silently fabricate synthetic traces

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Verification** | CODE-CONFIRMED |
| **Location** | `analysis-engine/src/tempo_client.js:14-31` (`fetchTrace`), `:136-200` (`synthesizeTraceForDemo`); `analysis-engine/src/server.js:104-120` (`POST /api/analysis/analyze-trace`); `analysis-engine/test/rca.test.js:54` |
| **Class/method** | `TempoClient.fetchTrace(traceId)` |

**Impact.** Any Tempo error — connection refused, timeout, HTTP 404/500, malformed JSON — is caught
and replaced with a hardcoded four-span trace containing `span-root-order`, `span-inv-res`,
`span-pay-charge`, and `span-inv-comp-rel`, including a 3,250 ms payment span. The response is not
marked as synthetic, and the server saves it as an incident and returns RCA evidence as if it came
from real telemetry. This makes the central "real trace RCA" claim false, can generate incidents for
trace IDs that never existed, and caused the existing test suite to validate the fallback rather
than real Tempo behavior.

**Reproduction.** With Tempo on `:3200` stopped, POST `/api/analysis/analyze-trace` with
`{"traceId":"trace-does-not-exist"}`. The response contains the hardcoded span IDs above and a
`primaryRootCause` derived from them, with no `synthetic`/`source` marker. (Tempo was closed at the
audit baseline; the fallback is unconditional in the code.)

**Fix.** Remove the synthetic fallback from the normal request path. Return 404 for an unknown trace
and 502/503 when Tempo is unavailable, with a machine-readable error. If a demo fallback is
required, gate it behind an explicit non-production flag, mark the response `synthetic: true` and
`source: "demo"`, and never persist it as a real incident or feed it into RCA scoring. Update the
test to assert the error contract, and add a separate opt-in test for the demo fixture.

**Regression test.** Tempo connection failure → 502/503 and no incident; Tempo 404 → 404 and no
incident; malformed Tempo JSON → 502; explicit demo flag → response marked synthetic and excluded
from `/api/analysis/incidents`. A real Tempo fixture must round-trip with the same span count and
self-times.

---

#### C-04 — Telemetry plane has configuration but no deployment and is not running

| Field | Value |
|---|---|
| **Severity** | Critical |
| **Verification** | RUNTIME-VERIFIED (ports closed; no deployment manifest) |
| **Location** | `observability/otel-collector-config.yaml`, `observability/tempo.yaml`, `observability/prometheus.yml`; `services/*/src/main/resources/application.yml` (OTLP endpoint), `services/inventory-service/Program.cs:26-28`; `scripts/start-all.ps1` |
| **Components** | OTel Collector, Tempo, Prometheus, MongoDB |

**Impact.** The repository contains collector/Tempo/Prometheus configuration but no
`docker-compose.yml`, Kubernetes manifest, or script that starts them. At the audit baseline ports
`4317`, `4318`, `4320`, `8889`, `9090`, and `3200` were all closed. The Java and .NET services point
their OTLP exporters at `http://localhost:4318`, so spans are dropped; the analysis engine then
falls back to synthetic traces (C-03) and random metrics (H-10). The "observability pipeline" and
"Tempo/Prometheus" claims cannot be reproduced from a clean checkout. `tempo.yaml` also hardcodes a
Windows user path (`C:/Users/prath/AppData/Local/CausalOTel/tempo-data`), so it is not portable.

**Reproduction.** Run:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4317,4318,4320,8889,9090,3200 -ErrorAction SilentlyContinue
```

No listeners are returned. `Get-ChildItem -Recurse -Include docker-compose*.yml` finds nothing.
`scripts/start-all.ps1` launches only the seven application processes.

**Fix.** Add a reproducible deployment (compose or equivalent) for the collector, Tempo, and
Prometheus, with health checks and persistent volumes. Parameterize all host paths and endpoints via
environment variables. Make `start-all.ps1` either start the stack or fail with a clear prerequisite
message. Add readiness checks that verify a real OTLP span reaches Tempo and that Prometheus can
scrape the collector and services. Document the exact command in the README.

**Regression test.** A CI smoke test starts the stack, sends one OTLP span from a test client,
queries Tempo for it, scrapes the collector's Prometheus endpoint, and asserts the analysis engine
returns a non-synthetic trace. A port/listener check must fail the test if any required backend is
absent.

### High

#### H-01 — Unauthenticated runtime fault-injection endpoints

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | RUNTIME-VERIFIED (state readable without credentials); write path CODE-CONFIRMED |
| **Location** | `services/payment-service/src/main/java/com/causalotel/payment/controller/PaymentController.java:398-429` (`POST/GET /api/payments/fault`); `services/inventory-service/Controllers/InventoryController.cs:392-406` (`POST/GET /api/inventory/fault`) |
| **Class/method** | `PaymentController.setFault/getFault`; `InventoryController.SetFault/GetFault` |

**Impact.** Anyone who can reach the services can set payment latency, decline/timeout/down modes,
or make inventory busy/error for every subsequent request. A single unauthenticated request with
`latencyMs: 60000` stalls all checkouts; `simulateError: true` makes reservations fail. The state is
global and persists until reset or restart, so an attacker can degrade the demo, mask a real failure,
or generate misleading RCA incidents. The GET endpoints also disclose the current fault
configuration.

**Reproduction.**

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8084/api/payments/fault -ContentType application/json -Body '{"latencyMs":60000,"faultMode":"LATENCY"}'
Invoke-RestMethod -Method Post -Uri http://localhost:5050/api/inventory/fault -ContentType application/json -Body '{"simulateError":true,"errorMessage":"injected"}'
```

Both return `200` with no credentials. A subsequent checkout hangs or fails. The audit read the live
fault state (`NORMAL`, latency `0`; inventory all `false`) but did not inject a fault.

**Fix.** Require an admin role or a local-only diagnostic token; bind these routes to loopback in
development; disable them entirely outside a demo/test profile. Cap latency, validate enums, add
rate limits, and reset fault state on startup. Audit-log changes with caller identity. Do not expose
the GET endpoints publicly.

**Regression test.** Unauthenticated POST/GET → 401/403; non-admin → 403; admin → 200; latency
above the cap → 400; fault state resets after restart; a normal checkout is unaffected when the
endpoint is disabled.

---

#### H-02 — No authentication or authorization on business APIs

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED + RUNTIME-VERIFIED (`GET /api/users` returned `200 []` without credentials) |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/controller/OrderController.java:20-128`; `services/payment-service/src/main/java/com/causalotel/payment/controller/PaymentController.java:127,260`; `services/user-service/src/main/java/com/causalotel/user/controller/UserController.java:28,48`; `services/product-service/src/main/java/com/causalotel/product/controller/ProductController.java:28,50`; `services/inventory-service/Controllers/InventoryController.cs:22-406`; no Spring Security dependency/config in `services/*/pom.xml`; no `AddAuthentication`/`UseAuthorization` in `services/inventory-service/Program.cs` |
| **Components** | All five business services |

**Impact.** Every business operation is anonymous: list/read all orders and users, create checkout
orders, charge/refund arbitrary payments, reserve/commit/release inventory, and read the outbox
(`GET /api/orders/outbox`). There is no tenant or user scoping, so any caller can read another
customer's data or trigger financial operations. This is a complete missing trust boundary, not a
missing hardening header.

**Reproduction.** `GET http://localhost:8083/api/orders`, `GET http://localhost:8083/api/orders/outbox`,
`GET http://localhost:8081/api/users`, and `GET http://localhost:8084/api/payments` all return data
without a token. `POST /api/payments/refund` accepts an arbitrary `paymentId`. The live user list was
empty, but the endpoint returned `200 []` unauthenticated.

**Fix.** Add authentication (OIDC/JWT or session) and authorization at the gateway/service boundary.
Scope order/payment reads to the authenticated user; require an admin/service role for refunds,
outbox, inventory mutations, and fault control. Use service-to-service credentials (mTLS or signed
tokens) for order → inventory/payment calls. Remove or protect the outbox endpoint. Add CSRF
protection if cookie-based auth is used.

**Regression test.** Anonymous requests → 401; user A cannot read user B's order/payment; refund
without role → 403; outbox without admin → 403; order → inventory/payment calls fail without service
credentials; authorized happy path still succeeds.

---

#### H-03 — Checkout idempotency hash ignores item identity and price

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:68-72` (key/hash), `:81-93` (cache lookup), `:98-101` (deterministic IDs), `:306-317` (cache write) |
| **Class/method** | `SagaOrchestrator.checkout(CheckoutRequest)` |

**Impact.** `requestHash = sha256(userId + ":" + totalCents + ":" + itemCount)` does not include SKU,
quantity per item, unit price, or product ID. Two requests with the same key, user, total, and item
count but different products are treated as the same request; the second returns the first cached
response and never creates its own order. Because the key is client-supplied, a caller who knows or
guesses a key can retrieve a cached order/payment response when the hash matches. The deterministic
`orderId`/`sagaId` derived from the key also means a key collision maps different carts to one order.

**Reproduction.** In an isolated database, checkout cart A with key `K` (one item at 100 cents), then
checkout cart B with key `K` (one different SKU also at 100 cents). The second response is byte-for-byte
the first order response; no second order or payment is created. A concurrent duplicate is protected
only by an in-process lock (M-02), not by the database.

**Fix.** Hash a canonical representation of the full request: authenticated user, sorted
`(sku, quantity, server-resolved unit price)` tuples, currency, and endpoint version. Bind the key to
the authenticated user and reject reuse with a different hash (409). Use a database unique constraint
on the idempotency key and insert/claim it transactionally before side effects. Prefer server-issued
keys or validate key format/length. Do not derive the order ID solely from a client key.

**Regression test.** Same key + different SKU/quantity/price → 409, no second order; same key + same
canonical payload → identical response and one order; 50 concurrent requests with one key → exactly
one order/payment; a key belonging to another user → 404/403.

---

#### H-04 — Inventory reservation idempotency check is a check-then-act race

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/inventory-service/Controllers/InventoryController.cs:108-127` (existence check), `:129-184` (transaction and decrement); `services/inventory-service/Data/InventoryDbContext.cs:31-44` (only a non-unique `OrderId` index) |
| **Class/method** | `InventoryController.Reserve(ReserveRequest)` |

**Impact.** The idempotency check reads existing reservations outside the write transaction and
before any lock. Two concurrent `POST /api/inventory/reserve` calls with the same `OrderId` both see
no rows, both pass the check, and both execute the conditional stock decrement. The result is double
stock consumption and duplicate reservation rows for one order. There is no unique constraint on
`(OrderId, Sku)` to stop the second insert. `Commit`/`Release` then operate on both sets, so the
damage propagates to order state and stock counts.

**Reproduction.** In an isolated inventory database, send 20 concurrent reserve requests for the same
`orderId` and SKU with quantity 1. More than one returns `RESERVED`, available stock drops by more
than 1, and `stock_reservations` contains multiple rows for the order. The audit did not run this
against the live inventory DB.

**Fix.** Enforce a unique constraint on `(OrderId, Sku)` (and an idempotency key if requests can
repeat with different payloads). Claim the order atomically before decrementing stock: insert the
reservation rows in a transaction and let the unique constraint choose the winner, or use an
`INSERT ... ON CONFLICT`/upsert with a request hash. Return the existing reservation for a replay.
Do not rely on a pre-transaction `SELECT`.

**Regression test.** Parallel reserve calls for one order → exactly one reservation set and one
stock decrement; all callers receive the same idempotent result; duplicate SKU within one request is
rejected or coalesced; a conflicting replay with different quantities → 409.

---

#### H-05 — Reservation idempotency and state transitions permit duplicate or wrong reservations

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/inventory-service/Controllers/InventoryController.cs:108-127` (only `RESERVED`/`COMMITTED` are treated as existing), `:234-250` (commit state checks), `:305-315` (commit loops only `RESERVED`), `:357-377` (release loops only `RESERVED`) |
| **Class/method** | `InventoryController.Reserve/Commit/Release` |

**Impact.** If an order already has `EXPIRED` or `RELEASED` reservations, `Reserve` ignores them and
creates a fresh reservation for the same order, decrementing stock again. Duplicate SKUs in one
request create multiple rows because there is no per-request deduplication. `Commit` returns 409 if
*any* row is `RELEASED`, even when other rows are `RESERVED`; `Release` silently skips `COMMITTED`
rows and returns success, leaving stock in a mixed state. Replays after a terminal state therefore
do not converge on one answer.

**Reproduction.** Reserve order `O` for SKU `S`, release it, then reserve `O` again. Stock is
decremented twice and two reservation sets exist. Alternatively send two entries for the same SKU in
one reserve request and observe two rows. No live data was mutated for this finding.

**Fix.** Define and enforce a reservation state machine (`RESERVED → COMMITTED | RELEASED | EXPIRED`)
with conditional `UPDATE ... WHERE status = 'RESERVED'` transitions. Treat the order as the
idempotency unit: if any terminal row exists, return its state (or 409) without creating a new
reservation unless an explicit new order/idempotency key is supplied. Reject duplicate SKUs in one
request or coalesce quantities. Make commit/release all-or-nothing across the order group and return
a consistent status.

**Regression test.** State-transition matrix tests for every replay (reserve after release/expire/
commit, commit after release, release after commit); duplicate SKU input; mixed-status order groups;
assert stock changes exactly once and the response is stable.

---

#### H-06 — Saga and outbox persistence errors are swallowed

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:327-338` (`updateSagaState`), `:427-437` (`updateOrderStatus`), `:440-460` (`enqueueOutboxTask`) |
| **Class/method** | `SagaOrchestrator.updateSagaState/updateOrderStatus/enqueueOutboxTask` |

**Impact.** All three methods catch `SQLException`/`Exception`, log it, and return normally. Checkout
can therefore return `CONFIRMED` even when the saga state, order status, or compensating outbox task
was never persisted. A failed outbox insert during compensation loses the only recovery record;
a failed state update makes a stuck saga invisible to the recovery worker. The caller has no signal
that durability was lost.

**Reproduction.** In an isolated order DB, make the outbox table unavailable (drop/rename it or add a
trigger that raises) and run a checkout that needs compensation. The request completes, the error is
only in the log, and no outbox row exists. Similarly, close/deny the DB during `updateSagaState` and
observe the checkout continue. Not run against live data.

**Fix.** Persist order state, saga state, and the outbox task in one database transaction, and let
failures propagate so the request fails/rolls back. If a write truly must be best-effort, enqueue to
a durable local queue and expose a health/metrics signal; never silently continue after a critical
state write. Add retry with idempotent upserts and a reconciliation job that detects orders without
saga/outbox rows.

**Regression test.** Fault-inject a DB error at each of the three writes; assert the checkout does
not return success, the order is not `CONFIRMED`, and no partial state exists. Assert every confirmed
order has a `COMPLETED` saga and any required outbox row in the same transaction.

---

#### H-07 — Stale-saga recovery races active checkout and outbox work

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/OutboxWorker.java:225-275` (`recoverStaleSagas`), `:38-90` (`processOutboxTasks`); `SagaOrchestrator.java:268-294` (commit path) |
| **Class/method** | `OutboxWorker.recoverStaleSagas()` / `processOutboxTasks()` |

**Impact.** `recoverStaleSagas` runs every 5 seconds and selects sagas in active states whose
`updated_at` is older than 5 seconds. It does not claim the saga, take a lease, or check a fencing
token. A checkout that is still inside a slow inventory commit (or a concurrent outbox worker) can
be "recovered" at the same time: the recovery path may mark the order `CONFIRMED` and the original
path may later fail/compensate, or both may release/commit inventory. Multiple application instances
make the race worse. The 5-second threshold is shorter than normal downstream timeouts.

**Reproduction.** Inject 10 seconds of inventory latency, start a checkout, and let payment succeed.
After 5 seconds the recovery worker sees `PAYMENT_CONFIRMED`/`INVENTORY_COMMITTING` and confirms the
order while the checkout thread is still waiting. If the commit then fails, the order is already
`CONFIRMED` and compensation may run against it. Code-confirmed; not run against live data.

**Fix.** Claim recoverable sagas with an atomic lease/fencing token and a version column; only one
worker may transition a saga. Use a threshold longer than the maximum downstream timeout, and have
the active checkout renew a heartbeat/lease. Make every downstream operation idempotent and
state-checked before acting. Run recovery and outbox processing under the same ownership rules.

**Regression test.** Slow commit beyond the threshold → exactly one terminal transition; concurrent
checkout and recovery → one winner and no duplicate release/refund; two worker instances → one claim;
a recovered order is never later overwritten by the original thread.

---

#### H-08 — Expiry worker holds a database write transaction across HTTP calls

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/inventory-service/Services/ReservationExpiryWorker.cs:107-162` (transaction opens at `:107`; HTTP call at `:113`), `:65-90` (`CheckPaymentStatusAsync`, 2-second timeout) |
| **Class/method** | `ReservationExpiryWorker.ExpireStaleReservationsAsync()` |

**Impact.** The worker opens a SQLite write transaction, then calls the payment service once per
expired order while the transaction is open. Each call can take up to 2 seconds; a batch of N orders
holds the write lock for up to 2N seconds. Concurrent reserve/commit/release requests hit
`SQLITE_BUSY` (the service config uses a 5-second `busy_timeout`), so a slow/unavailable payment
service turns into checkout failures. A single order failure also rolls back the whole batch.

**Reproduction.** Create many expired reservations, set payment latency to 2 seconds, and issue a
concurrent reserve. The reserve blocks or fails with a busy/locked error while the expiry worker is
in its HTTP loop. Code-confirmed; no live data was mutated.

**Fix.** Fetch payment statuses before opening the write transaction (or in a read-only phase), then
apply per-order state changes in short transactions. Move the HTTP call to an outbox/queue, or at
minimum use a per-order transaction and a short overall deadline. Never hold a SQLite write
transaction across network I/O. Record per-order failures and continue.

**Regression test.** With a slow payment stub, a concurrent reserve must not block longer than the
configured timeout; one failing order must not roll back others; instrument the code to assert no
transaction is open during the HTTP call.

#### H-09 — Downstream HTTP client has no connect or read timeouts

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/client/DownstreamServiceClient.java:24-30` (`RestClient.builder().build()`), calls at `:52-140` |
| **Class/method** | `DownstreamServiceClient` constructor and all downstream calls |

**Impact.** The `RestClient` is built without a request factory or timeouts. If payment or inventory
accepts a connection but never responds (the fault endpoint can create exactly this state), the
order request thread blocks indefinitely. Under load this exhausts the servlet thread pool and turns
one slow dependency into a full order-service outage. The saga's "unknown payment outcome" logic
never runs because the call never returns.

**Reproduction.** Set payment latency to 60,000 ms via `POST /api/payments/fault`, then start a
checkout. The checkout remains open well past any reasonable SLA (the audit did not inject the
fault on the live system). A stub that accepts and never responds produces the same result.

**Fix.** Configure connect and read timeouts on the request factory (for example 1–2 seconds
connect, 3–5 seconds read), plus an overall per-checkout deadline. Add a circuit breaker and bounded
retry policy with idempotency keys. Ensure timeouts are classified as "unknown outcome" so the
existing reconciliation path runs. Apply the same policy to all internal clients.

**Regression test.** A stub that delays beyond the read timeout must make checkout return a
bounded 504/reconciliation response, not hang; assert elapsed time and thread-pool health. A
connection-refused case must fail fast. Verify retries do not duplicate charges.

---

#### H-10 — Metrics endpoint returns random and hardcoded data

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | RUNTIME-VERIFIED (responses varied between calls and did not reflect service state) |
| **Location** | `analysis-engine/src/prometheus_client.js:23-38` (`getServiceMetrics`); `analysis-engine/src/server.js:139-146` (`GET /api/analysis/metrics`) |
| **Class/method** | `PrometheusClient.getServiceMetrics()` |

**Impact.** `requestRate` is `Math.random() * 15 + 5`; payment is always reported as
`errorRate: 0.35`, `p95LatencyMs: 3020`, `p99LatencyMs: 3450`, and `DEGRADED`, while every other
service is always healthy. The values are unrelated to Prometheus, which is not running (C-04).
The dashboard and RCA engine consume these numbers as evidence, so operators see fabricated
degradation and the RCA ranking can be driven by constants.

**Reproduction.** Call `GET http://localhost:5000/api/analysis/metrics` twice. `requestRate`
changes randomly while all other fields remain fixed; stop or start payment and the payment entry
does not change. The audit observed this object at runtime.

**Fix.** Replace the constants with PromQL queries against the configured Prometheus URL. Return a
structured error or an explicit `unavailable` state when Prometheus is down; never synthesize
values. Define a stable response schema, include the query timestamp/window, and cache briefly.
Remove `Math.random()` entirely.

**Regression test.** With a mocked Prometheus response, each service's fields map correctly; with
Prometheus unavailable, the endpoint returns 503/`unavailable` rather than fabricated numbers; two
consecutive calls with the same fixture are identical; a real scrape smoke test passes in CI.

---

#### H-11 — Incident persistence is broken and MongoDB is unused

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | RUNTIME-VERIFIED (malformed `[object Object].json` spool output reproduced in a temp directory) |
| **Location** | `analysis-engine/src/incident_store.js:15-29` (`saveIncident` does not await and passes the wrong arguments), `:41-53` (`drainSpool` calls nonexistent `getPendingIncidents` and does not await); `analysis-engine/src/server.js:200-217` (Mongo connects but no model/read/write) |
| **Class/method** | `IncidentStore.saveIncident/drainSpool` |

**Impact.** `saveIncident` calls `this.spool.spoolIncident(incident)` without `await`, so the first
argument is the incident object rather than an ID. The resulting filename contains
`[object Object]`, and the payload has no usable `data` field. The call's promise rejection is not
handled. `drainSpool` calls `this.spool.getPendingIncidents()`, a method that does not exist, and
also calls the async `readIncident` without `await`; it would throw immediately if invoked. It is
never invoked at startup. MongoDB is connected but no Mongoose model or query exists, so incidents
live only in the process `Map` and are lost on restart. `/health/ready` reports 503 because Mongo is
down even though Mongo is not the store.

**Reproduction.** Save an incident (for example via `POST /api/analysis/analyze-trace`), then list
the spool directory: it contains a file named `<timestamp>_[object Object].json`. Restart the
analysis engine and `GET /api/analysis/incidents` returns `[]`. Calling `drainSpool()` throws a
`TypeError` for the missing method. The malformed filename was reproduced in a temporary spool.

**Fix.** Make `saveIncident` async, `await this.spool.spoolIncident(incident.incidentId, incident)`,
and handle errors. Implement `drainSpool` with `await this.spool.listPending()`, `await
this.spool.readIncident(file)`, and `acknowledgeIncident` after a successful load; call it on
startup. Either implement real Mongo persistence (model, indexes, read-through, fallback) or remove
Mongo and make the disk spool the source of truth. Make readiness reflect the actual store. Add
retention/cleanup and a recovery test.

**Regression test.** Save → restart → list returns the incident; spool filename equals the incident
ID; drain loads all pending files exactly once; Mongo down still reports ready when the disk store is
healthy; no `[object Object]` filenames; corrupt spool files are quarantined and logged.

---

#### H-12 — Dashboard RCA/incident contract does not match the backend

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `dashboard/src/pages/Incidents.jsx:54,66-68,77-81,184-188`; `dashboard/src/pages/RcaDetail.jsx:32-45,162,184,228,291`; backend shape at `analysis-engine/src/rca_engine.js:106-126` |
| **Components** | `Incidents.jsx`, `RcaDetail.jsx` |

**Impact.** The backend incident is
`{incidentId, primaryRootCause: {service, operation, confidence, evidenceChain, recommendation}, causalPath, ...}`.
The dashboard expects `culpritService`, `rootCauseType`, `confidenceScore` (number), `evidence[]`,
and `remediations[]`. Consequences:

- `Incidents.jsx` renders blank culprit/confidence fields and shows `NaN%`.
- Typing in the incident search calls `inc.culpritService.toLowerCase()` on `undefined` and throws.
- `RcaDetail.jsx` renders a real incident but crashes at `data.evidence.map` and
  `data.remediations.map` because those arrays do not exist.
- When the backend has no incidents, the page silently shows three fabricated fallback incidents.

**Reproduction.** Generate a real incident via `POST /api/analysis/analyze-trace`, open
`/incidents`, and type in the search box: the page throws. Open `/rca/<incidentId>`: the detail page
throws while rendering evidence. The audit confirmed the shape mismatch in source; no browser
automation was run.

**Fix.** Define one shared JSON schema and use it on both sides. Either return
`{culpritService, rootCauseType, confidenceScore, evidence, remediations}` from the backend or map
`primaryRootCause.service/confidence/evidenceChain/recommendation` in the UI. Guard every array with
`?? []`, render an explicit empty/error state, and remove the fabricated fallback incidents (or gate
them behind a clearly labeled demo mode). Add a contract fixture generated from the backend.

**Regression test.** Render `Incidents` and `RcaDetail` against a real backend fixture; no
exceptions; search works; confidence displays correctly; empty list shows an empty state; a 404
shows an error state; the contract test fails if either side renames a field.

---

#### H-13 — Dashboard fault payloads do not match either backend

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED |
| **Location** | `dashboard/src/pages/FaultInjection.jsx:18-80` (scenarios), `:90-97` (payload), `:112-116` (reset); payment contract at `PaymentController.java:35,398-412`; inventory contract at `InventoryController.cs:18,392-399` |
| **Components** | `FaultInjection.jsx`, payment/inventory fault endpoints |

**Impact.** The UI sends `{mode: <scenario.mode>, latencyMs?}`. Payment expects
`{latencyMs, faultMode, errorMessage}`; inventory expects `{LatencyMs, SimulateBusy, SimulateError,
ErrorMessage}`. As a result, payment `GATEWAY_TIMEOUT`, `DECLINED`, and `GATEWAY_DOWN` do nothing
(the `faultMode` field is absent, so the backend resets it to `NORMAL`); inventory
`FORCE_OUT_OF_STOCK`/`BUSY_DELAY` do nothing. Only payment latency happens to work. The UI still
reports success and, on any error, claims the fault is "active in local simulation", so demos and
RCA tests can proceed with no fault at all.

**Reproduction.** Click "Gateway Timeout" in the dashboard. The response is
`{status:"UPDATED", faultMode:"NORMAL"}`. Run a checkout: it succeeds. Click an inventory scenario
and `GET /api/inventory/fault`: all flags remain `false`, latency `0`.

**Fix.** Map each scenario to the target's actual contract: payment uses `faultMode` values
`LATENCY`, `GATEWAY_TIMEOUT`, `DECLINED`, `GATEWAY_DOWN`, and `latencyMs`; inventory uses
`simulateBusy`, `simulateError`, `latencyMs`, `errorMessage`. Validate the response and only mark a
fault active when the backend confirms the new state. Reset with the correct payloads. Remove the
offline-success fallback or label it explicitly.

**Regression test.** For every scenario, POST then GET the target fault state and assert the
expected mode/flags; run a checkout and assert the expected success/failure; reset clears all state;
an API failure leaves the UI in an error state, not "active".

---

#### H-14 — Dashboard displays mock or static operational data

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | CODE-CONFIRMED (mock data paths are unconditional) |
| **Location** | `dashboard/src/pages/Traces.jsx:5-46,52` (static `mockTraces`, no API call); `dashboard/src/pages/Metrics.jsx:15-82,85,96-101` (mock fallback); `dashboard/src/pages/Overview.jsx:19-26,66,79` (static 6/6 and 1 incident); `dashboard/src/pages/Services.jsx:4-58,78-80` (static `ONLINE`) |
| **Components** | Overview, Services, Traces, Metrics |

**Impact.** The dashboard presents fabricated operational state as live:

- Traces always shows four hardcoded traces and never calls Tempo or the analysis engine.
- Metrics starts with mock data and keeps it when the backend returns an object (it only accepts an
  array), so real metrics never render.
- Overview always shows "6 / 6" services and one active payment incident.
- Services always shows every service as `ONLINE`.

An operator cannot use these screens to detect an outage, and the demo can appear healthy while
every service is down.

**Reproduction.** Stop all backend services and reload the dashboard: it still shows 6/6 online,
one incident, and four traces. Open Metrics: values match the hardcoded mock array. These paths are
unconditional in source; the dashboard build was verified, but no browser automation was run.

**Fix.** Fetch from the real endpoints (`/api/analysis/graph`, `/api/analysis/incidents`,
`/api/analysis/metrics`, a trace-list endpoint, and per-service health). Render loading, error, and
empty states; never silently substitute mock data. If a demo mode is required, make it explicit
(banner/flag) and exclude it from operational views. Add a trace-list API or query Tempo directly.

**Regression test.** With all backends down, the UI shows unknown/error, not healthy; with fixtures,
each page renders the fixture values; empty incidents/traces show empty states; no page imports
mock arrays outside a flagged demo module.

---

#### H-15 — Test suites mutate live databases and are not isolated

| Field | Value |
|---|---|
| **Severity** | High |
| **Verification** | RUNTIME-VERIFIED (isolated runs performed; destructive test source confirmed) |
| **Location** | `services/user-service/src/test/java/com/causalotel/user/UserBootstrapTest.java:46-48` (`DELETE FROM users; DELETE FROM bootstrap_tokens;`); `scripts/test-all.ps1:68-95` (runs `mvnw test`/`dotnet test`/`npm test` without a `LOCALAPPDATA` override) |
| **Components** | Test suites, `test-all.ps1` |

**Impact.** The user test connects to the default `%LOCALAPPDATA%\CausalOTel\data` database and
deletes all users and bootstrap tokens before each test. Running `test-all.ps1` against a machine
with the demo running wipes real local users. The other suites also use the default databases, so
results depend on live residue (the live order DB contained historical rows such as
`ord-crash-999`). A rerun of the order suite failed with a duplicate `orders.order_id` because of
stale `target/test-classes`, not a clean-source defect. Tests are therefore neither repeatable nor
safe.

**Reproduction.** Run `.\scripts\test-all.ps1` on a machine with a populated local user DB; after
the user suite, `users` and `bootstrap_tokens` are empty. The audit ran suites with a temporary
`LOCALAPPDATA` and pre-created `CausalOTel\data` to avoid this.

**Fix.** Give every suite its own temporary database path via a test property/environment variable,
created and deleted by the test harness (or use Testcontainers). Never read `%LOCALAPPDATA%` in
tests. Make `test-all.ps1` create an isolated root and pass it to every suite; clean build outputs
before running; add a guard that aborts if a test resolves to the live path. Remove destructive SQL
against shared state.

**Regression test.** Run the full suite twice in parallel with a populated live DB and assert the
live DB is byte-for-byte unchanged; run from a clean checkout with no pre-existing DB; a test that
resolves the default path fails fast; order tests pass from a clean `target`.

### Medium

#### M-01 — Outbox retry backoff is ineffective

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/OutboxWorker.java:37` (`@Scheduled(fixedDelay = 5000)`), `:50-53` (selection), `:202-218` (retry/lease update) |
| **Class/method** | `OutboxWorker.processOutboxTasks()` |

**Impact.** The claim query selects any `PENDING` row regardless of `lease_expires_at`. On failure
the worker sets `state='PENDING'`, computes an exponential `retryDelay`, and stores it in
`lease_expires_at`, but the next 5-second tick ignores that value and retries immediately. Retries
are therefore fixed at ~5 seconds, not 2/4/8/16/32 seconds, and all five attempts are exhausted in
about 25 seconds. A transient downstream outage that should be retried for a minute instead fails
the task and can strand an order.

**Reproduction.** Make a `RELEASE_INVENTORY` task fail (stop inventory), then watch the outbox log:
attempts occur every 5 seconds despite the stored lease. After five attempts the task becomes
`FAILED` in ~25 seconds. Code-confirmed.

**Fix.** Select `PENDING` only when `lease_expires_at <= now`, or add a dedicated `next_attempt_at`
column. Compute backoff with jitter, cap it, and update both state and next-attempt time atomically.
Keep the lease for `IN_PROGRESS` recovery separate from retry scheduling. Add dead-letter handling
and metrics.

**Regression test.** With a failing stub, assert attempt timestamps follow the backoff schedule and
the task remains retryable for the intended window; a successful retry clears the schedule; no hot
loop under a permanently failing task.

---

#### M-02 — In-flight lock maps are removed or used unsafely

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:76-77,321-323` (`inFlightKeys.remove` in `finally`); `services/payment-service/src/main/java/com/causalotel/payment/controller/PaymentController.java:150-151,254-256,275-276,390-394` (`paymentLocks.remove`) |
| **Class/method** | `SagaOrchestrator.checkout`; `PaymentController.charge/refund` |

**Impact.** A thread removes the lock object while another thread is waiting on it. A third request
then calls `computeIfAbsent`, gets a new lock object, and runs concurrently with the waiter that
still holds the old object. The in-process mutual exclusion is broken exactly under the concurrent
retry it is meant to protect, allowing duplicate orders/charges. The maps are also keyed by
different values in different paths (idempotency key vs. derived payment ID), so the protection is
not uniform.

**Reproduction.** Send many concurrent requests with the same idempotency key/payment ID while
instrumenting the lock objects; observe two different monitors active for the same key after a
removal. Code-confirmed; no live charge was made.

**Fix.** Do not rely on removing lock objects for correctness. Use a fixed striped lock or a
reference-counted lock registry, or (preferably) enforce idempotency with a database unique
constraint and transactional insert. If locks remain, remove them only when no waiters exist and
key them consistently. Add a bounded cache to avoid unbounded growth.

**Regression test.** 100 concurrent same-key requests → exactly one order/charge; lock registry size
is bounded; a waiting thread never proceeds concurrently with a new request for the same key.

---

#### M-03 — Refund/compensation outbox path is dead code

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/OutboxWorker.java:105-110` (`REFUND_PAYMENT` handler); only enqueue call sites at `SagaOrchestrator.java:228,258,282` (`RELEASE_INVENTORY`, `RECONCILE_PAYMENT`, `COMMIT_INVENTORY`) |
| **Class/method** | `OutboxWorker.processOutboxTasks()` / `SagaOrchestrator.enqueueOutboxTask` |

**Impact.** The worker can refund a payment, but no code ever enqueues a `REFUND_PAYMENT` task. If
payment is captured and inventory commit permanently fails (after retries or outbox exhaustion),
the order cannot complete and the customer is not refunded automatically. The comment at
`SagaOrchestrator.java:280` explicitly chooses "instead of blind refund", but no later compensation
replaces it. The same gap exists for `COMPENSATING_PAYMENT`, which appears in the recovery query
but has no transition path.

**Reproduction.** Force inventory commit to fail permanently after a successful payment; the saga
enters `INVENTORY_COMMITTING`, the outbox retries `COMMIT_INVENTORY` five times, then marks it
`FAILED`. No refund row or task is created. Code-confirmed.

**Fix.** Implement a terminal compensation decision: when a captured payment cannot be paired with
committed inventory, enqueue an idempotent `REFUND_PAYMENT` (or a compensation saga) and transition
the order to `REFUNDING`/`REFUNDED`. Persist the decision in the same transaction as the state
change. Add a reconciliation job for orders stuck in `INVENTORY_COMMITTING`/`FAILED` with captured
payments.

**Regression test.** Payment captured + permanent commit failure → exactly one refund task, payment
refunded once, order terminal state correct; retries are idempotent; a successful late commit does
not also refund.

---

#### M-04 — User IDs are UUID strings but read and checkout paths expect integers

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/user-service/src/main/resources/db/migration/V1__init_user_schema.sql:15` (`id VARCHAR(36)`); `services/user-service/src/main/java/com/causalotel/user/service/AdminBootstrapService.java:120,144` (UUID string insert); `services/user-service/src/main/java/com/causalotel/user/controller/UserController.java:36,49,52` (`getInt`/`@PathVariable int`); `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:37` (`int userId`) and `services/order-service/src/main/resources/db/migration/V1__init_order_schema.sql:5` (`user_id INTEGER`) |
| **Components** | user-service, order-service |

**Impact.** Bootstrap creates a UUID primary key, but the user read API calls `rs.getInt("id")` and
binds `setInt`, so UUID rows are returned as `0` or fail; `GET /api/users/{id}` cannot accept a UUID
at all. Checkout takes an `int userId` and stores it in an `INTEGER` column, so a real UUID user
cannot be referenced. User identity is therefore inconsistent across services, and order rows
cannot be joined to the actual user.

**Reproduction.** Bootstrap an admin (UUID `users.id`), then call `GET /api/users`: the `id` field is
`0`/incorrect. Call `GET /api/users/<uuid>`: path conversion fails with 400. Checkout with the UUID
is impossible because the DTO is `int`. Code-confirmed.

**Fix.** Standardize on one type. Prefer UUID strings end to end: change `UserController` to
`String`/`getString`, order DTO/DB `user_id` to `VARCHAR(36)`, and add a real foreign key. Or keep
integer surrogate keys and expose UUIDs separately, but never mix them. Migrate existing rows and
update the dashboard/checkout examples.

**Regression test.** Bootstrap → list → get by ID round-trips the same UUID; checkout with that user
succeeds and the order references it; a non-existent UUID returns 404; schema/type contract test
fails if `getInt` is used on a UUID column.

---

#### M-05 — Dependency graph endpoint is a static hardcoded topology

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `analysis-engine/src/server.js:123-135` (`GET /api/analysis/graph`) |
| **Class/method** | Express route handler |

**Impact.** Every call returns the same eight edges (`dashboard → order/product/user`,
`order → inventory/payment`, `analysis-engine → order/inventory/payment`), regardless of actual
traffic, service health, or trace relationships. The dashboard labels it "Tarjan SCC" and "DAG
Verified", implying runtime analysis that is not happening. A missing or failed dependency is not
reflected, and the RCA topology input is disconnected from telemetry.

**Reproduction.** Call `GET /api/analysis/graph` twice, stop a service, and call again: the JSON is
identical. The audit observed the static 7-node/8-edge graph at runtime.

**Fix.** Build the graph from recent Tempo spans (parent/child service relationships) or a service
registry with health, with a time window and edge counts. If telemetry is unavailable, return an
explicit empty/unavailable graph rather than a hardcoded one. Cache with a timestamp and expose the
source/window.

**Regression test.** Fixture traces with a new edge → graph includes it; no traces → empty/503;
stopped service is reflected by health metadata; the graph is not identical across different
fixtures.

---

#### M-06 — Checkout validation permits integer overflow and duplicate/unverified SKUs

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/order-service/src/main/java/com/causalotel/order/service/SagaOrchestrator.java:36-37,60-66` |
| **Class/method** | `SagaOrchestrator.checkout(CheckoutRequest)` |

**Impact.** `totalCents` is an `int` and the only checks are `quantity > 0` and `priceCents >= 0`.
`quantity * priceCents` can overflow to a negative value; the `orders.total_cents >= 0` CHECK then
fails with a 500, or a wrapped value could reach payment if the check is bypassed. There is no upper
bound on quantity, no deduplication of repeated SKUs, and `productId` is accepted but never used or
validated. A request can contain a SKU that does not exist, relying on inventory to fail later.

**Reproduction.** POST a checkout with `quantity: 2147483647` and `priceCents: 2`; the multiplication
overflows. Send the same SKU twice; both lines are accepted and sent to inventory. Code-confirmed;
not run against live data.

**Fix.** Use `long`/`BigDecimal` with explicit min/max and a maximum cart size. Resolve and validate
each SKU/product against the catalog (C-02), reject unknown/inactive products, and either reject
duplicate SKUs or coalesce quantities. Validate the computed total against a configured cap before
any write.

**Regression test.** Fuzz quantities/prices at int boundaries; overflow/negative/zero totals →
400; duplicate SKU → 400 or one coalesced line; unknown SKU → 400 before order creation; maximum
valid cart still succeeds.

---

#### M-07 — Metrics page expects a different shape and silently keeps mock data

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `dashboard/src/pages/Metrics.jsx:15-82,85,96-101`; backend shape at `analysis-engine/src/prometheus_client.js:23-38` |
| **Component** | `Metrics.jsx` |

**Impact.** The backend returns an object keyed by service with
`{requestRate, errorRate, p95LatencyMs, p99LatencyMs, status}`. The page expects an array of
`{service, port, rps, p50, p95, p99, errorRate, dbConnections, status}`. `Array.isArray(resp.data)`
is false, so the page keeps the hardcoded mock array even when the backend responds successfully.
Even if the shape were an array, field names and units differ, so the charts would show blanks.

**Reproduction.** With the analysis engine running, open `/metrics`: values match the mock array,
not `GET /api/analysis/metrics`. Code-confirmed; the audit observed the object response.

**Fix.** Define a shared metrics DTO. Either return the array the UI expects or add an adapter that
maps the object to rows and derives p50/db connections from real data (or removes those columns).
Show an explicit error when the fetch fails; do not fall back to mock data.

**Regression test.** Contract test with the real backend response renders rows; unavailable backend
shows an error; no mock values appear in a non-demo build; field/unit assertions for every column.

---

#### M-08 — Health/status surfaces are static or tied to unused Mongo

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | RUNTIME-VERIFIED (analysis `/health/ready` 503 while the service was serving requests) |
| **Location** | `dashboard/src/pages/Overview.jsx:19-26,66,79`; `dashboard/src/pages/Services.jsx:78-80`; `analysis-engine/src/server.js:57-70` |
| **Components** | Overview, Services, analysis readiness |

**Impact.** The dashboard hardcodes "6 / 6" healthy, per-service latencies, and one active incident;
Services hardcodes `ONLINE`. The analysis engine's readiness probe returns 503 whenever MongoDB is
down, even though incidents are stored in memory/spool and the service is otherwise serving. A real
orchestrator would remove a healthy analysis pod, while the UI would still claim everything is
online.

**Reproduction.** Stop a business service: the dashboard still shows 6/6 and `ONLINE`. With Mongo
down but analysis serving, `GET :5000/health/ready` returns 503 while `/health/live` and API calls
work. The audit observed the 503.

**Fix.** Drive dashboard health from real per-service probes (with timeouts) and show
unknown/degraded states. Make analysis readiness reflect its actual critical dependencies (spool
directory writable, store initialized); treat Mongo as optional if it is not used, or implement it
(H-11). Do not hardcode counts.

**Regression test.** Stop one service → dashboard shows 5/6 or degraded; analysis ready is 200 when
its real store is usable and 503 when the spool is unwritable; no hardcoded health values remain.

---

#### M-09 — `start-all.ps1` launches stale artifacts and omits the tracer

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `scripts/start-all.ps1:62-91` (use existing jar if present, no freshness check), `:103-106` (`node src/server.js` instead of `npm start`), `:108-112` (dashboard), `:118-144` (health polling) |
| **Component** | Startup script |

**Impact.** If a jar exists, it is launched even when sources are newer, so the running service can
be an old build (the order test rerun showed how stale artifacts confuse results). The analysis
engine is started with `node src/server.js`, bypassing `package.json`'s
`node --import ./src/tracer.js`, so the analysis engine does not initialize its OTel tracer. The
script also does not start the observability stack (C-04), does not check port conflicts, and
overwrites the PID file even if previous processes are still running.

**Reproduction.** Modify a Java source without rebuilding, run `start-all.ps1`, and observe the old
jar behavior. Check the analysis startup command in the process list: no `--import ./src/tracer.js`.
Code-confirmed.

**Fix.** Build or verify artifact freshness (timestamp/hash) before launch, or always run the
documented build. Use `npm start`/`npm run dev` for the analysis engine so the tracer loads. Check
ports and existing PIDs, fail fast on conflicts, start/verify the observability stack, and make the
readiness loop exit nonzero when services never become ready.

**Regression test.** A stale jar is detected/rebuilt; the analysis process includes the tracer;
occupied ports abort with a clear error; readiness failure returns nonzero; the PID file is not
clobbered while old processes run.

---

#### M-10 — `build-all.ps1` reports success without tests and hides C++ failures

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED |
| **Location** | `scripts/build-all.ps1:33` (`clean compile -DskipTests`), `:62` (`node --check` only), `:88-104` (C++ try/catch), `:106-108` (unconditional success banner) |
| **Component** | Build script |

**Impact.** Java services are compiled with tests skipped; Node is only syntax-checked, so broken
imports/runtime behavior pass; C++ build errors are caught and reported as "skipped or warning"
while the script still prints "ALL ... BUILT SUCCESSFULLY". A CI or operator can treat a broken tree
as green. The C++ fallback message also implies the native engine is optional without verifying the
JS fallback's behavior.

**Reproduction.** Introduce a failing C++ build or a broken runtime import in `analysis-engine` and
run `build-all.ps1`: it still exits successfully and prints the success banner. Code-confirmed.

**Fix.** Run the test suites (or at least `mvn verify`, `dotnet test`, `npm test`, and a Node import
smoke test) as part of the build. Do not swallow C++ failures if the native target is claimed;
otherwise mark it explicitly optional and skip it consistently. Track a failure flag and only print
success when every required step passed; exit nonzero otherwise.

**Regression test.** Inject a failing test/import/C++ build and assert a nonzero exit and no success
banner; a clean tree passes all suites; the script's output matches the actual step results.

---

#### M-11 — README/demo claim production-grade and zero-simulation behavior the code lacks

| Field | Value |
|---|---|
| **Severity** | Medium |
| **Verification** | CODE-CONFIRMED + RUNTIME-VERIFIED (telemetry backends closed) |
| **Location** | `README.md:14,16,27,33,88,172-173`; `scripts/demo-checkout-rca.ps1:3-15,218-264` |
| **Components** | Documentation, demo script |

**Impact.** The README calls the project "production-grade", describes a C++20 native daemon and a
Tempo/Prometheus pipeline, and lists observability/native phases as if complete, while the audit
found the telemetry plane absent (C-04), traces synthetic (C-03), metrics random (H-10), the C++
core unbuilt (L-04), and dashboard screens mocked (H-14). The demo script says "Zero simulation" and
"0 fabrications" but queries Tempo only to label it unavailable and then relies on the analysis
engine's synthetic fallback. This misleads users and makes the demo's pass/fail signal meaningless.

**Reproduction.** On the audit baseline Tempo was unavailable (port 3200 closed). The demo script
has a branch that labels Tempo unavailable and still completes; the analysis engine's synthetic
fallback is unconditional. The README's phase checklist marks Phase 6/7 as incomplete while the
feature table claims them. The demo itself was not executed because it creates real orders.

**Fix.** Rewrite the README to match the actual implementation and status labels; distinguish
implemented, partial, planned, and unverified. Make the demo fail (nonzero) when required real
telemetry is unavailable, or explicitly run a labeled synthetic demo mode. Remove "production-grade"
and "zero simulation" until C-03/C-04/H-10/H-14 are fixed. Update the phase checklist and link this
audit.

**Regression test.** A docs check verifies every claimed endpoint/port exists; the demo exits
nonzero when Tempo/Prometheus are down in real mode; synthetic mode prints a clear banner and is
excluded from the "real" success path.

### Low

#### L-01 — Settings shows the wrong native binary path

| Field | Value |
|---|---|
| **Severity** | Low |
| **Verification** | CODE-CONFIRMED |
| **Location** | `dashboard/src/pages/Settings.jsx:168`; `cpp-core/CMakeLists.txt:10` |
| **Component** | Settings page / C++ build |

**Impact.** The Settings page displays `cpp-core/build/causalotel_sweepline.exe`, but CMake defines
the executable target `sweep_line` (`add_executable(sweep_line src/main.cpp)`), so the produced
binary is `sweep_line.exe` (under a config directory for multi-config generators). Users following
the UI cannot find or run the native binary, which reinforces the false impression that it is
present.

**Reproduction.** Build `cpp-core` and list `build/`: there is no `causalotel_sweepline.exe`; the
target is `sweep_line`. Code-confirmed; CMake was not installed at the audit baseline.

**Fix.** Display the actual target/output path, ideally read from build metadata or a single
constant shared with the build script. If the binary is optional, show "not built" with the build
command instead of a path.

**Regression test.** A docs/UI test asserts the displayed path exists after a native build, or that
the "not built" state is shown when it does not; the path matches the CMake target name.

---

#### L-02 — Payment simulation is enabled by default outside production profiles

| Field | Value |
|---|---|
| **Severity** | Low |
| **Verification** | CODE-CONFIRMED |
| **Location** | `services/payment-service/src/main/resources/application.yml:32-33` (`enabled: ${PAYMENT_SIMULATION_ENABLED:true}`); `services/payment-service/src/main/java/com/causalotel/payment/config/PaymentSimulationSafetyPostProcessor.java:15-31` |
| **Class/method** | Payment simulation configuration / `PaymentSimulationSafetyPostProcessor` |

**Impact.** The simulator is on by default. The safety post-processor only aborts when an active
profile is literally `prod`/`production`; any other deployment (including a staging environment
without that profile) silently simulates charges instead of contacting a real gateway. The demo is
clearly local, but the default is fail-open for a financially sensitive component.

**Reproduction.** Start the payment service without `PAYMENT_SIMULATION_ENABLED` and without a
`prod` profile: `PaymentGatewaySimulator` is active and charges are simulated. Code-confirmed.

**Fix.** Default simulation to `false`; require an explicit `PAYMENT_SIMULATION_ENABLED=true` in
demo/test profiles. Keep the production guard and add a startup log/banner when simulation is
active. Consider refusing to start if a real gateway URL is configured while simulation is on.

**Regression test.** Default startup has simulation disabled; enabling it without a demo profile
fails or warns loudly; `prod` + enabled aborts; a simulated charge is impossible in the default
configuration.

---

#### L-03 — TraceDetail RCA button targets a nonexistent route

| Field | Value |
|---|---|
| **Severity** | Low |
| **Verification** | CODE-CONFIRMED |
| **Location** | `dashboard/src/pages/TraceDetail.jsx:95` (`navigate('/incidents/inc-...')`); `dashboard/src/App.jsx:31-33` (routes `/incidents` and `/rca/:incidentId`) |
| **Component** | `TraceDetail.jsx` / router |

**Impact.** Clicking the RCA action from a trace navigates to `/incidents/<id>`, which has no route.
The user gets a blank/404 page instead of the RCA detail, breaking the trace-to-root-cause workflow.

**Reproduction.** Open `/traces/<traceId>`, click the RCA button, and observe the unmatched route.
Code-confirmed.

**Fix.** Navigate to `/rca/inc-...` (the existing route), or add an `/incidents/:incidentId` route
that renders/redirects to `RcaDetail`. Add a catch-all route with a clear 404 page.

**Regression test.** Router test clicks the action and asserts the RCA detail route renders; a
catch-all test covers unknown paths.

---

#### L-04 — C++ core is unbuilt and unverified

| Field | Value |
|---|---|
| **Severity** | Low |
| **Verification** | UNVERIFIED (CMake not installed; no binary present) |
| **Location** | `cpp-core/CMakeLists.txt`, `cpp-core/src/main.cpp`, `cpp-core/include/`; README claims at `:16,27,88,173` |
| **Component** | `cpp-core` |

**Impact.** The native sweep-line engine is claimed as a core differentiator ("persistent daemon
with NDJSON communication and benchmark comparison"), but it was not built or tested at the audit
baseline, and the analysis engine uses the pure-JS implementation. There is no evidence that the
C++ and JS implementations agree, no benchmark, and no CI build. The claim is therefore unverified
rather than proven false.

**Reproduction.** `Get-Command cmake` fails on the audit machine; no `cpp-core/build` binary exists.
The analysis engine's `buildSpanTreeAndSelfTimes` uses the JS sweep-line path.

**Fix.** Add CMake to CI, build the native target, and add unit tests/benchmarks for interval union
and self-time. Compare outputs against the JS implementation on shared fixtures. If the native path
is not maintained, remove it from the architecture/README or label it experimental and unverified.

**Regression test.** CI builds `sweep_line` and runs algorithm tests; a fixture set produces
identical self-times in C++ and JS; the README/status matrix reflects the build result.

---

## 6. Test and runtime evidence

### 6.1 Automated tests executed

All suites were run in an isolated `LOCALAPPDATA` directory with a pre-created
`<isolated>\CausalOTel\data` folder. Logs:
`C:\Users\prath\AppData\Local\Temp\causalotel-audit-tests\`.

| Suite | Result | Notes |
|---|---|---|
| user-service | **8 passed** | Isolated DB |
| product-service | **7 passed** | Isolated DB |
| payment-service | **19 passed** | Isolated DB |
| order-service | **16 passed** | Clean isolated run; an earlier rerun failed at `testScenario9_ApplicationCrashRecoveryAfterPaymentCapture:390` with `SQLITE_CONSTRAINT_UNIQUE ... orders.order_id` due to stale `target/test-classes`, not a clean-HEAD source defect |
| inventory-service | **11 passed** | Isolated DB |
| analysis-engine | **22 passed** | Includes the synthetic Tempo fallback test (C-03) |
| dashboard build | **Succeeded** | 1,672 modules transformed; production bundle generated |
| cpp-core | **Not run** | CMake is not installed; no binary |

These results are reported only for the runs actually executed. Passing tests do **not** invalidate
the findings above: several tests encode the defective behavior (C-03), and the suites are not
hermetic (H-15).

### 6.2 Runtime probes

| Probe | Observation |
|---|---|
| `/health/live` on 8081–8084, 5050, 5000 | 200 |
| analysis `/health/ready` | **503** (Mongo down; Mongo is not the incident store) |
| `GET /api/payments/fault` | `NORMAL`, latency `0` |
| `GET /api/inventory/fault` | all flags `false`, latency `0` |
| `GET /api/users` | `200 []` unauthenticated |
| `GET /api/analysis/incidents` | `[]` |
| `GET /api/analysis/graph` | static 7 nodes / 8 edges |
| `GET /api/analysis/metrics` | random request rates + hardcoded payment degradation |
| order DB | 25 rows, including historical `ord-crash-999` |
| payment DB | 19 rows |
| inventory DB | 4 SKUs; laptop available 44, reserved 0 |
| Ports 4317, 4318, 4320, 8889, 9090, 3200 | closed |

### 6.3 Reproductions performed outside the live system

- **C-01:** wrote a spool file outside a temporary spool directory using a traversal `incidentId`.
- **H-11:** produced a `<timestamp>_[object Object].json` spool file and confirmed the malformed
  payload/filename.
- No destructive concurrency, refund, or fault-injection test was run against the live databases or
  services.

## 7. Limitations

1. **Runtime artifacts may not match HEAD.** The running services were launched before the audit and
   may use pre-existing jars/builds. Source review is authoritative for code findings; runtime
   probes are used only as supporting evidence.
2. **No browser automation.** Dashboard contract failures were proven from source and API shapes,
   not by a headless browser run.
3. **No load/penetration testing.** Concurrency, overflow, and traversal impacts are source-proven;
   only the spool traversal and malformed spool filename were executed in isolation.
4. **Telemetry backends absent.** Real Tempo/Prometheus/Mongo behavior could not be validated
   because they were not running and no deployment manifest exists (C-04).
5. **C++ unverified.** CMake was unavailable, so the native path was not built or benchmarked.
6. **Line numbers** refer to the audit baseline `a10bf0b`; they will drift after fixes.
7. **Live DB contents** include historical test residue and are not treated as fixtures.

## 8. Recommended remediation order

### P0 — stop exploitable and integrity failures

1. **C-01:** validate/generate spool IDs and enforce path containment.
2. **H-01/H-02:** authenticate/authorize business and fault endpoints; restrict fault control to
   admins/localhost.
3. **C-02:** resolve prices server-side; never trust client amounts.
4. **C-03/H-10:** remove synthetic trace/metric fallbacks from real responses or mark them
   explicitly and exclude them from RCA/incidents.

### P1 — make the saga correct under failure

5. **H-03:** hash the full canonical request and enforce idempotency in the database.
6. **H-04/H-05:** add uniqueness and a reservation state machine; make reserve/commit/release
   idempotent.
7. **H-06/M-01:** persist saga/order/outbox state transactionally; fix retry scheduling.
8. **H-07/H-08/H-09:** lease/fence recovery, move HTTP out of DB transactions, add timeouts and
   circuit breakers.
9. **M-02/M-03:** fix lock lifetimes and implement the missing refund/compensation path.

### P2 — make observability and UI truthful

10. **C-04:** add a deployable collector/Tempo/Prometheus stack with health checks.
11. **H-11/M-05:** repair incident persistence/drain; build the graph from real telemetry.
12. **H-12/H-13/H-14/M-07/M-08:** align API contracts, send correct fault payloads, remove mock
    operational data, and drive health from real probes.
13. **M-04/M-06:** standardize user IDs and harden checkout validation.

### P3 — verification and documentation

14. **H-15:** isolate every test database; make `test-all.ps1` hermetic.
15. **M-09/M-10/M-11:** fix startup/build scripts and align README/demo claims with reality.
16. **L-01–L-04:** correct the binary path, default simulation off, fix the trace route, and either
    build/verify the C++ core or label it unverified.

## 9. Audit conclusion

The repository contains a genuine happy-path checkout implementation and a useful local demo, but
the audit baseline does not support its security, financial-integrity, durability, or
observability claims. The 34 findings above are ordered by real risk; the P0 items should be fixed
before any further demo or deployment, and the P1 items before the saga is trusted with real money
or real inventory.

**No fixes were implemented during this audit.** Source, tests, schemas, and runtime configuration
are unchanged. The next step is an explicit `FIX` instruction selecting the scope to remediate.

## 10. Remediation status (2026-11-13)

All fixes were implemented on `feature/complete-causalotel` after the audit baseline. The status
labels used here are:

- **FIXED AND VERIFIED** — code changed, a regression test or live check proves the fix, and the
  relevant build/test/integration command was run.
- **FIXED BUT UNVERIFIED** — code changed but the proving check could not be run in this environment.
- **PARTIALLY FIXED** — some attack path or failure mode remains.
- **BLOCKED** — the environment lacks a required toolchain; the limitation is explicit in the product.

### 10.1 Verification evidence

| Check | Command | Result |
|---|---|---|
| Full build and all automated suites | `scripts\build-all.ps1` | PASS — user, product, order, payment, inventory, analysis (73 tests), dashboard tests (27 tests); dashboard production build; `cpp-core SKIP` (no CMake) |
| Isolated master test run | `scripts\test-all.ps1` | PASS — 7/7 suites; live SQLite databases and `spool/incidents` fingerprinted `UNCHANGED` |
| Real telemetry smoke test | `scripts\verify-observability.ps1` | PASS — OTLP span accepted, stored by Tempo, served by analysis-engine with `synthetic=false`; all 7 Prometheus targets `UP` |
| Authenticated checkout/fault/recovery/RCA demo | `scripts\demo-checkout-rca.ps1` | PASS — 60/60 checks; real checkout trace `4bdd7f97948770cc004dbefe10a04bed` with `order-service`, `payment-service`, and `product-service` spans; incident `inc-4bdd7f979487` persisted |
| Live graph | `GET /api/analysis/graph?window=15m&limit=20` | PASS — `source: tempo`; 20 real traces, 2 real edges (`order-service → payment-service` ×5, `order-service → product-service` ×3); `failedTraceCount=0`, `degraded=false`; maintenance roots excluded by `rootName` TraceQL and defensive filtering. The 5 nodes are the 4 business services plus the short-lived `causalotel-smoke` verification client, shown honestly as `UNKNOWN` health. |
| Residual non-audit warnings | `dotnet test` (inventory) | PASS 21/21, but NuGet reports `NU1902`/`NU1903` for `OpenTelemetry.Exporter.OpenTelemetryProtocol 1.11.2`, `System.Security.Cryptography.Pkcs 9.0.0`, and `SQLitePCLRaw.lib.e_sqlite3 2.1.11`. These are outside the 34 audit findings and were not remediated in this pass. |
| Payment simulation safety | payment suite | PASS — simulation disabled by default; 503 guards; profile-gated startup |
| Native C++ core | `build-all.ps1` | **BLOCKED** — no CMake/compiler; JS fallback active and tested |

### 10.2 Final status of all 34 findings

| ID | Severity | Finding | Status | Verification |
|---|---|---|---|---|
| C-01 | Critical | Unauthenticated path traversal in incident spool write | **FIXED AND VERIFIED** | Strict incident-ID validation plus resolved-path containment; traversal/absolute/NUL/overlong IDs rejected; no out-of-spool writes (`spool.test.js`, `server.test.js`) |
| C-02 | Critical | Client-supplied item prices drive order total and payment charge | **FIXED AND VERIFIED** | Order-service resolves authoritative catalog prices; client price is mismatch detection only; tampered/omitted/out-of-stock cases tested; demo asserts server-resolved total |
| C-03 | Critical | Tempo failures silently fabricate synthetic traces | **FIXED AND VERIFIED** | Typed `TempoError` 400/404/502/503; synthetic fixture is opt-in, marked `synthetic:true`, never persisted or scored; demo asserts `synthetic=false` |
| C-04 | Critical | Telemetry plane has configs but no deployment and is not running | **FIXED AND VERIFIED** | Pinned native Collector/Tempo/Prometheus installed and started by scripts; real OTLP→Tempo→analysis and Prometheus scrape verified |
| H-01 | High | Unauthenticated runtime fault-injection endpoints | **FIXED AND VERIFIED** | Fault GET/POST require `ROLE_ADMIN`; bounded/audited and disableable; tests cover anonymous/user denial and disabled mode |
| H-02 | High | No authentication or authorization on business APIs | **FIXED AND VERIFIED** | HMAC-signed bearer tokens with `ROLE_USER`/`ROLE_ADMIN`/`ROLE_SERVICE`; user/order scoping; auth tests across services; live demo authenticates every call |
| H-03 | High | Checkout idempotency hash ignores item identity and price | **FIXED AND VERIFIED** | Canonical hash covers user, currency, resolved items/prices; key bound to user; different SKU returns 409 with no second order (tests) |
| H-04 | High | Reservation idempotency check is a check-then-act race | **FIXED AND VERIFIED** | Unique `(OrderId, Sku)` index and transactional claim; concurrent reserve consumes stock once; mismatched payload rejected (`H04_*` tests) |
| H-05 | High | Reservation state transitions permit duplicate/wrong reservations | **FIXED AND VERIFIED** | Explicit state machine with guarded transitions; invalid transitions rejected (`H05_*` tests) |
| H-06 | High | Saga/outbox persistence errors are swallowed | **FIXED AND VERIFIED** | Order status, saga state, outbox task, and idempotency result commit in one transaction; persistence failure aborts checkout (test) |
| H-07 | High | Stale-saga recovery races active checkout and outbox work | **FIXED AND VERIFIED** | 30s leases with atomic claims; recovery ignores active leases and claims expired sagas exactly once (tests) |
| H-08 | High | Expiry worker holds a DB write transaction across HTTP calls | **FIXED AND VERIFIED** | Payment states resolved before the write transaction; per-order outcomes isolated (`H08_*` tests) |
| H-09 | High | Downstream HTTP client has no connect/read timeouts | **FIXED AND VERIFIED** | Configurable connect/read timeouts on the shared client; timeout regression test |
| H-10 | High | Metrics endpoint returns random and hardcoded data | **FIXED AND VERIFIED** | Analysis metrics query Prometheus deterministically; outage returns typed 503; live response `source: prometheus` with real service metrics |
| H-11 | High | Incident persistence is broken and MongoDB is unused | **FIXED AND VERIFIED** | Durable disk spool is the source of truth; atomic writes, restart hydration, corrupt-file quarantine; demo persists and rereads an incident; `/health/ready` reports disk spool |
| H-12 | High | Dashboard RCA/incident contract does not match the backend | **FIXED AND VERIFIED** | Normalizers and page wiring match real contracts; contract tests plus live persisted-incident read |
| H-13 | High | Dashboard fault payloads do not match either backend | **FIXED AND VERIFIED** | Exact payment/inventory payloads sent; admin-only; contract tests; live fault demo returns expected 504 |
| H-14 | High | Dashboard displays mock or static operational data | **FIXED AND VERIFIED** | Mock fallbacks removed from health, traces, metrics, incidents, topology, settings; pages show explicit errors when APIs fail; dashboard tests/build |
| H-15 | High | Test suites mutate live databases and are not isolated | **FIXED AND VERIFIED** | `test-all.ps1` redirects `LOCALAPPDATA`, supplies temp DB paths, fingerprints live DBs and spool, and fails on change; 7/7 suites pass with live data `UNCHANGED` |
| M-01 | Medium | Outbox retry backoff is ineffective | **FIXED AND VERIFIED** | Deterministic `min(60s, 2^retries + jitter)` gate; retry/dead-letter metrics; test asserts 2/4/8/16/32s, gating, `FAILED`, and metric deltas |
| M-02 | Medium | In-flight lock maps are removed or used unsafely | **FIXED AND VERIFIED** | Fixed 256-entry striped lock array; DB constraints remain authoritative; 100-concurrent-charge test |
| M-03 | Medium | Refund/compensation outbox path is dead code | **FIXED AND VERIFIED** | Five commit attempts then transactional escalation to exactly one `REFUND_PAYMENT`; final idempotent commit before refund; late commit confirms without refund (tests) |
| M-04 | Medium | User IDs are UUID strings but read/checkout paths expect integers | **FIXED AND VERIFIED** | UUID `TEXT` end to end via Flyway V4; user/order read and checkout tests |
| M-05 | Medium | Dependency graph endpoint is a static hardcoded topology | **FIXED AND VERIFIED** | Graph derived from recent Tempo parent/child spans with window/cache/health metadata; Tempo `rootName` TraceQL filter plus defensive client check excludes maintenance traces; bounded fetch concurrency; trace-list `service`/`operation` filters; live graph and tests |
| M-06 | Medium | Checkout validation permits overflow and duplicate/unverified SKUs | **FIXED AND VERIFIED** | Item/quantity/total bounds, duplicate coalescing, unknown SKU rejection, catalog `productId` authority; item/quantity/total/duplicate/unknown/mismatch tests |
| M-07 | Medium | Metrics page expects a different shape and silently keeps mock data | **FIXED AND VERIFIED** | Page consumes real `{source, generatedAt, window, services}` object; no mock retention; dashboard tests |
| M-08 | Medium | Health/status surfaces are static or tied to unused Mongo | **FIXED AND VERIFIED** | Analysis engine performs server-side health probes; dashboard renders real UP/DOWN/UNREACHABLE; readiness uses the disk spool, not Mongo; tests and live probes |
| M-09 | Medium | `start-all.ps1` launches stale artifacts and omits the tracer | **FIXED AND VERIFIED** | Rebuilds stale artifacts, checks ports/PIDs, starts analysis via `npm start` with tracer, starts observability, fails nonzero on readiness failure; live startup succeeded |
| M-10 | Medium | `build-all.ps1` reports success without tests and hides C++ failures | **FIXED AND VERIFIED** | Runs Java `clean verify`, `dotnet test`, Node tests, dashboard tests/build, tracks failures, exits nonzero; `cpp-core` reported `SKIP` explicitly; live run passed |
| M-11 | Medium | README/demo claim production-grade and zero-simulation behavior the code lacks | **FIXED AND VERIFIED** | README rewritten with honest local-demo scope, real auth/observability instructions, limitations, and status; demo runs 60/60 against real auth/telemetry and fails nonzero on missing telemetry |
| L-01 | Low | Settings shows the wrong native binary path | **FIXED AND VERIFIED** | Settings reads `/api/analysis/native-core`; reports real checked paths, `NOT BUILT`, and build command instead of a hardcoded path |
| L-02 | Low | Payment simulation is enabled by default outside prod profiles | **FIXED AND VERIFIED** | Simulation defaults false; only explicit `demo`/`dev`/`test`; `prod` aborts; disabled endpoints return 503; payment tests |
| L-03 | Low | TraceDetail RCA button targets a nonexistent route | **FIXED AND VERIFIED** | Central route table, real RCA detail route, legacy `/incidents/:id` mapping, catch-all NotFound; router tests |
| L-04 | Low | C++ core is unbuilt and unverified | **BLOCKED** | No CMake or C++ compiler (`cl`, `g++`, `clang++`, `msbuild`, `ninja` absent). JS fallback is tested and active; `/api/analysis/native-core` and Settings report `available:false`; `build-all.ps1` reports `cpp-core SKIP` |

### 10.3 Completion

- **33 / 34 findings FIXED AND VERIFIED (97.1%).**
- **1 / 34 BLOCKED (L-04, native C++ toolchain absent).**
- No finding is `PARTIALLY FIXED` or `FIXED BUT UNVERIFIED`.
- The product is a verified local demo, not a production deployment. Known limitations are
  documented in `README.md` and `PROJECT_CONTEXT.md`.





