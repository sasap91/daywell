# Daywell — Personal Wellbeing Assistant

A **local-first** web app for your **physical and mental** wellbeing. You log what
you do (movement, meditation, wind-down, music/mood) by **text, voice, or file
import**; Daywell shows how your week is tracking against **your own goals** and
against **cited healthy-aging guidelines**, and gives you **one evidence-anchored
next step** — including through a hands-free **voice companion**.

Everything stays in your browser on your device. There is no account, no server,
no cloud AI.

> **What Daywell will never do:** diagnose you, score your health, infer a mental
> state, or estimate/claim a biological age. It reports *what you logged* and how
> it tracks against *goals you set* and *general cited guidance* — nothing more.
> These boundaries are enforced everywhere, including in voice mode. See
> [`docs/PRD_v2.2.md`](docs/PRD_v2.2.md) §R06 and §R12.

---

## Highlights

- 🛟 **Safety first** — if your own words (voice, check-in note, or log) signal
  crisis, Daywell stops everything else and shows crisis lines (US 988, Thailand
  1323, findahelpline.com) in a calm voice. Distress ("I'm so anxious") gets
  support, not a refusal.
- 🫁 **Guided breathing** — "breathe with me" (or one tap) runs a spoken one-minute
  box-breathing exercise and logs it. The agent *acts*, not just suggests.
- 🎙️ **Speech-to-speech voice companion** — say **"Hey Daywell"**, get greeted by
  name, then **log, summarize (day/week/month), and ask what to do next** — all by
  voice. Answers come only from your own data.
- 🎭 **Voice personas** — Companion, Coach, or Calm guide: each changes the wording
  *and* the speech delivery (rate/pitch).
- 🎉 **Goal-reached chime** — a short Web Audio fanfare plays when you cross a goal.
- 📊 **Analytical dashboard** — progress rings vs your goals **and** a second layer
  vs healthy-aging guidelines (WHO / CDC / NCCIH), with one prioritized next step.
- ⏰ **Time-of-day triggers** — nudges the right activity for the moment (move in the
  morning, wind down at night) from your stated routine.
- 🔒 **Local-first & private** — browser `localStorage` only; export/import is a
  backup, not a sync. No telemetry.

---

## The views

### Today
- **Talk to Daywell** — the voice companion (see below).
- **Check-in** — a 20-second mood + energy self-report (your words, not an
  assessment).
- **Your week** — a status line, three **progress rings** (movement minutes,
  movement sessions, mind sessions) vs *your goals*, a **"vs healthy-aging
  guidelines"** layer, a **mood sparkline**, a **🔊 Listen** recap readback, and a
  **"What you've done"** list showing which entries you logged by voice.
- **Do next** — one prioritized, **evidence-anchored** recommendation (with its
  cited source) plus actions to log or plan it.

### Log
- One seamless input for **text, voice, and manual** entry. Typing, tapping an
  example, or speaking all flow through the same on-device parse + confirm.
- **Deterministic parsing** (`parse.js`): categories by keyword, durations from
  digits *or* spelled-out numbers ("ten minutes", "half an hour"); stray numbers
  ("ran 5k") are deliberately **not** read as a duration.
- **File import**: movement JSON/CSV, or Apple Health `export.xml` (workouts +
  resting HR + sleep), filed by their own dates.

### Plan
- Plan activities around your commitments; **recover** when something can't happen
  (rain → indoor option in a real free window; a missed session → an anytime
  fallback).

### Setup
- **About you** — name, age, and **routine** times (wake / work / wind-down) that
  power the time-of-day triggers.
- **Voice persona & sound** — pick a persona, preview it, toggle the goal chime.
- **Weekly goals**, **activity library**, **work calendar (`.ics`)**, **Apple
  Health** import recipe, **reminders**, and **export / import / delete**.

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

- **Deterministic, on-device intent** (`ask.js`) — not an LLM. Order of precedence:
  **safety** (crisis → resources; distress → support) → **assessment boundary** →
  log an activity → stats → next step → summaries.
- **Wake word** (`WAKE_RE` in `app.js`) via the Web Speech API — best-effort and
  browser-dependent; keeps the mic open while enabled (disclosed).
- **Personas & TTS** — the browser's best available natural/neural voice, tuned per
  persona. Quality depends on the browser/OS.

---

## Safety layer

`safety.js` runs **before** any other interpretation of what you say or write:

| Your words signal | Daywell does |
| --- | --- |
| **Crisis** (self-harm, suicidal thoughts, hopelessness) | Warm, direct reply + crisis lines; a support card on every page; calm voice regardless of persona; goal nudges paused; crisis text is never filed as an "activity" |
| **Distress** (anxious, stressed, overwhelmed, can't sleep) | Support + an offer of guided breathing; a gentle support card |
| **A request to assess you** ("am I depressed?") | Honest refusal to diagnose, with a pointer to a professional |

Daywell is **not a crisis service** — its job here is to make sure you're pointed to
one, every time, instead of a "not sure on that one" fallback.

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
| **Biological age** | *Not computed, ever* | Requires lab biomarkers / DNA-methylation testing, not activity logs |

---

## Run / test

```bash
cd "daywell"
python3 -m http.server 4173     # open http://localhost:4173  (hard-refresh: Cmd+Shift+R)
npm test                        # node --test tests/*.test.js — 83 cases
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
| Safety layer (crisis / distress / guided breathing) | `src/planner/safety.js` |
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

- **Your data never leaves the device** (except what the browser's speech service
  may do for voice input, which is disclosed). No account, server, or analytics.
- **No health claims** — no diagnosis, disease-risk prediction, biological age,
  calorie/nutrition math, or mental-health inference. Health-judgment questions get
  an honest refusal and a pointer to a qualified professional.
- **Not a crisis service** — crisis language always surfaces crisis lines first.
- Export/import is a **backup**, not a sync. Deleting clears this device only.
