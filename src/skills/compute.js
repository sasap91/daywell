// Skill: feasible-option computation (R03).
// Deterministic ranking only — no model. Identical structured inputs produce
// the same candidate set. Every candidate references a real action + window
// validated by the supervisor.

import { checkPlacement, sortedCommitments } from '../supervisor.js';
import { planningDay } from './context.js';
import { MINUTES_PER_DAY } from '../time.js';

// The earliest the user can realistically start acting after the overrun:
// the revised meeting end, or now, whichever is later. Caller passes `floor`.
function candidateStarts(day, durationMin, floor) {
  // Build free gaps between the floor and latest finish, respecting commitments.
  const commitments = sortedCommitments(day);
  const starts = new Set();
  starts.add(floor);
  for (const c of commitments) {
    // Right after a commitment ends (+ buffer) is a natural start.
    starts.add(c.end + day.planned.bufferAfterMin);
    starts.add(c.end);
  }
  const results = [];
  for (const start of [...starts].sort((a, b) => a - b)) {
    if (start < floor) continue;
    if (start + durationMin > MINUTES_PER_DAY) continue;
    const placement = checkPlacement(day, { start, durationMin }, { floor });
    if (placement.ok) results.push(placement.start);
  }
  return results;
}

function determiningConstraint(day, action, floor) {
  // Explain which single entered constraint blocks the original start.
  const original = checkPlacement(day, { start: day.planned.start, durationMin: action.durationMin }, { floor });
  if (original.ok) return null;
  return original.code;
}

// Returns a frozen, ordered candidate list. Strategy per R03:
//   1. Preserve the original action in a feasible LATER window.
//   2. Otherwise offer a saved smaller/quicker fallback (shortest first).
// `preferenceId` lets the user pin a specific action among feasible options.
export function computeReplacement(rawDay, { floor = 0, preferenceId = null } = {}) {
  const day = planningDay(rawDay);
  const candidates = [];
  const planned = day.planned;

  // 1. Original action, later window.
  const originalStarts = candidateStarts(day, planned.durationMin, Math.max(floor, planned.start + 1 > floor ? floor : floor));
  // Prefer a window at/after the floor; closest to original time first.
  const sortedOriginal = originalStarts.sort((a, b) => a - b);
  if (sortedOriginal.length) {
    const start = sortedOriginal[0];
    candidates.push({
      id: `orig:${planned.id}:${start}`,
      sourceId: planned.id,
      kind: planned.kind,
      title: planned.title,
      durationMin: planned.durationMin,
      start,
      end: start + planned.durationMin,
      isFallback: false,
      strategy: 'preserve-original',
    });
  }

  // 2. Fallbacks (available, shorter-or-equal preferred), shortest duration first.
  const fallbacks = day.fallbacks
    .filter((f) => f.available)
    .sort((a, b) => a.durationMin - b.durationMin);
  for (const fb of fallbacks) {
    const starts = candidateStarts(day, fb.durationMin, floor);
    if (!starts.length) continue;
    const start = starts[0];
    candidates.push({
      id: `fb:${fb.id}:${start}`,
      sourceId: fb.id,
      kind: fb.kind,
      title: fb.title,
      durationMin: fb.durationMin,
      start,
      end: start + fb.durationMin,
      isFallback: true,
      strategy: 'saved-fallback',
      availabilityNote: fb.availabilityNote,
    });
  }

  // Respect explicit user preference: move a matching candidate to the front.
  if (preferenceId) {
    const idx = candidates.findIndex((c) => c.sourceId === preferenceId);
    if (idx > 0) candidates.unshift(candidates.splice(idx, 1)[0]);
  }

  const reasonCode = determiningConstraint(day, planned, floor);
  return Object.freeze({
    floor,
    hasOption: candidates.length > 0,
    recommended: candidates[0] || null,
    alternative: candidates[1] || null, // at most one, per R03
    all: candidates,
    determiningConstraint: reasonCode,
  });
}
