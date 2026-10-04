// Skill: explanation. Pure string formatting from structured facts only.
// It never asserts allergen safety, nutrition adequacy, workout equivalence,
// or invents facts — it only names the real window and the entered constraint.

import { formatRange, formatClock } from '../time.js';

const CONSTRAINT_TEXT = {
  deadline: 'it would finish after your latest acceptable finish time',
  overlap: 'it would overlap a protected commitment',
  buffer: 'it would leave less than your entered transition buffer',
  'before-floor': 'the meeting now ends after its original start',
  'outside-day': 'it would fall outside the day',
  'invalid-time': 'the entered time was invalid',
};

export function explainCandidate(candidate, result) {
  if (!candidate) return '';
  const window = formatRange(candidate.start, candidate.end);
  if (candidate.strategy === 'preserve-original') {
    const because = result.determiningConstraint
      ? ` The original time no longer fits because ${CONSTRAINT_TEXT[result.determiningConstraint] || 'of an entered constraint'}.`
      : '';
    return `Keep "${candidate.title}" (${candidate.durationMin} min) at ${window} — the next window that fits your buffers and finish time.${because}`;
  }
  const note = candidate.availabilityNote ? ` You marked this available: ${candidate.availabilityNote}.` : '';
  return `Your saved ${candidate.durationMin}-minute option "${candidate.title}" fits at ${window}.${note}`;
}

export function explainNoOption(result, day) {
  const reason = CONSTRAINT_TEXT[result.determiningConstraint];
  const detail = reason ? ` after the meeting change, ${reason}` : '';
  return `No workable option today — the remaining windows before ${formatClock(day.planned.latestFinish)} are too short or blocked${detail}. You can defer this action or edit your plan.`;
}
