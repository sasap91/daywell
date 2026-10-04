// Parse an uploaded movement/activity export into movement-log entries.
// Supports: JSON array, CSV (with a header row), and Apple Health export.xml
// (Workout elements). Best-effort and dependency-free — it reads activity name
// and duration only; it does not interpret heart rate, calories, or health
// metrics, and makes no health claim. Food is never read from wearables.

function num(v) {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function entry(text, durationMin) {
  return { text: String(text).trim().slice(0, 300) || 'Activity', durationMin: Math.max(0, Math.round(durationMin || 0)) };
}

function fromJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  const rows = Array.isArray(data) ? data : (Array.isArray(data.workouts) ? data.workouts : (Array.isArray(data.activities) ? data.activities : null));
  if (!rows) return { ok: false, error: 'JSON must be an array of activities.' };
  const entries = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const name = r.type || r.name || r.activity || r.workoutActivityType || 'Activity';
    const dur = r.durationMin ?? r.minutes ?? r.duration ?? 0;
    entries.push(entry(name, num(dur)));
  }
  return { ok: true, entries };
}

function fromCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, error: 'CSV needs a header row and at least one row.' };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => ['type', 'name', 'activity', 'workout', 'exercise'].includes(h));
  const durIdx = header.findIndex((h) => ['durationmin', 'minutes', 'duration', 'min', 'mins'].includes(h));
  if (nameIdx < 0 && durIdx < 0) return { ok: false, error: 'CSV needs a name/activity or duration column.' };
  const entries = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const name = nameIdx >= 0 ? cols[nameIdx] : 'Activity';
    const dur = durIdx >= 0 ? num(cols[durIdx]) : 0;
    if ((name && name.trim()) || dur) entries.push(entry(name || 'Activity', dur));
  }
  return { ok: true, entries };
}

function fromAppleHealthXml(text) {
  const entries = [];
  const re = /<Workout\b[^>]*workoutActivityType="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0];
    const type = m[1].replace(/^HKWorkoutActivityType/, '');
    const durMatch = /\bduration="([^"]*)"/.exec(tag);
    const unitMatch = /\bdurationUnit="([^"]*)"/.exec(tag);
    let dur = durMatch ? num(durMatch[1]) : 0;
    if (unitMatch && /^s(ec)?/i.test(unitMatch[1])) dur = dur / 60; // seconds -> minutes
    entries.push(entry(type || 'Workout', dur));
  }
  if (!entries.length) return { ok: false, error: 'No <Workout> entries found in the Apple Health export.' };
  return { ok: true, entries };
}

// Detect whether an uploaded file is an Apple Health export.
export function isAppleHealthExport(text, filename = '') {
  return /\.xml$/i.test(filename) || /<HealthData\b|<Workout\b|<Record\b/.test(text);
}

function localDateOf(isoDateTime) {
  // Apple Health dates look like "2026-10-04 07:30:00 -0700". Take the date part.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDateTime).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function minutesBetween(a, b) {
  const t1 = Date.parse(String(a).replace(' ', 'T').replace(/ ([+-]\d{4})$/, '$1'));
  const t2 = Date.parse(String(b).replace(' ', 'T').replace(/ ([+-]\d{4})$/, '$1'));
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 <= t1) return 0;
  return Math.round((t2 - t1) / 60000);
}

// Parse an Apple Health export: workouts (as movement entries, date-attributed),
// resting heart rate (per-day average), and sleep (per-day asleep hours).
// Returns { ok, workoutsByDate, healthByDate } — descriptive facts only.
export function parseHealthExport(text) {
  if (typeof text !== 'string' || !/<HealthData\b|<Workout\b|<Record\b/.test(text)) {
    return { ok: false, error: 'Not an Apple Health export.' };
  }
  const workoutsByDate = {};
  const hrSamples = {}; // date -> [values]
  const sleepMin = {};  // date -> asleep minutes

  // Workouts
  let m;
  const wRe = /<Workout\b[^>]*workoutActivityType="([^"]*)"[^>]*>/g;
  while ((m = wRe.exec(text)) !== null) {
    const tag = m[0];
    const type = m[1].replace(/^HKWorkoutActivityType/, '');
    const start = (/\bstartDate="([^"]*)"/.exec(tag) || [])[1];
    const date = localDateOf(start) || 'undated';
    let dur = parseFloat((/\bduration="([^"]*)"/.exec(tag) || [])[1] || '0') || 0;
    const unit = (/\bdurationUnit="([^"]*)"/.exec(tag) || [])[1] || 'min';
    if (/^s(ec)?/i.test(unit)) dur = dur / 60;
    (workoutsByDate[date] = workoutsByDate[date] || []).push({ text: type || 'Workout', durationMin: Math.max(0, Math.round(dur)) });
  }

  // Records: resting heart rate + sleep
  const rRe = /<Record\b[^>]*type="([^"]*)"[^>]*>/g;
  while ((m = rRe.exec(text)) !== null) {
    const tag = m[0];
    const type = m[1];
    const start = (/\bstartDate="([^"]*)"/.exec(tag) || [])[1];
    const end = (/\bendDate="([^"]*)"/.exec(tag) || [])[1];
    const value = (/\bvalue="([^"]*)"/.exec(tag) || [])[1];
    const date = localDateOf(start);
    if (!date) continue;
    if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
      const v = parseFloat(value);
      if (Number.isFinite(v)) (hrSamples[date] = hrSamples[date] || []).push(v);
    } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis' && /Asleep/i.test(value || '')) {
      sleepMin[date] = (sleepMin[date] || 0) + minutesBetween(start, end);
    }
  }

  const healthByDate = {};
  for (const [date, vals] of Object.entries(hrSamples)) {
    healthByDate[date] = healthByDate[date] || {};
    healthByDate[date].restingHR = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  }
  for (const [date, mins] of Object.entries(sleepMin)) {
    healthByDate[date] = healthByDate[date] || {};
    healthByDate[date].sleepHours = Math.round((mins / 60) * 10) / 10;
  }

  const hasAny = Object.keys(workoutsByDate).length || Object.keys(healthByDate).length;
  if (!hasAny) return { ok: false, error: 'No workouts, resting heart rate, or sleep found in the export.' };
  return { ok: true, workoutsByDate, healthByDate };
}

export function parseMovementUpload(text, filename = '') {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Empty file.' };
  const name = filename.toLowerCase();
  const trimmed = text.trimStart();

  if (name.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const res = fromJson(text);
    if (res) return res;
  }
  if (name.endsWith('.xml') || /<Workout\b|<HealthData\b/.test(text)) {
    return fromAppleHealthXml(text);
  }
  return fromCsv(text);
}
