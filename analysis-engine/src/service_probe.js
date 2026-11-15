/**
 * Server-side health probe for the local microservice mesh.
 *
 * The dashboard must never invent service health. This module performs real
 * HTTP probes from the analysis engine (same host, no browser CORS concerns)
 * and reports explicit UP / DOWN / UNREACHABLE states with measured latency.
 */

const service = (name, url, fallback, healthPath = '/health/live') => {
    const resolvedUrl = url || fallback;
    const parsed = new URL(resolvedUrl);
    return {
        name,
        url: resolvedUrl,
        port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
        healthPath
    };
};

const DEFAULT_SERVICES = [
    service('user-service', process.env.SERVICES_USER_URL, 'http://127.0.0.1:8081'),
    service('product-service', process.env.SERVICES_PRODUCT_URL, 'http://127.0.0.1:8082'),
    service('order-service', process.env.SERVICES_ORDER_URL, 'http://127.0.0.1:8083'),
    service('payment-service', process.env.SERVICES_PAYMENT_URL, 'http://127.0.0.1:8084'),
    service('inventory-service', process.env.SERVICES_INVENTORY_URL, 'http://127.0.0.1:5050'),
    service('analysis-engine', process.env.SERVICES_ANALYSIS_URL, 'http://127.0.0.1:5000')
];

export class ServiceHealthProbe {
    constructor(services = DEFAULT_SERVICES, options = {}) {
        this.services = services;
        this.timeoutMs = options.timeoutMs || parseInt(process.env.HEALTH_PROBE_TIMEOUT_MS, 10) || 1500;
    }

    async probe(service) {
        const startedAt = performance.now();
        try {
            const response = await fetch(`${service.url}${service.healthPath}`, {
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
                url: service.url,
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
                url: service.url,
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
