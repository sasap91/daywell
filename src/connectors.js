// Connector orchestration (local-first, no network).
//   1. Calendar: merge imported .ics events into the day as protected
//      commitments, de-duplicated against what is already there.
//   2. Meal/movement options library: a reusable set of saved options stored
//      locally, so meals and movements are entered once and reused each day.
//      This is the local-first realization of "connect my meals" — the data
//      lives on this device, nothing is uploaded.

import { importIcsForDate } from './skills/ics.js';
import { newId } from './model.js';

// ---- calendar ----

function sameSlot(a, b) {
  return a.start === b.start && a.end === b.end && (a.title || '') === (b.title || '');
}

// Returns { ok, day, added, duplicates, skipped, allDay, error }.
export function importCalendar(day, icsText) {
  const res = importIcsForDate(icsText, day.date, day.timeZone);
  if (!res.ok) return { ok: false, error: res.error };
  const additions = [];
  let duplicates = 0;
  for (const ev of res.events) {
    const dup = day.commitments.some((c) => sameSlot(c, ev));
    if (dup) { duplicates += 1; continue; }
    additions.push({ id: newId('cm'), title: ev.title, start: ev.start, end: ev.end, protected: true, source: 'ics' });
  }
  const nextDay = { ...day, commitments: [...day.commitments, ...additions] };
  return { ok: true, day: nextDay, added: additions.length, duplicates, skipped: res.skipped, allDay: res.allDay, total: res.total };
}

// ---- options library ----

const LIB_KEY = 'daywell.options.v1';

function readLibrary() {
  try {
    const arr = JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((o) => o && typeof o === 'object' && typeof o.title === 'string' && Number.isInteger(o.durationMin))
      .map((o) => ({
        id: typeof o.id === 'string' ? o.id : newId('lib'),
        title: o.title.trim(),
        kind: o.kind === 'meal' ? 'meal' : 'movement',
        durationMin: o.durationMin,
        availabilityNote: typeof o.availabilityNote === 'string' ? o.availabilityNote.trim() : '',
      }))
      .filter((o) => o.title && o.durationMin > 0);
  } catch {
    return [];
  }
}

function writeLibrary(options) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(options));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : 'Storage unavailable.' };
  }
}

export function getLibrary() {
  return readLibrary();
}

export function saveToLibrary(option) {
  const lib = readLibrary();
  const title = (option.title || '').trim();
  if (!title || !(option.durationMin > 0)) return { ok: false, error: 'An option needs a title and positive duration.' };
  // De-dupe by title + kind + duration.
  if (lib.some((o) => o.title === title && o.kind === option.kind && o.durationMin === option.durationMin)) {
    return { ok: true, library: lib, duplicate: true };
  }
  const entry = {
    id: newId('lib'),
    title,
    kind: option.kind === 'meal' ? 'meal' : 'movement',
    durationMin: option.durationMin,
    availabilityNote: (option.availabilityNote || '').trim(),
  };
  const next = [...lib, entry];
  const res = writeLibrary(next);
  return res.ok ? { ok: true, library: next, entry } : res;
}

export function removeFromLibrary(id) {
  const next = readLibrary().filter((o) => o.id !== id);
  const res = writeLibrary(next);
  return res.ok ? { ok: true, library: next } : res;
}

// Turn a library option into a day fallback (respecting the two-alternative cap).
export function addLibraryOptionAsFallback(day, libId) {
  const opt = readLibrary().find((o) => o.id === libId);
  if (!opt) return { ok: false, error: 'Option not found.' };
  if (day.fallbacks.length >= 2) return { ok: false, error: 'You can save at most two alternatives per day.' };
  const fb = { id: newId('fb'), title: opt.title, kind: opt.kind, durationMin: opt.durationMin, available: true, availabilityNote: opt.availabilityNote };
  return { ok: true, day: { ...day, fallbacks: [...day.fallbacks, fb] } };
}
