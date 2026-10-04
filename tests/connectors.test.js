// Connector tests: .ics calendar import + options library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDay } from './helpers.js';
import { parseIcs, resolveEvents, importIcsForDate } from '../src/skills/ics.js';
import { importCalendar, saveToLibrary, getLibrary, removeFromLibrary, addLibraryOptionAsFallback } from '../src/connectors.js';

const ICS = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;
const VEVENT = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;

// 27. Floating local time parses to wall-clock minutes
test('27 floating DTSTART parses to local minutes', () => {
  const ics = ICS(VEVENT(['SUMMARY:Standup', 'DTSTART:20261004T090000', 'DTEND:20261004T093000']));
  const res = importIcsForDate(ics, '2026-10-04', 'America/New_York');
  assert.equal(res.ok, true);
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].title, 'Standup');
  assert.equal(res.events[0].start, 9 * 60);
  assert.equal(res.events[0].end, 9 * 60 + 30);
});

// 28. UTC "Z" time converts into the target zone
test('28 UTC time converts into target zone', () => {
  // 22:00Z on 2026-10-04 is 18:00 in America/New_York (EDT, -4)
  const ics = ICS(VEVENT(['SUMMARY:Call', 'DTSTART:20261004T220000Z', 'DTEND:20261004T223000Z']));
  const res = importIcsForDate(ics, '2026-10-04', 'America/New_York');
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].start, 18 * 60);
  assert.equal(res.events[0].end, 18 * 60 + 30);
});

// 29. All-day events are skipped (not time-blocks)
test('29 all-day event skipped', () => {
  const ics = ICS(VEVENT(['SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261004', 'DTEND;VALUE=DATE:20261005']));
  const res = importIcsForDate(ics, '2026-10-04', 'UTC');
  assert.equal(res.events.length, 0);
  assert.equal(res.allDay, 1);
});

// 30. Events on other dates are excluded
test('30 other-date events excluded', () => {
  const ics = ICS(VEVENT(['SUMMARY:Tomorrow', 'DTSTART:20261005T090000', 'DTEND:20261005T093000']));
  const res = importIcsForDate(ics, '2026-10-04', 'UTC');
  assert.equal(res.events.length, 0);
});

// 31. Line folding is unfolded before parsing
test('31 folded SUMMARY line is unfolded', () => {
  const ics = ICS(VEVENT(['SUMMARY:Long meeting\r\n  with wrapped title', 'DTSTART:20261004T100000', 'DTEND:20261004T110000']));
  const res = importIcsForDate(ics, '2026-10-04', 'UTC');
  assert.equal(res.events[0].title, 'Long meeting with wrapped title');
});

// 32. DURATION is used when DTEND is absent
test('32 DURATION computes end when DTEND missing', () => {
  const ics = ICS(VEVENT(['SUMMARY:Focus', 'DTSTART:20261004T140000', 'DURATION:PT1H30M']));
  const res = importIcsForDate(ics, '2026-10-04', 'UTC');
  assert.equal(res.events[0].start, 14 * 60);
  assert.equal(res.events[0].end, 15 * 60 + 30);
});

// 33. Escaped characters in SUMMARY are unescaped
test('33 escaped SUMMARY characters decoded', () => {
  const ics = ICS(VEVENT(['SUMMARY:Lunch\\, then review\\; notes', 'DTSTART:20261004T120000', 'DTEND:20261004T123000']));
  const res = importIcsForDate(ics, '2026-10-04', 'UTC');
  assert.equal(res.events[0].title, 'Lunch, then review; notes');
});

// 34. Non-ics input is rejected gracefully
test('34 invalid ics rejected', () => {
  const res = importIcsForDate('not an ics file', '2026-10-04', 'UTC');
  assert.equal(res.ok, false);
});

// 35. importCalendar adds events as protected commitments
test('35 calendar import adds protected commitments', () => {
  const day = makeDay();
  day.date = '2026-10-04'; day.timeZone = 'UTC';
  const ics = ICS(VEVENT(['SUMMARY:Team sync', 'DTSTART:20261004T093000', 'DTEND:20261004T100000']));
  const res = importCalendar(day, ics);
  assert.equal(res.ok, true);
  assert.equal(res.added, 1);
  const added = res.day.commitments.find((c) => c.title === 'Team sync');
  assert.equal(added.protected, true);
  assert.equal(added.start, 9 * 60 + 30);
});

// 36. Re-importing the same calendar does not duplicate
test('36 calendar re-import de-duplicates', () => {
  let day = makeDay();
  day.date = '2026-10-04'; day.timeZone = 'UTC';
  const ics = ICS(VEVENT(['SUMMARY:Team sync', 'DTSTART:20261004T093000', 'DTEND:20261004T100000']));
  day = importCalendar(day, ics).day;
  const second = importCalendar(day, ics);
  assert.equal(second.added, 0);
  assert.equal(second.duplicates, 1);
});

// 37. Options library saves, lists, and de-dupes
test('37 options library save + dedupe', () => {
  localStorage.clear();
  const first = saveToLibrary({ title: 'Overnight oats', kind: 'meal', durationMin: 5, availabilityNote: 'in fridge' });
  assert.equal(first.ok, true);
  assert.equal(getLibrary().length, 1);
  const dup = saveToLibrary({ title: 'Overnight oats', kind: 'meal', durationMin: 5 });
  assert.equal(dup.duplicate, true);
  assert.equal(getLibrary().length, 1);
});

// 38. Library option becomes a day fallback, respecting the 2-cap
test('38 add library option as fallback honors cap', () => {
  localStorage.clear();
  const { entry } = saveToLibrary({ title: 'Quick salad', kind: 'meal', durationMin: 8 });
  let day = makeDay({ fallbacks: [{ title: 'A', durationMin: 10 }, { title: 'B', durationMin: 12 }] });
  const blocked = addLibraryOptionAsFallback(day, entry.id);
  assert.equal(blocked.ok, false); // already two fallbacks
  day = makeDay();
  const ok = addLibraryOptionAsFallback(day, entry.id);
  assert.equal(ok.ok, true);
  assert.equal(ok.day.fallbacks[0].title, 'Quick salad');
  removeFromLibrary(entry.id);
  assert.equal(getLibrary().length, 0);
});
