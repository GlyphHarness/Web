# A3.1 protocol: step validators from a second skill (fixed before scoring)

Story A3.1 (`docs/epics/A3-flow-loop.md`), flow concept F1 (`docs/concepts/FLOWS.md`). Stage 0: cheap non-Anthropic models through the harness. Base 3add2df (dev). This note is committed before any live run and before any shape was resolved against the corpus; the results note is `a3-validators-2026-11-21.md`.

## Claim and falsifier
Claim: the step bullets of `.claude/skills/context-experiments/SKILL.md` yield validators with a checkable shape (step, expected evidence, result) that resolve against recorded sessions, and cheap models can write the same extraction from the text.
Falsified if most bullets give no checkable shape, or most shapes cannot be resolved from session records alone. "Most" is more than half of the 24 bullets. Reported either way.

## Source
- `.claude/skills/context-experiments/SKILL.md` at 3add2df. The 24 list bullets found by `app/validators.js` `bullets()`: Steps (lines 10-17, 8 bullets), Rules (20-32, 13), Records (35-37, 3). `catalog/SKILL.md` is not used: the first source did not yield too little to decide.

## What counts as a checkable shape
A bullet yields a shape when its own text names evidence that tool calls or ledger rows could show, in this fixed vocabulary:
- path: a file path in a tool call's arguments
- command: a shell command line in a tool call's arguments
- content: other text inside a tool call's arguments (text written to a file)
- strategy: the strategy id on the ledger rows (passes when every main row matches)
- cache: a predicate over consecutive ledger rows (`write>0,cached>0`: a row with cache write, then the next row with cache read)
- field: a named field of the session record
- cost: a cost limit of the session
Checks: presence, order (two expected items, the second after the first), cost. Evidence another bullet names does not count for this bullet. A bullet with no shape gets one reason: judgement, turn-text, cross-session, bytes, not-built.
Strength (hand only): strong = a pass entails the act the bullet asks for; weak = a pass shows only that a named thing was touched, or a state that fits the act.

## Hand extraction
One extractor (the operator, the same model family as the story's agent), no second rater: a limit, not corrected for. Written in `scripts/a3-hand.mjs` before any cheap model ran and before any shape was resolved against the corpus. Per shape: witnesses (strings a faithful pattern must match) and decoys (near misses it must not match). Emitted with text hashes to `a3-validators-hand-2026-11-21.json`. Result of the extraction: 14 shaped (12 strong, 2 weak: lines 13 and 24), 10 not shaped.
Self-check before commit: each hand pattern was run against its own witnesses and decoys (all 14 consistent, no pattern changed afterwards). The code path was smoke-tested on one synthetic session; no shape was run against the corpus.

## Records (corpus)
`scripts/a3-lib.mjs` `loadCorpus()` over the checkout at 3add2df:
- `docs/concepts/profile-*.json` sessions (turn profiles; those with `perTurn[].args` carry paths and commands, content is hashed; those with main ledger rows carry strategy, rows, cost)
- `docs/live-evidence/*.trace` read by `V.fromTrace` (messages with tool calls; paths, commands, content; no ledger)
- `docs/concepts/results/a1-baseline-2026-11-21.jsonl` rows (tool names, ledger rows, cost; no tool arguments)
101 records: 15 profiles (8 with arguments), 2 traces, 84 A1.1 rows.
Not in the corpus: stored sessions of wh dirs (`wh:s:<id>` lives in a browser profile, not in a file; the `--dir` holds only `log.jsonl` with sizes and hashes, no message text). Disclosed as the narrowing of "wh dirs" in the task.
The argument kinds (path, command, content) resolve through `V.resolve` of `app/validators.js` (unchanged): it sees every string argument and cannot tell a path from content or a read from a write. Strategy, cache, field and cost are resolved by `scripts/a3-lib.mjs` (the app has no ledger-kind checks).

## Measures (fixed)
1. Yield (hand): shaped bullets / 24.
2. Resolvable from records alone (hand): a shape is resolvable when at least one corpus record gives pass or fail (not unresolved). Reported over shaped bullets and over all 24. A fail from a record that did not attempt the work is a fail, not "not applicable" (no `flow_id` attribution exists); `applicable` (at least one pass) is reported separately. Also the share of shape x record pairs resolved.
3. Cheap models (per model, n = runs, cost): per run, bullets with a valid shape (`hasShape`: check not none, items well formed, patterns compile) / 24; on the 14 hand-shaped: model shaped, and equivalent to the hand shape (same evidence kinds, every witness matched by a model pattern, no decoy matched); on the 10 hand-none: model shaped (over-yield); model shapes resolvable on at least one record. Median and range over runs. Item without a `line` of a hand bullet counts as missing. Equivalence is a proxy for "same extraction", not for correctness of the pattern outside witnesses.
4. Cost: ledger `cost` of the session (main rows) per run and in total.

## Cheap-model runs
- Models: `qwen/qwen3.7-flash`, `tencent/hy4-flash` (the A1.1 pair, OpenRouter). No Anthropic model.
- Strategy `strat-serial-1.0` (blue), harness default sampling, no tools, one fresh browser context and one session per run, via `scripts/a3-driver.mjs` (page selectors and settle rule as `scripts/a1-baseline.mjs`).
- One message per run: the prompt of `scripts/a3-lib.mjs` `prompt()` (sha256 prefix `e488ebcedbf8fdf0`), 7979 characters: instructions, the item vocabulary, one two-bullet example, then the skill file with line numbers. The example is a bullet of another skill's text shape (spec-first, `.claude/agents/seams.md` path) and the cache grammar example does not name a hand answer. The model is not told any hand shape.
- Runs: 3 per model, order alternated per run, cap $0.50 for the whole stage, no canary stage (one message, no tool use; cost per run is below a cent by the price list). Runs that return no parsable JSON array count as runs with yield 0 and are listed; none dropped. No retries, no prompt change after the first run. A second prompt would be a new protocol note.
- Key: read from the secrets file by the driver process, written to the context's key store, never printed or stored; replies are masked before they are written.

## Disclosures (known before scoring)
- Single hand extractor and single prompt: the model/hand comparison measures this prompt, not the models in general.
- The hand shapes were written knowing `app/validators.js` and the corpus kinds; the corpus content was not read for shaping them.
- Hand `strength` is a judgement; the headline numbers are reported for all 14 and for the 12 strong.
- Dropped: nothing. Bullets 10 and 17 overlap (the inbox path), as do 35 and 36 with the same file; they are counted as separate bullets.
- Code needs seen while shaping, not implemented (routed to `seams` as fault/spec records in the results): content is hashed in profiles (a content shape would pass vacuously or fail falsely there); no read/write distinction (a forbidden `catalog/*.jsonl` would fire on a read); no group-level (cross-session) validators; no ledger-kind checks in the app; no `flow_id` attribution.
- Any change to scripts after this commit and before scoring is its own commit with its reason.
