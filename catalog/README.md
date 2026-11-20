# Catalog

Three append-only catalogs, one JSON object per line. Ids: 6 lowercase letters, random, no order.

## nomenclature.jsonl (names)
`{"id","term","means" (<= 25 words),"see" (path),"aka":[],"since","supersedes"?}`

## concepts.jsonl (ideas, hypothesis to outcome)
`{"id","name","claim" (one sentence: what should be true),"status","models":[{"model","result","evidence" (path or issue)}],"since","supersedes"?}`
- `status`: hypothesis | specified | implemented | measured | deferred | not-supported.
- `models` records what each model did with the concept; empty until tried.

## faults.jsonl (what models get wrong)
`{"id","model","fault","class","seen" (date),"handled" (what the harness does now),"evidence"}`
- `class`: common (typical, expected) | uncommon (advanced, rare) | provider (route, not model).
- A fault of the page, the harness or the operator (not of a model) is recorded here too, with `model` starting `none (` and saying what it was; its `evidence` names the issue or the CI runs.

## Rules
- Append only. A change is a new line with `"supersedes": "<id>"`. The current view is the last line of each chain.
- Nothing is deleted. Negative results (`not-supported`) and concepts with no benefit yet stay: `deferred`, never dropped.
- Check first: grep for the term or concept before adding (see `.claude/skills/catalog/SKILL.md`).
- Normalized: fixed field names, enumerated `status` and `class`, models by id in `models`, dates YYYY-MM-DD, one record per line.
- One term, one line. `means` stays short; link detail by `see`, do not copy it.
- ASCII only. Dates are YYYY-MM-DD.

## No races
- Agents never write the catalog files. Each writes `catalog/inbox/<agent>-<shortid>.jsonl`.
- Each inbox line is the record plus `"to": "nomenclature" | "concepts" | "faults"`.
- Only the steward appends inbox lines (without `to`) to the catalog files and deletes the inbox file in the same commit.
- `catalog/inbox/.gitkeep` keeps the folder.

## With docs/concepts/
`catalog/*.jsonl` is the index of record (one line per term, concept, fault; status; per-model results). `docs/concepts/*.md` is the prose it points to: the why, hypotheses H1.. in full, the programme.
Concepts C1..C17 of `docs/concepts/CATALOG.md` are records by name; hypothesis ids sit in `claim` or `evidence`. Status map: idea=hypothesis, spec=specified, built=implemented, tested=measured, promoted=measured (the promotion itself is only in PROGRAMME.md), dropped=not-supported.
Names follow docs/concepts; the other name stays in `aka`. Prose is never rewritten from here.

## Order of work
name it -> concept (hypothesis) -> spec -> implement -> measure -> record result and faults -> judge -> release.

## Conceptual, not built
Nothing below exists yet; do not develop it now.
1. Analyze: an agent reads the records for patterns and emergent concepts, and names the issues and solutions its findings imply.
2. Query and arrange: an agent fetches records by model, status or class and arranges them into actions (what to retry, defer or fix).
3. Drive context features: records choose strategy, checkpoint and watcher settings per model.
