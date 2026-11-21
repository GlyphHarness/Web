# Stems, handles and materialized context (design, 2026-11-19)

Goal: keep the core context terse and coherent while work runs elsewhere and results arrive asynchronously, reuse provider-held cache entries where that pays, and prove it with token measurements against plain serial turns.

## 1. Handles (main solution, first)

- **Opaque short ids** (`k7fq2x`): random base32, no order, no revision suffix, no type prefix. Nothing in an id tells the model what came before, what kind of thing it is, or how often it changed.
- **Re-pointed in the store, never edited in the context.** The id's bytes stay fixed in the cached prefix; what it resolves to changes under it (a stem's progress, its fold, a debugging view, a sealed redaction), per reader and per moment. The model sees state, not that it changed.
- **Pulled, not pushed.** The model is handed ids and resolves what it needs with the read tool it already uses for stored outputs. Its steering point is generic ("what do these hold now?"), not a narrative written for it.
- **Steps stay in the turns.** Ids replace only what is bulky or changes (results, progress, folds, logs). Each turn keeps its pertinent step in plain text, tersely: asked, decided, done, open, with ids standing for what is behind it. Without the steps the chain is a bag of ids with nothing to reason along.
- **One mechanism** for wake points, stem points and folds: id + resolver. Stored outputs keep their content-hash handles (`os:`): they never change, so there is nothing to re-point.
- **Audit outside the model.** Per turn the harness logs which ids were resolved and a hash of what each returned, so a review reconstructs exactly what was seen.

## 2. Stems (git branch + context branch)

- **Anchor**: the turn where the goal was stated, and main's head at that moment.
- **Context**: a branch session forked at the anchor turn (not the tail), reusing the cached prefix up to it; it carries the goal, its spec and the anchor commit. Its working turns never enter the core line.
- **Git**: `stem/<concern>`; first commit is the spec (checks that fail), then implementation to green; squash with `Goal`, `Anchor`, `Checks`, `Tested-At`; merge after catching up with main.
- **Core line**: holds only the stem's handle. The stem re-points it as it goes (progress before the fold), then to the fold. Folding late costs nothing extra.
- **Catch-up before fold or merge**: only changes that touch the stem's checks or files (from the per-check coverage map) count; none → fold/merge; some → rebase, rerun, then fold/merge.

## 3. Checkpoints, used when they pay

A handle point is a candidate cache breakpoint, not an obligation. The harness sets a real breakpoint only where reuse is likely (a stem expected to fold back, a long resolver thread, a hook that will fire again). Each checkpoint's ledger shows its cache write, later reads and net; kinds that never pay are dropped by the steering review.

### Built (v0.49.0)

- Kinds: `system` (end of the system prompt and tools), `tail` (the last message), `stem` (a stem's anchor). `settings.bpKinds` switches kinds on and off. Models with explicit breakpoints get them (Claude/Anthropic ids, and the mock's `mock-bp`); others get none and are measured from their reported usage as before.
- The stored log is unchanged; only the request as sent carries `cache_control` parts.
- Accounting (`app/checkpoints.js`, shown under Smells next to the targets): a record per checkpoint, keyed by a hash of the prefix it ends, shared across sessions. A read goes to the deepest known checkpoint the request starts with, so a shallow one pays only when the deeper ones miss (the system checkpoint pays when a new session starts on the same prefix). Writes are split: each new checkpoint owns its own segment. Characters per token are calibrated from each request's own prompt count.
- The mock models breakpoint caching (entries written only at marked points; a request reads the longest written prefix it starts with), so the case studies can run offline.

## 4. CI records

On each push: main and git suites always; the machine suite on a schedule or when `app/vm*` changes. Each run posts a commit status and a record (commit, suite, per-check result, failing checks, log tail, modules each check exercised via Playwright coverage). A failure becomes a `ci-failure` concern whose handle the handler re-points as it works: rerun on head first, then the break window filtered by coverage, then bisect; fix forward on main.

### Passes are silent; failures wait until they matter

- A check that passes needs no wake: its handle resolves as passed as if it had passed when it ran. No turn is spent on it.
- Until a result exists the handle resolves as pending, never as passed.
- A failure is not delivered as a past event to reason backwards from. It is held behind its handle and addressed when the work in hand touches it (its files, its goal) or when nothing else is running, not as an interruption.

## 5. Specs first

Checks are written from the goal before the implementation, assert on state (whDebug, data attributes), not display text, one acceptance check per sentence of the goal. Changing a spec check during implementation is its own commit with a reason.

## 5b. Confer at checkpoints (cross-causal)

A stem's continue point is a checkpoint that looks like any other turn but is kept for reuse: its prefix stays cached, so the model can be asked again *as it was then*.

- **A, ahead (the edge):** the model at the latest turn states what it plans to do next. Terse by default (a few lines); verbose only past a threshold (when B found a divergence, or the plan touches more than one goal).
- **B, look-back (the checkpoint):** the model at the stem's checkpoint, with its own goal in its context, is given the edge turns since then (their step lines and handles, not their bulk) and asked to compare: what the edge did against what it set out to do, and what it would do between.
- **Consult:** A and B together give the intermediate range: drift, skipped steps, goals met by accident, plans that no longer fit. A short consult turn (either side, or a small model) turns that into one correction or "no change".
- **A graph, not a pair:** any two checkpoints can confer (an earlier self checks a later one; a later self revisits an earlier goal). Edges are recorded as handles; nothing enters the core line unless the consult changes the plan, and then as one step line.
- **Cost:** B is a cache read of a prefix that already exists plus a small delta; confers are side requests with their own ledger rows, measured like everything else.

## 5c. Policy-based steering and probe checkpoints (design, not built)

Steering is policy, not nudges. An operator (person or agent) states a goal once; the strategy decides when to remind, what to materialize, and when to checkpoint. A nudge typed mid-run is a missing directive, so each one is worth recording as a concern.

- **Directives live in the strategy**: a system-prompt base plus hooked turn wrappers, versioned with the strategy id (§8), so a change to steering is a new strategy and is measured like any other.
- **Probe turn**: at the end of a *group* (a run of turns that belong together), the harness sends the context so far plus a closing marker `[label · tag, tag, tag]`, asks for a minimal reply (one word), and **throws the reply away**. It is not stored in the log, not shown, and not billed to the core line; it has its own ledger row (kind `probe`). Its only product is a provider cache entry for the prefix up to that boundary.
- **Ambiguous on purpose**: the label and tags are short and do not say what to do. They sit in the cached prefix as opaque markers, like handles (§1). Meaning is supplied later: when a request is built, a resolver (step warp / crafting, §6) may materialize a label or tag into whatever the policy wants (a reasoning hint, goal framing, which handles to open) *after* the cached prefix. The cached bytes never carry a concrete steer, so the conversation can be shaped differently per request without losing the cache or baking in a steer that cannot be undone.
- **Why**: on models with automatic caching and no explicit breakpoints, a probe puts an entry where we choose instead of where the provider happens to (live, qwen3.7-flash got no cache hits on its first six requests: `docs/live-evidence/2026-11-19-windows-chrome.md`); on explicit-breakpoint models a probe is a breakpoint written once; and the ambiguity keeps room to steer.
- **Accounting**: a probe pays when later reads of its prefix save more than its write cost (its output is one token); kinds that never pay are dropped by the steering review (§3). The probe must share the real requests' exact prefix bytes and upstream (`provider.order`), or it warms nothing.
- **Seams**: strategy fields `directive`, `probes` (where a group ends: turn count, token threshold, stem anchor, bulky tool result) and `tags`; a resolver hook that maps markers to materialized context.
- **Open, to settle by a live run first**: whether a small `max_tokens` request writes a cache entry on each provider; how many tokens a group needs before a probe pays; the tag vocabulary; whether resolver output is appended after the prefix or rewrites the tail.
- **Measurement**: variant G in §7 (F plus probes) against serial and C on the same scenarios: uncached input per request, cache-read rate, and the probes' added cost. Live first: one probe at about 4k tokens on qwen3.7-flash, then compare `cached_tokens` on the next three requests.

## 5d. Ephemeral nudge turns and grafting (design, not built)

A nudge is a turn the harness adds, not a message the operator types. It is how policy (§5c) reaches a model that is wandering.

- **The nudge turn**: one ephemeral turn carrying a *judged payload* (terse data about the past turns: step lines, handles, flags, counts, not their bulk) and an instruction that names what to do ("judge these; say the next action and the way you will do it; then do it; no deliberation"). The assistant answers with one commitment line and keeps to it.
- **Lightweight turns follow.** After a few turns (a count, or when the commitment is met or broken) the nudge and its payload are dropped from the context going forward. What stays is the commitment line and the pertinent turns' step lines, behind a checkpoint `[label, tag, tag]` (§5c) that a later request can resume from.
- **Cache, said plainly.** Turns after the nudge sit after its bytes, so dropping it changes their prefix. The resume therefore continues from the checkpoint *before* the nudge and tacks on the step lines; the prefix up to the checkpoint stays cached, the new tail is written fresh. The nudge belongs at the leading edge for the same reason: nothing cached sits behind it.
- **Grafting is a helper's job.** A small model builds the payload from data, not content (the ledger, flags, step lines, ids and hashes), under a budget (default 10k tokens, tighter for most). A frontier model (for example Sonnet or Opus) then operates on that terse set. The frontier model never gets the bulk and the small one never has to judge it.
- **Cost rule: under one cent per operation, enforced.** `max_tokens` and the payload budget are set from it, each nudge and graft has its own ledger row (kinds `nudge`, `graft`), and an operation over the cap is a smell and stops to ask. Live reference: one 17k-token Sonnet request cost 3.5 cents (11k tokens written to cache), so a frontier operation fits under a cent only with a small payload and a cached prefix, or on a cheaper tier. Measured, not assumed.
- **Compare models.** The payload builders (`tencent/hy4-flash`, `qwen/qwen3.7-flash`, others) against each other and against no nudge, and the operators (Sonnet, Opus, a cheap model) the same way. Per run: cost per operation, whether the model committed and kept to it, repeated reads and drift, thinking tokens.
- **Why**: the nudges typed by hand in this project's live sessions (stop reading, copy the find string exactly, write now) are the cases to turn into policy, one directive each (§5c).

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
| F, + confer | E with A/B confers at stem checkpoints (cost against drift caught) |
| G, + probes | F with probe checkpoints (§5c) |
| H, + nudge and graft | G with ephemeral nudge turns whose payload a small model builds (§5d) |

Per variant, from the ledger: uncached input, cache write, cache read, output tokens, cost, turns, final core size, and **coherence** (scenario assertions that the core acted on the right state: a cheaper variant that loses track fails). Mock provider first (it models a prefix cache), then one cheap and one frontier model. Results as one table per scenario plus totals, published as a page and kept as a regression baseline.

## 8. Strategies (built, v0.50.0)

Orchestration is chosen, not hard-wired: a strategy is a named, versioned spec the turn loop reads at fixed seams, picked per session group (the `strategy` setting, through profiles), and recorded on every ledger row.

- Id: `strat-<name>-<major>.<minor>`. A major version changes what the model sees (turns, handles, tools); a minor one is harness-side tuning only. A changed spec gets a new version; ids are never reused (`register()` refuses).
- Built-ins: `strat-serial-1.0` (the baseline: no explicit checkpoints, no stems), `strat-checkpoint-1.0` (system and tail checkpoints), `strat-stem-1.0` (checkpoints, stems with an anchor checkpoint, pulled handles; the default).
- `strat-serial-2.0` (2026-11-20): serial with ranged reads (`reads: 'ranged'` in the spec). A line range asked of a file (`repo_read` with `lines`) or of a stored output (`output_read` with `lines`, or `offset` and `length` in characters) comes back whole up to 12,000 characters, cut at a line end with a last line naming the lines left out; a tool named inside `run_js` code gets a line saying it is a tool call of its own. The descriptions of `output_read` and `repo_read` differ from 1.0, so it is a major version; every other strategy is sent the definitions it was sent before.
- Seams today: which checkpoint kinds may be set, whether stems may open, handles. Seams to come: confer, the micro resolver, how stems spawn and fold, and per-turn wrappers (a strategy as a handler around the turn).
- Results by strategy and model (requests, cache rate, $/request, smells/request), shown under Smells. This is what routing will read: models slotted into the verticals (stems, resolvers, confers, cores) by measured proficiency under each strategy.
- The case studies (§7) are strategies run on the same scenarios; your own approach becomes one more strategy id in the same comparison.

## 9. Watcher and operators (v0.51.0)

- **Watcher** (`watchModel`, per session group): a small free or cheap model checks each tool call as it completes, refusals included, and answers `ok` or `FLAG: <reason>`. A flag goes on the session (`s.flags`) and is a smell, so it is tracked over time and reaches whoever oversees the session. Helper rows `watch` carry its cost.
- **Checked off**: every assessed call is marked (`s.watched[callId] = ok | flag`) and never assessed again; a backfill (`rewatch`) takes only unmarked calls. The operators' CLI follows the same rule: an assessment shows what is new since the last one.
- **Tests never use real models**: every suite and the case-study runner block OpenRouter and fail on any model request. Real models run only in production sessions, driven by operators with turns held and stepped.
- **Operators**: Claude Code sessions on Haiku drive harness sessions (cheap OpenRouter models) through a terse CLI (`scripts/wh.mjs`), assess them, keep them going, and bubble what the harness cannot resolve up to the main session. The OpenRouter key is a credential of the cloud environment: the network proxy adds it, so no session or transcript holds it.

## Build order

1. Opaque ids and per-reader resolution in the store; output_read pulls them.
2. Stems: anchor branching, re-pointed handle, fold, catch-up.
3. Selective checkpoints with paid-off accounting.
4. CI workflow, records, coverage map, ci-failure handling; passes resolve silently.
5. Case-study runner (S, A–D).
6. Micro resolver (E), measured against the rest.
7. Confer at checkpoints (F): A/B pairs first, then the graph.

Each step lands spec first.
