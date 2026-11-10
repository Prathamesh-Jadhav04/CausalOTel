import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import client from 'prom-client';
import { trace } from '@opentelemetry/api';
import { IncidentSpool } from './spool.js';

const app = express();
const port = parseInt(process.env.PORT, 10) || 5000;
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/causalotel_rca';

export const incidentSpool = new IncidentSpool();

// Prometheus Metrics Collection
client.collectDefaultMetrics({ prefix: 'causalotel_analysis_' });

app.use(express.json());

// Sanitize MongoDB URI for safe diagnostic logging
function sanitizeMongoUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.password) parsed.password = '***';
        return parsed.toString();
    } catch {
        return 'mongodb://***:***@hidden';
    }
}

// Prometheus Scraping Endpoint
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// Health Endpoints
app.get('/health/live', (req, res) => {
    res.json({
        status: 'UP',
        service: 'analysis-engine'
    });
});

app.get('/health/ready', (req, res) => {
    const isMongoConnected = mongoose.connection.readyState === 1;
    if (isMongoConnected) {
        res.json({
            status: 'UP',
            database: 'UP'
        });
    } else {
        res.status(503).json({
            status: 'DOWN',
            database: 'DOWN',
            readyState: mongoose.connection.readyState
        });
    }
});

// Baseline API Contract for Analysis Engine
app.get('/api/analysis', async (req, res, next) => {
    try {
        const pending = await incidentSpool.listPending();
        res.json({
            status: 'UP',
            pendingIncidentsCount: pending.length
        });
    } catch (err) {
        next(err);
    }
});

// Incident Spool Ingestion Endpoint
app.post('/api/analysis/spool', async (req, res, next) => {
    try {
        const { incidentId, data } = req.body;
        if (!incidentId) {
            const err = new Error('incidentId is required');
            err.status = 400;
            throw err;
        }
        const filePath = await incidentSpool.spoolIncident(incidentId, data);
        res.status(202).json({
            status: 'SPOOLED',
            incidentId,
            path: filePath
        });
    } catch (err) {
        next(err);
    }
});

// RFC 9457 Global Problem Details Error Handler
app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status);
    res.setHeader('Content-Type', 'application/problem+json');

    // Never leak raw SQL/filesystem details to public clients for generic 500s
    const safeDetail = status >= 500 
        ? 'An unexpected error occurred while processing the analysis request.' 
        : (err.detail || err.message || 'Request failed');

    const problem = {
        type: `https://causalotel.io/errors/${status}`,
        title: status === 400 ? 'Bad Request' : (status === 404 ? 'Not Found' : 'Internal Server Error'),
        status,
        detail: safeDetail,
        instance: req.originalUrl || req.path,
        timestamp: Date.now()
    };

    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        const traceId = activeSpan.spanContext().traceId;
        if (traceId && traceId !== '00000000000000000000000000000000') {
            problem.traceId = traceId;
        }
    }

    res.json(problem);
});

// MongoDB Connection Bootstrap
export async function connectMongo(uri = mongoUri) {
    console.log(`Connecting to MongoDB at: ${sanitizeMongoUri(uri)}`);
    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 3000
        });
        console.log('MongoDB connected successfully');
    } catch (err) {
        console.warn(`MongoDB initial connection notice: ${err.message}`);
    }
}

// Start HTTP server if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    connectMongo();
    app.listen(port, () => {
        console.log(`CausalOTel RCA Analysis Engine listening on port ${port}`);
    });
}

export default app;
