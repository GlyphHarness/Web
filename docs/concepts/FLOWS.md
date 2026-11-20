# Flows, tags and turn allocation (hypothesis, 2026-11-20)

Status: hypothesis. Rigid order steps 1 (name) and 2 (concept records) only; nothing is built.
1. A flow is a pre-made sequence of turns held in a catalog; a cheap helper model (the flow router) picks which flow starts or joins a conversation, before any provider API is called.
2. Tags and snap policies, kept beside the turns and never inside them, say which flows a turn belongs to; validators lifted from skills check a flow as its turns resolve steps.
3. Turn stacks and turn dithering allocate turns from parameterized templates; flow lint reads the resulting data to judge the approach itself.

What it is for: reinforcing or improving the quality of agent-driven work first (steps completed, first-try edits, fewer nudges and repeats, validators passing); token savings count too but are not the test alone. A flow that costs the same and makes the work better passes.

## Terms (index of record: catalog/nomenclature.jsonl)
- flow: a stored, ordered sequence of turns (a conversation track); applies at bootstrap or mid-session.
- flow catalog: the set of flows plus the approaches that allocate their turns, with the aims of each policy.
- flow router: a cheap helper model that picks a flow per case, pre-provider, any provider.
- tag: an attributable label on a turn or flow; means anything; many tags per flow, many flows per tag.
- tag pivot: the tag set at the start of a conversation. tag transition: a change of the set along the way.
- snap policy: a rule that binds a tag (or tag set) to a flow, with a trigger and an aimed resolution.
- turn template: a turn with typed fields (voice, content, context values) and no fixed wording.
- fields: the template's parameters. aka "content slots" (the person's phrase). Not a UI slot (see lbhvob).
- turn stack: a pre-allocated block of templated turns. turn dithering: the same, dispersed, allocation guaranteed by policy.
- step validator: a check extracted from one bullet or directive of a skill or agent md file.
- flow lint: analytics over tags, flows, validations and costs that assesses the approach itself.

## Data model (records; fields only; all harness data, stored beside turns)
- flow: id, title, version, turns[] (template ids or handles), origin (hand|extracted|materialized), tags[], validators[], strategy_ids[], since.
- tag: id, label, kind (free text), attributed_by (human|router|heuristic|validator), at_turn, subject (turn|flow).
- snap policy: id, tag_set, match (all|any|not), flow_id, trigger (start|transition|hook), aim, awareness (none|named|full), strategy_id.
- tag transition: id, session, from_tags[], to_tags[], at_turn, cause (policy id|router|validator), resolved_flow_id.
- turn template: id, role, fields[{name, type (voice|content|context|enum|handle), source (helper|heuristic|context|either), shape}], validation_shape, budget.
- turn stack: id, template_ids[], depth, allocated_at (bootstrap|checkpoint), filler (helper|heuristic|both), pinned_epoch.
- dither allocation: id, template_ids[], rule (every N turns|on tag|on checkpoint), min, max, guarantee (policy id), filler.
- step validator: id, source_path, source_line_range, step_text_hash, check (shape|presence|order|cost), applies_to (flow id|tag), severity.
- validation result: id, validator_id, flow_id, session, at_turn, outcome (pass|fail|unresolved), evidence_handle, tokens, cost.

## Invariants
1. Tags and policies live outside the content: no tag, flow id or policy text enters a turn ("do not poison the flows").
2. Byte-stable prefixes are never edited; a flow applied mid-session lands on the ephemeral edge or opens a new strategy id.
3. A template never holds fixed wording; wording comes from fields filled by helpers, heuristics or both, then validated.
4. Awareness (a model told the system exists) is a per-strategy choice, default none, recorded in the snap policy.
5. Every change is a new strategy id; blue (serial) stays the baseline; results are per model.
6. A validator must cite its source line; a stale source hash marks the validator unresolved, not passed.

## Relation to what exists
- C1 policy directives (STEMS.md 5c): snap policies are the tag-driven form; directives remain the wording side.
- C2 probe turns: a stack can end in one; C3 ambiguous markers: markers are the content-side twin of tags; resolvers may read tags.
- C4 nudge turn and C5 graft (STEMS.md 5d): a materialized template is a nudge or graft whose payload is filled by data.
- C8 voice catalog (RECRAFT.md 2): the "voice" field type draws from it. C10 skill blob: source for validator extraction.
- C14 turn analysis (.claude/skills/turn-analysis/SKILL.md): flow lint extends its metadata-only profile; descriptive first.
- flow alteration (tampqj, drbhtd): a second model altering turns; the router and helper fillers are its pre-provider form.
- Seams: app/strategies.js (strategy id carries policy and awareness), app/checkpoints.js (flows, points, bootstrapping interleave),
  app/handles.js (flow turns and validator evidence by handle), app/providers.js (router runs before this seam).

## Open (undecided by the statement)
1. Who attributes tags: router, heuristics, validators, or all, and how is attribution trusted?
2. Is a tag transition detected from turn content (reads content) or only from metadata and events?
3. Do flows merge when several snap at once: priority, union, or router choice?
4. How are quality gained and tokens saved baselined against what agents would likely have produced: replayed runs, or the serial blue arm?
5. Does a step validator ever block a turn, or only report?
6. Where does the flow catalog live (repo file, handle store, both) and how is it versioned across models?

## First order of work (hypotheses; smallest first; none built)
- F1 Validator extraction: step bullets of one existing skill (e.g. .claude/skills/spec-first/SKILL.md) can be extracted into validators that
  a reviewer agrees with. Falsified if under 80 percent of bullets yield a checkable shape. Needs: one skill, a reader, metadata of past sessions.
- F2 Tag sidecar: tags and snap policies can be stored and replayed beside turns with zero bytes in the request. Falsified if any request
  hash differs from the untagged run. Needs: a sidecar store, wire hash compare, a mock session.
- F3 Router pick: a cheap model picks a flow from a 5-flow catalog as well as a person does. Falsified if agreement is under 70 percent
  over 20 real cases. Needs: a small catalog, real session starts, cost under C6's one cent.
- F4 Template fill: one turn template filled by a helper and by a heuristic passes the same validation shape. Falsified if either fails
  the shape over 10 fills. Needs: one template, voice field from C8, a validation shape.
- F5 Turn stack at bootstrap: a pre-allocated stack beats serial on quality (completed, first-try edit success, nudges, repeat rate) at equal or lower cost, or on cost at equal quality, per model. Falsified if neither holds
  against the blue median over the PROGRAMME.md repeats. Needs: F4, a strategy id, silo canary per PROGRAMME.md.
- F6 Turn dithering: policy-guaranteed dispersed turns keep their guarantee (min and max met) in at least 95 percent of sessions.
  Falsified below that. Needs: F4, checkpoint hooks, a ledger row per allocation.
- F7 Flow lint: tags, flows, validations and cost join into one table that shows which hooks fired as actionable points. Falsified if the
  join cannot be made from existing ledger rows plus the sidecar. Needs: F2, F1, C14 profile code.
