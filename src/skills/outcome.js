// Skill: outcome recording (R05).
// A smaller (fallback) action never gets full-action credit by default.
// Acceptance and elapsed time are NOT completion. Missing outcome stays
// explicit (pending/unknown), never silently treated as success.

import { OUTCOME } from '../model.js';

export const OUTCOME_OPTIONS = [
  { state: OUTCOME.FULL_COMPLETED, label: 'Full action completed', requiresFull: true },
  { state: OUTCOME.FALLBACK_COMPLETED, label: 'Smaller/fallback completed' },
  { state: OUTCOME.DEFERRED, label: 'Deferred' },
  { state: OUTCOME.NOT_COMPLETED, label: 'Not completed' },
  { state: OUTCOME.UNKNOWN, label: 'Unknown' },
];

export const REASON_PRESETS = ['Still no time', 'Unavailable option', 'Chose something else'];

export function recordOutcome(day, state, reason = '') {
  const valid = new Set(Object.values(OUTCOME));
  if (!valid.has(state)) return { ok: false, reason: 'invalid-state', day };

  // Guard: full-action credit requires an applied, non-fallback action.
  if (state === OUTCOME.FULL_COMPLETED) {
    if (!day.applied) return { ok: false, reason: 'no-applied-action', day };
    if (day.applied.isFallback) return { ok: false, reason: 'fallback-cannot-claim-full', day };
  }
  const next = {
    ...day,
    outcome: {
      state,
      reason: typeof reason === 'string' ? reason.trim() : '',
      recordedForDate: day.date,
      recordedAt: new Date().toISOString(),
    },
  };
  return { ok: true, day: next, reason: 'recorded' };
}

export function isSuccess(outcome) {
  return outcome.state === OUTCOME.FULL_COMPLETED || outcome.state === OUTCOME.FALLBACK_COMPLETED;
}
