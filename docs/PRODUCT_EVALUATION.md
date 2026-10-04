# Daywell Focused Product Evaluation

Reviewed October 4, 2026. The [active PRD](PRD.md) is v3.0. The [broader v2.2 specification](PRD_v2.2.md) is archived; the [QA report](PRD_QA.md) retains historical findings and the current focus review.

## Decision

Validate one pain hypothesis: when a work meeting runs late and displaces a planned meal or movement block, choosing a practical replacement creates enough friction that the person abandons the plan.

Build one recovery loop before expanding: report the overrun, check feasible saved alternatives, accept one change to the internal plan, and record the actual outcome. This is a proposed product focus, not a finding from user research.

## Competitive Test

Reclaim already schedules and moves lunch/exercise habits. Rescheduling alone is not differentiation. [Reclaim documentation](https://help.reclaim.ai/en/articles/4129152-habits-overview-auto-schedule-flexible-time-for-your-routines)

Daywell's hypothesis is that changing the action itself, using the person's saved ready alternatives, reduces recovery effort more than moving its time alone. Compare against the participant's existing calendar, saved options, and habit tools. Vendor descriptions do not prove that competitors lack this workflow or that Daywell is preferable.

## Build and Reliability

The current prototype still displays presets and lacks dated durations, actual recovery state changes, proposal undo, and the new outcome model. No working agent, secure sync, or native health integration is implied by this documentation revision.

The focused MVP uses manual structured context and deterministic checks. Sierra-inspired modularity, release/version discipline, feedback review, and regressions remain requirements; they do not require Sierra's proprietary platform. [Sierra architecture](https://sierra.ai/blog/constellation-of-models), [Sierra lifecycle](https://sierra.ai/blog/agent-development-life-cycle)

A responsive laptop/phone interface is first-release scope. Shared records, native apps, wearable inputs, voice/photos, and broader meal planning are separate milestones. The three-hour build estimate is a time-boxed functional prototype target, not production readiness or a promise of synchronized private storage.

## Validation and Claims

Observe five users first, then consider a ten-person two-week feasibility pilot. Measure time to accept a feasible alternative, setup burden, no-option rates, and completion separately from acceptance. Split full and fallback actions; missing outcomes stay unknown.

Continue only if users repeatedly face the problem, prefer the recovery workflow, and hard-constraint/privacy tests pass. No health, biological-age, or career-outcome claim follows from this pilot. Targeting a $0 local MVP does not remove development, support, hosting, or future sync costs.
