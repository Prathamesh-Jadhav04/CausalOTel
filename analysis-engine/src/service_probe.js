/**
 * Server-side health probe for the local microservice mesh.
 *
 * The dashboard must never invent service health. This module performs real
 * HTTP probes from the analysis engine (same host, no browser CORS concerns)
 * and reports explicit UP / DOWN / UNREACHABLE states with measured latency.
 */

const DEFAULT_SERVICES = [
    { name: 'user-service', port: 8081, healthPath: '/health/live' },
    { name: 'product-service', port: 8082, healthPath: '/health/live' },
    { name: 'order-service', port: 8083, healthPath: '/health/live' },
    { name: 'payment-service', port: 8084, healthPath: '/health/live' },
    { name: 'inventory-service', port: 5050, healthPath: '/health/live' },
    { name: 'analysis-engine', port: 5000, healthPath: '/health/live' }
];

export class ServiceHealthProbe {
    constructor(services = DEFAULT_SERVICES, options = {}) {
        this.services = services;
        this.timeoutMs = options.timeoutMs || parseInt(process.env.HEALTH_PROBE_TIMEOUT_MS, 10) || 1500;
    }

    async probe(service) {
        const startedAt = performance.now();
        try {
            const response = await fetch(`http://127.0.0.1:${service.port}${service.healthPath}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(this.timeoutMs)
            });
            const latencyMs = Math.round(performance.now() - startedAt);

            let body = null;
            try {
                body = await response.json();
            } catch {
                // A non-JSON health body is still a real response; status is derived below.
            }

            const healthy = response.ok && (!body || body.status === 'UP' || body.status === 'ok');
            return {
                name: service.name,
                port: service.port,
                status: healthy ? 'UP' : 'DOWN',
                httpStatus: response.status,
                latencyMs,
                detail: body?.status || body?.service || null
            };
        } catch (err) {
            const latencyMs = Math.round(performance.now() - startedAt);
            const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
            return {
                name: service.name,
                port: service.port,
                status: 'UNREACHABLE',
                httpStatus: null,
                latencyMs,
                error: timedOut ? 'TIMEOUT' : 'CONNECTION_REFUSED'
            };
        }
    }

    async probeAll() {
        const services = await Promise.all(this.services.map(service => this.probe(service)));
        return {
            checkedAt: new Date().toISOString(),
            upCount: services.filter(service => service.status === 'UP').length,
            totalCount: services.length,
            services
        };
    }
}

export default ServiceHealthProbe;
