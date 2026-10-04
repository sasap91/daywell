// llm.js — the optional LLM layer for analysis, next steps, and open-ended chat.
//
// Hybrid by design (PRD R09: "models propose, code verifies"):
//   • Code computes every FACT — minutes, pace, guideline status, check-in,
//     saved activities (analyze.js). The model never sees raw records it
//     doesn't need, and never computes numbers.
//   • The model INTERPRETS those facts: a short read on the week, one next
//     step (preferably one of the user's own saved activities), and replies to
//     questions the deterministic rules can't answer.
//   • Code VALIDATES everything the model returns before it is shown: only
//     real activity ids, only the provided guideline sources, length limits,
//     and no diagnosis / condition / biological-age / medication language.
//   • If the model is off, unavailable, slow, or returns anything invalid or
//     unsafe, callers fall back to the deterministic result.
//   • The safety layer (safety.js) never goes through the model.
//
// Providers: 'ondevice' (the browser's built-in model, e.g. Chrome's Prompt
// API — data stays on the device) or 'claude' (Anthropic API with the user's
// own key — minimal facts leave the device; disclosed in Setup).

import { CATEGORY_KEYS } from './state.js';
import { GUIDES } from './analyze.js';

export const AI_KEY = 'daywell.ai.v1';
export const PROVIDERS = ['off', 'ondevice', 'claude'];
export const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 — most capable'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — faster'],
  ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5 — fastest, lowest cost'],
];
export const DEFAULT_MODEL = 'claude-opus-5-5';
const TIMEOUT_MS = 25000;

// The only sources the model may cite — it picks a key, code supplies the text.
export const SOURCES = {
  who_activity: GUIDES.moveMin.source,
  cdc_sleep: GUIDES.sleep.source,
  nccih_mind: GUIDES.mind.source,
};
const SOURCE_KEYS = [...Object.keys(SOURCES), 'none'];

// ---------- config (device-local; never exported with backups) ----------

export function readAiConfig(storage = globalThis.localStorage) {
  let raw = {};
  try { raw = JSON.parse((storage && storage.getItem(AI_KEY)) || '{}') || {}; } catch { raw = {}; }
  const provider = PROVIDERS.includes(raw.provider) ? raw.provider : 'off';
  const model = CLAUDE_MODELS.some(([id]) => id === raw.model) ? raw.model : DEFAULT_MODEL;
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
  return { provider, model, apiKey };
}
export function writeAiConfig(cfg, storage = globalThis.localStorage) {
  try { storage.setItem(AI_KEY, JSON.stringify({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey || '' })); return true; } catch { return false; }
}
export function clearAiConfig(storage = globalThis.localStorage) { try { storage.removeItem(AI_KEY); } catch { /* ignore */ } }
export function aiReady(cfg) {
  if (cfg.provider === 'claude') return Boolean(cfg.apiKey);
  return cfg.provider === 'ondevice';
}

// ---------- context: the minimal, verified facts the model may use ----------

// Deliberately excludes: name, age, region, check-in notes, heart rate, and
// anything from a crisis/distress moment (callers don't invoke the model then).
export function buildContext(state, iso, a, nowMin = null) {
  const day = state.days[iso] || {};
  const ci = day.checkin;
  const recent = [];
  const dates = Object.keys(state.days || {}).filter((d) => d <= iso).sort().slice(-7);
  for (const d of dates) {
    for (const l of (state.days[d].activityLog || [])) recent.push({ date: d, category: l.category, title: String(l.text || '').slice(0, 60), minutes: l.durationMin || 0 });
  }
  let timeOfDay = null;
  if (nowMin != null) timeOfDay = nowMin < 720 ? 'morning' : (nowMin < 1020 ? 'afternoon' : 'evening');
  const base = a.recommendations[0] || {};
  return {
    date: iso,
    time_of_day: timeOfDay,
    week: { day_of_week: a.elapsed, days_left_including_today: a.daysLeft },
    goals: a.metrics.map((m) => ({ key: m.key, label: m.label, done: m.done, target: m.target, pace: m.status })),
    healthy_aging_guidelines: a.guidelines.map((g) => ({ key: g.key, label: g.label, status: g.status, detail: g.detail })),
    sleep_avg_hours: a.sleep.avg,
    checkin_today: ci ? { mood_1_to_5: ci.mood, energy_1_to_5: ci.energy } : null,
    capacity_today: a.capacity,
    mood_week_avg: a.mood.avgMood,
    saved_activities: (state.library.activities || []).slice(0, 30).map((x) => ({ id: x.id, category: x.category, title: String(x.title).slice(0, 60), minutes: x.durationMin })),
    recent_activity: recent.slice(-20),
    standard_next_step: base.title || null,
    allowed_categories: CATEGORY_KEYS,
    allowed_source_keys: SOURCE_KEYS,
  };
}

// ---------- prompts + structured-output schemas ----------

export const SYSTEM_PROMPT = [
  'You are Daywell, a warm, concise personal wellbeing companion.',
  'You receive FACTS computed by code about the user\'s own logged activity, their own weekly goals, and general public-health guidelines (WHO, CDC, NCCIH). These facts are the only information you may use.',
  'Rules:',
  '- Never invent numbers, activities, or sources. Cite a guideline only by its source_key.',
  '- You are not a clinician. Never diagnose, never suggest the user has any condition, and never mention biological age, aging reversal, disease risk, medication, supplements, or treatment.',
  '- Respect the user\'s self-reported energy and mood: when either is low, suggest something gentle and short.',
  '- Prefer one of the user\'s saved activities (return its exact id) when it fits; otherwise suggest a category.',
  '- Be specific, encouraging, and brief. Plain language. No emojis. Address the user as "you".',
].join('\n');

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short imperative next step, max 90 characters.' },
    why: { type: 'string', description: 'One or two sentences grounded in the facts, max 400 characters.' },
    category: { type: 'string', enum: CATEGORY_KEYS },
    activity_id: { type: 'string', description: 'Exact id of a saved activity, or empty string if none fits.' },
    minutes: { type: 'integer', description: 'Suggested minutes (1-120), or 0 if not applicable.' },
    source_key: { type: 'string', enum: SOURCE_KEYS },
  },
  required: ['title', 'why', 'category', 'activity_id', 'minutes', 'source_key'],
};

export const RECOMMEND_TOOL = {
  name: 'propose_next_step',
  description: 'Return a short read on the user\'s week and one realistic next step for today.',
  input_schema: {
    type: 'object',
    properties: {
      analysis: { type: 'string', description: '2-3 sentences interpreting the facts: what is going well, what is behind, and why the next step fits today. Max 500 characters.' },
      next_step: STEP_SCHEMA,
      also_consider: { type: 'array', items: STEP_SCHEMA, maxItems: 2 },
    },
    required: ['analysis', 'next_step', 'also_consider'],
  },
};

export const CHAT_TOOL = {
  name: 'reply_to_user',
  description: 'Reply to the user, and list any activities they said they did so the app can log them.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'At most 3 short sentences, grounded in the facts. Max 500 characters.' },
      log_entries: {
        type: 'array',
        maxItems: 3,
        description: 'Only activities the user explicitly said they DID. Empty if none.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORY_KEYS },
            title: { type: 'string', description: 'Short activity name, max 60 characters.' },
            minutes: { type: 'integer', description: 'Minutes if stated, else 0.' },
          },
          required: ['category', 'title', 'minutes'],
        },
      },
    },
    required: ['reply', 'log_entries'],
  },
};

export function recommendPrompt(ctx) {
  return `FACTS (JSON, computed by code):\n${JSON.stringify(ctx)}\n\nUsing only these facts, call ${RECOMMEND_TOOL.name} with your read on the week and the single best next step for today.`;
}
export function chatPrompt(ctx, userText) {
  return `FACTS (JSON, computed by code):\n${JSON.stringify(ctx)}\n\nThe user said: ${JSON.stringify(String(userText).slice(0, 500))}\n\nThe app's standard rules could not handle this. Call ${CHAT_TOOL.name}. If they described activities they did, include them in log_entries and confirm briefly in the reply. Never log anything they didn't say they did.`;
}

// ---------- validation: nothing reaches the user unchecked ----------

const BANNED_RE = /\b(diagnos\w*|disorders?|depressed|depressi(on|ve)|bipolar|adhd|ptsd|insomnia|you (might |may |probably |likely |could |seem to )?(have|suffer from|are suffering from) (an? )?(anxiety|condition|illness|burnout)|your (condition|illness)|biological(ly)? (age|younger)|age reversal|revers\w* (your )?aging|anti-?aging|cures?|curing|medicat\w*|prescri\w*|dosage|supplements?|cancer|diseases?|clinical(ly)?|suicid\w*|self-?harm)\b/i;

export function unsafeText(text) { return BANNED_RE.test(String(text || '')); }

function cleanStr(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }

function validateStep(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanStr(raw.title, 100);
  const why = cleanStr(raw.why, 450);
  if (title.length < 3) return null;
  if (unsafeText(title) || unsafeText(why)) return 'unsafe';
  const ids = new Map((ctx.saved_activities || []).map((x) => [x.id, x]));
  const act = raw.activity_id && ids.get(String(raw.activity_id)) ? ids.get(String(raw.activity_id)) : null; // invented ids are dropped
  const category = act ? act.category : (CATEGORY_KEYS.includes(raw.category) ? raw.category : null);
  if (!category) return null;
  const minutes = Number.isInteger(raw.minutes) && raw.minutes >= 1 && raw.minutes <= 120 ? raw.minutes : null;
  const sourceKey = SOURCES[raw.source_key] ? raw.source_key : null;
  return { title, why, category, activityId: act ? act.id : null, minutes, sourceKey, source: sourceKey ? SOURCES[sourceKey] : null };
}

export function validateRecommendation(raw, ctx) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const analysis = cleanStr(raw.analysis, 600);
  if (!analysis) return { ok: false, reason: 'missing analysis' };
  if (unsafeText(analysis)) return { ok: false, reason: 'unsafe language' };
  const next = validateStep(raw.next_step, ctx);
  if (next === 'unsafe') return { ok: false, reason: 'unsafe language' };
  if (!next) return { ok: false, reason: 'invalid next step' };
  const more = [];
  for (const s of Array.isArray(raw.also_consider) ? raw.also_consider.slice(0, 2) : []) {
    const v = validateStep(s, ctx);
    if (v === 'unsafe') return { ok: false, reason: 'unsafe language' };
    if (v) more.push(v);
  }
  return { ok: true, value: { analysis, next, more } };
}

export function validateChat(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const reply = cleanStr(raw.reply, 600);
  if (!reply) return { ok: false, reason: 'missing reply' };
  if (unsafeText(reply)) return { ok: false, reason: 'unsafe language' };
  const entries = [];
  for (const e of Array.isArray(raw.log_entries) ? raw.log_entries.slice(0, 3) : []) {
    if (!e || !CATEGORY_KEYS.includes(e.category)) continue;
    const title = cleanStr(e.title, 60);
    if (title.length < 2 || unsafeText(title)) continue;
    const minutes = Number.isInteger(e.minutes) && e.minutes >= 0 && e.minutes <= 600 ? e.minutes : 0;
    entries.push({ category: e.category, text: title, durationMin: minutes });
  }
  return { ok: true, value: { reply, entries } };
}

// ---------- providers ----------

export async function callClaude({ system, prompt, tool, cfg, fetchImpl = globalThis.fetch }) {
  if (!cfg.apiKey) throw new Error('No API key set');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl ? ctrl.signal : undefined,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for calls straight from a browser (the user's own key).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        max_tokens: 800,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = `${msg}: ${j.error.message}`; } catch { /* ignore */ }
      throw new Error(`Claude API error (${msg})`);
    }
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (!block) throw new Error('Claude returned no structured output');
    return block.input;
  } finally { if (timer) clearTimeout(timer); }
}

function onDeviceApi() {
  return globalThis.LanguageModel || (globalThis.ai && globalThis.ai.languageModel) || null;
}
export async function onDeviceStatus() {
  const api = onDeviceApi();
  if (!api) return 'unsupported';
  try {
    if (typeof api.availability === 'function') return await api.availability();
    if (typeof api.capabilities === 'function') {
      const c = await api.capabilities();
      return c.available === 'readily' ? 'available' : (c.available === 'after-download' ? 'downloadable' : 'unavailable');
    }
  } catch { /* fall through */ }
  return 'unavailable';
}
export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* try to extract */ }
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  throw new Error('Model did not return JSON');
}
async function callOnDevice({ system, prompt, tool }) {
  const api = onDeviceApi();
  if (!api) throw new Error('On-device model not available in this browser');
  const session = await api.create({ initialPrompts: [{ role: 'system', content: system }] });
  try {
    const text = await session.prompt(
      `${prompt}\n\nRespond ONLY with a JSON object for "${tool.name}" matching this JSON schema:\n${JSON.stringify(tool.input_schema)}`,
      { responseConstraint: tool.input_schema },
    );
    return parseJsonLoose(text);
  } finally { try { if (session.destroy) session.destroy(); } catch { /* ignore */ } }
}

export async function callModel(cfg, req, deps = {}) {
  if (cfg.provider === 'claude') return callClaude({ ...req, cfg, fetchImpl: deps.fetchImpl || globalThis.fetch });
  if (cfg.provider === 'ondevice') return (deps.onDevice || callOnDevice)(req);
  throw new Error('AI is off');
}

// ---------- high-level operations (throw → caller uses deterministic result) ----------

export async function aiRecommend(state, iso, a, cfg, deps = {}) {
  const ctx = buildContext(state, iso, a, deps.nowMin != null ? deps.nowMin : null);
  const raw = await callModel(cfg, { system: SYSTEM_PROMPT, prompt: recommendPrompt(ctx), tool: RECOMMEND_TOOL }, deps);
  const v = validateRecommendation(raw, ctx);
  if (!v.ok) throw new Error(`AI output rejected (${v.reason})`);
  return v.value;
}

export async function aiChat(state, iso, a, text, cfg, deps = {}) {
  const ctx = buildContext(state, iso, a, deps.nowMin != null ? deps.nowMin : null);
  const raw = await callModel(cfg, { system: SYSTEM_PROMPT, prompt: chatPrompt(ctx, text), tool: CHAT_TOOL }, deps);
  const v = validateChat(raw);
  if (!v.ok) throw new Error(`AI output rejected (${v.reason})`);
  return v.value;
}
