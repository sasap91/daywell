// The "what to do next" assistant. Deterministic and honest: it reads the
// user's OWN self check-in (mood/energy), their schedule, their unmet goals,
// and suggests from their OWN saved activities. It never diagnoses or infers a
// clinical/mental-health state — it echoes the user's self-report and matches
// activities the user themselves chose.

import { suggestActivities } from './match.js';
import { weekProgress } from './goals.js';
import { CATEGORIES } from './state.js';

const BUSY_COMMITTED_MIN = 480; // ≥ 8h of commitments today → busy, prefer short items

function committedMinutes(day) {
  return (day.commitments || []).reduce((s, c) => s + (c.end - c.start), 0);
}

// Returns { headline, items: [{activity, reason} | {tip}] }.
export function suggestNext(state, iso) {
  const day = state.days[iso];
  if (!day || !day.checkin) {
    return { headline: 'Do a quick check-in and I’ll suggest what fits how you feel.', items: [], needsCheckin: true };
  }
  const { mood, energy } = day.checkin;
  const prog = weekProgress(state, iso);
  const busy = committedMinutes(day) >= BUSY_COMMITTED_MIN;

  // Preferred categories + a plain-language, self-report-based headline.
  let categories;
  let headline;
  if (energy <= 2) { categories = ['winddown', 'meditation', 'movement']; headline = 'You said your energy is low — here are gentler, restorative options you saved.'; }
  else if (mood <= 2) { categories = ['music', 'meditation', 'movement']; headline = 'You said your mood is low — here are mood-lift and calming options you saved.'; }
  else if (energy >= 4 && mood >= 3) { categories = ['movement', 'meditation']; headline = 'Good energy today — a solid moment for movement.'; }
  else { categories = ['movement', 'meditation', 'winddown', 'music']; headline = 'Here are options you saved that fit today.'; }

  // Nudge unmet goals to the front of the category preference.
  if (!prog.movementSessions.met && !categories.includes('movement')) categories.unshift('movement');
  if (!prog.mindfulnessSessions.met) { for (const c of ['meditation', 'winddown']) if (!categories.includes(c)) categories.push(c); }

  const { suggestions } = suggestActivities(state, iso, { categories });
  let pool = suggestions;
  if (busy) pool = pool.filter((s) => s.activity.durationMin <= 20);

  // Rank by the preferred-category order, then by (already-sorted) duration.
  const rank = (c) => { const i = categories.indexOf(c); return i < 0 ? 99 : i; };
  pool = [...pool].sort((a, b) => rank(a.activity.category) - rank(b.activity.category));

  const items = pool.slice(0, 4).map((s) => ({
    activity: s.activity,
    reason: `${CATEGORIES[s.activity.category].label} · ${s.reason}${busy ? ' · short, fits a busy day' : ''}`,
  }));

  // If a preferred category has nothing saved, offer a setup tip (once).
  const haveCats = new Set(state.library.activities.map((a) => a.category));
  for (const c of categories) {
    if (!haveCats.has(c)) { items.push({ tip: `Add a ${CATEGORIES[c].label} activity in Setup to get ${CATEGORIES[c].label.toLowerCase()} suggestions.` }); break; }
  }
  if (!items.length) items.push({ tip: 'No saved activities yet — add some in Setup & Goals.' });

  return { headline, items, busy, needsCheckin: false };
}
