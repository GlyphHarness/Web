# A3.1 results: step validators from the context-experiments skill (stage 0)

Story A3.1, concept F1 (`docs/concepts/FLOWS.md`). Base 3add2df. Protocol (committed before any run or scoring): `a3-validators-protocol-2026-11-21.md`. Raw rows: `a3-validators-2026-11-21.jsonl` (6 sessions, replies masked). Hand extraction: `a3-validators-hand-2026-11-21.json`. Scored: `a3-validators-score-2026-11-21.json`, by `node scripts/a3-score.mjs`. Stage 0 only: qwen/qwen3.7-flash and tencent/hy4-flash, strategy strat-serial-1.0 (blue), OpenRouter, no Anthropic model. Total cost $0.0181.

## Verdict
Not falsified, narrowly, and the margin is thin on both counts. Of 24 bullets, 14 yield a checkable shape (58%) and 13 of those resolve (pass or fail) on at least one recorded session, 13/24 = 54% of all bullets. "Most" was set at more than half. But resolving is cheaper than it looks: only 3 of the 14 shapes ever pass on any record, and those 3 are weak evidence (below). No recorded session is one that followed this skill, so what is shown is that the shapes run on the records, not that they detect adherence.

## 1. Hand extraction (the baseline)
| measure | value |
|---|---|
| bullets | 24 (Steps 8, Rules 13, Records 3) |
| yield (a shape) | 14/24 = 58% (12 strong, 2 weak) |
| no shape | 10: cross-session 5 (16, 21, 22, 27, 32), turn-text 2 (20, 23), judgement 1 (15), bytes 1 (29), not-built 1 (26) |
| hand self-check (own patterns vs witnesses and decoys) | 14/14 consistent |
| resolvable (>=1 record pass or fail) | 13/14 of shaped = 93%; 13/24 of all = 54%; strong only 11/12 |
| applicable (>=1 record pass) | 3/14 (lines 11, 28, 30) |
| shape x record pairs resolved | 256/1414 = 18% |
Comparison, same method on the spec-first skill (F1 retest, concept uddhvk): 11/16 = 69% shaped. This skill is lower (58%): its Rules section is mostly about how to run experiments across sessions.
Corpus: 101 records (15 turn profiles, 8 of them with call arguments; 2 traces; 84 A1.1 rows). Only 10 records (8 profiles with arguments, 2 traces) carry tool-call arguments. The 91 others cannot resolve a path, command or content shape (unresolved, `no:args.*`); on those 10 the six path/command shapes (10, 12, 13, 14, 17, 37) all fail `absent`, correctly, because none is context-experiment work.
Why the 3 that pass are weak: line 11 passes on 93/93 ledger-carrying records (every row has some strat id: near-tautology); lines 28 and 30 (forbidden `promoted`, forbidden key-shaped string) pass on the 2 traces only by absence, and content is hashed in profiles. Line 24 (a cache write row then a cache read row) fails on all 93: no OpenRouter ledger row records a cache write (0 of 1435 A1.1 rows; 1307 have cache reads). Line 25 (`resolved` field) resolves on 0/101: no record holds it.

## 2. Cheap models, same text (n = 3 runs per model, one fresh session each)
Hand yield 14/24. Per-run values; medians over all runs (an unparsable run counts as yield 0, per protocol).
| | qwen/qwen3.7-flash | tencent/hy4-flash |
|---|---|---|
| runs, parsed | 3, 2 | 3, 3 |
| yield per run (of 24) | 13, 0, 11 | 12, 11, 11 |
| yield median (range) | 11 (0..13); parsed runs only 12 | 11 (11..12) |
| on the 14 hand-shaped bullets: model shaped it | 11, 0, 11 | 11, 11, 11 |
| equivalent to the hand shape (kinds, witnesses, decoys) | 4, 0, 3; median 3 | 4, 7, 6; median 6 |
| on the 10 hand-none bullets: model shaped it anyway | 2, 0, 0 | 1, 0, 0 |
| model shapes resolvable on >=1 record | 11/13, 0, 11/11 | 9/12, 11/11, 9/11 |
| valid items (no fault) | 24 of 24 in each parsed run | 24 of 24 |
| cost total, per run | $0.0072, $0.0024 | $0.0109, $0.0036 |
Reading: both models reach about 80% of the hand yield by count (11 of 14 hand-shaped, almost nothing extra), the same three misses in nearly every run (12 the mock-then-live order, 17 the inbox path, 30 the key rule), but only 3 to 7 of the 14 shapes are the same extraction by the witness proxy. The shared miss on line 13 is a witness miss: models name the side-goal case-study file, the hand names `docs/concepts/PROGRAMME.md`. Lines 25, 28, 35 and 36 mostly miss on kinds (the models name another evidence kind or none). The equivalence proxy is strict and one hand extractor sets its own witnesses; read it as "same evidence", not "better or worse".

## 3. Disclosures and deviations
- Tools were not off. The protocol said "no tools"; the driver never turned the session's default tools off. Tool rounds ran: hy4 runs 1 and 2 made 7 and 8 requests for one message (prompt tokens 67k and more, cost $0.0033 and $0.0043, about the same as its one-request run 3 at $0.0033, because that one reasoned long), qwen run 2 made 8 and stopped "after 8 tool rounds" with no JSON answer (cost $0.0052, 4x to 7x its other runs). The other three runs are one request each. The prompt gives the whole text, so a tool round was not needed. Not fixed: prompt and runs were not changed after the first run (protocol). Open: switch the page's tools off and rerun (resume below).
- qwen run 2 is kept as a yield-0 run, not dropped. Parsed-only numbers are shown beside.
- Scorer change after the protocol commit: it first took medians over parsed runs only, which the protocol does not say; changed to all runs before final scoring (interim scorer output at n=1 and n=2 was seen, with no effect on prompt, hand shapes or runs). The only code touched after commit 1 is `scripts/a3-score.mjs`.
- Order of models alternated per run as planned. No canary stage (protocol).
- One hand extractor, one prompt, three runs per model. Medians over 3 are a small sample; ranges are shown.
- Not in the corpus: stored sessions of wh dirs (kept in a browser profile; `--dir` holds sizes and hashes only).
- `V.resolve` sees every string argument and cannot tell path from content or a read from a write; line 37's forbidden `catalog/*.jsonl` would fire on a read.

## 4. Code needs (routed to seams, not implemented)
Recorded as faults in the inbox: content hashed in profiles (vacuous pass on forbidden shapes, false fail on presence shapes), no read/write distinction in argument evidence, no cross-session (group) validators (5 of the 10 shapeless bullets), no ledger-kind checks (strategy, cache, field) in the app, no `flow_id` attribution (a fail reads "not shown"), no OpenRouter cache-write in ledger rows.

## 5. Unmeasured
- Whether any shape detects adherence: no recorded session follows this skill with arguments kept; a positive-path session is the missing test.
- Models without tool rounds (see disclosures); a second prompt; more than 3 runs; other models; Anthropic models (barred at stage 0).
- A second hand rater; the 5 cross-session bullets as group validators.
- Resolution against wh-dir stored sessions.
- Cost beyond extraction: nothing was run to validate against live sessions.

## Resume
```
node scripts/a3-hand.mjs docs/concepts/results/a3-validators-hand-2026-11-21.json   # hand rows
node scripts/a3-score.mjs [--rows <jsonl>] [--tag main] [--json out.json]           # no key, no browser
node scripts/a3-driver.mjs --secrets C:/wh/secrets.env --runs 3 --first-run 4 --tag tools-off --cap 0.50   # live; the driver must first switch the session tools off (not implemented), new tag, new protocol note
```
Files: `scripts/a3-lib.mjs` (prompt, corpus, resolver), `scripts/a3-hand.mjs`, `scripts/a3-driver.mjs`, `scripts/a3-score.mjs`.
