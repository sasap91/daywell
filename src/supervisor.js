// Supervisor: the single source of truth for hard time constraints.
// Every suggestion, manual edit, and apply goes through checkPlacement;
// no other module (and no future model) may decide feasibility.

import { MINUTES_PER_DAY, overlaps } from './time.js';

export function sortedCommitments(day) {
  return [...day.commitments].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}

function fail(code, detail = {}) {
  return { ok: false, code, ...detail };
}

// Can an action of `durationMin` start at `start` on this day, honoring the
// user's buffers, latest finish, and every protected commitment?
export function checkPlacement(day, { start, durationMin }, { floor = 0 } = {}) {
  const planned = day.planned;
  if (!Number.isInteger(start) || !Number.isInteger(durationMin) || durationMin <= 0) {
    return fail('invalid-time');
  }
  const end = start + durationMin;
  if (start < floor) return fail('before-floor', { floor, end });
  if (start < 0 || end > MINUTES_PER_DAY) return fail('outside-day', { end });
  if (end > planned.latestFinish) return fail('deadline', { end });

  const bufferedStart = start - planned.bufferBeforeMin;
  const bufferedEnd = end + planned.bufferAfterMin;
  for (const commitment of sortedCommitments(day)) {
    if (overlaps(start, end, commitment.start, commitment.end)) {
      return fail('overlap', { commitment, end });
    }
    if (overlaps(bufferedStart, bufferedEnd, commitment.start, commitment.end)) {
      return fail('buffer', { commitment, side: commitment.end <= start ? 'before' : 'after', end });
    }
  }
  return { ok: true, start, end };
}
