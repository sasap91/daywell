// 20+ synthetic state-based cases (PRD §8). All hard-constraint cases must pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { H, makeDay } from './helpers.js';
import { checkPlacement } from '../src/supervisor.js';
import { computeReplacement } from '../src/skills/compute.js';
import { applyCandidate, undo } from '../src/skills/apply.js';
import { recordOutcome } from '../src/skills/outcome.js';
import { conflictWithPlanned, actionFloor, recordMeeting } from '../src/skills/context.js';
import { validateDay, OUTCOME } from '../src/model.js';
import { esc } from '../src/dom.js';
import { saveDay, loadDay, importDay, exportDay } from '../src/store.js';

// 1. Meeting overlap detected against planned action
test('01 meeting overrun conflicts with planned walk', () => {
  const day = makeDay({ meeting: { title: 'Team', start: H(18), end: H(18, 20) } });
  const c = conflictWithPlanned(day);
  assert.equal(c.conflict, true);
});

// 2. Non-conflicting meeting forces no change
test('02 earlier-ending meeting forces no change', () => {
  const day = makeDay({ planned: { start: H(18), bufferBeforeMin: 10 }, meeting: { title: 'Team', start: H(16), end: H(17) } });
  assert.equal(conflictWithPlanned(day).conflict, false);
});

// 3. PRD example: smaller fallback fits after overrun
test('03 PRD example offers 10-min fallback at 18:30', () => {
  const day = makeDay({
    commitments: [{ title: 'Protected', start: H(19), end: H(20) }],
    planned: { start: H(18), durationMin: 30, latestFinish: H(19), bufferBeforeMin: 10, bufferAfterMin: 10 },
    fallbacks: [{ title: 'Short walk', durationMin: 10 }],
    meeting: { title: 'Team', start: H(18), end: H(18, 20) },
  });
  const r = computeReplacement(day, { floor: actionFloor(day) });
  assert.equal(r.hasOption, true);
  assert.equal(r.recommended.isFallback, true);
  assert.equal(r.recommended.start, H(18, 30));
  assert.equal(r.recommended.end, H(18, 40));
});

// 4. Transition buffers respected (no start inside buffer of a commitment)
test('04 transition buffer after an action is enforced', () => {
  const day = makeDay({ commitments: [{ title: 'Call', start: H(18, 45), end: H(19) }], planned: { start: H(18, 30), durationMin: 10, bufferAfterMin: 10, latestFinish: H(20) } });
  // 18:30-18:40 + 10 after = 18:50 which reaches into call start 18:45 -> buffer fail
  const p = checkPlacement(day, { start: H(18, 30), durationMin: 10 });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'buffer');
});

// 5. Protected work never moved / overlapped
test('05 overlap with protected commitment rejected', () => {
  const day = makeDay({ commitments: [{ start: H(18), end: H(19) }] });
  const p = checkPlacement(day, { start: H(18, 30), durationMin: 20 });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'overlap');
});

// 6. No feasible slot -> No workable option
test('06 no workable option when day is full', () => {
  const day = makeDay({
    commitments: [{ start: H(18, 20), end: H(21) }],
    planned: { start: H(18), durationMin: 30, latestFinish: H(21) },
    meeting: { title: 'Team', start: H(18), end: H(18, 20) },
  });
  const r = computeReplacement(day, { floor: actionFloor(day) });
  assert.equal(r.hasOption, false);
  assert.equal(r.recommended, null);
});

// 7. Latest finish deadline enforced
test('07 candidate rejected past latest finish', () => {
  const day = makeDay({ planned: { start: H(20, 50), durationMin: 30, latestFinish: H(21) } });
  const p = checkPlacement(day, { start: H(20, 50), durationMin: 30 });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'deadline');
});

// 8. Unavailable meal fallback is excluded
test('08 unavailable fallback excluded from candidates', () => {
  const day = makeDay({
    planned: { start: H(18), durationMin: 60, latestFinish: H(19) },
    fallbacks: [{ title: 'Leftovers', kind: 'meal', durationMin: 10, available: false }],
    meeting: { title: 'Team', start: H(18), end: H(18, 20) },
  });
  const r = computeReplacement(day, { floor: actionFloor(day) });
  assert.equal(r.hasOption, false);
});

// 9. Deterministic: identical inputs -> identical candidate set
test('09 deterministic candidate set', () => {
  const build = () => makeDay({ fallbacks: [{ title: 'A', durationMin: 10 }, { title: 'B', durationMin: 15 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(19, 30) } });
  const r1 = computeReplacement(build(), { floor: H(18, 20) });
  const r2 = computeReplacement(build(), { floor: H(18, 20) });
  assert.deepEqual(r1.all.map((c) => c.id), r2.all.map((c) => c.id));
});

// 10. Every recommendation references a real option/window
test('10 recommendation references a saved action id', () => {
  const day = makeDay({ fallbacks: [{ id: 'fbX', title: 'Short walk', durationMin: 10 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(18, 55) } });
  const r = computeReplacement(day, { floor: H(18, 20) });
  assert.equal(r.recommended.sourceId, 'fbX');
});

// 11. Apply changes real plan state
test('11 accept updates applied + records ACCEPTED (not completion)', () => {
  const day = makeDay({ fallbacks: [{ title: 'Short walk', durationMin: 10 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(18, 55) } });
  const r = computeReplacement(day, { floor: H(18, 20) });
  const res = applyCandidate(day, r.recommended, { floor: H(18, 20) });
  assert.equal(res.ok, true);
  assert.equal(res.day.applied.title, 'Short walk');
  assert.equal(res.day.outcome.state, OUTCOME.ACCEPTED);
});

// 12. Repeated accept must not duplicate
test('12 repeated identical apply is idempotent', () => {
  const day = makeDay({ fallbacks: [{ title: 'Short walk', durationMin: 10 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(18, 55) } });
  const r = computeReplacement(day, { floor: H(18, 20) });
  const once = applyCandidate(day, r.recommended, { floor: H(18, 20) });
  const twice = applyCandidate(once.day, r.recommended, { floor: H(18, 20) });
  assert.equal(twice.reason, 'noop');
  assert.equal(twice.day.history.length, once.day.history.length);
});

// 13. Stale proposal (plan edited) is recomputed, not applied
test('13 stale proposal rejected when commitment added', () => {
  const day = makeDay({ fallbacks: [{ title: 'Short walk', durationMin: 10 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(18, 55) } });
  const r = computeReplacement(day, { floor: H(18, 20) });
  const edited = { ...day, commitments: [...day.commitments, { id: 'z', title: 'New', start: H(18, 30), end: H(18, 45), protected: true }] };
  const res = applyCandidate(edited, r.recommended, { floor: H(18, 20) });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'stale');
});

// 14. Undo restores previous affected block
test('14 undo restores previous applied state', () => {
  const day = makeDay({ fallbacks: [{ title: 'Short walk', durationMin: 10 }], meeting: { start: H(18), end: H(18, 20) }, planned: { start: H(18), durationMin: 30, latestFinish: H(18, 55) } });
  const r = computeReplacement(day, { floor: H(18, 20) });
  const applied = applyCandidate(day, r.recommended, { floor: H(18, 20) }).day;
  const reverted = undo(applied, { floor: H(18, 20) });
  assert.equal(reverted.ok, true);
  assert.equal(reverted.day.applied, null);
});

// 15. Undo blocked when previous block no longer valid
test('15 undo conflict leaves state unchanged', () => {
  const day = makeDay({ planned: { start: H(18), durationMin: 20, latestFinish: H(20) } });
  const withPrev = { ...day, applied: { sourceId: 'x', title: 'New', kind: 'movement', start: H(19), durationMin: 20, isFallback: false }, history: [{ prevApplied: { sourceId: 'y', title: 'Old', kind: 'movement', start: H(18), durationMin: 20, isFallback: false }, prevOutcome: null, at: null }] };
  const blocked = { ...withPrev, commitments: [{ id: 'c', title: 'Blocker', start: H(18), end: H(18, 30), protected: true }] };
  const res = undo(blocked, { floor: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'prev-invalid');
});

// 16. Acceptance is not completion
test('16 acceptance does not count as completed', () => {
  const day = makeDay();
  const res = recordOutcome({ ...day, applied: { isFallback: false } }, OUTCOME.ACCEPTED);
  assert.notEqual(res.day.outcome.state, OUTCOME.FULL_COMPLETED);
});

// 17. Fallback cannot claim full-action credit
test('17 fallback blocked from full-action credit', () => {
  const day = makeDay();
  const withFallback = { ...day, applied: { isFallback: true, title: 'Short walk' } };
  const res = recordOutcome(withFallback, OUTCOME.FULL_COMPLETED);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'fallback-cannot-claim-full');
});

// 18. Outcome survives reload and preserves event date
test('18 outcome persists across save/load with date', () => {
  const day = makeDay();
  const recorded = recordOutcome({ ...day, applied: { isFallback: false } }, OUTCOME.FULL_COMPLETED, 'done').day;
  saveDay(recorded);
  const loaded = loadDay();
  assert.equal(loaded.day.outcome.state, OUTCOME.FULL_COMPLETED);
  assert.equal(loaded.day.outcome.recordedForDate, '2026-10-04');
});

// 19. Malformed storage recovers gracefully
test('19 malformed day validates to a recoverable object', () => {
  const { day, errors } = validateDay({ date: 'not-a-date', commitments: [{ start: 'x', end: 5 }], planned: { durationMin: -1 } });
  assert.ok(day); // recovered, not thrown
  assert.ok(errors.length > 0);
});

// 20. Malicious-looking titles are rendered literally (escaped)
test('20 user titles are HTML-escaped', () => {
  const out = esc('<img src=x onerror=alert(1)>"evil"');
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img'));
  assert.ok(out.includes('&quot;'));
});

// 21. Invalid meeting time rejected
test('21 invalid overrun time rejected', () => {
  const res = recordMeeting(makeDay(), { title: 'X', start: H(19), end: H(18) });
  assert.equal(res.ok, false);
});

// 22. Midnight / cross-day: action cannot exceed day end
test('22 action cannot run past end of day', () => {
  const day = makeDay({ planned: { start: H(23, 50), durationMin: 30, latestFinish: 1440 } });
  const p = checkPlacement(day, { start: H(23, 50), durationMin: 30 });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'outside-day');
});

// 23. Preserve original in later feasible window preferred over fallback
test('23 original action preserved in later window when it fits', () => {
  const day = makeDay({
    planned: { start: H(18), durationMin: 30, latestFinish: H(20), bufferBeforeMin: 0, bufferAfterMin: 0 },
    fallbacks: [{ title: 'Short walk', durationMin: 10 }],
    meeting: { start: H(18), end: H(18, 20) },
  });
  const r = computeReplacement(day, { floor: H(18, 20) });
  assert.equal(r.recommended.isFallback, false);
  assert.equal(r.recommended.strategy, 'preserve-original');
  assert.equal(r.recommended.start, H(18, 20));
});

// 24. Export/import round-trips the plan
test('24 export then import preserves planned title', () => {
  const day = makeDay({ planned: { title: 'Evening walk' } });
  const text = exportDay(day);
  const res = importDay(text);
  assert.equal(res.day.planned.title, 'Evening walk');
});

// 25. Empty calendar is not proof of availability — still needs a saved option
test('25 no planned/fallback feasible -> no invented option', () => {
  const day = makeDay({
    planned: { start: H(18), durationMin: 400, latestFinish: H(19) }, // impossible duration
    fallbacks: [],
    meeting: { start: H(18), end: H(18, 20) },
  });
  const r = computeReplacement(day, { floor: actionFloor(day) });
  assert.equal(r.hasOption, false);
});

// 26. Save failure is surfaced, not reported as success
test('26 save failure reported when storage throws', () => {
  const orig = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  const res = saveDay(makeDay());
  globalThis.localStorage.setItem = orig;
  assert.equal(res.ok, false);
  assert.match(res.error, /quota/);
});
