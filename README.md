# Daywell — Personal Wellbeing Assistant

A **local-first** web app for your **physical and mental** wellbeing. You log what
you do (movement, meditation, wind-down, music/mood) by **text, voice, or file
import**; Daywell shows how your week is tracking against **your own goals** and
against **cited healthy-aging guidelines**, and gives you **one evidence-anchored
next step** — including through a hands-free **voice companion**.

Everything stays in your browser on your device. There is no account and no
server. An **optional AI layer** (off by default) can interpret your week — on-device,
or with Claude using your own API key.

> **What Daywell will never do:** diagnose you, score your health, infer a mental
> state, or estimate/claim a biological age. It reports *what you logged* and how
> it tracks against *goals you set* and *general cited guidance* — nothing more.
> These boundaries are enforced everywhere — in voice mode and on everything the
> optional AI writes, which code checks before you see it. See
> [`docs/PRD_v2.2.md`](docs/PRD_v2.2.md) §R06 and §R12.

---

## Highlights

- 💬 **One message bar, everywhere** — at the bottom of every page: type *or* tap
  🎤 and just say what you did ("30 min walk", "yoga" → "how long?" → "45 minutes")
  or ask ("how's my week?"). Logging is instant with **Undo** — no forms, no
  confirm dialogs.
- 🛟 **Safety first** — if your own words (typed, spoken, or in a check-in note)
  signal crisis, Daywell pauses everything else and shows the crisis line for
  **your region** (US/Canada 988, UK & Ireland 116 123, Australia 13 11 14,
  Thailand 1323 — or the global directory) in a calm voice. Distress ("I'm so
  anxious") gets support, not a refusal.
- 🫁 **Guided breathing** — "breathe with me" (or one tap) runs a spoken one-minute
  box-breathing exercise and logs it. The agent *acts*, not just suggests.
- ✨ **Optional AI read** (off by default) — an LLM interprets your verified week,
  picks the next step, and handles questions the rules can't. Code checks every
  word before you see it; the rules remain the fallback. On-device or Claude.
- 🎯 **Personalized next step** — adapts to your one-tap check-in, your calendar
  (never mid-meeting), your routine, and **what you actually do** (your
  most-used activities are suggested first).
- 🎙️ **Speech-to-speech companion** — "Hey Daywell" (opt-in) → greeted by name, with
  voice personas (Companion, Coach, Calm guide) and a goal-reached chime.
- 📊 **Honest dashboard** — progress rings vs your goals **and** vs healthy-aging
  guidelines (WHO / CDC / NCCIH).
- 🔒 **Local-first & private** — browser `localStorage` only; no account, no server,
  no telemetry.

---

## The views

Every tab has its own URL (`#today`, `#history`, `#plan`, `#setup`), so back,
refresh, and bookmarks work. The message bar sits under all of them.

### Today
1. **Greeting** — "Good evening, Sasa" with one line on how your week is going
   (new users get a welcome, not a grade).
2. **First-run setup** (until done) — three one-tap steps: your name, WHO-aligned
   recommended goals, and a starter activity library.
3. **How are you feeling?** — one tap for mood, one for energy (emoji buttons); an
   optional note. Your own report, not an assessment.
4. **Do next** — one evidence-anchored step with its cited source and a **✓ I did
   it** button, shaped by your mood × energy check-in (shown on the card):
   - **Rest** (energy 1–2) → gentle and short (≤10 min); wind-down or mind first
   - **Lift** (mood 1–2, energy 3+) → an easy mood-lift (your music first, or a short walk)
   - **Push** (energy 4–5, mood 3+) → movement leads, up to ~45 min
   - **Steady** (otherwise) → a manageable step (≤20 min)

   Even when you're on track it adapts (unwind / lift your mood / optional bonus).
   The optional AI must follow the same rule — code rejects strenuous movement
   when you said you're drained.
5. **Day / Week / Month** — progress rings with a **goal for each period**, derived
   from your weekly goals: a day's goal is today's share (150 min/week → 20 min
   today, at least 1 session), a month's scales to its days. Plus healthy-aging
   guidelines (weekly), "what you've done" (incl. by voice), a mood sparkline,
   and a 🔊 recap of the selected period.

### History
What you logged on the selected day (with remove), sleep & resting heart rate, and
file import (Apple Health `export.xml`, movement JSON/CSV). Logging itself happens
in the message bar.

### Plan
Plan activities around your commitments; **recover** when something can't happen
(rain → indoor option in a real free window; a missed session → an anytime
fallback).

### Setup
**About you** (name, age, routine, region for support lines), **Voice** (persona,
"Hey Daywell", goal chime), **weekly goals** (with a one-tap recommended
option), **activity library** (with starter activities), **work calendar
(`.ics`)**, **Apple Health** recipe, **reminders**, and **export / import /
delete**.

---

## Voice companion

Enable **"Hey Daywell"** (opt-in) and talk hands-free, or tap **Start voice mode**.

```
You:     Hey Daywell
Daywell: Hey Sasa, how can I help?
You:     I just finished a 30 minute walk
Daywell: Nice one, Sasa — logged 30 minute walk, 30 minutes. Anything else?
You:     how's my week
Daywell: Nice — here's how this week looks. You logged 3 activities … 2 by voice.
         On tracking, 3 goals behind pace. You're meeting 1 of 4 healthy-aging
         guidelines.
You:     switch to day        →  re-reads today's recap
You:     what should I do next →  the time-aware, calendar-aware next step
You:     I'm feeling really anxious →  support + offer of guided breathing
You:     breathe with me      →  a spoken one-minute box-breathing session, then logs it
You:     am I depressed?      →  honest refusal to assess — points you to a professional
```

- **Rules first, AI second.** Every phrase goes through the deterministic intent
  engine (`ask.js`) in this order: **safety** (crisis → resources; distress →
  support) → **assessment boundary** → log an activity → stats → next step →
  summaries. Only phrases the rules can't handle go to the **optional AI** (if
  enabled) — never safety moments — and its reply is validated before it's spoken.
- **Wake word** (`WAKE_RE` in `app.js`) via the Web Speech API — best-effort and
  browser-dependent; keeps the mic open while enabled (disclosed).
- **Personas & TTS** — the browser's best available natural/neural voice, tuned per
  persona. Quality depends on the browser/OS.

---

## Safety layer

`safety.js` runs **before** any other interpretation of what you say or write:

| Your words signal | Daywell does |
| --- | --- |
| **Crisis** (self-harm, suicidal thoughts, hopelessness) | Warm, direct reply + the crisis line for your region (set in Setup, or auto-detected from the browser; unknown → findahelpline.com); a support card on every page; calm voice regardless of persona; goal nudges paused; crisis text is never filed as an "activity" |
| **Distress** (anxious, stressed, overwhelmed, can't sleep) | Support + an offer of guided breathing; a gentle support card |
| **A request to assess you** ("am I depressed?") | Honest refusal to diagnose, with a pointer to a professional |

Daywell is **not a crisis service** — its job here is to make sure you're pointed to
one, every time, instead of a "not sure on that one" fallback.

---

## AI layer (optional)

Daywell is **hybrid**: deterministic code computes every fact, and an LLM — if you
turn it on in **Setup → AI assistant** — interprets those facts.

| Step | Who does it |
| --- | --- |
| Count minutes, sessions, pace; check guidelines; read your check-in | **Code** (`analyze.js`) |
| Safety: crisis / distress detection, crisis lines, support card | **Code only** — never the model |
| A short read on your week + one next step (+ up to two more) | **LLM** (`llm.js`), from the verified facts |
| Open-ended questions the rules can't answer; messy multi-activity logs | **LLM**, with proposed log entries |
| Accept or reject everything the LLM returns | **Code** — real saved-activity ids only, provided sources only, length limits, and no diagnosis / condition / medication / biological-age language |
| If the LLM is off, slow, offline, or fails a check | **Code** — the rule-based result, so the app always works |

**Providers.** *On-device* (the browser's built-in model, e.g. Chrome's built-in AI —
nothing leaves the device) or *Claude* (Anthropic API with **your own key**, stored
only in this browser; default model Claude Opus 5.5, with Sonnet 5.5 and Haiku 4.5
as faster options).

**What the model sees:** goal progress, guideline status, today's mood/energy
numbers, your saved activity titles, and recent activity titles — never your name,
age, region, check-in notes, or heart rate. Setup shows the exact payload. The
standard rule-based suggestion stays visible next to the AI's for comparison.

---

## How Daywell decides (the "science")

`analyze.js` is deterministic and honest. For the current week it compares your
logged behavior to:

1. **Your own goals** — movement minutes/sessions and mind sessions you set. "Pace"
   = progress relative to how far into the week you are, so *behind* means behind
   *your* schedule, never a health judgment.
2. **Healthy-aging guidelines** — general population guidance *associated with*
   healthy aging, independent of your goals:
   - Active minutes — **WHO** 150–300/week
   - Strength days — **WHO** 2+/week (best-effort, detected from your log text)
   - Sleep — **CDC / AASM** 7+ h/night
   - Stress-reduction practice — **US NCCIH**

The furthest-behind item becomes your **next step**, carrying its cited source —
then it's **personalized to today**:

- **Your check-in** — low self-reported energy or mood → gentler options lead (low
  mood surfaces your own music/mood-lift activity); good energy → movement leads.
  The reason is stated ("You said your energy is low today, so I've kept this
  gentle"). This uses your own report — it never infers your state.
- **Your calendar** — no activity prompts during an imported commitment ("You're in
  Board meeting until 14:00 — I'll hold suggestions till then").
- **Your routine** — time-of-day triggers (move in the morning, wind down at night).
Guideline text lives in [`src/planner/evidence.js`](src/planner/evidence.js).

> This is general guidance matched to your own goals — **not** medical advice, a
> diagnosis, a personalized risk prediction, or a biological-age estimate.

---

## Integrations — the honest reality

| Integration | How it works today | The catch |
| --- | --- | --- |
| **Apple Health** | Setup includes an **iOS Shortcut recipe** to auto-export on a schedule; you import that file under Log | No browser API for live reads; truly seamless sync needs a **native iOS app** |
| **Google Calendar** | **`.ics` file import** (local-first, no sign-in) → protected commitments | Live auto-sync would need a backend + OAuth |
| **Voice input (STT)** | Browser Web Speech API | May send audio to the browser's online service; browser-dependent. Disclosed at the mic |
| **Voice output (TTS)** | Browser SpeechSynthesis, best natural voice | Quality varies by OS/browser; premium/consistent voice needs native |
| **Reminders** | Local notification when you open the app if you're off pace | A web page can't do reliable background push; that's a native-app capability |
| **AI (optional)** | On-device browser model, or Claude with your own API key | Claude sends minimal facts to Anthropic (disclosed, previewable); on-device needs a browser with a built-in model |
| **Biological age** | *Not computed, ever* | Requires lab biomarkers / DNA-methylation testing, not activity logs |

---

## Run / test

```bash
cd "daywell"
python3 -m http.server 4173     # open http://localhost:4173  (hard-refresh: Cmd+Shift+R)
npm test                        # unit tests: node --test tests/*.test.js — 100 cases
npm run smoke                   # headless-Chrome smoke test of the real UI (needs Chrome)
```

No build step, no dependencies — plain ES modules, vanilla JS, one CSS file.

---

## Architecture

Composable, mostly-pure modules with a thin DOM controller. Business logic is
deterministic and unit-tested; the UI and browser APIs (speech, audio,
notifications) are thin, feature-detected wrappers.

| Area | File |
| --- | --- |
| App state + validation / migration | `src/planner/state.js` |
| Goals, progress, summaries, plan-match | `src/planner/goals.js` |
| Analytical engine (rings, guidelines, next step) | `src/planner/analyze.js` |
| Proactive nudges + time-of-day triggers | `src/planner/nudges.js` |
| Recap ("what you've done", spoken) | `src/planner/recap.js` |
| Safety layer (crisis / distress / region lines / breathing) | `src/planner/safety.js` |
| First-run setup, starter library, recommended goals | `src/planner/onboarding.js` |
| Optional LLM layer (context, prompts, providers, validation) | `src/planner/llm.js` |
| UI smoke test (headless Chrome) | `tests/smoke/run.mjs` |
| Voice Q&A / command intent (deterministic) | `src/planner/ask.js` |
| Voice personas (characters) | `src/planner/persona.js` |
| On-device text/voice parsing | `src/planner/parse.js` |
| Activity suggestion (by category) | `src/planner/match.js` |
| Contingency / recovery | `src/planner/recovery.js` |
| Upload parsing (JSON / CSV / Apple Health) | `src/planner/ingest.js` |
| Cited healthy-aging guidance | `src/planner/evidence.js` |
| Voice capture (browser STT) | `src/planner/voice.js` |
| UI controller (TTS, Web Audio chime, views) | `src/planner/app.js` |
| Calendar `.ics` connector | `src/connectors.js`, `src/skills/ics.js` |
| Time-feasibility supervisor | `src/supervisor.js` |
| Safe DOM / time helpers | `src/dom.js`, `src/time.js` |

Product requirements and the evaluation that shaped these boundaries are in
[`docs/`](docs/). The pinned release manifest is [`RELEASE.json`](RELEASE.json).

---

## Privacy & boundaries

- **Your data never leaves the device** — except what the browser's speech service
  may do for voice input, and the minimal facts sent to Claude *if* you enable it
  with your own key (both disclosed). No account, server, or analytics.
- **No health claims** — no diagnosis, disease-risk prediction, biological age,
  calorie/nutrition math, or mental-health inference. Health-judgment questions get
  an honest refusal and a pointer to a qualified professional.
- **Not a crisis service** — crisis language always surfaces crisis lines first.
- Export/import is a **backup**, not a sync. Deleting clears this device only.
