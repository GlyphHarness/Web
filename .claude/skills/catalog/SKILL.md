---
name: catalog
description: Add or change a nomenclature, concept or fault record, or read the current catalog view. Use whenever work introduces a term, idea or model fault.
---
## When
- A change introduces a name, a concept, or a result.
- A model fault or shortfall is seen.
- You need the current meaning, status or fault class of something.

## Steps
1. Pick the catalog: names -> `nomenclature`; ideas and their outcome per model -> `concepts`; model faults -> `faults`. Shapes: `catalog/README.md`.
2. Check it does not exist: `grep -i "<term>" catalog/*.jsonl` (also try an alias). Found: change it (step 3), do not add a twin.
3. Write `catalog/inbox/<agent>-<shortid>.jsonl`, one line per record, each with `"to": "<catalog>"` plus the record. New id: 6 random lowercase letters not present in `catalog/*.jsonl`.
4. A change or result is a new line with `"supersedes": "<old id>"` that carries the full record. Never edit or delete an old line.
5. Hand the inbox file to the steward (name its path in your report). Do not append to `catalog/*.jsonl` yourself.
6. Read the current view: take the last line of each `supersedes` chain; ignore lines another line supersedes.
   `grep -i "<x>" catalog/concepts.jsonl` then follow `supersedes` ids to the last line.

## Rules
- Append only; negative results stay (`not-supported`, `deferred`).
- Concept status moves hypothesis -> specified -> implemented -> measured, or deferred / not-supported; each move cites evidence (path or issue) per model.
- Fault `class`: common, uncommon, provider. Real sessions only, driven as a person drives them.
- `means` <= 25 words; `claim` one sentence; ASCII; dates YYYY-MM-DD.
- Conceptual only, do not build (README): an agent analyzes records for patterns and emergent concepts, issues and solutions; fetches and arranges them into actions; records drive context features per model.

## Records
- Reads: `catalog/nomenclature.jsonl`, `catalog/concepts.jsonl`, `catalog/faults.jsonl`.
- Writes: only `catalog/inbox/<agent>-<shortid>.jsonl`. The steward merges and deletes it in one commit.
