// persona.js — selectable voice characters. Each shapes the WORDING (greetings,
// acknowledgements, goal celebrations) and the TTS delivery (rate/pitch). This
// is personality only — it never changes what's counted, what's suggested, or
// the health boundaries. {name} and {goal} are filled at call time.

export const PERSONAS = {
  companion: {
    label: 'Companion', blurb: 'warm & friendly',
    rate: 1.04, pitch: 1.06,
    greet: ['Hey {name}, how can I help?', 'Hi {name}! What would you like to know?', 'Hey {name}, good to see you. What’s up?'],
    ack: ['Nice one', 'Got it', 'Lovely'],
    cheer: ['Amazing work, {name} — you hit your {goal} goal!', 'You did it, {name}! {goal} goal reached.'],
  },
  coach: {
    label: 'Coach', blurb: 'energetic & motivating',
    rate: 1.13, pitch: 1.12,
    greet: ['Let’s go {name}! What are we doing?', 'Hey {name}, ready to crush it? What’s up?', '{name}! Good to see you. What’s the plan?'],
    ack: ['Boom', 'Let’s go', 'That’s what I’m talking about'],
    cheer: ['YES {name}! {goal} goal — crushed it!', 'That’s the one, {name}! {goal} goal done. Keep that fire!'],
  },
  calm: {
    label: 'Calm guide', blurb: 'gentle & steady',
    rate: 0.95, pitch: 0.98,
    greet: ['Hello {name}. How can I help?', 'Hi {name}. Take a breath — what would you like?', 'Hello {name}, I’m here. What’s on your mind?'],
    ack: ['Noted', 'Well done', 'Good'],
    cheer: ['Beautifully done, {name}. Your {goal} goal is complete.', 'That’s your {goal} goal met, {name}. Nicely steady.'],
  },
};

export const PERSONA_KEYS = Object.keys(PERSONAS);

export function getPersona(key) {
  const k = PERSONAS[key] ? key : 'companion';
  return { key: k, ...PERSONAS[k] };
}

export function fill(tpl, vars = {}) {
  return String(tpl)
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\s+([,.!?])/g, '$1') // tidy " ," when a name was empty
    .replace(/\s+/g, ' ')
    .trim();
}

export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
