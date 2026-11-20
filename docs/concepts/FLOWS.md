# Flows, tags and turn allocation (hypothesis, rev 3, 2026-11-20)

Status: hypothesis. Rigid order steps 1 (name) and 2 (concept records) only; nothing is built.
1. A flow is a pre-made sequence of turns held in a catalog; a cheap helper (the flow router) picks which flow starts or joins a conversation, before any provider API is called.
2. Tags and snap policies, kept beside the turns and never inside them, say which flows a turn qualifies for; step validators lifted from skills check a flow as its turns resolve steps.
3. Turn stacks and turn dithering allocate turns from parameterized templates; flow lint joins the captured data to find successes, issues and further strategies.

Stance. No comparison with what a person would do, and no rigid baselines: a baseline is just a measure, and nebulous. The aim is quality working; token efficiency is the degree to which expense comes down; both is ideal. Ruled out by name: flows that carry heavy token contexts and then spend API output turns on content that could have been dialed back.

## State first (outside in)
Everything below reads from this; where a later line contradicts it, this wins.
- Everything is a state-based measurement. State = the policy tags in force plus where each flow's turns stand, with session/flow attribution.
- From a state, a condition or projection selects what occurs next: the next transition gate, like a state machine. Every hypothesis and every lint query is phrased: given this state, which transition is projected, and which one occurred.
- "Gate" already means a halt/step point in app/coord.js (a session held before a model request or tool call; catalog term ydbdbn). It is a different thing; this one is the "transition gate".
- When the state holds several items to address (concerns to enumerate), that is an accumulated collection, a concern queue, worked like a for-loop or queue. Two ways through it, both recorded: strapped (by policy, a dithered stack of turns is strapped on to steer) or natural (the agent goes that way unaided while policies attach along the way, with less influence; see natural steering, rhaenk). The amount of influence is itself a recorded choice (influence mode).
- What the session holds and has checked is part of the state: an inventory of the target (captures, a query shape) and check records give an exact has/has-not view. See INVENTORY.md.
- Concern queue entries can point at inventory entries; the autonomous inventory route asserts the seam contracts below.
- Outside in: the flow is stitched together both imperatively and declaratively. The model that adds onto the turns is a handler of its own, chosen by policy: close to a routed micro-prompt turn-context agent that settles which turns to add, given a propagated set of details, or a stack of turns added to the context to progress it. It does not see the turns: it picks high-level semantic entries (semantics plus contextual information and data), and those entries are associated with which turns get stacked next.

## Terms (index of record: catalog/nomenclature.jsonl)
- flow: a stored, ordered sequence of turns (a conversation track); applies at bootstrap or mid-session. flow catalog: flows plus the approaches that allocate their turns and what each policy aimed for.
- flow router: a cheap helper or logic that picks a flow per case, pre-provider, any provider. route rubric: the labels and directive saying when a flow is routed a given way.
- tag: an attributable label on a turn or flow; means anything; many-to-many with flows. premise: the stated starting basis of a tag set (what it assumes). tag pivot: the tag set at the start. tag transition: a change along the way.
- tag foundry: where tags are made and documented. dry-run: a trial of a pitched tag with the existing conventions. protocol swap: changing a flow's protocol mid-flow when a dry-run or flow shows more issues than expected.
- snap policy: binds a tag set to a flow, with a trigger, an aim and awareness. stride: one policy tag's run along the turn state.
- strand: one tagged policy's thread through the turns. quilt: the strands of all active policies together. guard: resolves what falls outside the tagged policies' scope so the strand meets back in.
- turn template: a turn with typed fields and no fixed wording. fields: its parameters (aka "content slots"; not a UI slot, lbhvob).
- turn stack: pre-allocated templated turns, e.g. spun up to meet a cache size floor. turn dithering: the same, dispersed, allocation guaranteed by policy. saturated dithering: so dense it looks serial.
- context pin: a terse cached context a hot agent works from. hot agent (aka delegator): an active agent producing or guiding turns from baked templates off a pin. micro-request: a small API call tapped against that state.
- step validator: a check from one step bullet or directive of a skill or agent md file. flow lint: joined, timestamped data that assesses the approach itself.
- seam contract: a policy seam's parameters and its return payload shape.
- state snapshot: tags in force, flow states, open concerns at a turn. projection: from a state, the transition expected next. transition gate: the point where a state moves to the next.
- concern queue: accumulated open concerns worked like a queue. influence mode: strapped or natural. handler: the policy-chosen model that picks semantic entries and so which turns stack. semantic entry: a high-level item (semantics plus context and data) tied to turns to stack.

## Data model (records; fields only; all harness data, stored beside turns)
- flow: id, title, version, role (overarching|implicit|triggered), turns[] (template ids or handles), origin (hand|extracted|materialized), tags[], validators[], strategy_ids[], since.
- route rubric: id, flow_id, labels[], directive, router_kind (logic|agent). route pick: id, session, flow_id, rubric_id, confidence, at_turn.
- tag: id, label, premise, kind, attributed_by (foundry|router|heuristic|validator|utility agent), at_turn, subject (turn|flow), state (pitched|dry-run|in-flight|asserted).
- snap policy: id, tag_set, match (all|any|not), flow_id, trigger (start|transition|hook), aim, awareness (none|named|full), strategy_id.
- tag transition: id, session, flow_id, from_tags[], to_tags[], at_turn, source (metadata|policy|utility agent), cause.
- guard: id, policy_ids[], scope_exit (what fell outside), resolution, rejoin_turn. protocol swap: id, flow_id, from, to, reason, at_turn.
- turn template: id, role, fields[{name, type (voice|content|context|enum|handle), source (helper|heuristic|context|either), shape}], validation_shape, budget.
- turn stack: id, template_ids[], depth, purpose (cache floor|graft|steer), allocated_at, filler (helper|heuristic|both), pinned_epoch.
- dither allocation: id, template_ids[], rule, min, max, saturation (0..1), guarantee (policy id), filler.
- context pin: id, handle, size, epoch. hot agent: id, pin_id, templates[], taps (micro-request count).
- step validator: id, source_path, source_line_range, step_text_hash, check (shape|presence|order|cost), purpose (inject basis|drive policy|passive structure), applies_to.
- validation result: id, validator_id, flow_id, session, at_turn, outcome (pass|fail|unresolved), carried_to (flow ids|tags), evidence_handle, tokens, cost.
- state snapshot: id, session, flow_states[{flow_id, turn_pos}], tags_in_force[], concern_queue[], at_turn, t.
- concern queue entry: id, state_ref, concern (semantic entry ref), status (open|addressed|dropped), mode (strapped|natural).
- projection: id, state_ref, condition, projected_transition, by (policy|handler|heuristic), confidence.
- transition (at a transition gate): id, from_state, to_state, trigger, projected_ref (or null), occurred_at.
- handler: id, policy_ids[], sees (semantic entries only), params, return (entries chosen -> turns to stack). influence mode: strapped | natural, recorded per queue run.
- flow event (lint): ts, session, flow_id, state, tags[], and a ref to any record above; captured as it happens, never rewritten.

## Invariants
1. Tags, premises and policies live outside the content: zero request bytes, true by construction ("do not poison the flows"). Testable: tags and premise are easy to gauge, record and verify.
2. Byte-stable prefixes are never edited; a flow applied mid-session lands on the ephemeral edge or opens a new strategy id.
3. A template never holds fixed wording; wording comes from fields filled by helpers, heuristics or both, then validated.
4. Awareness (a model told the system exists) is a per-strategy choice, default none, recorded in the snap policy.
5. Every change is a new strategy id; results are per model; the catalog is append-only and not versioned per model.
6. A validator cites its source line; a stale source hash marks it unresolved, not passed.
7. Flow lint data is captured with timestamp and session/flow state attribution; nothing is rewritten.

## Seam contracts
Policies (the data we procure) indicate what a model should do, and so where the seams are. Catalog the seams by breaking policies into principles, in the manner of hexagonal architecture and SOLID, applied to policies and flows, not OOP.
- Record: seam id, policy ids, principle (my reading, open: one aim per policy; policy in, filler out; new flows without changing policies; fillers interchangeable; policies depend on tags not turn text), params, return payload shape.
- Candidate seams: route (rubric, case -> flow id, confidence), snap (tags, state -> flow ids), fill (template, context -> turn payload), validate (turn, step -> result, carried_to), guard (scope exit -> resolution, rejoin), handler (state, semantic entries -> entries chosen, turns to stack), projection (state -> projected transition, confidence).

## Relation to what exists
- C1 policy directives (STEMS.md 5c): snap policies are the tag-driven form; directives remain the wording side.
- C2 probe turns and HYPOTHESES.md H2 (cache floor): stacks are spun up to meet the floor. C3 ambiguous markers: the content-side twin of tags.
- C4 nudge turn and C5 graft (STEMS.md 5d): serial turns become a graft of turns; a materialized template is a graft whose payload is filled by data.
- C8 voice catalog: the "voice" field type. C10 skill blob: source for validators. C14 turn analysis (.claude/skills/turn-analysis/SKILL.md): flow lint extends it.
- flow alteration (tampqj, drbhtd): the router and fillers are its pre-provider form.
- Seams: app/strategies.js (strategy id carries policy, awareness), app/checkpoints.js (flows, points, bootstrapping interleave), app/handles.js (flow turns, pins, evidence), app/providers.js (router runs before it).

## Open questions (QF series; the person's answer as given, then what is still open)
- QF1 Tags. A tag foundry exists; tags are documented in flight, asserted after the fact. In flight: pitch tags with a hypothesis, optionally dry-run with all existing conventions; if a flow shows more issues than anticipated, protocol swap and continue. Large-sample qualification is not done by Claude sessions. Open: who runs the large sample; foundry record shape.
- QF2 Tag transitions. Content-dependent and ambiguous. Sources: metadata, the policies, and an agent in a utility role for just that. Open: which source wins on conflict.
- QF3 Several flows at once (a turn's tags satisfy more than one flow's policy at the same moment). No merge rule: multi-stride policy tags pass each other in chronological turn state, picking up and falling off interleaved, per policy, case by case. Open: how overlap is recorded.
- QF4 Baseline. Nebulous by intent; see the stance. Open: which measures lint reports, without a fixed comparison.
- QF5 Step validation purposes: (a) validating a turn that injected turns are based on; (b) policies driven by the validation result; (c) passive structuring, where serial or dithered automated flow stacks are added to the context so the flow becomes validated and its tags transition. Never blocking: the question is which flows carry the issue and its tags onward (quilt, strands, guard). Tags and policies indicate which flows qualify downstream. Open: guard shape.
- QF6 Catalog. Not versioned per model; append-only. Open: location (repo file, handle store, both).
- QF7 Granularity. Open: what counts as one state change (a tag, a flow turn, a queue entry, any of them).
- QF8 Ownership. Open: who owns the projection when policy and handler disagree; both are recorded either way.

## First order of work (hypotheses; smallest first; none built)
- F1 Validator extraction: step bullets of one skill (e.g. .claude/skills/spec-first/SKILL.md) extract into validators with a checkable shape (step, expected evidence, result) that resolve against recorded sessions. Falsified if most bullets yield no checkable shape, or the validators cannot be resolved from session records alone. Needs: one skill, recorded sessions.
- F2 (moved to invariant 1) Tags and premise are easy to gauge, record and verify: a tag and its premise can be checked from the sidecar alone. Falsified if a tag needs turn text to verify. Needs: sidecar records.
- F3 Router pick vs rubric: a router picks the flow its route rubric names, at the high level, with a confidence recorded per pick. Falsified if high-level matches are not typically correct against the rubric. Needs: a small catalog, rubrics, real session starts.
- F4 Template fill: a helper fill and a heuristic fill pass the same validation shape; the heuristic draws on the flow's role (overarching, implicit, by trigger). Falsified if either fails the shape over 10 fills. Needs: one template, C8 voice, role on the flow.
- F5 Stacks and hot agent: a turn stack spun up to meet the provider cache floor before the flow is sent (C2, H2), and/or a hot agent producing turns from baked templates off a terse cached pin, tapped for micro-requests. Falsified if cached_tokens do not appear at the floor, or if micro-requests do not carry the work at lower expense with quality held. Needs: F4, a strategy id, silo canary (PROGRAMME.md).
- F6 Dithering and saturated dithering: policy-guaranteed dispersed turns keep min and max in 95 percent of sessions, including at saturation where they read as serial. Falsified below that. Needs: F4, checkpoint hooks, a ledger row per allocation.
- F7 Flow lint: events captured in tandem, with timestamp and session/flow state, consolidate by query into successes (tracked, not celebrated), issues, and enhancements or further strategies. Falsified if the join needs rewritten data. Needs: F1, ledger rows, C14 profile code. Each query reads: given this state, the projected transition and the one that occurred.
- F8 Projection: from recorded states, the projected transition matches the one that occurred often enough to steer by. Falsified if projections are no better than the most common transition. Needs: F7 records, snapshots, a few hundred recorded transitions.
- F9 Queue handling: strapped and natural modes both drain a concern queue; record which leaves fewer concerns unaddressed and at what token weight; no winner assumed. Falsified if either mode leaves the queue undrained in most runs. Needs: F6, a handler, snapshots, silo canary (PROGRAMME.md).
