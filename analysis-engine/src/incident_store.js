/**
 * Incident Store & Spool Drain Worker.
 *
 * The durable disk spool is the source of truth. MongoDB is intentionally not
 * used: incidents must survive a process restart without requiring an
 * additional database that the rest of the local stack does not run.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { IncidentSpool, validateIncidentId } from './spool.js';

export class IncidentStore {
  constructor(spool = new IncidentSpool()) {
    this.spool = spool;
    this.incidents = new Map(); // incidentId -> Incident Object
    this._hydrated = false;
    this._lastDrain = null;
  }

  /**
   * Persist an incident durably before exposing it in memory. Failures
   * propagate: a caller must never believe an incident was recorded when the
   * spool write failed.
   */
  async saveIncident(incident) {
    if (!incident || typeof incident !== 'object' || Array.isArray(incident)) {
      throw new TypeError('incident must be an object');
    }

    const record = { ...incident };
    if (!record.incidentId) {
      record.incidentId = `inc-${crypto.randomUUID()}`;
    }
    validateIncidentId(record.incidentId);
    record.savedAt = new Date().toISOString();

    // A replay of the same incident ID is idempotent. The spool may already
    // contain the record from a previous process; do not create duplicates.
    if (this.incidents.has(record.incidentId) || await this._hasSpooledIncident(record.incidentId)) {
      this.incidents.set(record.incidentId, record);
      return record;
    }

    const filePath = await this.spool.spoolIncident(record.incidentId, record);
    record.spoolFile = path.basename(filePath);
    this.incidents.set(record.incidentId, record);
    return record;
  }

  async _hasSpooledIncident(incidentId) {
    const pending = await this.spool.listPending();
    const suffix = `_${incidentId}.json`;
    return pending.some(file => path.basename(file).endsWith(suffix));
  }

  /**
   * Load every pending spool file into the in-memory index. Files remain on
   * disk because they are the durable store; hydration is idempotent and can
   * be repeated safely. Corrupt files are quarantined rather than blocking
   * startup forever.
   */
  async drainSpool() {
    const files = await this.spool.listPending();
    let loaded = 0;
    let quarantined = 0;

    for (const file of files) {
      try {
        const record = await this.spool.readIncident(file);
        const incident = record?.data && typeof record.data === 'object'
          ? { ...record.data, incidentId: record.data.incidentId || record.incidentId }
          : record;

        if (!incident?.incidentId) {
          throw new Error('spooled incident has no incidentId');
        }

        validateIncidentId(incident.incidentId);
        incident.spoolFile = path.basename(file);
        this.incidents.set(incident.incidentId, incident);
        loaded += 1;
      } catch (err) {
        quarantined += 1;
        console.warn(`Quarantining corrupt spooled incident ${path.basename(file)}: ${err.message}`);
        try {
          await this.spool.quarantineIncident(file, err.message);
        } catch (quarantineErr) {
          console.warn(`Failed to quarantine ${path.basename(file)}: ${quarantineErr.message}`);
        }
      }
    }

    this._hydrated = true;
    this._lastDrain = new Date().toISOString();
    return { loaded, quarantined, pending: files.length };
  }

  async getIncident(incidentId) {
    validateIncidentId(incidentId);
    if (!this._hydrated) {
      await this.drainSpool();
    }
    return this.incidents.get(incidentId) || null;
  }

  async listIncidents(limit = 50) {
    if (!this._hydrated) {
      await this.drainSpool();
    }
    const list = Array.from(this.incidents.values());
    list.sort((a, b) => new Date(b.savedAt || b.analyzedAt || 0) - new Date(a.savedAt || a.analyzedAt || 0));
    return list.slice(0, limit);
  }

  async checkHealth() {
    return this.spool.checkHealth();
  }

  get lastDrain() {
    return this._lastDrain;
  }
}

export default IncidentStore;
