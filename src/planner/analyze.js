// analyze.js — turns the user's OWN logged activity + self check-ins into a
// visual, evidence-anchored read on how their week is tracking against THEIR
// goals, plus one prioritized next step. Deterministic and honest: it compares
// logged behavior to the goals the user chose and to general public-health
// guidance (each cited), and never diagnoses, scores health, infers a mental
// state, or estimates biological age.

import { weekProgress, weekDates, monthDates } from './goals.js';
import { suggestActivities } from './match.js';
import { CATEGORIES } from './state.js';
import { readConditions } from './conditions.js';

// General, cited guidance — the "scientific" anchor for recommendations. These
// are population guidelines, not personal prescriptions or outcome promises.
export const GUIDES = {
  moveMin: { text: 'WHO advises 150–300 min of moderate activity per week, plus muscle-strengthening on 2+ days.', source: 'WHO Physical Activity Guidelines (2020)' },
  mind: { text: 'Regular stress-reduction practice such as mindfulness or meditation is associated with better wellbeing.', source: 'US NCCIH' },
  sleep: { text: 'Adults are advised to get 7+ hours of sleep per night on a regular basis.', source: 'CDC / American Academy of Sleep Medicine' },
};
const SLEEP_FLOOR = 7;
const MOOD_WORDS = { 1: 'very low', 2: 'low', 3: 'okay', 4: 'good', 5: 'great' };
const ENERGY_WORDS = { 1: 'drained', 2: 'tired', 3: 'steady', 4: 'good', 5: 'charged' };
const MOVE_FLOOR = 150; // WHO weekly moderate-activity minimum
const STRENGTH_FLOOR = 2; // WHO muscle-strengthening days/week
const STRENGTH_RE = /strength|lift|weights?|resistance|pilates|squat|deadlift|push[- ]?up|pull[- ]?up|dumbbell|barbell|kettlebell/i;

function mean1(arr) { return arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null; }

function strengthDays(state, dates) {
  let days = 0;
  for (const d of dates) {
    const day = state.days[d];
    if (day && (day.activityLog || []).some((a) => a.category === 'movement' && STRENGTH_RE.test(a.text || ''))) days += 1;
  }
  return days;
}

// Compare the week's logged behavior to general public-health guidelines that
// are ASSOCIATED with healthy aging — independent of the user's personal goals.
// This is the honest stand-in for "overall health goals": behaviors with cited
// evidence, NOT a biological-age estimate, score, or claim about the user.
// status: 'meets' | 'partial' | 'below' | 'unknown'.
function guidelineChecks(state, iso, wk) {
  const out = [];
  out.push({ key: 'moveMin', label: 'Active minutes', target: 'WHO 150–300/wk',
    status: wk.moveMin >= MOVE_FLOOR ? 'meets' : (wk.moveMin > 0 ? 'partial' : 'below'),
    detail: `${wk.moveMin} min this week (floor ${MOVE_FLOOR})`, source: GUIDES.moveMin.source });

  const sd = strengthDays(state, wk.dates);
  out.push({ key: 'strength', label: 'Strength days', target: 'WHO 2+ days/wk', note: 'detected from your log text',
    status: sd >= STRENGTH_FLOOR ? 'meets' : (sd === 1 ? 'partial' : 'below'),
    detail: `${sd} day${sd !== 1 ? 's' : ''} this week`, source: GUIDES.moveMin.source });

  const sleepAvg = mean1(wk.sleeps);
  out.push({ key: 'sleep', label: 'Sleep', target: '7+ h/night',
    status: sleepAvg == null ? 'unknown' : (sleepAvg >= SLEEP_FLOOR ? 'meets' : 'below'),
    detail: sleepAvg == null ? 'no sleep logged' : `${sleepAvg} h average`, source: GUIDES.sleep.source });

  out.push({ key: 'mind', label: 'Stress-reduction practice', target: 'regular practice',
    status: wk.mindSessions > 0 ? 'meets' : 'below',
    detail: `${wk.mindSessions} session${wk.mindSessions !== 1 ? 's' : ''} this week`, source: GUIDES.mind.source });
  return out;
}

function weekAgg(state, iso) {
  const dates = weekDates(iso);
  let moveMin = 0; let moveSessions = 0; let mindSessions = 0;
  const sleeps = []; const series = [];
  for (const dt of dates) {
    const day = state.days[dt];
    let mood = null; let energy = null;
    if (day) {
      for (const a of day.activityLog || []) {
        if (a.category === 'movement') { moveSessions += 1; moveMin += a.durationMin || 0; }
        else if (CATEGORIES[a.category] && CATEGORIES[a.category].side === 'mental') { mindSessions += 1; }
      }
      if (day.health && typeof day.health.sleepHours === 'number') sleeps.push(day.health.sleepHours);
      if (day.checkin) { mood = day.checkin.mood; energy = day.checkin.energy; }
    }
    series.push({ date: dt, mood, energy });
  }
  const idx = Math.max(0, dates.indexOf(iso));
  return { dates, idx, elapsed: idx + 1, daysLeft: 7 - idx, moveMin, moveSessions, mindSessions, sleeps, series };
}

// Pace = progress relative to how much of the week has elapsed, so "behind"
// means behind schedule for the user's own weekly goal — not a health judgment.
function paceStatus(done, target, elapsed) {
  if (target <= 0) return { state: 'no-goal', behind: 0 };
  if (done >= target) return { state: 'met', behind: 0 };
  const expected = target * (elapsed / 7);
  const behind = Math.max(0, expected - done);
  let state;
  if (done >= expected * 0.9) state = 'on-pace';
  else if (done >= expected * 0.5) state = 'slightly-behind';
  else state = 'behind';
  return { state, behind };
}

// How often each saved activity appears in the user's logs over the last 30
// days (exact or contained title match). Returns a lookup fn(activity) → count.
export function activityUsage(state, iso, days = 30) {
  const [y, m, d] = iso.split('-').map(Number);
  const cutoff = new Date(y, m - 1, d - days);
  const cutIso = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  const texts = [];
  for (const [dt, day] of Object.entries(state.days || {})) {
    if (dt < cutIso || dt > iso) continue;
    for (const l of day.activityLog || []) texts.push(String(l.text || '').toLowerCase());
  }
  return (activity) => {
    const title = String(activity.title || '').toLowerCase();
    return title ? texts.filter((t) => t === title || t.includes(title)).length : 0;
  };
}

function metricsSummary(metrics) {
  return metrics.map((m) => (m.target > 0 ? `${m.label} ${m.done}/${m.target}` : `${m.label} (no goal)`)).join(' · ');
}

// opts.nowMin (minutes since midnight, only when viewing today) lets the
// contingency plan account for the current meeting and the time left today.
export function analyze(state, iso, opts = {}) {
  const cond = readConditions(state, iso, opts.nowMin != null ? opts.nowMin : null);
  const wk = weekAgg(state, iso);
  const prog = weekProgress(state, iso);

  const mk = (key, side, label, metric, guide, guideCap) => {
    const pace = paceStatus(metric.done, metric.target, wk.elapsed);
    return { key, side, label, done: metric.done, target: metric.target, pct: metric.pct, met: metric.met, status: pace.state, behind: Math.ceil(pace.behind), guideCap, guide };
  };
  const metrics = [
    mk('moveMin', 'physical', 'Movement minutes', prog.movementMinutes, GUIDES.moveMin, '150–300/wk · WHO'),
    mk('moveSessions', 'physical', 'Movement sessions', prog.movementSessions, null, 'your goal'),
    mk('mind', 'mental', 'Mind sessions', prog.mindfulnessSessions, GUIDES.mind, 'regular practice · NCCIH'),
  ];

  const sleepAvg = mean1(wk.sleeps);
  const sleep = { avg: sleepAvg, nights: wk.sleeps.length, below: sleepAvg != null && sleepAvg < SLEEP_FLOOR, floor: SLEEP_FLOOR, guide: GUIDES.sleep };

  const moods = wk.series.filter((s) => s.mood != null);
  const mood = {
    series: wk.series,
    avgMood: mean1(moods.map((s) => s.mood)),
    avgEnergy: mean1(moods.map((s) => s.energy)),
    count: moods.length,
    current: (state.days[iso] && state.days[iso].checkin) || null,
  };

  const anyGoal = metrics.some((m) => m.target > 0);
  // First saved activity in the PREFERRED category order; within a category, the
  // one the user has actually done most in the last 30 days (learned from their
  // own behavior), then shortest. suggestActivities alone sorts by duration only.
  const usage = activityUsage(state, iso);
  const pickSaved = (cats) => {
    // Contingency: outdoor movement is filtered out when it's indoors-only today.
    const sug = suggestActivities(state, iso, { categories: cats, indoorOnly: cond.indoorOnly }).suggestions || [];
    for (const c of cats) {
      const inCat = sug.filter((x) => x.activity.category === c);
      if (inCat.length) {
        return [...inCat].sort((a, b) => (usage(b.activity) - usage(a.activity)) || (a.activity.durationMin - b.activity.durationMin))[0].activity;
      }
    }
    return null;
  };

  // Rank behind-pace metrics; the furthest behind (relative to its goal) is the
  // primary next step. Each carries a cited rationale.
  const deficit = (m) => ((m.target > 0 && m.status !== 'met' && m.status !== 'on-pace') ? m.behind / m.target : -1);
  const [mmin, msess, mind] = metrics;
  const cands = [];
  const plural = wk.daysLeft !== 1 ? 's' : '';

  // Personalize to TODAY'S self-reported check-in (the user's own words, not an
  // inference). Every check-in maps to a mode across the full mood × energy grid:
  //   rest   — energy 1–2 (any mood): gentle and short; mind / wind-down lead
  //   lift   — mood 1–2, energy 3+: an easy mood-lift (music first, short walk)
  //   push   — energy 4–5 and mood 3+: movement leads, a bigger chunk
  //   steady — everything else: a manageable, moderate step
  const ci = state.days[iso] && state.days[iso].checkin;
  let mode = null;
  if (ci) {
    if (ci.energy <= 2) mode = 'rest';
    else if (ci.mood <= 2) mode = 'lift';
    else if (ci.energy >= 4) mode = 'push';
    else mode = 'steady';
  }
  const capacity = !mode ? 'unknown' : ({ rest: 'low', lift: 'low', push: 'high', steady: 'normal' })[mode];
  const moodWord = ci ? MOOD_WORDS[ci.mood] : null;
  const energyWord = ci ? ENERGY_WORDS[ci.energy] : null;
  const checkinNote = !mode ? '' : ({
    rest: `You said your energy is low today (${energyWord}), so I've kept this gentle and short.`,
    lift: `You said your mood is low today (${moodWord}) — something easy and uplifting can help, so I've picked a gentle mood-lift.`,
    push: `You said you're feeling ${moodWord} with ${energyWord} energy — a good moment to make real progress.`,
    steady: `You said you're feeling ${moodWord} with ${energyWord} energy, so here's a manageable step.`,
  })[mode];

  if (deficit(mind) >= 0) {
    // Low self-reported mood → offer the user's own mood-lift (music) option first.
    const act = pickSaved(mode === 'lift' ? ['music', 'meditation', 'winddown'] : (mode === 'rest' ? ['winddown', 'meditation'] : ['meditation', 'winddown']));
    cands.push({ kind: 'mind', score: deficit(mind) + 0.01, side: 'mental',
      title: act ? `Log “${act.title}” — a mind session` : (mode === 'lift' ? 'Put on music you love for 10 minutes' : 'Do a 10-min wind-down or meditation'),
      rationale: `You've logged ${mind.done} of ${mind.target} mind sessions this week — about ${mind.behind} behind pace with ${wk.daysLeft} day${plural} left. ${GUIDES.mind.text}`,
      source: GUIDES.mind.source, activity: act, addCat: act ? null : (mode === 'lift' ? 'music' : 'meditation') });
  }
  // Movement size follows the check-in: rest 10 · lift 15 · steady ≤20 · push ≤45 · no check-in ≤30.
  // The contingency plan caps it further: only what fits between being free and wind-down.
  let moveCap = { rest: 10, lift: 15, steady: 20, push: 45 }[mode] || 30;
  if (cond.windowMin > 0 && cond.windowMin < moveCap + 10) moveCap = Math.max(5, Math.floor((cond.windowMin - 5) / 5) * 5);
  const indoor = cond.indoorOnly;
  const moveTitle = (act, chunk) => {
    if (mode === 'rest') return act ? `Log “${act.title}” — keep it gentle (~${chunk} min)` : (indoor ? `Try a gentle ${chunk}-minute indoor stretch` : `Try a gentle ${chunk}-minute walk or stretch`);
    if (mode === 'lift') return act ? `Log “${act.title}” — a short one (~${chunk} min) can lift your mood` : (indoor ? `A short ${chunk}-minute indoor workout or dance — it can lift your mood` : `A short ${chunk}-minute walk, outside if you can`);
    return act ? `Log “${act.title}” (~${chunk} min)` : (indoor ? `Add about ${chunk} min of indoor movement` : `Add about ${chunk} min of movement`);
  };
  if (deficit(mmin) >= 0) {
    const chunk = (mode === 'rest' || mode === 'lift') ? moveCap : Math.min(Math.max(10, mmin.behind), moveCap);
    const act = pickSaved(['movement']);
    cands.push({ kind: 'move', score: deficit(mmin), side: 'physical', title: moveTitle(act, chunk),
      rationale: `You've logged ${mmin.done} of ${mmin.target} movement min this week — about ${mmin.behind} behind pace. ${GUIDES.moveMin.text}`,
      source: GUIDES.moveMin.source, activity: act, addCat: act ? null : 'movement' });
  } else if (deficit(msess) >= 0) {
    const act = pickSaved(['movement']);
    cands.push({ kind: 'move', score: deficit(msess), side: 'physical',
      title: act ? `Log “${act.title}”` : moveTitle(null, (mode === 'rest' || mode === 'lift') ? moveCap : 20),
      rationale: `You've logged ${msess.done} of ${msess.target} movement sessions this week — about ${msess.behind} behind pace. ${GUIDES.moveMin.text}`,
      source: GUIDES.moveMin.source, activity: act, addCat: act ? null : 'movement' });
  }
  if (sleep.below) {
    cands.push({ kind: 'sleep', score: 0.35, side: 'physical',
      title: 'Aim for an earlier wind-down tonight',
      rationale: `Your sleep is averaging ${sleep.avg} h over ${sleep.nights} night${sleep.nights !== 1 ? 's' : ''}; guidance suggests ${SLEEP_FLOOR}+. An earlier wind-down may help.`,
      source: GUIDES.sleep.source, activity: pickSaved(['winddown']), addCat: 'winddown' });
  }
  // Contingency: free too close to wind-down → no movement tonight; a short wind-down leads.
  if (cond.late) {
    for (const c of cands) if (c.kind === 'move') c.score -= 1;
    if (!cands.some((c) => c.kind === 'mind' || c.kind === 'sleep')) {
      const act = pickSaved(['winddown', 'meditation']);
      cands.push({ kind: 'late', score: 0.9, side: 'mental',
        title: act ? `Keep tonight easy — “${act.title}” before bed` : 'Keep tonight easy — a short wind-down before bed',
        rationale: `Vigorous exercise right before bed can make it harder for some people to settle, and a calm routine helps sleep. ${GUIDES.sleep.text}`,
        source: GUIDES.sleep.source, activity: act, addCat: act ? null : 'winddown' });
    }
  }
  for (const c of cands) {
    if (cond.late && (c.kind === 'mind' || c.kind === 'sleep')) c.score += 0.6;
    if (mode === 'rest' && (c.kind === 'mind' || c.kind === 'sleep')) c.score += 0.5;
    if (mode === 'lift') c.score += c.kind === 'mind' ? 0.5 : (c.kind === 'move' ? 0.25 : 0);
    if (mode === 'push' && c.kind === 'move') c.score += 0.5;
  }
  cands.sort((a, b) => b.score - a.score);
  // Lead with the contingency plan, then the check-in, then the evidence.
  const sentence = (parts) => (parts.length ? `${parts.join('; ').replace(/^./, (ch) => ch.toUpperCase())}.` : '');
  const condNote = sentence(cond.summary);
  if (cands[0] && checkinNote) cands[0].rationale = `${checkinNote} ${cands[0].rationale}`;
  if (cands[0] && condNote) cands[0].rationale = `${condNote} ${cands[0].rationale}`;

  let recommendations;
  let status;
  if (!anyGoal) {
    recommendations = [{ side: 'ok', title: 'Set your weekly goals to start tracking', rationale: 'Daywell compares what you log to goals you choose. Set movement and mind targets in Setup & Goals.', source: null, activity: null, addCat: null, goSetup: true }];
    status = { tone: 'warn', label: 'No goals set yet — choose your weekly targets' };
  } else if (cands.length === 0) {
    const metCount = metrics.filter((m) => m.met).length;
    const rec = { side: 'ok', title: metCount === metrics.filter((m) => m.target > 0).length ? 'All your goals are met this week — keep your routine' : 'You’re on pace with your goals — keep your routine', rationale: metricsSummary(metrics), source: null, activity: null, addCat: null };
    // On track, the check-in still decides what fits today.
    if (mode === 'rest') {
      const act = pickSaved(['winddown', 'meditation']);
      Object.assign(rec, { side: 'mental', title: act ? `You’re on track — unwind with “${act.title}”` : 'You’re on track — take it easy with a calm wind-down', activity: act, addCat: act ? null : 'winddown' });
    } else if (mode === 'lift') {
      const act = pickSaved(['music', 'meditation', 'winddown']);
      Object.assign(rec, { side: 'mental', title: act ? `You’re on track — lift your mood with “${act.title}”` : 'You’re on track — lift your mood with music you love', activity: act, addCat: act ? null : 'music' });
    } else if (mode === 'push') {
      const act = pickSaved(['movement']);
      Object.assign(rec, { side: 'physical', title: act ? `You’re on track — optional bonus: “${act.title}”` : 'You’re on track — an optional bonus walk while you’ve got the energy', activity: act, addCat: act ? null : 'movement' });
    }
    if (cond.late && mode !== 'rest' && mode !== 'lift') {
      const act = pickSaved(['winddown', 'meditation']);
      Object.assign(rec, { side: 'mental', title: act ? `You’re on track — keep tonight easy with “${act.title}”` : 'You’re on track — keep tonight easy with a short wind-down', activity: act, addCat: act ? null : 'winddown' });
    }
    if (checkinNote) rec.rationale = `${checkinNote} ${rec.rationale}`;
    if (condNote) rec.rationale = `${condNote} ${rec.rationale}`;
    recommendations = [rec];
    status = { tone: 'ok', label: metCount >= 2 ? 'On pace — goals on track this week' : 'On pace with your goals this week' };
  } else {
    recommendations = cands;
    const behindCount = metrics.filter((m) => m.target > 0 && (m.status === 'behind' || m.status === 'slightly-behind')).length;
    status = { tone: 'warn', label: `${behindCount} goal${behindCount !== 1 ? 's' : ''} behind pace — one small step below` };
  }
  // Timing from the contingency plan rides along so the UI can say "after 22:30".
  const when = cond.startsLater ? `after ${cond.freeFromText}` : null;
  recommendations = recommendations.slice(0, 3).map((r, i) => ({ ...r, priority: i === 0 ? 'primary' : 'secondary', when, indoor: cond.indoorOnly }));

  const guidelines = guidelineChecks(state, iso, wk);
  const guidelinesMet = guidelines.filter((g) => g.status === 'meets').length;

  const checkin = ci ? { mood: ci.mood, energy: ci.energy, moodWord, energyWord, mode } : null;
  return { status, metrics, guidelines, guidelinesMet, sleep, mood, capacity, checkin, conditions: cond, recommendations, elapsed: wk.elapsed, daysLeft: wk.daysLeft };
}

// ---------- period goals: day / week / month have different targets ----------

// Derives a period's targets from the user's WEEKLY goals. Day = today's share
// (minutes rounded to 5; at least 1 session when a weekly goal exists, since a
// session can't be split). Month = the week scaled to the month's length.
export function periodTargets(goals, dimension = 'week', daysInPeriod = 7) {
  const w = { sessions: goals.movementSessionsPerWeek, minutes: goals.movementMinutesPerWeek, mind: goals.mindfulnessSessionsPerWeek };
  if (dimension === 'week') return { ...w };
  const scale = dimension === 'day' ? 1 / 7 : daysInPeriod / 7;
  const sess = (v) => (v > 0 ? Math.max(1, Math.round(v * scale)) : 0);
  const mins = (v) => (v > 0 ? Math.max(5, Math.round((v * scale) / 5) * 5) : 0);
  return { sessions: sess(w.sessions), minutes: mins(w.minutes), mind: sess(w.mind) };
}

// Ring metrics for a period, same shape as analyze().metrics. Week delegates to
// analyze() unchanged. Day: no "pace" within a single day — met, or to go.
// Month: pace by how far through the month we are.
export function periodMetrics(state, iso, dimension = 'week') {
  if (dimension === 'week') return analyze(state, iso).metrics;
  const dates = dimension === 'day' ? [iso] : monthDates(iso);
  let moveMin = 0; let moveSessions = 0; let mind = 0;
  for (const dt of dates) {
    for (const a of (state.days[dt] && state.days[dt].activityLog) || []) {
      if (a.category === 'movement') { moveSessions += 1; moveMin += a.durationMin || 0; }
      else if (CATEGORIES[a.category] && CATEGORIES[a.category].side === 'mental') mind += 1;
    }
  }
  const t = periodTargets(state.profile.goals, dimension, dates.length);
  const frac = dimension === 'day' ? 1 : (Math.max(0, dates.indexOf(iso)) + 1) / dates.length;
  const cap = dimension === 'day' ? 'today’s share of your weekly goal' : `this month · ${dates.length} days`;
  const mk = (key, side, label, done, target, guideCap) => {
    const met = target > 0 && done >= target;
    let status;
    if (target <= 0) status = 'no-goal';
    else if (met) status = 'met';
    else if (dimension === 'day') status = 'open';
    else { const exp = target * frac; status = done >= exp * 0.9 ? 'on-pace' : (done >= exp * 0.5 ? 'slightly-behind' : 'behind'); }
    return { key, side, label, done, target, pct: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0, met, status, behind: Math.max(0, Math.ceil(target * frac - done)), guideCap };
  };
  return [
    mk('moveMin', 'physical', 'Movement minutes', moveMin, t.minutes, dimension === 'day' ? cap : `${cap} · WHO ≈150/wk`),
    mk('moveSessions', 'physical', 'Movement sessions', moveSessions, t.sessions, cap),
    mk('mind', 'mental', 'Mind sessions', mind, t.mind, cap),
  ];
}
