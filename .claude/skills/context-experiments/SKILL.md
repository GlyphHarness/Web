---
name: context-experiments
description: How to run a context experiment (strategies, priming turns, warp, natural steering vs structured flows) as production-style sessions with a recorded result.
---

## When
A context concept (handles, stems, checkpoints, priming turn, warp, flow alteration by a second model) needs evidence. Not for CI or unit checks (mock only, `scripts/smoke*.mjs`). To describe how a run behaved from metadata first, see `.claude/skills/turn-analysis/SKILL.md`.

## Steps
1. Concept record first in `catalog/inbox/context-<shortid>.jsonl`, status hypothesis, with the claim (one sentence) and the metric.
2. Give the variant a strategy id `strat-<name>-<major>.<minor>` (major = what the model sees changes). Serial `strat-serial-1.0` is the baseline.
3. Mock first: spec the checks, run the mock case study, fix until green. The mock models a prefix cache; it proves mechanics, not model behaviour.
4. Choose the work: real development in this repo's domain (design, change, test, review, a side goal). Example: the side goal in `docs/case-studies/side-goal-2026-11-19-live.md`.
5. Run live: `node scripts/casestudy.mjs --live --repeat 3`, or by hand with `node scripts/wh.mjs` (held and stepped, as the person drives). Serial runs first as baseline.
6. Judge coherence on the model's answer: did the core act on the right state. A cheaper run that loses track fails.
7. Report median and range per strategy (requests, uncached input, cache write/read, output with reasoning, cost, final core size).
8. Write result and faults to the inbox, negative results kept with why and the model.

## Rules
- Production-style only: never one-off challenge sessions, never graft sessions set up only for the test, never arithmetic or puzzle prompts. Numbers a task needs may appear inside real work, not be the test.
- Observe natural steering first: let the model run the work unaided and note where it steers, before adding structure.
- Then compare: imperative structured workflow; turns altered in-line by content; turns materialized deliberately. One variable per strategy id.
- Steering points stay generic ("what do these hold now?"); steps stay in the turns in plain words; ids only for bulky or changing content.
- Priming turn (hypothesis, not built): a generic prompt turn whose reply is discarded, sent so the cache registers for the full byte-stable payload. Its refs are ambiguous or generic: they must not steer, yet be generic enough to be actionable in several directions later. Test it as a strategy variant; check cache write on the priming row and cache read on the next real turn.
- Warp (partly built): vary what a stem's downstream turns see by re-pointing handles or materializing turns; the model must not be told it changed. Record the content hash from `s.resolved` per turn.
- Second-model flow alteration (hypothesis, not built): hand the helper model procedures, background and the corpus (ledger, steps, handles) and let it swap or alter turns or the flow. Log its picks; allow switching it off per case to compare.
- Opportunistic strategies (apply only where a condition holds, such as long cores) are variants with their own id, compared with serial.
- Never edit cached bytes mid-run; a changed spec is a new strategy id.
- Tests and the mock never call real models; only operator-driven sessions do. The key is the environment's, never in a transcript.
- A fault is recorded per model, class `common`, `uncommon` or `provider`.
- Long variance is normal (reasoning 168..4755 tokens on similar turns): never conclude from one run.

## Records
- Result to `catalog/inbox/context-<shortid>.jsonl`: a concept line (`"to":"concepts"`) carrying the full record with new `status` (specified, implemented, measured, deferred, not-supported), `models[{model, result, evidence}]` (case-study path, strategy ids, median and range) and `supersedes` the earlier id.
- Faults (`"to":"faults"`): `id, model, fault, class, seen, handled, evidence`.
- Publish the table as `docs/case-studies/<name>-<date>.md`. The steward merges inboxes; never write `catalog/*.jsonl` directly.
