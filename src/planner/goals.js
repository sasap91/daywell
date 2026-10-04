// Goals, progress, summaries, plan-matching — honest counting of the user's own
// logged activities against their own goals, split into physical (movement) and
// mental (meditation / wind-down / music). No health score or diagnosis.

import { localDateString } from '../time.js';
import { MIND_CATEGORIES } from './state.js';

function dateFromIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

export function weekDates(iso) {
  const base = dateFromIso(iso);
  const dow = (base.getDay() + 6) % 7;
  const monday = new Date(base);
  monday.setDate(base.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return localDateString(d); });
}

export function monthDates(iso) {
  const base = dateFromIso(iso);
  const y = base.getFullYear(); const m = base.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => localDateString(new Date(y, m, i + 1)));
}

const isMind = (c) => MIND_CATEGORIES.includes(c);

function aggregate(state, dates) {
  let moveSessions = 0; let moveMinutes = 0; let mindSessions = 0;
  for (const d of dates) {
    const day = state.days[d];
    if (!day) continue;
    for (const a of day.activityLog || []) {
      if (a.category === 'movement') { moveSessions += 1; moveMinutes += a.durationMin || 0; }
      else if (isMind(a.category)) { mindSessions += 1; }
    }
  }
  return { moveSessions, moveMinutes, mindSessions };
}

function metric(done, target) {
  return { done, target, pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0, met: target > 0 ? done >= target : done > 0 };
}

export function weekProgress(state, iso) {
  const dates = weekDates(iso);
  const a = aggregate(state, dates);
  const g = state.profile.goals;
  return {
    weekStart: dates[0], weekEnd: dates[6],
    movementSessions: metric(a.moveSessions, g.movementSessionsPerWeek),
    movementMinutes: metric(a.moveMinutes, g.movementMinutesPerWeek),
    mindfulnessSessions: metric(a.mindSessions, g.mindfulnessSessionsPerWeek),
  };
}

export function summarize(state, iso, dimension = 'week') {
  let dates; let label; let scale;
  if (dimension === 'day') { dates = [iso]; label = 'Today'; scale = 1 / 7; }
  else if (dimension === 'month') { dates = monthDates(iso); label = 'This month'; scale = dates.length / 7; }
  else { dates = weekDates(iso); label = 'This week'; scale = 1; }
  const a = aggregate(state, dates);
  const g = state.profile.goals;
  const t = (weekly) => Math.max(0, Math.round(weekly * scale));
  return {
    dimension, label, rangeStart: dates[0], rangeEnd: dates[dates.length - 1], scaledTargets: dimension !== 'week',
    movementSessions: metric(a.moveSessions, t(g.movementSessionsPerWeek)),
    movementMinutes: metric(a.moveMinutes, t(g.movementMinutesPerWeek)),
    mindfulnessSessions: metric(a.mindSessions, t(g.mindfulnessSessionsPerWeek)),
  };
}

export function matchVsPlan(state, iso) {
  const d = state.days[iso];
  if (!d) return { lines: [] };
  const plannedMoveMin = d.activities.filter((a) => a.category === 'movement').reduce((s, m) => s + (m.durationMin || 0), 0);
  const loggedMoveMin = d.activityLog.filter((a) => a.category === 'movement').reduce((s, m) => s + (m.durationMin || 0), 0);
  const plannedMind = d.activities.filter((a) => isMind(a.category)).length;
  const loggedMind = d.activityLog.filter((a) => isMind(a.category)).length;
  const verdict = (logged, planned) => {
    if (planned === 0) return logged > 0 ? 'logged (none planned)' : 'nothing planned or logged';
    if (logged >= planned) return 'on track with your plan';
    if (logged === 0) return 'nothing logged yet';
    return 'behind your plan';
  };
  return {
    lines: [
      { label: 'Movement minutes', planned: plannedMoveMin, logged: loggedMoveMin, unit: ' min', verdict: verdict(loggedMoveMin, plannedMoveMin) },
      { label: 'Mind sessions', planned: plannedMind, logged: loggedMind, unit: '', verdict: verdict(loggedMind, plannedMind) },
    ],
  };
}

// Descriptive health averages over a dimension — plain facts, not a score.
export function healthAverages(state, iso, dimension = 'week') {
  const dates = dimension === 'day' ? [iso] : (dimension === 'month' ? monthDates(iso) : weekDates(iso));
  const hr = []; const sleep = [];
  for (const d of dates) {
    const day = state.days[d];
    if (!day || !day.health) continue;
    if (typeof day.health.restingHR === 'number') hr.push(day.health.restingHR);
    if (typeof day.health.sleepHours === 'number') sleep.push(day.health.sleepHours);
  }
  const avg = (a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
  return {
    restingHR: avg(hr), restingHRDays: hr.length,
    sleepHours: avg(sleep), sleepDays: sleep.length,
  };
}

// A plain reflection of one day: what the user logged (physical vs mental) plus
// their own check-in and health facts. Descriptive only — no score, no inference
// about mood or mental state beyond what the user themselves reported.
export function todayReflection(state, iso) {
  const day = state.days[iso];
  const logs = (day && day.activityLog) || [];
  let physMin = 0; let physSessions = 0; let mentMin = 0; let mentSessions = 0;
  for (const a of logs) {
    if (a.category === 'movement') { physSessions += 1; physMin += a.durationMin || 0; }
    else if (isMind(a.category)) { mentSessions += 1; mentMin += a.durationMin || 0; }
  }
  const health = (day && day.health) || {};
  return {
    physMin, physSessions, mentMin, mentSessions,
    sleepHours: typeof health.sleepHours === 'number' ? health.sleepHours : null,
    restingHR: typeof health.restingHR === 'number' ? health.restingHR : null,
    checkin: (day && day.checkin) || null,
    hasActivity: physSessions > 0 || mentSessions > 0,
  };
}

export function nextSteps(state, iso) {
  const steps = [];
  const day = state.days[iso];
  const prog = weekProgress(state, iso);
  if (day) {
    if (!day.checkin) steps.push({ kind: 'checkin', text: 'Start with a quick check-in so suggestions fit how you feel.' });
    for (const a of day.activities.filter((x) => x.status === 'skipped')) steps.push({ kind: 'recovery', text: `"${a.title}" was skipped — set up a recovery option.`, ref: a.id });
    if (!day.activityLog.length && day.activities.length) steps.push({ kind: 'log', text: 'You planned activities but logged none yet — log what you did.' });
  }
  if (!prog.movementSessions.met && prog.movementSessions.target > 0) steps.push({ kind: 'goal', text: `Movement sessions this week: ${prog.movementSessions.done}/${prog.movementSessions.target}.` });
  if (!prog.mindfulnessSessions.met && prog.mindfulnessSessions.target > 0) steps.push({ kind: 'goal', text: `Mind sessions this week: ${prog.mindfulnessSessions.done}/${prog.mindfulnessSessions.target}.` });
  if (!steps.length) steps.push({ kind: 'ok', text: 'You are on track for today and this week. Nothing needs attention.' });
  return steps;
}
