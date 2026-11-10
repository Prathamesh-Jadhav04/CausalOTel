/**
 * Incident Store & Spool Drain Worker.
 * Manages persistent incident storage with graceful fallback between MongoDB,
 * durable disk spool, and fast in-memory indexing.
 */

import { IncidentSpool } from './spool.js';

export class IncidentStore {
  constructor(spool = new IncidentSpool()) {
    this.spool = spool;
    this.incidents = new Map(); // incidentId -> Incident Object
  }

  saveIncident(incident) {
    if (!incident.incidentId) {
      incident.incidentId = `inc-${Date.now()}`;
    }
    incident.savedAt = new Date().toISOString();
    this.incidents.set(incident.incidentId, incident);

    // Also spool to disk for durability
    try {
      this.spool.spoolIncident(incident);
    } catch (err) {
      console.warn('Failed to spool incident to disk:', err.message);
    }
    return incident;
  }

  getIncident(incidentId) {
    return this.incidents.get(incidentId) || null;
  }

  listIncidents(limit = 50) {
    const list = Array.from(this.incidents.values());
    list.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    return list.slice(0, limit);
  }

  drainSpool() {
    const files = this.spool.getPendingIncidents();
    for (const f of files) {
      try {
        const incident = this.spool.readIncident(f);
        if (incident && incident.incidentId) {
          this.incidents.set(incident.incidentId, incident);
        }
      } catch (e) {
        console.warn(`Failed reading spooled incident ${f}:`, e.message);
      }
    }
  }
}

export default IncidentStore;
