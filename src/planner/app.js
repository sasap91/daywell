// Daywell personal assistant controller: Today / Log / Plan / Setup & Goals.
// A non-work assistant for physical + mental wellbeing. All user text rendered
// safely via el(). No clinical/mental-health assessment — suggestions come from
// the user's own check-in and their own saved activities.

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
import { suggestActivities } from './match.js';
import { recoverActivity } from './recovery.js';
import { parseMovementUpload, parseHealthExport, isAppleHealthExport } from './ingest.js';
import { parseSpoken } from './parse.js';
import { voiceSupported, startVoice } from './voice.js';
import { HEALTHY_AGING_NOTES, DISCLAIMER } from './evidence.js';
import { importCalendar } from '../connectors.js';

const $ = (s) => document.querySelector(s);

let state;
let iso = todayIso();
let view = 'summary';
let saveFlag = { ok: true, error: null };
let movementCtx = { floor: 0, indoorOnly: false };
let logCat = 'movement';
let planCat = 'movement';
let voiceStop = null;
let logDurTouched = false;
let recapDim = 'week';
// Speech-to-speech voice mode state.
let voiceMode = false;
let voiceLoopStop = null;
let voiceSpeaking = false;
let voiceStatus = 'idle';
let voiceHeard = '';
let voiceReply = '';
let wakeOn = false;
let wakeStop = null;

// Tappable example phrases — chosen to exercise the parser (digits, spelled-out
// numbers, "half an hour") so what you type/say maps cleanly to a log entry.
const LOG_EXAMPLES = {
  movement: ['30 min walk', 'Yoga 45 minutes', '1 hour hike', 'Strength training 25 minutes'],
  meditation: ['10 minute meditation', 'Box breathing 5 min', 'Mindful breathing ten minutes'],
  winddown: ['Read for 20 minutes', 'Warm bath and stretch 15 min', 'Journaling half an hour'],
  music: ['Calming playlist 20 minutes', 'Listened to music 15 min'],
};

function boot() {
  const res = loadState();
  state = res.state;
  if (res.found && res.errors && res.errors.length) flash(`Recovered your data with ${res.errors.length} issue(s) fixed.`, 'warn');
  ensureDay(state, iso);
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
  $('#nav').addEventListener('click', (e) => { const btn = e.target.closest('.nav-btn'); if (!btn) return; view = btn.dataset.view; render(); });
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
  renderChrome();
  const root = $('#view'); clear(root);
  renderNudge(root);
  if (view === 'summary') renderToday(root);
  else if (view === 'log') renderLog(root);
  else if (view === 'plan') renderPlan(root);
  else renderSetup(root);
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
    el('button', { class: 'btn tiny primary', text: primary.label, onclick: () => { view = primary.target; render(); } }),
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

// ---------- TODAY (check-in + analytical dashboard + next step) ----------

function renderToday(root) {
  const d = day();

  // Talk to Daywell: speech-to-speech. Ask about your logs; it answers aloud.
  if (voiceSupported()) {
    const vp = panel('Talk to Daywell', 'Voice · log, summarize, get your next step');
    vp.append(el('div', { class: 'row wrap' }, [
      el('button', { class: `btn ${voiceMode ? 'danger' : 'primary'}`, text: voiceMode ? '■ Stop' : '🎤 Start voice mode', onclick: toggleVoiceMode }),
      el('button', { class: `btn tiny ${wakeOn ? 'primary' : ''}`, text: wakeOn ? '👂 Listening for “Hey Daywell”' : '👂 Enable “Hey Daywell”', onclick: toggleWake }),
    ]));
    vp.append(el('p', { class: 'muted small', text: voiceMode ? voiceStatusText() : (wakeOn ? 'Say “Hey Daywell” to start.' : 'Try: “log a 30 minute walk”, “how’s my week”, “switch to day”, “what should I do next”.') }));
    if ((voiceMode || wakeOn) && voiceHeard) vp.append(el('p', { class: 'small', text: `You: ${voiceHeard}` }));
    if ((voiceMode || wakeOn) && voiceReply) vp.append(el('p', { class: 'muted small', text: `Daywell: ${voiceReply}` }));
    vp.append(el('p', { class: 'muted small', text: 'Conversational logging and answers from your own logs and goals — never a health or mental-health assessment. “Hey Daywell” keeps the mic on and may use your browser’s online speech service; it’s browser-dependent.' }));
    root.append(vp);
  }

  // Check-in
  const ci = panel('How are you today?', 'Check-in · your self-report');
  const cur = d.checkin;
  ci.append(el('p', { class: 'muted small', text: cur ? `Checked in: mood ${cur.mood}/5, energy ${cur.energy}/5.` : 'Your own quick report — not an assessment.' }));
  const scale = (id, label, val) => el('label', { class: 'scale' }, [
    `${label}: `, el('output', { id: `${id}-out`, text: String(val) }),
    el('input', { id, type: 'range', min: '1', max: '5', value: String(val), oninput: (e) => { const o = $(`#${id}-out`); if (o) o.textContent = e.target.value; } }),
    el('span', { class: 'muted small', text: '1 low · 5 high' }),
  ]);
  const form = el('form', { class: 'checkin-form', onsubmit: (e) => { e.preventDefault(); saveCheckin(); } }, [
    scale('ci-mood', 'Mood', cur ? cur.mood : 3),
    scale('ci-energy', 'Energy', cur ? cur.energy : 3),
    el('input', { id: 'ci-note', type: 'text', value: cur ? cur.note : '', placeholder: 'Anything on your mind? (optional)' }),
    el('button', { class: 'btn primary', type: 'submit', text: cur ? 'Update check-in' : 'Save check-in' }),
  ]);
  ci.append(form);
  root.append(ci);

  // ---- Dashboard: status + rings + one compact line ----
  const a = analyze(state, iso);
  const rc = recap(state, iso, recapDim);
  const dp = panel('Your week', 'Your logs vs your goals');
  dp.append(el('div', { class: `statusline ${a.status.tone}` }, [
    el('span', { class: 'grow', text: a.status.label }),
    ttsSupported() ? el('button', { class: 'btn tiny', text: '🔊 Listen', title: 'Hear your recap', onclick: () => speak(rc.speech) }) : null,
  ]));
  const dimRow = el('div', { class: 'row wrap toggle' }, [el('span', { class: 'muted small', text: 'Recap:' })]);
  for (const dmn of ['day', 'week', 'month']) dimRow.append(el('button', { class: `btn tiny ${recapDim === dmn ? 'primary' : ''}`, text: dmn[0].toUpperCase() + dmn.slice(1), onclick: () => { recapDim = dmn; render(); } }));
  dp.append(dimRow);
  dp.append(el('div', { class: 'rings' }, a.metrics.map(ring)));

  // Second layer: vs healthy-aging guidelines (not just the user's own goals).
  dp.append(el('h3', { text: `Vs healthy-aging guidelines · ${a.guidelinesMet}/${a.guidelines.length} met` }));
  const gl = el('div', { class: 'list' });
  for (const g of a.guidelines) gl.append(el('div', { class: 'row wrap summary-line' }, [
    el('span', { class: 'grow', text: `${g.label} — ${g.detail}${g.note ? ` (${g.note})` : ''}` }),
    el('span', { class: 'muted small', text: g.target }),
    guidelineChip(g.status),
  ]));
  dp.append(gl);
  dp.append(el('p', { class: 'muted small', text: 'General guidance associated with healthy aging (WHO · CDC · NCCIH) — separate from your personal goals above. Daywell can’t measure biological age or claim your aging changed; that needs lab or DNA-methylation testing, not activity logs.' }));

  // What you've done — built from your actual logs, showing which came by voice.
  const done = el('details', { class: 'evidence' });
  done.append(el('summary', { text: `What you’ve done — ${rc.total} logged${rc.bySource.voice ? `, ${rc.bySource.voice} by voice` : ''}` }));
  if (!rc.total) done.append(el('p', { class: 'muted small', text: 'Nothing logged this week yet.' }));
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
  // Evidence & limits folded in here so Today stays three panels.
  const details = el('details', { class: 'evidence' });
  details.append(el('summary', { text: 'Evidence & limits' }));
  for (const note of HEALTHY_AGING_NOTES) details.append(el('div', { class: 'item' }, [el('strong', { text: note.topic }), el('span', { text: ` — ${note.text}` }), el('div', { class: 'muted small', text: `Source: ${note.source}` })]));
  details.append(el('p', { class: 'muted small', text: DISCLAIMER }));
  details.append(el('p', { class: 'muted small', text: 'Week-to-date vs your goals. No biological age is estimated — that needs lab/DNA-methylation testing, not activity logs. General guidance, not medical advice.' }));
  dp.append(details);
  root.append(dp);

  // ---- One clear next step; extras tucked away ----
  const recCard = (r) => {
    const card = el('div', { class: `rec ${r.priority} side-${r.side}` });
    card.append(el('p', { class: 'rec-title', text: r.title }));
    card.append(el('p', { class: 'rec-why', text: r.rationale }));
    if (r.source) card.append(el('p', { class: 'rec-src', text: `Source: ${r.source}` }));
    const cta = el('div', { class: 'row wrap actions' });
    if (r.activity) {
      cta.append(el('button', { class: 'btn tiny primary', text: 'Log it', onclick: () => quickLog(r.activity) }));
      cta.append(el('button', { class: 'btn tiny', text: 'Plan it', onclick: () => addPlanned(r.activity) }));
    } else if (r.goSetup) {
      cta.append(el('button', { class: 'btn tiny primary', text: 'Set goals', onclick: () => { view = 'setup'; render(); } }));
    } else if (r.addCat) {
      cta.append(el('button', { class: 'btn tiny', text: `Add a ${CATEGORIES[r.addCat].label} activity`, onclick: () => { view = 'setup'; render(); } }));
      cta.append(el('button', { class: 'btn tiny', text: 'Log it manually', onclick: () => { view = 'log'; render(); } }));
    }
    if (cta.childNodes.length) card.append(cta);
    return card;
  };
  const np = panel('Do next', 'One step, matched to your goals');
  np.append(recCard(a.recommendations[0]));
  const more = a.recommendations.slice(1);
  if (more.length) {
    const det = el('details', { class: 'evidence' }, [el('summary', { text: `More suggestions (${more.length})` })]);
    for (const r of more) det.append(recCard(r));
    np.append(det);
  }
  root.append(np);
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
    el('div', { class: `ring ${m.met ? 'met' : ''}`, style: `--pct:${Math.min(100, m.pct)};--c:${color}` }, [
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

function saveCheckin() {
  const mood = parseInt($('#ci-mood').value, 10);
  const energy = parseInt($('#ci-energy').value, 10);
  update(() => { day().checkin = { mood, energy, note: $('#ci-note').value.trim(), at: new Date().toISOString() }; }, 'Check-in saved.');
}

// ---------- LOG ----------

function renderLog(root) {
  const d = day();
  const p = panel('Log what you did', 'Type · voice · upload');
  const catRow = el('div', { class: 'row wrap toggle' });
  for (const k of CATEGORY_KEYS) catRow.append(el('button', { class: `btn tiny ${logCat === k ? 'primary' : ''}`, text: CATEGORIES[k].label, onclick: () => { logCat = k; render(); } }));
  p.append(catRow);

  logDurTouched = false;
  const form = el('form', { class: 'log-form', onsubmit: (e) => { e.preventDefault(); submitLog(); } });
  form.append(el('input', { id: 'log-text', type: 'text', placeholder: logExample(logCat), required: 'required', oninput: onLogText }));
  form.append(el('input', { id: 'log-dur', type: 'number', min: '0', max: '600', placeholder: 'min', 'aria-label': 'Duration minutes', oninput: () => { logDurTouched = true; } }));
  const micBtn = el('button', { type: 'button', class: 'btn tiny', id: 'mic-btn', text: '🎙 Voice' });
  micBtn.disabled = !voiceSupported();
  micBtn.addEventListener('click', () => toggleVoice(micBtn));
  form.append(micBtn);
  form.append(el('button', { class: 'btn primary', type: 'submit', text: 'Add' }));
  p.append(form);
  p.append(el('p', { id: 'log-preview', class: 'muted small', text: 'Type or say what you did — Daywell reads the category and minutes for you to confirm. Nothing is saved until you press Add.' }));

  const egRow = el('div', { class: 'chips' });
  for (const eg of LOG_EXAMPLES[logCat] || []) egRow.append(el('button', { type: 'button', class: 'chip liked', text: eg, onclick: () => fillExample(eg) }));
  p.append(egRow);

  p.append(el('p', { class: 'muted small', text: voiceSupported()
    ? 'Voice uses your browser’s speech recognition, which may send audio to a provider and needs a connection — unlike the rest of Daywell. Review the text before adding.'
    : 'Voice isn’t supported in this browser — type or upload instead.' }));

  p.append(el('h3', { text: 'Import activity & health data' }));
  p.append(el('p', { class: 'muted small', text: 'Import a file (JSON/CSV for movement, or Apple Health export.xml for workouts + resting heart rate + sleep). Read as plain facts; nothing leaves your device. Apple Health entries are filed by their own dates. See Setup for an iOS Shortcut that exports automatically.' }));
  p.append(el('label', { class: 'file-btn' }, ['Choose file', el('input', { id: 'upload-file', type: 'file', accept: '.json,.csv,.xml,application/json,text/csv,text/xml', onchange: (e) => onUpload(e) })]));
  p.append(el('span', { id: 'upload-status', class: 'muted small' }));
  root.append(p);

  // Manual health entry for the selected day
  const hp = panel('Health today (optional)', 'Resting HR · sleep');
  hp.append(el('p', { class: 'muted small', text: 'Enter these if you don’t import them. Shown as plain facts in your summary — never scored or turned into a biological age.' }));
  hp.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveHealth(); } }, [
    labeled('Resting HR (bpm)', el('input', { id: 'h-hr', type: 'number', min: '20', max: '220', value: d.health.restingHR != null ? String(d.health.restingHR) : '' })),
    labeled('Sleep (hours)', el('input', { id: 'h-sleep', type: 'number', min: '0', max: '24', step: '0.1', value: d.health.sleepHours != null ? String(d.health.sleepHours) : '' })),
    el('button', { class: 'btn', type: 'submit', text: 'Save health' }),
  ]));
  root.append(hp);

  const lp = panel('Logged today', `${d.activityLog.length} entr${d.activityLog.length === 1 ? 'y' : 'ies'}`);
  if (!d.activityLog.length) lp.append(el('p', { class: 'muted', text: 'Nothing logged yet.' }));
  for (const e of d.activityLog) lp.append(el('div', { class: 'row item' }, [
    catTag(e.category),
    el('span', { class: 'grow', text: `${e.text}${e.durationMin ? ` · ${e.durationMin} min` : ''}` }),
    el('span', { class: 'tag', text: e.source }),
    el('button', { class: 'link', text: 'Remove', onclick: () => update(() => { day().activityLog = day().activityLog.filter((x) => x.id !== e.id); }, 'Removed.') }),
  ]));
  root.append(lp);
}

function logExample(c) {
  return { movement: 'e.g. 30 min walk', meditation: 'e.g. 10 minute meditation', winddown: 'e.g. read for 20 minutes', music: 'e.g. calming playlist 20 minutes' }[c] || 'What did you do?';
}

// Live, on-device parse of the typed text → prefill category + minutes + preview.
// Updates the DOM directly (no full re-render) so the text field keeps focus.
function onLogText(e) { applyParsed(parseSpoken(e.target.value), e.target.value.trim()); }

function fillExample(text) {
  const box = $('#log-text');
  if (!box) return;
  box.value = text;
  logDurTouched = false;
  applyParsed(parseSpoken(text), text);
  box.focus();
}

function applyParsed(parsed, text) {
  if (text) {
    logCat = parsed.category;
    document.querySelectorAll('.toggle .btn').forEach((b) => b.classList.toggle('primary', b.textContent === CATEGORIES[logCat].label));
    const dur = $('#log-dur');
    if (dur && !logDurTouched) dur.value = parsed.durationMin ? String(parsed.durationMin) : '';
  }
  renderLogPreview(parsed, text);
}

function renderLogPreview(parsed, text) {
  const n = $('#log-preview');
  if (!n) return;
  if (!text) { n.textContent = 'Type or say what you did — Daywell reads the category and minutes for you to confirm. Nothing is saved until you press Add.'; return; }
  const durPart = parsed.durationMin ? `${parsed.durationMin} min` : 'no duration detected — enter minutes';
  let msg = `Will add: ${CATEGORIES[parsed.category].label} · ${durPart}. Edit anything below, then press Add.`;
  const others = parsed.categories.filter((c) => c !== parsed.category);
  if (others.length) msg += ` (Also sounds like ${others.map((c) => CATEGORIES[c].label).join(' + ')} — log those separately if you did them too.)`;
  n.textContent = msg;
}

function submitLog(source = 'text') {
  const text = $('#log-text').value.trim();
  if (!text) { flash('Enter what you did.', 'warn'); return; }
  const dur = Math.max(0, parseInt($('#log-dur') ? $('#log-dur').value : '0', 10) || 0);
  const before = goalMetKeys();
  day().activityLog.push({ id: uid('al'), category: logCat, text, durationMin: dur, source, at: new Date().toISOString() });
  persist();
  const cheer = celebrateManual(before);
  flash(cheer || 'Logged.', cheer ? 'ok' : 'ok'); render();
}
function quickLog(activity) {
  const before = goalMetKeys();
  day().activityLog.push({ id: uid('al'), category: activity.category, text: activity.title, durationMin: activity.durationMin, source: 'text', at: new Date().toISOString() });
  persist();
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
function toggleVoice(btn) {
  if (voiceStop) { voiceStop(); voiceStop = null; btn.textContent = '🎙 Voice'; btn.classList.remove('primary'); return; }
  btn.textContent = '● Listening…'; btn.classList.add('primary');
  voiceStop = startVoice({
    onInterim: (t) => { const box = $('#log-text'); if (box) box.value = t; applyParsed(parseSpoken(t), t.trim()); },
    onResult: (t) => {
      const box = $('#log-text'); if (box) box.value = t;
      // On-device parse → prefill category + duration; user confirms by pressing Add.
      logDurTouched = false;
      const parsed = parseSpoken(t);
      applyParsed(parsed, t.trim());
      flash(`Heard: "${t}" → ${CATEGORIES[parsed.category].label}${parsed.durationMin ? `, ${parsed.durationMin} min` : ''}. Review and press Add.`, 'ok');
    },
    onError: (err) => { flash(`Voice: ${err}`, 'warn'); },
    onEnd: () => { voiceStop = null; const b = $('#mic-btn'); if (b) { b.textContent = '🎙 Voice'; b.classList.remove('primary'); } },
  });
  if (!voiceStop) { btn.textContent = '🎙 Voice'; btn.classList.remove('primary'); }
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
          const d = ensureDay(state, date);
          for (const w of list) { d.activityLog.push({ id: uid('al'), category: 'movement', text: w.text, durationMin: w.durationMin, source: 'upload', at: new Date().toISOString() }); workouts += 1; }
        }
        for (const [date, h] of Object.entries(res.healthByDate)) {
          const d = ensureDay(state, date);
          if (typeof h.restingHR === 'number') d.health.restingHR = h.restingHR;
          if (typeof h.sleepHours === 'number') d.health.sleepHours = h.sleepHours;
          d.health.source = 'upload';
          healthDays += 1;
        }
      }, `Apple Health: ${workouts} workout(s), health facts on ${healthDays} day(s).`);
      status.textContent = `Imported ${workouts} workout(s) and health facts for ${healthDays} day(s), by their own dates.`;
    } else {
      const res = parseMovementUpload(text, file.name);
      if (!res.ok) { status.textContent = res.error; flash(`Import failed: ${res.error}`, 'error'); e.target.value = ''; return; }
      update(() => { const d = day(); for (const en of res.entries) d.activityLog.push({ id: uid('al'), category: 'movement', text: en.text, durationMin: en.durationMin, source: 'upload', at: new Date().toISOString() }); }, `Imported ${res.entries.length} entr${res.entries.length === 1 ? 'y' : 'ies'}.`);
      status.textContent = `Imported ${res.entries.length} into ${iso}.`;
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
  }, 'Health saved.');
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
  const pf = panel('About you', 'Age · routine');
  pf.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveProfile(); } }, [
    labeled('Name', el('input', { id: 'pf-name', type: 'text', value: state.profile.name || '', placeholder: 'e.g. Sasa', maxlength: '40' })),
    labeled('Age', el('input', { id: 'pf-age', type: 'number', min: '13', max: '120', value: state.profile.age != null ? String(state.profile.age) : '', placeholder: 'years' })),
    labeled('Wake', timeInput('pf-wake', r.wake)),
    labeled('Work start', timeInput('pf-wstart', r.workStart)),
    labeled('Work end', timeInput('pf-wend', r.workEnd)),
    labeled('Wind-down', timeInput('pf-wind', r.winddown)),
    labeled('Routine note', el('input', { id: 'pf-note', type: 'text', value: r.note || '', placeholder: 'e.g. deep work 9–12, gym evenings' })),
    el('button', { class: 'btn primary', type: 'submit', text: 'Save' }),
  ]));
  pf.append(el('p', { class: 'muted small', text: 'Routine times let Daywell trigger the right activity at the right time — move in the morning, wind down at night. Age is context only; never used to estimate risk or biological age.' }));
  root.append(pf);

  // Voice persona & celebration sound
  const vs = panel('Voice persona & sound', 'Character · celebration');
  const sel = selectEl('persona-sel', PERSONA_KEYS.map((k) => [k, `${getPersona(k).label} — ${getPersona(k).blurb}`]));
  sel.value = currentPersona().key;
  sel.addEventListener('change', (e) => setPersona(e.target.value));
  vs.append(el('div', { class: 'row wrap' }, [
    labeled('Persona', sel),
    ttsSupported() ? el('button', { class: 'btn tiny', text: '🔊 Preview', onclick: () => speak(greeting()) }) : null,
    el('button', { class: `btn tiny ${soundOn() ? 'primary' : ''}`, text: soundOn() ? '🔔 Goal chime: on' : '🔕 Goal chime: off', onclick: () => { setSound(!soundOn()); render(); } }),
  ]));
  vs.append(el('p', { class: 'muted small', text: 'Persona changes how Daywell talks and sounds — personality only, never what’s counted. A short chime plays when you reach a goal.' }));
  root.append(vs);

  const g = panel('Weekly goals', 'You set these');
  g.append(el('form', { class: 'grid-form', onsubmit: (e) => { e.preventDefault(); saveGoals(); } }, [
    labeled('Movement sessions / week', el('input', { id: 'g-sessions', type: 'number', min: '0', max: '50', value: String(state.profile.goals.movementSessionsPerWeek) })),
    labeled('Movement minutes / week', el('input', { id: 'g-minutes', type: 'number', min: '0', max: '5000', value: String(state.profile.goals.movementMinutesPerWeek) })),
    labeled('Mind sessions / week', el('input', { id: 'g-mind', type: 'number', min: '0', max: '50', value: String(state.profile.goals.mindfulnessSessionsPerWeek) })),
    el('button', { class: 'btn primary', type: 'submit', text: 'Save goals' }),
  ]));
  root.append(g);

  const lib = panel('Activity library', 'Reusable · powers suggestions');
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
  }, 'Saved.');
}
function saveGoals() {
  update(() => { state.profile.goals = {
    movementSessionsPerWeek: Math.max(0, parseInt($('#g-sessions').value, 10) || 0),
    movementMinutesPerWeek: Math.max(0, parseInt($('#g-minutes').value, 10) || 0),
    mindfulnessSessionsPerWeek: Math.max(0, parseInt($('#g-mind').value, 10) || 0),
  }; }, 'Goals saved.');
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
  deleteArmed = false; clearState(); state = defaultState(); ensureDay(state, iso); persist(); render();
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
function makeUtterance(text) {
  const u = new SpeechSynthesisUtterance(sanitizeSpeech(text));
  if (ttsVoice) { u.voice = ttsVoice; u.lang = ttsVoice.lang; } else u.lang = navigator.language || 'en-US';
  const p = currentPersona();
  u.rate = p.rate; u.pitch = p.pitch; u.volume = 1; // persona sets the delivery
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
function speakThen(text, done) {
  if (!ttsSupported()) { if (done) done(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = makeUtterance(text);
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
  voiceMode = true; voiceHeard = ''; voiceStatus = 'speaking';
  voiceReply = greeting();
  voiceSpeaking = true; render();
  speakThen(voiceReply, () => { voiceSpeaking = false; if (voiceMode) listenTurn(); });
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
    onInterim: (t) => { voiceHeard = t; },
    onResult: (t) => { if (voiceMode) handleVoiceQuery(t); },
    onError: (err) => { if (voiceMode) flash(`Voice: ${err}`, 'warn'); },
    onEnd: () => { voiceLoopStop = null; if (voiceMode && !voiceSpeaking) listenTurn(); }, // silence → listen again
  });
  if (!voiceLoopStop) { voiceMode = false; voiceStatus = 'idle'; render(); }
}
function handleVoiceQuery(text) {
  if (voiceLoopStop) { voiceLoopStop(); voiceLoopStop = null; }
  voiceSpeaking = true; // guard onEnd from restarting while we answer
  voiceHeard = text;
  const res = answerQuery(state, iso, text, { dimension: recapDim, nowMin: nowMinForView(), name: firstName(), persona: state.profile.persona });
  let reply = res.reply;
  if (res.action === 'log' && res.entry) {
    const before = goalMetKeys();
    day().activityLog.push({ id: uid('al'), category: res.entry.category, text: res.entry.text, durationMin: res.entry.durationMin || 0, source: 'voice', at: new Date().toISOString() });
    persist();
    const labels = newlyMetLabels(before);
    if (labels.length) { if (soundOn()) playChime(); reply = `${reply} ${cheerLine(labels)}`; }
  }
  voiceReply = reply;
  if (res.dimension) recapDim = res.dimension;
  if (res.view) view = res.view;
  voiceStatus = 'speaking'; render();
  speakThen(res.reply, () => {
    voiceSpeaking = false;
    if (res.stop) { stopVoiceMode(); return; }
    if (voiceMode) listenTurn();
  });
}
function voiceStatusText() {
  if (voiceStatus === 'speaking') return '🔊 Speaking…';
  if (voiceStatus === 'listening') return '● Listening… say what you did, or ask a question';
  if (voiceStatus === 'waking') return '👂 Waiting for “Hey Daywell”…';
  return 'Ready';
}

let flashTimer = null;
function flash(message, tone = 'ok') { const n = $('#flash'); n.textContent = message; n.className = `flash ${tone} show`; clearTimeout(flashTimer); flashTimer = setTimeout(() => { n.className = 'flash'; }, 3500); }

window.addEventListener('DOMContentLoaded', boot);
