import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const INCIDENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export class SpoolValidationError extends Error {
    constructor(message, code = 'INVALID_INCIDENT_ID', status = 400) {
        super(message);
        this.name = 'SpoolValidationError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Incident IDs are untrusted request input. Only a conservative, filename-safe
 * character set is accepted; separators, NUL bytes, absolute paths, and the
 * special directory names "."/".." are always rejected.
 */
export function validateIncidentId(incidentId) {
    if (typeof incidentId !== 'string') {
        throw new SpoolValidationError('incidentId must be a string');
    }
    if (incidentId.length < 1 || incidentId.length > 128) {
        throw new SpoolValidationError('incidentId must be between 1 and 128 characters');
    }
    if (incidentId === '.' || incidentId === '..') {
        throw new SpoolValidationError('incidentId must not be "." or ".."');
    }
    if (incidentId.includes('\0')) {
        throw new SpoolValidationError('incidentId must not contain NUL bytes');
    }
    if (!INCIDENT_ID_PATTERN.test(incidentId)) {
        throw new SpoolValidationError(
            'incidentId may only contain letters, digits, dot, underscore, and hyphen'
        );
    }
    return incidentId;
}

/**
 * Durable Disk Incident Spool
 * Provides crash-resilient queueing for incoming incident telemetry.
 * Implements atomic writes (write-to-tmp then rename) and a hard disk quota cap.
 *
 * The spool directory is the source of truth for incidents. Files are retained
 * until FIFO quota eviction or explicit acknowledgement; the incident store
 * hydrates them on startup so restarts do not lose incidents.
 */
export class IncidentSpool {
    constructor(options = {}) {
        const defaultBase = process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'CausalOTel', 'spool', 'incidents')
            : path.resolve('./spool/incidents');

        this.spoolDir = path.resolve(options.spoolDir || process.env.SPOOL_DIR || defaultBase);
        const configuredMaxSize = options.maxSizeBytes ?? parseInt(process.env.SPOOL_MAX_SIZE_BYTES, 10);
        this.maxSizeBytes = Number.isSafeInteger(configuredMaxSize) && configuredMaxSize > 0
            ? configuredMaxSize
            : 500 * 1024 * 1024; // 500 MB
        // Quota enforcement and file creation must be one critical section.
        // Without this queue, concurrent callers can all observe enough free
        // space and collectively write past the configured cap.
        this._writeQueue = Promise.resolve();

        this._ensureDirSync();
    }

    _ensureDirSync() {
        if (!fs.existsSync(this.spoolDir)) {
            fs.mkdirSync(this.spoolDir, { recursive: true });
        }
    }

    /**
     * Resolve a path and prove that it is a direct child of the spool directory.
     * This is the final defense against traversal even if an ID validation is
     * ever weakened or bypassed by a future caller.
     */
    _containedPath(candidatePath, { requireJson = false } = {}) {
        const resolved = path.resolve(candidatePath);
        const root = path.resolve(this.spoolDir);
        const prefix = root.endsWith(path.sep) ? root : root + path.sep;

        if (!resolved.startsWith(prefix)) {
            throw new SpoolValidationError('Resolved spool path escapes the spool directory', 'SPOOL_PATH_ESCAPE');
        }
        if (path.dirname(resolved) !== root) {
            throw new SpoolValidationError('Spool path must be a direct child of the spool directory', 'SPOOL_PATH_ESCAPE');
        }
        if (requireJson && !resolved.endsWith('.json')) {
            throw new SpoolValidationError('Spool path must reference a .json incident file', 'SPOOL_PATH_ESCAPE');
        }
        return resolved;
    }

    /**
     * Get current total size of files in spool directory
     */
    async getSpoolSizeBytes() {
        const files = await fs.promises.readdir(this.spoolDir);
        let total = 0;
        for (const file of files) {
            try {
                const stat = await fs.promises.stat(path.join(this.spoolDir, file));
                if (stat.isFile()) {
                    total += stat.size;
                }
            } catch (err) {
                // file might have been unlinked concurrently
            }
        }
        return total;
    }

    /**
     * Enforce disk quota cap before spooling new incidents.
     * If cap is reached, deletes oldest files (FIFO eviction).
     */
    async _enforceQuota(incomingBytes) {
        if (incomingBytes > this.maxSizeBytes) {
            throw new SpoolValidationError(
                `incident payload (${incomingBytes} bytes) exceeds the ${this.maxSizeBytes}-byte spool quota`,
                'SPOOL_ITEM_TOO_LARGE',
                413
            );
        }
        const currentSize = await this.getSpoolSizeBytes();
        if (currentSize + incomingBytes <= this.maxSizeBytes) {
            return;
        }

        const files = await fs.promises.readdir(this.spoolDir);
        const fileStats = [];
        for (const file of files) {
            try {
                const filePath = path.join(this.spoolDir, file);
                const stat = await fs.promises.stat(filePath);
                if (stat.isFile()) {
                    fileStats.push({ path: filePath, mtime: stat.mtimeMs, size: stat.size });
                }
            } catch (err) {
                // Ignore missing files
            }
        }

        // Sort oldest first
        fileStats.sort((a, b) => a.mtime - b.mtime);

        let freed = 0;
        const requiredFree = (currentSize + incomingBytes) - this.maxSizeBytes;

        for (const f of fileStats) {
            if (freed >= requiredFree) break;
            try {
                await fs.promises.unlink(f.path);
                freed += f.size;
            } catch (err) {
                // Continue evicting next
            }
        }

        if (currentSize - freed + incomingBytes > this.maxSizeBytes) {
            throw new Error('Unable to free enough disk space for the incident spool quota');
        }
    }

    _enqueueWrite(operation) {
        const run = this._writeQueue.then(operation, operation);
        // Keep the queue usable after a rejected write while returning the
        // original rejection to the caller that triggered it.
        this._writeQueue = run.catch(() => undefined);
        return run;
    }

    async _existingIncidentPath(incidentId) {
        const suffix = `_${incidentId}.json`;
        const files = await this.listPending();
        return files.find(file => path.basename(file).endsWith(suffix)) || null;
    }

    /**
     * Spool incident data atomically
     * 1. Validate the untrusted incident ID
     * 2. Check & enforce quota cap
     * 3. Write to <id>.tmp
     * 4. Flush & rename to <id>.json
     */
    async spoolIncident(incidentId, data) {
        const safeIncidentId = validateIncidentId(incidentId);

        return this._enqueueWrite(async () => {
            // Preserve idempotency when the same incident is retried while a
            // previous write is queued or has already completed.
            const existing = await this._existingIncidentPath(safeIncidentId);
            if (existing) {
                return existing;
            }

            const payload = JSON.stringify({
                incidentId: safeIncidentId,
                spooledAt: Date.now(),
                data
            }, null, 2);

            const payloadBytes = Buffer.byteLength(payload, 'utf8');
            await this._enforceQuota(payloadBytes);

            const timestamp = Date.now();
            const baseName = `${timestamp}_${path.basename(safeIncidentId)}`;
            const tmpPath = this._containedPath(
                path.join(this.spoolDir, `${baseName}.${crypto.randomUUID()}.tmp`)
            );
            const targetPath = this._containedPath(
                path.join(this.spoolDir, `${baseName}.json`),
                { requireJson: true }
            );

            try {
                await fs.promises.writeFile(tmpPath, payload, { encoding: 'utf8', flag: 'wx' });
                await fs.promises.rename(tmpPath, targetPath);
                return targetPath;
            } catch (err) {
                // Clean up temporary file on failure.
                try {
                    if (fs.existsSync(tmpPath)) {
                        await fs.promises.unlink(tmpPath);
                    }
                } catch {
                    // The original write error is more useful to the caller.
                }
                throw new Error(`Failed to spool incident ${safeIncidentId}: ${err.message}`);
            }
        });
    }

    /**
     * List all spooled incidents in FIFO order (oldest first)
     */
    async listPending() {
        const files = await fs.promises.readdir(this.spoolDir);
        return files
            .filter(f => f.endsWith('.json'))
            .sort() // Timestamp-prefixed names sort chronologically
            .map(f => this._containedPath(path.join(this.spoolDir, f), { requireJson: true }));
    }

    /**
     * Read and parse a spooled incident file
     */
    async readIncident(filePath) {
        const safePath = this._containedPath(filePath, { requireJson: true });
        const raw = await fs.promises.readFile(safePath, 'utf8');
        return JSON.parse(raw);
    }

    /**
     * Remove a processed incident file from spool
     */
    async acknowledgeIncident(filePath) {
        const safePath = this._containedPath(filePath, { requireJson: true });
        await fs.promises.unlink(safePath);
    }

    /**
     * Move a corrupt/unreadable spool file out of the active queue so that one
     * bad file cannot wedge startup hydration forever.
     */
    async quarantineIncident(filePath, reason = 'unreadable') {
        const safePath = this._containedPath(filePath, { requireJson: true });
        const quarantineDir = path.join(this.spoolDir, 'quarantine');
        await fs.promises.mkdir(quarantineDir, { recursive: true });
        const target = path.join(
            quarantineDir,
            `${Date.now()}_${path.basename(safePath)}.corrupt`
        );
        await fs.promises.rename(safePath, target);
        return target;
    }

    /**
     * Readiness probe for the durable store. The spool is the source of truth,
     * so readiness must depend on it rather than on an unused MongoDB.
     */
    async checkHealth() {
        try {
            this._ensureDirSync();
            const probe = path.join(this.spoolDir, `.health-${process.pid}-${Date.now()}`);
            await fs.promises.writeFile(probe, 'ok', 'utf8');
            await fs.promises.unlink(probe);
            const pending = await this.listPending();
            return {
                healthy: true,
                store: 'disk-spool',
                spoolDir: this.spoolDir,
                pendingCount: pending.length
            };
        } catch (err) {
            return {
                healthy: false,
                store: 'disk-spool',
                spoolDir: this.spoolDir,
                error: err.message
            };
        }
    }
}

export default IncidentSpool;
