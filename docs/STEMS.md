# Stems, handles and materialized context (design, 2026-11-19)

Goal: keep the core context terse and coherent while work runs elsewhere and results arrive asynchronously, reuse provider-held cache entries where that pays, and prove it with token measurements against plain serial turns.

## 1. Handles (main solution, first)

- **Opaque short ids** (`k7fq2x`): random base32, no order, no revision suffix, no type prefix. Nothing in an id tells the model what came before, what kind of thing it is, or how often it changed.
- **Re-pointed in the store, never edited in the context.** The id's bytes stay fixed in the cached prefix; what it resolves to changes under it (a stem's progress, its fold, a debugging view, a sealed redaction), per reader and per moment. The model sees state, not that it changed.
- **Pulled, not pushed.** The model is handed ids and resolves what it needs with the read tool it already uses for stored outputs. Its steering point is generic ("what do these hold now?"), not a narrative written for it.
- **One mechanism** for stored outputs, wake points, stem points and folds: id + resolver.
- **Audit outside the model.** Per turn the harness logs which ids were resolved and a hash of what each returned, so a review reconstructs exactly what was seen.

## 2. Stems (git branch + context branch)

- **Anchor**: the turn where the goal was stated, and main's head at that moment.
- **Context**: a branch session forked at the anchor turn (not the tail), reusing the cached prefix up to it; it carries the goal, its spec and the anchor commit. Its working turns never enter the core line.
- **Git**: `stem/<concern>`; first commit is the spec (checks that fail), then implementation to green; squash with `Goal`, `Anchor`, `Checks`, `Tested-At`; merge after catching up with main.
- **Core line**: holds only the stem's handle. The stem re-points it as it goes (progress before the fold), then to the fold. Folding late costs nothing extra.
- **Catch-up before fold or merge**: only changes that touch the stem's checks or files (from the per-check coverage map) count; none → fold/merge; some → rebase, rerun, then fold/merge.

## 3. Checkpoints, used when they pay

A handle point is a candidate cache breakpoint, not an obligation. The harness sets a real breakpoint only where reuse is likely (a stem expected to fold back, a long resolver thread, a hook that will fire again). Each checkpoint's ledger shows its cache write, later reads and net; kinds that never pay are dropped by the steering review.

## 4. CI records

On each push: main and git suites always; the machine suite on a schedule or when `app/vm*` changes. Each run posts a commit status and a record (commit, suite, per-check result, failing checks, log tail, modules each check exercised via Playwright coverage). A failure becomes a `ci-failure` concern whose handle the handler re-points as it works: rerun on head first, then the break window filtered by coverage, then bisect; fix forward on main.

## 5. Specs first

Checks are written from the goal before the implementation, assert on state (whDebug, data attributes), not display text, one acceptance check per sentence of the goal. Changing a spec check during implementation is its own commit with a reason.

## 6. Micro-context resolver (after 1–5)

A small helper model takes hints (the core's next question, its recent turns, the handles in view) and chooses, case by case, which handles to materialize at the leading edge of the request and to what. The leading edge reveals the pertinent context; new handles are embedded along the way, so the same approach continues into stems and their own resolution. Its picks are logged with the audit, and it can be switched off per case to compare.

## 7. Case studies (measure everything against plain serial turns)

Each case is a scripted scenario (for example: a CI break fixed while the core keeps working), run under:

| Variant | Core holds |
|---|---|
| S, serial (baseline) | every turn's full text, no handles, no stems |
| A, concrete | event text embedded in turns |
| B, pulled handles | opaque ids, resolved by the model on demand |
| C, + selective checkpoints | B with breakpoints only where reuse is expected |
| D, + stems | C with work in stems, progress and folds behind handles |
| E, + micro resolver | D with the helper choosing what to materialize |

Per variant, from the ledger: uncached input, cache write, cache read, output tokens, cost, turns, final core size, and **coherence** (scenario assertions that the core acted on the right state: a cheaper variant that loses track fails). Mock provider first (it models a prefix cache), then one cheap and one frontier model. Results as one table per scenario plus totals, published as a page and kept as a regression baseline.

## Build order

1. Opaque ids and per-reader resolution in the store (stored outputs migrate to them).
2. Stems: anchor branching, re-pointed handle, fold, catch-up.
3. Selective checkpoints with paid-off accounting.
4. CI workflow, records, coverage map, ci-failure handling.
5. Case-study runner (S, A–D).
6. Micro resolver (E), measured against the rest.

Each step lands spec first.
