// ask.js — deterministic, on-device interpreter for spoken questions. Maps a
// phrase to an answer built ONLY from the user's own logs, goals, and cited
// guidelines (via recap/analyze/nudges). No cloud model, no free-form generation.
//
// Order of precedence: SAFETY first (crisis → resources; distress → support +
// guided breathing), then the assessment boundary (requests to judge the user's
// health, mental state, or biological age get an honest refusal — R06/R12),
// then logging, stats, summaries, and next steps.

import { recap } from './recap.js';
import { analyze } from './analyze.js';
import { buildNudges } from './nudges.js';
import { parseSpoken, detectCategories } from './parse.js';
import { getPersona, pick } from './persona.js';
import { detectCrisis, detectDistress, crisisReply, distressReply } from './safety.js';

// Requests for an ASSESSMENT (as opposed to telling us how they feel).
const BOUNDARY = /(biological age|mental health|how healthy|am i healthy|how am i mentally|\bmentally\b|am i (depressed|anxious|sick|ill|normal)|do i have|diagnos|disease|cancer|medication|should i take|is it normal)/i;
const BREATHE = /(breathe with me|breathing exercise|guide me|help me (calm|relax|breathe)|calm me down|let'?s breathe|box breathing now|start breathing)/i;

const LOG_TRIGGER = /^(log|add|record)\b|\bi (just )?(did|went for|finished|completed|had|took|got in|wrapped up|knocked out|logged)\b|\blog (that|this|it)\b|^(went for|finished|completed) /i;

// Build a log action from a statement. `explicit` = the user used a log verb
// ("log…", "I did…"), so a duration alone is enough; otherwise a category is needed.
function logAction(text, ctx, explicit) {
  const cleaned = String(text)
    .replace(/^\s*(please\s+)?(log|add|record)\s+/i, '')
    .replace(/^\s*i\s+(just\s+)?(did|went for|finished|completed|had|took|got in|wrapped up|knocked out|logged)\s+(a\s+|an\s+|some\s+)?/i, '')
    .replace(/^\s*(went for|finished|completed|did)\s+(a\s+|an\s+)?/i, '')
    .trim();
  const parsed = parseSpoken(cleaned || text);
  const hasCat = detectCategories(cleaned).length > 0;
  if (!(hasCat || (explicit && parsed.durationMin))) return null;
  const who = ctx.name ? `, ${ctx.name}` : '';
  const ack = pick(getPersona(ctx.persona).ack);
  const tail = parsed.durationMin ? `, ${parsed.durationMin} minutes. Anything else?` : '. How long was it?';
  return { action: 'log', entry: { category: parsed.category, text: parsed.title, durationMin: parsed.durationMin }, reply: `${ack}${who} — logged ${parsed.title}${tail}` };
}

function dimFrom(text) {
  if (/\b(today|day)\b/.test(text)) return 'day';
  if (/\b(month|monthly)\b/.test(text)) return 'month';
  if (/\b(week|weekly)\b/.test(text)) return 'week';
  return null;
}

// Returns { reply } plus optional { dimension, view, stop } for the UI to act on.
export function answerQuery(state, iso, text, ctx = {}) {
  const t = String(text || '').toLowerCase().trim();
  const dim = ctx.dimension || 'week';
  const nowMin = ctx.nowMin != null ? ctx.nowMin : null;
  const wantedDim = dimFrom(t);
  if (!t) return { reply: 'I didn’t catch that. Try “how’s my week” or “what should I do next”.' };

  // 1. Safety always wins — even over "stop".
  if (detectCrisis(t)) return { reply: crisisReply(ctx.name, ctx.region), safety: 'crisis' };
  if (BREATHE.test(t)) return { reply: 'Okay, let’s do it.', action: 'breathe' };
  if (detectDistress(t)) return { reply: distressReply(ctx.name), safety: 'distress' };

  if (/\b(stop|exit|quit|cancel|never mind|that'?s all|goodbye|bye)\b/.test(t)) return { reply: 'Okay, stopping voice mode.', stop: true };
  if (/(what can you|what do you do|^help$|how do i use|what can i ask)/.test(t)) {
    return { reply: 'Lots! Tell me what you did and I’ll log it, ask how your day, week, or month is going, or what to do next. Say “breathe with me” any time for a guided minute of calm. I only read your own logs and goals.' };
  }
  if (BOUNDARY.test(t)) {
    return { reply: 'I can’t assess your health, your mental state, or a biological age — that needs a clinician, not an app, and I only track what you log. If something is weighing on you, talking to someone you trust or a professional is worth it. I can tell you what you’ve logged and how it’s tracking against your goals.' };
  }

  // Logging by voice — "log a 30 minute walk", "I just finished a 10 min meditation".
  if (LOG_TRIGGER.test(t)) {
    const la = logAction(text, ctx, true);
    if (la) return la;
  }

  // Plain statements are logs too ("30 min walk", "yoga"), so typing feels like
  // talking — but never questions, and never a bare stat word ("movement").
  const isQuestion = /\?\s*$/.test(t) || /^(how|what|when|why|where|who|which|should|can|could|would|is|are|do|does|did|will|show|switch|change|tell)\b/.test(t);
  if (!isQuestion && !/^(movement|exercise|workouts?|mind|mindfulness|sleep)$/.test(t)) {
    if (detectCategories(t).length) { const la = logAction(text, ctx, false); if (la) return la; }
    // A bare duration right after a log amends it ("…how long?" → "45 minutes").
    const dur = parseSpoken(t).durationMin;
    if (dur && !detectCategories(t).length && !wantedDim) {
      if (ctx.lastEntry) return { action: 'amend', durationMin: dur, reply: `Updated — ${ctx.lastEntry.text}, ${dur} minutes.` };
      return { reply: `What did you do for ${dur} minutes? For example, “${dur} minute walk”.` };
    }
  }

  // stats (strong keywords win over a general recap)
  if (/(active minutes|movement|exercise|workout|how much.*(move|active)|how many minutes|minutes of)/.test(t)) {
    const m = analyze(state, iso).metrics.find((x) => x.key === 'moveMin');
    const cheer = m.met ? ' Nicely done!' : ' Keep it going!';
    return { reply: `So far you’ve logged ${m.done} of ${m.target} movement minutes this week — the guideline’s 150 to 300.${cheer}` };
  }
  if (/(meditat|mind session|mindful|wind.?down|how many.*session)/.test(t)) {
    const m = analyze(state, iso).metrics.find((x) => x.key === 'mind');
    const cheer = m.met ? ' Love it.' : ' A short one tonight would help.';
    return { reply: `You’ve logged ${m.done} of ${m.target} mind sessions this week.${cheer}` };
  }
  if (/sleep/.test(t)) {
    const s = analyze(state, iso).sleep;
    return { reply: s.avg != null ? `Your sleep’s averaging ${s.avg} hours over ${s.nights} night${s.nights !== 1 ? 's' : ''} — the guideline’s 7 or more.` : 'No sleep logged yet this period.' };
  }

  if (/(what did i|what have i|what i did|what i'?ve done|activities|what did i log|logged)/.test(t)) {
    const r = recap(state, iso, wantedDim || dim);
    if (!r.total) return { reply: `You haven’t logged anything ${r.label} yet.`, dimension: wantedDim || undefined };
    const top = r.items.slice().reverse().slice(0, 5).map((i) => `${i.text}${i.durationMin ? `, ${i.durationMin} minutes` : ''}`).join('; ');
    return { reply: `${r.label.charAt(0).toUpperCase() + r.label.slice(1)}, you logged ${r.total}: ${top}.`, dimension: wantedDim || undefined };
  }

  if (/(next|what should i|suggest|recommend|what now|what do i do)/.test(t)) {
    const { primary } = buildNudges(state, iso, nowMin);
    return { reply: primary ? primary.text : 'You’re on pace. Keep your routine.' };
  }

  if (/(on track|behind|am i on|status)/.test(t)) {
    return { reply: analyze(state, iso).status.label };
  }

  // dimension switch and/or recap
  const asksRecap = /(recap|summary|summarise|summarize|how am i|how'?s my|how is my|progress|doing|going)/.test(t);
  if (wantedDim || asksRecap) {
    const r = recap(state, iso, wantedDim || dim);
    return { reply: r.speech, dimension: wantedDim || undefined };
  }

  if (/^(thanks|thank you|thx|cheers|great|ok|okay|cool|nice|awesome|perfect)\b/.test(t)) {
    return { reply: `${pick(['Anytime', 'You’re welcome', 'Glad to help'])}${ctx.name ? `, ${ctx.name}` : ''}! Anything else?` };
  }

  return { reply: 'Hmm, not sure on that one. I can tell you how your week’s going, switch to day, week, or month, what you did, or what to do next. What would you like?' };
}
