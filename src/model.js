// Data model + validation. A DayPlan is the single dated plan the MVP works on.
// Validation is used both on load (recover from malformed storage) and on import.

import { MINUTES_PER_DAY, isIsoDate, deviceTimeZone, parseClock, toClockInput } from './time.js';

export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'daywell.dayplan.v3';

export const OUTCOME = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  FULL_COMPLETED: 'full-completed',
  FALLBACK_COMPLETED: 'fallback-completed',
  DEFERRED: 'deferred',
  NOT_COMPLETED: 'not-completed',
  UNKNOWN: 'unknown',
};

let idCounter = 0;
export function newId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function emptyDay(date) {
  return {
    schemaVersion: SCHEMA_VERSION,
    date,
    timeZone: deviceTimeZone(),
    commitments: [],
    planned: {
      id: newId('plan'),
      kind: 'movement',
      title: '',
      start: 17 * 60 + 30,
      durationMin: 20,
      latestFinish: 21 * 60,
      bufferBeforeMin: 10,
      bufferAfterMin: 10,
    },
    fallbacks: [],
    meeting: null,
    applied: null,
    history: [],
    outcome: { state: OUTCOME.PENDING, reason: '', recordedForDate: null, recordedAt: null },
  };
}

function isFiniteInt(n) {
  return typeof n === 'number' && Number.isInteger(n);
}

function validateAction(raw, { requireTitle }) {
  const errors = [];
  const action = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('act'),
    kind: raw.kind === 'meal' ? 'meal' : 'movement',
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    durationMin: isFiniteInt(raw.durationMin) ? raw.durationMin : 0,
    available: raw.available !== false,
    availabilityNote: typeof raw.availabilityNote === 'string' ? raw.availabilityNote.trim() : '',
  };
  if (requireTitle && !action.title) errors.push('Action needs a title.');
  if (action.durationMin <= 0 || action.durationMin > MINUTES_PER_DAY) errors.push('Duration must be between 1 minute and a full day.');
  return { action, errors };
}

// Returns { ok, day, errors }. On malformed input we recover a best-effort day
// rather than throw, so stored data can never hard-crash the app.
export function validateDay(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, day: null, errors: ['Stored plan is not an object.'] };
  }
  const date = isIsoDate(raw.date) ? raw.date : null;
  if (!date) errors.push('Plan date is missing or invalid.');

  const base = emptyDay(date || '2026-01-01');
  base.timeZone = typeof raw.timeZone === 'string' && raw.timeZone ? raw.timeZone : base.timeZone;

  // Commitments
  const commitments = [];
  if (Array.isArray(raw.commitments)) {
    for (const c of raw.commitments) {
      if (!c || typeof c !== 'object') continue;
      const start = isFiniteInt(c.start) ? c.start : parseClock(c.startClock);
      const end = isFiniteInt(c.end) ? c.end : parseClock(c.endClock);
      if (start === null || end === null || !isFiniteInt(start) || !isFiniteInt(end)) {
        errors.push('A commitment had an invalid time and was skipped.');
        continue;
      }
      if (end <= start || start < 0 || end > MINUTES_PER_DAY) {
        errors.push('A commitment had an out-of-range time and was skipped.');
        continue;
      }
      commitments.push({
        id: typeof c.id === 'string' && c.id ? c.id : newId('cm'),
        title: typeof c.title === 'string' ? c.title.trim() : '',
        start,
        end,
        protected: c.protected !== false,
      });
    }
  }
  base.commitments = commitments;

  // Planned action
  if (raw.planned && typeof raw.planned === 'object') {
    const { action, errors: aErr } = validateAction(raw.planned, { requireTitle: false });
    const p = raw.planned;
    const start = isFiniteInt(p.start) ? p.start : parseClock(p.startClock);
    const latestFinish = isFiniteInt(p.latestFinish) ? p.latestFinish : parseClock(p.latestFinishClock);
    base.planned = {
      ...action,
      start: isFiniteInt(start) ? start : base.planned.start,
      latestFinish: isFiniteInt(latestFinish) ? latestFinish : base.planned.latestFinish,
      bufferBeforeMin: isFiniteInt(p.bufferBeforeMin) ? Math.max(0, p.bufferBeforeMin) : 10,
      bufferAfterMin: isFiniteInt(p.bufferAfterMin) ? Math.max(0, p.bufferAfterMin) : 10,
    };
    if (base.planned.latestFinish > MINUTES_PER_DAY) base.planned.latestFinish = MINUTES_PER_DAY;
    errors.push(...aErr);
  }

  // Fallbacks (max 2)
  base.fallbacks = [];
  if (Array.isArray(raw.fallbacks)) {
    for (const f of raw.fallbacks.slice(0, 2)) {
      if (!f || typeof f !== 'object') continue;
      const { action } = validateAction(f, { requireTitle: false });
      if (action.title) base.fallbacks.push(action);
    }
  }

  // Meeting overrun
  if (raw.meeting && typeof raw.meeting === 'object') {
    const start = isFiniteInt(raw.meeting.start) ? raw.meeting.start : parseClock(raw.meeting.startClock);
    const end = isFiniteInt(raw.meeting.end) ? raw.meeting.end : parseClock(raw.meeting.endClock);
    if (isFiniteInt(start) && isFiniteInt(end) && end > start) {
      base.meeting = {
        title: typeof raw.meeting.title === 'string' ? raw.meeting.title.trim() : 'Meeting',
        start,
        end,
      };
    }
  }

  // Outcome
  const validOutcomes = new Set(Object.values(OUTCOME));
  if (raw.outcome && typeof raw.outcome === 'object' && validOutcomes.has(raw.outcome.state)) {
    base.outcome = {
      state: raw.outcome.state,
      reason: typeof raw.outcome.reason === 'string' ? raw.outcome.reason.trim() : '',
      recordedForDate: isIsoDate(raw.outcome.recordedForDate) ? raw.outcome.recordedForDate : null,
      recordedAt: typeof raw.outcome.recordedAt === 'string' ? raw.outcome.recordedAt : null,
    };
  }

  // Applied snapshot (what the plan currently shows for the affected action)
  if (raw.applied && typeof raw.applied === 'object' && isFiniteInt(raw.applied.start) && isFiniteInt(raw.applied.durationMin)) {
    base.applied = {
      sourceId: typeof raw.applied.sourceId === 'string' ? raw.applied.sourceId : base.planned.id,
      kind: raw.applied.kind === 'meal' ? 'meal' : 'movement',
      title: typeof raw.applied.title === 'string' ? raw.applied.title.trim() : '',
      start: raw.applied.start,
      durationMin: raw.applied.durationMin,
      isFallback: raw.applied.isFallback === true,
    };
  }

  // History (for undo)
  if (Array.isArray(raw.history)) {
    base.history = raw.history
      .filter((h) => h && typeof h === 'object')
      .slice(-10)
      .map((h) => ({
        prevApplied: h.prevApplied || null,
        prevOutcome: h.prevOutcome || null,
        at: typeof h.at === 'string' ? h.at : null,
      }));
  }

  return { ok: errors.length === 0, day: base, errors };
}

export { parseClock, toClockInput };
