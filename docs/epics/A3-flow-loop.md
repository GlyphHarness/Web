# A3 Flow loop

Project: WebHarness. Builds the flow layer described in `docs/concepts/FLOWS.md` (flows, router, tags, snap policies, turn templates and stacks, dithering, validators, flow lint, projection, concern queue) in the smallest order the document itself gives (F1 to F9), and uses it on the other epics' own work. Plan only; nothing started (F1, validator extraction, is built: `scripts/validators.mjs`, `node scripts/test-validators.mjs`). Conventions: `README.md` in this folder.

## Goal
Identify the flow a piece of work is in quickly, record it from sidecar data alone, steer it with a structured flow or by natural steering as the person chooses, and drain the concern queue in both modes with their token weights recorded. The person's pitched flows (and their dithering, their natural steering) are first-class arms next to structured ones, never overruled by structure. Outcome: a measured account of when structure beats steering and when it does not, on real stories.

## Why not a toy
- The queue it drains is the real one: the concerns that A1, A2, B1 and B2 produce, plus CI failures.
- The state is the harness's own turn metadata, sidecars and ledgers; the join in F7 must work on them without rewriting data.
- FLOWS.md states that no winner is assumed (F9) and that the baseline is nebulous by intent (QF4); this epic is meant to make those two statements measurable without making them false.

## Flows and concepts exercised
- Concepts: flow, tag, snap policy, turn template, turn stack, hot agent, dithering and saturated dithering, validator, flow lint, projection, concern queue (strapped and natural), state-first model, invariants 1 to the last (FLOWS.md).
- Strategies: baselines `strat-serial-2.0`, `strat-stem-1.0`; stacks and hot agents (F5) each get a new strategy id because what the model sees changes.
- Flows (named per README section 5): `ep-A3.2-pitch-dryrun`, `ep-A3.7-dither-min-max`, `ep-A3.8-queue-strapped`, `ep-A3.8-queue-natural`.
- Open questions it converts to measured choices: QF1 tags and pitch, QF2 tag transitions (which source wins on conflict: metadata, policies, utility agent), QF3 several flows at once, QF4 baseline measures, QF5 validation purposes, QF7 granularity of a state change, QF8 who owns the projection when policy and handler disagree. QF6 (catalog location) is left as the steward's decision.

## Stories

### A3.1 Validators on a second skill; stage-0 baseline
- Owner `context` (records, measures), `seams` for code changes.
- Stage 0 (the cheap models produce draft validator lists; the operator checks them against recorded sessions).
- Needs: G0; F1 built.
- Acceptance: step bullets of one more skill (`.claude/skills/context-experiments/SKILL.md` or `catalog/SKILL.md`) are extracted into validators with a checkable shape (step, expected evidence, result) that resolve against recorded sessions from `docs/concepts/*.jsonl` and wh dirs; falsified if most bullets give no checkable shape or cannot be resolved from session records alone.
- Measure: share of bullets yielding a shape; share resolvable from records alone; the cheap model's own yield compared with the hand extraction (the stage-0 baseline).

### A3.2 Pitch, tags and dry run
- Owner `context` (QF1 procedure), `seams` for tag sidecar checks.
- Needs: A3.1.
- Acceptance: a flow can be pitched with a hypothesis, tagged in flight and asserted after the fact; a pitched flow can be dry-run against the existing conventions (the mechanism is this story's to specify; two parts exist: `scripts/validators.mjs` resolves expectations against recorded sessions, and `scripts/replay.mjs` replays a `.trace` through the real provider path to check request assembly); if the dry run shows more issues than anticipated, the protocol swaps and the session continues; the tag and its premise are checkable from the sidecar alone (invariant 1); QF2: a table of tag transitions with source (metadata, policy, utility agent) and which source decided, with conflicts recorded, no rule invented.
- Measure: share of tags verifiable from the sidecar alone (target all, falsified by any needing turn text).

### A3.3 Router pick versus rubric (F3)
- Owner `context`, `seams` for the router seam.
- Needs: A3.2; a small flow catalog with rubrics, built from the real session starts of the epics' stories.
- Acceptance: the router picks the flow its route rubric names at the high level, with a confidence recorded per pick; a router that routes a pitched flow differently from the person's pitch records both (QF8 stance: both recorded).
- Measure: match rate to rubric over at least 20 real starts; falsified if high-level matches are not typically correct.

### A3.4 Template fill (F4)
- Owner `seams` (template and validator seam), `context` (measure).
- Needs: A3.1, one turn template, the role on the flow (overarching, implicit, by trigger).
- Acceptance: a helper fill and a heuristic fill pass the same validation shape over 10 fills; helper requests are metered with their own ledger row (TENET 26).
- Measure: pass rate and cost of helper versus heuristic fills.

### A3.5 Flow lint (F7)
- Owner `seams` (query over records), `context` (interpretation).
- Needs: A3.1; ledger rows; the profile code (`scripts/turn-profile.mjs`, suite `profile`).
- Acceptance: events captured in tandem, with timestamp and session and flow state, consolidate by one query into successes (tracked, not celebrated), issues, and enhancements or further strategies; each query reads "given this state, the projected transition and the one that occurred"; QF7: one state change is defined by decision (tag, flow turn, queue entry) with the measure showing which gives usable counts; QF4: which measures lint reports without a fixed comparison.
- Measure: falsified if the join needs rewritten data. Reuse the query surface of A1 only after G1; before that, plain scripts.

### A3.6 Stacks and hot agent (F5)
- Owner `seams`, `context` for the silo canary (PROGRAMME).
- Needs: A3.4; a new strategy id; G0.
- Acceptance: a turn stack spun up to meet the provider cache floor before the flow is sent, and/or a hot agent producing turns from baked templates off a terse cached pin, tapped for micro-requests; falsified if `cached_tokens` do not appear at the floor, or if micro-requests do not carry the work at lower expense with quality held.
- Measure: cached share per request, cost per micro-request against a full request, quality by validator result.

### A3.7 Dithering and saturated dithering (F6)
- Owner `seams` (checkpoint hooks, allocation), `context` (measure).
- Needs: A3.4; checkpoint hooks; a ledger row per allocation.
- Acceptance: policy-guaranteed dispersed turns keep their min and max in 95 percent of sessions, including at saturation where they read as serial; QF3: several flows at once pass each other in chronological turn state, picking up and falling off per policy, case by case (no merge rule invented); the natural-steering arm runs the same tasks with no policy so the two are compared.
- Measure: share of sessions meeting min and max; turns and tokens added by dithering.

### A3.8 Concern queue: strapped versus natural (F9)
- Owner `context`; handler written by `seams`.
- Needs: A3.7; a handler; snapshots; silo canary (PROGRAMME); real open concerns from the other epics (the queue at that time, snapshotted).
- Acceptance: the queue is drained in two modes on the same snapshot: strapped (a flow of turns that fixes the order) and natural (the person or agent steering); record which leaves fewer concerns unaddressed and at what token weight; QF5 (a) to (c) validation purposes exercised in the strapped arm. No winner assumed; falsified if either mode leaves the queue undrained in most runs.
- Measure: concerns addressed per 100,000 tokens, concerns left, rework (reopened), steering turns by the person.

### A3.9 Projection (F8)
- Owner `context`; `seams` for the projector.
- Needs: A3.5 records, snapshots, a few hundred recorded transitions (collected across A1 to B2 work).
- Acceptance: from recorded states the projected transition matches the one that occurred often enough to steer by; falsified if projections are no better than the most common transition; QF8: when policy and handler disagree both are recorded, ownership decided by data.
- Measure: projection accuracy against the most-common-transition baseline.

### A3.10 Page: tag chip, flow state, projection view
- Owner `ui` (ui-style; append-once rendering, slots, data-* hooks; state-based smoke check).
- Needs: A3.2 (tags), A3.5 (lint records); read-only views first.
- Acceptance outline: the page shows the flow tag and premise of a session, the state of the queue, the projected and occurred transition per step; no native dialogs; unavailable data renders nothing rather than a placeholder claim.

### A3.11 Judge, record, release
- Owner `judge`, then `steward`.
- Needs: A3.1 to A3.9.
- Acceptance: findings go back through steps 3-4; the catalog gets per-model results; QF answers are recorded as concept supersedes (never edits); release to `main`.

## Dependencies and lanes
Order from FLOWS.md: F1 then (F3, F4) then (F5, F6) then F9; F7 beside them; F8 last because it needs volume.
Parallel in separate sessions: A3.1 with A3.2 once F1's second-skill extraction starts; A3.3 and A3.4; A3.6 and A3.7 (different seams, one owner per file; strategy ids distinct); A3.5 in parallel with A3.6 to A3.8 since it only reads records.
The ui story A3.10 can run in parallel with A3.6 to A3.9 after A3.5.

## Measurement points
1. A3.1 stage-0 yield of validators.
2. A3.2 share of tags verifiable from the sidecar.
3. A3.3 router match rate.
4. A3.4 fill pass rate.
5. A3.6 cached share at the floor.
6. A3.7 min and max in 95 percent.
7. A3.8 strapped versus natural on a real queue snapshot.
8. A3.9 projection against the most-common baseline.

## Risks recorded in advance
- The stage-0 models may not extract validators or route reliably; then the heuristic path is the product and the helper model is an option.
- Real concerns arrive late; A3.8 may need a recorded snapshot from earlier waves rather than live ones.
- A structured flow may lose to natural steering on cost or yield; that is recorded as the result, and the flow stays available as an option, off by default.
