// recap.js — a plain-language read of what the user actually logged over a
// period (including which entries came from VOICE), plus how it's tracking.
// Built from the user's own records, not canned text; produces a `speech`
// string the UI can read aloud. Descriptive only — it reports what was logged
// and progress vs the user's goals/guidelines, never a health judgment.

import { analyze } from './analyze.js';
import { weekDates, monthDates } from './goals.js';
import { CATEGORIES } from './state.js';

export function recap(state, iso, dimension = 'week') {
  const dates = dimension === 'day' ? [iso] : (dimension === 'month' ? monthDates(iso) : weekDates(iso));
  const bySource = { text: 0, voice: 0, upload: 0 };
  const byCat = {};
  const items = [];
  let movementMin = 0; let moveSessions = 0; let mindSessions = 0;
  for (const d of dates) {
    const day = state.days[d];
    if (!day) continue;
    for (const a of day.activityLog || []) {
      bySource[a.source] = (bySource[a.source] || 0) + 1;
      byCat[a.category] = byCat[a.category] || { count: 0, min: 0 };
      byCat[a.category].count += 1; byCat[a.category].min += a.durationMin || 0;
      if (a.category === 'movement') { moveSessions += 1; movementMin += a.durationMin || 0; }
      else if (CATEGORIES[a.category] && CATEGORIES[a.category].side === 'mental') mindSessions += 1;
      items.push({ date: d, category: a.category, text: a.text, durationMin: a.durationMin, source: a.source });
    }
  }
  const total = items.length;
  const an = analyze(state, iso);
  const label = dimension === 'day' ? 'today' : (dimension === 'month' ? 'this month' : 'this week');

  // Warm, plain-language summary, suitable for reading aloud.
  const parts = [];
  if (total) {
    parts.push(`Nice — here’s how ${label} looks`);
    const seg = [];
    if (moveSessions) seg.push(`${movementMin} minutes of movement across ${moveSessions} ${moveSessions === 1 ? 'session' : 'sessions'}`);
    if (mindSessions) seg.push(`${mindSessions} mind ${mindSessions === 1 ? 'session' : 'sessions'}`);
    parts.push(`You logged ${total} ${total === 1 ? 'activity' : 'activities'}${seg.length ? `, ${seg.join(' and ')}` : ''}`);
    if (bySource.voice) parts.push(`${bySource.voice} of them you logged by voice`);
  } else {
    parts.push(`You haven’t logged anything ${label} yet — an easy win is waiting`);
  }
  parts.push(`On tracking, ${an.status.label}`);
  parts.push(an.guidelinesMet === an.guidelines.length
    ? `You’re hitting all ${an.guidelines.length} healthy-aging guidelines — love it`
    : `You’re meeting ${an.guidelinesMet} of ${an.guidelines.length} healthy-aging guidelines`);
  const speech = `${parts.join('. ')}.`;

  return { dimension, label, rangeStart: dates[0], rangeEnd: dates[dates.length - 1], total, movementMin, moveSessions, mindSessions, byCat, bySource, items, status: an.status, guidelines: an.guidelines, guidelinesMet: an.guidelinesMet, speech };
}
