// Daywell personal assistant state (v7): a non-work assistant for physical AND
// mental wellbeing. Activities span categories (movement, meditation,
// wind-down, music/mood). A daily self check-in (mood/energy) drives
// suggestions. No clinical or mental-health assessment is computed or claimed —
// suggestions come from the user's own activities and their own check-in.
//
// Migrates movement-only (v6) and earlier data: old movements map to the
// 'movement' category; dropped meal fields are ignored.

import { isIsoDate, localDateString } from '../time.js';

export const APP_SCHEMA = 7;
export const APP_KEY = 'daywell.app.v7';
const LEGACY_KEYS = ['daywell.app.v6', 'daywell.app.v5', 'daywell.app.v4'];

export const LOG_SOURCES = ['text', 'voice', 'upload'];
export const STATUS = ['planned', 'done', 'substituted', 'skipped'];

// Categories. `side` groups them into physical vs mental for goals/summary.
export const CATEGORIES = {
  movement: { label: 'Movement', side: 'physical', timed: true },
  meditation: { label: 'Meditation', side: 'mental', timed: false },
  winddown: { label: 'Wind-down', side: 'mental', timed: false },
  music: { label: 'Music / mood', side: 'mental', timed: false },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const MIND_CATEGORIES = CATEGORY_KEYS.filter((k) => CATEGORIES[k].side === 'mental');

let counter = 0;
export function uid(prefix = 'x') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function cat(v) { return CATEGORY_KEYS.includes(v) ? v : 'movement'; }

export function defaultState() {
  return {
    schema: APP_SCHEMA,
    profile: {
      name: '',
      persona: 'companion',
      age: null,
      routine: { wake: null, workStart: null, workEnd: null, winddown: null, note: '' },
      goals: { movementSessionsPerWeek: 3, movementMinutesPerWeek: 90, mindfulnessSessionsPerWeek: 3 },
    },
    library: { activities: [] },
    days: {},
  };
}

function toInt(v, fallback = 0) { return Number.isFinite(v) && Number.isInteger(v) ? v : fallback; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function validateLibActivity(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('act'),
    category: cat(raw.category),
    title: raw.title.trim(),
    durationMin: Math.max(1, toInt(raw.durationMin, 15)),
    indoor: raw.indoor === true,
    tags: cleanTags(raw.tags),
  };
}

function validatePlanned(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('pa'),
    libraryId: typeof raw.libraryId === 'string' ? raw.libraryId : null,
    category: cat(raw.category),
    title: raw.title.trim() || 'Activity',
    durationMin: Math.max(1, toInt(raw.durationMin, 15)),
    indoor: raw.indoor === true,
    status: STATUS.includes(raw.status) ? raw.status : 'planned',
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    recordedAt: typeof raw.recordedAt === 'string' ? raw.recordedAt : null,
    contingencyOf: typeof raw.contingencyOf === 'string' ? raw.contingencyOf : null,
  };
}

function validateLog(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('al'),
    category: cat(raw.category),
    text: raw.text.trim().slice(0, 300),
    durationMin: Math.max(0, toInt(raw.durationMin, 0)),
    source: LOG_SOURCES.includes(raw.source) ? raw.source : 'text',
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
  };
}

function validateRoutine(raw) {
  const t = (v) => (Number.isInteger(v) && v >= 0 && v < 1440 ? v : null);
  if (!raw || typeof raw !== 'object') return { wake: null, workStart: null, workEnd: null, winddown: null, note: '' };
  return {
    wake: t(raw.wake), workStart: t(raw.workStart), workEnd: t(raw.workEnd), winddown: t(raw.winddown),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
  };
}

function validateCheckin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mood = toInt(raw.mood, 0);
  const energy = toInt(raw.energy, 0);
  if (mood < 1 || mood > 5 || energy < 1 || energy > 5) return null;
  return {
    mood: clamp(mood, 1, 5),
    energy: clamp(energy, 1, 5),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
  };
}

function validateHealth(raw) {
  if (!raw || typeof raw !== 'object') return { restingHR: null, sleepHours: null, source: null };
  const numOrNull = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);
  return {
    restingHR: numOrNull(raw.restingHR, 20, 220),
    sleepHours: numOrNull(raw.sleepHours, 0, 24),
    source: typeof raw.source === 'string' ? raw.source : null,
  };
}

function validateDay(raw) {
  const commitments = Array.isArray(raw.commitments)
    ? raw.commitments.filter((c) => c && Number.isInteger(c.start) && Number.isInteger(c.end) && c.end > c.start)
      .map((c) => ({ id: typeof c.id === 'string' ? c.id : uid('cm'), title: String(c.title || '').trim(), start: c.start, end: c.end, protected: c.protected !== false, source: c.source || 'manual' }))
    : [];
  // Migration: old `movements` -> activities (movement); `movementLog` -> activityLog.
  const plannedRaw = Array.isArray(raw.activities) ? raw.activities
    : (Array.isArray(raw.movements) ? raw.movements.map((m) => ({ ...m, category: 'movement' })) : []);
  const logRaw = Array.isArray(raw.activityLog) ? raw.activityLog
    : (Array.isArray(raw.movementLog) ? raw.movementLog.map((m) => ({ ...m, category: 'movement' })) : []);
  return {
    commitments,
    activities: plannedRaw.map(validatePlanned).filter(Boolean),
    activityLog: logRaw.map(validateLog).filter(Boolean),
    checkin: validateCheckin(raw.checkin),
    health: validateHealth(raw.health),
    weatherNote: typeof raw.weatherNote === 'string' ? raw.weatherNote.slice(0, 200) : '',
  };
}

export function validateState(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, state: defaultState(), errors: ['State was not an object; started fresh.'] };
  const base = defaultState();

  if (raw.profile && typeof raw.profile === 'object') {
    const p = raw.profile;
    const g = p.goals || {};
    base.profile.goals = {
      movementSessionsPerWeek: Math.max(0, toInt(g.movementSessionsPerWeek, 3)),
      movementMinutesPerWeek: Math.max(0, toInt(g.movementMinutesPerWeek, 90)),
      mindfulnessSessionsPerWeek: Math.max(0, toInt(g.mindfulnessSessionsPerWeek, 3)),
    };
    base.profile.name = typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '';
    base.profile.persona = (typeof p.persona === 'string' && p.persona) ? p.persona.slice(0, 20) : 'companion';
    base.profile.age = (Number.isFinite(p.age) && p.age >= 13 && p.age <= 120) ? Math.round(p.age) : null;
    base.profile.routine = validateRoutine(p.routine);
  }

  if (raw.library && typeof raw.library === 'object') {
    const libRaw = Array.isArray(raw.library.activities) ? raw.library.activities
      : (Array.isArray(raw.library.movements) ? raw.library.movements.map((m) => ({ ...m, category: 'movement' })) : []);
    base.library.activities = libRaw.map(validateLibActivity).filter(Boolean);
  }

  if (raw.days && typeof raw.days === 'object') {
    for (const [iso, d] of Object.entries(raw.days)) {
      if (!isIsoDate(iso) || !d || typeof d !== 'object') { errors.push('Skipped a day with invalid key.'); continue; }
      base.days[iso] = validateDay(d);
    }
  }

  return { ok: errors.length === 0, state: base, errors };
}

export function ensureDay(state, iso) {
  if (!state.days[iso]) {
    state.days[iso] = { commitments: [], activities: [], activityLog: [], checkin: null, health: { restingHR: null, sleepHours: null, source: null }, weatherNote: '' };
  }
  const d = state.days[iso];
  if (!Array.isArray(d.activities)) d.activities = [];
  if (!Array.isArray(d.activityLog)) d.activityLog = [];
  if (!Array.isArray(d.commitments)) d.commitments = [];
  if (d.checkin === undefined) d.checkin = null;
  if (!d.health || typeof d.health !== 'object') d.health = { restingHR: null, sleepHours: null, source: null };
  return d;
}

// ---- persistence ----

export function loadState() {
  let raw;
  try { raw = localStorage.getItem(APP_KEY); } catch { return { found: false, state: defaultState(), errors: ['Storage unavailable.'] }; }
  if (!raw) {
    for (const legacy of LEGACY_KEYS) {
      let old;
      try { old = localStorage.getItem(legacy); } catch { old = null; }
      if (old) { raw = old; break; }
    }
  }
  if (!raw) return { found: false, state: defaultState(), errors: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { found: true, state: defaultState(), errors: ['Saved data was corrupted; started fresh.'] }; }
  const res = validateState(parsed);
  return { found: true, ...res };
}

export function saveState(state) {
  try {
    const payload = JSON.stringify({ ...state, schema: APP_SCHEMA });
    localStorage.setItem(APP_KEY, payload);
    if (localStorage.getItem(APP_KEY) !== payload) return { ok: false, error: 'Write could not be confirmed.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Storage unavailable (data may be too large).' };
  }
}

export function clearState() {
  try { localStorage.removeItem(APP_KEY); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
}

export function exportState(state) {
  return JSON.stringify({ ...state, schema: APP_SCHEMA, exportedAt: new Date().toISOString() }, null, 2);
}

export function todayIso() { return localDateString(); }
