/**
 * Heuristic Root Cause Analysis (RCA) Engine.
 * Analyzes distributed traces, self-time breakdown, error propagation, and metric correlations
 * to identify the primary root-cause service with confidence scoring and evidence chains.
 */

import { DependencyGraph } from './graph.js';

export class RcaEngine {
  constructor(tempoClient, prometheusClient) {
    this.tempoClient = tempoClient;
    this.prometheusClient = prometheusClient;
  }

  async analyzeTrace(traceId) {
    const trace = await this.tempoClient.fetchTrace(traceId);
    const metrics = await this.prometheusClient.getServiceMetrics();

    // 1. Build Dependency Graph from Spans
    const graph = new DependencyGraph();
    for (const span of trace.spans) {
      graph.addNode(span.serviceName);
      if (span.parentSpanId) {
        const parentSpan = trace.spans.find(s => s.spanId === span.parentSpanId);
        if (parentSpan && parentSpan.serviceName !== span.serviceName) {
          graph.addEdge(parentSpan.serviceName, span.serviceName);
        }
      }
    }

    const topoAnalysis = graph.toJSON();

    // 2. Score Candidates
    const candidates = [];

    for (const span of trace.spans) {
      let score = 0.0;
      const reasons = [];

      // A. Error Status Code Assessment (Weight: 0.40)
      const hasError = span.statusCode === 'ERROR' ||
                       span.attributes['http.status_code'] >= 500 ||
                       (span.statusMessage && span.statusMessage.toLowerCase().includes('error'));

      if (hasError) {
        score += 0.40;
        reasons.push(`Span returned status ERROR (${span.statusMessage || span.attributes['http.status_code'] || 'Unspecified Error'})`);
      }

      // B. Self-Time Anomaly Assessment (Weight: 0.35)
      const traceDuration = trace.spans[0]?.durationMs || 1;
      const selfRatio = span.selfTimeMs / Math.max(1, span.durationMs);

      if (span.selfTimeMs > 2000) {
        score += 0.35;
        reasons.push(`Extreme self-time anomaly: ${span.selfTimeMs.toFixed(0)}ms (${(selfRatio * 100).toFixed(1)}% of span duration)`);
      } else if (span.selfTimeMs > 500 && selfRatio > 0.6) {
        score += 0.25;
        reasons.push(`Significant internal latency: ${span.selfTimeMs.toFixed(0)}ms internal processing time`);
      }

      // C. Downstream Culprit Position (Weight: 0.15)
      // Deepest failing callee is prioritized over upstream orchestrators experiencing secondary failures
      const isLeafOrDeepCallee = span.children.length === 0 || span.children.every(c => c.statusCode !== 'ERROR');
      if (hasError && isLeafOrDeepCallee) {
        score += 0.15;
        reasons.push('Root failure origin: deepest failing downstream callee in the call tree');
      }

      // D. Correlated Prometheus Metrics (Weight: 0.10)
      const svcMetrics = metrics[span.serviceName];
      if (svcMetrics && (svcMetrics.errorRate > 0.10 || svcMetrics.p95LatencyMs > 1000)) {
        score += 0.10;
        reasons.push(`Correlated service degradation: ${svcMetrics.errorRate * 100}% error rate, p95 latency ${svcMetrics.p95LatencyMs}ms`);
      }

      if (score > 0.2) {
        candidates.push({
          serviceName: span.serviceName,
          spanId: span.spanId,
          operationName: span.name,
          statusCode: span.statusCode,
          durationMs: span.durationMs,
          selfTimeMs: span.selfTimeMs,
          score: Math.min(1.0, score),
          confidence: score >= 0.7 ? 'HIGH' : score >= 0.4 ? 'MEDIUM' : 'LOW',
          evidence: reasons
        });
      }
    }

    // Sort candidates descending by score
    candidates.sort((a, b) => b.score - a.score);

    const primaryCulprit = candidates[0] || {
      serviceName: 'order-service',
      score: 0.2,
      confidence: 'LOW',
      evidence: ['No definitive failure detected; nominal trace execution']
    };

    // 3. Construct Causal Path & Remediation Recommendations
    const causalPath = this.buildCausalPath(trace, primaryCulprit);
    const recommendation = this.generateRecommendation(primaryCulprit);

    return {
      traceId,
      incidentId: `inc-${traceId.substring(0, 12)}`,
      analyzedAt: new Date().toISOString(),
      primaryRootCause: {
        service: primaryCulprit.serviceName,
        operation: primaryCulprit.operationName,
        confidence: primaryCulprit.confidence,
        score: Number(primaryCulprit.score.toFixed(2)),
        evidenceChain: primaryCulprit.evidence,
        recommendation
      },
      rankedCandidates: candidates.slice(0, 5),
      causalPath,
      traceSummary: {
        totalSpans: trace.totalSpans,
        rootService: trace.rootSpans[0]?.serviceName || 'unknown',
        totalDurationMs: trace.spans[0]?.durationMs || 0
      },
      topology: topoAnalysis
    };
  }

  buildCausalPath(trace, culprit) {
    if (!culprit.spanId) return [];
    const path = [];
    let current = trace.spans.find(s => s.spanId === culprit.spanId);

    while (current) {
      path.unshift({
        service: current.serviceName,
        operation: current.name,
        durationMs: current.durationMs,
        selfTimeMs: current.selfTimeMs,
        statusCode: current.statusCode
      });
      current = trace.spans.find(s => s.spanId === current.parentSpanId);
    }
    return path;
  }

  generateRecommendation(culprit) {
    const svc = culprit.serviceName;
    if (svc === 'payment-service') {
      return 'Payment service experienced downstream gateway timeout/failure. Inspect simulated gateway latency settings or verify external payment provider uptime.';
    }
    if (svc === 'inventory-service') {
      return 'Inventory service returned stock conflict (409) or database lock. Verify stock allocation levels or inspect SQLite busy_timeout contention.';
    }
    if (svc === 'order-service') {
      return 'Order orchestrator failed during Saga compensation. Inspect outbox task leases and downstream service reachability.';
    }
    return 'Inspect recent application logs and Prometheus error spikes for service: ' + svc;
  }
}

export default RcaEngine;
