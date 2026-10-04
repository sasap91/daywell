// Connector skill: iCalendar (.ics) reader for local-first calendar import.
// Google Calendar has no browser API and live OAuth needs a backend, so the
// honest web-compatible connector is: export your calendar as .ics (Google
// Calendar → Settings → Import & export → Export) and import the file here.
//
// Dependency-free, no network. Parses VEVENTs into timed commitments for a
// target local date. Timezone-correct via Intl (handles UTC "Z", floating
// local times, and TZID zones). Recurring events (RRULE) are NOT expanded —
// only concrete single occurrences on the target date are imported.

// ---- timezone helpers (deterministic given a target IANA zone) ----

function partsInZone(instant, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return p;
}

function offsetMs(instant, tz) {
  const p = partsInZone(instant, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUTC - instant.getTime();
}

// Wall-clock components in a given zone -> UTC epoch ms.
function zonedToEpoch({ y, mo, d, h, mi, s }, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off = offsetMs(new Date(guess), tz);
  off = offsetMs(new Date(guess - off), tz); // second pass handles DST edges
  return guess - off;
}

// ---- parsing ----

function unfold(text) {
  // RFC 5545: a CRLF followed by a space or tab continues the previous line.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(value) {
  return String(value)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseDateTime(rawValue, params) {
  // Returns { allDay, form, tzid, wall:{y,mo,d,h,mi,s} }
  const tzid = params.TZID || null;
  const value = rawValue.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4), mo = +value.slice(4, 6), d = +value.slice(6, 8);
    return { allDay: true, form: 'date', tzid, wall: { y, mo, d, h: 0, mi: 0, s: 0 } };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) return null;
  const wall = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  return { allDay: false, form: m[7] ? 'utc' : (tzid ? 'tzid' : 'floating'), tzid, wall };
}

function parseDuration(value) {
  // PnDTnHnMnS -> minutes (date part days supported).
  const m = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const days = +(m[2] || 0), h = +(m[3] || 0), mi = +(m[4] || 0), s = +(m[5] || 0);
  return sign * (days * 1440 + h * 60 + mi + Math.round(s / 60));
}

// Parse raw VEVENTs. Returns [{ title, dtstart, dtend, duration }].
export function parseIcs(text) {
  if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text)) {
    return { ok: false, events: [], error: 'Not a valid iCalendar (.ics) file.' };
  }
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (upper === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    const key = name.toUpperCase();
    if (key === 'SUMMARY') cur.title = unescapeText(value);
    else if (key === 'DTSTART') cur.dtstart = parseDateTime(value, params);
    else if (key === 'DTEND') cur.dtend = parseDateTime(value, params);
    else if (key === 'DURATION') cur.duration = parseDuration(value);
  }
  return { ok: true, events };
}

function resolveInstant(dt, targetTz) {
  if (dt.form === 'utc') return Date.UTC(dt.wall.y, dt.wall.mo - 1, dt.wall.d, dt.wall.h, dt.wall.mi, dt.wall.s);
  // floating -> interpret in the viewer's zone; tzid -> its own zone.
  const zone = dt.form === 'tzid' && dt.tzid ? dt.tzid : targetTz;
  try {
    return zonedToEpoch(dt.wall, zone);
  } catch {
    return zonedToEpoch(dt.wall, targetTz); // unknown TZID -> treat as local
  }
}

// Resolve parsed events into { title, localDate, startMin, endMin, allDay }.
export function resolveEvents(parsed, targetTz) {
  const out = [];
  for (const ev of parsed) {
    if (!ev.dtstart) continue;
    const title = ev.title || 'Untitled event';
    if (ev.dtstart.allDay) {
      const w = ev.dtstart.wall;
      out.push({ title, allDay: true, localDate: iso(w.y, w.mo, w.d), startMin: 0, endMin: 0 });
      continue;
    }
    const startMs = resolveInstant(ev.dtstart, targetTz);
    let endMs;
    if (ev.dtend && !ev.dtend.allDay) endMs = resolveInstant(ev.dtend, targetTz);
    else if (typeof ev.duration === 'number') endMs = startMs + ev.duration * 60000;
    else endMs = startMs + 60 * 60000; // default 1h when neither given
    const sp = partsInZone(new Date(startMs), targetTz);
    const ep = partsInZone(new Date(endMs), targetTz);
    const localDate = iso(sp.year, sp.month, sp.day);
    const startMin = sp.hour * 60 + sp.minute;
    const sameDay = iso(ep.year, ep.month, ep.day) === localDate;
    const endMin = sameDay ? ep.hour * 60 + ep.minute : 1440; // clamp overnight to day end
    out.push({ title, allDay: false, localDate, startMin, endMin });
  }
  return out;
}

function iso(y, mo, d) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Full pipeline: text + target date/zone -> { commitmentsToAdd, skipped, allDay }.
export function importIcsForDate(text, isoDate, targetTz) {
  const parsed = parseIcs(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const resolved = resolveEvents(parsed.events, targetTz);
  const onDate = resolved.filter((e) => e.localDate === isoDate);
  const timed = onDate.filter((e) => !e.allDay && e.endMin > e.startMin);
  const allDay = onDate.filter((e) => e.allDay).length;
  const skipped = resolved.length - timed.length;
  return {
    ok: true,
    events: timed.map((e) => ({ title: e.title, start: e.startMin, end: e.endMin })),
    skipped,
    allDay,
    total: resolved.length,
  };
}
