// analyze.js — turns the user's OWN logged activity + self check-ins into a
// visual, evidence-anchored read on how their week is tracking against THEIR
// goals, plus one prioritized next step. Deterministic and honest: it compares
// logged behavior to the goals the user chose and to general public-health
// guidance (each cited), and never diagnoses, scores health, infers a mental
// state, or estimates biological age.

import { weekProgress, weekDates } from './goals.js';
import { suggestActivities } from './match.js';
import { CATEGORIES } from './state.js';

// General, cited guidance — the "scientific" anchor for recommendations. These
// are population guidelines, not personal prescriptions or outcome promises.
export const GUIDES = {
  moveMin: { text: 'WHO advises 150–300 min of moderate activity per week, plus muscle-strengthening on 2+ days.', source: 'WHO Physical Activity Guidelines (2020)' },
  mind: { text: 'Regular stress-reduction practice such as mindfulness or meditation is associated with better wellbeing.', source: 'US NCCIH' },
  sleep: { text: 'Adults are advised to get 7+ hours of sleep per night on a regular basis.', source: 'CDC / American Academy of Sleep Medicine' },
};
const SLEEP_FLOOR = 7;
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

function metricsSummary(metrics) {
  return metrics.map((m) => (m.target > 0 ? `${m.label} ${m.done}/${m.target}` : `${m.label} (no goal)`)).join(' · ');
}

export function analyze(state, iso) {
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
  // First saved activity in the PREFERRED category order (suggestActivities sorts
  // by duration only, which would otherwise ignore the preference).
  const pickSaved = (cats) => {
    const sug = suggestActivities(state, iso, { categories: cats }).suggestions || [];
    for (const c of cats) { const m = sug.find((x) => x.activity.category === c); if (m) return m.activity; }
    return null;
  };

  // Rank behind-pace metrics; the furthest behind (relative to its goal) is the
  // primary next step. Each carries a cited rationale.
  const deficit = (m) => ((m.target > 0 && m.status !== 'met' && m.status !== 'on-pace') ? m.behind / m.target : -1);
  const [mmin, msess, mind] = metrics;
  const cands = [];
  const plural = wk.daysLeft !== 1 ? 's' : '';

  // Personalize to TODAY'S self-reported check-in (the user's own words, not an
  // inference): low energy/mood → gentler options lead; good energy → movement.
  const ci = state.days[iso] && state.days[iso].checkin;
  let capacity = 'unknown';
  if (ci) capacity = (ci.energy <= 2 || ci.mood <= 2) ? 'low' : ((ci.energy >= 4 && ci.mood >= 3) ? 'high' : 'normal');
  const lowWhat = ci && ci.energy <= 2 ? 'energy' : 'mood';

  if (deficit(mind) >= 0) {
    // Low self-reported mood → offer the user's own mood-lift (music) option first.
    const act = pickSaved(capacity === 'low' && lowWhat === 'mood' ? ['music', 'meditation', 'winddown'] : ['meditation', 'winddown']);
    cands.push({ kind: 'mind', score: deficit(mind) + 0.01, side: 'mental',
      title: act ? `Log “${act.title}” — a mind session` : 'Do a 10-min wind-down or meditation',
      rationale: `You've logged ${mind.done} of ${mind.target} mind sessions this week — about ${mind.behind} behind pace with ${wk.daysLeft} day${plural} left. ${GUIDES.mind.text}`,
      source: GUIDES.mind.source, activity: act, addCat: act ? null : 'meditation' });
  }
  if (deficit(mmin) >= 0) {
    const gentle = capacity === 'low';
    const chunk = gentle ? 10 : Math.min(Math.max(10, mmin.behind), 30); const act = pickSaved(['movement']);
    cands.push({ kind: 'move', score: deficit(mmin), side: 'physical',
      title: gentle ? (act ? `Log “${act.title}” — keep it gentle (~10 min)` : 'Try a gentle 10-minute walk or stretch') : (act ? `Log “${act.title}” (~${chunk} min)` : `Add about ${chunk} min of movement`),
      rationale: `You've logged ${mmin.done} of ${mmin.target} movement min this week — about ${mmin.behind} behind pace. ${GUIDES.moveMin.text}`,
      source: GUIDES.moveMin.source, activity: act, addCat: act ? null : 'movement' });
  } else if (deficit(msess) >= 0) {
    const act = pickSaved(['movement']);
    cands.push({ kind: 'move', score: deficit(msess), side: 'physical',
      title: act ? `Log “${act.title}”` : (capacity === 'low' ? 'Try a gentle 10-minute walk' : 'Fit in a movement session'),
      rationale: `You've logged ${msess.done} of ${msess.target} movement sessions this week — about ${msess.behind} behind pace. ${GUIDES.moveMin.text}`,
      source: GUIDES.moveMin.source, activity: act, addCat: act ? null : 'movement' });
  }
  if (sleep.below) {
    cands.push({ kind: 'sleep', score: 0.35, side: 'physical',
      title: 'Aim for an earlier wind-down tonight',
      rationale: `Your sleep is averaging ${sleep.avg} h over ${sleep.nights} night${sleep.nights !== 1 ? 's' : ''}; guidance suggests ${SLEEP_FLOOR}+. An earlier wind-down may help.`,
      source: GUIDES.sleep.source, activity: pickSaved(['winddown']), addCat: 'winddown' });
  }
  for (const c of cands) {
    if (capacity === 'low' && (c.kind === 'mind' || c.kind === 'sleep')) c.score += 0.5;
    if (capacity === 'high' && c.kind === 'move') c.score += 0.5;
  }
  cands.sort((a, b) => b.score - a.score);
  if (cands[0] && capacity === 'low') cands[0].rationale = `You said your ${lowWhat} is low today, so I've kept this gentle. ${cands[0].rationale}`;
  if (cands[0] && capacity === 'high' && cands[0].kind === 'move') cands[0].rationale = `You said you've got good energy today — a good moment to move. ${cands[0].rationale}`;

  let recommendations;
  let status;
  if (!anyGoal) {
    recommendations = [{ side: 'ok', title: 'Set your weekly goals to start tracking', rationale: 'Daywell compares what you log to goals you choose. Set movement and mind targets in Setup & Goals.', source: null, activity: null, addCat: null, goSetup: true }];
    status = { tone: 'warn', label: 'No goals set yet — choose your weekly targets' };
  } else if (cands.length === 0) {
    const metCount = metrics.filter((m) => m.met).length;
    recommendations = [{ side: 'ok', title: metCount === metrics.filter((m) => m.target > 0).length ? 'All your goals are met this week — keep your routine' : 'You’re on pace with your goals — keep your routine', rationale: metricsSummary(metrics), source: null, activity: null, addCat: null }];
    status = { tone: 'ok', label: metCount >= 2 ? 'On pace — goals on track this week' : 'On pace with your goals this week' };
  } else {
    recommendations = cands;
    const behindCount = metrics.filter((m) => m.target > 0 && (m.status === 'behind' || m.status === 'slightly-behind')).length;
    status = { tone: 'warn', label: `${behindCount} goal${behindCount !== 1 ? 's' : ''} behind pace — one small step below` };
  }
  recommendations = recommendations.slice(0, 3).map((r, i) => ({ ...r, priority: i === 0 ? 'primary' : 'secondary' }));

  const guidelines = guidelineChecks(state, iso, wk);
  const guidelinesMet = guidelines.filter((g) => g.status === 'meets').length;

  return { status, metrics, guidelines, guidelinesMet, sleep, mood, capacity, recommendations, elapsed: wk.elapsed, daysLeft: wk.daysLeft };
}
