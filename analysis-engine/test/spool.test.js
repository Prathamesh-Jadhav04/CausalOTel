import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IncidentSpool } from '../src/spool.js';

describe('IncidentSpool Tests', () => {
    let testSpoolDir;
    let spool;

    beforeEach(async () => {
        testSpoolDir = path.join(os.tmpdir(), `causalotel-test-spool-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
        await fs.promises.mkdir(testSpoolDir, { recursive: true });
        spool = new IncidentSpool({ spoolDir: testSpoolDir });
    });

    afterEach(async () => {
        // Hard guard: only remove the per-test directory created under os.tmpdir().
        const resolved = path.resolve(testSpoolDir);
        if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
            throw new Error(`Refusing destructive cleanup outside the temp directory: ${resolved}`);
        }
        try {
            await fs.promises.rm(resolved, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
    });

    test('Default spool path resolves inside the isolated test root', () => {
        assert.ok(process.env.CAUSALOTEL_TEST_ROOT, 'test environment must provide CAUSALOTEL_TEST_ROOT');
        const defaultSpool = new IncidentSpool();
        const resolved = path.resolve(defaultSpool.spoolDir);
        assert.ok(
            resolved.startsWith(path.resolve(process.env.CAUSALOTEL_TEST_ROOT) + path.sep),
            `default spool path must be isolated, got ${resolved}`
        );
    });

    test('Spool incident writes file atomically with no lingering tmp files', async () => {
        const incidentId = 'inc-1001';
        const data = { traceId: 'trace-abc-123', rootCause: 'Database connection exhaustion' };

        const savedPath = await spool.spoolIncident(incidentId, data);
        assert.ok(fs.existsSync(savedPath), 'Saved file should exist on disk');
        assert.ok(savedPath.endsWith('.json'), 'Saved file should have .json extension');

        // Verify no leftover .tmp files
        const allFiles = await fs.promises.readdir(testSpoolDir);
        const tmpFiles = allFiles.filter(f => f.endsWith('.tmp'));
        assert.equal(tmpFiles.length, 0, 'No temporary .tmp files should linger after write');

        // Verify file contents
        const parsed = await spool.readIncident(savedPath);
        assert.equal(parsed.incidentId, incidentId);
        assert.deepEqual(parsed.data, data);
    });

    test('Pending incidents are listed in chronological FIFO order', async () => {
        await spool.spoolIncident('inc-order-1', { order: 1 });
        await new Promise(r => setTimeout(r, 15));
        await spool.spoolIncident('inc-order-2', { order: 2 });
        await new Promise(r => setTimeout(r, 15));
        await spool.spoolIncident('inc-order-3', { order: 3 });

        const pending = await spool.listPending();
        assert.equal(pending.length, 3);

        const first = await spool.readIncident(pending[0]);
        const second = await spool.readIncident(pending[1]);
        const third = await spool.readIncident(pending[2]);

        assert.equal(first.incidentId, 'inc-order-1');
        assert.equal(second.incidentId, 'inc-order-2');
        assert.equal(third.incidentId, 'inc-order-3');
    });

    test('Enforces disk quota cap and evicts oldest incident', async () => {
        // Create spool with a tiny 400-byte cap
        const cappedSpool = new IncidentSpool({
            spoolDir: testSpoolDir,
            maxSizeBytes: 400
        });

        // Write first incident (~120 bytes)
        const path1 = await cappedSpool.spoolIncident('inc-evict-1', { pad: 'A'.repeat(50) });
        assert.ok(fs.existsSync(path1));

        await new Promise(r => setTimeout(r, 20));

        // Write second incident (~120 bytes)
        const path2 = await cappedSpool.spoolIncident('inc-evict-2', { pad: 'B'.repeat(50) });
        assert.ok(fs.existsSync(path2));

        await new Promise(r => setTimeout(r, 20));

        // Write third incident (~200 bytes) which pushes total size beyond 400 bytes
        const path3 = await cappedSpool.spoolIncident('inc-evict-3', { pad: 'C'.repeat(100) });
        assert.ok(fs.existsSync(path3));

        // Oldest incident (inc-evict-1) should have been evicted to respect the cap
        assert.equal(fs.existsSync(path1), false, 'Oldest incident should have been evicted');
        assert.equal(fs.existsSync(path3), true, 'Newest incident must remain intact');
    });

    test('Acknowledge incident unlinks file cleanly', async () => {
        const savedPath = await spool.spoolIncident('inc-ack-1', { data: 'test' });
        assert.ok(fs.existsSync(savedPath));

        await spool.acknowledgeIncident(savedPath);
        assert.equal(fs.existsSync(savedPath), false, 'Acknowledged file should be deleted');
    });
});
