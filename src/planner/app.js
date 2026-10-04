// Daywell personal health agent — UI controller: Today / History / Plan / Setup,
// plus an always-present composer (type or talk) on every page. All user text is
// rendered safely via el(). No clinical/mental-health assessment — suggestions
// come from the user's own check-in, logs, goals, and cited guidelines.

import { el, clear } from '../dom.js';
import { formatRange, toClockInput, parseClock, formatDateLabel, deviceTimeZone, localDateString } from '../time.js';
import {
  loadState, saveState, clearState, exportState, ensureDay, todayIso,
  defaultState, validateState, uid, CATEGORIES, CATEGORY_KEYS,
} from './state.js';
import { analyze } from './analyze.js';
import { buildNudges } from './nudges.js';
import { recap } from './recap.js';
import { answerQuery } from './ask.js';
import { getPersona, PERSONA_KEYS, fill, pick } from './persona.js';
import { safetyLevel, crisisResources, regionFromLocale, REGION_KEYS, REGION_LINES, breathingScript } from './safety.js';
import { addStarterActivities, onboardingStatus, RECOMMENDED_GOALS, STARTER_ACTIVITIES } from './onboarding.js';
import { readAiConfig, writeAiConfig, clearAiConfig, aiReady, aiRecommend, aiChat, buildContext, onDeviceStatus, CLAUDE_MODELS } from './llm.js';
import { suggestActivities } from './match.js';
import { recoverActivity } from './recovery.js';
import { parseMovementUpload, parseHealthExport, isAppleHealthExport } from './ingest.js';
import { voiceSupported, startVoice } from './voice.js';
import { HEALTHY_AGING_NOTES, DISCLAIMER } from './evidence.js';
import { importCalendar } from '../connectors.js';

const $ = (s) => document.querySelector(s);

let state;
let iso = todayIso();
let view = 'summary';
let saveFlag = { ok: true, error: null };
let movementCtx = { floor: 0, indoorOnly: false };
let planCat = 'movement';
let recapDim = 'week';
// Composer (type or talk, on every page).
let chat = []; // { who: 'you'|'daywell', text, undo?: { iso, id }, undone? }
let chatOpen = true;
let composerDraft = '';
let lastEntry = null; // most recent entry created in conversation → "45 minutes" amends it
// Optional LLM layer (llm.js). Config is device-local; results are cached per
// fingerprint of the verified facts so the model is called only when they change.
let aiCfg = { provider: 'off', model: '', apiKey: '' };
let aiRec = { key: null, status: 'idle', value: null, error: null };
let onDeviceState = 'unknown';
// Speech-to-speech voice mode state.
let voiceMode = false;
let voiceLoopStop = null;
let voiceSpeaking = false;
let voiceStatus = 'idle';
let wakeOn = false;
let wakeStop = null;
// Safety + guided breathing state.
let sessionSupport = null; // 'distress' | 'crisis' — raised by what the user said/typed this session
let supportDismissed = false;
let breathing = false;
let breathTimer = null;

function boot() {
  const res = loadState();
  state = res.state;
  if (res.found && res.errors && res.errors.length) flash(`Recovered your data with ${res.errors.length} issue(s) fixed.`, 'warn');
  ensureDay(state, iso);
  aiCfg = readAiConfig();
  onDeviceStatus().then((st) => { onDeviceState = st; if (view === 'setup') render(); });
  view = viewFromHash();
  wireChrome();
  render();
  loadVoices();
  maybeRemind();
}

function persist() { saveFlag = saveState(state); renderSaveState(); return saveFlag.ok; }
function update(fn, msg) { fn(); const ok = persist(); if (msg) flash(msg, ok ? 'ok' : 'error'); render(); }
function day() { return ensureDay(state, iso); }

// ---------- chrome ----------

function wireChrome() {
  $('#nav').addEventListener('click', (e) => { const btn = e.target.closest('.nav-btn'); if (!btn) return; go(btn.dataset.view); });
  window.addEventListener('hashchange', () => { const v = viewFromHash(); if (v !== view) { view = v; render(); window.scrollTo(0, 0); } });
  $('#app-date').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { iso = e.target.value; ensureDay(state, iso); render(); } });
  $('#date-prev').addEventListener('click', () => shiftDate(-1));
  $('#date-next').addEventListener('click', () => shiftDate(1));
}
function shiftDate(delta) { const [y, m, d] = iso.split('-').map(Number); iso = localDateString(new Date(y, m - 1, d + delta)); ensureDay(state, iso); render(); }
function renderChrome() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#app-date').value = iso;
  $('#date-human').textContent = formatDateLabel(iso);
  renderSaveState();
}
function renderSaveState() { const n = $('#save-state'); clear(n); n.append(el('span', { class: `pill ${saveFlag.ok ? 'ok' : 'error'}`, text: saveFlag.ok ? 'Saved' : `Not saved: ${saveFlag.error}` })); }

function render() {
  const keepFocus = document.activeElement && document.activeElement.id === 'composer-input';
  const root = $('#view');
  try {
    renderChrome();
    clear(root);
    renderSupport(root);
    if (supportLevel() !== 'crisis' && view !== 'summary') renderNudge(root); // Today places it after the greeting; none during a crisis
    if (view === 'summary') renderToday(root);
    else if (view === 'log') renderLog(root);
    else if (view === 'plan') renderPlan(root);
    else renderSetup(root);
  } catch (err) {
    // Error boundary: never a blank page. Data is untouched (render only reads).
    console.error('Daywell render error:', err);
    clear(root);
    root.append(el('section', { class: 'panel', 'data-render-error': 'true', role: 'alert' }, [
      el('h2', { text: 'Something went wrong showing this page' }),
      el('p', { text: 'Your data is safe on this device. Try another tab, or reload.' }),
      el('p', { class: 'muted small mono', text: String((err && err.message) || err) }),
      el('button', { class: 'btn', text: 'Reload', onclick: () => location.reload() }),
    ]));
  }
  try { renderComposer(); } catch (err) { console.error('Daywell composer error:', err); }
  if (keepFocus) focusComposer();
}

// ---- routing: each tab has a URL (#today, #history, #plan, #setup), so the
// back button, refresh, and shared links all land on the right page. ----
const VIEW_HASH = { summary: 'today', log: 'history', plan: 'plan', setup: 'setup' };
function viewFromHash() {
  const h = location.hash.replace('#', '');
  return Object.keys(VIEW_HASH).find((k) => VIEW_HASH[k] === h) || view; // unknown (e.g. #view skip link) → stay
}
function go(v) {
  const h = `#${VIEW_HASH[v] || 'today'}`;
  if (location.hash !== h) location.hash = h; // hashchange renders
  else { view = v; render(); }
  window.scrollTo(0, 0);
}

// ---- LLM layer: interpret verified facts; code validates; rules are the fallback ----
function aiOn() { return aiReady(aiCfg); }
function aiFingerprint(a) { return `${aiCfg.provider}|${aiCfg.model}|${JSON.stringify(buildContext(state, iso, a, nowMinForView()))}`; }
// Starts (at most once per set of facts) an AI recommendation. Never during a
// distress/crisis moment — those stay fully deterministic.
function ensureAiRec(a) {
  if (!aiOn() || supportLevel()) return null;
  const key = aiFingerprint(a);
  if (aiRec.key === key) return aiRec;
  aiRec = { key, status: 'loading', value: null, error: null };
  aiRecommend(state, iso, a, aiCfg, { nowMin: nowMinForView() })
    .then((v) => { if (aiRec.key === key) { aiRec = { key, status: 'ready', value: v, error: null }; render(); } })
    .catch((err) => { if (aiRec.key === key) { aiRec = { key, status: 'error', value: null, error: String((err && err.message) || err) }; render(); } });
  return aiRec;
}
function aiStepToRec(step, priority) {
  const act = step.activityId ? state.library.activities.find((x) => x.id === step.activityId) : null;
  return { priority, side: CATEGORIES[step.category].side, title: step.title, rationale: step.why, source: step.source, activity: act, addCat: act ? null : step.category, ai: true };
}

// ---- the composer: one input on every page. Type or talk; it logs, answers,
// summarizes, and guides breathing through the same engine as voice mode.
// Logging is instant with Undo (no confirm dialogs). ----
function crisisRegion() { return state.profile.region || regionFromLocale(typeof navigator !== 'undefined' ? navigator.language : '') || null; }
function quickPrompts() {
  const out = [];
  const d = state.days[iso];
  if (!d || !d.activityLog.length) out.push(['+ Log a walk', '__fill:20 min walk']);
  out.push(['What next?', 'What should I do next?']);
  out.push([`My ${recapDim}`, `How's my ${recapDim}?`]);
  if (ttsSupported()) out.push(['🫁 Breathe', '__breathe']);
  return out;
}
function renderComposer() {
  const host = $('#composer'); if (!host) return;
  clear(host);
  const inner = el('div', { class: 'composer-inner' });
  if (chat.length && chatOpen) {
    inner.append(el('div', { class: 'chat-head' }, [
      el('span', { class: 'muted small', text: 'Conversation' }),
      el('button', { class: 'link', type: 'button', text: 'Hide', onclick: () => { chatOpen = false; renderComposer(); } }),
    ]));
    const log = el('div', { class: 'chat', 'aria-live': 'polite' });
    for (const m of chat.slice(-6)) {
      const b = el('div', { class: `bubble ${m.who}${m.undone ? ' undone' : ''}${m.thinking ? ' thinking' : ''}` }, [el('span', { text: m.text })]);
      if (m.ai) b.append(el('span', { class: 'ai-badge', title: 'Written by the AI, checked against your data', text: '✨ AI' }));
      if (m.undo && !m.undone) b.append(el('button', { class: 'link undo', type: 'button', text: 'Undo', onclick: () => undoEntry(m) }));
      log.append(b);
    }
    inner.append(log);
  } else if (chat.length) {
    inner.append(el('button', { class: 'link', type: 'button', text: `Show conversation (${chat.length})`, onclick: () => { chatOpen = true; renderComposer(); } }));
  }
  if (voiceMode || breathing || wakeOn) {
    inner.append(el('div', { class: 'composer-status' }, [
      el('span', { class: 'grow', text: breathing ? '🫁 Breathing together…' : (voiceMode ? voiceStatusText() : '👂 Say “Hey Daywell” to talk') }),
      (voiceMode || breathing) ? el('button', { class: 'btn tiny danger', type: 'button', text: 'Stop', onclick: () => { if (breathing) finishBreathing(false); else stopVoiceMode(); } }) : null,
    ]));
  }
  const chips = el('div', { class: 'chips composer-chips' });
  for (const [label, cmd] of quickPrompts()) {
    chips.append(el('button', { type: 'button', class: 'chip liked', text: label, onclick: () => {
      if (cmd === '__breathe') startBreathing();
      else if (cmd.startsWith('__fill:')) focusComposer(cmd.slice(7));
      else send(cmd);
    } }));
  }
  inner.append(chips);
  inner.append(el('form', { class: 'composer-row', onsubmit: (e) => { e.preventDefault(); send($('#composer-input').value); } }, [
    el('input', { id: 'composer-input', type: 'text', autocomplete: 'off', enterkeyhint: 'send', placeholder: 'Log an activity or ask Daywell…', 'aria-label': 'Message Daywell', value: composerDraft, oninput: (e) => { composerDraft = e.target.value; } }),
    voiceSupported() ? el('button', { type: 'button', class: `btn mic ${voiceMode ? 'on' : ''}`, 'aria-label': voiceMode ? 'Stop talking' : 'Talk to Daywell', title: voiceMode ? 'Stop' : 'Talk (speech to speech)', text: voiceMode ? '■' : '🎤', onclick: toggleVoiceMode }) : null,
    el('button', { type: 'submit', class: 'btn primary send', 'aria-label': 'Send', text: '➤' }),
  ]));
  host.append(inner);
  // Reserve exactly the composer's height so it never covers page content.
  try { document.documentElement.style.setProperty('--composer-h', `${host.offsetHeight}px`); } catch { /* ignore */ }
}
function focusComposer(prefill) {
  const i = $('#composer-input'); if (!i) return;
  if (prefill != null) { i.value = prefill; composerDraft = prefill; }
  i.focus();
  try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* ignore */ }
}
function send(raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  composerDraft = '';
  const { res, pending } = converse(text, { spoken: false });
  chatOpen = true;
  render();
  if (res.action === 'breathe') startBreathing();
  else focusComposer();
  if (pending) pending.then(() => focusComposer());
}
// The single conversation path for typed AND spoken input. Rule-handled turns
// are instant; turns the rules can't handle go to the LLM (if enabled), whose
// reply and proposed log entries are validated before anything is saved.
// Returns { res, reply, pending } — pending resolves to the final reply text.
function converse(text, { spoken }) {
  const atIso = iso;
  const res = answerQuery(state, iso, text, { dimension: recapDim, nowMin: nowMinForView(), name: firstName(), persona: state.profile.persona, region: crisisRegion(), lastEntry });
  let reply = res.reply;
  let undo = null;
  if (res.stop && !voiceMode) reply = 'Okay.';
  if (res.action === 'log' && res.entry) {
    const before = goalMetKeys();
    const id = uid('al');
    day().activityLog.push({ id, category: res.entry.category, text: res.entry.text, durationMin: res.entry.durationMin || 0, source: spoken ? 'voice' : 'text', at: new Date().toISOString() });
    persist();
    lastEntry = { iso, id, text: res.entry.text };
    undo = { iso, ids: [id] };
    const labels = newlyMetLabels(before);
    if (labels.length) { if (soundOn()) playChime(); reply = `${reply} ${cheerLine(labels)}`; }
  }
  if (res.action === 'amend' && lastEntry) {
    const before = goalMetKeys();
    const e = ensureDay(state, lastEntry.iso).activityLog.find((x) => x.id === lastEntry.id);
    if (e) {
      e.durationMin = res.durationMin; persist();
      const labels = newlyMetLabels(before);
      if (labels.length) { if (soundOn()) playChime(); reply = `${reply} ${cheerLine(labels)}`; }
    }
  }
  if (res.safety) raiseSupport(res.safety);
  if (res.dimension) recapDim = res.dimension;

  const aiAllowed = aiOn() && !res.safety && !supportLevel();
  // "What should I do next?" → the same AI next step the Today card shows, if ready.
  if (aiAllowed && res.intent === 'next' && aiRec.status === 'ready' && aiRec.key === aiFingerprint(analyze(state, iso))) {
    reply = `${aiRec.value.next.title}. ${aiRec.value.next.why}`;
  }
  chat.push({ who: 'you', text });
  if (aiAllowed && res.fallback) {
    const msg = { who: 'daywell', text: 'Thinking…', thinking: true };
    chat.push(msg);
    const pending = aiChat(state, atIso, analyze(state, atIso), text, aiCfg, { nowMin: nowMinForView() })
      .then((v) => {
        let final = v.reply;
        if (v.entries.length) {
          const before = goalMetKeys();
          const ids = [];
          for (const en of v.entries) {
            const id = uid('al');
            ensureDay(state, atIso).activityLog.push({ id, category: en.category, text: en.text, durationMin: en.durationMin, source: spoken ? 'voice' : 'text', at: new Date().toISOString() });
            ids.push(id);
            lastEntry = { iso: atIso, id, text: en.text };
          }
          persist();
          msg.undo = { iso: atIso, ids };
          const labels = newlyMetLabels(before);
          if (labels.length) { if (soundOn()) playChime(); final = `${final} ${cheerLine(labels)}`; }
        }
        Object.assign(msg, { text: final, thinking: false, ai: true });
        return final;
      })
      .catch(() => { Object.assign(msg, { text: res.reply, thinking: false }); return res.reply; })
      .then((final) => { render(); return final; });
    return { res, reply: res.reply, pending };
  }
  chat.push({ who: 'daywell', text: reply, undo, ai: aiAllowed && res.intent === 'next' && reply !== res.reply });
  if (chat.length > 40) chat = chat.slice(-40);
  return { res, reply, pending: null };
}
function undoEntry(m) {
  const dd = state.days[m.undo.iso];
  const ids = m.undo.ids || [m.undo.id];
  if (dd) dd.activityLog = dd.activityLog.filter((x) => !ids.includes(x.id));
  m.undone = true;
  if (lastEntry && ids.includes(lastEntry.id)) lastEntry = null;
  persist();
  chat.push({ who: 'daywell', text: ids.length > 1 ? `Undone — I removed those ${ids.length} entries.` : 'Undone — I removed that entry.' });
  render();
}

// ---- safety: a support card on every page when the user's own words signal
// distress or crisis (check-in note, voice, or log text). Not an assessment. ----
const LEVEL_RANK = { distress: 1, crisis: 2 };
function raiseSupport(level) {
  if (!level) return;
  if (!sessionSupport || LEVEL_RANK[level] > LEVEL_RANK[sessionSupport]) sessionSupport = level;
  supportDismissed = false;
}
function supportLevel() {
  const d = state.days[iso];
  const noteLevel = d && d.checkin && d.checkin.note ? safetyLevel(d.checkin.note) : null;
  if (sessionSupport === 'crisis' || noteLevel === 'crisis') return 'crisis';
  return sessionSupport || noteLevel || null;
}
function renderSupport(root) {
  const level = supportLevel();
  if (!level || supportDismissed) return;
  const crisis = level === 'crisis';
  const card = el('section', { class: `panel support ${crisis ? 'support-crisis' : 'support-distress'}`, role: crisis ? 'alert' : 'status' });
  card.append(el('h2', { text: crisis ? 'You don’t have to go through this alone' : 'Feeling heavy today?' }));
  card.append(el('p', { text: crisis
    ? 'You deserve support right now. Daywell can’t help in an emergency, but these people can — any time:'
    : 'Thanks for telling me. I can’t assess what’s going on, but a minute of slow breathing often helps in the moment. If this keeps coming back, talking to someone you trust or a professional is worth it.' }));
  if (crisis) {
    const list = el('ul', { class: 'support-list' });
    for (const r of crisisResources(crisisRegion())) list.append(el('li', {}, [el('strong', { text: `${r.label}: ` }), r.detail]));
    card.append(list);
  }
  card.append(el('div', { class: 'row wrap' }, [
    breathing
      ? el('button', { class: 'btn danger', text: '■ Stop breathing', onclick: () => finishBreathing(false) })
      : el('button', { class: 'btn primary', text: '🫁 Breathe with me (1 min)', onclick: startBreathing }),
    el('button', { class: 'btn tiny', text: 'Hide for now', onclick: () => { supportDismissed = true; render(); } }),
  ]));
  root.append(card);
}

// A proactive, on-every-page banner: how you're tracking vs your own goals.
// Descriptive and dismissible — not a health judgment. (Inspired by proactive
// assistants, kept inside Daywell's no-inference, no-score boundary.)
let nudgeDismissed = false;
function curMinutes() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function nowMinForView() { return iso === todayIso() ? curMinutes() : null; }
function renderNudge(root) {
  if (nudgeDismissed) return;
  const { primary } = buildNudges(state, iso, nowMinForView());
  if (!primary || primary.kind === 'ok') return;
  root.append(el('div', { class: `nudge nudge-${primary.kind}` }, [
    el('span', { class: 'grow', text: primary.text }),
    el('button', { class: 'btn tiny primary', text: primary.label, onclick: () => go(primary.target) }),
    el('button', { class: 'btn ghost', 'aria-label': 'Dismiss', text: '×', onclick: () => { nudgeDismissed = true; render(); } }),
  ]));
}

// ---- optional local reminders (device-local pref; honest about web limits) ----
const REMIND_KEY = 'daywell.remind.v1';
function readRemind() { try { return JSON.parse(localStorage.getItem(REMIND_KEY) || '{}') || {}; } catch { return {}; } }
function writeRemind(o) { try { localStorage.setItem(REMIND_KEY, JSON.stringify(o)); } catch { /* ignore */ } }
function notifySupported() { return typeof Notification !== 'undefined'; }
function remindEnabled() { return notifySupported() && readRemind().enabled === true && Notification.permission === 'granted'; }
function maybeRemind() {
  if (!remindEnabled()) return;
  const pref = readRemind();
  if (pref.lastNotified === iso) return; // once per day, on open
  const { primary } = buildNudges(state, iso, nowMinForView());
  if (!primary || primary.kind === 'ok') return;
  try { const n = new Notification('Daywell', { body: primary.text }); n.onclick = () => { try { window.focus(); } catch { /* ignore */ } }; writeRemind({ ...pref, lastNotified: iso }); } catch { /* ignore */ }
}
async function toggleRemind() {
  const pref = readRemind();
  if (pref.enabled) { writeRemind({ ...pref, enabled: false }); flash('Reminders off.', 'ok'); render(); return; }
  if (!notifySupported()) { flash('This browser can’t show notifications.', 'warn'); return; }
  if (Notification.permission === 'denied') { flash('Notifications are blocked in your browser settings.', 'warn'); return; }
  let perm = Notification.permission;
  if (perm !== 'granted') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
  if (perm === 'granted') { writeRemind({ ...pref, enabled: true }); flash('Reminders on — you’ll see one when you open Daywell if you’re off pace.', 'ok'); maybeRemind(); render(); }
  else flash('Notification permission not granted.', 'warn');
}

// ---------- shared ----------

function panel(title, step) { const p = el('section', { class: 'panel' }); if (step) p.append(el('p', { class: 'step', text: step })); p.append(el('h2', { text: title })); return p; }
function statusChip(status) { return el('span', { class: `chip ${status}`, text: status }); }
function catTag(category) { return el('span', { class: 'tag', text: CATEGORIES[category] ? CATEGORIES[category].label : category }); }

// ---------- TODAY: greeting → setup → check-in → do next → your week ----------

const MOODS = [[1, '😞', 'Very low'], [2, '🙁', 'Low'], [3, '😐', 'Okay'], [4, '🙂', 'Good'], [5, '😄', 'Great']];
const ENERGY = [[1, '🪫', 'Drained'], [2, '😴', 'Tired'], [3, '🔋', 'Steady'], [4, '💪', 'Good'], [5, '⚡', 'Charged']];
function partOfDay() { const h = new Date().getHours(); if (h >= 5 && h < 12) return 'morning'; if (h >= 12 && h < 17) return 'afternoon'; return 'evening'; }

function renderToday(root) {
  const d = day();
  const a = analyze(state, iso);
  const who = firstName();

  const ob = onboardingStatus(state);
  const fresh = !state.profile.goalsSet && !d.activityLog.length; // brand-new: welcome, don't grade
  root.append(el('section', { class: 'hero' }, [
    el('h1', { text: iso === todayIso() ? `Good ${partOfDay()}${who ? `, ${who}` : ''}` : formatDateLabel(iso) }),
    el('p', { class: `hero-status ${fresh ? 'ok' : a.status.tone}`, text: fresh ? 'Welcome to Daywell — a 30-second setup below, then just tell me what you do.' : a.status.label }),
  ]));

  if (ob.show) root.append(renderOnboarding(ob));
  else if (supportLevel() !== 'crisis') renderNudge(root);

  root.append(renderCheckin(d));

  // ---- One clear next step; extras tucked away ----
  const recCard = (r) => {
    const card = el('div', { class: `rec ${r.priority} side-${r.side}` });
    card.append(el('p', { class: 'rec-title', text: r.title }));
    card.append(el('p', { class: 'rec-why', text: r.rationale }));
    if (r.source) card.append(el('p', { class: 'rec-src', text: `Source: ${r.source}` }));
    const cta = el('div', { class: 'row wrap actions' });
    if (r.activity) {
      cta.append(el('button', { class: 'btn tiny primary', text: '✓ I did it', onclick: () => quickLog(r.activity) }));
      cta.append(el('button', { class: 'btn tiny', text: 'Plan for later', onclick: () => addPlanned(r.activity) }));
    } else if (r.goSetup) {
      cta.append(el('button', { class: 'btn tiny primary', text: 'Set goals', onclick: () => go('setup') }));
    } else if (r.addCat) {
      cta.append(el('button', { class: 'btn tiny primary', text: 'Tell Daywell when done', onclick: () => focusComposer('I did ') }));
      cta.append(el('button', { class: 'btn tiny', text: `Save a ${CATEGORIES[r.addCat].label.toLowerCase()} activity`, onclick: () => go('setup') }));
    }
    if (cta.childNodes.length) card.append(cta);
    return card;
  };
  // AI (if enabled) interprets the verified facts; the rule-based step shows
  // instantly and remains the fallback — and stays visible for comparison.
  const ai = ensureAiRec(a);
  const aiReadyNow = Boolean(ai && ai.status === 'ready');
  const rulesLabel = a.capacity === 'low' || a.capacity === 'high' ? 'Adapted to your check-in' : 'One step, matched to your goals';
  const np = panel('Do next', aiReadyNow ? '✨ AI read · checked against your data' : rulesLabel);
  if (aiReadyNow) np.append(el('p', { class: 'ai-analysis', text: ai.value.analysis }));
  if (ai && ai.status === 'loading') np.append(el('p', { class: 'muted small ai-status', text: '✨ Personalizing with AI… showing the standard step meanwhile.' }));
  if (ai && ai.status === 'error') np.append(el('p', { class: 'muted small ai-status', text: `AI unavailable — showing the standard recommendation. (${ai.error})` }));
  const recs = aiReadyNow ? [aiStepToRec(ai.value.next, 'primary'), ...ai.value.more.map((st) => aiStepToRec(st, 'secondary'))] : a.recommendations;
  np.append(recCard(recs[0]));
  const more = recs.slice(1);
  if (more.length) {
    const det = el('details', { class: 'evidence' }, [el('summary', { text: `More suggestions (${more.length})` })]);
    for (const r of more) det.append(recCard(r));
    np.append(det);
  }
  if (aiReadyNow) {
    const std = el('details', { class: 'evidence' }, [el('summary', { text: 'Standard suggestion (rule-based)' })]);
    std.append(recCard({ ...a.recommendations[0], priority: 'secondary' }));
    np.append(std);
  }
  root.append(np);

  // ---- Your week: rings, guidelines, what you've done, mood ----
  const rc = recap(state, iso, recapDim);
  const dp = panel('Your week', 'Your logs vs your goals');
  const tools = el('div', { class: 'row wrap toggle' });
  for (const dmn of ['day', 'week', 'month']) tools.append(el('button', { class: `btn tiny ${recapDim === dmn ? 'primary' : ''}`, text: dmn[0].toUpperCase() + dmn.slice(1), 'aria-pressed': recapDim === dmn ? 'true' : 'false', onclick: () => { recapDim = dmn; render(); } }));
  if (ttsSupported()) tools.append(el('button', { class: 'btn tiny', text: '🔊 Listen', title: `Hear your ${recapDim} recap`, onclick: () => speak(rc.speech) }));
  dp.append(tools);
  dp.append(el('div', { class: 'rings' }, a.metrics.map(ring)));

  dp.append(el('h3', { text: `Healthy-aging guidelines · ${a.guidelinesMet}/${a.guidelines.length} met` }));
  const gl = el('div', { class: 'list' });
  for (const g of a.guidelines) gl.append(el('div', { class: 'row wrap summary-line' }, [
    el('span', { class: 'grow', text: `${g.label} — ${g.detail}${g.note ? ` (${g.note})` : ''}` }),
    el('span', { class: 'muted small', text: g.target }),
    guidelineChip(g.status),
  ]));
  dp.append(gl);

  const done = el('details', { class: 'evidence' });
  done.append(el('summary', { text: `What you’ve done ${rc.label} — ${rc.total} logged${rc.bySource.voice ? `, ${rc.bySource.voice} by voice` : ''}` }));
  if (!rc.total) done.append(el('p', { class: 'muted small', text: `Nothing logged ${rc.label} yet.` }));
  for (const it of rc.items.slice().reverse().slice(0, 20)) done.append(el('div', { class: 'row wrap summary-line' }, [
    catTag(it.category),
    el('span', { class: 'grow', text: `${it.text}${it.durationMin ? ` · ${it.durationMin} min` : ''}` }),
    el('span', { class: 'tag', text: it.source }),
    el('span', { class: 'mono', text: it.date.slice(5) }),
  ]));
  dp.append(done);

  dp.append(moodSpark(a.mood.series));
  const bits = [];
  if (a.sleep.avg != null) bits.push(`Sleep ${a.sleep.avg}h avg${a.sleep.below ? ' (below 7h)' : ''}`);
  if (a.mood.avgMood != null) bits.push(`Mood ${a.mood.avgMood}/5 · Energy ${a.mood.avgEnergy}/5`);
  if (bits.length) dp.append(el('p', { class: 'muted small', text: bits.join('  ·  ') }));
  const details = el('details', { class: 'evidence' });
  details.append(el('summary', { text: 'Evidence & limits' }));
  for (const note of HEALTHY_AGING_NOTES) details.append(el('div', { class: 'item' }, [el('strong', { text: note.topic }), el('span', { text: ` — ${note.text}` }), el('div', { class: 'muted small', text: `Source: ${note.source}` })]));
  details.append(el('p', { class: 'muted small', text: DISCLAIMER }));
  details.append(el('p', { class: 'muted small', text: 'Guidelines are general guidance associated with healthy aging — separate from your personal goals. No biological age is estimated: that needs lab or DNA-methylation testing, not activity logs. Not medical advice.' }));
  dp.append(details);
  root.append(dp);
}

function renderOnboarding(ob) {
  const p = panel('Let’s get you set up', `${3 - ob.remaining} of 3 done · about 30 seconds`);
  const step = (isDone, doneText, todo) => el('div', { class: `onboard-step ${isDone ? 'done' : ''}` }, isDone ? [el('span', { text: `✓ ${doneText}` })] : todo);
  const g = state.profile.goals; const rg = RECOMMENDED_GOALS;
  p.append(step(ob.steps.name, `Hi ${firstName()}!`, [
    el('span', { class: 'grow', text: '1. What should I call you?' }),
    el('input', { id: 'ob-name', type: 'text', placeholder: 'First name', maxlength: '40', 'aria-label': 'Your first name', onkeydown: (e) => { if (e.key === 'Enter') saveObName(); } }),
    el('button', { class: 'btn tiny primary', text: 'Save', onclick: saveObName }),
  ]));
  p.append(step(ob.steps.goals, `Goals: ${g.movementMinutesPerWeek} min movement · ${g.movementSessionsPerWeek} sessions · ${g.mindfulnessSessionsPerWeek} mind sessions a week`, [
    el('span', { class: 'grow', text: `2. Weekly goals — recommended: ${rg.movementMinutesPerWeek} min movement (WHO), ${rg.movementSessionsPerWeek} sessions, ${rg.mindfulnessSessionsPerWeek} mind sessions` }),
    el('button', { class: 'btn tiny primary', text: 'Use these', onclick: () => update(() => { state.profile.goals = { ...rg }; state.profile.goalsSet = true; }, 'Goals set.') }),
    el('button', { class: 'btn tiny', text: 'Customize', onclick: () => go('setup') }),
  ]));
  p.append(step(ob.steps.library, `${state.library.activities.length} activities saved`, [
    el('span', { class: 'grow', text: '3. Add starter activities — walk, strength, breathing, stretch, playlists' }),
    el('button', { class: 'btn tiny primary', text: 'Add them', onclick: () => update(() => { addStarterActivities(state); }, 'Starter activities added.') }),
  ]));
  p.append(el('button', { class: 'link', text: 'Skip setup', onclick: () => update(() => { state.profile.onboardingDismissed = true; }) }));
  return p;
}
function saveObName() {
  const v = (($('#ob-name') || {}).value || '').trim();
  if (!v) { flash('Type your name first.', 'warn'); return; }
  update(() => { state.profile.name = v.slice(0, 40); }, `Nice to meet you, ${v.split(/\s+/)[0]}!`);
}

function renderCheckin(d) {
  const cur = d.checkin;
  const p = panel('How are you feeling?', cur ? 'Checked in ✓ · tap to change' : 'One tap · your own report, not an assessment');
  const row = (label, opts, key) => el('div', { class: 'tap-row', role: 'group', 'aria-label': label }, [
    el('span', { class: 'tap-label', text: label }),
    ...opts.map(([v, emoji, name]) => {
      const on = Boolean(cur && cur[key] === v);
      return el('button', { class: `tap ${on ? 'on' : ''}`, type: 'button', title: name, 'aria-label': `${label}: ${name}`, 'aria-pressed': on ? 'true' : 'false', onclick: () => tapCheckin(key, v) },
        [el('span', { class: 'tap-emoji', text: emoji }), el('span', { class: 'tap-name', text: name })]);
    }),
  ]);
  p.append(row('Mood', MOODS, 'mood'));
  p.append(row('Energy', ENERGY, 'energy'));
  p.append(el('input', { id: 'ci-note', class: 'note', type: 'text', value: cur ? cur.note : '', placeholder: 'Anything on your mind? (optional, press Enter)', 'aria-label': 'Check-in note', onchange: (e) => saveNote(e.target.value) }));
  return p;
}
function tapCheckin(key, v) {
  update(() => {
    const d = day();
    const prev = d.checkin || { mood: 3, energy: 3, note: '' };
    d.checkin = { ...prev, [key]: v, at: new Date().toISOString() };
  }, `${key === 'mood' ? 'Mood' : 'Energy'} saved — next step updated.`);
}
function saveNote(text) {
  const note = String(text || '').trim().slice(0, 300);
  const lvl = safetyLevel(note);
  if (lvl) raiseSupport(lvl);
  update(() => {
    const d = day();
    const prev = d.checkin || { mood: 3, energy: 3 };
    d.checkin = { ...prev, note, at: new Date().toISOString() };
  }, lvl ? null : 'Note saved.');
}

function guidelineChip(status) {
  const map = { meets: ['done', 'meets'], partial: ['planned', 'partly'], below: ['skipped', 'below'], unknown: ['', 'no data'] };
  const [cls, text] = map[status] || ['', status];
  return el('span', { class: `chip ${cls}`, text });
}
function paceLabel(m) {
  if (m.target <= 0) return 'no goal set';
  if (m.met) return 'met ✓';
  return { 'on-pace': 'on pace', 'slightly-behind': 'a bit behind', behind: 'behind' }[m.status] || '';
}
function ring(m) {
  const color = m.side === 'mental' ? 'var(--yellow)' : 'var(--deep-sage)';
  return el('div', { class: 'ring-wrap' }, [
    el('div', { class: `ring ${m.met ? 'met' : ''}`, style: `--pct:${Math.min(100, m.pct)};--c:${color}`, role: 'img', 'aria-label': `${m.label}: ${m.done} of ${m.target}` }, [
      el('span', { class: 'ring-val', text: m.target > 0 ? `${m.pct}%` : 'set' }),
    ]),
    el('div', { class: 'ring-name', text: m.label }),
    el('div', { class: 'ring-cap', text: `${m.target > 0 ? `${m.done}/${m.target}` : '—'} · ${m.guideCap}` }),
    el('div', { class: `pace ${m.status}`, text: paceLabel(m) }),
  ]);
}
function moodSpark(series) {
  const bars = el('div', { class: 'spark' });
  for (const s of series) {
    const h = s.mood ? Math.round((s.mood / 5) * 100) : 8;
    bars.append(el('div', { class: 'spark-col' }, [
      el('div', { class: `spark-bar ${s.mood ? '' : 'empty'}`, style: `height:${h}%`, title: `${s.date}${s.mood ? `: mood ${s.mood}/5` : ': no check-in'}` }),
    ]));
  }
  return el('div', { class: 'spark-wrap' }, [el('div', { class: 'muted small', text: 'Mood this week (your self-report)' }), bars]);
}

// ---------- HISTORY: what you logged, health facts, imports ----------

function renderLog(root) {
  const d = day();
  const lp = panel(iso === todayIso() ? 'Logged today' : `Logged on ${formatDateLabel(iso)}`, `${d.activityLog.length} entr${d.activityLog.length === 1 ? 'y' : 'ies'} · add more by typing or talking below`);
  if (!d.activityLog.length) lp.append(el('p', { class: 'muted', text: 'Nothing yet — tell Daywell below, e.g. “20 min walk” or “10 minute meditation”.' }));
  for (const e of d.activityLog) lp.append(el('div', { class: 'row item' }, [
    catTag(e.category),
    el('span', { class: 'grow', text: `${e.text}${e.durationMin ? ` · ${e.durationMin} min` : ''}` }),
    el('span', { class: 'tag', text: e.source }),
    el('button', { class: 'link', text: 'Remove', 'aria-label': `Remove ${e.text}`, onclick: () => update(() => { day().activityLog = day().activityLog.filter((x) => x.id !== e.id); }, 'Removed.') }),
  ]));
  root.append(lp);

  const hp = panel('Sleep & heart rate', 'Optional · plain facts, never scored');
  hp.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveHealth(); } }, [
    labeled('Sleep (hours)', el('input', { id: 'h-sleep', type: 'number', min: '0', max: '24', step: '0.1', value: d.health.sleepHours != null ? String(d.health.sleepHours) : '' })),
    labeled('Resting HR (bpm)', el('input', { id: 'h-hr', type: 'number', min: '20', max: '220', value: d.health.restingHR != null ? String(d.health.restingHR) : '' })),
    el('button', { class: 'btn', type: 'submit', text: 'Save' }),
  ]));
  root.append(hp);

  const ip = panel('Import', 'Apple Health · JSON · CSV');
  const det = el('details', { class: 'evidence' }, [el('summary', { text: 'Import workouts, sleep, and heart rate from a file' })]);
  det.append(el('p', { class: 'muted small', text: 'Apple Health export.xml (workouts + resting heart rate + sleep, filed by their own dates), or a movement JSON/CSV. Read on this device; nothing is uploaded. Setup has an iPhone Shortcut recipe to export automatically.' }));
  det.append(el('label', { class: 'file-btn' }, ['Choose file', el('input', { id: 'upload-file', type: 'file', accept: '.json,.csv,.xml,application/json,text/csv,text/xml', onchange: (e) => onUpload(e) })]));
  det.append(el('span', { id: 'upload-status', class: 'muted small' }));
  ip.append(det);
  root.append(ip);
}

function quickLog(activity) {
  const before = goalMetKeys();
  const id = uid('al');
  day().activityLog.push({ id, category: activity.category, text: activity.title, durationMin: activity.durationMin, source: 'text', at: new Date().toISOString() });
  persist();
  lastEntry = { iso, id, text: activity.title };
  const cheer = celebrateManual(before);
  flash(cheer || `Logged "${activity.title}".`, 'ok'); render();
}
// Manual-log celebration: plays the chime and returns a cheer line (for the toast).
function celebrateManual(before) {
  const labels = newlyMetLabels(before);
  if (!labels.length) return null;
  if (soundOn()) playChime();
  return `🎉 ${cheerLine(labels)}`;
}
async function onUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const status = $('#upload-status'); status.textContent = 'Reading…';
  try {
    const text = await file.text();
    if (isAppleHealthExport(text, file.name)) {
      const res = parseHealthExport(text);
      if (!res.ok) { status.textContent = res.error; flash(`Import failed: ${res.error}`, 'error'); e.target.value = ''; return; }
      let workouts = 0; let healthDays = 0;
      update(() => {
        for (const [date, list] of Object.entries(res.workoutsByDate)) {
          if (date === 'undated') continue;
          const dd = ensureDay(state, date);
          for (const w of list) { dd.activityLog.push({ id: uid('al'), category: 'movement', text: w.text, durationMin: w.durationMin, source: 'upload', at: new Date().toISOString() }); workouts += 1; }
        }
        for (const [date, h] of Object.entries(res.healthByDate)) {
          const dd = ensureDay(state, date);
          if (typeof h.restingHR === 'number') dd.health.restingHR = h.restingHR;
          if (typeof h.sleepHours === 'number') dd.health.sleepHours = h.sleepHours;
          dd.health.source = 'upload';
          healthDays += 1;
        }
      }, `Apple Health: ${workouts} workout(s), health facts on ${healthDays} day(s).`);
    } else {
      const res = parseMovementUpload(text, file.name);
      if (!res.ok) { status.textContent = res.error; flash(`Import failed: ${res.error}`, 'error'); e.target.value = ''; return; }
      update(() => { const dd = day(); for (const en of res.entries) dd.activityLog.push({ id: uid('al'), category: 'movement', text: en.text, durationMin: en.durationMin, source: 'upload', at: new Date().toISOString() }); }, `Imported ${res.entries.length} entr${res.entries.length === 1 ? 'y' : 'ies'}.`);
    }
  } catch { status.textContent = 'Could not read file.'; flash('Could not read file.', 'error'); }
  e.target.value = '';
}

function saveHealth() {
  const hr = $('#h-hr').value.trim();
  const sleep = $('#h-sleep').value.trim();
  update(() => {
    const d = day();
    d.health.restingHR = hr === '' ? null : Math.max(20, Math.min(220, parseFloat(hr)));
    d.health.sleepHours = sleep === '' ? null : Math.max(0, Math.min(24, parseFloat(sleep)));
    d.health.source = 'manual';
  }, 'Saved.');
}

// ---------- PLAN ----------

function renderPlan(root) {
  const d = day();

  const ctx = panel('Conditions today', 'Contingency');
  ctx.append(el('div', { class: 'row wrap' }, [
    el('label', { class: 'inline-label' }, ['Earliest free time ', el('input', { id: 'mv-floor', type: 'time', value: toClockInput(movementCtx.floor), onchange: (e) => { movementCtx.floor = parseClock(e.target.value) || 0; render(); } })]),
    el('label', { class: 'inline-label' }, [el('input', { id: 'mv-indoor', type: 'checkbox', ...(movementCtx.indoorOnly ? { checked: 'checked' } : {}), onchange: (e) => { movementCtx.indoorOnly = e.target.checked; render(); } }), ' Indoor only (e.g. rain)']),
  ]));
  ctx.append(el('input', { class: 'note', type: 'text', value: d.weatherNote, placeholder: 'Weather / notes (e.g. raining until 5pm)…', onchange: (e) => update(() => { d.weatherNote = e.target.value; }) }));
  ctx.append(el('p', { class: 'muted small', text: 'Used so a recovered movement fits around your commitments.' }));
  root.append(ctx);

  // Suggestions, filtered by category toggle
  const catRow = el('div', { class: 'row wrap toggle' });
  catRow.append(el('button', { class: `btn tiny ${planCat === 'all' ? 'primary' : ''}`, text: 'All', onclick: () => { planCat = 'all'; render(); } }));
  for (const k of CATEGORY_KEYS) catRow.append(el('button', { class: `btn tiny ${planCat === k ? 'primary' : ''}`, text: CATEGORIES[k].label, onclick: () => { planCat = k; render(); } }));
  const sug = suggestActivities(state, iso, { categories: planCat === 'all' ? null : [planCat], indoorOnly: movementCtx.indoorOnly });
  const sp = panel('Suggested activities', 'From your library');
  sp.append(catRow);
  if (!sug.suggestions.length) sp.append(el('p', { class: 'muted', text: 'No matching saved activities. Add some in Setup & Goals.' }));
  for (const s of sug.suggestions.slice(0, 6)) sp.append(el('div', { class: 'row item' }, [
    catTag(s.activity.category),
    el('span', { class: 'grow', text: s.activity.title }),
    el('span', { class: 'muted small', text: s.reason }),
    el('button', { class: 'link', text: 'Plan it', onclick: () => addPlanned(s.activity) }),
  ]));
  root.append(sp);

  const pp = panel("Today's plan", 'Plan · record · recover');
  if (!d.activities.length) pp.append(el('p', { class: 'muted', text: 'Nothing planned yet.' }));
  for (const a of d.activities) pp.append(plannedRow(a));
  pp.append(el('h3', { text: 'Add activity' }));
  pp.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); addCustom(e.target); } }, [
    labeled('Category', selectEl('np-cat', CATEGORY_KEYS.map((k) => [k, CATEGORIES[k].label]))),
    labeled('Title', el('input', { id: 'np-title', type: 'text', placeholder: 'e.g. Evening walk', required: 'required' })),
    labeled('Duration (min)', el('input', { id: 'np-dur', type: 'number', min: '1', max: '600', value: '20' })),
    labeled('Indoor? (movement)', el('label', { class: 'inline-label' }, [el('input', { id: 'np-indoor', type: 'checkbox' }), ' indoor'])),
    el('button', { class: 'btn', type: 'submit', text: 'Add' }),
  ]));
  root.append(pp);
}

function plannedRow(a) {
  const row = el('div', { class: 'item planned-row' });
  row.append(el('div', { class: 'row wrap' }, [
    catTag(a.category),
    el('span', { class: 'grow', text: `${a.title} · ${a.durationMin} min${a.indoor && a.category === 'movement' ? ' · indoor' : ''}${a.contingencyOf ? ' · (recovery)' : ''}` }),
    statusChip(a.status),
  ]));
  const actions = el('div', { class: 'row wrap actions' });
  for (const [label, st] of [['Done', 'done'], ['Substituted', 'substituted'], ['Skipped', 'skipped']]) actions.append(el('button', { class: `btn tiny ${a.status === st ? 'primary' : ''}`, text: label, onclick: () => setStatus(a.id, st) }));
  row.append(actions);
  row.append(el('input', { class: 'note', type: 'text', value: a.note, placeholder: 'Record what you actually did…', onchange: (e) => update(() => { a.note = e.target.value; }, 'Note saved.') }));
  if (a.status === 'skipped') {
    const rec = recoverActivity(state, iso, a.id, { indoorOnly: movementCtx.indoorOnly, floor: movementCtx.floor });
    const box = el('div', { class: 'recover-box' });
    if (rec.hasOption) {
      box.append(el('p', { text: `Recovery: ${rec.recommended.title}${rec.window ? ` at ${formatRange(rec.window.start, rec.window.end)}` : ''} — ${rec.reason}` }));
      box.append(el('button', { class: 'btn tiny primary', text: 'Add as substitute', onclick: () => addSubstitute(rec.recommended, a.id) }));
    } else box.append(el('p', { class: 'muted', text: rec.reason + ' You can defer or edit.' }));
    row.append(box);
  }
  row.append(el('button', { class: 'link remove', text: 'Remove', onclick: () => update(() => { day().activities = day().activities.filter((x) => x.id !== a.id); }, 'Removed.') }));
  return row;
}

function addPlanned(lib) { update(() => { day().activities.push({ id: uid('pa'), libraryId: lib.id, category: lib.category, title: lib.title, durationMin: lib.durationMin, indoor: lib.indoor, status: 'planned', note: '', recordedAt: null, contingencyOf: null }); }, `Planned "${lib.title}".`); }
function addCustom(formEl) {
  const title = $('#np-title').value.trim(); if (!title) { flash('Needs a title.', 'warn'); return; }
  const category = $('#np-cat').value; const dur = Math.max(1, parseInt($('#np-dur').value, 10) || 20); const indoor = $('#np-indoor').checked;
  update(() => { day().activities.push({ id: uid('pa'), libraryId: null, category, title, durationMin: dur, indoor, status: 'planned', note: '', recordedAt: null, contingencyOf: null }); }, 'Added.');
  formEl.reset();
}
function addSubstitute(lib, failedId) { update(() => { day().activities.push({ id: uid('pa'), libraryId: lib.id, category: lib.category, title: lib.title, durationMin: lib.durationMin, indoor: lib.indoor, status: 'planned', note: '', recordedAt: null, contingencyOf: failedId }); }, `Recovery "${lib.title}" added.`); }
function setStatus(id, status) { update(() => { const a = day().activities.find((x) => x.id === id); if (a) { a.status = status; a.recordedAt = new Date().toISOString(); } }, `Marked ${status}.`); }

// ---------- SETUP & GOALS ----------

function renderSetup(root) {
  // About you: age + routine. Routine times power the time-of-day triggers.
  const r = state.profile.routine || {};
  const timeInput = (id, min) => el('input', { id, type: 'time', value: min != null ? toClockInput(min) : '' });
  const pf = panel('About you', 'Name · age · routine · region');
  const regionSel = selectEl('pf-region', [['', `Auto (${REGION_LINES[regionFromLocale(navigator.language)] ? REGION_LINES[regionFromLocale(navigator.language)].label : 'from browser'})`], ...REGION_KEYS.map((k) => [k, REGION_LINES[k].label]), ['ZZ', 'Other (show the global directory)']]);
  regionSel.value = state.profile.region || '';
  pf.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveProfile(); } }, [
    labeled('Name', el('input', { id: 'pf-name', type: 'text', value: state.profile.name || '', placeholder: 'e.g. Sasa', maxlength: '40' })),
    labeled('Age', el('input', { id: 'pf-age', type: 'number', min: '13', max: '120', value: state.profile.age != null ? String(state.profile.age) : '', placeholder: 'years' })),
    labeled('Wake', timeInput('pf-wake', r.wake)),
    labeled('Work start', timeInput('pf-wstart', r.workStart)),
    labeled('Work end', timeInput('pf-wend', r.workEnd)),
    labeled('Wind-down', timeInput('pf-wind', r.winddown)),
    labeled('Routine note', el('input', { id: 'pf-note', type: 'text', value: r.note || '', placeholder: 'e.g. deep work 9–12, gym evenings' })),
    labeled('Region (for support lines)', regionSel),
    el('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
  ]));
  pf.append(el('p', { class: 'muted small', text: 'Routine times let Daywell suggest the right activity at the right time — move in the morning, wind down at night. Region only picks which crisis line to show. Age is context only; never used to estimate risk or biological age.' }));
  root.append(pf);

  // Voice persona & celebration sound
  const vs = panel('Voice', 'Persona · “Hey Daywell” · goal chime');
  const sel = selectEl('persona-sel', PERSONA_KEYS.map((k) => [k, `${getPersona(k).label} — ${getPersona(k).blurb}`]));
  sel.value = currentPersona().key;
  sel.addEventListener('change', (e) => setPersona(e.target.value));
  vs.append(el('div', { class: 'row wrap' }, [
    labeled('Persona', sel),
    ttsSupported() ? el('button', { class: 'btn tiny', text: '🔊 Preview', onclick: () => speak(greeting()) }) : null,
    el('button', { class: `btn tiny ${soundOn() ? 'primary' : ''}`, text: soundOn() ? '🔔 Goal chime: on' : '🔕 Goal chime: off', onclick: () => { setSound(!soundOn()); render(); } }),
    voiceSupported() ? el('button', { class: `btn tiny ${wakeOn ? 'primary' : ''}`, text: wakeOn ? '👂 “Hey Daywell”: on' : '👂 “Hey Daywell”: off', onclick: toggleWake }) : null,
  ]));
  vs.append(el('p', { class: 'muted small', text: 'Persona changes how Daywell talks — personality only, never what’s counted; safety replies are always calm. “Hey Daywell” keeps the mic on while this page is open and may use your browser’s online speech service. Tap 🎤 in the message bar any time instead.' }));
  root.append(vs);

  root.append(renderAiPanel());

  const g = panel('Weekly goals', 'You set these');
  const rgx = RECOMMENDED_GOALS;
  g.append(el('div', { class: 'row wrap' }, [
    el('span', { class: 'muted small grow', text: `Recommended starting point: ${rgx.movementMinutesPerWeek} min movement (WHO floor) across ${rgx.movementSessionsPerWeek} sessions, plus ${rgx.mindfulnessSessionsPerWeek} mind sessions a week.` }),
    el('button', { class: 'btn tiny', type: 'button', text: 'Use recommended', onclick: () => update(() => { state.profile.goals = { ...rgx }; state.profile.goalsSet = true; }, 'Recommended goals set.') }),
  ]));
  g.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveGoals(); } }, [
    labeled('Movement sessions / week', el('input', { id: 'g-sessions', type: 'number', min: '0', max: '50', value: String(state.profile.goals.movementSessionsPerWeek) })),
    labeled('Movement minutes / week', el('input', { id: 'g-minutes', type: 'number', min: '0', max: '5000', value: String(state.profile.goals.movementMinutesPerWeek) })),
    labeled('Mind sessions / week', el('input', { id: 'g-mind', type: 'number', min: '0', max: '50', value: String(state.profile.goals.mindfulnessSessionsPerWeek) })),
    el('button', { class: 'btn primary', type: 'submit', text: 'Save goals' }),
  ]));
  root.append(g);

  const lib = panel('Activity library', 'Reusable · powers suggestions');
  const haveTitles = new Set(state.library.activities.map((a) => a.title.toLowerCase()));
  const missing = STARTER_ACTIVITIES.filter((a) => !haveTitles.has(a.title.toLowerCase())).length;
  if (missing) lib.append(el('div', { class: 'row wrap' }, [
    el('span', { class: 'muted small grow', text: `${missing} starter activit${missing === 1 ? 'y' : 'ies'} available — walk, strength, breathing, stretch, playlists.` }),
    el('button', { class: 'btn tiny primary', type: 'button', text: 'Add starters', onclick: () => update(() => { addStarterActivities(state); }, 'Starter activities added.') }),
  ]));
  for (const a of state.library.activities) lib.append(el('div', { class: 'row item' }, [
    catTag(a.category),
    el('span', { class: 'grow', text: `${a.title} · ${a.durationMin} min${a.indoor && a.category === 'movement' ? ' · indoor' : ''}${a.tags.length ? ' · ' + a.tags.join(', ') : ''}` }),
    el('button', { class: 'link', text: 'Remove', onclick: () => update(() => { state.library.activities = state.library.activities.filter((x) => x.id !== a.id); }, 'Removed.') }),
  ]));
  lib.append(el('h3', { text: 'Add to library' }));
  lib.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); addLib(e.target); } }, [
    labeled('Category', selectEl('lib-cat', CATEGORY_KEYS.map((k) => [k, CATEGORIES[k].label]))),
    labeled('Title', el('input', { id: 'lib-title', type: 'text', placeholder: 'e.g. Home yoga / Box breathing / Calm playlist', required: 'required' })),
    labeled('Duration (min)', el('input', { id: 'lib-dur', type: 'number', min: '1', max: '600', value: '15' })),
    labeled('Indoor? (movement)', el('label', { class: 'inline-label' }, [el('input', { id: 'lib-indoor', type: 'checkbox' }), ' indoor'])),
    labeled('Tags (comma)', el('input', { id: 'lib-tags', type: 'text', placeholder: 'calming, uplift' })),
    el('button', { class: 'btn', type: 'submit', text: 'Add' }),
  ]));
  root.append(lib);

  // Work calendar — commitments shape timing (triggers avoid your busy blocks).
  const cal = panel('Work calendar (.ics)', 'Local-first · no sign-in');
  cal.append(el('p', { class: 'muted small', text: `Export from Google Calendar (Settings → Import & export → Export) and import. Events on ${iso} become protected commitments. Nothing is uploaded.` }));
  cal.append(el('label', { class: 'file-btn' }, ['Import .ics', el('input', { id: 'ics-file', type: 'file', accept: '.ics,text/calendar', onchange: (e) => onIcs(e) })]));
  cal.append(el('span', { id: 'ics-status', class: 'muted small' }));
  const comm = el('div', { class: 'list' });
  for (const c of [...day().commitments].sort((a, b) => a.start - b.start)) comm.append(el('div', { class: 'row item' }, [
    el('span', { class: 'mono', text: formatRange(c.start, c.end) }),
    el('span', { class: 'grow', text: c.title || 'Commitment' }),
    el('span', { class: 'tag', text: c.source === 'ics' ? 'calendar' : 'manual' }),
    el('button', { class: 'link', text: 'Remove', onclick: () => update(() => { day().commitments = day().commitments.filter((x) => x.id !== c.id); }, 'Removed.') }),
  ]));
  cal.append(el('h3', { text: `Commitments on ${iso}` }));
  cal.append(day().commitments.length ? comm : el('p', { class: 'muted', text: 'No commitments for this day.' }));
  root.append(cal);

  // Apple Health import recipe — collapsed to keep Setup minimal.
  const ah = panel('Apple Health import', 'Optional');
  const ahDet = el('details', { class: 'evidence' }, [el('summary', { text: 'How to auto-export from iPhone' })]);
  ahDet.append(el('p', { class: 'muted small', text: 'A web app can’t read Apple Health live. Set up an iOS Shortcut to export on a schedule, then import the file in Log:' }));
  const steps = el('ol', { class: 'recipe' });
  for (const s of [
    'iPhone → Shortcuts → Automation → Personal Automation (e.g. daily 9pm).',
    'Add “Find Health Samples” (Workouts / Walking+Running) for today.',
    'Add “Make CSV” then “Save File” to a reachable folder.',
    'Open it here under Log → Import.',
  ]) steps.append(el('li', { text: s }));
  ahDet.append(steps);
  ah.append(ahDet);
  root.append(ah);

  // Reminders (optional, device-local)
  const rem = panel('Reminders', 'Optional · local');
  if (ttsSupported()) {
    rem.append(el('div', { class: 'row wrap', style: 'margin-bottom:8px' }, [
      el('span', { class: 'muted small', text: ttsVoice ? `Voice: ${ttsVoice.name}` : 'Voice: browser default' }),
      el('button', { class: 'btn tiny', text: '🔊 Preview voice', onclick: () => speak('Hey! This is how I’ll sound when I read your recap.') }),
    ]));
  }
  if (!notifySupported()) {
    rem.append(el('p', { class: 'muted small', text: 'This browser can’t show notifications. A native app would add reliable local reminders.' }));
  } else {
    const on = remindEnabled();
    rem.append(el('p', { class: 'muted small', text: 'Get one gentle reminder of how you’re tracking vs your goals, shown when you open Daywell (or install it as an app). The web version can’t send background reminders — a native app can.' }));
    rem.append(el('button', { class: `btn ${on ? '' : 'primary'}`, text: on ? 'Reminders on — turn off' : 'Enable reminders', onclick: toggleRemind }));
    rem.append(el('p', { class: 'muted small', text: 'Reminders describe progress vs your own goals only — never your health or mental state, and never a biological age.' }));
  }
  root.append(rem);

  // Data
  const data = panel('Your data', 'Backup · delete');
  data.append(el('div', { class: 'row wrap' }, [
    el('button', { class: 'btn', text: 'Export backup (JSON)', onclick: exportBackup }),
    el('label', { class: 'file-btn' }, ['Import backup', el('input', { type: 'file', accept: 'application/json,.json', onchange: (e) => onImport(e) })]),
    el('button', { class: 'btn danger', text: 'Delete all local data', onclick: deleteAll }),
  ]));
  data.append(el('p', { class: 'muted small', text: 'Exported files contain your personal data. Deleting here removes data on this device only.' }));
  root.append(data);
}

function addLib(formEl) {
  const title = $('#lib-title').value.trim(); if (!title) { flash('Needs a title.', 'warn'); return; }
  update(() => { state.library.activities.push({ id: uid('act'), category: $('#lib-cat').value, title, durationMin: Math.max(1, parseInt($('#lib-dur').value, 10) || 15), indoor: $('#lib-indoor').checked, tags: $('#lib-tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) }); }, 'Added to library.');
  formEl.reset();
}
function renderAiPanel() {
  const ap = panel('AI assistant', 'Optional · off by default');
  const od = { available: 'ready', downloadable: 'downloads on first use', downloading: 'downloading…', unavailable: 'not available on this device', unsupported: 'not in this browser', unknown: 'checking…' }[onDeviceState] || onDeviceState;
  const prov = selectEl('ai-provider', [
    ['off', 'Off — built-in rules only (fully private)'],
    ['ondevice', `On-device model — private (${od})`],
    ['claude', 'Claude — your Anthropic API key (cloud)'],
  ]);
  prov.value = aiCfg.provider;
  prov.addEventListener('change', (e) => { aiCfg = { ...aiCfg, provider: e.target.value }; writeAiConfig(aiCfg); aiRec = { key: null, status: 'idle', value: null, error: null }; render(); });
  ap.append(el('div', { class: 'grid-form' }, [labeled('Provider', prov)]));

  let statusText = 'Off. Daywell uses its built-in, rule-based analysis — nothing leaves this device.';
  if (aiCfg.provider === 'ondevice') {
    statusText = onDeviceState === 'available' || onDeviceState === 'downloadable' || onDeviceState === 'downloading'
      ? 'Uses the model built into your browser. Nothing leaves this device.'
      : 'This browser has no built-in AI model (e.g. Chrome’s built-in AI). Choose Claude, or keep using the rules — Daywell falls back automatically.';
  }
  if (aiCfg.provider === 'claude') {
    const key = el('input', { id: 'ai-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', value: aiCfg.apiKey, 'aria-label': 'Anthropic API key' });
    const model = selectEl('ai-model', CLAUDE_MODELS);
    model.value = aiCfg.model;
    ap.append(el('form', { class: 'grid-form', onsubmit: (e) => {
      e.preventDefault();
      aiCfg = { ...aiCfg, apiKey: $('#ai-key').value.trim(), model: $('#ai-model').value };
      writeAiConfig(aiCfg); aiRec = { key: null, status: 'idle', value: null, error: null };
      flash(aiCfg.apiKey ? 'AI connected. Your key stays in this browser.' : 'Key removed — AI is inactive.', 'ok'); render();
    } }, [labeled('Anthropic API key', key), labeled('Model', model), el('button', { class: 'btn primary', type: 'submit', text: 'Save' })]));
    statusText = aiCfg.apiKey
      ? 'Connected with your key. Your key is stored only in this browser and billed to your Anthropic account.'
      : 'Add your API key (console.anthropic.com) to turn it on.';
  }
  ap.append(el('p', { class: 'muted small', text: statusText }));

  const how = el('details', { class: 'evidence' }, [el('summary', { text: 'How the AI is used — and what it sees' })]);
  for (const line of [
    'Code computes every number (minutes, pace, guidelines). The AI only interprets those facts: a short read on your week, your next step, and answers the rules can’t give.',
    'Everything it returns is checked before you see it: only your real saved activities, only the cited WHO / CDC / NCCIH sources, and no diagnosis, condition, medication, or biological-age language. If a check fails — or the AI is slow or offline — you get the standard rule-based step.',
    'It never sees your name, age, region, check-in notes, or heart rate. Crisis and distress moments never use AI; those replies and crisis lines are fixed and checked.',
  ]) how.append(el('p', { class: 'small', text: line }));
  how.append(el('p', { class: 'small', text: 'Exactly what would be sent right now:' }));
  how.append(el('pre', { class: 'ai-preview', text: JSON.stringify(buildContext(state, iso, analyze(state, iso), nowMinForView()), null, 2) }));
  ap.append(how);

  if (aiOn()) {
    ap.append(el('button', { class: 'btn tiny', text: 'Test AI', onclick: async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Testing…';
      try {
        const v = await aiRecommend(state, iso, analyze(state, iso), aiCfg, { nowMin: nowMinForView() });
        flash(`AI works — suggested: “${v.next.title}”`, 'ok');
      } catch (err) { flash(`AI test failed: ${(err && err.message) || err}`, 'error'); }
      btn.disabled = false; btn.textContent = 'Test AI';
    } }));
  }
  return ap;
}
function setPersona(key) {
  update(() => { state.profile.persona = key; });
  if (ttsSupported()) speak(greeting());
}
function saveProfile() {
  const ageRaw = $('#pf-age').value.trim();
  const toMin = (id) => { const v = $(id).value; if (!v) return null; const m = parseClock(v); return Number.isInteger(m) && m >= 0 && m < 1440 ? m : null; };
  update(() => {
    const n = parseInt(ageRaw, 10);
    state.profile.name = $('#pf-name').value.trim().slice(0, 40);
    state.profile.age = Number.isFinite(n) ? Math.max(13, Math.min(120, n)) : null;
    state.profile.routine = { wake: toMin('#pf-wake'), workStart: toMin('#pf-wstart'), workEnd: toMin('#pf-wend'), winddown: toMin('#pf-wind'), note: $('#pf-note').value.trim().slice(0, 200) };
    const rg = $('#pf-region').value;
    state.profile.region = /^[A-Z]{2}$/.test(rg) ? rg : '';
  }, 'Saved.');
}
function saveGoals() {
  update(() => { state.profile.goals = {
    movementSessionsPerWeek: Math.max(0, parseInt($('#g-sessions').value, 10) || 0),
    movementMinutesPerWeek: Math.max(0, parseInt($('#g-minutes').value, 10) || 0),
    mindfulnessSessionsPerWeek: Math.max(0, parseInt($('#g-mind').value, 10) || 0),
  }; state.profile.goalsSet = true; }, 'Goals saved.');
}
async function onIcs(e) {
  const file = e.target.files[0]; if (!file) return;
  const status = $('#ics-status');
  try {
    const text = await file.text();
    const shim = { date: iso, timeZone: deviceTimeZone(), commitments: day().commitments };
    const res = importCalendar(shim, text);
    if (!res.ok) { status.textContent = res.error; flash(`Import failed: ${res.error}`, 'error'); e.target.value = ''; return; }
    update(() => { day().commitments = res.day.commitments; }, `Imported ${res.added} event(s).`);
    status.textContent = `Added ${res.added}${res.duplicates ? ` · ${res.duplicates} dup` : ''}${res.skipped ? ` · ${res.skipped} skipped` : ''}${res.allDay ? ` · ${res.allDay} all-day` : ''}`;
  } catch { status.textContent = 'Could not read file.'; flash('Could not read .ics file.', 'error'); }
  e.target.value = '';
}
function exportBackup() {
  const blob = new Blob([exportState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `daywell-${iso}.json` });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  flash('Exported. The file contains your personal data.', 'warn');
}
async function onImport(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const res = validateState(parsed);
    state = res.state; ensureDay(state, iso); persist(); render();
    flash(res.errors.length ? `Imported with ${res.errors.length} issue(s) fixed.` : 'Imported.', res.errors.length ? 'warn' : 'ok');
  } catch { flash('Import failed: invalid file.', 'error'); }
  e.target.value = '';
}
let deleteArmed = false;
function deleteAll(e) {
  if (!deleteArmed) { deleteArmed = true; if (e && e.target) { e.target.textContent = 'Tap again to confirm delete'; e.target.classList.add('primary'); } flash('This deletes all local data on this device. Tap again to confirm.', 'warn'); setTimeout(() => { deleteArmed = false; render(); }, 4000); return; }
  deleteArmed = false; clearState(); clearAiConfig(); aiCfg = readAiConfig(); aiRec = { key: null, status: 'idle', value: null, error: null }; chat = []; lastEntry = null;
  state = defaultState(); ensureDay(state, iso); persist(); render();
  flash('All local data deleted on this device.', 'warn');
}

// ---------- helpers ----------

function labeled(text, control) { return el('label', {}, [text, control]); }
function selectEl(id, pairs) {
  const sel = el('select', { id });
  for (const [value, label] of pairs) sel.append(el('option', { value, text: label }));
  return sel;
}
// Spoken readback (browser Text-to-Speech) — so you can HEAR your recap, not
// just read it. Local to the browser's speech engine; feature-detected. We pick
// the most natural-sounding voice available and tune the delivery so it sounds
// lively and human rather than flat and robotic.
function ttsSupported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
let ttsVoice = null;
function pickVoice() {
  if (!ttsSupported()) return null;
  let voices = [];
  try { voices = window.speechSynthesis.getVoices() || []; } catch { return null; }
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  // Prefer modern neural/natural voices, then known friendly named voices.
  const prefer = [/neural/i, /natural/i, /premium/i, /enhanced/i, /\b(ava|samantha|aria|jenny|allison|serena|zoe|nicky|evan|siri)\b/i, /google/i];
  for (const re of prefer) { const m = pool.find((v) => re.test(v.name)); if (m) return m; }
  return pool.find((v) => v.default) || pool[0];
}
function loadVoices() {
  if (!ttsSupported()) return;
  ttsVoice = pickVoice();
  try { window.speechSynthesis.onvoiceschanged = () => { ttsVoice = pickVoice(); }; } catch { /* ignore */ }
}
function sanitizeSpeech(text) {
  return String(text).replace(/[\u{1F000}-\u{1FFFF}☀-➿]/gu, '').replace(/[—–]/g, ', ').replace(/\s+/g, ' ').trim();
}
function currentPersona() { return getPersona(state.profile.persona); }
function makeUtterance(text, opts = {}) {
  const u = new SpeechSynthesisUtterance(sanitizeSpeech(text));
  if (ttsVoice) { u.voice = ttsVoice; u.lang = ttsVoice.lang; } else u.lang = navigator.language || 'en-US';
  // Persona sets the delivery — except safety moments and breathing, which are
  // always calm regardless of persona.
  const p = opts.calm ? getPersona('calm') : currentPersona();
  u.rate = opts.calm ? 0.9 : p.rate; u.pitch = p.pitch; u.volume = 1;
  return u;
}

// ---- celebration: a short chime (Web Audio, no assets) when a goal is reached ----
const SOUND_KEY = 'daywell.sound.v1';
function soundOn() { try { return JSON.parse(localStorage.getItem(SOUND_KEY) || '{}').on !== false; } catch { return true; } }
function setSound(on) { try { localStorage.setItem(SOUND_KEY, JSON.stringify({ on })); } catch { /* ignore */ } }
let audioCtx = null;
function playChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    audioCtx = audioCtx || new AC();
    const ctx = audioCtx; if (ctx.state === 'suspended') ctx.resume();
    const calm = currentPersona().key === 'calm';
    const notes = calm ? [523.25, 659.25, 783.99] : [523.25, 659.25, 783.99, 1046.5]; // C major arpeggio
    const step = calm ? 0.2 : 0.14; const dur = calm ? 0.26 : 0.2;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = calm ? 'sine' : 'triangle'; o.frequency.value = f;
      const t = ctx.currentTime + i * step;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur);
    });
  } catch { /* ignore */ }
}
function goalMetKeys() { try { return analyze(state, iso).metrics.filter((m) => m.met).map((m) => m.key); } catch { return []; } }
function newlyMetLabels(before) {
  const had = new Set(before);
  try { return analyze(state, iso).metrics.filter((m) => m.met && !had.has(m.key)).map((m) => m.label); } catch { return []; }
}
function cheerLine(labels) {
  const goal = labels.length >= 2 ? 'weekly' : labels[0].toLowerCase();
  return fill(pick(currentPersona().cheer), { name: firstName(), goal });
}
function speak(text) {
  if (!ttsSupported()) { flash('Voice readback isn’t supported in this browser.', 'warn'); return; }
  try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(makeUtterance(text)); flash('Reading your recap aloud…', 'ok'); }
  catch { flash('Could not start readback.', 'warn'); }
}
function speakThen(text, done, opts = {}) {
  if (!ttsSupported()) { if (done) done(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = makeUtterance(text, opts);
    u.onend = () => { if (done) done(); };
    u.onerror = () => { if (done) done(); };
    window.speechSynthesis.speak(u);
  } catch { if (done) done(); }
}

// ---- speech-to-speech voice mode: listen → answer → speak → listen ----
function firstName() { const n = (state.profile.name || '').trim(); return n ? n.split(/\s+/)[0] : ''; }
function greeting() { return fill(pick(currentPersona().greet), { name: firstName() || 'there' }); }
function toggleVoiceMode() {
  if (voiceMode) { stopVoiceMode(); return; }
  if (!voiceSupported()) { flash('Voice input isn’t supported in this browser.', 'warn'); return; }
  enterConversation();
}
function enterConversation() {
  if (wakeStop) { wakeStop(); wakeStop = null; } // free the mic for the conversation
  voiceMode = true; voiceStatus = 'speaking';
  const hello = greeting();
  chat.push({ who: 'daywell', text: hello }); chatOpen = true;
  voiceSpeaking = true; render();
  speakThen(hello, () => { voiceSpeaking = false; if (voiceMode) listenTurn(); });
}
function stopVoiceMode() {
  voiceMode = false; voiceSpeaking = false; voiceStatus = 'idle';
  if (voiceLoopStop) { voiceLoopStop(); voiceLoopStop = null; }
  try { if (ttsSupported()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
  render();
  if (wakeOn) beginWakeListen(); // go back to waiting for "Hey Daywell"
}

// ---- wake word: listen for "Hey Daywell", then greet + converse ----
const WAKE_RE = /\b(hey|hi|hello|ok|okay)[\s,]*(day[\s-]?well|daywell|dave[\s-]?well|dai[\s-]?well|dewell)\b|\bda[yi][\s-]?well\b/i;
function toggleWake() {
  if (wakeOn) { wakeOn = false; if (wakeStop) { wakeStop(); wakeStop = null; } voiceStatus = 'idle'; render(); return; }
  if (!voiceSupported()) { flash('Voice input isn’t supported in this browser.', 'warn'); return; }
  wakeOn = true; beginWakeListen(); render();
}
function beginWakeListen() {
  if (!wakeOn || voiceMode) return;
  voiceStatus = 'waking';
  wakeStop = startVoice({
    continuous: true,
    onInterim: (t) => { if (WAKE_RE.test(t)) { if (wakeStop) { wakeStop(); wakeStop = null; } enterConversation(); } },
    onResult: (t) => { if (WAKE_RE.test(t)) { if (wakeStop) { wakeStop(); wakeStop = null; } enterConversation(); } },
    onError: () => { /* ignore; onEnd restarts */ },
    onEnd: () => { wakeStop = null; if (wakeOn && !voiceMode) beginWakeListen(); }, // keep listening
  });
  if (!wakeStop) { wakeOn = false; voiceStatus = 'idle'; render(); }
}
function listenTurn() {
  if (!voiceMode) return;
  voiceStatus = 'listening'; render();
  voiceLoopStop = startVoice({
    onInterim: (t) => { const s2 = $('.composer-status .grow'); if (s2) s2.textContent = `● “${t}”`; }, // live transcript
    onResult: (t) => { if (voiceMode) handleVoiceQuery(t); },
    onError: (err) => { if (voiceMode) flash(`Voice: ${err}`, 'warn'); },
    onEnd: () => { voiceLoopStop = null; if (voiceMode && !voiceSpeaking) listenTurn(); }, // silence → listen again
  });
  if (!voiceLoopStop) { voiceMode = false; voiceStatus = 'idle'; render(); }
}
function handleVoiceQuery(text) {
  if (voiceLoopStop) { voiceLoopStop(); voiceLoopStop = null; }
  voiceSpeaking = true; // guard onEnd from restarting while we answer
  const { res, reply, pending } = converse(text, { spoken: true });
  const speakNow = (finalText) => {
    if (!voiceMode) { voiceSpeaking = false; return; } // user stopped while the AI was thinking
    voiceStatus = 'speaking'; render();
    speakThen(finalText, () => {
      voiceSpeaking = false;
      if (res.action === 'breathe') { startBreathing(); return; }
      if (res.stop) { stopVoiceMode(); return; }
      if (voiceMode) listenTurn();
    }, { calm: !!res.safety || res.action === 'breathe' });
  };
  chatOpen = true;
  if (pending) { voiceStatus = 'thinking'; render(); pending.then(speakNow); } else speakNow(reply);
}
// ---- guided box breathing: the agent ACTS, not just suggests ----
function startBreathing() {
  if (breathing) return;
  if (!ttsSupported()) { flash('Guided breathing needs speech output, which this browser doesn’t support.', 'warn'); return; }
  if (voiceLoopStop) { voiceLoopStop(); voiceLoopStop = null; }
  if (wakeStop) { wakeStop(); wakeStop = null; }
  breathing = true; voiceSpeaking = true; voiceStatus = 'breathing'; render();
  const steps = breathingScript(3);
  let i = 0;
  const next = () => {
    if (!breathing) return;
    if (i >= steps.length) { finishBreathing(true); return; }
    const st = steps[i]; i += 1;
    speakThen(st.say, () => { breathTimer = setTimeout(next, st.waitMs); }, { calm: true });
  };
  next();
}
function finishBreathing(completed) {
  if (!breathing) return;
  breathing = false; voiceSpeaking = false;
  clearTimeout(breathTimer); breathTimer = null;
  if (completed) {
    const before = goalMetKeys();
    day().activityLog.push({ id: uid('al'), category: 'meditation', text: 'Guided box breathing', durationMin: 1, source: 'voice', at: new Date().toISOString() });
    persist();
    if (newlyMetLabels(before).length && soundOn()) playChime();
  } else {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  voiceStatus = voiceMode ? 'listening' : (wakeOn ? 'waking' : 'idle');
  render();
  if (voiceMode) listenTurn(); else if (wakeOn) beginWakeListen();
}

function voiceStatusText() {
  if (voiceStatus === 'breathing') return '🫁 Breathing together…';
  if (voiceStatus === 'thinking') return '✨ Thinking…';
  if (voiceStatus === 'speaking') return '🔊 Speaking…';
  if (voiceStatus === 'listening') return '● Listening… say what you did, or ask a question';
  if (voiceStatus === 'waking') return '👂 Waiting for “Hey Daywell”…';
  return 'Ready';
}

let flashTimer = null;
function flash(message, tone = 'ok') { const n = $('#flash'); n.textContent = message; n.className = `flash ${tone} show`; clearTimeout(flashTimer); flashTimer = setTimeout(() => { n.className = 'flash'; }, 3500); }

window.addEventListener('DOMContentLoaded', boot);
