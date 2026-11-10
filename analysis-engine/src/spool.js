import fs from 'node:fs';
import path from 'node:path';

/**
 * Durable Disk Incident Spool
 * Provides crash-resilient queueing for incoming incident telemetry.
 * Implements atomic writes (write-to-tmp then rename) and a hard disk quota cap.
 */
export class IncidentSpool {
    constructor(options = {}) {
        const defaultBase = process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'CausalOTel', 'spool', 'incidents')
            : path.resolve('./spool/incidents');

        this.spoolDir = options.spoolDir || process.env.SPOOL_DIR || defaultBase;
        this.maxSizeBytes = options.maxSizeBytes || parseInt(process.env.SPOOL_MAX_SIZE_BYTES, 10) || 500 * 1024 * 1024; // 500 MB

        this._ensureDirSync();
    }

    _ensureDirSync() {
        if (!fs.existsSync(this.spoolDir)) {
            fs.mkdirSync(this.spoolDir, { recursive: true });
        }
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
                total += stat.size;
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
        const currentSize = await this.getSpoolSizeBytes();
        if (currentSize + incomingBytes <= this.maxSizeBytes) {
            return;
        }

        const files = await fs.promises.readdir(this.spoolDir);
        const fileStats = [];
        for (const file of files) {
            if (file.endsWith('.tmp')) continue; // Skip in-flight tmp files
            try {
                const filePath = path.join(this.spoolDir, file);
                const stat = await fs.promises.stat(filePath);
                fileStats.push({ path: filePath, mtime: stat.mtimeMs, size: stat.size });
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
    }

    /**
     * Spool incident data atomically
     * 1. Check & enforce quota cap
     * 2. Write to <id>.tmp
     * 3. Flush & rename to <id>.json
     */
    async spoolIncident(incidentId, data) {
        if (!incidentId) {
            throw new Error('incidentId is required to spool incident');
        }

        const payload = JSON.stringify({
            incidentId,
            spooledAt: Date.now(),
            data
        }, null, 2);

        const payloadBytes = Buffer.byteLength(payload, 'utf8');
        await this._enforceQuota(payloadBytes);

        const timestamp = Date.now();
        const baseName = `${timestamp}_${incidentId}`;
        const tmpPath = path.join(this.spoolDir, `${baseName}.tmp`);
        const targetPath = path.join(this.spoolDir, `${baseName}.json`);

        try {
            await fs.promises.writeFile(tmpPath, payload, 'utf8');
            await fs.promises.rename(tmpPath, targetPath);
            return targetPath;
        } catch (err) {
            // Clean up temporary file on failure
            try {
                if (fs.existsSync(tmpPath)) {
                    await fs.promises.unlink(tmpPath);
                }
            } catch (cleanupErr) {
                // Ignore cleanup error
            }
            throw new Error(`Failed to spool incident ${incidentId}: ${err.message}`);
        }
    }

    /**
     * List all spooled incidents in FIFO order (oldest first)
     */
    async listPending() {
        const files = await fs.promises.readdir(this.spoolDir);
        return files
            .filter(f => f.endsWith('.json'))
            .sort() // Timestamp-prefixed names sort chronologically
            .map(f => path.join(this.spoolDir, f));
    }

    /**
     * Read and parse a spooled incident file
     */
    async readIncident(filePath) {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }

    /**
     * Remove a processed incident file from spool
     */
    async acknowledgeIncident(filePath) {
        await fs.promises.unlink(filePath);
    }
}
