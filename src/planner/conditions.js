// conditions.js — today's contingency plan as facts the agent can act on:
// what the user set (indoor only, earliest free time), what their note says
// ("raining", "will run late"), and what the calendar says (current meeting).
// Deterministic and explainable; used by Do next, nudges, voice, and the AI.

const WEATHER_RE = /\b(rain\w*|storm\w*|snow\w*|thunder\w*|drizzl\w*|hail|sleet|freezing|too (hot|cold)|heat ?wave|smog|haze|air quality|pm ?2\.?5|flood\w*|wet)\b/i;
const LATE_RE = /\b(run(s|ning)? (late|over)|overrun\w*|go(es|ing)? (late|over)|late (meeting|night|finish)|working late|stay(ing)? late|delay(ed)?|will be late)\b/i;
export const LATE_BUFFER_MIN = 30; // "may run late" → assume roughly half an hour over

function hhmm(min) { return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

export function readConditions(state, iso, nowMin = null) {
  const day = (state.days && state.days[iso]) || {};
  const note = String(day.weatherNote || '');
  const rainy = WEATHER_RE.test(note);
  const runningLate = LATE_RE.test(note);
  const indoorOnly = day.indoorOnly === true || rainy;
  const indoorReason = day.indoorOnly === true ? 'you chose indoor only' : (rainy ? 'your note says the weather is bad' : null);

  // The commitment that's on now — or, without a clock, the day's last one if
  // the note says something will run late.
  const commitments = [...(day.commitments || [])].sort((a, b) => a.start - b.start);
  let busy = null;
  if (nowMin != null) busy = commitments.find((c) => nowMin >= c.start && nowMin < c.end) || null;
  if (!busy && runningLate) {
    const later = commitments.filter((c) => nowMin == null || c.end > nowMin);
    busy = later.length ? later[later.length - 1] : null;
  }
  const busyUntil = busy ? busy.end + (runningLate ? LATE_BUFFER_MIN : 0) : null;

  const userFloor = Number.isInteger(day.freeFrom) ? day.freeFrom : null;
  const freeFrom = Math.max(nowMin || 0, userFloor || 0, busyUntil || 0);
  const routine = (state.profile && state.profile.routine) || {};
  const winddown = Number.isInteger(routine.winddown) ? routine.winddown : 22 * 60;
  const windowMin = winddown - freeFrom; // minutes between being free and wind-down
  const late = windowMin < 15;
  const startsLater = freeFrom > (nowMin || 0) && (busyUntil != null || userFloor != null);

  const parts = [];
  if (busy) parts.push(`${busy.title || 'your commitment'}${runningLate ? ' may run late' : ''} — you're free around ${hhmm(freeFrom)}`);
  else if (userFloor != null && userFloor > (nowMin || 0)) parts.push(`you're free from ${hhmm(userFloor)}`);
  if (indoorOnly) parts.push(rainy ? 'the weather is bad, so indoors only' : 'indoors only');
  if (late) parts.push(`that's close to your ${hhmm(winddown)} wind-down`);

  return {
    note, rainy, runningLate, indoorOnly, indoorReason,
    busy: busy ? { title: busy.title || 'your commitment', end: busy.end } : null,
    busyUntil, freeFrom, freeFromText: hhmm(freeFrom), startsLater,
    winddown, windDownText: hhmm(winddown), windowMin, late,
    active: Boolean(indoorOnly || busy || userFloor != null || late || runningLate),
    summary: parts,
  };
}
