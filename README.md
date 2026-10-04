# Daywell — Personal Wellbeing Assistant (v7)

A local-first, non-work personal assistant for your **physical and mental**
wellbeing that fits your busy schedule. Activities span **movement, meditation,
wind-down, and music/mood**. A quick daily **check-in** (mood + energy) drives
**what-would-help-right-now** suggestions, drawn from your own saved activities
and your schedule. Everything stays in your browser on your device.

> It does **not** diagnose, score your health, or infer a mental state. It
> echoes *your* self-report and suggests activities *you* chose.

## The four views

- **Today** — a quick mood/energy **check-in**; **"what would help right now"**
  (suggestions from your own activities, matched to your check-in, schedule, and
  goals); a **wellbeing summary** (physical + mental) by day/week/month; and a
  today-vs-plan match.
- **Log** — record what you did (movement / meditation / wind-down / music) via
  **text**, **voice** (browser speech recognition — disclosed), or **file
  upload** (movement data: JSON, CSV, or Apple Health `export.xml`).
- **Plan** — plan activities around your commitments and recover when something
  can't happen (rain → indoor options placed in a real free window; a missed
  meditation → an anytime fallback).
- **Setup & Goals** — set weekly goals (movement sessions + minutes, mind
  sessions), manage your activity library, import a Google Calendar `.ics`, and
  follow the Apple Health **low-friction import** recipe.

## Integrations — the honest reality

- **Apple Health** has no browser API, so a web app can't read it live. To avoid
  manual exporting, Setup includes an **iOS Shortcut recipe** that auto-exports
  on a schedule; you then import that file under Log (one "open file" step).
  Truly seamless sync would require a separate **native iOS app**.
- **Google Calendar** connects via **`.ics` file import** (local-first, no
  sign-in). Live auto-sync would need a backend + OAuth.
- **Voice** uses the browser's speech recognition, which may send audio to a
  provider and needs a connection — unlike the rest of the app. Disclosed at the
  mic and feature-detected.

## Run / test

```bash
cd "daywell"
python3 -m http.server 4173     # then open http://localhost:4173 (hard-refresh: Cmd+Shift+R)
npm test                        # node --test tests/*.test.js — 54 cases
```

## Modules

| Area | File |
| --- | --- |
| App state + validation/migration | src/planner/state.js |
| Goals, summaries, plan-match | src/planner/goals.js |
| Activity suggestion (by category) | src/planner/match.js |
| Check-in assistant ("what helps now") | src/planner/assistant.js |
| Contingency / recovery | src/planner/recovery.js |
| Upload parsing (JSON/CSV/Apple Health) | src/planner/ingest.js |
| Voice capture (browser STT) | src/planner/voice.js |
| UI controller | src/planner/app.js |
| Time-feasibility supervisor | src/supervisor.js |
| Calendar .ics connector | src/skills/ics.js, src/connectors.js |

## Boundaries

Local storage only; export/import is backup, not sync. No diagnosis, disease
risk, biological age, calorie/nutrition math, or any health claim. See
RELEASE.json for the pinned manifest.
