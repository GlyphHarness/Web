# Recrafting wordy output: voice structure and domain annotation (design, 2026-11-19, not built)

Some cheap models are wordy: live on `tencent/hy4-flash` one small task took 18k output tokens of reasoning that circled ("wait", "but", "actually") before one edit. What later turns need is what the model decided, not how it dithered. A helper model can restructure the thought and drop the loops, if it does so without changing meaning and without renaming anything that is a name.

## 1. The recraft pass

- **One item, not a conversation.** A helper worker gets one reasoning block or reply plus a one-line statement of the concern it serves, and returns it restructured: what was decided, what is open, the next step. It does not see the session's context and carries nothing from one item to the next.
- **Fidelity before style.** Content, facts and numbers are kept. Hedging loops and self-corrections that end where they began are dropped; a correction that changes the outcome is kept as the outcome. If the pass cannot tell, the item passes through unchanged (TENETS 25: a failed helper passes through).
- **Never renamed**: proper nouns, identifiers, paths, code, quoted strings, numbers, and anything that is a label or the name of a group of things (branch names, tags, profile names, stems, handles, concerns).
- **Raw stays raw.** The stored log and exported traces keep the model's own words. The recrafted text is what later turns carry, with the raw one pulled by its handle (STEMS.md §1), so nothing is lost and the cost is the short version.
- **Batched and metered.** Items go through the steward's one request (README: steward), with their own ledger rows, so the saving can be set against the pass's cost.

## 2. Voice structure: a catalog, not one style

A *voice* is a named way of sounding, each with a structure, a before/after, when to use it, and how much connective reasoning it keeps (its degree of coherence). Axes: density, hedge level, person (I, we, imperative), tense, shape (list or prose). A first catalog lives in `recraft/voice-skill.md`: `terse-log` (the step line of STEMS.md §1: asked, decided, done, open), `plain-brief`, `plan-list`, `rationale-short`, `question`. Which voice a pass uses is policy (a strategy field), so changing how the conversation sounds is a new strategy version, measured like any other, and not a rewrite of stored context.

Per model, the catalog records the habits seen (loops, restating the task, narrating each tool call) so the pass targets those.

## 3. Domain terms: crafted vs regular

Terms are annotated in two layers:

| Kind | Meaning | Treatment |
| --- | --- | --- |
| `crafted` | coined by the project or the instance (stem, fold, handle, steward, concern, probe) | protected; defined once in the glossary |
| `proper` | names of things (repos, branches, models, people, files) | protected, never renamed |
| `label` | tags and group names the session itself made | protected |
| `regular` | ordinary words | free to rephrase |

First pass, simple and deterministic: scan against the glossary and against patterns (backticks, identifiers, paths, capitalised names, the session's own labels) and mark protected spans. Second pass: the helper, zero-shot, reads the text and proposes candidate terms the first pass missed; proposals are added to the glossary as `candidate` entries (never as renames) and become `crafted` or `proper` when accepted.

## 4. The skill blob

One markdown artifact per instance holds the voice catalog, the glossary and the per-model habits. Helper workers read it before the work, as a stable prefix of their request (so it is cached, a `system` checkpoint, STEMS.md §3), then the one item. They hold no context per translated turn; what accumulates is the artifact. Updates come from the second pass, accepted by policy or a person, and are versioned (a new id for a changed blob; ids are not reused).

## 5. Measure

- Fidelity: scenario assertions that the same decisions, identifiers and numbers survive (no protected span changed), and a sampled false-drop check against the raw text (TENETS: a wrong helper extract looks like a fact).
- Saving: later turns' input and the worker's own tokens against the raw reasoning carried whole.
- Effect on the core: does the model reason worse when its earlier reasoning is the recrafted version? Same scenario with the pass on and off.
- Corpus to start: the reasoning from the live runs on `tencent/hy4-flash` and `qwen/qwen3.7-flash`.

## 6. Open

- Providers that need reasoning blocks passed back unchanged (TENETS: persist text only, `reasoning_details`): the pass touches only text we persist, never signed blocks.
- Whether the second pass should run per session or on a schedule over many sessions' candidates.
- How the pass and the probe turns of STEMS.md §5c interact: markers in a recrafted block must stay opaque.

Seam: strategy field `recraft: { on: 'persist' | 'off', voice, skill }`.
