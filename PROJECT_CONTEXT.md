# PROJECT_CONTEXT — CausalOTel

> Audit-only baseline document. This file describes the repository **as implemented at commit
> `a10bf0b` on 2026-11-11**, not an aspirational design. No source, test, schema, or runtime
> configuration was changed during the audit. See [`AUDIT_REPORT.md`](AUDIT_REPORT.md) for findings
> and [`ARCHITECTURE.md`](ARCHITECTURE.md) for the implemented topology.

## 1. Metadata

| Item | Value |
|---|---|
| Repository | `C:\Users\prath\OneDrive\Desktop\CausalOTel` |
| Branch | `feature/complete-causalotel` |
| Audit baseline commit | `a10bf0ba238ccc038901f9c772c3958b956fa015` — `feat(demo): implement real live e2e demonstration with zero simulation` |
| Commit date | 2026-11-11 12:44:56 +0530 |
| Working tree at audit start/end | Clean before documentation; only the three audit Markdown files are new afterwards |
| Audit date | 2026-11-11 |
| Runtime observed | Dashboard `:3000`; user `:8081`; product `:8082`; order `:8083`; payment `:8084`; inventory `:5050`; analysis `:5000` |
| Telemetry backends observed | **Not running** — `:4317`, `:4318`, `:4320`, `:8889`, `:9090`, `:3200` closed |

## 2. Purpose

CausalOTel is a local, polyglot demonstration of an e-commerce checkout flow with a
root-cause-analysis (RCA) dashboard attached:

- Five business services model users, products, orders, payments, and inventory.
- The order service implements a saga: reserve inventory, charge payment, commit inventory, with
  compensation and a transactional-outbox-style recovery path.
- OpenTelemetry instrumentation is configured in the Java and .NET services.
- The analysis engine is intended to read traces from Tempo, model service dependencies, compute
  span self-time with a sweep-line interval-union algorithm, and rank a likely culprit.
- A React dashboard is intended to display topology, traces, metrics, incidents, and RCA evidence.

The demonstration is **not production-grade** at this baseline. The checkout happy path is real and
has automated tests, but the RCA/observability half is partly synthetic, partly in-memory, and partly
disconnected from the dashboard. The audit report quantifies these gaps.

## 3. Technology stack

| Layer | Technology | Version observed |
|---|---|---|
| Java services | Java / Spring Boot 4.0.0, Maven Wrapper | Java `25.0.5`; Spring Boot `4.0.0` |
| .NET service | ASP.NET Core, EF Core, SQLite, OpenTelemetry | .NET SDK `10.0.404` |
| Analysis engine | Node.js, Express 5, Mongoose, prom-client | Node `v26.13.0` |
| Dashboard | React 19, React Router 7, Vite 6, Tailwind 4, Axios | Vite `6.4.6` resolved; React `^19.0.0` |
| Databases | SQLite (WAL mode) per service | Files under `%LOCALAPPDATA%\CausalOTel\data` |
| Native core | C++20, CMake | Source present; **CMake is not installed**; binary not built |
| Scripting | PowerShell 7 / Windows PowerShell | Windows host |
| Test runners | JUnit 5 / Mockito, xUnit, `node:test`, Vite build | See §6 |

## 4. Repository map

```
CausalOTel/
├─ services/
│  ├─ user-service/        Java, :8081, user.db
│  ├─ product-service/     Java, :8082, product.db
│  ├─ order-service/       Java, :8083, order.db, saga + outbox
│  ├─ payment-service/     Java, :8084, payment.db, simulated gateway
│  └─ inventory-service/   .NET, :5050, inventory.db, expiry worker
├─ analysis-engine/        Node, :5000, in-memory incidents + disk spool
├─ dashboard/              React/Vite, :3000
├─ cpp-core/               C++20 sweep-line source (unbuilt)
├─ observability/          Collector, Prometheus, Tempo configs (not started)
├─ scripts/                start/stop/build/test/demo PowerShell scripts
├─ logs/                   Runtime logs (ignored)
├─ README.md               Project narrative (partly inaccurate; see AUDIT_REPORT M-11)
├─ ARCHITECTURE.md         Implemented architecture (this audit)
├─ PROJECT_CONTEXT.md      This file
└─ AUDIT_REPORT.md         Source-based audit findings (this audit)
```

## 5. Runbook

### 5.1 Prerequisites

- Windows with PowerShell.
- Java 25 and the Maven Wrapper in each Java service.
- .NET 10 SDK on `PATH` (the scripts prepend `C:\Program Files\dotnet` if present).
- Node.js 26 with `npm.cmd` (use `npm.cmd`; `npm.ps1` may be blocked by execution policy).
- Optional: CMake + a C++20 compiler for `cpp-core`.
- Optional: Docker/containers for Collector, Tempo, Prometheus, and MongoDB. **None were running
  during this audit.**

### 5.2 Start and stop the application

```powershell
.\scripts\start-all.ps1 -KeepAlive   # starts 7 processes and writes .causalotel.pids
.\scripts\stop-all.ps1               # stops recorded PIDs and anything listening on the 7 ports
```

`start-all.ps1` starts the seven application processes only. It does **not** start the OTel
Collector, Tempo, Prometheus, MongoDB, or the C++ binary. It prefers existing JAR/DLL artifacts over
rebuilding, so stale builds can be launched (AUDIT_REPORT M-09).

### 5.3 Direct development commands

| Component | Command | Working directory |
|---|---|---|
| User service | `.\mvnw.cmd spring-boot:run` | `services/user-service` |
| Product service | `.\mvnw.cmd spring-boot:run` | `services/product-service` |
| Order service | `.\mvnw.cmd spring-boot:run` | `services/order-service` |
| Payment service | `.\mvnw.cmd spring-boot:run` | `services/payment-service` |
| Inventory service | `dotnet run --urls http://localhost:5050` | `services/inventory-service` |
| Analysis engine (with tracing) | `npm.cmd start` | `analysis-engine` |
| Analysis engine (as script does it) | `node src/server.js` | `analysis-engine` |
| Dashboard | `npm.cmd run dev -- --host --port 3000` | `dashboard` |
| Dashboard build | `npm.cmd run build` | `dashboard` |
| C++ core | `cmake -B build -S .` then `cmake --build build --config Release` | `cpp-core` |

The documented `npm.cmd start` loads `src/tracer.js`; `start-all.ps1` invokes `node src/server.js`
directly, so the analysis engine does **not** export OTel telemetry under the normal startup script.

### 5.4 Access points

- Dashboard: <http://localhost:3000>
- Analysis API: <http://localhost:5000/api/analysis>
- Health: `/health/live` and `/health/ready` on each service (inventory also exposes `/health`)
- Metrics: `/actuator/prometheus` on Java services; `/metrics` on inventory and analysis
- Fault controls: `POST/GET /api/payments/fault` and `POST/GET /api/inventory/fault`

### 5.5 Data locations

| Data | Default path |
|---|---|
| SQLite databases | `%LOCALAPPDATA%\CausalOTel\data\{user,product,order,payment,inventory}.db` |
| Bootstrap token file | `%LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token` |
| Incident spool | `%LOCALAPPDATA%\CausalOTel\spool\incidents` |
| Tempo data/WAL | Hardcoded to `C:/Users/prath/AppData/Local/CausalOTel/tempo-{data,wal}` in `observability/tempo.yaml` |

The Tempo paths are machine-specific and will not work on another checkout or user.

## 6. Test and build baseline

### 6.1 Important isolation warning

`scripts/test-all.ps1` runs the suites **without changing `LOCALAPPDATA` or supplying test database
paths**. The Spring tests therefore use the same `%LOCALAPPDATA%\CausalOTel\data\*.db` files as the
running services. In particular, `UserBootstrapTest` executes `DELETE FROM users` and
`DELETE FROM bootstrap_tokens` against the live user database. This is a data-destruction hazard and
a reproducibility defect (AUDIT_REPORT H-15). Do not run `test-all.ps1` on a database you care about.

For the audit, tests were run with an isolated `LOCALAPPDATA` and a pre-created data directory:

```powershell
$env:LOCALAPPDATA = 'C:\Users\prath\AppData\Local\Temp\causalotel-audit-tests\run'
New-Item -ItemType Directory -Force -Path "$env:LOCALAPPDATA\CausalOTel\data"
.\mvnw.cmd -B -ntp test
```

Flyway fails if the parent database directory does not exist, so the directory must be created
first. Logs are in `C:\Users\prath\AppData\Local\Temp\causalotel-audit-tests\`.

### 6.2 Results actually executed

| Suite | Command | Result | Notes |
|---|---|---:|---|
| User | `mvnw.cmd -B -ntp test` | **8/8 pass** | Clean isolated run after pre-creating the data directory. An initial run failed because the directory was absent. |
| Product | `mvnw.cmd -B -ntp test` | **7/7 pass** | Clean isolated run. |
| Payment | `mvnw.cmd -B -ntp test` | **19/19 pass** | 13 service tests + 6 simulation-safety tests. |
| Order | `mvnw.cmd -B -ntp test` | **16/16 pass** | Clean isolated run. A later rerun without `clean` failed `testScenario9...:390` with `SQLITE_CONSTRAINT_UNIQUE` on `orders.order_id`; attributed to stale `target/test-classes`, not a clean-HEAD source failure. |
| Inventory | `dotnet test` | **11/11 pass** | Uses a per-test temporary SQLite file. |
| Analysis | `npm.cmd test` | **22/22 pass** | 5 suites. The RCA test intentionally exercises the synthetic Tempo fallback. |
| Dashboard | `npm.cmd run build` | **Success** | 1,672 modules, 6.59 s, bundle in `dashboard/dist`. |
| C++ core | CMake build | **Not run** | CMake is not installed. Native path is `UNVERIFIED`; JS fallback is used. |

No JUnit, xUnit, or `node:test` suite currently tests the frontend fault console, the RCA
frontend/backend contract, spool path traversal, fault endpoint authorization, or real Tempo/
Prometheus integration. Test counts are therefore not evidence that those paths work.

### 6.3 Static and build caveats

- Tests are narrow, mock-heavy, and in several cases validate the fallback/fabrication path rather
  than real integration.
- `analysis-engine/test/rca.test.js` instantiates `TempoClient` without a running Tempo, so the
  "pinpoints failing service" assertion passes against the synthetic trace.
- `IncidentStore` is tested only through its in-memory `Map`; the broken spool integration is not
  exercised.
- The user list test runs with an empty table, so it never reaches the UUID-as-integer mapping.
- The order rerun failure is a test-hygiene/reproducibility issue; a clean isolated run passed all
  16 tests.

## 7. Runtime baseline observed during audit

### 7.1 Listening ports

| Port | Process | State |
|---:|---|---|
| 3000 | Vite dashboard | Listening, `GET /` → 200 |
| 5000 | Analysis engine | Listening, `/health/live` → 200, `/health/ready` → **503** |
| 5050 | Inventory service | Listening, `/health/live` → 200 |
| 8081 | User service | Listening, `/health/live` → 200 |
| 8082 | Product service | Listening, `/health/live` → 200 |
| 8083 | Order service | Listening, `/health/live` → 200 |
| 8084 | Payment service | Listening, `/health/live` → 200 |
| 4317/4318 | OTel Collector | **Closed** |
| 4320 | Tempo OTLP | **Closed** |
| 8889 | Collector Prometheus exporter | **Closed** |
| 9090 | Prometheus | **Closed** |
| 3200 | Tempo HTTP | **Closed** |

### 7.2 Probe results

| Probe | Observed |
|---|---|
| `GET /api/users` | `200 []` |
| `GET /api/analysis/incidents` | `200 []` |
| `GET /api/analysis/graph` | `200`, 7 static nodes / 8 static edges, `hasCycle=false` |
| `GET /api/analysis/metrics` | `200`, JSON **object** keyed by service, values random/hardcoded |
| `GET /api/payments/fault` | `NORMAL`, `latencyMs=0` |
| `GET /api/inventory/fault` | all false, `latencyMs=0` |
| `GET /api/orders` | 25 rows: 16 `CONFIRMED`, 8 `CANCELLED`, 1 `PENDING_RECONCILIATION` |
| `GET /api/payments` | 19 rows |
| `GET /api/inventory` | 4 SKUs; laptop available 44, reserved 0 |

The order database includes historical test rows such as `ord-crash-999` (user 999, status
`CONFIRMED`). These rows are **not fixtures** and must not be treated as evidence of a successful
production flow. They are remnants of running the non-isolated tests.

## 8. Capability status

Labels: **IMPLEMENTED**, **VERIFIED**, **PARTIALLY IMPLEMENTED**, **PLANNED**, **UNVERIFIED**.

| Capability | Status | Evidence / caveat |
|---|---|---|
| User bootstrap + BCrypt admin creation | IMPLEMENTED | Token lockout/consumption logic is real; user read path is broken for UUID rows (M-04). |
| Product catalog and seed data | IMPLEMENTED / VERIFIED | SQLite + Flyway; read-only endpoints; 7 tests pass. |
| Checkout saga happy path | IMPLEMENTED / VERIFIED | Manual runtime and 16 order tests (clean isolated run). |
| Payment charge/refund/idempotency | IMPLEMENTED / VERIFIED | 19 tests pass; in-process locks only. |
| Inventory reserve/commit/release | IMPLEMENTED | 11 tests pass; reservation race and partial-idempotency gaps (H-04/H-05). |
| Compensation and reconciliation | PARTIALLY IMPLEMENTED | Outbox and stale-saga recovery exist but have race/backoff defects (H-06/H-07/M-01). |
| Public API authentication/authorization | PLANNED | No auth on business or fault endpoints (H-01/H-02). |
| OTel tracing from services | PARTIALLY IMPLEMENTED | SDK/exporter config present; collector/Tempo absent; analysis started without tracer by script. |
| Tempo-backed real trace analysis | PLANNED | Tempo closed; analysis fabricates traces on failure (C-03). |
| Prometheus-backed metrics | PLANNED | Prometheus closed; analysis returns random/hardcoded values (H-10). |
| Incident persistence | PARTIALLY IMPLEMENTED | In-memory Map plus broken spool call; MongoDB unused (H-11). |
| Tarjan SCC graph algorithm | IMPLEMENTED / VERIFIED | Unit tests pass; `/api/analysis/graph` is a static topology (M-05). |
| Sweep-line self-time (native) | UNVERIFIED | C++ source present; no binary; CMake absent; JS fallback verified. |
| Sweep-line self-time (JS fallback) | IMPLEMENTED / VERIFIED | 8 sweep-line tests pass. |
| RCA heuristic scoring | PARTIALLY IMPLEMENTED | Heuristic exists; tests validate synthetic fallback, not real traces. |
| Dashboard RCA/incidents | PARTIALLY IMPLEMENTED | Real API calls exist, but contracts mismatch and fallbacks fabricate data (H-12/H-14). |
| Dashboard traces | PARTIALLY IMPLEMENTED | UI exists; `Traces.jsx` and `TraceDetail.jsx` render hardcoded spans (H-14). |
| Fault injection UI | PARTIALLY IMPLEMENTED | Backend endpoints exist; frontend sends wrong payloads (H-13). |
| C++ core | UNVERIFIED | Source present; no binary; no CMake in environment. |
| MongoDB persistence | PLANNED | Mongoose connection only; no schema/model/write path. |
| Observability deployment | PLANNED | Configs exist; no compose/manifest and no running processes (C-04). |

## 9. Known gaps (summary)

| Area | Main gaps | Audit IDs |
|---|---|---|
| Security | Spool path traversal; unauthenticated fault and business APIs | C-01, H-01, H-02 |
| Financial/data integrity | Client-controlled prices; weak/partial idempotency; inventory races; outbox errors swallowed | C-02, H-03, H-04, H-05, H-06 |
| Recovery/availability | Stale-saga race; DB transaction across HTTP; no downstream timeouts | H-07, H-08, H-09 |
| RCA integrity | Synthetic traces; random metrics; broken incident persistence; static graph | C-03, H-10, H-11, M-05 |
| Frontend correctness | RCA contract mismatch; wrong fault payloads; mock/fallback data | H-12, H-13, H-14, M-07, M-08, L-03 |
| Operations/testing | Non-isolated tests against live DB; stale artifacts; false-success build; analysis not started with tracer | H-15, M-09, M-10 |
| Documentation | README and demo script overclaim production/live behavior | M-11 |
| Unverified native path | C++ core not built | L-04 |

## 10. Audit constraints and change policy

- This audit was **read-only**. No source, test, schema, migration, script, or runtime configuration
  was modified.
- The three Markdown files (`AUDIT_REPORT.md`, `ARCHITECTURE.md`, `PROJECT_CONTEXT.md`) are the only
  new files created.
- No commits or pushes were made.
- Running services were not stopped or restarted. Live GET probes were used; destructive payment,
  inventory, and fault-injection POSTs were avoided.
- Findings that require mutation to prove are marked **source-confirmed** with the code path and a
  safe reproduction recipe.
- File/line references are relative to commit `a10bf0b`. They will drift after fixes.
- Tests were run against an isolated `LOCALAPPDATA`; the live databases were not used for test
  execution.
- Historical rows in the live databases (including `ord-crash-999`) are test residue, not fixtures.

## 11. Recommended next steps

Do not implement fixes until the owner explicitly authorizes `FIX`. When authorized, the recommended
order is:

1. **P0 — stop exploitable/integrity failures:** sanitize spool filenames (C-01); authenticate or
   bind fault endpoints to localhost (H-01); derive prices server-side (C-02); remove synthetic
   trace/metric fallbacks from the RCA response or label them explicitly (C-03/H-10).
2. **P1 — make the saga correct under failure:** fix idempotency hashing/recording (H-03), inventory
   reservation atomicity (H-04/H-05), outbox persistence/backoff (H-06/M-01), stale-saga recovery
   (H-07), expiry-worker transaction scope (H-08), and HTTP timeouts (H-09).
3. **P2 — repair the user-facing contract:** align RCA/incident JSON with the dashboard (H-12),
   send correctly shaped fault payloads (H-13), and remove fabricated fallbacks (H-14).
4. **P3 — make it reproducible and honest:** isolate tests (H-15), fix startup/build scripts
   (M-09/M-10), start the observability stack, replace hardcoded Tempo paths, and update README/demo
   claims (M-11).
5. **P4 — verify the native path:** install CMake, build `sweep_line`, and run parity tests against
   the JS fallback (L-04).

Each fix should land with the regression test named in `AUDIT_REPORT.md`.

## 12. Glossary

| Term | Meaning |
|---|---|
| Saga | Multi-step checkout transaction with compensation (reserve → charge → commit). |
| Outbox | Durable task table used to retry downstream work after a failure. |
| Self-time | Span duration minus the union of its children's intervals. |
| Sweep-line interval union | Merge overlapping child intervals in `O(N log N)` to avoid double subtraction. |
| Tarjan SCC | Strongly connected components algorithm used to detect dependency cycles. |
| RCA | Root cause analysis: rank services/spans by suspiciousness and emit evidence. |
| Synthetic fallback | Fabricated trace/metric data returned when a telemetry backend is unavailable. |
| `LOCALAPPDATA` isolation | Pointing test runs at a temporary data directory so live SQLite files are untouched. |
