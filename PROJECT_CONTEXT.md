# PROJECT_CONTEXT — CausalOTel

> **Current state after remediation (2026-11-13).** The original audit baseline was commit
> `a10bf0ba238ccc038901f9c772c3958b956fa015` (2026-11-11). All 34 audit findings were
> remediated except **L-04**, which is **BLOCKED** by the absence of CMake/C++ tooling.
> See [`AUDIT_REPORT.md`](AUDIT_REPORT.md) §10 for per-finding status and evidence, and
> [`ARCHITECTURE.md`](ARCHITECTURE.md) for the current topology.

## 1. Metadata

| Item | Value |
|---|---|
| Repository | `C:\Users\prath\OneDrive\Desktop\CausalOTel` |
| Branch | `feature/complete-causalotel` |
| Audit baseline | `a10bf0ba238ccc038901f9c772c3958b956fa015` (2026-11-11) |
| Remediation date | 2026-11-13 |
| Runtime | Dashboard `:3000`; user `:8081`; product `:8082`; order `:8083`; payment `:8084`; inventory `:5050`; analysis `:5000` |
| Telemetry | OTel Collector `4317/4318/8889/13133`; Tempo `3200/4320`; Prometheus `9090` |
| Persistence | SQLite per business service; durable disk incident spool; no MongoDB dependency |

## 2. Purpose

CausalOTel is a local, polyglot demonstration of an e-commerce checkout flow with a
root-cause-analysis (RCA) dashboard attached:

- Five business services model users, products, orders, payments, and inventory.
- The order service implements a saga: reserve inventory, charge payment, commit inventory, with
  compensation, leases, an outbox, and reconciliation.
- Java services and the analysis engine emit OpenTelemetry traces to a native Collector/Tempo stack.
- Prometheus scrapes real service metrics.
- The analysis engine reads traces from Tempo, computes span self-time with a sweep-line
  interval-union algorithm, derives a service graph from parent/child spans, and ranks a likely
  culprit with evidence.
- The React dashboard displays authenticated topology, traces, metrics, incidents, and RCA evidence.

The product is a **verified local demo**, not a production service. Payment processing is simulated
and profile-gated. See §10 for limitations.

## 3. Technology stack

| Layer | Technology | Version observed |
|---|---|---|
| Java services | Java / Spring Boot 4.0.0, Maven Wrapper | Java `25.0.5`; Spring Boot `4.0.0` |
| .NET service | ASP.NET Core, EF Core, SQLite, OpenTelemetry | .NET SDK `10.0.404` |
| Analysis engine | Node.js, Express 5, prom-client | Node `v26.13.0` |
| Dashboard | React 19, React Router 7, Vite 6, Tailwind 4, Axios | Vite `6.4.6`; React `^19.0.0` |
| Databases | SQLite (WAL mode) per service | Files under `%LOCALAPPDATA%\CausalOTel\data` |
| Native core | C++20, CMake | Source present; **CMake/compiler absent**; binary not built |
| Observability | otelcol-contrib, Tempo, Prometheus | `0.165.0`, `3.1.1`, `3.16.0` |
| Scripting | Windows PowerShell 5.1 | Windows host |
| Test runners | JUnit 5 / Mockito, xUnit, `node:test`, Vite build | See §7 |

## 4. Repository map

```
CausalOTel/
├─ services/
│  ├─ user-service/        Java, :8081, user.db, auth + bootstrap
│  ├─ product-service/     Java, :8082, product.db, catalog
│  ├─ order-service/       Java, :8083, order.db, saga + outbox
│  ├─ payment-service/     Java, :8084, payment.db, simulated gateway
│  └─ inventory-service/   .NET, :5050, inventory.db, reservation state machine
├─ analysis-engine/        Node, :5000, Tempo/Prometheus clients, RCA, graph, spool
├─ dashboard/              React/Vite, :3000, authenticated operator UI
├─ cpp-core/               C++20 sweep-line source (unbuilt; JS fallback active)
├─ observability/          Collector, Prometheus, Tempo configs
├─ scripts/                install/start/stop/verify/build/test/demo PowerShell scripts
├─ tools/observability/    Downloaded native binaries (gitignored)
├─ logs/                   Runtime logs (ignored)
├─ README.md               Honest project overview and quick start
├─ ARCHITECTURE.md         Current architecture
├─ PROJECT_CONTEXT.md      This file
└─ AUDIT_REPORT.md         Original findings + final remediation status
```

## 5. Runbook

### 5.1 Prerequisites

- Windows with PowerShell 5.1 or newer.
- Java 25 and the Maven Wrapper in each Java service.
- .NET 10 SDK on `PATH` (scripts prepend `C:\Program Files\dotnet` if present).
- Node.js 26 with `npm.cmd` (use `npm.cmd`; `npm.ps1` may be blocked by execution policy).
- Optional: CMake + a C++20 compiler for `cpp-core`.
- Free ports: `3000`, `5000`, `5050`, `8081`–`8084`, `3200`, `4317`, `4318`, `4320`, `8889`,
  `9090`, `13133`.

### 5.2 Start and stop the application

```powershell
.\scripts\install-observability.ps1   # one-time download + SHA-256 verification
.\scripts\build-all.ps1               # build and test everything (services must be stopped)
.\scripts\start-all.ps1               # observability + seven app processes
.\scripts\verify-observability.ps1    # OTLP -> Tempo -> analysis + Prometheus smoke test
.\scripts\demo-checkout-rca.ps1       # authenticated checkout/fault/recovery/RCA demo
.\scripts\stop-all.ps1                # stop app + observability processes
```

`start-all.ps1`:

- refuses to launch over an existing mesh or an occupied port;
- rebuilds stale Java/.NET artifacts before launch;
- starts the native observability stack and waits for readiness;
- starts the analysis engine through `npm.cmd start`, which loads `src/tracer.js`;
- exits nonzero if any component never becomes ready;
- writes PIDs only after every launch succeeds.

### 5.3 Direct development commands

| Component | Command | Working directory |
|---|---|---|
| User service | `.\mvnw.cmd spring-boot:run` | `services/user-service` |
| Product service | `.\mvnw.cmd spring-boot:run` | `services/product-service` |
| Order service | `.\mvnw.cmd spring-boot:run` | `services/order-service` |
| Payment service | `.\mvnw.cmd spring-boot:run` | `services/payment-service` |
| Inventory service | `dotnet run --urls http://localhost:5050` | `services/inventory-service` |
| Analysis engine (with tracing) | `npm.cmd start` | `analysis-engine` |
| Analysis tests | `npm.cmd test` | `analysis-engine` |
| Dashboard | `npm.cmd run dev -- --host --port 3000` | `dashboard` |
| Dashboard tests | `npm.cmd test` | `dashboard` |
| Dashboard build | `npm.cmd run build` | `dashboard` |
| C++ core (optional) | `cmake -S cpp-core -B cpp-core/build` then `cmake --build cpp-core/build --config Release` | repository root |

### 5.4 Access points

- Dashboard: <http://localhost:3000>
- Analysis API: <http://localhost:5000/api/analysis>
- Health: `/health/live` on every service; `/health/ready` on analysis-engine
- Metrics: `/actuator/prometheus` on Java services; `/metrics` on inventory and analysis
- Fault controls: `POST/GET /api/payments/fault` and `POST/GET /api/inventory/fault` (admin only)
- Tempo: <http://localhost:3200>
- Prometheus: <http://localhost:9090>
- Collector health: <http://localhost:13133>

### 5.5 Data locations

| Data | Default path |
|---|---|
| SQLite databases | `%LOCALAPPDATA%\CausalOTel\data\{user,product,order,payment,inventory}.db` |
| Bootstrap token file | `%LOCALAPPDATA%\CausalOTel\security\.bootstrap_admin_token` |
| Demo admin credentials | `%LOCALAPPDATA%\CausalOTel\demo\admin-credentials.json` (never commit) |
| Incident spool | `%LOCALAPPDATA%\CausalOTel\spool\incidents` |
| Tempo data | `%LOCALAPPDATA%\CausalOTel\tempo` (rendered from `CAUSALOTEL_DATA_ROOT`) |
| Observability binaries | `tools\observability` (gitignored) |

### 5.6 Authentication

All business APIs require a signed bearer token. Roles are `ROLE_USER`, `ROLE_ADMIN`, and
`ROLE_SERVICE`. Registration always creates `ROLE_USER`. The first admin is provisioned from the
one-time bootstrap token file via the dashboard login page or `POST /api/users/bootstrap-admin`.
An expired, unconsumed token is regenerated on user-service startup. The demo script writes its
generated admin credentials outside the repository.

## 6. Test isolation

`scripts/test-all.ps1` is the authoritative isolated runner:

- redirects `LOCALAPPDATA` to a fresh temp directory;
- creates a temp `CausalOTel\data` and spool directory;
- supplies an explicit temporary `SQLITE_DB_PATH` to each SQLite-backed suite;
- fingerprints the live databases and live incident spool before and after;
- exits nonzero if any suite fails or any live artifact changes.

Java tests additionally use `@DynamicPropertySource` plus per-service test-resource fallbacks under
`java.io.tmpdir`. Destructive cleanup guards reject non-temp or live paths. Analysis-engine tests
run with `--import ./test/setup-env.js`, which creates an isolated temp spool root.

For clean integrity evidence, stop the mesh before running `test-all.ps1`; live services hold
SQLite files open and write to them continuously.

## 7. Test and build baseline

| Suite | Command | Latest result |
|---|---|---|
| User | `.\mvnw.cmd test` | PASS |
| Product | `.\mvnw.cmd test` | PASS |
| Order | `.\mvnw.cmd test` | PASS — 45 tests |
| Payment | `.\mvnw.cmd test` | PASS — 34 tests |
| Inventory | `dotnet test` | PASS — 21 tests |
| Analysis | `npm.cmd test` | PASS — 73 tests |
| Dashboard contracts | `npm.cmd test` | PASS — 27 tests |
| Dashboard build | `npm.cmd run build` | PASS |
| C++ core | CMake build | **SKIP** — CMake/compiler absent |

`build-all.ps1` runs the suites plus dashboard production build and exits nonzero on any failure.
`test-all.ps1` runs the seven isolated suites and prints live-database/spool integrity.

## 8. Runtime and integration evidence

| Check | Observed |
|---|---|
| All seven application services | `/health/live` 200; analysis `/health/ready` 200 with `store: disk-spool` |
| OTel Collector / Tempo / Prometheus | Running; `verify-observability.ps1` PASS |
| Real trace flow | Trace `4bdd7f97948770cc004dbefe10a04bed` stored in Tempo; root `order-service http post /api/orders/checkout`; spans from `order-service`, `payment-service`, `product-service` |
| RCA incident | `POST /api/analysis/analyze-trace` returned `persisted: true`; incident `inc-4bdd7f979487` readable and references the real trace |
| Metrics API | `source: prometheus`; real service metrics for all six metric-emitting services |
| Graph API | `source: tempo`; 20 traces, 5 nodes, 2 real edges; `failedTraceCount=0`, `degraded=false`; window/cache/health metadata |
| Checkout demo | `demo-checkout-rca.ps1` 60/60 checks; fault 504, `PENDING_RECONCILIATION`, `RECONCILIATION_REQUIRED`, `RECONCILE_PAYMENT` pending, inventory preserved, reconcile to `CONFIRMED` |
| Payment safety | Simulation disabled by default; explicit demo/test profile required; `503` when disabled |
| Test isolation | 7/7 suites PASS; live DBs and spool `UNCHANGED` |

## 9. Capability status

Labels: **IMPLEMENTED / VERIFIED**, **PARTIALLY IMPLEMENTED**, **BLOCKED**.

| Capability | Status | Evidence / caveat |
|---|---|---|
| User bootstrap + auth | IMPLEMENTED / VERIFIED | Signed tokens, roles, one-time admin, expired-token regeneration |
| User read API | IMPLEMENTED / VERIFIED | UUID `TEXT` end to end |
| Product catalog | IMPLEMENTED / VERIFIED | Authenticated reads, authoritative prices |
| Checkout saga happy path | IMPLEMENTED / VERIFIED | Server pricing, canonical idempotency, transactional persistence |
| Payment charge/refund/idempotency | IMPLEMENTED / VERIFIED | Striped locks, simulation gating |
| Inventory reserve/commit/release | IMPLEMENTED / VERIFIED | Unique `(OrderId, Sku)`, request hash, state machine |
| Compensation and reconciliation | IMPLEMENTED / VERIFIED | Leases, backoff, refund escalation, late-commit handling |
| Public API authentication/authorization | IMPLEMENTED / VERIFIED | All business/fault APIs |
| OTel tracing from services | IMPLEMENTED / VERIFIED | Java + analysis; inventory metrics/health only |
| Tempo-backed real trace analysis | IMPLEMENTED / VERIFIED | Real spans; typed errors; no synthetic fallback |
| Prometheus-backed metrics | IMPLEMENTED / VERIFIED | Real PromQL; typed 503 on outage |
| Incident persistence | IMPLEMENTED / VERIFIED | Durable disk spool; restart hydration |
| Tarjan SCC graph algorithm | IMPLEMENTED / VERIFIED | Unit tests |
| Runtime graph endpoint | IMPLEMENTED / VERIFIED | Tempo-derived; `rootName` TraceQL filter plus defensive check; bounded concurrency |
| Sweep-line self-time (native) | **BLOCKED** | C++ source present; no compiler; JS fallback verified |
| Sweep-line self-time (JS fallback) | IMPLEMENTED / VERIFIED | Sweep-line tests |
| RCA heuristic scoring | IMPLEMENTED / VERIFIED | Real traces only; synthetic rejected |
| Dashboard RCA/incidents | IMPLEMENTED / VERIFIED | Real contracts; no mock fallback |
| Dashboard traces | IMPLEMENTED / VERIFIED | Real Tempo data |
| Fault injection UI | IMPLEMENTED / VERIFIED | Exact backend payloads; admin only |
| Observability deployment | IMPLEMENTED / VERIFIED | Native pinned stack; verified end to end |
| MongoDB persistence | NOT USED | Removed from readiness/storage path |

## 10. Known limitations

| Area | Limitation |
|---|---|
| Deployment | Local demo only; SQLite, local processes, no TLS, no horizontal scaling, no secrets manager |
| Payments | Simulated; no real transactions; profile-gated and off by default |
| Native core | L-04 blocked; JS fallback active; explicit `NOT BUILT` status |
| Tracing coverage | Inventory does not emit OTLP spans in this build; it is visible to Prometheus and health probes |
| Data | Long-lived local databases may contain historical rows from earlier runs; not fixtures |
| Dashboard | Operator demo, not a hardened multi-tenant console |
| Analysis engine | Single process; local cache; disk spool is the durable source of truth |

## 11. Change policy

- Work on `feature/complete-causalotel`; do not modify, merge, or push `main`.
- Do not force-push or rewrite history.
- Do not commit secrets, credentials, or personal data. Demo credentials stay under
  `%LOCALAPPDATA%`.
- Do not introduce Docker, Kubernetes, WSL2, Redis, Kafka, RabbitMQ, or TypeScript.
- Do not fabricate traces, metrics, incidents, or RCA results. Show explicit unavailable/degraded
  states.
- Every fix must land with a regression test and updated documentation.
- Payment must remain simulated; no real transactions.

## 12. Glossary

| Term | Meaning |
|---|---|
| Saga | Multi-step checkout transaction with compensation (reserve → charge → commit). |
| Outbox | Durable task table used to retry downstream work after a failure. |
| Self-time | Span duration minus the union of its children's intervals. |
| Sweep-line interval union | Merge overlapping child intervals in `O(N log N)` to avoid double subtraction. |
| Tarjan SCC | Strongly connected components algorithm used to detect dependency cycles. |
| RCA | Root cause analysis: rank services/spans by suspiciousness and emit evidence. |
| Synthetic fallback | Fabricated trace/metric data. Removed from the real path; demo fixtures are opt-in only. |
