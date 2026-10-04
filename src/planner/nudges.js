// nudges.js — turns the analytical read (analyze.js) into one short, honest
// "how you're tracking" message, suitable for an in-app banner or a local
// reminder. Goal-based and descriptive ONLY: a nudge reflects the user's own
// logs vs their own goals (plus cited general guidance). It never comments on
// the user's health or mental state, never diagnoses, scores, or infers — and
// never claims anything about biological age.

import { analyze } from './analyze.js';
import { CATEGORIES } from './state.js';
import { readConditions } from './conditions.js';

// Given the user's routine anchors and the current minute-of-day, pick the
// activity category that fits this time of day + a short prompt. Deterministic;
// uses sensible defaults until the user sets their routine. No inference.
// Returns { category, slot, text } or null (overnight / unknown time).
export function timeTrigger(routine, nowMin) {
  if (nowMin == null) return null;
  const r = routine || {};
  const wake = r.wake != null ? r.wake : 7 * 60;
  const workStart = r.workStart != null ? r.workStart : 9 * 60;
  const workEnd = r.workEnd != null ? r.workEnd : 17 * 60;
  const winddown = r.winddown != null ? r.winddown : 22 * 60;
  if (nowMin < wake) return null; // overnight — don't nudge
  if (nowMin >= winddown) return { category: 'winddown', slot: 'wind-down', text: 'Time to wind down for sleep — a calm activity now helps tomorrow.' };
  if (nowMin < workStart) return { category: 'movement', slot: 'morning', text: 'Morning window before work — a good time to move.' };
  if (nowMin < workEnd) return { category: 'meditation', slot: 'workday', text: 'Midday — a short mindful break can reset a busy workday.' };
  return { category: 'winddown', slot: 'evening', text: 'Evening — ease into your wind-down routine.' };
}

// Returns { primary, nudges, status }. Each nudge: { kind, text, label, target }
// where target is a view name the UI can navigate to. Priority: set goals →
// time-of-day trigger → behind pace → missing check-in → all good. `nowMin` is
// the current minute-of-day (only meaningful when viewing today); omit for none.
export function buildNudges(state, iso, nowMin = null) {
  const a = analyze(state, iso);
  const day = state.days[iso];
  const rec = a.recommendations[0];
  const list = [];

  if (rec && rec.goSetup) {
    list.push({ kind: 'setup', text: 'Set your weekly goals so Daywell can track and nudge you.', label: 'Set goals', target: 'setup' });
  }

  // Time-of-day trigger: prompt the fitting activity, unless already logged today
  // — and never in the middle of a calendar commitment (meetings are protected).
  const trig = timeTrigger(state.profile && state.profile.routine, nowMin);
  const busy = trig && day ? (day.commitments || []).find((c) => nowMin >= c.start && nowMin < c.end) : null;
  if (busy) {
    // Contingency: if the note says it may run late, plan around the buffer.
    const cond = readConditions(state, iso, nowMin);
    const end = cond.busyUntil != null ? cond.busyUntil : busy.end;
    const hhmm = `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    const after = cond.late ? 'a short wind-down before bed is the best fit' : `a short ${CATEGORIES[trig.category].label.toLowerCase()} break could help${cond.indoorOnly ? ' (indoors)' : ''}`;
    list.push({ kind: 'busy', text: `You’re in “${busy.title || 'a commitment'}”${cond.runningLate ? ', which may run late,' : ''} until about ${hhmm} — I’ll hold suggestions till then. After that, ${after}.`, label: 'See options', target: 'plan' });
  } else if (trig) {
    const done = day && (day.activityLog || []).some((x) => x.category === trig.category);
    if (!done) list.push({ kind: 'time', text: `${trig.text} (${CATEGORIES[trig.category].label})`, label: 'See options', target: 'plan' });
  }

  if (a.status.tone === 'warn' && rec && !rec.goSetup) {
    list.push({ kind: 'goal', text: `${a.status.label}. Next: ${rec.title}.`, label: 'See next step', target: 'summary' });
  }
  if (!day || !day.checkin) {
    list.push({ kind: 'checkin', text: 'A 20-second check-in keeps today’s suggestions honest.', label: 'Check in', target: 'summary' });
  }
  if (!list.length) {
    list.push({ kind: 'ok', text: `${a.status.label}. Keep your routine.`, label: 'Open', target: 'summary' });
  }

  return { primary: list[0], nudges: list, status: a.status };
}
