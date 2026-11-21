# B1 Platform spine

Project: the app platform concept (`docs/platform/README.md`, `.claude/agents/platform.md`). It is the only project those two name. This epic takes the spine of the concept (contracts as data, protocol catalog, time) from hypotheses PH1 to PH6 and PH11 to PH15 to a minimal running host and a first app, "ledger", over real harness records. Plan only; nothing started. Conventions: `README.md` in this folder.

## Status of the concept, stated plainly
`docs/platform/README.md` says: built nothing; rigid order steps 1 and 2 only; no spec, no code, no release; everything is hypothesis until the operator says build. This epic does not override that. Stories B1.1 to B1.5 are notes, surveys and paper checks (the platform agent's remit: hypotheses and notes). Stories B1.6 onward need the build gate GB below: the operator's explicit "build", recorded, with the Q2 and Q3 decision.

Gate GB: the person says build (in chat), records the choice for Q2 (embedder runtime with its own host and wasm engine, or a layer over a browser) and Q3 (separate product or a way to express harness seams), and where the code lives. Until then B1.6 onward do not start.

## Goal
A host that runs an app whose capabilities are declared contracts (clock, stream, store, surface, module, identity), whose network and data access go through named protocols from a catalog, and whose state has a timeline (event records, as-of reads, scheduled functions pinned to an epoch), with one app that does real work on records this repo already produces.

## Why not a toy
- The first app, "ledger", ingests what the harness really writes: `log.jsonl` of a wh dir, turn profiles (`docs/concepts/profile-*.json`), `catalog/*.jsonl` and concern records. Its time contract is exercised by a check that can be wrong: an as-of read of the catalog at commit X must equal the catalog's current view at that commit in git history.
- It is the platform-side expression of A3's flow lint (F7: given this state, the projected transition and the one that occurred): if as-of reads cannot reproduce F7's join on the same records, one of the two is wrong, and that is recorded.
- Hypotheses are kept with their cost (cost ledger in the platform README); each addition names its cost.

## Flows and concepts exercised
- Concepts (platform names; the catalog collision rules in the README name map apply): platform contract, core contract set, wasm-direct binding, protocol-first app, protocol catalog, enumerated invalidation, enumerable result set, event record, as-of read, epoch pin, scheduled function, trace guard, knockout.
- Flows: notes stories run as stage-0 sessions (survey and platform agents' passes drafted by cheap models, read by the operator); build stories as `ep-B1.x-spec-red` then green, per the rigid order. Natural steering is the default for notes stories; a strapped flow (turn list) is the arm for B1.9 where an app run is repeated.
- Strategies: baseline `strat-stem-1.0`; no new strategy is needed for notes. Any platform behaviour that changes what a model sees in the harness is outside this epic.

## Stories

### B1.1 Q2, Q3, Q9 as measured choices
- Owner `platform`; `survey` for the wasm baseline (Q9); stage 0 drafts.
- Needs: G0.
- Acceptance: each of Q2, Q3, Q9 is written as options with cost, a check that could refute each, and the evidence kept or deferred (survey budget rules); the person's decision is requested once, with the options side by side, in one question. No code.
- Measure: none; the output is the decision record input for GB.

### B1.2 Contract records on real shapes
- Owner `platform`; stage 0 drafts, operator reads.
- Needs: none.
- Acceptance: the six contracts of PH2 written as data records; for ten real harness event shapes (a ledger row, a trail row, a tool call, a concern, a catalog line, a profile entry, a branch fold, a handle, a stem, a validator record) a paper check names which contract carries it or records a gap; each gap is a hypothesis with its cost, not an added contract by default ("smallest contract set first").
- Measure: share of the ten shapes carried by the six contracts. Falsified if more than three need a new contract.

### B1.3 Protocol catalog for the ledger's needs
- Owner `platform`.
- Needs: B1.2.
- Acceptance: PH4 catalog entries (file stream, document fetch, jsonl append, REST read) as data with a default protocol each (PH3 holds if the app reaches a file, a REST query and a stream with only stream-contract calls naming protocol ids); PH5 and PH6 for a cache keyed by an enumerable result set; Q10 (where explored records live) put to the steward in a line.
- Measure: paper check, then B1.7's conformance spec.

### B1.4 Event records and as-of read: fixtures and the git oracle
- Owner `platform` (spec text), `seams` writes the red checks once GB is met.
- Needs: B1.2; for the red checks GB.
- Acceptance: PH11 and PH12 turned into a fixture set: the catalog's append-only supersedes chains and the git history of `catalog/*.jsonl` give the oracle (for a set of commits, the current view as of that commit computed by `git show` equals the as-of read result); retention and compaction written as catalog data, not constants (README rules).
- Measure: oracle agreement over at least 20 commits; any disagreement is a concern.

### B1.5 Scheduling and misfire
- Owner `platform`.
- Needs: B1.4.
- Acceptance: PH13 and PH14 on two real recurring jobs (the Monday concern read and the background triage loop in PROTOCOL.md "Concerns and the background loop"): epoch pin, due comparison, misfire policy (fire once now, skip, fire all missed) each as data; Q4 (what a guard looks at) put to the person with the two readings.
- Measure: paper check against the two jobs' real histories (when they actually ran).

### B1.6 Spec (red): minimal host
- Owner `seams`; GB met.
- Needs: B1.1 to B1.5 results; GB.
- Acceptance outline: failing checks, committed alone, for the three contracts the ledger app needs (clock, stream, store) and the module contract to load an app; the wasm component binds directly, with no JavaScript glue on the data path if Q2 chose the embedder (if Q2 chose a layer over a browser, "JS glue only at the edge" replaces it); a protocol id omitted resolves to the catalog default (PH3/PH4); every contract call writes an event record.

### B1.7 Implement the host (smallest set)
- Owner `seams`; stage 2 candidate for the heavy parts (A2.7), the mock and fixtures stay offline.
- Needs: B1.6; G2 if stage 2 is used, otherwise stage 0 and the registered agent.
- Acceptance: B1.6 green; suites green; nothing outside the six contracts added without a cost line.
- Measure: surface area (contracts, bindings, lines) against the cost ledger.

### B1.8 Trace guard and knockout
- Owner `seams`, `platform` for the notes.
- Needs: B1.7; B1.4.
- Acceptance: PH15 on recorded run traces of the ledger app: a late-arriving record re-evaluates later runs by a guard over a projection of the trace; knockout of a run's effects that are internal; for an external effect (Q6) the effect declares compensation or is non-voidable, never silently dropped.
- Measure: a late-arrival case in which the re-evaluated run differs from the original, recorded; early cutoff cases counted.

### B1.9 Ledger app, end to end
- Owner `seams`; `context` measures.
- Needs: B1.7, B1.8 (or B1.7 only for a first cut).
- Acceptance: the app ingests a real wh dir's log, a profile and the catalog; answers "as of turn N, what was the state" and "as of commit X, what was current"; runs a scheduled digest; every effect and read is an event record. The same questions answered by A3.5's flow lint (when it exists) give the same counts, or the difference is a recorded concern.
- Measure: agreement with the git oracle, with A3.5 and with `scripts/turn-profile.mjs` on the same profile; time and memory for the largest real wh dir.

### B1.10 Judge, record, release decision
- Owner `judge`, then `steward`.
- Needs: B1.6 to B1.9.
- Acceptance: judge against catalog and specs; findings back through steps 3-4; per-hypothesis results recorded (PH supersedes, not edits); release only if the code lives in this repo (Q3 answer); otherwise the platform's own repository process, recorded.

## Dependencies and lanes
Order: B1.1 and B1.2 (parallel, different files and inboxes) then B1.3 and B1.4 (parallel) then B1.5; GB; then B1.6, B1.7, B1.8, B1.9, B1.10.
Parallel: B1.1, B1.2 and `survey`'s Q9 pass; B1.3 with B1.4; B1.8 notes with B1.7. Never parallel: two agents on one host file.
Cross-epic: B1.9's agreement check needs A3.5; B1.7 may use stage 2 (A2.7 gate G2). Neither is required: each has a stage-0 or registered-agent path.

## Measurement points
1. B1.2 share of real shapes carried by six contracts.
2. B1.4 oracle agreement over at least 20 commits.
3. B1.5 fit to two real job histories.
4. B1.7 surface area against the cost ledger.
5. B1.8 late-arrival re-evaluation.
6. B1.9 agreement with git, with A3.5, with the profile script.

## Risks recorded in advance
- More than three real shapes need a new contract, in which case the six-contract claim is refuted and recorded as such.
- Q2 stays unanswered; then only the notes stories run, and B1 stops at B1.5 with its records, which is a stated acceptable outcome.
- "Wasm does not bind through JS" is a claim about a host; if the choice is a browser layer, the claim narrows and the record says so.
