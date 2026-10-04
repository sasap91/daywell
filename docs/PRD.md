# Daywell PRD for Late Meeting Recovery

Version: 3.0 | Reviewed: October 4, 2026 | Status: focused MVP specification

This is the active specification. The [previous PRD](PRD_v2.2.md) preserves the broader vision but does not define first-release scope. The [QA report](PRD_QA.md) distinguishes historical findings from this revision. Requirements and numerical targets below are proposed, not implemented or measured.

## 1. One Pain Point

When a work meeting runs late and displaces a planned meal or exercise block, a busy professional has to reconsider the remaining day. Daywell helps them choose one practical replacement without moving their work commitments.

The initial pain hypothesis is that deciding what still fits takes more effort than the user has available at that moment. Validate this through observation and interviews; do not assume that everyone needs another planning app.

The job is: after a meeting overrun, help me decide what I can still do today and update that one plan.

This is a disruption-recovery tool, not an all-day health coach. Meals and movement are two kinds of affected block within the same workflow. Each recovery episode addresses one block, not a bundle of health tasks.

## 2. First User and Outcome

Start with adults who already plan meals or movement but experience work-meeting overruns at least twice a week. This frequency is a recruitment criterion, not a population estimate.

The user already knows their preferred action and acceptable smaller alternatives. Daywell does not need to generate health goals, diagnose their condition, or prescribe exercise.

The immediate outcome is an accepted feasible alternative in under one minute. The follow-up outcome is user-reported completion, recorded separately from acceptance. Health improvement and career success are not MVP outcomes.

Example: a 6:00-6:30 p.m. walk no longer fits because a meeting now ends at 6:20 p.m. The user has a protected commitment at 7:00 p.m. With user-entered ten-minute buffers before and after movement, the original walk no longer fits, but a saved ten-minute version at 6:30-6:40 does. The app proposes that smaller option, not a full walk that consumes the transition buffer. If the smaller option is impractical, the user can defer.

## 3. The Single Workflow

1. Before disruption, save today's relevant work blocks, one planned meal or movement block, and one or two acceptable alternatives.
2. Tap Meeting ran late and enter the revised meeting end time. Select the affected action if it is unclear.
3. Review one recommended replacement and at most one alternative, showing action, start/end, and the reason it fits.
4. Accept, edit, or defer. Acceptance updates the app's actual dated plan, not only a response message.
5. Later, mark the action completed, not completed, or leave the outcome unknown.

There is no required conversation, full food diary, wearable, or account. A small form and quick selections are the primary interface.

## 4. MVP Requirements

### R01. Save just enough context

Store the local date/time zone, relevant commitments with start/end times, one planned action, duration, latest acceptable finish, and user-entered transition/preparation buffers.

Save one or two fallback actions with their durations and availability conditions. For a meal, these can be a meal already prepared or a saved quick option. The user confirms availability; the app does not invent pantry inventory, restaurant hours, travel time, cost, or ingredients.

Work commitments are protected by default. Only user-designated flexible app blocks can move.

Acceptance: a user can prepare a test day and alternatives without permissions, a model download, or exhaustive onboarding.

### R02. Record the meeting overrun

A quick form captures the affected meeting and its revised end time. Show the resulting conflict with the selected planned action. Require a focused clarification when the affected block or time is ambiguous.

The MVP is user-triggered. It does not monitor a live calendar or claim to notice overruns while closed. A report that causes no conflict does not force a plan change.

Acceptance: the day state reflects the revised meeting time and identifies the actual affected block.

### R03. Compute a feasible replacement

Use ordinary code to find remaining user-confirmed windows and filter options by duration, buffers, finish deadline, availability, and protected commitments.

Try preserving the original action in a feasible later window, then offer a saved smaller or quicker alternative. Respect explicit user preference when choosing among feasible options. Explain which entered constraint determined the choice.

Reject overlaps and invalid times. An apparently empty calendar is not proof of availability. Ask the user to confirm the suggested window. If no valid option exists, show No workable option today and offer defer or edit; do not fill space with generic encouragement.

Meal suggestions use only user-saved options. Do not assert allergen safety, nutrition adequacy, or workout equivalence. Do not prescribe compensation for a missed action.

Acceptance: identical structured inputs produce the same feasible candidate set. Every recommendation references an actual option and window, not invented facts.

### R04. Apply only the chosen change

Preview the old and proposed action/time. Apply only after acceptance and re-check the current app plan. If another edit invalidates the proposal, recompute before applying.

Keep other blocks unchanged. Save revisions so undo can restore the previous affected block when still valid. Repeated taps must not create duplicate actions.

The MVP writes only to Daywell's internal schedule. It does not cancel meetings, contact attendees, purchase food, or write to an external calendar. Never describe an internal change as an external calendar update.

Acceptance: accept changes real plan state; dismiss leaves it unchanged; undo is visible and verified against current state.

### R05. Record the actual outcome

Offer a single completion control for the affected action. Distinguish accepted, full action completed, fallback completed, deferred, not completed, and unknown. Do not count acceptance or elapsed time as completion.

A smaller action does not receive full-action credit by default. Capture an optional reason such as still no time, unavailable option, or chose something else.

Acceptance: recorded results survive reload, preserve event date, and do not silently treat missing outcomes as success.

### R06. Protect records and keep failure recoverable

Save locally first. Validate persisted data and imports; recover gracefully from malformed storage. Safely render all user text. Provide export/delete and explain that exported files contain personal information.

Do not collect raw health exports, physiological data, mental-wellbeing files, food photos, or microphone recordings in this release. Remove or clearly disable the existing prototype's unrelated input affordances before the focused MVP ships.

Use bundled assets instead of external fonts. Verify offline behavior on supported browsers before claiming it. Browser storage is not equivalent to encrypted native health storage; use synthetic/redacted scenarios until the privacy and rendering checks pass.

Acceptance: core planning needs no external requests after initial assets are available; failed saves are visible rather than reported as saved. Deleting local records does not claim to delete exported copies.

## 5. Laptop and Phone Boundary

The first release is a responsive web app with the same workflow on laptop and phone. It is not a native Mac/iPhone app. Each device keeps its own local records.

Automatic shared state remains an explicit next milestone, not part of the three-hour MVP. Opening the same URL does not synchronize records; manual export/import is a transfer or backup, not seamless sync. The app must not present a Synced indicator without a real synchronization result.

Before remote sync ships, qualify encrypted transport/storage, authenticated device enrollment, offline outboxes, concurrent edits, deletion propagation, recovery/revocation, and measured relay cost. Preserve the health-data storage restrictions documented in the archived platform review if health integrations are ever introduced.

## 6. Sierra Inspired Engineering

Adapt Sierra's task modularity, deterministic guardrails, versioned releases, feedback review, and regression practice. This is not an integration with its proprietary platform or proof of health effectiveness. [Sierra architecture][sierra-models], [Sierra lifecycle][sierra-lifecycle]

| Practice | Requirement for this focused product |
| --- | --- |
| Composable skills | Separate context retrieval, feasible-option computation, explanation, apply/undo, and outcome recording; each has typed inputs, allowed operations, and expected state changes |
| Supervisor | Code checks time constraints, option IDs, proposal freshness, and acceptance; no model can bypass them |
| Right execution path | Direct queries and deterministic ranking first; no model is required for the MVP |
| Versioned release | Pin code, schema, rules/templates, and test results in a release manifest; include model/runtime/prompt hashes if AI is later added |
| Compatible rollback | Keep a known-good compatible behavior version or disable a failing skill; never erase records, repeat actions, or weaken current permissions |
| Feedback and regressions | Review timing/fact/preference corrections and turn confirmed failures into replayable synthetic fixtures before the next release |
| Local monitoring | Track latency, invalid proposals, save failures, retries, and corrections locally; content-bearing diagnostic records expire after seven days and are deletable; no silent trace uploads |

A later local model may interpret a disruption or explain already-valid options only after task/device testing shows lower effort than quick selections. It cannot determine calendar feasibility, invent health context, or execute changes. Invalid output gets at most one retry, then the structured form. Do not add AI solely to make the demo look agentic.

## 7. Scope and Build Order

| In the focused MVP | Deferred |
| --- | --- |
| One manually entered dated day and affected action | Weekly meal plans, grocery lists, broad daily coaching |
| Meeting-overrun form and saved alternatives | Other disruption types until this workflow is validated |
| Conflict-aware suggestions and accepted state changes | Live calendar reads, meeting cancellation, external writes |
| Outcome recording, undo, local persistence | Wearables, Apple Health, biological-age or disease-risk predictions |
| Responsive laptop/phone UI and backup/export | Native apps, secure automatic sync, voice/photo models |

For the three-hour build target: spend the first hour on the dated plan and saved alternatives, the second on the recovery/apply/undo workflow, and the third on outcome recording, mobile checks, regression tests, and deployment verification. This is a prioritization estimate, not a guarantee of production readiness. If time runs short, cut optional UI polish; do not replace real state changes with preset copy.

The current code has a visual starting point, local storage, preset cards, and manual schedule additions. It lacks dated durations, actual replanning, reversible proposals, and the required outcome state. It also has unsafe user-title interpolation and overstated voice/health-import copy. None is represented as fixed by this document revision.

## 8. Acceptance and User Validation

Before demonstration, run at least 20 synthetic state-based cases covering meeting overlap, transition buffers, protected work, no feasible slot, unavailable meals, midnight/date boundaries, edited stale proposals, repeated acceptance, undo conflicts, malformed storage, and literal rendering of malicious-looking titles.

All hard-constraint cases must pass. Verify no unaccepted plan mutation, no duplicate accepted block, and no invented completion. Test reload, storage failures, keyboard access, and laptop/phone layouts. Target manual-save p95 below one second on supported test devices; record measured results rather than assuming success.

Start with five observed usability sessions comparing recovery against the person's own calendar and saved alternatives. Proceed to a two-week feasibility pilot with ten meeting-heavy professionals only if setup and recovery are usable. These sample sizes are proposed learning stages, not statistical proof.

Primary product metric: median time from reporting an overrun to accepting a feasible alternative, target under 60 seconds. Also report how often no valid option is found, completion after acceptance, full versus fallback outcomes, missing outcomes, and whether effort was lower than their current method. Measure setup burden so a fast recovery does not hide excessive preparation work.

Continue only if users experience this problem repeatedly, prefer the recovery flow to their current approach, and the hard-constraint/privacy tests pass. A suggestion accepted but never attempted is not evidence of behavior improvement.

## 9. Competition and Claims

Reclaim already schedules lunch/exercise habits and moves conflicting habits. Moving a block alone is not a unique product. [Reclaim habit scheduling][reclaim]

Daywell's hypothesis is that replacing the content of one disrupted action, using the user's own ready alternatives, can be more useful than moving its time alone. Compare that specific workflow with existing tools; do not claim competitors cannot do it without hands-on evidence.

Target user price is $0 for the local MVP, with no metered AI or paid integration dependency. Development, support, hosting, and future sync still need funding. No promise of lifetime-free service, health improvement, biological-age reduction, or career advancement.

## Sources

Checked October 4, 2026. Vendor documentation supports described practices/capabilities, not comparative performance. The pain hypothesis, requirements, build estimate, and pilot thresholds are product decisions.

[sierra-models]: https://sierra.ai/blog/constellation-of-models
[sierra-lifecycle]: https://sierra.ai/blog/agent-development-life-cycle
[reclaim]: https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines
