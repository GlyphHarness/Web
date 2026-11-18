# Tenets and concerns

A tenet is listed here only with the thing that enforces it. A rule with no enforcer is a concern, and sits in the second list until it has one.

Origins: `L` = glyphcore/lodestar (`CLAUDE.md`, `docs/design/`), `S` = glyphcore/Strudel-craft (`CLAUDE.md`, `docs/ISSUES_PROTOCOL.md`), `W` = decided in this repo.

## Tenets (enforced)

| # | Tenet | Enforcer | Origin |
|---|---|---|---|
| 1 | **Append-only log, sent as stored.** A request is the previous request plus a tail. | `context.js` `buildRequest`; smoke test "keeps the full prefix" | W, L12 |
| 2 | **Static first, dynamic last.** System prompt and tools open the request; concern text, folds and scratchpads go at the tail. | `buildRequest`, `padAttachment`, `concernMessage` | W, L12 |
| 3 | **Drift has a named cause.** A broken prefix is reported with the first block that differs (model, tools, message n). | `context.js` `measure` (`broke`), ledger row tooltip | L `shim.md` |
| 4 | **Metrics, not narration.** One ledger row per request: prefix kept, prompt, cached, out, cost; totals per session and with branches. | `measure`/`report`, `ledgerSum` | L6 |
| 5 | **Evidence, not claims.** What happened is shown from the harness's own records (requests, tool calls, tokens, cost, raw trace). The model is told not to recount its steps. | `auditOf` and the audit table, fold attributes, `FOLD_SHAPE`, `.trace` export | W |
| 6 | **One concern per branch.** A branch works one named concern and cannot fan out further. | `fan_out` depth check, unique-id check | L1, S |
| 7 | **Fork from the built prefix, do not grow.** A branch starts as the byte-identical source log; its turns never enter the source. | `fork`, `inherit`; smoke test "branch keeps the whole source prefix" | L11, S |
| 8 | **The fold is a pocket, not a log.** Fixed shape (OUTCOME, RESULT, EVIDENCE, OPEN), capped at 2,000 chars, appended as one batch, never spliced. | `FOLD_SHAPE`, `foldOf`, `fanOut` return value | L `worker.md` |
| 9 | **Graft by handle.** A fold carries its branch id; the full transcript is fetched only on demand. | `foldTag`, `branch_read` | L7, L5 |
| 10 | **Siblings wait for the first cache write.** The first branch goes out alone until its response starts. | `fanOut` (`warm`) | W |
| 11 | **Forward-only data.** Schema number, migration steps never edited, newer data refuses to load. | `migrate.js`; smoke test "newer-schema data" | W |
| 13 | **Nothing is lost, nothing is re-run.** A tool result over 1,500 chars is stored whole under a content handle; the log gets a short view and the handle. | `outstore.js` `view`, `output_read`; smoke tests "output store" | L5, L `output-store.md` |
| 14 | **Branches are budgeted.** A fan_out branch stops when its prompt + output tokens pass the budget (default 150,000), and at 8 tool rounds. | `turns` budget check, Settings field | L10 |
| 15 | **Folding the source opens a new epoch.** The old session is never edited; a branch writes a pocket and a new session starts from it. The break-even is shown before any spend. | `epoch` action, `foldCase`, `POCKET_REQUEST`; smoke test "fold session" | L11, L12 |
| 16 | **The stage is derived from the log.** Widgets are rebuilt from `show_widget` calls; a slot shows its latest call. | `showWidget`; smoke tests "widget", "slot reuse" | W |
| 17 | **No remote load without a click.** A model-chosen URL is fetched only after the user presses its button. | `widgets.js` `remote` | W |
| 18 | **Every action leaves a trail row.** One row per tool call (tool, argument shape, outcome, size, time, session), written by the harness whatever the model says. | `tools.js` `execTool`, `patterns.js` `trailAdd`; smoke test "trail" | L6, L11, W |
| 19 | **Attribution is not self-reported.** A stored pattern's author (session, message, model, time) is written by the harness; refs that do not exist in the authoring session are dropped. | `patterns.js` `put`, `ctx.by`, `ctx.knownRef`; smoke test "attribution" | W, L9 |
| 20 | **Link by handle, never embed.** Patterns point at outputs and branches by handle. | `put` (`refs`) | L7 |
| 21 | **Patterns are exposed progressively.** Index line first (session start, `pattern_find`), body on request (`pattern_get`). | `patterns.js` `index`, `line` | L2 |
| 22 | **Structures become slots.** A recipe is a stored tool call with `{{slot}}` placeholders; the model supplies only the values. | `patterns.js` `fill`, `pattern_run`; smoke test "recipe" | W |
| 23 | **Same content, same id.** A pattern's id is a fingerprint of its content; replacement is by `supersedes`, not edit. | `put` (hash id, `superseded_by`) | L4 |
| 24 | **Long arguments leave the log once, at append time.** A call over 400 chars of arguments is logged as `{ref, name}`; the text is stored by handle. The logged form is itself a valid call. | `main.js` swap in `turns`, `tools.js` ref resolution; smoke test "arguments" | L `output-store.md` |
| 25 | **Filters before models; a failed helper passes through.** Every result is squeezed deterministically. A long one is reduced by what the caller said it wants: helper model if set, else keyword lines, else head and tail. | `outstore.js` `squeeze`, `shortlist`, `present`; smoke tests "results" | L `output-store.md`, L `squeeze.md` |
| 26 | **The helper is metered.** Each helper request is traced and has its own ledger row. | `main.js` `helper` | L6 |
| 12 | **Secrets stay out of records.** The API key is never in a session file or trace. | `store.js` key separation, `providers.js` trace record | L9 |

## Concerns (no enforcer yet)

| Concern | Note | Origin |
|---|---|---|
| Fold break-even is advisory | The estimate is shown, not enforced, and assumes 600 pocket tokens and full cache hits. Calibrate from real traces. | L `shim.md` |
| Two views, one prefix | Derive the wire request as stable prefix + ephemeral edge instead of replaying the log. Today scratchpads are baked into the user message. | L12 |
| Stored output is never pruned | Blobs live in IndexedDB until the browser clears them; no retention rule. | L `output-store.md` Q5 |
| Models may not send `want` | Filtering by intent depends on the model filling `want`. Measure how often a long result arrives without it. | W |
| Helper accuracy | Nothing checks a helper extract against the stored output; a wrong extract looks like a fact. The handle is always attached. | L `output-store.md` (false-drop rate) |
| Models imitating `{ref}` | A model may copy the logged form with a made-up handle; it gets a 'No stored call' result. Watch the rate. | W |
| Auto-recipes from stored calls | A named stored call is not yet offered as a recipe; the trail has what is needed (`ref`, shape). | W |
| View threshold vs cache floor | 1,500 chars is a guess; a view that is too thin shows up as an `output_read` after every call. Measure the read rate. | L `output-store.md` Q3 |
| Persist text only | Rules for reasoning blocks and provider cache markers before `reasoning_details` pass-back is added. | L `shim.md` |
| Suggest a fold or branch by size | Nothing prompts when a session passes a size threshold. | L11 |
| Widget events spend a turn | Every form submit or `emit` is a full request; no batching or debounce. | W |
| Widget library | Built-ins are fixed in `widgets.js`; no way to register one from a context file or the repo yet. | W |
| Model per branch | A cheaper model for lookups breaks the shared prefix; measure before adopting. | L, S |
| Progressive exposure of context files | Index line in the prefix, bodies fetched by handle. Not built. | L2 |
| Storing a pattern is the model's choice | The trail is automatic, but `pattern_put` only happens if the model calls it. Candidate enforcer: require a pattern line in the fold shape, or have the harness propose recipes from repeated trail shapes. | W |
| Route by trail shape | Repeated identical argument shapes in the trail are recipe candidates; nothing mines them yet. | W |
| Pattern quality and decay | No check that a stored solution is right, no retirement of unused or failing patterns beyond manual delete. | S |
| Index growth | The session-start index is the top 20 by use; beyond that the model must search. Measure whether it does. | L2 |
| Recipes span one tool call | No multi-step recipes or recipe-of-recipes. | W |
| Steer gates | Proposals as default + alternatives + metric. | L3 |
| Separate critic for "done" | A fold's OUTCOME is the branch's own claim; nothing checks it. | S |
| Provider cache facts | Cache floor, TTL, write timing and breakpoint limits per provider are unmeasured. The ledger is the probe. | L `shim.md` |
| Rewind does not undo tool effects | Applies once rewind exists. | L `output-store.md` |
| Traces hold message text | Redaction before export is not built. | L9 |
| Parallel branches share scratchpads | Two branches can write the same pad; last write wins. | W |
