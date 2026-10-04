// Local-first persistence (R06). Save locally first; validate on load;
// recover from malformed storage; surface failed saves instead of lying.

import { STORAGE_KEY, SCHEMA_VERSION, validateDay } from './model.js';

export function saveDay(day) {
  // Returns { ok, error }. A failed save is VISIBLE — never reported as saved.
  try {
    const payload = JSON.stringify({ ...day, schemaVersion: SCHEMA_VERSION });
    localStorage.setItem(STORAGE_KEY, payload);
    // Read back to confirm the write actually persisted.
    const confirm = localStorage.getItem(STORAGE_KEY);
    if (confirm !== payload) return { ok: false, error: 'Write could not be confirmed.' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Storage unavailable.' };
  }
}

export function loadDay() {
  // Returns { found, day, errors }.
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { found: false, day: null, errors: ['Storage is unavailable in this browser context.'] };
  }
  if (!raw) return { found: false, day: null, errors: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { found: true, day: null, errors: ['Stored plan was corrupted and could not be read.'] };
  }
  const { ok, day, errors } = validateDay(parsed);
  return { found: true, day, errors, ok };
}

export function clearDay() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Could not clear storage.' };
  }
}

export function exportDay(day) {
  return JSON.stringify({ ...day, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString() }, null, 2);
}

export function importDay(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, day: null, errors: ['File is not valid JSON.'] };
  }
  return validateDay(parsed);
}
