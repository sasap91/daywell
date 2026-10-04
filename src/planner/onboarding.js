// onboarding.js — first-run setup in three one-tap steps: your name, your weekly
// goals, and a starter activity library (so suggestions work on day one).

import { uid } from './state.js';

// A small, balanced starter library covering every category — including a
// strength option, since WHO advises muscle-strengthening on 2+ days a week.
export const STARTER_ACTIVITIES = [
  { category: 'meditation', title: 'Box breathing', durationMin: 5, indoor: true, tags: ['calming'] },
  { category: 'meditation', title: 'Guided meditation', durationMin: 10, indoor: true, tags: ['calming'] },
  { category: 'movement', title: 'Brisk walk', durationMin: 20, indoor: false, tags: ['energizing'] },
  { category: 'movement', title: 'Bodyweight strength workout', durationMin: 20, indoor: true, tags: ['strength'] },
  { category: 'winddown', title: 'Gentle stretch', durationMin: 10, indoor: true, tags: ['calming'] },
  { category: 'winddown', title: 'Read before bed', durationMin: 15, indoor: true, tags: ['sleep'] },
  { category: 'music', title: 'Calm playlist', durationMin: 15, indoor: true, tags: ['calming'] },
  { category: 'music', title: 'Upbeat playlist', durationMin: 10, indoor: true, tags: ['uplift'] },
];

// WHO-aligned starting point: 150 min/week of moderate activity across 4
// sessions, plus near-daily stress-reduction practice. The user can change it.
export const RECOMMENDED_GOALS = { movementSessionsPerWeek: 4, movementMinutesPerWeek: 150, mindfulnessSessionsPerWeek: 5 };

// Adds starter activities not already in the library (matched by title).
// Mutates state; returns how many were added.
export function addStarterActivities(state) {
  const have = new Set(state.library.activities.map((a) => a.title.toLowerCase()));
  let added = 0;
  for (const a of STARTER_ACTIVITIES) {
    if (have.has(a.title.toLowerCase())) continue;
    state.library.activities.push({ id: uid('act'), ...a, tags: [...a.tags] });
    added += 1;
  }
  return added;
}

// Which first-run steps remain. `show` is false once everything is done or the
// user dismissed the card.
export function onboardingStatus(state) {
  const p = state.profile;
  const steps = {
    name: Boolean((p.name || '').trim()),
    goals: p.goalsSet === true,
    library: state.library.activities.length > 0,
  };
  const remaining = Object.values(steps).filter((v) => !v).length;
  return { steps, remaining, show: remaining > 0 && !p.onboardingDismissed };
}
