import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DependencyGraph } from '../src/graph.js';
import { RcaEngine } from '../src/rca_engine.js';
import { TempoClient } from '../src/tempo_client.js';
import { PrometheusClient } from '../src/prometheus_client.js';
import { IncidentStore } from '../src/incident_store.js';

describe('Dependency Graph & Tarjan SCC Algorithm', () => {

  test('BFS finds shortest causal path between microservices', () => {
    const graph = new DependencyGraph();
    graph.addEdge('dashboard', 'order-service');
    graph.addEdge('order-service', 'inventory-service');
    graph.addEdge('order-service', 'payment-service');
    graph.addEdge('payment-service', 'gateway-simulator');

    const path = graph.findShortestPath('dashboard', 'gateway-simulator');
    assert.deepEqual(path, ['dashboard', 'order-service', 'payment-service', 'gateway-simulator']);
  });

  test('Tarjan SCC detects no cycles in DAG', () => {
    const graph = new DependencyGraph();
    graph.addEdge('A', 'B');
    graph.addEdge('B', 'C');
    graph.addEdge('A', 'C');

    assert.equal(graph.hasCycle(), false);
    const sccs = graph.findStronglyConnectedComponents();
    assert.equal(sccs.length, 3);
  });

  test('Tarjan SCC detects cyclic microservice dependency', () => {
    const graph = new DependencyGraph();
    graph.addEdge('service-A', 'service-B');
    graph.addEdge('service-B', 'service-C');
    graph.addEdge('service-C', 'service-A'); // Cycle!

    assert.equal(graph.hasCycle(), true);
    const sccs = graph.findStronglyConnectedComponents();
    const cyclic = sccs.find(s => s.length > 1);
    assert.ok(cyclic, 'Should identify a multi-node cycle');
    assert.equal(cyclic.length, 3);
  });
});

describe('Root Cause Analysis Engine', () => {

  test('pinpoints failing service with high confidence and evidence chain', async () => {
    const tempoClient = new TempoClient();
    const prometheusClient = new PrometheusClient();
    const rca = new RcaEngine(tempoClient, prometheusClient);

    const result = await rca.analyzeTrace('trace-test-12345');

    assert.equal(result.traceId, 'trace-test-12345');
    assert.ok(result.primaryRootCause);
    assert.equal(result.primaryRootCause.service, 'payment-service');
    assert.equal(result.primaryRootCause.confidence, 'HIGH');
    assert.ok(result.primaryRootCause.score >= 0.7);
    assert.ok(result.primaryRootCause.evidenceChain.length >= 2);
    assert.ok(result.primaryRootCause.recommendation.includes('payment'));
    assert.ok(result.causalPath.length > 0);
  });

  test('IncidentStore persists and lists incidents', () => {
    const store = new IncidentStore();
    const saved = store.saveIncident({
      incidentId: 'inc-sample-01',
      title: 'Payment Timeout',
      severity: 'CRITICAL'
    });

    assert.equal(saved.incidentId, 'inc-sample-01');
    const retrieved = store.getIncident('inc-sample-01');
    assert.equal(retrieved.title, 'Payment Timeout');

    const all = store.listIncidents();
    assert.equal(all.length, 1);
  });
});
