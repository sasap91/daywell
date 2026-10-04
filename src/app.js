// Daywell — Late Meeting Recovery MVP controller.
// Wires the composable skills to a responsive, keyboard-accessible UI.
// Rules: no unaccepted plan mutation, no duplicate accepted block, no invented
// completion, all user text rendered safely.

import { OUTCOME, emptyDay, newId, parseClock, toClockInput } from './model.js';
import { loadDay, saveDay, clearDay, exportDay, importDay } from './store.js';
import { formatClock, formatRange, formatDateLabel, localDateString } from './time.js';
import { computeReplacement } from './skills/compute.js';
import { explainCandidate, explainNoOption } from './skills/explain.js';
import { applyCandidate, undo, canUndo } from './skills/apply.js';
import { recordOutcome, OUTCOME_OPTIONS } from './skills/outcome.js';
import { recordMeeting, conflictWithPlanned, actionFloor } from './skills/context.js';
import { el, clear, esc } from './dom.js';
import * as monitor from './monitor.js';
import { importCalendar, getLibrary, saveToLibrary, removeFromLibrary, addLibraryOptionAsFallback } from './connectors.js';

const $ = (sel) => document.querySelector(sel);

let day;
let proposal = null; // last computed { ...result } with preferenceId
let preferenceId = null;
let saveState = { ok: true, error: null };

function boot() {
  const loaded = loadDay();
  if (loaded.found && loaded.day) {
    day = loaded.day;
    if (loaded.errors && loaded.errors.length) {
      flash(`Recovered your plan with ${loaded.errors.length} issue(s) fixed.`, 'warn');
      monitor.log('load-recovered', { count: loaded.errors.length });
    }
  } else if (loaded.found && !loaded.day) {
    day = emptyDay(localDateString());
    flash('Stored plan was unreadable; started a fresh day. Your previous file (if any) was not changed.', 'error');
    monitor.log('load-corrupt');
  } else {
    day = emptyDay(localDateString());
  }
  renderAll();
}

function persist() {
  const res = saveDay(day);
  saveState = res;
  if (!res.ok) monitor.log('save-failed', { error: res.error });
  renderSaveState();
  return res.ok;
}

function commit(nextDay, { message, tone = 'ok' } = {}) {
  day = nextDay;
  const ok = persist();
  if (message) flash(message, ok ? tone : 'error');
  renderAll();
}

// ---------- rendering ----------

function renderAll() {
  renderDateAndCommitments();
  renderPlanned();
  renderFallbacks();
  renderMeeting();
  renderProposal();
  renderAppliedAndOutcome();
  renderSaveState();
  renderConnectors();
  renderDiagnostics();
}

function renderConnectors() {
  const dateLabel = $('#conn-date-label');
  if (dateLabel) dateLabel.textContent = day.date;
  const list = $('#library-list');
  if (!list) return;
  clear(list);
  const lib = getLibrary();
  if (!lib.length) {
    list.append(el('p', { class: 'muted', text: 'No saved options yet. Save a meal or movement below to reuse it.' }));
    return;
  }
  for (const opt of lib) {
    list.append(el('div', { class: 'row item' }, [
      el('span', { class: 'grow', text: `${opt.title} · ${opt.durationMin} min · ${opt.kind}${opt.availabilityNote ? ` · ${opt.availabilityNote}` : ''}` }),
      el('button', { class: 'link', text: 'Add to today', 'aria-label': `Add ${opt.title} as an alternative`,
        onclick: () => {
          const res = addLibraryOptionAsFallback(day, opt.id);
          if (!res.ok) { flash(res.error, 'warn'); return; }
          invalidateProposal();
          commit(res.day, { message: `Added "${opt.title}" as an alternative.` });
        } }),
      el('button', { class: 'link', text: 'Remove', 'aria-label': `Remove ${opt.title} from library`,
        onclick: () => { removeFromLibrary(opt.id); renderConnectors(); } }),
    ]));
  }
}

function renderSaveState() {
  const node = $('#save-state');
  clear(node);
  if (saveState.ok) {
    node.append(el('span', { class: 'pill ok', text: 'Saved locally' }));
  } else {
    node.append(el('span', { class: 'pill error', text: `Not saved: ${saveState.error}` }));
  }
}

function renderDateAndCommitments() {
  $('#plan-date').value = day.date;
  $('#date-label').textContent = formatDateLabel(day.date);
  $('#tz-label').textContent = day.timeZone;

  const list = $('#commitment-list');
  clear(list);
  if (!day.commitments.length) {
    list.append(el('p', { class: 'muted', text: 'No work commitments yet. Add the blocks that must not move.' }));
  }
  for (const c of [...day.commitments].sort((a, b) => a.start - b.start)) {
    list.append(el('div', { class: 'row item' }, [
      el('span', { class: 'mono', text: formatRange(c.start, c.end) }),
      el('span', { class: 'grow', text: c.title || 'Untitled commitment' }),
      el('span', { class: 'tag', text: c.protected ? 'protected' : 'flexible' }),
      el('button', { class: 'link', text: 'Remove', 'aria-label': `Remove commitment ${c.title}`,
        onclick: () => {
          day = { ...day, commitments: day.commitments.filter((x) => x.id !== c.id) };
          invalidateProposal();
          commit(day, { message: 'Commitment removed.' });
        } }),
    ]));
  }
}

function renderPlanned() {
  const p = day.planned;
  $('#p-title').value = p.title;
  $('#p-kind').value = p.kind;
  $('#p-start').value = toClockInput(p.start);
  $('#p-duration').value = p.durationMin;
  $('#p-latest').value = toClockInput(p.latestFinish);
  $('#p-buf-before').value = p.bufferBeforeMin;
  $('#p-buf-after').value = p.bufferAfterMin;
}

function renderFallbacks() {
  const list = $('#fallback-list');
  clear(list);
  if (!day.fallbacks.length) {
    list.append(el('p', { class: 'muted', text: 'No saved alternatives yet (add up to two).' }));
  }
  day.fallbacks.forEach((f) => {
    list.append(el('div', { class: 'row item' }, [
      el('span', { class: 'grow', text: `${f.title} · ${f.durationMin} min · ${f.kind}` }),
      el('label', { class: 'avail' }, [
        el('input', { type: 'checkbox', ...(f.available ? { checked: 'checked' } : {}),
          onchange: (e) => {
            day = { ...day, fallbacks: day.fallbacks.map((x) => x.id === f.id ? { ...x, available: e.target.checked } : x) };
            invalidateProposal();
            commit(day);
          } }),
        ' available',
      ]),
      el('button', { class: 'link', text: 'Remove', 'aria-label': `Remove alternative ${f.title}`,
        onclick: () => {
          day = { ...day, fallbacks: day.fallbacks.filter((x) => x.id !== f.id) };
          invalidateProposal();
          commit(day, { message: 'Alternative removed.' });
        } }),
    ]));
  });
  $('#add-fallback').disabled = day.fallbacks.length >= 2;
}

function renderMeeting() {
  const info = $('#meeting-info');
  clear(info);
  if (!day.meeting) {
    info.append(el('p', { class: 'muted', text: 'No overrun reported. The plan is unchanged.' }));
    return;
  }
  const conflict = conflictWithPlanned(day);
  info.append(el('p', {}, [
    el('strong', { text: day.meeting.title }),
    ` now ends ${formatClock(day.meeting.end)}. `,
  ]));
  if (conflict.conflict) {
    info.append(el('p', { class: 'warn-text', text:
      `This conflicts with "${day.planned.title || 'your planned action'}" (${formatRange(day.planned.start, day.planned.start + day.planned.durationMin)}).` }));
  } else {
    info.append(el('p', { class: 'muted', text: 'No conflict with your planned action — no change is forced.' }));
  }
}

function renderProposal() {
  const box = $('#proposal');
  clear(box);
  if (!proposal) {
    box.append(el('p', { class: 'muted', text: 'Report an overrun, then compute a replacement.' }));
    return;
  }
  if (!proposal.hasOption) {
    box.append(el('p', { class: 'warn-text', text: explainNoOption(proposal, day) }));
    box.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn', text: 'Defer this action',
        onclick: () => doRecordOutcome(OUTCOME.DEFERRED, 'No workable option today') }),
    ]));
    return;
  }

  const makeCard = (candidate, isRec) => {
    if (!candidate) return null;
    return el('div', { class: `card ${isRec ? 'rec' : 'alt'}` }, [
      el('p', { class: 'eyebrow', text: isRec ? 'Recommended' : 'Alternative' }),
      el('h4', { text: `${candidate.title} · ${formatRange(candidate.start, candidate.end)}` }),
      el('p', { class: 'reason', text: explainCandidate(candidate, proposal) }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn primary', text: isRec ? 'Accept' : 'Accept this instead',
          onclick: () => doApply(candidate) }),
        isRec ? el('button', { class: 'btn', text: 'Prefer original next time', disabled: candidate.isFallback ? null : 'disabled',
          onclick: () => { preferenceId = day.planned.id; computeNow(); } }) : null,
      ]),
    ]);
  };

  box.append(makeCard(proposal.recommended, true));
  const alt = makeCard(proposal.alternative, false);
  if (alt) box.append(alt);
  box.append(el('p', { class: 'muted small', text: 'Suggestions use only your saved options and windows. Daywell does not assert nutrition, allergen safety, or workout equivalence.' }));
}

function renderAppliedAndOutcome() {
  const box = $('#applied');
  clear(box);
  if (!day.applied) {
    box.append(el('p', { class: 'muted', text: 'Nothing applied to the plan yet. Accepting a proposal updates the dated plan here.' }));
  } else {
    const a = day.applied;
    box.append(el('div', { class: 'card applied' }, [
      el('p', { class: 'eyebrow', text: a.isFallback ? 'Applied (fallback)' : 'Applied' }),
      el('h4', { text: `${a.title} · ${formatRange(a.start, a.start + a.durationMin)}` }),
      el('p', { class: 'muted small', text: 'This changed Daywell’s internal plan only — not any external calendar.' }),
    ]));
  }

  // Undo
  const undoRow = $('#undo-row');
  clear(undoRow);
  if (canUndo(day)) {
    undoRow.append(el('button', { class: 'btn', text: 'Undo last change',
      onclick: () => {
        const res = undo(day, { floor: actionFloor(day) });
        if (!res.ok) {
          flash(res.reason === 'prev-invalid' ? 'Cannot undo: the previous block no longer fits the current plan.' : 'Nothing to undo.', 'warn');
          monitor.log('undo-blocked', { reason: res.reason });
          return;
        }
        commit(res.day, { message: 'Reverted to the previous block.' });
      } }));
  }

  // Outcome
  const outWrap = $('#outcome-controls');
  clear(outWrap);
  const current = day.outcome.state;
  outWrap.append(el('p', { class: 'eyebrow', text: `Current outcome: ${labelFor(current)}` }));
  const btnRow = el('div', { class: 'row wrap' });
  for (const opt of OUTCOME_OPTIONS) {
    const disabled = opt.state === OUTCOME.FULL_COMPLETED && (!day.applied || day.applied.isFallback);
    btnRow.append(el('button', {
      class: `btn ${current === opt.state ? 'primary' : ''}`,
      ...(disabled ? { disabled: 'disabled', title: 'A fallback cannot claim full-action credit.' } : {}),
      text: opt.label,
      onclick: () => doRecordOutcome(opt.state, $('#outcome-reason').value),
    }));
  }
  outWrap.append(btnRow);
}

function renderDiagnostics() {
  const node = $('#diag');
  if (!node) return;
  const s = monitor.summary();
  clear(node);
  node.append(el('span', { class: 'mono small', text:
    `events ${s.n} · avg compute ${s.avgComputeMs ?? '—'}ms · save-fails ${s.counts['save-failed'] || 0} · invalid ${s.counts['invalid-proposal'] || 0}` }));
}

// ---------- actions ----------

function labelFor(state) {
  const opt = OUTCOME_OPTIONS.find((o) => o.state === state);
  if (opt) return opt.label;
  if (state === OUTCOME.ACCEPTED) return 'Accepted (not yet completed)';
  return 'Pending';
}

function invalidateProposal() {
  proposal = null;
}

function computeNow() {
  const floor = actionFloor(day);
  const t0 = performance.now();
  proposal = computeReplacement(day, { floor, preferenceId });
  monitor.log('compute', { ms: Math.round(performance.now() - t0), hasOption: proposal.hasOption });
  if (!proposal.hasOption) monitor.log('no-option');
  renderProposal();
  $('#proposal').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function doApply(candidate) {
  const floor = actionFloor(day);
  const res = applyCandidate(day, candidate, { floor });
  if (!res.ok) {
    if (res.reason === 'stale') {
      monitor.log('invalid-proposal', { reason: 'stale' });
      flash('Your plan changed since this suggestion — recomputing.', 'warn');
      computeNow();
    }
    return;
  }
  if (res.reason === 'noop') {
    flash('That block is already applied.', 'warn');
    return;
  }
  commit(res.day, { message: 'Applied to today’s plan.' });
}

function doRecordOutcome(state, reason) {
  const res = recordOutcome(day, state, reason);
  if (!res.ok) {
    flash('Cannot record that outcome for this action.', 'warn');
    monitor.log('outcome-blocked', { reason: res.reason });
    return;
  }
  monitor.log('outcome', { state });
  commit(res.day, { message: `Outcome recorded: ${labelFor(state)}.` });
}

let flashTimer = null;
function flash(message, tone = 'ok') {
  const node = $('#flash');
  node.textContent = message;
  node.className = `flash ${tone} show`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { node.className = 'flash'; }, 4000);
}

// ---------- form wiring ----------

function wire() {
  $('#plan-date').addEventListener('change', (e) => {
    const v = e.target.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { flash('Invalid date.', 'warn'); renderDateAndCommitments(); return; }
    day = { ...day, date: v };
    commit(day, { message: 'Date updated.' });
  });

  $('#commitment-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = parseClock($('#c-start').value);
    const end = parseClock($('#c-end').value);
    const title = $('#c-title').value.trim();
    if (start === null || end === null || end <= start) { flash('Commitment end must be after start.', 'warn'); return; }
    day = { ...day, commitments: [...day.commitments, { id: newId('cm'), title, start, end, protected: true }] };
    invalidateProposal();
    e.target.reset();
    commit(day, { message: 'Commitment added.' });
  });

  $('#planned-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = parseClock($('#p-start').value);
    const latest = parseClock($('#p-latest').value);
    const duration = parseInt($('#p-duration').value, 10);
    const bufBefore = Math.max(0, parseInt($('#p-buf-before').value, 10) || 0);
    const bufAfter = Math.max(0, parseInt($('#p-buf-after').value, 10) || 0);
    const title = $('#p-title').value.trim();
    if (start === null || latest === null) { flash('Enter valid times.', 'warn'); return; }
    if (!(duration > 0)) { flash('Duration must be positive.', 'warn'); return; }
    if (!title) { flash('Give the planned action a title.', 'warn'); return; }
    day = { ...day, planned: { ...day.planned, title, kind: $('#p-kind').value, start, durationMin: duration, latestFinish: latest, bufferBeforeMin: bufBefore, bufferAfterMin: bufAfter } };
    invalidateProposal();
    commit(day, { message: 'Planned action saved.' });
  });

  $('#fallback-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (day.fallbacks.length >= 2) { flash('You can save at most two alternatives.', 'warn'); return; }
    const title = $('#f-title').value.trim();
    const duration = parseInt($('#f-duration').value, 10);
    if (!title || !(duration > 0)) { flash('Alternative needs a title and positive duration.', 'warn'); return; }
    const fb = { id: newId('fb'), title, kind: $('#f-kind').value, durationMin: duration, available: true, availabilityNote: $('#f-note').value.trim() };
    day = { ...day, fallbacks: [...day.fallbacks, fb] };
    invalidateProposal();
    e.target.reset();
    commit(day, { message: 'Alternative saved.' });
  });

  $('#ics-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = $('#ics-status');
    status.textContent = 'Reading…';
    try {
      const text = await file.text();
      const res = importCalendar(day, text);
      if (!res.ok) { status.textContent = res.error; flash(`Calendar import failed: ${res.error}`, 'error'); monitor.log('ics-failed'); e.target.value = ''; return; }
      if (res.added > 0) {
        invalidateProposal();
        commit(res.day, { message: `Imported ${res.added} event(s) for ${day.date}.` });
      }
      const parts = [`Added ${res.added}`];
      if (res.duplicates) parts.push(`${res.duplicates} already present`);
      if (res.skipped) parts.push(`${res.skipped} off-date/other skipped`);
      if (res.allDay) parts.push(`${res.allDay} all-day skipped`);
      status.textContent = parts.join(' · ');
      monitor.log('ics-import', { added: res.added, total: res.total });
    } catch (err) {
      status.textContent = 'Could not read file.';
      flash('Could not read the .ics file.', 'error');
    }
    e.target.value = '';
  });

  $('#library-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#l-title').value.trim();
    const duration = parseInt($('#l-duration').value, 10);
    if (!title || !(duration > 0)) { flash('Library option needs a title and positive duration.', 'warn'); return; }
    const res = saveToLibrary({ title, kind: $('#l-kind').value, durationMin: duration, availabilityNote: $('#l-note').value.trim() });
    if (!res.ok) { flash(res.error, 'warn'); return; }
    e.target.reset();
    renderConnectors();
    flash(res.duplicate ? 'That option is already in your library.' : 'Saved to library.', res.duplicate ? 'warn' : 'ok');
  });

  $('#meeting-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const start = parseClock($('#m-start').value);
    const end = parseClock($('#m-end').value);
    if (start === null || end === null || end <= start) { flash('Meeting end must be after start.', 'warn'); return; }
    const res = recordMeeting(day, { title: $('#m-title').value, start, end });
    if (!res.ok) { flash('Invalid meeting time.', 'warn'); return; }
    preferenceId = null;
    commit(res.day, { message: 'Overrun recorded.' });
    computeNow();
  });

  $('#clear-meeting').addEventListener('click', () => {
    day = { ...day, meeting: null };
    invalidateProposal();
    commit(day, { message: 'Overrun cleared.' });
  });

  $('#compute-btn').addEventListener('click', () => {
    if (!day.meeting) { flash('Report the overrun first.', 'warn'); return; }
    computeNow();
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([exportDay(day)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `daywell-${day.date}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash('Exported. The file contains your personal plan data.', 'warn');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const res = importDay(text);
    if (!res.day) { flash(`Import failed: ${res.errors[0] || 'unknown error'}`, 'error'); return; }
    day = res.day;
    invalidateProposal();
    commit(day, { message: res.errors.length ? `Imported with ${res.errors.length} issue(s) fixed.` : 'Imported.' , tone: res.errors.length ? 'warn' : 'ok' });
    e.target.value = '';
  });

  $('#delete-btn').addEventListener('click', () => {
    if (!$('#delete-confirm').checked) { flash('Tick the confirm box to delete local records.', 'warn'); return; }
    clearDay();
    monitor.clearDiagnostics();
    day = emptyDay(localDateString());
    proposal = null;
    preferenceId = null;
    saveState = { ok: true, error: null };
    renderAll();
    flash('Local records deleted on this device. Any exported files are NOT deleted.', 'warn');
    $('#delete-confirm').checked = false;
  });

  $('#load-sample').addEventListener('click', () => {
    day = sampleDay();
    proposal = null;
    preferenceId = null;
    commit(day, { message: 'Loaded the PRD example day (synthetic).' });
  });
}

function sampleDay() {
  const d = emptyDay(localDateString());
  d.commitments = [
    { id: newId('cm'), title: 'Team meeting', start: 18 * 60, end: 18 * 60 + 20, protected: true },
    { id: newId('cm'), title: 'Protected commitment', start: 19 * 60, end: 20 * 60, protected: true },
  ];
  d.planned = { id: newId('plan'), kind: 'movement', title: 'Walk', start: 18 * 60, durationMin: 30, latestFinish: 19 * 60, bufferBeforeMin: 10, bufferAfterMin: 10 };
  d.fallbacks = [
    { id: newId('fb'), kind: 'movement', title: 'Short walk', durationMin: 10, available: true, availabilityNote: 'shoes by the door' },
  ];
  d.meeting = { title: 'Team meeting', start: 18 * 60, end: 18 * 60 + 20 };
  return d;
}

window.addEventListener('DOMContentLoaded', () => {
  wire();
  boot();
});
