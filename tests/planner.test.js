// Planner logic (mind + body): goals/progress, summaries, matching, assistant
// suggestions, contingency recovery, upload parsing, state validation/migration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { defaultState, validateState, ensureDay } from '../src/planner/state.js';
import { weekDates, weekProgress, nextSteps, summarize, matchVsPlan, todayReflection } from '../src/planner/goals.js';
import { suggestActivities } from '../src/planner/match.js';
import { recoverActivity } from '../src/planner/recovery.js';
import { parseMovementUpload, parseHealthExport, isAppleHealthExport } from '../src/planner/ingest.js';
import { parseSpoken, detectDuration, detectCategories } from '../src/planner/parse.js';
import { healthAverages } from '../src/planner/goals.js';

function stateWith(fn) { const s = defaultState(); fn(s); return s; }
const H = (h, m = 0) => h * 60 + m;
const lib = (over) => ({ id: over.id || 'x', category: over.category || 'movement', title: over.title || 'A', durationMin: over.durationMin || 20, indoor: over.indoor === true, tags: over.tags || [] });
const log = (over) => ({ id: over.id || 'l', category: over.category || 'movement', text: over.text || 't', durationMin: over.durationMin || 0, source: over.source || 'text', at: '' });

// 39. Week spans Monday..Sunday and includes the date
test('39 weekDates is Monday..Sunday', () => {
  const dates = weekDates('2026-10-04');
  assert.equal(dates[0], '2026-09-28');
  assert.equal(dates[6], '2026-10-04');
});

// 40. Progress splits physical (movement) and mental (mind) by category
test('40 progress counts movement and mind sessions separately', () => {
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 2, movementMinutesPerWeek: 30, mindfulnessSessionsPerWeek: 2 };
    const d = ensureDay(st, '2026-10-02');
    d.activityLog = [log({ id: 'a', category: 'movement', durationMin: 20 }), log({ id: 'b', category: 'movement', durationMin: 15 }),
                     log({ id: 'c', category: 'meditation' }), log({ id: 'd', category: 'music' })];
  });
  const p = weekProgress(s, '2026-10-04');
  assert.equal(p.movementSessions.done, 2);
  assert.equal(p.movementMinutes.done, 35);
  assert.equal(p.mindfulnessSessions.done, 2); // meditation + music
  assert.equal(p.mindfulnessSessions.met, true);
});

// 41. summarize scales targets by dimension
test('41 summarize day scales from weekly goal', () => {
  const s = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 7, movementMinutesPerWeek: 70, mindfulnessSessionsPerWeek: 7 }; ensureDay(st, '2026-10-04').activityLog = [log({ category: 'movement', durationMin: 10 })]; });
  const d = summarize(s, '2026-10-04', 'day');
  assert.equal(d.movementSessions.target, 1);
  assert.equal(d.movementSessions.met, true);
});

// 42. matchVsPlan reports movement + mind lines
test('42 matchVsPlan compares logged to plan', () => {
  const s = stateWith((st) => {
    const d = ensureDay(st, '2026-10-04');
    d.activities = [{ id: 'p', libraryId: null, category: 'movement', title: 'Walk', durationMin: 30, indoor: false, status: 'planned', note: '', recordedAt: null, contingencyOf: null }];
    d.activityLog = [log({ category: 'movement', durationMin: 10 })];
  });
  const m = matchVsPlan(s, '2026-10-04');
  assert.equal(m.lines[0].verdict, 'behind your plan');
});

// 43. suggestActivities filters by category
test('43 suggestActivities filters by category', () => {
  const s = stateWith((st) => { st.library.activities = [lib({ id: 'm', category: 'movement', title: 'Run' }), lib({ id: 'z', category: 'meditation', title: 'Breathe' })]; });
  const r = suggestActivities(s, '2026-10-04', { categories: ['meditation'] });
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0].activity.title, 'Breathe');
});

// 48. Recovery: movement placed around a commitment
test('48 recovery places movement around a commitment', () => {
  const s = stateWith((st) => {
    st.library.activities = [lib({ id: 'y', category: 'movement', title: 'Home yoga', durationMin: 15, indoor: true })];
    const d = ensureDay(st, '2026-10-04');
    d.activities = [{ id: 'fail', libraryId: null, category: 'movement', title: 'Run', durationMin: 30, indoor: false, status: 'skipped', note: '', recordedAt: null, contingencyOf: null }];
    d.commitments = [{ id: 'c', title: 'Mtg', start: H(18), end: H(19), protected: true }];
  });
  const r = recoverActivity(s, '2026-10-04', 'fail', { indoorOnly: true, floor: H(17) });
  assert.equal(r.hasOption, true);
  assert.equal(r.window.start, H(17));
});

// 49. Recovery: mental activity needs no time window
test('49 recovery of meditation offers anytime option', () => {
  const s = stateWith((st) => {
    st.library.activities = [lib({ id: 'b', category: 'meditation', title: 'Box breathing', durationMin: 5 })];
    const d = ensureDay(st, '2026-10-04');
    d.activities = [{ id: 'fail', libraryId: null, category: 'meditation', title: 'Evening meditation', durationMin: 20, indoor: false, status: 'skipped', note: '', recordedAt: null, contingencyOf: null }];
  });
  const r = recoverActivity(s, '2026-10-04', 'fail');
  assert.equal(r.hasOption, true);
  assert.equal(r.window, null);
  assert.equal(r.recommended.title, 'Box breathing');
});

// 50. Upload JSON parses movement entries
test('50 ingest JSON', () => {
  const r = parseMovementUpload('[{"type":"Walk","minutes":20}]', 'w.json');
  assert.equal(r.entries[0].durationMin, 20);
});

// 51. Upload CSV parses
test('51 ingest CSV', () => {
  const r = parseMovementUpload('activity,minutes\nRun,30', 'd.csv');
  assert.equal(r.ok, true);
  assert.equal(r.entries[0].text, 'Run');
});

// 52. Upload Apple Health workout xml (seconds -> minutes)
test('52 ingest Apple Health xml', () => {
  const r = parseMovementUpload('<HealthData><Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1200" durationUnit="s"/></HealthData>', 'export.xml');
  assert.equal(r.entries[0].text, 'Running');
  assert.equal(r.entries[0].durationMin, 20);
});

// 53. nextSteps asks for a check-in when none yet
test('53 nextSteps prompts check-in', () => {
  const s = stateWith((st) => { ensureDay(st, '2026-10-04'); });
  const steps = nextSteps(s, '2026-10-04');
  assert.ok(steps.some((x) => x.kind === 'checkin'));
});

// 54. Migration: v6 movement-only state maps into categorized activities
test('54 migrates v6 movements into movement-category activities', () => {
  const { state } = validateState({
    schema: 6,
    profile: { goals: { movementSessionsPerWeek: 4, movementMinutesPerWeek: 120 } },
    library: { movements: [{ id: 'v', title: 'Walk', durationMin: 20, indoor: false, tags: [] }] },
    days: { '2026-10-04': { movements: [{ title: 'Jog', durationMin: 25 }], movementLog: [{ text: 'Walk', durationMin: 20 }] } },
  });
  assert.equal(state.library.activities[0].category, 'movement');
  assert.equal(state.profile.goals.mindfulnessSessionsPerWeek, 3);
  assert.equal(state.days['2026-10-04'].activities[0].category, 'movement');
  assert.equal(state.days['2026-10-04'].activityLog[0].category, 'movement');
});

// 55. Voice parse: category + duration from a spoken phrase
test('55 parseSpoken extracts category and minutes', () => {
  assert.deepEqual(parseSpoken('I meditated for 10 minutes').category, 'meditation');
  assert.equal(parseSpoken('I meditated for 10 minutes').durationMin, 10);
  assert.equal(parseSpoken('went for a 1 hour run').category, 'movement');
  assert.equal(parseSpoken('went for a 1 hour run').durationMin, 60);
  assert.equal(parseSpoken('listened to an uplifting playlist for 15 min').category, 'music');
});

// 56. Apple Health export: resting HR + sleep + workout, date-attributed
test('56 parseHealthExport reads HR, sleep, workouts by date', () => {
  const xml = `<HealthData>
    <Record type="HKQuantityTypeIdentifierRestingHeartRate" value="56" startDate="2026-10-04 07:00:00 -0700" endDate="2026-10-04 07:00:00 -0700"/>
    <Record type="HKQuantityTypeIdentifierRestingHeartRate" value="60" startDate="2026-10-04 20:00:00 -0700" endDate="2026-10-04 20:00:00 -0700"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-10-04 23:00:00 -0700" endDate="2026-10-05 01:00:00 -0700"/>
    <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1800" durationUnit="s" startDate="2026-10-04 18:00:00 -0700"/>
  </HealthData>`;
  assert.equal(isAppleHealthExport(xml, 'export.xml'), true);
  const r = parseHealthExport(xml);
  assert.equal(r.ok, true);
  assert.equal(r.healthByDate['2026-10-04'].restingHR, 58); // (56+60)/2
  assert.equal(r.healthByDate['2026-10-04'].sleepHours, 2);  // 23:00 -> 01:00
  assert.equal(r.workoutsByDate['2026-10-04'][0].text, 'Running');
  assert.equal(r.workoutsByDate['2026-10-04'][0].durationMin, 30);
});

// 57. Health averages are descriptive means over the dimension
test('57 healthAverages computes means', () => {
  const s = stateWith((st) => {
    const d1 = ensureDay(st, '2026-09-28'); d1.health = { restingHR: 60, sleepHours: 7, source: 'manual' };
    const d2 = ensureDay(st, '2026-09-29'); d2.health = { restingHR: 64, sleepHours: 8, source: 'manual' };
  });
  const a = healthAverages(s, '2026-10-04', 'week'); // same Mon–Sun week as those dates
  assert.equal(a.restingHR, 62);
  assert.equal(a.sleepHours, 7.5);
  assert.equal(a.restingHRDays, 2);
});

// 58. Spelled-out durations parse to minutes
test('58 detectDuration reads spelled-out numbers', () => {
  assert.equal(detectDuration('ten minute meditation'), 10);
  assert.equal(detectDuration('mindful breathing twenty minutes'), 20);
  assert.equal(detectDuration('forty five minutes of yoga'), 45);
  assert.equal(detectDuration('went for a walk for an hour'), 60);
  assert.equal(detectDuration('read for half an hour'), 30);
  assert.equal(detectDuration('quarter of an hour stretch'), 15);
});

// 59. Digit durations still parse (incl. hours + minutes combined)
test('59 detectDuration reads digits and combined units', () => {
  assert.equal(detectDuration('30 min walk'), 30);
  assert.equal(detectDuration('1.5 hrs cycling'), 90);
  assert.equal(detectDuration('1 hour 30 minutes hike'), 90);
});

// 60. Stray numbers are NOT read as a duration (no blind bare-number grab)
test('60 detectDuration ignores non-duration numbers', () => {
  assert.equal(detectDuration('ran 5k'), 0);
  assert.equal(detectDuration('gym at 6'), 0);
  assert.equal(detectDuration('4-7-8 breathing for a few minutes'), 0);
  assert.equal(detectDuration('strength training'), 0);
});

// 61. Mixed-activity text exposes all detected categories (primary first)
test('61 detectCategories surfaces mixed entries', () => {
  assert.deepEqual(detectCategories('walk and then meditate'), ['meditation', 'movement']);
  assert.deepEqual(parseSpoken('30 min walk').categories, ['movement']);
  assert.equal(parseSpoken('walk and meditate').category, 'meditation');
});

// 62. todayReflection splits logged activity into physical vs mental + self-report
test('62 todayReflection reflects logs and check-in descriptively', () => {
  const s = stateWith((st) => {
    const d = ensureDay(st, '2026-10-04');
    d.activityLog = [
      log({ category: 'movement', durationMin: 30 }),
      log({ category: 'meditation', durationMin: 10 }),
      log({ category: 'winddown', durationMin: 0 }),
    ];
    d.health = { restingHR: 58, sleepHours: 7, source: 'manual' };
    d.checkin = { mood: 3, energy: 3, note: 'Feeling anxious about the next call', at: '' };
  });
  const r = todayReflection(s, '2026-10-04');
  assert.equal(r.physMin, 30);
  assert.equal(r.physSessions, 1);
  assert.equal(r.mentSessions, 2);
  assert.equal(r.mentMin, 10);
  assert.equal(r.sleepHours, 7);
  assert.equal(r.restingHR, 58);
  assert.equal(r.hasActivity, true);
  assert.equal(r.checkin.note, 'Feeling anxious about the next call');
});

// 63. todayReflection on an empty day reports nothing logged
test('63 todayReflection empty day', () => {
  const r = todayReflection(defaultState(), '2026-10-04');
  assert.equal(r.hasActivity, false);
  assert.equal(r.physSessions, 0);
  assert.equal(r.mentSessions, 0);
  assert.equal(r.checkin, null);
});

// 64. analyze: behind-pace week surfaces a prioritized, cited next step
test('64 analyze flags behind-pace goals with evidence-anchored recs', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 3, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    const d = ensureDay(st, '2026-10-08'); // Thursday → 4 days into the week
    d.activityLog = [log({ category: 'movement', durationMin: 20 }), log({ category: 'meditation' })];
  });
  const a = analyze(s, '2026-10-08');
  const mind = a.metrics.find((m) => m.key === 'mind');
  assert.equal(mind.done, 1);
  assert.equal(mind.target, 6);
  assert.equal(a.status.tone, 'warn');
  assert.ok(a.recommendations.length >= 1);
  assert.equal(a.recommendations[0].priority, 'primary');
  assert.ok(a.recommendations.some((r) => r.source)); // at least one cites a guideline
});

// 65. analyze: met goals → on-pace status and a single maintain rec
test('65 analyze reports on track when goals are met', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 1, movementMinutesPerWeek: 10, mindfulnessSessionsPerWeek: 1 };
    const d = ensureDay(st, '2026-10-06');
    d.activityLog = [log({ category: 'movement', durationMin: 15 }), log({ category: 'winddown' })];
  });
  const a = analyze(s, '2026-10-06');
  assert.equal(a.status.tone, 'ok');
  assert.equal(a.recommendations.length, 1);
  assert.equal(a.recommendations[0].priority, 'primary');
});

// 66. analyze: no goals set → prompts the user to set goals
test('66 analyze prompts to set goals when none exist', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const s = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 0, movementMinutesPerWeek: 0, mindfulnessSessionsPerWeek: 0 }; });
  const a = analyze(s, '2026-10-04');
  assert.equal(a.recommendations[0].goSetup, true);
});

// 67. buildNudges turns the week's tracking into one honest, goal-based nudge
test('67 buildNudges prioritises behind-pace, then check-in, then ok', async () => {
  const { buildNudges } = await import('../src/planner/nudges.js');
  // behind pace → goal nudge first
  const behind = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    ensureDay(st, '2026-10-08').activityLog = [log({ category: 'movement', durationMin: 10 })];
  });
  assert.equal(buildNudges(behind, '2026-10-08').primary.kind, 'goal');

  // no goals set → setup nudge
  const noGoals = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 0, movementMinutesPerWeek: 0, mindfulnessSessionsPerWeek: 0 }; });
  assert.equal(buildNudges(noGoals, '2026-10-04').primary.kind, 'setup');

  // on pace but no check-in → check-in nudge
  const noCheckin = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 1, movementMinutesPerWeek: 10, mindfulnessSessionsPerWeek: 1 };
    ensureDay(st, '2026-10-06').activityLog = [log({ category: 'movement', durationMin: 15 }), log({ category: 'winddown' })];
  });
  assert.equal(buildNudges(noCheckin, '2026-10-06').primary.kind, 'checkin');

  // on pace and checked in → ok
  const ok = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 1, movementMinutesPerWeek: 10, mindfulnessSessionsPerWeek: 1 };
    const d = ensureDay(st, '2026-10-06');
    d.activityLog = [log({ category: 'movement', durationMin: 15 }), log({ category: 'winddown' })];
    d.checkin = { mood: 4, energy: 4, note: '', at: '' };
  });
  assert.equal(buildNudges(ok, '2026-10-06').primary.kind, 'ok');
});

// 68. analyze compares to healthy-aging guidelines, not just personal goals
test('68 analyze adds healthy-aging guideline checks', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 300, mindfulnessSessionsPerWeek: 5 };
    const d = ensureDay(st, '2026-10-08');
    d.activityLog = [
      log({ category: 'movement', text: 'strength training', durationMin: 60 }),
      log({ category: 'meditation', text: 'breathing' }),
    ];
    d.health = { restingHR: 58, sleepHours: 6, source: 'manual' };
  });
  const a = analyze(s, '2026-10-08');
  const by = Object.fromEntries(a.guidelines.map((g) => [g.key, g]));
  assert.equal(by.moveMin.status, 'partial');   // 60 min < 150 floor, but > 0
  assert.equal(by.strength.status, 'partial');  // 1 strength day detected (needs 2)
  assert.equal(by.sleep.status, 'below');       // 6h < 7
  assert.equal(by.mind.status, 'meets');        // has a stress-reduction session
  assert.equal(a.guidelinesMet, 1);             // only mind meets
  assert.equal(a.guidelines.length, 4);
});

// 69. timeTrigger picks the activity that fits the time of day
test('69 timeTrigger maps time of day to a category', async () => {
  const { timeTrigger } = await import('../src/planner/nudges.js');
  const routine = { wake: 7 * 60, workStart: 9 * 60, workEnd: 17 * 60, winddown: 22 * 60 };
  assert.equal(timeTrigger(routine, 6 * 60), null);            // before wake → no nudge
  assert.equal(timeTrigger(routine, 8 * 60).category, 'movement');   // morning
  assert.equal(timeTrigger(routine, 13 * 60).category, 'meditation'); // workday
  assert.equal(timeTrigger(routine, 19 * 60).category, 'winddown');   // evening
  assert.equal(timeTrigger(routine, 23 * 60).category, 'winddown');   // wind-down
  assert.equal(timeTrigger(routine, 23 * 60).slot, 'wind-down');
  assert.equal(timeTrigger({}, 8 * 60).category, 'movement');  // defaults when unset
});

// 70. buildNudges surfaces a time trigger, and suppresses it once that category is logged
test('70 buildNudges includes time-of-day trigger', async () => {
  const { buildNudges } = await import('../src/planner/nudges.js');
  const base = (fn) => stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 1, movementMinutesPerWeek: 10, mindfulnessSessionsPerWeek: 1 };
    st.profile.routine = { wake: 7 * 60, workStart: 9 * 60, workEnd: 17 * 60, winddown: 22 * 60, note: '' };
    const d = ensureDay(st, '2026-10-06');
    d.checkin = { mood: 4, energy: 4, note: '', at: '' };
    fn(d, st);
  });
  const morning = base(() => {});
  assert.equal(buildNudges(morning, '2026-10-06', 8 * 60).primary.kind, 'time'); // movement prompt
  const didMove = base((d) => { d.activityLog = [log({ category: 'movement', durationMin: 20 })]; });
  assert.notEqual(buildNudges(didMove, '2026-10-06', 8 * 60).primary.kind, 'time'); // already moved → suppressed
  assert.notEqual(buildNudges(morning, '2026-10-06', null).primary.kind, 'time'); // no nowMin → no time trigger
});

// 71. profile age + routine validate and persist
test('71 age and routine validate', () => {
  const r = validateState({ profile: { age: 35, routine: { wake: 420, workStart: 540, workEnd: 1020, winddown: 1320, note: 'gym evenings' } } });
  assert.equal(r.state.profile.age, 35);
  assert.equal(r.state.profile.routine.wake, 420);
  assert.equal(r.state.profile.routine.note, 'gym evenings');
  // out-of-range age and bad times are rejected
  const bad = validateState({ profile: { age: 9, routine: { wake: -5, workStart: 2000, note: 42 } } });
  assert.equal(bad.state.profile.age, null);
  assert.equal(bad.state.profile.routine.wake, null);
  assert.equal(bad.state.profile.routine.workStart, null);
  assert.equal(bad.state.profile.routine.note, '');
});

// 72. recap summarises what was logged, flags voice entries, and reads aloud
test('72 recap reflects logged entries incl. voice source', async () => {
  const { recap } = await import('../src/planner/recap.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    const d = ensureDay(st, '2026-10-08');
    d.activityLog = [
      log({ category: 'movement', text: 'morning walk', durationMin: 30, source: 'voice' }),
      log({ category: 'meditation', text: 'box breathing', durationMin: 10, source: 'voice' }),
      log({ category: 'winddown', text: 'read', durationMin: 20, source: 'text' }),
    ];
  });
  const r = recap(s, '2026-10-08', 'week');
  assert.equal(r.total, 3);
  assert.equal(r.bySource.voice, 2);
  assert.equal(r.movementMin, 30);
  assert.equal(r.moveSessions, 1);
  assert.equal(r.mindSessions, 2);
  assert.ok(r.speech.includes('logged by voice'));
  assert.ok(r.speech.includes('healthy-aging guidelines'));
  assert.equal(r.items.length, 3);
});

// 73. answerQuery: deterministic voice Q&A over the user's own data
test('73 answerQuery handles dimension, stats, next, and the health boundary', async () => {
  const { answerQuery } = await import('../src/planner/ask.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    st.profile.routine = { wake: 420, workStart: 540, workEnd: 1020, winddown: 1320, note: '' };
    const d = ensureDay(st, '2026-10-08');
    d.activityLog = [log({ category: 'movement', text: 'walk', durationMin: 30, source: 'voice' }), log({ category: 'meditation', text: 'breathing', source: 'voice' })];
  });
  const iso = '2026-10-08';

  // switch to day
  const r1 = answerQuery(s, iso, 'switch to day', { dimension: 'week' });
  assert.equal(r1.dimension, 'day');
  assert.ok(/today/i.test(r1.reply));

  // movement stat
  assert.ok(/30 of 150 movement minutes/.test(answerQuery(s, iso, 'how many movement minutes', {}).reply));

  // next step (time-aware)
  assert.ok(answerQuery(s, iso, 'what should I do next', { nowMin: 13 * 60 }).reply.length > 0);

  // HEALTH BOUNDARY — must refuse, not assess
  const b = answerQuery(s, iso, 'how is my mental health and biological age', {});
  assert.ok(/can’t assess|cannot assess|can't assess/.test(b.reply));
  assert.ok(!/\d+ of \d+/.test(b.reply)); // no numbers/assessment leaked

  // stop command
  assert.equal(answerQuery(s, iso, 'stop', {}).stop, true);

  // recap request
  assert.ok(/logged/i.test(answerQuery(s, iso, "how's my week", { dimension: 'week' }).reply));
});

// 74. answerQuery logs activities spoken conversationally, with the user's name
test('74 answerQuery handles voice logging', async () => {
  const { answerQuery } = await import('../src/planner/ask.js');
  const s = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 }; });
  const iso = '2026-10-08';

  const r1 = answerQuery(s, iso, 'log a 30 minute walk', { name: 'Sasa' });
  assert.equal(r1.action, 'log');
  assert.equal(r1.entry.category, 'movement');
  assert.equal(r1.entry.durationMin, 30);
  assert.ok(/Sasa/.test(r1.reply));

  const r2 = answerQuery(s, iso, 'I just finished a 10 min meditation', {});
  assert.equal(r2.action, 'log');
  assert.equal(r2.entry.category, 'meditation');
  assert.equal(r2.entry.durationMin, 10);

  // a question is NOT treated as a log
  assert.notEqual(answerQuery(s, iso, 'what did I do today', {}).action, 'log');
  assert.notEqual(answerQuery(s, iso, "how's my week", {}).action, 'log');
});

// 75. wake-word regex recognises "Hey Daywell" variants, rejects noise
test('75 wake word matching', () => {
  const WAKE_RE = /\b(hey|hi|hello|ok|okay)[\s,]*(day[\s-]?well|daywell|dave[\s-]?well|dai[\s-]?well|dewell)\b|\bda[yi][\s-]?well\b/i;
  for (const yes of ['hey daywell', 'Hey Daywell', 'hey day well', 'ok daywell', 'hello day-well', 'daywell']) assert.ok(WAKE_RE.test(yes), yes);
  for (const no of ['hey there', 'what a lovely day', 'well done', 'the weather is nice']) assert.ok(!WAKE_RE.test(no), no);
});

// 76. name persists and is length-capped
test('76 profile name validates', () => {
  assert.equal(validateState({ profile: { name: '  Sasa  ' } }).state.profile.name, 'Sasa');
  assert.equal(validateState({ profile: { name: 42 } }).state.profile.name, '');
  assert.equal(validateState({ profile: { name: 'x'.repeat(100) } }).state.profile.name.length, 40);
});

// 77. persona: shapes, fallback, and template fill
test('77 persona definitions and fill', async () => {
  const { getPersona, fill, PERSONA_KEYS } = await import('../src/planner/persona.js');
  assert.ok(PERSONA_KEYS.includes('coach'));
  assert.equal(getPersona('coach').label, 'Coach');
  assert.equal(getPersona('nonsense').key, 'companion'); // fallback
  assert.ok(typeof getPersona('calm').rate === 'number');
  assert.ok(Array.isArray(getPersona('companion').cheer));
  assert.equal(fill('Hey {name}, let’s go!', { name: 'Sasa' }), 'Hey Sasa, let’s go!');
  assert.equal(fill('Hey {name}, how can I help?', {}), 'Hey, how can I help?'); // empty name stays tidy
});

// 78. persona persists and defaults
test('78 persona validates', () => {
  assert.equal(validateState({ profile: { persona: 'coach' } }).state.profile.persona, 'coach');
  assert.equal(validateState({ profile: {} }).state.profile.persona, 'companion');
  assert.equal(defaultState().profile.persona, 'companion');
});

// 79. reaching a goal via a log is detectable (drives the chime + cheer)
test('79 newly-met goal is detected from before/after metric state', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const metKeys = (st) => analyze(st, '2026-10-08').metrics.filter((m) => m.met).map((m) => m.key);
  const s = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 1, movementMinutesPerWeek: 10, mindfulnessSessionsPerWeek: 2 }; });
  const d = ensureDay(s, '2026-10-08');
  const before = metKeys(s);
  assert.ok(!before.includes('moveMin'));
  d.activityLog.push(log({ category: 'movement', durationMin: 15 })); // crosses the 10-min goal
  const after = metKeys(s);
  assert.ok(after.includes('moveMin') && !before.includes('moveMin')); // newly met
});

// ---- Health-agent review fixes (safety, parsing, personalization, calendar) ----

// 80. safety layer: crisis vs distress vs ordinary text
test('80 safety detects crisis and distress from the user\'s own words', async () => {
  const { detectCrisis, detectDistress, safetyLevel } = await import('../src/planner/safety.js');
  for (const t of ['I want to hurt myself', 'I feel hopeless', 'I want to die', "I don't want to be here anymore", 'thinking about suicide']) assert.equal(safetyLevel(t), 'crisis', t);
  for (const t of ['I am feeling really anxious right now', "I'm so stressed", 'Feeling anxious about the next call', 'had a panic attack', "can't sleep again"]) assert.equal(safetyLevel(t), 'distress', t);
  for (const t of ['log a 20 minute wind down', 'feeling great today', 'I did a 30 min run', 'how is my week']) assert.equal(safetyLevel(t), null, t);
  assert.equal(detectDistress('I want to hurt myself'), false); // crisis is not downgraded
  assert.equal(detectCrisis('feeling a bit stressed'), false);
});

// 81. voice: safety takes precedence; distress is supported, not refused
test('81 answerQuery puts safety first and supports distress', async () => {
  const { answerQuery } = await import('../src/planner/ask.js');
  const s = stateWith((st) => { st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 }; });
  const iso = '2026-10-08';
  const c = answerQuery(s, iso, 'I want to hurt myself', { name: 'Sasa' });
  assert.equal(c.safety, 'crisis');
  assert.ok(/9 8 8/.test(c.reply) && /1 3 2 3/.test(c.reply), 'crisis reply includes hotlines');
  assert.ok(!/not sure/i.test(c.reply));
  assert.equal(answerQuery(s, iso, 'I want to die, stop', {}).safety, 'crisis'); // beats "stop"
  const d = answerQuery(s, iso, 'I am feeling really anxious right now', {});
  assert.equal(d.safety, 'distress');
  assert.ok(/breathe with me/i.test(d.reply));
  assert.equal(answerQuery(s, iso, 'breathe with me', {}).action, 'breathe');
  assert.ok(/can’t assess/.test(answerQuery(s, iso, 'am I depressed?', {}).reply)); // assessment request → boundary
  assert.equal(answerQuery(s, iso, 'log a 20 minute wind down', {}).action, 'log'); // "down" ≠ distress
});

// 82. parsing: whole-word keywords — no more "team"→tea, "tomorrow"→row
test('82 detectCategories uses whole words', () => {
  for (const t of ['lunch with the team', 'see you tomorrow', 'brunch with friends', 'already done', 'interesting talk']) assert.deepEqual(parseSpoken(t).categories, [], t);
  assert.deepEqual(parseSpoken('listened to an uplifting playlist').categories, ['music']);
  assert.equal(parseSpoken('went running for 20 minutes').category, 'movement');
  assert.equal(parseSpoken('reading before bed').category, 'winddown');
  assert.equal(parseSpoken('herbal tea and a bath').category, 'winddown');
});

// 83. voice no longer logs non-activities
test('83 "I had lunch with the team" is not logged as an activity', async () => {
  const { answerQuery } = await import('../src/planner/ask.js');
  const r = answerQuery(defaultState(), '2026-10-08', 'I had lunch with the team', {});
  assert.notEqual(r.action, 'log');
});

// 84. recommendations adapt to the user's own check-in
test('84 analyze adapts the next step to self-reported energy', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const mk = (energy, mood) => stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    ensureDay(st, '2026-10-08').checkin = { mood, energy, note: '', at: '' };
  });
  const low = analyze(mk(1, 3), '2026-10-08');
  assert.equal(low.capacity, 'low');
  assert.equal(low.recommendations[0].side, 'mental');
  assert.ok(/energy is low/.test(low.recommendations[0].rationale));
  const high = analyze(mk(5, 4), '2026-10-08');
  assert.equal(high.capacity, 'high');
  assert.equal(high.recommendations[0].side, 'physical');
  assert.notEqual(low.recommendations[0].title, high.recommendations[0].title);
});

// 85. nudges respect calendar commitments
test('85 no activity prompt during a meeting', async () => {
  const { buildNudges } = await import('../src/planner/nudges.js');
  const s = stateWith((st) => {
    st.profile.routine = { wake: 420, workStart: 540, workEnd: 1020, winddown: 1320, note: '' };
    ensureDay(st, '2026-10-08').commitments = [{ id: 'c1', title: 'Board meeting', start: 720, end: 840, protected: true, source: 'ics' }];
  });
  const n = buildNudges(s, '2026-10-08', 13 * 60);
  assert.equal(n.primary.kind, 'busy');
  assert.ok(/Board meeting/.test(n.primary.text) && /14:00/.test(n.primary.text));
  assert.notEqual(buildNudges(s, '2026-10-08', 15 * 60).primary.kind, 'busy'); // after the meeting
});

// 86. guided breathing script: 3 rounds of 4-4-4-4
test('86 breathing script structure', async () => {
  const { breathingScript } = await import('../src/planner/safety.js');
  const steps = breathingScript(3);
  assert.equal(steps.length, 1 + 12 + 1);
  assert.equal(steps.filter((s) => s.waitMs === 4000).length, 12);
  assert.ok(/logged/.test(steps[steps.length - 1].say));
});

// 87. low mood surfaces the user's own mood-lift (music) option (ported from the retired assistant)
test('87 low mood prefers a saved music option', async () => {
  const { analyze } = await import('../src/planner/analyze.js');
  const s = stateWith((st) => {
    st.profile.goals = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 6 };
    st.library.activities = [lib({ id: 'mu', category: 'music', title: 'Upbeat playlist', durationMin: 15 }), lib({ id: 'me', category: 'meditation', title: 'Box breathing', durationMin: 5 })];
    ensureDay(st, '2026-10-08').checkin = { mood: 1, energy: 3, note: '', at: '' };
  });
  const r = analyze(s, '2026-10-08').recommendations[0];
  assert.equal(r.activity && r.activity.category, 'music');
  assert.ok(/mood is low/.test(r.rationale));
});
