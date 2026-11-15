import { createRequire } from 'node:module';

// See server.js: use the supported CommonJS export condition until Node 26's
// ESM conditional-export resolution supports this OpenTelemetry release.
const require = createRequire(import.meta.url);
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new NodeSDK({
    // Without an explicit service name every span is attributed to
    // "unknown_service:node", which makes the service graph and RCA useless.
    serviceName: process.env.OTEL_SERVICE_NAME || 'analysis-engine',
    traceExporter: new OTLPTraceExporter({
        url: `${otlpEndpoint}/v1/traces`
    }),
    metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
            url: `${otlpEndpoint}/v1/metrics`
        }),
        exportIntervalMillis: 15000
    }),
    instrumentations: [
        // This service only serves Express over HTTP.  Registering the full
        // auto-instrumentation bundle pulled in unused database, cloud, and
        // message-broker integrations (and their security surface) for no
        // observable benefit.
        new HttpInstrumentation(),
        new ExpressInstrumentation()
    ]
});

sdk.start();

const shutdown = () => {
    sdk.shutdown()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default sdk;
