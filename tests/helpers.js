// Minimal localStorage + performance polyfills so store/monitor modules load
// under node:test. Pure skill tests do not depend on these.
class MemStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
// Node 25 ships a non-functional global `localStorage`; override it outright.
Object.defineProperty(globalThis, 'localStorage', {
  value: new MemStorage(),
  writable: true,
  configurable: true,
});
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}

export const H = (hour, min = 0) => hour * 60 + min;

export function makeDay({ commitments = [], planned = {}, fallbacks = [], meeting = null } = {}) {
  return {
    schemaVersion: 3,
    date: '2026-10-04',
    timeZone: 'UTC',
    commitments: commitments.map((c, i) => ({ id: c.id || `cm${i}`, title: c.title || 'Work', start: c.start, end: c.end, protected: c.protected !== false })),
    planned: {
      id: 'plan-1', kind: 'movement', title: 'Walk', start: H(18), durationMin: 30,
      latestFinish: H(19), bufferBeforeMin: 10, bufferAfterMin: 10, ...planned,
    },
    fallbacks: fallbacks.map((f, i) => ({ id: f.id || `fb${i}`, kind: f.kind || 'movement', title: f.title, durationMin: f.durationMin, available: f.available !== false, availabilityNote: f.availabilityNote || '' })),
    meeting,
    applied: null,
    history: [],
    outcome: { state: 'pending', reason: '', recordedForDate: null, recordedAt: null },
  };
}
