// On-device parse of spoken/typed text into a structured activity input.
// Deterministic keyword + duration extraction — no cloud AI, nothing leaves the
// device. The result is a PROPOSAL: the user reviews/edits it before saving.

const CATEGORY_KEYWORDS = [
  ['meditation', ['meditat', 'breath', 'mindful', 'box breathing', 'pranayama']],
  ['winddown', ['wind down', 'wind-down', 'winddown', 'relax', 'stretch', 'bath', 'shower', 'read', 'journal', 'tea', 'rest', 'nap']],
  ['music', ['music', 'playlist', 'song', 'listen']],
  ['movement', ['walk', 'run', 'jog', 'gym', 'workout', 'work out', 'exercise', 'yoga', 'cycle', 'bike', 'swim', 'strength', 'hike', 'pilates', 'row', 'cardio', 'lift']],
];

// Every category whose keywords appear, in priority order. The first is the
// primary; extras let the UI flag a mixed entry ("looks like two activities").
export function detectCategories(text) {
  const t = String(text || '').toLowerCase();
  const found = [];
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) found.push(cat);
  }
  return found;
}

export function detectCategory(text) {
  return detectCategories(text)[0] || 'movement';
}

// Number words, including two-word tens ("forty five" / "forty-five"). Compound
// forms are listed first so the alternation matches them whole, not just the ten.
const NUM_WORD = '(?:(?:twenty|thirty|forty|fifty)[\\s-](?:one|two|three|four|five|six|seven|eight|nine)|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const WORDS = { ...ONES, zero: 0, a: 1, an: 1, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordToNumber(phrase) {
  const parts = phrase.replace(/-/g, ' ').trim().split(/\s+/);
  if (parts.length === 2 && WORDS[parts[0]] != null && ONES[parts[1]] != null && WORDS[parts[0]] % 10 === 0) {
    return WORDS[parts[0]] + ONES[parts[1]];
  }
  return parts.length === 1 && WORDS[parts[0]] != null ? WORDS[parts[0]] : null;
}

const MIN_WORD_RE = new RegExp(`\\b(${NUM_WORD})\\s+(?:minutes?|mins?)\\b`);
const HR_WORD_RE = new RegExp(`\\b(${NUM_WORD})\\s+hours?\\b`);

// Returns minutes, or 0 when no explicit duration is present. Only an explicit
// time unit (digit or spelled) counts — a bare "5k", "3 sets", or "gym at 6"
// is deliberately NOT read as a duration, so the user fills it in instead.
export function detectDuration(text) {
  let t = String(text || '').toLowerCase();
  let total = 0;
  let matched = false;

  // Spelled fractions of an hour, removed once counted so "half an hour" does
  // not also match the generic spelled-hour rule below.
  t = t.replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an?\s+)?hour\b/g, () => { total += 15; matched = true; return ' '; });
  t = t.replace(/\bhalf\s+(?:an?\s+)?hour\b/g, () => { total += 30; matched = true; return ' '; });

  // Hours: digit ("1 hour", "1.5 hrs") preferred; else spelled ("an hour").
  const hrDigit = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(t);
  if (hrDigit) { total += Math.round(parseFloat(hrDigit[1]) * 60); matched = true; }
  else {
    const hrWord = HR_WORD_RE.exec(t);
    const n = hrWord ? wordToNumber(hrWord[1]) : null;
    if (n != null) { total += n * 60; matched = true; }
  }

  // Minutes: digit ("30 min") preferred; else spelled ("ten minutes").
  const minDigit = /(\d+)\s*(?:minutes?|mins?|min|m)\b/.exec(t);
  if (minDigit) { total += parseInt(minDigit[1], 10); matched = true; }
  else {
    const minWord = MIN_WORD_RE.exec(t);
    const n = minWord ? wordToNumber(minWord[1]) : null;
    if (n != null) { total += n; matched = true; }
  }

  return matched && total > 0 && total <= 1440 ? total : 0;
}

// Returns { category, categories, title, durationMin }.
export function parseSpoken(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  const categories = detectCategories(clean);
  return {
    category: categories[0] || 'movement',
    categories,
    title: clean.slice(0, 200) || 'Activity',
    durationMin: detectDuration(clean),
  };
}
