import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOT_FOUND_ROUTE,
  ROUTE_PATHS,
  rcaDetailPath,
  resolveRoute,
  traceDetailPath
} from '../src/lib/routes.js';

describe('dashboard route table (L-03)', () => {
  test('the trace RCA action resolves to a real detail route', () => {
    const target = rcaDetailPath('inc-abc123');
    assert.equal(target, '/rca/inc-abc123');

    const resolved = resolveRoute(target);
    assert.equal(resolved.name, 'rcaDetail');
    assert.equal(resolved.params.incidentId, 'inc-abc123');
  });

  test('legacy /incidents/:id links render the RCA detail page', () => {
    const resolved = resolveRoute('/incidents/inc-legacy');
    assert.equal(resolved.name, 'incidentDetail');
    assert.equal(resolved.params.incidentId, 'inc-legacy');
  });

  test('trace detail links resolve with encoded ids', () => {
    const target = traceDetailPath('trace id/with spaces');
    assert.equal(target, '/traces/trace%20id%2Fwith%20spaces');
    const resolved = resolveRoute(target);
    assert.equal(resolved.name, 'traceDetail');
    assert.equal(resolved.params.traceId, 'trace id/with spaces');
  });

  test('unknown paths resolve to the catch-all not-found page', () => {
    for (const path of ['/does-not-exist', '/incidents/one/two/three', '/traces']) {
      const resolved = resolveRoute(path);
      if (path === '/traces') {
        assert.equal(resolved.name, 'traces');
      } else {
        assert.equal(resolved.name, 'not-found', `${path} must not silently render a page`);
      }
    }
    assert.equal(NOT_FOUND_ROUTE, '*');
  });

  test('every declared route is reachable through the resolver', () => {
    const samples = {
      overview: '/',
      services: '/services',
      graph: '/graph',
      traces: '/traces',
      traceDetail: '/traces/trace-1',
      incidents: '/incidents',
      incidentDetail: '/incidents/inc-1',
      rca: '/rca',
      rcaDetail: '/rca/inc-1',
      metrics: '/metrics',
      faultInjection: '/fault-injection',
      settings: '/settings'
    };

    for (const [name, path] of Object.entries(samples)) {
      assert.equal(ROUTE_PATHS[name] !== undefined, true, `route ${name} must be declared`);
      assert.equal(resolveRoute(path).name, name, `${path} should resolve to ${name}`);
    }
  });
});
