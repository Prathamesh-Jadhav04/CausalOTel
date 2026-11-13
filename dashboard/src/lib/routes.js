/**
 * L-03: single source of truth for dashboard routes.
 *
 * This module is intentionally JSX-free so the route table can be regression
 * tested with node:test without a browser or DOM emulator. App.jsx renders the
 * same constants, so a test failure here means the real router and the test
 * agree on what exists.
 */

export const ROUTE_PATHS = {
  overview: '/',
  services: '/services',
  graph: '/graph',
  traces: '/traces',
  traceDetail: '/traces/:traceId',
  incidents: '/incidents',
  incidentDetail: '/incidents/:incidentId',
  rca: '/rca',
  rcaDetail: '/rca/:incidentId',
  metrics: '/metrics',
  faultInjection: '/fault-injection',
  settings: '/settings'
};

export const NOT_FOUND_ROUTE = '*';

export function traceDetailPath(traceId) {
  return `${ROUTE_PATHS.traces}/${encodeURIComponent(traceId)}`;
}

export function rcaDetailPath(incidentId) {
  return `${ROUTE_PATHS.rca}/${encodeURIComponent(incidentId)}`;
}

function splitPath(value) {
  return value.split('/').filter(segment => segment.length > 0);
}

function matchPattern(pattern, pathname) {
  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

/**
 * Resolve a pathname against the real route table.
 *
 * Returns `{ name, params }` for a match, or `{ name: 'not-found', params: {} }`
 * for an unknown path so the caller can render the explicit 404 page.
 */
export function resolveRoute(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return { name: 'not-found', params: {} };
  }

  for (const [name, pattern] of Object.entries(ROUTE_PATHS)) {
    if (pattern.includes('*')) {
      continue;
    }
    const params = matchPattern(pattern, pathname);
    if (params) {
      return { name, params };
    }
  }

  return { name: 'not-found', params: {} };
}
