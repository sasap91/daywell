// Activity suggestion — transparent and deterministic. Ranks the user's OWN
// saved activities, optionally filtered by category and (for movement) indoor.
// Shorter items rank first. No medical claim.

export function suggestActivities(state, iso, { categories = null, indoorOnly = false } = {}) {
  const day = state.days[iso];
  const plannedLibraryIds = new Set((day ? day.activities : []).map((a) => a.libraryId).filter(Boolean));
  const set = categories ? new Set(categories) : null;
  const suggestions = state.library.activities
    .filter((a) => !plannedLibraryIds.has(a.id))
    .filter((a) => (set ? set.has(a.category) : true))
    .filter((a) => (indoorOnly && a.category === 'movement' ? a.indoor : true))
    .sort((a, b) => a.durationMin - b.durationMin || a.title.localeCompare(b.title))
    .map((a) => ({ activity: a, reason: `${a.durationMin} min${a.indoor && a.category === 'movement' ? ', indoor' : ''}${a.tags.length ? ' · ' + a.tags.join(', ') : ''}` }));
  return { suggestions };
}
