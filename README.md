# CausalOTel
### *Distributed Microservices Root Cause Analysis Platform*

[![Architecture](https://img.shields.io/badge/Architecture-Distributed%20Microservices-blue.svg)](#architecture)
[![Observability](https://img.shields.io/badge/Telemetry-OpenTelemetry%20%7C%20Tempo%20%7C%20Prometheus-orange.svg)](#observability-pipeline)
[![Backend](https://img.shields.io/badge/Backend-Java%2025%20Spring%20Boot%20%7C%20.NET%2010%20LTS-green.svg)](#microservices-architecture)
[![Algorithm](https://img.shields.io/badge/Core%20Algorithm-C%2B%2B20%20Sweep--Line%20Interval%20Union-red.svg)](#self-time-calculation--the-sweep-line-algorithm)
[![Frontend](https://img.shields.io/badge/Frontend-React%20%7C%20Tailwind%20CSS%20%7C%20Vite-cyan.svg)](#frontend-dashboard)

---

## Executive Overview

**CausalOTel** is a production-grade distributed microservices observability and deterministic root cause analysis (RCA) platform. Modern distributed systems fail in cascading, non-linear ways: a slow downstream database query or network partition in a leaf microservice propagates latency and timeouts upstream, causing orchestrators to appear degraded while hiding the true point of failure.

CausalOTel solves this by collecting standardized **OpenTelemetry** traces across a polyglot microservices estate (Java Spring Boot and ASP.NET Core), modeling runtime service communication as dynamic dependency graphs, and utilizing a **C++20 Sweep-Line Interval Union engine** to compute mathematically exact **Self-Time** across overlapping parallel child spans. 

---

## High-Level System Architecture

```
                                  [ REACT DASHBOARD ] (Vite + Tailwind CSS - Port 3000)
                                           │
                                           ▼ (Axios REST API)
                             [ CAUSAL-OTEL ANALYSIS ENGINE ] (Port 5000)
                                 ├── C++20 DSA Native Kernel (Sweep-Line Interval Union Daemon)
                                 ├── Graph Engine (Tarjan's SCC Cycle Detection & Condensed DAG)
                                 └── Evidence & Suspiciousness Ranking Generator
                                           ▲
                     ┌─────────────────────┴─────────────────────┐
                     │                                           │
          [ Prometheus (Metrics) ]                     [ Tempo / OTLP Collector ]
                     ▲                                           ▲
                     │ (Scrapes Metrics)                         │ (Exports OTLP Traces)
  ═══════════════════╪═══════════════════════════════════════════╪══════════════════════════════
                     │          E-COMMERCE MICROSERVICES         │
                     │                                           │
        ┌────────────┴─────────────┐                ┌────────────┴────────────┐
        │   User Service (Java)    │                │  Product Service (Java) │
        │  Spring Boot - Port 8081 │                │ Spring Boot - Port 8082 │
        └────────────▲─────────────┘                └────────────▲────────────┘
                     │                                           │
                     │ (REST / W3C traceparent)                  │ (REST / W3C traceparent)
                     │                                           │
        ┌────────────┴───────────────────────────────────────────┴────────────┐
        │                     Order Service (Java)                            │
        │                   Spring Boot - Port 8083                           │
        └────────────────────┬───────────────────────────────────┬────────────┘
                             │                                   │
   (REST / W3C traceparent)  │         (Polyglot REST Boundary)  │ (REST / W3C traceparent)
                             ▼                                   ▼
        ┌──────────────────────────┐                ┌─────────────────────────┐
        │   Payment Service (Java) │                │ Inventory Service (.NET)│
        │  Spring Boot - Port 8084 │                │  ASP.NET Core - Port 5050│
        └──────────────────────────┘                └─────────────────────────┘
```

---

## Polyglot Microservices Suite

The target application models an enterprise e-commerce system with clear domain boundaries:

| Microservice | Technology Stack | Port | Primary Responsibility |
|---|---|:---:|---|
| **User Service** | Java 25 / Spring Boot 4.0 | `8081` | User profile verification, authentication context, loyalty tier metadata. |
| **Product Service** | Java 25 / Spring Boot 4.0 | `8082` | Product catalog, pricing validation, stock availability metadata. |
| **Order Service** | Java 25 / Spring Boot 4.0 | `8083` | Saga orchestrator coordinating the checkout transaction lifecycle. |
| **Payment Service** | Java 25 / Spring Boot 4.0 | `8084` | Payment transaction processing and simulated third-party gateway latency. |
| **Inventory Service** | C# / ASP.NET Core 10 LTS | `5050` | Warehouse stock reservation and compensatory release via Polly resilience policies. |

### Cross-Runtime Context Propagation
Distributed tracing across the Java and .NET boundary is maintained via the **W3C Trace Context specification (`traceparent`)**:
```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```
When Order Service (Java) issues an HTTP request to Inventory Service (.NET), the trace context is transparently injected by the OpenTelemetry Java Agent and extracted by the ASP.NET Core OpenTelemetry SDK, forming an unbroken trace hierarchy.

---

## CDAC Curriculum: 7-Subject Demonstration Matrix

Every core CDAC subject has an architectural, demonstrable responsibility in CausalOTel:

| # | CDAC Subject | Concrete Implementation Feature |
|---|---|---|
| **1** | **C++ Programming** | `cpp-core/`: Standalone C++20 high-performance engine executing the Sweep-Line Interval Union algorithm. Runs as a persistent daemon with NDJSON communication and benchmark comparison. |
| **2** | **Data Structures & Algorithms (DSA)** | Directed Acyclic Graph (DAG) construction, Tarjan's Strongly Connected Components (SCC) for cycle condensation, $O(N \log N)$ Sweep-Line Interval Union, Priority Queues for Top-$K$ ranking. |
| **3** | **Database Technologies** | **Dual Database Pattern**: Relational SQL (H2/PostgreSQL) for transactional ACID guarantees in Order, Payment, and Inventory services; Document MongoDB for schema-free polymorphic incident reports and baseline telemetry. |
| **4** | **Web Programming Technologies** | `dashboard/`: Full-stack interactive dashboard built with React, Vite, Tailwind CSS, React Router, and Axios. Gantt-style trace waterfalls and dynamic SVG/Canvas dependency graphs. |
| **5** | **Java Programming** | Concurrency with `CompletableFuture.allOf()` for parallel downstream fan-out, Java 8+ Streams API, custom domain exception hierarchy, and clean OOP principles. |
| **6** | **Spring Boot** | Core microservices: Layered architecture (`Controller` $\to$ `Service` $\to$ `Repository`), Dependency Injection, Bean Validation (`@Valid`), Spring Boot Actuator, and OpenTelemetry auto-instrumentation. |
| **7** | **.NET** | `services/inventory-service/`: ASP.NET Core 10 LTS Web API, native Dependency Injection (`IServiceCollection`), Polly resilience policies, and native `OpenTelemetry.Extensions.Hosting`. |

---

## Self-Time Calculation & The Sweep-Line Algorithm

A core flaw of naive observability tools is calculating a parent span's self-time by subtracting the simple sum of child durations:
$$\text{Naive Self-Time} = \text{Duration}(P) - \sum_{i} \text{Duration}(c_i) \quad \text{\textbf{(INCORRECT for Parallel Calls)}}$$

When downstream calls execute concurrently, simple addition causes overlapping intervals to be subtracted multiple times, resulting in false zero or negative self-times.

### The CausalOTel Solution
1. **Clipping**: Each direct child span interval $[s_{c_i}, e_{c_i}]$ is clipped to the parent span's active lifetime $[s_P, e_P]$:
   $$s'_i = \max(s_{c_i}, s_P), \quad e'_i = \min(e_{c_i}, e_P)$$
2. **Sweep-Line Interval Union**: Clipped intervals are sorted by start time and merged into disjoint continuous intervals $\mathcal{U} = \bigcup [s'_j, e'_j]$ in $O(N \log N)$ time.
3. **Exact Self-Time**:
   $$\text{SelfTime}(P) = \text{Duration}(P) - \sum_{j} (e'_j - s'_j)$$

---

## Deterministic Root Cause Analysis Formula

CausalOTel avoids "black-box AI" and uses an evidence-based, deterministic suspiciousness score $\mathcal{S}(v) \in [0, 100]$:

$$\mathcal{S}(v) = 0.35 \cdot \mathcal{A}_{\text{dev}}(v) + 0.30 \cdot \mathcal{C}_{\text{contrib}}(v) + 0.25 \cdot \mathcal{E}_{\text{origin}}(v) + 0.10 \cdot \mathcal{K}_{\text{critical}}(v)$$

* **$\mathcal{A}_{\text{dev}}(v)$ (Baseline Z-Score Deviation)**: How many standard deviations service $v$'s self-time exceeded historical baseline ($\mu_{\text{self}}, \sigma_{\text{self}}$).
* **$\mathcal{C}_{\text{contrib}}(v)$ (Latency Spike Contribution)**: The fraction of the total trace delay explained by service $v$'s self-time.
* **$\mathcal{E}_{\text{origin}}(v)$ (Error Origination Factor)**: 100 if service $v$ is the origin point of an unhandled exception or 5xx, 20 if it merely cascaded an error from a child.
* **$\mathcal{K}_{\text{critical}}(v)$ (Critical Path Weight)**: Indicates whether service $v$'s execution delay held back the overall trace completion.

*All assessments are transparently labeled as **Heuristic Rule-Based** until calibrated against synthetic fault-injection datasets.*

---

## Repository Structure

```
CausalOTel/
├── .gitignore                              # Comprehensive multi-runtime gitignore
├── README.md                               # Architecture blueprint & documentation
│
├── services/                               # Polyglot E-Commerce Microservices
│   ├── user-service/                       # Java 25 / Spring Boot 4.0 (Port 8081)
│   ├── product-service/                    # Java 25 / Spring Boot 4.0 (Port 8082)
│   ├── order-service/                      # Java 25 / Spring Boot 4.0 (Port 8083) - Saga Orchestrator
│   ├── payment-service/                    # Java 25 / Spring Boot 4.0 (Port 8084)
│   └── inventory-service/                  # C# / ASP.NET Core 10 LTS (Port 5050)
│
├── cpp-core/                               # C++20 DSA Native Algorithm Kernel
│   ├── include/                            # Header-only interval union & graph logic
│   └── src/                                # Daemon CLI & performance benchmarks
│
├── analysis-engine/                        # Root Cause Analysis Platform (Port 5000)
│   └── src/                                # Telemetry ingestion, DAG analysis & MongoDB persistence
│
├── dashboard/                              # React + Vite + Tailwind CSS Dashboard (Port 3000)
│   └── src/                                # Interactive DAG, Gantt waterfalls & RCA evidence cards
│
├── observability/                          # Native Windows Observability Stack
│   ├── otel-collector-config.yaml          # OpenTelemetry Collector routing
│   ├── prometheus.yml                      # Metrics scraping rules
│   └── tempo.yaml                          # Distributed trace storage configuration
│
└── simulation/                             # Chaos Engineering & Evaluation Harness
    └── scenarios/                          # Controlled fault injection (latency, 503, timeouts)
```

---

## Development Roadmap

* [x] **Phase 0**: Architecture Review, CDAC Curriculum Mapping & Toolchain Audit.
* [x] **Phase 1**: GitHub Setup, Project Foundation & Repository Structure.
* [ ] **Phase 2**: Database Schema Design & Inter-Service API Contracts.
* [ ] **Phase 3**: Microservices Implementation (Spring Boot & ASP.NET Core 10).
* [ ] **Phase 4**: Inter-Service Communication & Saga Orchestration.
* [ ] **Phase 5**: OpenTelemetry Instrumentation & Distributed Tracing.
* [ ] **Phase 6**: Observability Infrastructure (Collector, Tempo, Prometheus).
* [ ] **Phase 7**: C++20 Core & DSA Algorithm Engine.
* [ ] **Phase 8**: Root Cause Analysis Engine & Baseline Persistence.
* [ ] **Phase 9**: React Observability Dashboard.
* [ ] **Phase 10**: Chaos Simulation, Precision/Recall Benchmarks & Documentation.

---

## Author & Project Metadata

* **Author**: Prathamesh Jadhav
* **Email**: `Prathamesh.jadhav.office@gmail.com`
* **GitHub Repository**: [Prathamesh-Jadhav04/CausalOTel](https://github.com/Prathamesh-Jadhav04/CausalOTel)
