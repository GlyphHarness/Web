# WebHarness hypotheses (2026-11-19)

Written by a Fable subagent (run in Claude Code, not the API) from the specs and live evidence. Unedited below this note. After it was written the first turn profile arrived (`OBSERVATIONS.md`, 2026-11-19); where that data bears on a hypothesis it says so in the "Hypotheses touched" list there, as description, and this text is left as written. UI customization (C15 to C17) is built by parallel sessions as ordinary development, not as silo experiments; H12 onward will be added when the first profile of a silo run raises a question. Results of runs are appended under "Results" at the end.

Read for this: `docs/STEMS.md` (§3, §5b-d, §7, §8), `origin/spec-recraft:docs/RECRAFT.md` and `recraft/voice-skill.md`, `docs/TENETS.md`, `app/strategies.js`, `app/checkpoints.js`, `app/main.js` (turn loop, `aux`, `watchCall`), `origin/issue-1-gh-allowlist:app/main.js` (`shellRunner`, `agentRun`), `app/git.js` (edits), issues 1, 5, 8, 9, 11, 12, PR 15, `docs/case-studies/side-goal-2026-11-19-live.md`, and the live evidence note (it is on commit `5fe9221`, not on the checked-out branch). Nothing was run; every number below is a threshold to test, not a result.

## Shared rules for every experiment

- **Silo.** Each arm is its own profile (`exp-hN-blue`, `exp-hN-green`) whose repo allowlist holds only `GlyphHarness/wh-live-sandbox`, so `main` of Web cannot be written. Each arm commits to its own branch `exp/hN-blue` / `exp/hN-green`, seeded from the same commit (a copy of the files the task needs from `issue-1-gh-allowlist` or `main`). Where code exists, green is a new strategy id via `strategies.register()`; blue stays `strat-serial-1.0` unless stated. A winning diff is carried to a Web branch (never `main`) by a person through an approval card.
- **Canary, then full.** Canary = 1 blue + 1 green run, turns held (`wh pace both`), stop if green costs over 2x blue or writes outside its branch. Full = 5 + 5 runs, alternating order, fresh browser each, same model, same pinned upstream, same first message bytes except the arm's difference.
- **Why 5.** The live case study shows serial output ranging 7.1k to 14.9k on one script; a pass needs the green median better **and** at most one green run inside blue's range.
- **Operation** = one harness-added request (watch, helper, steward, probe, nudge, graft, recraft, confer). Cost from the ledger row, as OpenRouter reported it.
- **Operator nudge** = any `wh say` after the first message that is not an approval answer. Counted from the `wh` log.
- **Repeat rate** = tool results byte-identical to an earlier result of the same tool in the session / all tool calls (the rule `watchCall` already applies without a model).
- **First-try edit success** = `repo_commit` calls with `edits` that succeed / all such calls.

## Hypotheses, ranked by value x cheapness

### H1. Exact brief as directive
- **Statement:** A fixed three-line system-prompt base ("read a file once; copy each find string verbatim from lines you just read; one file per commit, then stop") lets hy4-flash and qwen3.7-flash finish a one-file fix with zero operator nudges, where the same task without it needs at least one.
- **Concept:** policy directive.
- **Real work:** the PR 15 tmux gap. Product: one commit that makes `shellRunner` pass the session on the tmux path (`agentRun(cmd, t, o)` → `agentRun(cmd, t, { ...o, session: s.id })` in `app/main.js`; `agentRun` already spreads `o` into `vm().run`), on a branch off `issue-1-gh-allowlist`.
- **Silo:** blue = current system prompt, first message "issue 1: the tmux agent path does not pass a session id; fix it". Green = same message, directive in the system prompt. Branches `exp/h1-blue`, `exp/h1-green` in the sandbox, seeded with `app/main.js` and `app/vm.js` from PR 15. Canary one pair on hy4-flash; full 5+5 per model.
- **Needs:** no code.
- **Metrics:** nudges green = 0 in at least 4 of 5 (blue expected ≥ 1 in at least 3 of 5); first-try edit success ≥ 80% green; repeat rate ≤ 10% green; diff is the one-line change and `node --check` passes; cost per run ≤ $0.02.
- **Cost cap:** $0.05 per run, $0.60 for the full comparison on both models.
- **Risk / a fail teaches:** the task is so small blue may also pass (then repeat on H8's larger task). If green still needs nudges, wording in the system prompt is not enough and the steer must arrive at the edge (H7, H10).

### H2. Cache floor, not placement (null for probes)
- **Statement:** On qwen3.7-flash via Alibaba, `cached_tokens` is 0 only while the prefix is under about 4,096 tokens; a session whose system prompt alone exceeds 5k tokens gets `cached_tokens` > 0 on request 2 with no probe.
- **Concept:** probe turns (competing).
- **Real work:** issue 5. Product: a trace and a paragraph in `docs/live-evidence/` stating the floor, which settles the "open" list of STEMS §5c.
- **Silo:** blue = default system prompt (about 1k tokens). Green = same plus a stable 5k-token context block (the voice skill and glossary are a realistic one). Same three-message script, sandbox only. Canary 1+1, full 5+5.
- **Needs:** no code.
- **Metrics:** green `cached_tokens` ≥ 4,096 on request 2 in ≥ 4 of 5 → floor confirmed; probes are then needed only for forks that read before any write. Blue request 2 = 0 in ≥ 4 of 5. If green request 2 is 0, write timing (not length) is the cause and probes stay in play.
- **Cost cap:** $0.02 per run, $0.20 total.
- **Risk / a fail teaches:** the first request carries no `provider.order` (seen live), so request 2 may hit another upstream; pin from request 0 or discard such runs. A fail says the floor is not the whole story and H9 is worth building.

### H3. Every helper fits one cent
- **Statement:** On the two cheap models, the 95th percentile cost of each existing operation kind (`watch`, helper squeeze, `steward` condense, `scratch`, policy repair) is under $0.001, so a one-cent cap never binds and the useful gate is operations per commit.
- **Concept:** other (cost metering under the one-cent rule).
- **Real work:** issue 8, whose triage says condense cost per run is "not checked". Product: a table per kind (n, median, p95, max) in a doc and the budget number for the auto-drain decision.
- **Silo:** read-only on existing ledgers and case-study JSON first (blue = what is recorded). Green = one sandbox session with `watchModel` and helper set to hy4-flash and condense run by hand 10 times. Canary = the read-only pass.
- **Needs:** no code to measure. To enforce: `app/main.js` `aux()` and `steward()` (derive `max_tokens` from the cap and the model's price; refuse and raise a smell `op-over-cap` when input alone exceeds it).
- **Metrics:** pass if p95 < $0.001 and max < $0.01 for every kind over ≥ 20 rows each; fail if any kind has max ≥ $0.01 (name it; that kind needs the gate first).
- **Cost cap:** $0.05.
- **Risk / a fail teaches:** rows from the proxy may lack cost; then price x tokens is an estimate and must be marked so. A fail tells issue 8 that auto-drain cannot default on without the gate.

### H4. Recraft saves no input (null for recraft)
- **Statement:** In the live sessions, assistant text carried into later requests is under 15% of prompt tokens (reasoning is not sent back; tool results and the system block dominate), so recrafting replies cannot cut cost per request by more than 10%.
- **Concept:** recraft (competing).
- **Real work:** issue 11. Product: a breakdown table (system, tools, user, assistant text, tool results as shares of prompt) added to the case-study page, and a keep-or-drop line for the recraft spec.
- **Silo:** read-only analysis of `issue4-live-evidence.trace` (commit `5fe9221`) and `side-goal-2026-11-19-live*.json`. No arms needed for the canary; full = the same breakdown on one new hy4-flash session doing H1.
- **Needs:** no code in the app (a throwaway script over the trace).
- **Metrics:** assistant-text share < 15% in ≥ 2 of 3 sessions → recraft-for-saving is dropped and recraft is justified only by H11 (behaviour). Share ≥ 30% → recraft can pay; build it.
- **Cost cap:** $0 for the canary, $0.05 for the new session.
- **Risk / a fail teaches:** short sessions understate what a long core carries; include the longest session available. Either result redirects issue 11 to output (H5), where the money is.

### H5. Directive beats effort parameter
- **Statement:** On qwen3.7-flash stem turns, `reasoning.effort: low` (strat-stem-2.0) does not lower median reasoning tokens by 30%, while a "no deliberation; state the next action in one line, then call the tool" system directive does.
- **Concept:** policy directive.
- **Real work:** issue 11 (open item: "check that the effort setting is applied"). Product: the result table on the issue and a decision on strat-stem-2.0.
- **Silo:** three arms, same side-goal script: blue `strat-stem-1.0`; green-a `strat-stem-2.0`; green-b `strat-stem-1.0` plus the directive. Sandbox sessions only, no repo writes. Canary 1 each; full 5 each.
- **Needs:** no code (`wh init -s`, system prompt).
- **Metrics:** reasoning tokens per stem turn (ledger `reasoning`): green-b median ≤ 70% of blue and coherent 5/5 → pass; green-a within ±15% of blue → the parameter is not honoured on this route. Also check `wh raw` shows the field went out.
- **Cost cap:** $0.01 per run, $0.15 total.
- **Risk / a fail teaches:** fewer reasoning tokens may cost coherence (count it). If neither arm moves reasoning, the output is intrinsic to this model and routing (stems on another model) is the lever.

### H6. Error hint beats directive (competing)
- **Statement:** When a `find` occurs 0 times, returning the closest line of the file in the error ("find occurs 0 times; nearest: line 2568 `…`") raises qwen3.7-flash's success on the next attempt to ≥ 90% with no directive, matching H1's green.
- **Concept:** other (deterministic tool feedback; makes the edit directive unnecessary).
- **Real work:** issue 12. Product: the fix commit for the `machineGh env` check (or, if it does not reproduce, the rerun record on the issue), written by qwen3.7-flash.
- **Silo:** blue = current error text. Green = a build served from a branch `exp/h6-green` with the hint. Each arm on its own localhost port and sandbox branch. Canary one pair; full 5+5.
- **Needs:** `app/git.js`, the edits loop that throws `find occurs ${n} times (must be once)`.
- **Metrics:** second-attempt success ≥ 90% green vs blue's observed three consecutive failures; total edit calls per landed commit ≤ 2 median; nudges 0; hint adds ≤ 200 chars per error.
- **Cost cap:** $0.05 per run, $0.50 total.
- **Risk / a fail teaches:** the model may paste the hint without checking it is the intended line (count wrong-place edits; any is a fail). A fail keeps the directive (H1) as the fix.

### H7. Repeat note replaces nudge (null for nudge and graft)
- **Statement:** Appending one deterministic line to a tool result that equals an earlier one ("same as result #n; nothing changed; act on it") cuts hy4-flash's repeat rate to ≤ 5% and removes "stop reading" nudges, with no extra request.
- **Concept:** nudge+graft (competing).
- **Real work:** issue 9. Product: the timing split (Go start under Bochs, guest TLS, fetch; `curl` to the same URL; a warm second `gh` call) as a comment table, which needs several shell reads and is where rereading shows.
- **Silo:** blue `strat-serial-1.0`; green = `strat-repeatnote-1.0` (major: the model sees a new line). Separate sessions and machine users; no repo writes. Canary 1+1, full 5+5.
- **Needs:** `app/main.js` turn loop where the tool `content` is finalised (next to the `tool-error` smell), reusing the equality test in `watchCall`; a strategy field `repeatNote`.
- **Metrics:** repeat rate ≤ 5% green and at least halved vs blue; nudges 0 in ≥ 4 of 5; added cost per operation $0 (no request); the note is at the tail so prefix kept stays 100%.
- **Cost cap:** $0.05 per run, $0.50 total.
- **Risk / a fail teaches:** shell output with timestamps is never byte-identical, so the rule may not fire (measure how often it would have). If repeats persist with the note, the model ignores passive hints and an instructing turn (H10) is justified.

### H8. One slot misattributes sessions
- **Statement:** With two sessions' shell commands in flight, the single `activeSession` slot in `app/vm.js` attributes at least one guest `gh api` request to the wrong session (allowed where it should be refused, or the reverse).
- **Concept:** other (specs first, STEMS §5; this is the "not checked" line of issue 1).
- **Real work:** PR 15. Product: two failing-first checks in `scripts/smoke-vm.mjs`: a refused repo returns 403 with a `vm-repo-refused` smell; two sessions interleaved keep their own allowlists; plus the tmux case from H1.
- **Silo:** blue = PR 15 head; green = PR 15 plus H1's commit; the checks are written by a harness session under H1's winning arm on `exp/h8-green`. Run in CI on a sandbox branch (the packed image is not available locally). Canary = the single 403 check; full = all three.
- **Needs:** test code only (`scripts/smoke-vm.mjs`). If it fails: `app/vm.js` `run()` and `whVmAuth` (key by command, not one slot).
- **Metrics:** 0 misattributed requests in 20 interleaved pairs → hypothesis false, PR 15 can merge with the checks; ≥ 1 → fix before merge. Checks written with 0 nudges, ≤ $0.03.
- **Cost cap:** $0.10 model spend; CI minutes separate.
- **Risk / a fail teaches:** #12 keeps the vm suite red and can mask the result; rerun `f2779ea` and head first. A clean pass removes the largest unknown on the PR.

### H9. A probe moves hits earlier
- **Statement:** One discarded one-token request sent at about 4k prefix tokens with the same bytes and `provider.order` makes the next three real requests on qwen3.7-flash report `cached_tokens` ≥ 4,096, at a probe cost under $0.001, where the same session without it reports 0.
- **Concept:** probe turns.
- **Real work:** issue 5 and variant G of STEMS §7. Product: ledger kind `probe` with a paid-off row, and the case-study table.
- **Silo:** blue `strat-serial-1.0`; green `strat-probe-1.0` (minor change in principle, but new id). Sandbox sessions, no repo writes. Canary: one probe in one session; full 5+5. Run only if H2 leaves room (floor not the whole story, or forks read before a write).
- **Needs:** `app/main.js` turn loop, before `hold(s, 'request', …)`: a `probe()` that sends `buildRequest(...)` plus the marker with `max_tokens: 1`, same `body.provider`, records through `report()`; strategy fields `probes`, `tags` in `app/strategies.js`; kind `probe` in `app/checkpoints.js`.
- **Metrics:** next-3 `cached_tokens` ≥ 4,096 in ≥ 4 of 5; probe cost < $0.001; net (reads saved minus probe) > 0 within 3 requests; marker bytes never change between requests (prefix kept 100%).
- **Cost cap:** $0.02 per run, $0.20 total.
- **Risk / a fail teaches:** the provider may not write an entry for a 1-token reply, or writes lag by seconds. A fail drops probes on automatic-caching models and keeps them only as breakpoints on explicit ones.

### H10. Templated nudge gets a commitment
- **Statement:** After two repeat flags, one ephemeral turn whose payload is built mechanically from the ledger and flags (≤ 1k tokens) and that ends "say the next action in one line, then do it" makes hy4-flash write within 3 turns in ≥ 80% of cases, for under one cent including the graft.
- **Concept:** nudge+graft.
- **Real work:** issue 12. Product: the rerun record on `f2779ea` and head, and the fix commit if it reproduces.
- **Silo:** blue = operator waits, hand nudges counted. Green canary, no code: the operator pastes a fixed template filled only from `wh flags` and `wh assess` output (no free text), one per trigger. Full, with code: `strat-nudge-1.0`, 5+5, with the payload builder on hy4-flash vs qwen3.7-flash vs no model (pure template) as sub-arms.
- **Needs:** canary no code. Full: `app/main.js` after `watchCall` resolves (trigger), `app/context.js` `buildRequest` (an unpersisted tail turn; today's "Ephemeral edge" concern), ledger kinds `nudge`, `graft`.
- **Metrics:** commitment line present ≥ 90%; kept (the next non-read call matches it) ≥ 80%; turns to first write ≤ 3; repeat rate after the nudge ≤ 5%; nudge + graft ≤ $0.01, target ≤ $0.002; hand nudges 0.
- **Cost cap:** $0.08 per run, $0.80 total.
- **Risk / a fail teaches:** the pure template may match the small-model graft (then the graft model is unnecessary: say so). If commitments are made and broken, the nudge must be re-armed by the watcher, not dropped on a count.

### H11. Recraft keeps every name
- **Statement:** With `voice-skill.md` as a stable system prefix, hy4-flash rewrites 20 real reasoning blocks to `plan-list` at ≥ 60% fewer characters with 100% of protected spans (backticked text, identifiers, paths, numbers, glossary terms) unchanged, at under $0.001 per item.
- **Concept:** recraft, voice catalog, term annotation.
- **Real work:** the recraft spec's first check (specs first). Product: a fidelity check script and its corpus under `scripts/`, landed on `spec-recraft` before any app code.
- **Silo:** blue = raw blocks. Green-a hy4-flash, green-b qwen3.7-flash, as plain sessions with the skill as system prompt and one item per fresh session. No repo access at all. Canary 3 items; full 20.
- **Needs:** no app code (the deterministic span scan is the throwaway script that becomes the check). Later seam: `steward()` in `app/main.js`, strategy field `recraft`.
- **Metrics:** protected spans kept 100% (one change fails the model); decisions kept per a 5-item hand check, 5 of 5; size ≤ 40% of raw; pass-through rate ≤ 20%; cost < $0.001 per item; `cached_tokens` > 0 on items 2+ (the skill prefix must exceed H2's floor).
- **Cost cap:** $0.05.
- **Risk / a fail teaches:** the corpus is two models' habits; a pass does not carry to others. A fail on names means the pass must mask protected spans before the helper sees them, which changes the design.

## (a) First three experiments

1. **H1** (no code, real work): it produces the tmux-gap commit for PR 15 either way, and its losing arm gives the baseline counts (nudges, repeat rate, first-try edits) that H6, H7 and H10 are judged against.
2. **H3 + H4 together** (no code, read-only first): one afternoon over existing ledgers and traces fixes the cost-per-operation table for issue 8 and says whether recraft can pay at all, before any of it is built.
3. **H2** (no code, about $0.20): decides whether H9's probe code is worth writing for automatic-caching models.

Then H8 (the checks PR 15 lacks), H5, and the code arms H6, H7, H9, H10; H11 whenever the recraft branch is picked up.

## (b) Three ways the programme could fool itself

1. **The brief is the treatment, not the mechanism.** Green arms tend to get a better-written first message, and a clear task wins under any strategy. Control: both arms get the same first message bytes; the only difference is the directive or the mechanism; add a third arm with a same-length neutral paragraph in the system prompt (this also controls for prefix length moving the cache floor, H2).
2. **Run-to-run variance and order read as an effect.** Serial alone spans 2x in output; a later run can also hit an upstream cache the earlier one wrote, and the operator gets better at the task. Control: 5+5 alternating, fresh browser and fresh sandbox branch per run, upstream pinned from request 0, a distinct salt line at the top of each run's system prompt so no run reads another's cache, thresholds fixed here before running, and the operator's log (not memory) as the nudge count.
3. **Cheap by not doing the work.** A green arm can cost less because it stopped early, committed a wrong edit, or shifted cost to an unmetered place (operator turns, helper rows, CI). Control: a run counts only if its product passes the same acceptance check (the diff applies, `node --check`, the smoke check where one exists, names unchanged); cost is the sum of every ledger row including helper kinds; held-step approvals and operator messages are counted per run and reported next to cost.

## Results

One row per result (`PROGRAMME.md`, Reporting): what ran, the numbers, cost, verdict (`promote`, `retest`, `drop`), where the evidence is, and what it taught. Failures stay. Rows are added below; the text above is left as written.

| Hypothesis | Date | What ran | Numbers | Cost | Verdict | Evidence | What it taught |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I1 Capture only (`INVENTORY.md`) | 2026-11-20 | No arms: the hypothesis is a state transition, not a comparison. The inventory was built over every `app/*.js` at commit `0e55c85` by the capture provider `js-acorn` (capture feature `js-symbols`, how: ast), in node and in the page, mock provider only, no model request. | 42 of 42 files went from not inventoried to inventoried; 0 failed; 42 entries; 1,747 symbol entries (818 function, 253 method, 1 class, 346 module-level variable, 329 export). The 39 files that existed before this work hold 293 exports, the same count as `grep -c "^export "` over them. Source 820,233 chars (line endings as LF), capture payloads 282,221 chars (34%). Without the vendored parser: 41 files, 1,582 symbols, 583,904 chars to 248,949 (43%). Time for all 42 files, node, four series of 5 builds on one Windows machine: the first build of a series 500 to 776 ms (includes loading the parser), the other sixteen 228 to 502 ms; `app/main.js` alone 88 to 111 ms. In the page (Chrome, files fetched from localhost, payloads put in IndexedDB): 766 and 907 ms, two runs. Reference edges 0 and annotations 0 (not asked of I1); `references_count` is null. | $0 (no request) | promote | checks `inventory: ...` and `capture provider seam: ...` in `scripts/smoke.mjs` (17, red in `b746ad7`, green in `0e55c85`); `app/inventory.js`, `app/capture-js.js` | Not falsified: no file needed a model to yield its names. A parser was needed, not a pattern: `app/tools.js` holds code inside template strings (`fmt`, `start`) that a line pattern would list as symbols; the check for it is in the suite. The deploy copies `app/*.js` flat, so the parser is one vendored file in `app/` and is itself inventoried (165 of the symbols). Payloads are a third of the source, so a query must return a selection, not a payload (I2). Open: an entry is found by its label, and the build used `app/x.js` while a read through `repo_read` uses `owner/name:path`; until one label convention is chosen, what is held and what was checked for the same file sit in two rows. Not measured: any model's use of the captures (that is I2). |
| I3 Has/has-not from data alone (`INVENTORY.md`) | 2026-11-20 | No arms. One session under the mock provider (`mock-1`) in `scripts/smoke-git.mjs` at commit `0e55c85`: five `repo_read` calls (a whole file, a slice, a second file, a directory listing, the second file again after its source changed and grew past what a turn keeps whole). The view was computed in node from the session's stored records only. | 4 check records for the 4 file reads, 0 for the directory listing; 2 entries made known by the reads (metadata, no captures). The view gave, with no turn text: `a.txt` checked whole and slice, not stale; `src/x.js` checked whole and slice, stale (hash differs); held empty for both (a read is not a capture). The slice kept its range `1-1`; the over-long read was recorded as slice with range `view`, not whole. A check record is about 160 chars. No record id or label appears in the session's messages or system prompt. | $0 (mock) | retest | checks `check records: ...` in `scripts/smoke-git.mjs` (10, red in `b746ad7`, green in `0e55c85`); `app/inventory.js` `noteRead`, `view` | Holds where it was tried: for `repo_read` file reads the answer needs no turn text. It is not yet "any session": only `repo_read`'s file op writes a check record. A file read through `shell`, `local_read`, the explorer, or more of a long result through `output_read`, leaves none, so the view under-reports there. `whole` had to mean "the whole file sat in the turn": a long result enters the log as a view with a handle (`outstore.js`), and calling that whole would let a fetch stand in for content not held. Stale is the last check's hash against the entry's; whether the source moved since the last look needs a read or a re-capture. Retest in a production-style session with a real model, and after the other read paths write records. |

### F1. Validator extraction (FLOWS.md "First order of work"), 2026-11-20
- **Verdict:** retest. On the one file measured most bullets get a checkable shape (11 of 16). Resolution from session records alone held only for records that carry tool call arguments (22 of 22), not for turn profiles (0 of 66), and no pass was observed on real records.
- **Arms and cost:** no arms and no model: extraction and resolution are code (`app/validators.js`, `node scripts/validators.mjs`). Tokens 0, cost $0.
- **Extraction (`.claude/skills/spec-first/SKILL.md`):** 16 bullets found (8 Steps, 5 Rules, 3 Records). 11 validators with a checkable shape (shape 5, presence 5, order 1, cost 0); 5 with none (the bullet names no file, command or message form).
- **Resolution, 11 checkable validators x 8 records = 88:** resolved from the record alone 22 (pass 0, fail 22, all `absent`); unresolved 66 (all `no-arguments`). With the 5 shapeless validators (40 more, unresolved `no-shape`): 128 results, pass 0, fail 22, unresolved 106.
- **Data:** real records already in the repo, no mock run. Six turn profiles of live sessions (`docs/concepts/profile-2026-11-19.json`: tool names per turn, no arguments): 0 of 66 resolved. Two live traces (`docs/live-evidence/issue4-live-evidence.trace`, `issue4-live-concern.trace`: tool calls with arguments): 22 of 22 resolved. The two traces are two of the six profiled sessions, so six sessions in all. None of them is spec-first work done through the harness.
- **Link:** branch `f1-validators`; records `docs/concepts/f1-validators-2026-11-20.jsonl` (16 step validators, 128 validation results, no turn content); checks `scripts/test-validators.mjs`.
- **What it taught:** (1) A bullet gets a shape by code only where it carries a literal in backticks; "Implement at the seam only" and "Never push, merge or release from here" carry none. (2) Whether a validator resolves is decided by the record kind, not the validator: a turn profile cannot resolve any of them, a record with tool call arguments resolves all of them. The two real development sessions (issue 1) exist in the repo only as profiles. (3) Every resolved result is `absent`, because no recorded session did this skill's work; the pass path ran only on the suite's invented session. Whether a step applied to a session is not in the records (no flow attribution yet, `flow_id` is null), so a fail here reads "not shown", not "broken". (4) Code cannot tell a conditional bullet ("A goal that changes mid-way: ...") from an unconditional one, nor "any of" from "all of" in a list of files. By hand reading, 7 of the 11 shapes look for the act the step asks for and 4 only for a file the bullet names. (5) spec-first is the favourable file: the same extractor over the other nine skill and agent files gives 67 of 203 bullets a shape (33%; 11% to 53% per file), which would meet the first falsifier.
- **Retest needs:** a record with tool call arguments (a `.session` export or log repo chunks) of a harness session doing spec-first work, and a flow attribution so that a fail means something.

Written by the operator, one entry per run, newest last. The hypothesis text above stays as written; a result that contradicts it is recorded here.

### H1 canary · 2026-11-20 · stopped: the task has no defect · verdict `retest`

Model `tencent/hy4-flash` (upstream Tencent on all 21 requests), `strat-serial-1.0`, profiles `exp-h1-blue` / `exp-h1-green` with `GlyphHarness/wh-live-sandbox` as the only repo, `pace both`, watcher and helper off. Seed `5b19fda` in the sandbox: `app/main.js` and `app/vm.js` byte-identical to PR 15 head `938a02f`. Spend $0.00203 of the $0.15 cap.

| Arm | Outcome | Requests / tool calls | Nudges | First-try edits | Repeat rate | Cost (ledger) | Cached tokens | Merge as is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| blue, [`exp/h1-blue`](https://github.com/GlyphHarness/wh-live-sandbox/tree/exp/h1-blue) | not completed: no `repo_commit` call, branch still at the seed; stopped by the operator in turn 3 | 21 / 36 (21 `repo_read`, 13 `output_read`, 2 `run_js`) | 2 (`continue`, each after the harness stopped the turn at 8 tool rounds) | none attempted | 3 of 36 (8.3%) | $0.00203, every row with a reported cost | 227,072 of 246,087 prompt (92%); request 0: 0 of 3,716 | nothing to merge |
| green, [`exp/h1-green`](https://github.com/GlyphHarness/wh-live-sandbox/tree/exp/h1-green) | not run; branch at the seed | - | - | - | - | $0 | - | - |

Profile (metadata only): `docs/concepts/profile-h1-canary-2026-11-20.json`.

Why it was stopped

- The change H1 names is a no-op. On the seed, `shellOpt(s)` returns `{ user, quotaMB, session: s.id }` (`app/main.js` line 2367), `shellRunner` sets `o = shellOpt(s)` (2567) and the tmux path calls `agentRun(cmd, t, o)` (2568); `agentRun` ends in `vm().run(script, timeoutS + 30, { ...o, display: cmd })` (2514) and `run` sets `activeSession = opt?.session` (`app/vm.js` line 313). The session id already reaches `vm().run` on the tmux path. `shellOpt` carried `session: s.id` at PR 15's base (`f2779ea`) as well, so the gap listed on PR 15 ("the tmux path does not pass the session") is not in the code.
- PR 15 and issue 1 were closed as not planned at 2026-11-20T07:54Z (restrictions are options, off by default), before this run started. The work is no longer on the board.
- The operator's check before the run was a text match (`agentRun(cmd, t, o)` occurs once in the seed), not a trace of what `o` holds. The miss was seen during blue's third turn and then confirmed in the code. Green was not started.

What it taught

1. Check that the defect reproduces, by tracing or by a failing check, before a silo is seeded. A line that matches the hypothesis text is not a defect.
2. Blue's counts are not a baseline. 36 reads and no write is what a fix request with nothing to fix produced; H6, H7 and H10 should not be judged against these numbers.
3. The 8-round stop is counted as a nudge. Both `continue` messages followed `Stopped after 8 tool rounds` (`MAX_STEPS` in `app/main.js`). The nudge count as defined cannot tell a model that needed steering from a turn that ran out of rounds; count limit-forced continues on their own line.
4. The first message names no repository or branch. Each arm got a line in its session system prompt (`Work in the repository GlyphHarness/wh-live-sandbox on the existing branch exp/h1-<arm>.`), so the arms would have differed by salt, branch name and directive, not by the directive alone. Settle where that pointer lives before the rerun.
5. The salt is not at the front. `buildRequest` sends the core prompt before the session system prompt, and the 21 tool definitions come first in cache order, so about 3.6k of request 0's 3.7k prompt tokens are the same bytes in every run. Blue's request 0 reported 0 cached, but blue ran first; whether a second run reads the first run's prefix was not tested.
6. Arms can read each other. Both branches are in one repo and the allowlist is per repo: blue listed the branches and read `exp/h1-green` (a diff, a log, a file range). In a pair run one after the other, the second arm can read the first arm's finished change. A repo per arm, or the first arm's branch moved away while the second runs, closes it.
7. Long lines defeat ranged reads. A result over 1,500 chars comes back as a head-and-tail view, and a 40-line range of `app/main.js` is well over that, so blue read the tmux block in three successively narrower `repo_read` ranges before one came back whole. It also passed line numbers as `output_read` `offset` and `length` (they are characters) and called `output_read` inside `run_js` (not defined there).
8. `wh` lacks what the shared rules assume: no command sets a session's system prompt or pastes profiles, and there is no command log to count nudges from. This run used an untracked copy of `scripts/wh.mjs` adding `system`, `paste`, `sayfile`, `held`, `dump` and a JSONL log. "Needs: no code" holds for the app, not for the operator CLI.
9. From the code, not exercised here: the approval card previews the first 20,000 chars of each file, and `app/main.js` is about 250,000, so an edit at line 2568 would not be on the card. The held tool-call card carries the find and replace strings.

Verdict: `retest`. H1 is untested: no green run and no valid blue. The rerun needs a one-file defect that reproduces, from work still open.
