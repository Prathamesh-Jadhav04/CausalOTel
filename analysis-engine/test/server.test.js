import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/server.js';

describe('Analysis Engine Server & Health Endpoints', () => {
    let server;
    let baseUrl;

    before(async () => {
        return new Promise((resolve) => {
            server = http.createServer(app);
            server.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        return new Promise((resolve) => {
            server.close(resolve);
        });
    });

    test('GET /health/live returns 200 UP', async () => {
        const res = await fetch(`${baseUrl}/health/live`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'UP');
        assert.equal(body.service, 'analysis-engine');
    });

    test('GET /health/ready returns 503 when MongoDB is disconnected', async () => {
        const res = await fetch(`${baseUrl}/health/ready`);
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.equal(body.status, 'DOWN');
    });

    test('GET /metrics returns 200 with Prometheus text format', async () => {
        const res = await fetch(`${baseUrl}/metrics`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.ok(text.includes('causalotel_analysis_'));
    });

    test('GET /api/analysis returns 200 baseline contract', async () => {
        const res = await fetch(`${baseUrl}/api/analysis`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'UP');
        assert.equal(typeof body.pendingIncidentsCount, 'number');
    });

    test('POST /api/analysis/spool with missing incidentId returns 400 application/problem+json', async () => {
        const res = await fetch(`${baseUrl}/api/analysis/spool`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: { test: true } })
        });

        assert.equal(res.status, 400);
        assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
        const problem = await res.json();
        assert.equal(problem.status, 400);
        assert.equal(problem.type, 'https://causalotel.io/errors/400');
        assert.ok(problem.detail.includes('incidentId is required'));
    });
});
