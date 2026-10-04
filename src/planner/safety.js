// safety.js — the agent's safety layer. Runs BEFORE any other interpretation of
// what the user says or writes (voice, check-in note, log text).
//
// Two tiers, detected from the user's own words (not inferred from data):
//   • crisis   — self-harm / suicidal language → warm, direct reply + crisis
//                resources. Never a "not sure" fallback, never an assessment.
//   • distress — self-reported anxiety/stress/low feelings → supportive reply +
//                an offer of a guided breathing exercise.
// Neither tier diagnoses or scores anything. This is not a crisis service; it
// makes sure the user is pointed to one.

const CRISIS_RE = /\b(kill(ing)?\s+myself|suicid\w*|end\s+(it\s+all|my\s+life)|take\s+my\s+(own\s+)?life|(hurt|harm)(ing)?\s+myself|self[-\s]?harm|don'?t\s+want\s+to\s+(live|be\s+here|be\s+alive|wake\s+up)|better\s+off\s+dead|no\s+reason\s+to\s+live|want\s+to\s+die|can'?t\s+go\s+on|hopeless)\b/i;

const FEEL = '(so\\s+|really\\s+|very\\s+|a\\s+bit\\s+|kind\\s+of\\s+|pretty\\s+)?';
const DISTRESS_RE = new RegExp(
  `\\bfeel(ing)?\\s+${FEEL}(down|low|sad|anxious|stressed|overwhelmed|nervous|worried|lonely|depressed|panicky|on\\s+edge|exhausted|burn(ed|t)\\s+out)\\b`
  + `|\\bi'?m\\s+${FEEL}(anxious|stressed|overwhelmed|nervous|worried|lonely|depressed|sad|panicking|exhausted|burn(ed|t)\\s+out|struggling|not\\s+okay|not\\s+ok)\\b`
  + `|\\bi\\s+am\\s+${FEEL}(anxious|stressed|overwhelmed|nervous|worried|lonely|depressed|sad|panicking|exhausted|struggling)\\b`
  + '|\\b(panic\\s+attack|can\'?t\\s+sleep|anxiety\\s+is)\\b',
  'i',
);

export function detectCrisis(text) { return CRISIS_RE.test(String(text || '')); }
export function detectDistress(text) { return !detectCrisis(text) && DISTRESS_RE.test(String(text || '')); }
export function safetyLevel(text) { return detectCrisis(text) ? 'crisis' : (detectDistress(text) ? 'distress' : null); }

// Region-specific crisis lines (well-established national services). Unknown
// region → emergency number + findahelpline.com, which covers every country.
export const REGION_LINES = {
  US: { label: 'United States', detail: 'Call or text 988 (Suicide & Crisis Lifeline), 24/7.', spoken: 'In the US you can call or text 9 8 8, any time.' },
  CA: { label: 'Canada', detail: 'Call or text 988 (Suicide Crisis Helpline), 24/7.', spoken: 'In Canada you can call or text 9 8 8, any time.' },
  GB: { label: 'UK & Ireland', detail: 'Call Samaritans on 116 123, 24/7.', spoken: 'You can call Samaritans on 1 1 6, 1 2 3, any time.' },
  AU: { label: 'Australia', detail: 'Call Lifeline on 13 11 14, 24/7.', spoken: 'You can call Lifeline on 13, 11, 14, any time.' },
  TH: { label: 'Thailand', detail: 'Call 1323 (Department of Mental Health hotline), 24/7.', spoken: 'In Thailand you can call 1 3 2 3, any time.' },
};
export const REGION_KEYS = Object.keys(REGION_LINES);

// Best guess from the browser locale; the user can override it in Setup.
export function regionFromLocale(locale) {
  const l = String(locale || '').toLowerCase();
  if (/^th\b|-th$/.test(l)) return 'TH';
  if (/-(gb|ie)$/.test(l)) return 'GB';
  if (/-ca$/.test(l)) return 'CA';
  if (/-au$/.test(l)) return 'AU';
  if (/-us$/.test(l)) return 'US';
  return null;
}

// Shown on screen. Emergency first, then the user's regional line, then a
// directory that works anywhere.
export function crisisResources(region) {
  const out = [{ label: 'Emergency', detail: 'If you are in immediate danger, call your local emergency number.' }];
  if (REGION_LINES[region]) out.push(REGION_LINES[region]);
  out.push({ label: 'Anywhere', detail: 'Find a free local line at findahelpline.com.' });
  return out;
}

export function crisisReply(name = '', region = null) {
  const who = name ? `${name}, ` : '';
  const line = REGION_LINES[region] ? REGION_LINES[region].spoken : 'You can find a free local crisis line at find a helpline dot com.';
  return `${who}I'm really glad you told me. I'm not able to help in an emergency, but you deserve support right now. `
    + 'If you might act on these thoughts or you are in danger, please call your local emergency number. '
    + `${line} `
    + 'Is there someone you trust you could reach out to right now?';
}

export function distressReply(name = '') {
  const who = name ? `, ${name}` : '';
  return `I'm sorry it feels heavy right now${who}. I can't assess what's going on, but slow breathing often helps in the moment. `
    + 'Say "breathe with me" and I\'ll guide you through a minute of box breathing. '
    + 'And if this keeps coming back, talking to someone you trust or a professional is really worth it.';
}

// Guided box breathing (4-4-4-4), three rounds ≈ 1 minute. Each step is spoken,
// then the agent waits `waitMs` in silence before the next cue.
export function breathingScript(rounds = 3) {
  const steps = [{ say: 'Okay. Let\'s breathe together. Sit comfortably, and let your shoulders drop.', waitMs: 1500 }];
  for (let i = 0; i < rounds; i += 1) {
    steps.push({ say: 'Breathe in', waitMs: 4000 });
    steps.push({ say: 'Hold', waitMs: 4000 });
    steps.push({ say: 'Breathe out', waitMs: 4000 });
    steps.push({ say: 'Hold', waitMs: 4000 });
  }
  steps.push({ say: 'Nice work. Take a normal breath. I\'ve logged that as a one-minute breathing session.', waitMs: 0 });
  return steps;
}
