// Skill: apply / undo (R04). Writes ONLY to Daywell's internal plan.
// - Re-checks freshness before applying (recompute if the plan changed).
// - Idempotent: repeated identical applies do not duplicate.
// - Pushes a reversible snapshot so undo can restore the previous state.

import { checkPlacement } from '../supervisor.js';
import { planningDay } from './context.js';
import { OUTCOME } from '../model.js';

export function proposalIsFresh(day, candidate, floor) {
  // The proposal is stale if the chosen window no longer passes the supervisor
  // against the CURRENT day (e.g. a commitment was edited in between).
  const placement = checkPlacement(planningDay(day), { start: candidate.start, durationMin: candidate.durationMin }, { floor });
  return placement.ok;
}

function sameApplied(a, b) {
  return a && b && a.sourceId === b.sourceId && a.start === b.start &&
    a.durationMin === b.durationMin && a.title === b.title && a.isFallback === b.isFallback;
}

// Returns { ok, day, reason }. `day` is a NEW object on success.
export function applyCandidate(day, candidate, { floor = 0 } = {}) {
  if (!candidate) return { ok: false, reason: 'no-candidate' };
  if (!proposalIsFresh(day, candidate, floor)) {
    return { ok: false, reason: 'stale', day };
  }
  const nextApplied = {
    sourceId: candidate.sourceId,
    kind: candidate.kind,
    title: candidate.title,
    start: candidate.start,
    durationMin: candidate.durationMin,
    isFallback: candidate.isFallback,
  };
  // Idempotent: applying the same thing again is a no-op, not a duplicate.
  if (sameApplied(day.applied, nextApplied)) {
    return { ok: true, day, reason: 'noop' };
  }
  const history = [...day.history, {
    prevApplied: day.applied,
    prevOutcome: { ...day.outcome },
    at: new Date().toISOString(),
  }].slice(-10);

  const next = {
    ...day,
    applied: nextApplied,
    history,
    // Accepting a proposal records ACCEPTED, never completion (R05).
    outcome: { state: OUTCOME.ACCEPTED, reason: '', recordedForDate: day.date, recordedAt: new Date().toISOString() },
  };
  return { ok: true, day: next, reason: 'applied' };
}

export function canUndo(day) {
  return Array.isArray(day.history) && day.history.length > 0;
}

// Restore previous affected block when still valid (R04).
export function undo(day, { floor = 0 } = {}) {
  if (!canUndo(day)) return { ok: false, reason: 'nothing-to-undo', day };
  const history = [...day.history];
  const last = history.pop();
  if (last.prevApplied) {
    const placement = checkPlacement(planningDay(day), { start: last.prevApplied.start, durationMin: last.prevApplied.durationMin }, { floor });
    if (!placement.ok) {
      return { ok: false, reason: 'prev-invalid', day };
    }
  }
  const next = {
    ...day,
    applied: last.prevApplied,
    outcome: last.prevOutcome || { state: OUTCOME.PENDING, reason: '', recordedForDate: null, recordedAt: null },
    history,
  };
  return { ok: true, day: next, reason: 'undone' };
}
