import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Every analysis-engine test process gets its own temporary data root. This
// runs before any test module (and therefore before src/server.js constructs
// the default IncidentSpool) so tests can never touch %LOCALAPPDATA%\CausalOTel.
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'causalotel-analysis-test-'));
const spoolDir = path.join(testRoot, 'CausalOTel', 'spool', 'incidents');

fs.mkdirSync(spoolDir, { recursive: true });

process.env.CAUSALOTEL_TEST_ROOT = testRoot;
process.env.LOCALAPPDATA = testRoot;
process.env.SPOOL_DIR = spoolDir;
process.env.NODE_ENV = 'test';

process.on('exit', () => {
    try {
        fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
        // Best-effort cleanup of the isolated test directory only.
    }
});
