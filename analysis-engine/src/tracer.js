import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

const sdk = new NodeSDK({
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
        getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': { enabled: false }
        })
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
