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
| 12 | **Secrets stay out of records.** The API key is never in a session file or trace. | `store.js` key separation, `providers.js` trace record | L9 |

## Concerns (no enforcer yet)

| Concern | Note | Origin |
|---|---|---|
| Fold the source itself (new epoch) | Allowed only when `saved_tokens_per_turn * expected_turns > rewrite_cost`; compute from the ledger and catalogue prices. | L `shim.md` |
| Two views, one prefix | Derive the wire request as stable prefix + ephemeral edge instead of replaying the log. Today scratchpads are baked into the user message. | L12 |
| Bulky tool output by handle | Store the full result out of band; the log gets a capped view plus a handle. Today results are truncated at 8,000 chars and the rest is lost. | L5, L `output-store.md` |
| Persist text only | Rules for reasoning blocks and provider cache markers before `reasoning_details` pass-back is added. | L `shim.md` |
| Branch budgets | Cap a branch by tokens, not only by 8 tool rounds; suggest a branch when a session passes a size threshold. | L10, L11 |
| Model per branch | A cheaper model for lookups breaks the shared prefix; measure before adopting. | L, S |
| Progressive exposure of context files | Index line in the prefix, bodies fetched by handle. Not built. | L2 |
| Trail of attempts | Terse rows (tried, failed with retry-if, worked, settled) so a later branch does not re-explore. | L11 |
| Catalog before choosing; steer gates | Approaches as append-only rows; proposals as default + alternatives + metric. | L3, L4 |
| Separate critic for "done" | A fold's OUTCOME is the branch's own claim; nothing checks it. | S |
| Provider cache facts | Cache floor, TTL, write timing and breakpoint limits per provider are unmeasured. The ledger is the probe. | L `shim.md` |
| Rewind does not undo tool effects | Applies once rewind exists. | L `output-store.md` |
| Traces hold message text | Redaction before export is not built. | L9 |
| Parallel branches share scratchpads | Two branches can write the same pad; last write wins. | W |
