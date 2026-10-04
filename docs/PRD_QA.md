# Daywell PRD QA and Critique

Reviewed: October 4, 2026 | Current specification: PRD v3.0 | Historical reviews: v2.0-v2.2

This is a review of the specification, source-code capabilities, and public evidence. It is not a clinical validation, usability study, device benchmark, penetration test, or hands-on comparison of competitor products. Requirements and test targets are proposed; none of the new gates have been measured.

## Current Focus Review

PRD v3.0 addresses one proposed pain point: a late work meeting displaces one planned meal or movement block, and the user needs a workable alternative. Sections below about v2 requirements are historical and refer to the [archived broader PRD](PRD_v2.2.md), not the active requirement numbers.

The new first-release boundary is a user-triggered, manual-context recovery loop. R01-R06 define the needed context, overrun report, deterministic feasibility, approved internal state change, actual outcome, and recoverable storage. It does not require a model, live calendar, wearable, voice, photo, weekly planner, or age prediction. Laptop/phone shared state remains a separate explicit milestone, not a claim that browser access creates synchronization.

Focus QA: one trigger, one affected block, one accepted alternative, and one recorded outcome. The three-hour build order must produce actual dated plan updates, not preset copy. The example includes buffers on both sides of movement; a shorter alternative is not full-action credit. Setup burden and no-feasible-option rates are measured alongside time to accept an alternative. Pain frequency, preference over existing tools, and behavior benefit remain unproven.

Sierra-inspired checks remain proportionate in Section 6: skills, a code supervisor, pinned releases, compatible rollback, bounded local diagnostics, and reviewed regression fixtures. Broader native/sync requirements are preserved in the archive rather than silently represented as shipped or as three-hour scope. This revision changes documents only; the prototype's open implementation issues remain.

## Findings, Ordered by Impact

### Q01. High: the competitive gap was overstated

The earlier evaluation treated meal planning, wearables, and calendars as separate products and presented their intersection as defensible. Reclaim already schedules lunch/exercise habits and moves conflicts. Oura combines meal photos with suggestions. Muse advertises health-connected training, recipes, and calendar tools. Fo advertises scheduling/ordering and free access, so low price is not unique.

Evidence: [Reclaim documentation](https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines), [Oura Meals](https://support.ouraring.com/hc/en-us/articles/40264659421843-Meals), [Muse Fitness](https://ai.meta.com/muse/fitness/), [Fo](https://wajo.ai/).

Disposition: PRD Section 4 explicitly calls the advantage a hypothesis. The product focuses on adapting both content and timing with low effort. Section 10 compares against participants' existing tools and requires a preference/effort signal before broader investment. Competitor documentation does not establish that no alternative already solves this.

### Q02. High: demonstrated capabilities were mixed with intended ones

Preset cards are selected only by capacity. Saved notes and transcripts appear in a context list but do not alter those cards. Health-file handling searches for signal names; it does not parse readings. Disruption buttons display copy without moving actual plan items.

Evidence: [preset plan function](app.js#L41), [context rendering](app.js#L49), [disruption handler](app.js#L105), [voice result](app.js#L116), and [health scan](app.js#L136).

Disposition: PRD Section 3 records the current implementation accurately. R02-R06 and rollout gates specify the missing work. This documentation revision does not implement the native integrations or AI.

### Q03. High: local privacy and permission claims needed correction

The browser speech code does not require local processing. The page says it transcribes locally, while browser speech may send audio to a service. Browser localStorage is not the native protected store envisioned by the PRD. Google Fonts creates network dependencies. Calendar selection in an app is not a narrowly scoped EventKit OS permission. Empty HealthKit reads cannot reveal whether permission was denied.

Evidence: [current voice copy](index.html#L124), [external fonts](index.html#L8), [MDN speech documentation](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [EventKit access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store), [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data).

Disposition: PRD Sections 3 and 7 and R06/R07/R10 distinguish prototype behavior, permission scope, local speech qualification, and retention. These statements are fixed in the specification and README. The current webpage wording remains an implementation issue to correct before sharing sensitive-data demos.

### Q04. High: biological age could become an unsupported product outcome

An aspiration to move 33 to 28 is motivating but cannot become a promise or a computed score without a defined, validated method. The earlier blanket phrasing that wearable age estimation is unsupported was also too broad: WHOOP does publish a physiological age-branded score. Its existence does not make it interchangeable with laboratory clocks or establish Daywell effectiveness.

Evidence: [WHOOP's own method and limitations](https://support.whoop.com/s/article/Healthspan-WHOOP-Age-Pace-of-Aging-Guide?language=en_US). The [CALERIE trial analysis](https://pubmed.ncbi.nlm.nih.gov/37118425/) found method-dependent effects rather than general age reversal.

Disposition: R12 defers the feature and permits a later journal of external results with method/date. No prediction, cross-method comparison, causal attribution, or pilot biological-age endpoint. Do not recommend calorie restriction based on this research.

### Q05. High: rich physiological inputs had no defined planning benefit

The earlier first-release signal list included oxygen saturation, respiratory rate, HRV, mobility, and cardio fitness. Listing every available signal does not justify using it to choose exercise intensity. It increases permission cost and interpretation risk without demonstrated benefit.

Disposition: R06 limits initial context to optional activity/workouts and sleep, with explicit capacity taking precedence. Other interpretation is deferred. The pilot asks whether wearable context adds value beyond calendar and user check-ins. Existing exports' data availability is not evidence that each field should enter the model.

### Q06. High: full and fallback actions could falsely imply equivalent progress

Counting a short walk as a completed full movement session can inflate goal attainment. A cumulative-health metaphor can also imply users should repay missed exercise or meals.

Evidence: [WHO activity guidance](https://www.who.int/news-room/fact-sheets/detail/physical-activity) supports benefits from some activity, not equivalence among all activities.

Disposition: R01/R08 define full and fallback actions separately, allow a user-defined contribution rule, and forbid compensatory behavior. The validation plan reports each outcome separately.

### Q07. Medium: a bigger model was treated as a route to accuracy without qualification

Model modalities and benchmark quality do not establish accurate health recommendations, low correction effort, or compatibility with every phone. Gemma's E2B/E4B labels are effective parameter counts. Multimodal runtime memory and selected artifacts matter.

Evidence: [Gemma model card](https://ai.google.dev/gemma/docs/core/model_card_4), [deployment guidance](https://ai.google.dev/gemma/docs/core), [Qwen text model](https://huggingface.co/Qwen/Qwen3-1.7B), [Qwen speech model](https://huggingface.co/Qwen/Qwen3-ASR-0.6B).

Disposition: Section 6 and R09 separate the user's three roles, reuse models, retain ordinary code checks, and require task/device qualification. No new inference was run in this review. Accuracy and latency remain unresolved until the actual models are tested.

### Q08. Medium: broad meeting autonomy and real-time monitoring were under-specified

Rescheduling other people's meetings creates attendee, recurrence, race, and permission consequences. An on-device app cannot assume continuous background execution. Approving an action before its state changes does not authorize a different later action.

Evidence: [EventKit](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) and [Apple background strategies](https://developer.apple.com/documentation/BackgroundTasks/choosing-background-strategies-for-your-app).

Disposition: R05/R07/R10 restrict v1 writes to Daywell-created personal events, re-read state before execution, require renewed approval after changes, prevent duplicate retries, and show refresh times. Wider meeting actions remain in the roadmap.

### Q09. Medium: free inference was conflated with a sustainable free product

Locally running permissively licensed weights avoids a provider's inference bill. Development, support, content review, distribution, battery, storage, and downloads remain costs. A free product also competes with free assistants.

Evidence: [Apple Developer Program](https://developer.apple.com/programs/); exact candidate model licenses are linked in PRD Section 6.

Disposition: R11 targets a $0 core, excludes paid dependencies, requires a manual fallback, and makes founder-funded alpha support explicit. Maintenance funding must be demonstrated before a wider launch. Free indefinitely is not promised.

### Q10. Medium: user validation and success metrics did not adequately test the pain point

Acceptance alone does not establish completion. A two-week novelty test without a defined disrupted-day denominator can overstate effectiveness. Health and career outcomes were broader than the proposed experience could measure.

Disposition: PRD Sections 2 and 10 define career support as protecting user-selected commitments. The pilot has a baseline week, separate acceptance/completion measures, unknown-outcome reporting, full/fallback splits, effort measures, and explicit continuation criteria. It remains a feasibility pilot, not causal or clinical proof.

### Q11. Medium: scope accumulated without a release decision

Meal apps, wearables, voice, photos, file imports, calendar edits, and age goals were all discussed as if they could enter one first release. This risks spending time on model integration before proving useful adaptation.

Disposition: Section 8 defines dependencies and independent gates. Typed/manual planning and true plan-state updates come first; native connections and model capture follow qualification. All requested input types remain in the product direction.

### Q12. Medium: reliability requirements lacked measurable acceptance criteria

The earlier architecture described checks but did not specify failure behavior or release thresholds. Self-reported model confidence and a single convincing demo are inadequate quality measures.

Disposition: R09 and Section 9 define structured proposals, bounded retries, manual fallback, held-out scenarios, reviewer disagreement handling, state-based checks, and device/modality breakdowns. Zero observed failures in a finite suite is not a guarantee of zero risk. [Sierra's lifecycle](https://sierra.ai/blog/agent-development-life-cycle) supports regression practice, not health efficacy.

## Fact-Check Ledger

| Claim | Assessment | Wording in PRD v2 |
| --- | --- | --- |
| Small feasible actions can contribute to health | Supported in general for physical activity; exact effects depend on action/person | Smaller fallback, with no claim of equivalence or individual outcome |
| Food affects health | Supported generally | Practical meal routines using reviewed/user-saved options |
| Digital interventions can improve behavior | Supported across heterogeneous studies; not evidence about Daywell | Rationale to test; no effectiveness claim |
| Daywell can reduce biological age 33 to 28 | Not established | Optional later aspiration tied to an external method |
| A wearable-derived age score cannot exist | Too broad | Existing scores acknowledged; no interchangeability or Daywell validation |
| Higher-capacity models ensure accuracy | Not established | Task-specific qualification and ordinary code checks |
| Free weights mean all costs disappear | False | No license/inference bill is distinct from maintenance/device cost |
| Current health imports personalize plans | False in current code | Signal-name detection only |
| Current voice is guaranteed on-device | False in current code | Browser-dependent behavior; native local speech must be qualified |
| No other product combines these functions | Not established; material overlap exists | Specific benefit tested against existing alternatives |

General evidence: [WHO diet](https://www.who.int/news-room/fact-sheets/detail/healthy-diet), [WHO activity](https://www.who.int/news-room/fact-sheets/detail/physical-activity), and [digital-intervention umbrella review](https://pubmed.ncbi.nlm.nih.gov/38969775/). No private personal health results are reproduced in these documents.

## Final Specification Review

| Check | Result |
| --- | --- |
| User pain and first audience are explicit | Addressed in Sections 1-2 |
| Built versus planned capabilities are separated | Addressed in Section 3 |
| Competitor overlap is acknowledged | Addressed in Section 4 |
| Meal plans, records, goals, calendar, and voice/photos are retained | Addressed in R01-R08 and rollout |
| Three requested agent roles have execution boundaries | Addressed in Section 6 and R09 |
| Science, age claims, privacy, and permission boundaries are stated | Addressed in R06/R07/R10/R12 |
| Cost plan includes support and device constraints | Addressed in R11 |
| Acceptance targets and user-validation plan are measurable | Addressed in Sections 9-10 |
| Effectiveness, device performance, sustainability, and market demand proven | Not yet; explicitly unresolved |

## v2.1 Cross-Device Review

The user wants laptop and phone installation with shared state. Mac/iPhone is an explicit assumption, not a confirmed hardware requirement. The current browser demo has neither native installation nor synchronization.

- Platform mismatch: Mac HealthKit cannot read/write health data. R10 now uses the phone as the health source and optional permission-reviewed minimal summaries for laptop context. [Apple availability](https://developer.apple.com/documentation/healthkit/hkhealthstore/ishealthdataavailable())
- Storage policy: private/encrypted CloudKit is not a blanket solution for health records. Guideline 5.1.3(ii) prohibits app storage of personal health information in iCloud. R10 specifies a non-iCloud encrypted relay, sensitive backup handling, and a platform-policy review before distribution. This does not certify compliance. [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Continuity gap: nearby-only transfer and a laptop-hosted server do not meet reliable use while away with the laptop off. R10 distinguishes that milestone from remote sync and requires visible pending/offline state, eventual reconciliation, key recovery, and revocation. Background delivery is not guaranteed. [Apple nearby transport](https://developer.apple.com/documentation/multipeerconnectivity)
- Correctness/cost gap: concurrent records and repeated calendar writes require more than sharing one database. R10 and Section 9 add conflict/deletion tests and execution ownership. R11 budgets the relay separately from local inference and does not promise indefinitely free hosting.

These are specification corrections, not implemented or tested synchronization. Existing findings remain applicable.

## v2.2 Sierra Framework Review

The earlier PRD included modular roles and regression intent, but not a complete release/operations lifecycle. R09 now explicitly incorporates applicable principles from Sierra's [modular architecture](https://sierra.ai/blog/constellation-of-models) and [agent development lifecycle](https://sierra.ai/blog/agent-development-life-cycle). Sections 8-9 make them release gates.

- Skill contracts and code-level supervisory checks constrain models independently of prompts.
- Immutable manifests pin behavior dependencies and tests; rollback is compatibility-aware and cannot erase user records, repeat external actions, or weaken current permissions.
- Bounded local diagnostics and structured correction categories enable review without collecting raw media or hidden model reasoning. Sharing remains opt-in and previewable.
- Confirmed failures become mock-adapter regression fixtures, including multi-turn corrections, interruptions, and cross-device version skew. A release owner reviews results before staged activation.
- Qualified local/manual fallback replaces Sierra's multi-provider cloud redundancy for this product. It preserves the privacy and near-zero-inference-cost direction without promising equivalent uptime or quality.

Daywell does not use Sierra's proprietary Agent OS/SDK. These are specification-level adaptations, not proof of implementation, health effectiveness, or clinical safety. Lifecycle gates, task/device evaluations, and operational drills must pass before those capabilities are described as shipped.

## Outstanding Implementation Issues

This request revises the PRD and its supporting documentation. The following current-demo issues remain open and are not represented as fixed:

- Correct the local voice and health-import wording before inviting sensitive-data use.
- Implement structured record interpretation and true adaptation of dated plan state.
- Replace the fixed two-action goal/demo state with user-defined dated weekly progress.
- Qualify storage/privacy and offline behavior; browser localStorage and external fonts do not satisfy the native requirements.
- Escape or safely construct user-supplied schedule titles instead of interpolating them into HTML. [Current rendering](app.js#L67) is a release-blocking implementation issue for real records.
- Add actual inference and permission-controlled integrations only after the associated gates pass.

Recommendation: proceed with the narrowly scoped feasibility build and pilot. The PRD is now ready to guide that work; the current prototype is not a validated production health agent.
