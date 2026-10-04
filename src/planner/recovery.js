// Contingency / recovery: when a planned activity can't happen (rained out, ran
// out of time, not feeling it), suggest a saved fallback. For movement it is
// placed in the earliest feasible window today around real commitments; mental
// activities (meditation / wind-down / music) are not time-scheduled, so the
// shortest saved option of the same kind is offered.

import { suggestActivities } from './match.js';
import { checkPlacement } from '../supervisor.js';
import { MINUTES_PER_DAY } from '../time.js';

export function recoverActivity(state, iso, failedId, { indoorOnly = false, floor = 0 } = {}) {
  const day = state.days[iso] || { commitments: [], activities: [] };
  const failed = day.activities.find((a) => a.id === failedId);
  const category = failed ? failed.category : 'movement';

  const { suggestions } = suggestActivities(state, iso, { categories: [category], indoorOnly });
  if (!suggestions.length) {
    return { category, recommended: null, window: null, hasOption: false, reason: `No saved ${category} option to recover with.` };
  }

  if (category === 'movement') {
    const placementDay = {
      commitments: day.commitments,
      planned: { start: floor, durationMin: 0, latestFinish: MINUTES_PER_DAY, bufferBeforeMin: 0, bufferAfterMin: 0 },
    };
    for (const s of suggestions) {
      const window = earliestWindow(placementDay, s.activity.durationMin, floor);
      if (window) return { category, recommended: s.activity, window, hasOption: true, reason: `${s.activity.durationMin}-min saved option${indoorOnly ? ' (indoor)' : ''} fits at this window today.` };
    }
    return { category, recommended: null, window: null, hasOption: false, reason: 'No workable movement window left today.' };
  }

  // Mental activity: offer the shortest saved option, no time placement needed.
  const pick = suggestions[0];
  return { category, recommended: pick.activity, window: null, hasOption: true, reason: `A ${pick.activity.durationMin}-min saved option you can do anytime.` };
}

function earliestWindow(placementDay, durationMin, floor) {
  const candidates = new Set([floor]);
  for (const c of placementDay.commitments) candidates.add(c.end);
  for (const start of [...candidates].sort((a, b) => a - b)) {
    if (start < floor) continue;
    if (start + durationMin > MINUTES_PER_DAY) continue;
    const res = checkPlacement(placementDay, { start, durationMin }, { floor });
    if (res.ok) return { start: res.start, end: res.end };
  }
  return null;
}
