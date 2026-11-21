# A1 Read path

Project: WebHarness. Integrates the query surface (`docs/QUERY.md`, branch `query-surface`) and text striping (`docs/STRIPE.md`, branch `stripe-surface`) behind a new strategy, and measures them on real work. Plan only; nothing started. Conventions: `README.md` in this folder.

## Goal
A session reads large structured results (ledgers, profiles, catalog, concern queue, CI reports) through `query` and `query_ref` and, where a result is long text, through striped skeletons with omission markers, at fewer tokens per solved task than `strat-stem-1.0` and `strat-serial-2.0` (ranged reads), with correctness no lower. Delivered as a new strategy major version, never an edit of a cached one (QUERY.md OQ11), released to `main` with `version.json` bumped.

## Why not a toy
- The data is this repo's own: `docs/concepts/profile-*.json`, `catalog/*.jsonl`, session ledgers from earlier wh dirs, `ci-record.json`. The tasks are the ones the other epics actually need (find the costliest turn, sum cache share per strategy, locate the concern and read the one part that matters).
- Both pieces exist and are green offline but have no live benefit measured; STRIPE.md records overhead above its bar. A refutation is a live possibility, and a measured "stripe is not worth it at this size" is an accepted result.
- The integration touches the model-visible surface (tool schemas, header form, descriptor text): the cache-prefix rule (TENET 1, 2) applies.

## Flows and concepts exercised
- Strategies: baselines `strat-serial-2.0` and `strat-stem-1.0`; new `strat-query-1.0` (name proposed; settled in A1.1) and, if stripe passes, a minor or separate arm for striping.
- Concepts: query surface (query_ref, declared interactions, staged intent), reducer hook, text striping, handles and the output store (TENET 13, 25), stems.
- Flows: `ep-A1.5-serial-vs-query` (the read-path A/B), `ep-A1.9-drill-in` (does the model re-query or follow refs; the drill-in rate concern in TENETS). Steering: natural for the canary, strapped (fixed turn list) for the full run, both recorded (F9 stance, no winner assumed).
- Task shapes (PROGRAMME needs three): (a) lookup of an extreme or a single record in a large result; (b) aggregation across many records; (c) locate then act: find the record, read one part, change a file.

## Stories
Owner is the registered agent; stage is the driver (README section 2).

### A1.1 Name, concept records, corpus
- Owner `context`, stage 0 (cheap model drafts candidates; `context` owns the records).
- Needs: G0. None of the branches.
- Acceptance: nomenclature for the strategy and the integration terms checked against catalog aliases; concept records (hypotheses) for the three claims (tokens down, correctness held, drill-in by ref); a corpus of 12 to 15 questions with known answers over real data (4-5 per task shape), each stating its expected result by a computation that does not use the model; the arms' view of the data written down per arm (PROGRAMME isolation).
- Measure: first stage-0 baseline: the cheap models' solve rate on the corpus under `strat-stem-1.0` (feeds README section 8).

### A1.2 Integration spec (red)
- Owner `seams`, stage 0 (drafts), registered agent writes and commits.
- Needs: judge pass on `query-surface` and `stripe-surface`; A1.1 records.
- Acceptance outline (failing checks first, committed alone): tools `query` and `query_ref` exist only under the new strategy; the request prefix under `strat-stem-1.0` is byte-identical to before (`context.js` `measure` reports no break); header form `v` and descriptor text match QUERY.md section 2; refs expire per scope (REF_EXPIRED); a refused ref calls no adapter function; the policy shape stays separate from `app/policy.js` (OQ8); the mock provider has triggers for query, ref, refused ref; PROTOCOL.md section for tool authors (step 5: large outputs through `present()`) is satisfied by every new tool.
- Measure: none (spec); a spec change during implementation is its own commit with a reason.

### A1.3 Harness adapter, tool wiring, policy mapping
- Owner `seams`, stage 0 or 1 sessions assist; the agent commits green.
- Needs: A1.2.
- Acceptance outline: the adapter (QUERY.md 6.3) exposes kinds for turns, tool calls, results, handles, ledger rows; `app/tools.js` registers `query` and `query_ref` (one owner for that file); provider seam unchanged; all new checks green; `node scripts/ci.mjs` green; `docs/PROTOCOL.md` entry written.
- Measure: result tokens against `output_read`/`entry_read` for the same data (OQ5).

### A1.4 Striping as a registered reducer
- Owner `seams`.
- Needs: A1.3 (hook exists in the integrated tree); stripe overhead re-measured on A1.1's corpus; a decision recorded for each of OQ15's two readings (reducer by name at the hook; handle rules from `outstore.js`).
- Acceptance outline: `app/stripe.js` stripe-1.0 registers by name; skeleton with omission markers resolves through the same handle as the full text (nothing is lost, nothing re-run, TENET 13); a stripe never changes what a ref resolves to; overhead on the corpus under the STRIPE.md bar or the reducer is applied only above a size recorded as the threshold; otherwise the piece is recorded as deferred with evidence.
- Measure: overhead per call and tokens saved per result size.

### A1.5 Canary (stage 0 harness, new strategy, three arms)
- Owner `context`, with `scripts/wh.mjs` held/stepped sessions; one run per arm per shape.
- Needs: A1.1 corpus, A1.3 merged on a silo copy (blue/green), A1.4 optional.
- Pre-registered thresholds (proposals, fixed before the run): tokens per solved task on shapes (a) and (b) at or under 70 percent of `strat-stem-1.0`; solve rate not lower; model queries failing at parse or validate under 15 percent (OQ1); header tokens under 25 percent of result tokens (OQ14); no prefix break against the stem baseline.
- Acceptance: a descriptive turn analysis (turn-analysis skill) and a record of result, faults and cost per arm; go or no-go for A1.7.

### A1.6 Query card
- Owner `ui` (ui-style skill: append-only, data-* hooks, slot rules, state-based smoke check), no modal using native dialogs.
- Needs: A1.3 (header shape final).
- Acceptance outline: a tool card shows the query text, the header (rows, kinds, scope, ref ids) and a row count with the result behind a handle; a refused ref shows the exact refusal message; no remote load without a click (TENET 17); smoke check asserts state, not pixels.
- Measure: none beyond the smoke check.

### A1.7 Full silo experiment
- Owner `context`; 3 runs per arm, three shapes, distinct salt, own wh dir and port per arm.
- Needs: A1.5 go; G0.
- Acceptance: results against the same thresholds as A1.5; per-model concept results with evidence paths; faults for model misuse (malformed queries, imitated ref strings); cost per arm.

### A1.8 Open-question measures
- Owner `context` (measures) and `seams` (changes, each its own commit with a reason).
- Needs: A1.7 data.
- Acceptance: OQ2 (label form), OQ3 (ref string), OQ4 (default scope `{queries:8}` against REF_EXPIRED), OQ7 (descriptor first versus always), OQ9 (staged intent: inferred get or property used against re-running), OQ13, OQ14 each answered from data as supersede records; a changed default means a new strategy minor.

### A1.9 Settable kinds and drill-in
- Owner `seams`; `context` measures.
- Needs: A1.8.
- Acceptance outline: `handle` kind with a settable `view` through `handles.point`, audited (OQ6); the drill-in rate (model follows a declared interaction rather than re-running a query) recorded under flow `ep-A1.9-drill-in`. A model-visible change is a new strategy major, with the old one left as is.

### A1.10 Judge, record, release
- Owner `judge` (reads catalog, specs, size rules; edits nothing), then `steward`.
- Needs: A1.3 to A1.9 as done; suites green.
- Acceptance: findings go back through steps 3-4 as spec changes; after the judge passes, merge `dev` into `main`; `version.json` updated; inboxes merged; `docs/PROTOCOL.md` and `docs/TESTING.md` updated.

### A1.11 Stage-1 self-hosting
- Owner `context`.
- Needs: G1.
- Acceptance: three read-heavy stories from B1 or A3 (reading profiles, catalog or the ledger) are run once under stage 0 and once under stage 1; cost, tokens and result quality recorded; the finding that decides whether stage 1 is the default for research stories.

## Dependencies and lanes
Order: A1.1 then (judge passes) A1.2 then A1.3 then A1.4, A1.5, A1.6, then A1.7, A1.8, A1.9, A1.10, A1.11.
Parallel in separate sessions (different files and inboxes): A1.1 and the three judge passes; A1.4 and A1.6 after A1.3 (A1.4 writes the stripe and reducer files, A1.6 writes the page files); A1.8 measures and A1.9 spec writing after A1.7. Never parallel: A1.3 and A1.4 on `app/tools.js` (one owner at a time).

## Measurement points
1. A1.1: stage-0 solve rate under `strat-stem-1.0` (baseline for everything).
2. A1.3: result tokens per query against ranged reads (OQ5).
3. A1.4: stripe overhead and saved tokens per size.
4. A1.5: canary, three arms (go or no-go).
5. A1.7: full silo against thresholds.
6. A1.8 and A1.9: per-open-question and drill-in rate.
7. A1.11: stage 0 versus stage 1 on real epic stories.

## Risks recorded in advance
- Models write malformed queries often enough that the surface costs more than it saves (OQ1); then the answer is a smaller grammar or a reducer-only release.
- Striping may be a net loss at these sizes; then A1.4 closes as deferred with evidence.
- Strategy ids: any change to the tool schemas, header form or descriptor text after A1.5 creates a new minor or major, and the A/B restarts for that arm.
