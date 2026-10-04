# Daywell Product Requirements Document

Version: 2.2 | Reviewed: October 4, 2026 | Status: specification for validation and native alpha

This replaces the accumulated draft. The [QA report](PRD_QA.md) records the critique and its disposition. Requirements describe intended behavior unless the current-build inventory explicitly says it exists. Quantitative targets are proposed acceptance criteria, not measured results.

## 1. Product Decision

Daywell helps busy professionals keep chosen meal and movement routines achievable when their work schedules change. Its main experience is a daily calendar showing commitments, planned meals, movement, completed activities, and one useful next action.

The core problem is the effort of adapting intentions to reality: deciding what to eat, what activity still fits, and what to defer after a late meeting, travel, unexpected dinner, missing groceries, or a low-capacity day.

The product hypothesis is that reducing this repeated decision effort will help users sustain routines across weeks. Competitive advantage and behavior improvement remain unproven.

The intended core price is $0. Useful planning must work on an existing supported phone without a wearable, another paid app, a model subscription, or a biological-age test.

Support one personal workspace across laptop and phone: plan the week on the laptop, record meals or changes on the phone, and continue on either device. Assume Mac and iPhone for the first native release, based on the current environment; confirm before implementation. Both devices must support independent manual/rule-based planning offline. Qualified local AI must not require the laptop to remain running.

## 2. User and Outcome

The initial audience is adults with frequently changing work calendars who want practical meal and movement support. Recruit users who experience at least two schedule disruptions in a typical week; this is an initial screening choice, not a population statistic. Include people with and without wearables.

The user selects one weekly health behavior goal and one work priority or protected work window. Career support initially means respecting those commitments when planning health actions. Calendar activity does not establish career success, productivity, or work quality.

Example: a user chooses three movement sessions this week, saves a short walk as a fallback, and protects a deadline work block. A meeting runs late. Daywell offers a saved quick dinner and either a shorter activity or a different feasible window, without moving the protected work block.

Success means the user can choose and complete a feasible action with less planning effort. Health outcomes, biological-age changes, and career advancement are outside the initial evaluation.

## 3. Current Build Inventory

Source inspected: `index.html`, `app.js`, and `README.md` in this project.

| Capability | What exists today | What remains |
| --- | --- | --- |
| Daily calendar | Sample schedule, manual additions, local clock marker | Dated events with durations, real calendar reads, conflicts, edits, and time-zone handling |
| Plan suggestions | Preset meal, movement, and preparation cards chosen by capacity slider | Preference filtering, interpretation of inputs, feasible alternatives, and individualized ranking |
| Disruption flow | Buttons display preset responses | Responses that update actual plan state and re-check availability |
| Progress | Two manual completion toggles persisted locally | User-selected weekly goals, dated history, and separate full/fallback progress |
| Typed and voice input | Notes and browser transcripts saved and displayed as context | Structured meal/activity records, corrections, semantic extraction, and verified local speech |
| Health-file input | Local streaming scan detects names of possible signal types | Parsing values, units, dates, sources, deduplication, and use in planning |
| AI and integrations | No model inference, HealthKit, EventKit, or external calendar writes | Native integration and qualified local models |
| Food photos and meal plans | No photo capture or real weekly meal/grocery planner | Capture, editable descriptions, saved meals, weekly plan, and grocery list |
| Storage and privacy | Browser localStorage; selected health file is scanned locally | Native protected storage, retention controls, export, and privacy verification |
| Laptop and phone | Browser demo with separate device/origin-local storage | Installation on both devices, pairing, shared records, offline reconciliation, and secure sync |

Saved notes, transcripts, detected health types, and schedule entries do not currently determine the preset plan. Browser speech can use remote recognition services; the prototype does not enforce local recognition. External fonts also make network requests. Do not describe this demo as fully offline, encrypted, or a working health-data integration. [Browser speech documentation][web-speech]

## 4. Evidence and Competitive Position

Healthy eating and physical activity contribute to health. WHO states that some physical activity is better than none. This supports offering feasible smaller actions, but does not establish that a ten-minute fallback equals a full workout, or that sleep, food, and activity are interchangeable credits. [WHO activity guidance][who-activity], [WHO healthy diet][who-diet]

Digital lifestyle interventions have shown average behavior improvements across trials. Those results support testing Daywell, not claiming that this app is effective before evaluation. [Lifestyle-intervention evidence][digital-review]

Biological-age methods measure different constructs. In the CALERIE analysis, an intervention affected DunedinPACE but did not significantly change the other tested age clocks. That result does not establish that Daywell can reduce a personal score from 33 to 28. [CALERIE trial analysis][calerie]

### Market overlap

Capabilities below are documented by vendors, not independently tested in this review. Availability can vary by device, account, and region. An unmentioned capability is not proof a competitor lacks it.

| Product | Documented overlap | Implication |
| --- | --- | --- |
| Meta Muse | Health-app connections, adaptive training, recipes, approved ingredient ordering, and calendar-related tools | Broad health-agent integration is already marketed; Daywell must demonstrate a better specific workflow |
| Reclaim | Scheduling lunch/exercise habits and automatically moving overbooked habits | Moving a health block alone is insufficient differentiation |
| Oura Meals and Advisor | Photo/text meal logging, meal timing, and personalized suggestions | Photo capture and wearable-informed suggestions alone are insufficient differentiation |
| Mealime | Preferences, weekly or just-in-time meal plans, recipes, grocery lists | A generic recipe planner is insufficient differentiation |
| Apple Watch and WHOOP | Activity/health tracking and coaching; WHOOP also offers an age-branded metric | Sensor dashboards and general coaching are already crowded |
| OpenAI Dot | Persistent context, connected apps, recurring work, and action rules | Generic memory, reminders, and cross-app assistance are available alternatives |
| Wajo Fo | Real-world tasks, food ordering, coordination, and scheduling | Task execution and low price are not unique advantages |

Sources: [Muse][muse], [Reclaim][reclaim], [Oura][oura], [Mealime][mealime], [Apple][apple-watch], [WHOOP][whoop], [Dot][dot], [Fo][fo].

Daywell's proposed advantage is the combination of changing the content and timing of a plan, using saved foods and explicitly reported capacity, keeping interaction short, and preserving a user's weekly goal. For example, it can replace an unavailable cooking plan with a saved meal while offering a smaller movement option. This combination is a hypothesis, not an established market gap or durable moat.

Personalization can improve through user-controlled preferences, accepted alternatives, and correction history. It does not require training on sensitive user data. Validate that people prefer the experience over their existing calendar, saved meals, and current assistants before expanding integrations.

## 5. Requirements

### R01. Onboarding and weekly goals

Let users start without permissions. Collect one weekly behavior goal, a user-defined full action, a smaller fallback, typical available windows, and one protected work priority/window. Examples include planned lunches on four workdays or three preferred movement sessions.

Meal planning and recording remain available regardless of the chosen goal. Do not require exhaustive meal or activity logging.

Offer a small starter library and allow saved personal options. Capture food preferences, available equipment, approximate preparation time, budget preference, and user-declared restrictions. Dollar amounts are user estimates unless supplied by a verified source.

Acceptance: a user can create a goal, save a fallback meal, and generate a first manual plan without a wearable, account, or external subscription.

### R02. Calendar and today view

Show date, time zone, current-time marker, work commitments, meals, movement, preparation blocks, and completed records. Distinguish planned, proposed, completed, deferred, and unknown states visually and in accessible labels.

Every proposed block includes start, end, preparation/transition time where relevant, and a reason it fits. Do not treat an apparently empty calendar as proof the person is available; honor working hours, buffers, and user constraints.

Display one recommended next action. At most two additional actions appear as optional. The user can dismiss, defer, edit, or choose a smaller alternative.

Acceptance: no proposed block overlaps a hard commitment in the current permitted snapshot, violates a protected window, or appears on the wrong date after travel/time-zone changes.

### R03. Meal plans and grocery lists

Propose three to five anchor meals for a week with saved alternatives for late meetings, travel, social meals, and no-grocery days. Use reviewed templates or the user's saved recipes.

Filter using explicit ingredients and user-declared restrictions before model ranking. Never certify a restaurant meal or photo as allergen-free. Unknown ingredients remain unknown. Users verify packaging or supplier information where needed.

Generate a concise grocery list, subtract items the user marks as available, and update it after an accepted swap. Offer a preparation block only when it fits. Calendar presence does not establish attendance or food consumption.

Acceptance: replacing one anchor meal changes its grocery requirements without losing the user's other meals or undoing checked items unnecessarily.

### R04. Meal and activity records

Support typing and quick selections first, then voice and photos after their quality gates pass. Store event time separately from capture time. A user can record a past meal, a completed activity, a preference, or a disruption.

Voice returns an editable transcript and proposed structured entry. Handle negation, corrections, mixed activities, and ambiguous times. Ask one focused question if the ambiguity materially changes the record or recommendation.

Food photos produce an editable coarse description. Do not infer exact portions, calories, hidden ingredients, nutrient adequacy, or dietary safety from the photo. For reversible ordinary records, show a saved draft with edit/undo instead of repeated confirmation dialogs. Unconfirmed inferences cannot establish restrictions or completed-goal credit.

Acceptance: users can correct the description/time and undo a save without restarting. A failed image or speech task preserves the draft and offers text/quick selection.

### R05. Last-minute adaptation

Triggers are a user-reported disruption, an observed change in the permitted schedule while the app runs, or a refreshed snapshot. Do not promise detection of every change while the app is closed.

Recompute affected options and present one next action plus a fallback. Preserve unaffected accepted plan items. Offer scaling down, changing content, moving a flexible block, or deferring; never automatically cancel work.

Record whether the user accepted, edited, dismissed, completed, or deferred the alternative. A suggestion is not an executed change; an accepted plan is not a completed behavior.

Acceptance: a late meeting genuinely changes the proposed plan and availability check, rather than only displaying new text. No-feasible-slot cases offer a non-scheduled fallback or defer option.

### R06. Health context

The first native release requests only optional steps, workout records, and sleep data for enabled features. Use activity to summarize recorded behavior, not to prescribe exertion. Short sleep may support a lower-effort option, but explicit user capacity and preferences take precedence.

Preserve units, date/time zone, source, observation time, and freshness. Avoid double-counting overlapping sources, sleep stages, workouts, and manual records. Missing or stale readings remain unknown.

HealthKit does not reveal whether read access was denied for a type; empty results must not be labeled as refusal or inactivity. [HealthKit authorization][healthkit]

Heart-rate variability, oxygen saturation, respiratory rate, mobility, and cardio-fitness interpretation are deferred until a specific benefit and qualified interpretation are established. GPS routes and mental-health assessments are outside the planning pipeline.

Acceptance: the same useful planning flow works without wearable data. An empty health query never creates an adverse health inference.

### R07. Calendar actions and career constraints

For v1, add or move only Daywell-created personal blocks that have no attendees. Cancel such a block only after a specific confirmation. Other commitments are protected by default.

Flow: suggest the exact change, preview details, obtain approval, re-read availability and target event, execute, verify the saved state, and report the result. If the event or constraints changed, obtain a fresh approval. Prevent duplicate writes after retries. User-requested undo must check the current event state first.

Reading calendar availability through EventKit requires full event access on supported iOS versions. Choosing calendars inside Daywell is an app-level filter, not an OS grant limited to those calendars. Explain this accurately. Without read permission, support manual planning and user-mediated event creation through EventKit UI. [Calendar access][eventkit]

Meeting declines, attendee messages, organized meetings, recurring-series changes, purchases, and account-wide cancellation are deferred. The user can view suggestions for these situations, but v1 does not execute them.

Acceptance: no calendar mutation without an approval tied to that exact current action. Changing a calendar event is never credited as completion of a health action or career goal.

### R08. Progress across weeks

Show full actions, fallback actions, deferred actions, and unknown outcomes separately. Users define whether a fallback contributes to a specific goal; do not equate a short walk with a full session by default.

Show remaining goal opportunities using current time windows, with clear uncertainty. If the target is no longer feasible, offer to revise it. Do not prescribe catch-up restriction, extra exercise, or compressed recovery.

The weekly review asks what worked, what caused friction, and whether the goal should change. No streak punishment, health-debt meter, or combined career/health score.

Acceptance: a fallback preserves continuity without falsely claiming the full target was reached.

## 6. Three Agent Roles and Execution

These are logical responsibilities; they can share models and run sequentially. All essential permission, scheduling, arithmetic, constraint, and execution checks are ordinary code.

| Role | Inputs and outputs | Candidate execution |
| --- | --- | --- |
| Retrieval/context | Permitted records -> relevant facts with source, time, and missing-data status | Direct queries first; Qwen3 1.7B only for query interpretation/classification if needed |
| Analysis/recommendation | Compact context plus feasible approved options -> one ranked next action and fallback | Compare Gemma 4 E4B against E2B on real tasks/devices |
| Voice/image capture | User audio/photo -> editable transcript or food/activity draft | Qualified local speech; evaluate Qwen3-ASR if needed; Gemma for vision |

Gemma 4 E2B/E4B support text, image, and audio and are Apache 2.0 licensed. Qwen3 1.7B and Qwen3-ASR-0.6B also list Apache 2.0. This confirms candidate modalities and licenses, not Daywell accuracy. Preserve notices and verify the exact redistributed artifact and runtime licenses. [Gemma][gemma-card], [Qwen text][qwen-text], [Qwen speech][qwen-speech]

E2B/E4B labels describe effective parameters, not the full stored model. Actual memory varies with artifact, runtime, context, and image/audio processing. Do not assume every phone can run E4B. Qualification uses the intended mobile build, not desktop benchmarks. [Deployment guidance][gemma-memory]

### R09. Model routing and verification

Use the smallest qualified execution path for each task. A larger model must improve task results sufficiently to justify its device cost. An E2B or manual fallback must pass its own relevant checks.

Capture -> normalize and mark inference status -> retrieve current context -> filter feasible options in code -> rank/explain -> verify output -> display -> separately approve any external action.

Only pass needed context, not the entire health export, calendar history, or recording. Imported text and model output cannot override instructions or authorize tools. Models propose structured fields and option IDs; they cannot directly execute calendar calls.

On invalid output, use at most one bounded retry, then quick choices/manual entry. Do not rely on a model's self-reported confidence. Reuse models, unload unused components, bound context/output, and avoid continual background inference.

#### Sierra-inspired architecture and development lifecycle

Sierra describes modular tasks, task-specific model evaluations, supervisory checks, release snapshots, reviewed feedback, and simulated regression tests. Daywell adopts these engineering principles, not Sierra's proprietary Agent OS/SDK or its customer-service performance claims. The requirements below are Daywell-specific adaptations for local computation, personal data, and controlled calendar actions. [Sierra architecture][sierra-models], [Sierra lifecycle][sierra-lifecycle]

**Composable skills and a code supervisor.** Define each skill with a goal, typed inputs/outputs, allowed data/tools, preconditions, postconditions, time/resource limits, and failure/undo behavior. Initial skills are capture record, retrieve context, propose meals, adapt a day, propose a calendar edit, execute an approved edit, and summarize progress. These are modules, not seven separate model processes. A shared code supervisor validates schemas, constraints, freshness, and approval before dispatch. Any optional model-based reviewer is advisory; it cannot grant permission or override a rejected check.

**Task routing and graceful degradation.** Qualify routes by task, language, device, latency, and memory, not model size alone. On timeout, invalid output, or resource failure, use the existing bounded retry budget and then a separately qualified smaller/local path or manual choices. Never fall back to weaker permission checks or silently send content to cloud AI. Record the route and failure category. No automatic model upgrades without the release tests below.

**Immutable release manifests and rollback.** Give each agent release an immutable ID covering app/code revision, model artifact hashes and licenses, runtime/tokenizer versions, prompts, skill and policy versions, curated content/templates, record/sync schemas, and test results. Keep an identifiable last-known-good compatible release. Personal health records, live calendar data, and user preferences remain mutable private records, not part of a public release snapshot. Validate updates before activation. Roll back a compatible behavior bundle or disable the failing skill through platform-permitted mechanisms; do not load arbitrary executable code. Never revert user records, silently undo completed calendar actions, or restore superseded permissions/security policies. If schema compatibility fails, preserve data and use the manual path rather than forcing a downgrade. Laptop and phone record their active release IDs; incompatible sync schema versions pause affected edits and explain the needed update.

**Local observability and structured feedback.** Store a bounded device-local decision log: release/skill/route IDs, source-record references and freshness, applied checks, selected option IDs, timings, error codes, approval/execution status, and user corrections. Record observable decisions, not hidden model reasoning or raw media. Default content-bearing diagnostics to seven-day retention with user deletion/export controls; retain only non-content aggregate counters longer. Diagnostics do not sync by default and are excluded from sensitive cloud backups. Track extraction corrections, invalid outputs, timeouts, fallbacks, p95 latency, and verified action failures by task/device. Show saved, proposed, approved, executed, and user-reported completed outcomes separately. Any diagnostic sharing requires a preview, redaction, and specific consent.

**Feedback -> simulation -> regression -> release.** Let users report wrong facts, timing, preference fit, or action outcomes without writing a full conversation. The release owner reviews consented/redacted failures and synthetic scenarios weekly during the pilot and before each release. Convert confirmed failures into fixtures with expected state assertions and mock calendar/health/sync adapters. Re-run held-out quality checks and the accumulated regression suite for every model, prompt, policy, template, or runtime change, including multi-turn corrections and interruptions. An unauthorized write or permission bypass blocks release and disables the affected executor when observed; repeated quality/latency breaches trigger route review or manual fallback. Record the issue owner, fix, test, and release disposition. Do not promise that finite tests prevent every recurrence or establish medical safety.

## 7. Privacy, Platform, and Cost

### R10. Native platforms, synchronization, and privacy

Build Mac and iPhone clients in SwiftUI with shared domain logic, protected device-local storage, and platform-specific integrations. Use HealthKit on supported phones, EventKit/EventKitUI where supported, qualified local Speech, and local notifications. HealthKit cannot read/write health data on macOS; the Mac must not claim a direct Apple Health connection. Google/Outlook accounts already available in the device event store may work through EventKit; direct APIs and other wearable/meal-app adapters need separate qualification. [HealthKit availability][healthkit-platform]

#### One workspace, two devices

The laptop emphasizes weekly planning, calendar review, meals/groceries, and progress. The phone emphasizes quick voice/text/photo capture, today's next action, and changes while away. Both can edit shared app plans, goals, preferences, meal/activity records, and completion history. Each device saves locally first and visibly distinguishes saved-on-device, pending-sync, synced, offline, and failed states, with a last-sync timestamp.

Recommend opt-in end-to-end encrypted synchronization through a small non-iCloud relay for use across different networks. Encrypt record content on the client using a reviewed cryptographic library; the relay transports/stores ciphertext rather than running models or reading health content. Disclose remaining metadata such as connection times and payload sizes. This is a design requirement, not a verified security or compliance claim. Do not require the laptop to act as an always-on server.

Nearby paired-device transfer is a possible earlier milestone, not a substitute for away-from-home sync. Transport choice must be qualified against current platform support. Nearby sessions and iOS background work have limitations; do not promise continuous or instantaneous synchronization. [Nearby transport limitations][nearby-sync], [Background execution][background]

Keep raw HealthKit samples and raw audio/photos out of the initial sync payload. User-approved minimal activity/sleep summaries may be included only after permission, purpose, retention, and platform-policy review. Mark their source and measurement time; a laptop with no fresh summary still works and displays unknown rather than inventing health context. Treat meal logs, health goals, and derived summaries as sensitive even if they did not originate in HealthKit.

Do not use CloudKit/iCloud to store the app's personal health information. Apple's App Review guideline 5.1.3(ii) prohibits this; encryption alone is not an exception. This restriction is on this app's storage, not a claim that Apple's own Health service cannot synchronize health data. Qualify backup exclusions for sensitive app records as well as caches. [Apple review guidelines][apple-review]

Pair devices with user-confirmed authenticated enrollment; do not trust a device name alone. Define device revocation, key rotation, and a user-held recovery method before shipping remote sync. Explain that losing all enrolled devices and the recovery secret can make encrypted records unrecoverable. Local-only use remains available without creating a sync account.

Each record needs a stable ID, revision, origin device, event time, and a persistent offline outbox. Deduplicate retried uploads. Preserve conflicting edits for resolution rather than silently losing a meal entry, goal change, or deletion. Propagate deletion markers and prevent an old offline device from resurrecting deleted records. Show pending deletion on disconnected devices; do not claim immediate erasure of unreachable copies or removal from devices that were already compromised.

External calendars remain authoritative in their existing provider; sync app plan state rather than replicating an entire calendar database. Provider event identifiers may be device-specific, so event matching needs qualification. Calendar permission remains local to each device. A synced proposed action is not execution permission: only the approving device may execute that version after re-reading its calendar. Persist action IDs and execution status; other devices must never execute the same action independently. Ambiguous interrupted writes require reconciliation before retry, not a blind duplicate.

Acceptance: create a meal plan on Mac, record a meal on iPhone, then see the same confirmed state on Mac after a successful sync. Repeat with the laptop off during phone use, disconnected devices, concurrent edits, retries, revoked devices, recovery, and deletion. Never label pending changes as synchronized or report a calendar edit as complete without verification.

Permissions are optional and requested when useful. Restrict calendar queries to selected calendars and a short planning horizon. Retain minimal metadata for display and verified edits; exclude titles/attendees from model context unless explicitly needed.

Require supported on-device speech and fall back to typing if unavailable. No silent remote transcription. Discard raw audio and the app's working copy of photos after extraction by default. Saving a photo to the user's photo library is a separate choice. [Local speech support][local-speech]

Provide export/delete for local records, source disconnect, and a separate choice to remove previously imported data. Specify and test file protection, key handling where needed, backup exclusions for sensitive caches, and protection when the device is locked. Do not describe browser localStorage as equivalent to native protected storage.

Use synthetic/redacted cases for evaluation and demonstrations. Sharing a real trace requires specific consent. No personal health/calendar data in public repositories, advertising, or model training. Product analytics default to local counters, with optional sharing of non-content aggregates.

iOS controls background execution. Refresh when opened and use supported opportunistic updates; show the last refresh time. Local reminders are planned ahead and are not guaranteed live replanning. [Background execution][background]

### R11. Free core and operating budget

Target user price: $0 for local meal plans, records, one weekly goal, schedule adaptation, progress, manual inputs, qualified voice/photo features, and supported native connections. No required wearable, new phone, AI subscription, paid recipe feed, or external test.

Metered cloud AI, SMS, and paid data APIs are excluded from the core architecture. Optional remote synchronization permits a budgeted ciphertext relay, not cloud model inference. Device battery/storage/connectivity and optional model downloads still cost resources. Provide a no-model planning flow.

Target $0 user price for basic two-device sync during the founder-funded alpha. Keep payloads small; do not upload raw media or run a continuously hosted model. Measure storage, bandwidth, authentication, backup, monitoring, and support costs before selecting a service or promising a free allowance. Free provider tiers are not a lifetime funding plan. If the relay is unavailable or a budget limit is reached, preserve local use and pending changes and clearly disclose the sync interruption.

Apple's Developer Program currently costs $99/year in the US, with local terms and taxes potentially different. This is publishing overhead, not total cost. Engineering, support, review, testing devices, and distribution work need funding. [Apple membership][apple-program]

Free weights do not establish a sustainable free business. For the alpha, founder funding is an explicit assumption. Before public launch, demonstrate a maintenance budget funded by voluntary support, grants, or separately tested optional convenience services. Do not promise a lifetime free service or sell sensitive data to subsidize it.

Measure vendor spend and support hours per active user. Optional future paid services require explicit opt-in and spend limits; disabling them cannot break local planning.

## 8. Scope and Rollout

| Stage | Deliverable | Gate |
| --- | --- | --- |
| Existing web demo | Capacity-based presets, sample schedule, manual notes, health-type detection | Correct demo claims; do not call it a functioning AI health agent |
| First usable alpha | Dated timeline, goal/fallback state, saved meals, weekly meal/grocery plan, rule-based disruption flow, export/delete | Validate usability without AI or permissions |
| Native integrations | Qualified EventKit reads and approved writes; limited HealthKit context | Permission, freshness, time-zone, and retry checks pass |
| Two-device workspace | Mac/iPhone installation, shared app record schema, device pairing, offline reconciliation; nearby transfer may validate the schema first | Cross-device conflict, deletion, permission, and duplicate-action tests pass |
| Away-from-home sync | Opt-in encrypted non-iCloud relay; no dependence on a running laptop | Encryption/key recovery review, policy review, measured operating budget, and remote-sync tests pass |
| Local AI capture/recommendation | Three logical roles, editable voice/photo records, bounded model ranking | Task and device quality gates pass independently |
| Later expansion | External age-result journal, recipe/file imports, meal-app adapters, direct Google/Outlook, meeting-action drafts | Separate benefit, permission, and cost evidence |

These gates can progress in parallel where dependencies allow. A feature that fails qualification remains manual or disabled; other useful features can still ship.

Every stage containing model inference or external actions must also pass R09's release-manifest, regression, observability, and rollback gates. A staged pilot update must not automatically promote to all devices merely because it loads successfully.

### R12. Biological-age aspiration and health boundary

Preserve the user's motivation to improve long-term health. Defer external biological-age tracking from the alpha; if added, store provider, method, date, reported value, and the user's aspiration such as 33 to 28. Display recorded results, not a predicted trajectory.

Never calculate that goal from meal/calendar/wearable inputs, equate different clock methods, attribute a change to Daywell, or promise age reversal. Physiological age-branded scores exist, but that does not validate a Daywell measure. [WHOOP][whoop], [CALERIE][calerie]

No diagnosis, personalized disease-risk prediction, treatment, calorie-restriction program, nutrient adequacy claim, clinical exercise prescription, or mental-health inference. Requests needing medical judgment receive a brief explanation of the limit and help preparing user-chosen questions for a qualified professional. The product does not perform health triage.

## 9. Acceptance and QA Gates

The following thresholds are initial engineering targets. They are not measured performance or evidence of clinical safety. Evaluate every shipped model/runtime version and retain failures as regression cases.

| Area | Proposed pre-alpha acceptance |
| --- | --- |
| Retrieval | All seeded tests preserve source/time, units, missing-data status, and expected deduplication |
| Calendar | All tests for approval, conflicts, stale state, repeat taps/retries, midnight, DST, and time zones pass; zero unauthorized writes observed |
| Cross-device sync | Seeded offline/concurrent-edit/retry tests converge after connectivity returns; no silent record loss, resurrected deletions, or duplicated calendar actions; pending/failure states are visible |
| Sync security/recovery | Enrolled-device authentication, revocation/rotation, user-held recovery, relay outage, and deletion tests pass; captured relay payloads contain no plaintext personal content; raw HealthKit/media absent from sync |
| Constraint enforcement | No restricted option survives hard filters in the release suite; unknown ingredients never receive a safety assertion |
| Input extraction | At least 95% exact match on predefined critical fields for unambiguous test inputs; ambiguous inputs stay drafts or ask for clarification |
| Recommendation quality | At least 90% of a held-out scenario set judged feasible and relevant by two independent reviewers; disagreements reviewed |
| Unsupported claims | Zero observed invented health readings, medical/age promises, or claimed actions not actually executed in the release suite |
| Voice/photo usability | At least 90% of supported test entries saved with at most one correction; failed cases have a usable text path |
| Latency | Manual save p95 <= 1 second; warm model tasks p95 <= 10 seconds on each supported device; cold load measured separately |
| Cost/privacy/device | Zero application cloud-AI calls in core task traces; no unexpected personal-content egress; no out-of-memory failures across repeated supported-device scenarios |
| Agent lifecycle | Every tested decision identifies its release and skill; version/artifact mismatches are rejected; mock-adapter regressions pass; a deliberately failing skill can be disabled or compatibly rolled back without losing records or repeating external actions |
| Operational fallback | Injected timeout, malformed output, model-load/memory failure, and incompatible-device schema cases reach an explicit qualified/manual path; no cloud-AI escalation or weakened policy checks |
| Diagnostics | Required error/timing/status fields are present; retention, delete/export, redaction, and consent tests pass; no raw media, hidden reasoning, or personal content in shared aggregate telemetry |

Use at least 150 synthetic/redacted scenarios across retrieval, recommendation, and capture, including at least 30 ambiguous/adversarial cases. Report results by modality, language, device, and important subgroup; averages cannot hide a failing supported configuration. English is the first evaluation language. Qualify Thai or other languages separately before claiming support.

Test mixed dishes, lighting, background noise, accents, negation, denied/unavailable data, corrupted imports, double logging, no groceries, protected work, and no feasible time. Use exact state assertions where possible; human review covers suitability. These finite tests cannot prove the absence of all failures.

Release checklist: pin the manifest; run scenario/regression and device suites; review failures and subgroup breakdowns; verify mock external-action assertions; rehearse compatible rollback and data preservation; then approve the staged release. Retain the test report and release owner's decision. Changes to permissions or execution policy require their own review even if recommendation quality improves.

## 10. User Validation and Launch Decision

Start with five task-based usability sessions, then recruit 12-20 adults for a four-week feasibility pilot: one week using their existing calendar/saved-meal approach and three weeks with Daywell. Include manual-only and wearable users. Where participants use Reclaim or another assistant, compare against that workflow rather than claiming all calendars lack adaptation.

Pre-register each participant's goal, full action, fallback, and definition of a disrupted day. Ask for a short end-of-day outcome only when needed. Do not require full food diaries.

Primary metric: percentage of disrupted days with a user-confirmed chosen full or fallback action completed. Report full and fallback results separately. An unreported outcome is unknown; show missing-data rates rather than treating it as success. Record acceptance separately from completion.

Secondary metrics: median time to settle on an alternative, correction effort, weekly goal progress, perceived burden, and return after disruption. Guardrails: unwanted changes, excessive prompts, permission concerns, and support effort.

Proposed continuation criteria are a 15-percentage-point improvement from baseline on the primary metric, median replanning under one minute, and at least 70% of participants reporting lower effort without greater burden. These are product decision thresholds, not statistical or clinical proof. If data are too sparse or inconsistent, extend evaluation rather than declaring success.

No biological-age, weight, disease-risk, or career-outcome claims from this pilot. A small before/after pilot has selection, novelty, and time confounds. Run a larger controlled comparison before claiming causal improvement.

Proceed to broader beta only if the core workflow clears quality gates, users prefer it to existing alternatives, device costs are acceptable, and maintenance has funding. If users only value scheduling, consider an integration with existing calendar tools rather than building a broader standalone product.

## 11. Decisions Still Requiring Evidence

- Which devices/runtime artifacts support the desired model quality and latency?
- Does voice or photo capture reduce effort enough to justify download, storage, and correction costs?
- Does optional sleep/activity context improve decisions over calendar plus explicit check-ins?
- Which persona benefits most: high-meeting workers, frequent travelers, or variable-shift professionals?
- Will users choose this workflow over free assistants and existing habit schedulers?
- What funds ongoing support while the core remains free?
- Are Mac and iPhone the actual first devices, and which OS/hardware versions can be supported?
- What relay and recovery design meets the sync privacy requirements at a measured affordable cost? Public distribution needs a platform-policy review; it is not approved by this PRD.
- Is the working name Daywell available for the intended market? Brand clearance is not completed.

## Sources

Sources checked October 4, 2026. Platform and vendor documentation establishes described capability/terms; it does not validate Daywell outcomes. Proposed requirements and thresholds are product decisions.

[who-activity]: https://www.who.int/news-room/fact-sheets/detail/physical-activity
[who-diet]: https://www.who.int/news-room/fact-sheets/detail/healthy-diet
[digital-review]: https://pubmed.ncbi.nlm.nih.gov/38969775/
[calerie]: https://pubmed.ncbi.nlm.nih.gov/37118425/
[muse]: https://ai.meta.com/muse/fitness/
[reclaim]: https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines
[oura]: https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals
[mealime]: https://support.mealime.com/article/151-getting-started-guide
[apple-watch]: https://www.apple.com/newsroom/2025/06/watchos-26-delivers-more-personalized-ways-to-stay-active-and-connected/
[whoop]: https://support.whoop.com/s/article/Healthspan-WHOOP-Age-Pace-of-Aging-Guide?language=en_US
[dot]: https://help.openai.com/en/articles/20001530-getting-started-with-your-dot
[fo]: https://wajo.ai/
[healthkit]: https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
[eventkit]: https://developer.apple.com/documentation/eventkit/accessing-the-event-store
[local-speech]: https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition
[web-speech]: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
[background]: https://developer.apple.com/documentation/BackgroundTasks/choosing-background-strategies-for-your-app
[gemma-card]: https://ai.google.dev/gemma/docs/core/model_card_4
[gemma-memory]: https://ai.google.dev/gemma/docs/core
[qwen-text]: https://huggingface.co/Qwen/Qwen3-1.7B
[qwen-speech]: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
[sierra-models]: https://sierra.ai/blog/constellation-of-models
[sierra-lifecycle]: https://sierra.ai/blog/agent-development-life-cycle
[apple-program]: https://developer.apple.com/programs/
[healthkit-platform]: https://developer.apple.com/documentation/healthkit/hkhealthstore/ishealthdataavailable()
[apple-review]: https://developer.apple.com/app-store/review/guidelines/
[nearby-sync]: https://developer.apple.com/documentation/multipeerconnectivity
