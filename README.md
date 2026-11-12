# CausalOTel

**A locally runnable, polyglot microservices demo with real OpenTelemetry tracing,
Tempo-backed root cause analysis, Prometheus metrics, and an authenticated dashboard.**

CausalOTel is a **local development and demonstration platform**, not a production
service. It runs five business services plus an analysis engine, a React dashboard,
and a native Windows observability stack (OTel Collector, Tempo, Prometheus). All
telemetry used by RCA comes from real spans and metrics emitted by the running
services. When a backend is unavailable, the system reports an explicit degraded or
unavailable state; it does not fabricate traces, metrics, incidents, or RCA results.

> **Honest status:** 33 of the 34 findings in [`AUDIT_REPORT.md`](AUDIT_REPORT.md) are
> `FIXED AND VERIFIED`. The remaining finding, **L-04 (native C++ core)**, is
> `BLOCKED` because this machine has no CMake or C++ compiler. The JavaScript
> sweep-line fallback is active and tested; the native binary is not built.

---

## Architecture

```
                    React dashboard (Vite, :3000)
                              |
                              | authenticated REST
                              v
                 Analysis engine (Node/Express, :5000)
                   |-- RCA scoring + Tarjan SCC graph
                   |-- durable disk incident spool
                   |-- JS sweep-line fallback (C++ binary optional)
                   |
          +-------------------+-------------------+
          |                                       |
          v                                       v
   Tempo (:3200 query, :4320 OTLP)        Prometheus (:9090)
          ^                                       ^
          | OTLP/HTTP :4318                       | scrape
   OTel Collector (:4317 gRPC, :4318 HTTP, :8889 exporter)
          ^
          | W3C traceparent + OTLP
          |
  user :8081  product :8082  order :8083  payment :8084  inventory :5050
   (Java 25 / Spring Boot 4)                              (.NET 10)
```

### Services

| Service | Stack | Port | Responsibility |
|---|---|---:|---|
| user-service | Java 25 / Spring Boot 4 | 8081 | Registration, login, signed bearer tokens, roles |
| product-service | Java 25 / Spring Boot 4 | 8082 | Catalog and authoritative prices |
| order-service | Java 25 / Spring Boot 4 | 8083 | Checkout saga, idempotency, outbox, reconciliation |
| payment-service | Java 25 / Spring Boot 4 | 8084 | Simulated charge/refund, admin-only fault injection |
| inventory-service | C# / ASP.NET Core 10 | 5050 | Reservation state machine, commit/release, expiry worker |
| analysis-engine | Node.js 26 / Express | 5000 | Tempo/Prometheus clients, RCA, graph, incident store |
| dashboard | React 19 / Vite / Tailwind | 3000 | Authenticated operator UI |

Every Java service and the analysis engine export OTLP spans to the collector. The
inventory service exposes Prometheus metrics and health endpoints; it does not emit
OTLP spans in this build. The dashboard is a browser client and does not emit
telemetry.

---

## Prerequisites

- Windows 10/11 with PowerShell 5.1 or newer.
- **Java 25** and the Maven Wrapper (`mvnw.cmd`) in each Java service.
- **.NET 10 SDK** on `PATH`.
- **Node.js 26** with `npm.cmd` (the `npm.ps1` shim may be blocked by execution policy).
- Free ports: `3000`, `5000`, `5050`, `8081`–`8084`, `3200`, `4317`, `4318`, `4320`,
  `8889`, `9090`, `13133`.
- Optional: CMake + a C++20 compiler for the native sweep-line core (not installed
  in the verification environment).

No Docker, Kubernetes, WSL2, Redis, Kafka, or RabbitMQ is required or used.

---

## Quick start

Run these commands from the repository root in PowerShell:

```powershell
# 1. Download and SHA-256 verify the pinned native observability binaries.
#    Installs into tools/observability (gitignored).
.\scripts\install-observability.ps1

# 2. Build and test every component. Fails if any service is still running.
.\scripts\build-all.ps1

# 3. Start observability, all seven application processes, and wait for readiness.
.\scripts\start-all.ps1

# 4. Prove OTLP -> Tempo -> analysis-engine and Prometheus scraping work.
.\scripts\verify-observability.ps1

# 5. Run the authenticated checkout + fault + recovery + RCA demo.
.\scripts\demo-checkout-rca.ps1

# 6. Stop everything.
.\scripts\stop-all.ps1
```

### Running the tests

For trustworthy live-database integrity evidence, stop the mesh first. The test
runner redirects `LOCALAPPDATA` to a fresh temporary root and fingerprints the live
databases and incident spool before and after the run.

```powershell
.\scripts\stop-all.ps1
.\scripts\test-all.ps1
```

`test-all.ps1` runs seven suites:

1. user-service (`mvnw.cmd test`)
2. product-service (`mvnw.cmd test`)
3. order-service (`mvnw.cmd test`)
4. payment-service (`mvnw.cmd test`)
5. inventory-service (`dotnet test`)
6. analysis-engine (`npm.cmd test`)
7. dashboard contract/auth/router tests (`npm.cmd test`)

It exits nonzero if any suite fails or if any live database or the live incident
spool changed.

### Access points

| Endpoint | URL |
|---|---|
| Dashboard | <http://localhost:3000> |
| Analysis API | <http://localhost:5000/api/analysis> |
| Health | `/health/live` on every service; `/health/ready` on analysis-engine |
| Java metrics | `/actuator/prometheus` |
| Inventory/analysis metrics | `/metrics` |
| Tempo | <http://localhost:3200> |
| Prometheus | <http://localhost:9090> |
| Collector health | <http://localhost:13133> |

---

## Authentication and roles

All business APIs require a signed bearer token. Tokens are HMAC-SHA256 signed
(`v1.<base64url(payload)>.<base64url(hmac)>`) and carry a role:

- `ROLE_USER` — register/login, browse catalog, create and read own orders.
- `ROLE_ADMIN` — read all payments, inspect/reconcile orders, control fault injection.
- `ROLE_SERVICE` — service-to-service calls.

Registration always creates `ROLE_USER`. The first administrator is provisioned with
a one-time bootstrap token:

```text
%LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token
```

The dashboard login page exposes the bootstrap form. The token is consumed on success;
an expired, unconsumed token is regenerated on user-service startup. The demo script
stores the generated admin credentials outside the repository at:

```text
%LOCALAPPDATA%\CausalOTel\demo\admin-credentials.json
```

Never commit that file. For non-demo use, set `AUTH_TOKEN_SECRET` (or
`auth.token.secret`) to a private value; the development fallback constant is not a
production secret.

---

## Observability pipeline

The stack uses portable native Windows binaries pinned to:

| Component | Version | Ports |
|---|---|---|
| otelcol-contrib | 0.165.0 | 4317 (gRPC), 4318 (HTTP), 8889 (Prometheus exporter), 13133 (health) |
| Tempo | 3.1.1 | 3200 (query), 4320 (OTLP) |
| Prometheus | 3.16.0 | 9090 |

`scripts/install-observability.ps1` downloads the pinned archives, verifies SHA-256,
and extracts them under `tools/observability` (gitignored). Tempo's config uses a
`__DATA_ROOT__` placeholder rendered from `CAUSALOTEL_DATA_ROOT`; no machine-specific
absolute paths are committed.

`scripts/verify-observability.ps1` sends a real OTLP span, waits for Tempo to store
it, reads it back through the analysis engine with `synthetic=false`, and confirms
Prometheus reports every scrape target as `UP`.

### What is real vs. simulated

- **Real:** traces, spans, span parent/child relationships, Prometheus metrics,
  service health probes, incidents persisted to the disk spool, RCA results computed
  from those traces/metrics, checkout/saga state in SQLite.
- **Simulated:** payment gateway behavior. Payment simulation is disabled by default
  and is only allowed under explicit `demo`, `dev`, or `test` profiles. Under `prod`
  or `production` the service refuses to start with simulation enabled. When
  simulation is disabled, charge/refund/fault endpoints return `503`.
- **Not fabricated:** the analysis engine never substitutes synthetic traces,
  metrics, incidents, health, or topology when a backend fails. Demo fixtures are
  opt-in only, are marked `synthetic: true`, are never persisted, and are rejected by
  RCA scoring.

---

## RCA and dependency graph

1. Services propagate W3C trace context and export OTLP spans.
2. The collector exports spans to Tempo and exposes its own metrics to Prometheus.
3. The analysis engine queries Tempo for traces and Prometheus for service metrics.
4. RCA computes per-span self-time, ranks suspicious services, and emits evidence,
   causal paths, and remediations.
5. Incidents are written atomically to the durable disk spool and hydrated on restart.
6. The dependency graph is derived from real Tempo parent/child spans scoped to the
   selected window (`30s`, `15m`, `1h`, `24h`), enriched with live health metadata,
   and cached with source/window/timestamp metadata. Scheduler and actuator/health
   traces are excluded by a Tempo `rootName` TraceQL filter and by a defensive
   client-side check; trace-detail fetches use bounded concurrency so Tempo is not
   overwhelmed. The trace list API accepts optional `service` and `operation`
   filters so a specific business trace is not crowded out by maintenance traffic.

`POST /api/analysis/analyze-trace` returns `persisted: true` only after the incident
is durably spooled. If Tempo or Prometheus is unavailable, the API returns typed
`400`/`404`/`502`/`503` problem details instead of a fabricated result.

---

## Test isolation

- Every suite runs with `LOCALAPPDATA` redirected to a fresh temp directory and an
  explicit temporary `SQLITE_DB_PATH`.
- Java tests use `@DynamicPropertySource` plus per-service test-resource fallbacks
  under `java.io.tmpdir`.
- Destructive cleanup guards reject non-temp or live paths.
- Analysis-engine tests run with `--import ./test/setup-env.js`, which creates an
  isolated temp spool root.
- `test-all.ps1` fingerprints the live databases and incident spool before and after
  the run and fails if either changes.

---

## Native C++ core (L-04: BLOCKED)

The C++20 sweep-line interval-union core is present under `cpp-core/`, but this
environment has no CMake and no C++ compiler (`cl`, `g++`, `clang++`, `msbuild`, and
`ninja` are all absent). The binary is therefore **not built or verified**.

- The analysis engine uses the tested JavaScript fallback.
- `GET /api/analysis/native-core` reports `available: false`, the exact expected
  binary paths it checked, and the build command.
- `build-all.ps1` reports `cpp-core SKIP` and does not claim a successful native build.
- The dashboard Settings page displays `NOT BUILT` rather than a fake path.

To verify the native path on a machine with the toolchain:

```powershell
cmake -S cpp-core -B cpp-core/build
cmake --build cpp-core/build --config Release
```

Then rerun the analysis-engine tests and compare self-times against the JS fallback.

---

## Remediation status

The audit baseline was commit `a10bf0ba238ccc038901f9c772c3958b956fa015`. Findings and
their final status live in [`AUDIT_REPORT.md`](AUDIT_REPORT.md). Summary:

| Severity | Count | Fixed and verified | Blocked |
|---|---:|---:|---:|
| Critical | 4 | 4 | 0 |
| High | 15 | 15 | 0 |
| Medium | 11 | 11 | 0 |
| Low | 4 | 3 | 1 (L-04) |
| **Total** | **34** | **33** | **1** |

Verification evidence includes `build-all.ps1`, `test-all.ps1` (seven isolated
suites with live databases `UNCHANGED`), `verify-observability.ps1`, and
`demo-checkout-rca.ps1` (60/60 checks against the live stack). The demo's real
checkout trace was `4bdd7f97948770cc004dbefe10a04bed`, with spans from
`order-service`, `payment-service`, and `product-service`; the corresponding RCA
incident persisted as `inc-4bdd7f979487`. The live graph produced 5 nodes and 2 real
edges with `failedTraceCount=0` and `degraded=false`.

---

## Known limitations

- **Local demo only.** SQLite databases, local processes, no TLS, no horizontal
  scaling, no secrets manager, no production deployment manifests.
- **Payment is simulated.** No real transactions are performed.
- **Native C++ path is unverified** in this environment (see L-04).
- **Inventory does not emit OTLP spans.** It is visible to Prometheus and the health
  probe but not as a traced service in Tempo.
- **The dashboard is an operator demo**, not a hardened multi-tenant console.
- **Historical rows may exist** in a long-lived local database from earlier runs;
  they are not fixtures.
- **NuGet warnings remain** for three inventory-service dependencies
  (`OpenTelemetry.Exporter.OpenTelemetryProtocol 1.11.2`,
  `System.Security.Cryptography.Pkcs 9.0.0`, `SQLitePCLRaw.lib.e_sqlite3 2.1.11`).
  They are outside the 34 audit findings and were not upgraded in this pass.

---

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime topology, data model, saga, RCA pipeline.
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — runbook, test baseline, capability status.
- [`AUDIT_REPORT.md`](AUDIT_REPORT.md) — the original 34 findings and final remediation status.

## License

See the repository for license information.
