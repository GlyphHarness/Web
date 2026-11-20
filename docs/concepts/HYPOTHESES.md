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
- **Operator nudge, split (appended 2026-11-20, H1 canary lesson 3).** A `wh say` sent right after the harness stopped the turn at its tool-round limit is a **limit continuation** and is counted on its own line; every other `wh say` after the first message that is not an approval answer is a steering nudge, and only those count against "nudges = 0". The harness records why each run stopped (`stops` in the session record: `done`, `limit`, `failed`, `stopped`, `held`, `budget`); `wh log` prints both counts, and the turn profile reports them as `followUps`.

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
| I1 / I3 follow-up: one file, two labels (`INVENTORY.md` QI10) | 2026-11-20 | The label question left open in the I1 row is closed by the person's direction, not by a measurement: keep both labels, identity is the file's checksum (line endings normalized as git does for text). Checks under the mock provider at commit `2ff51c2`: node and Chrome, one inventory built under file paths and read through `repo_read` under git paths. | Joined has/has-not view (`view(inv, {join: true})`): a file built as `checkout/src/y.js` (LF) and `win/src/y.js` (CRLF) and read as `o/r:src/y.js` (CRLF blob) is 1 row with 3 labels, held and checked whole, not stale (3 entries, 1 check record, one checksum, 2 raw hashes). A binary file (NUL byte) with CRLF bytes does not join its LF twin; two files of identical content join into 1 row with both labels. After the file changes, the rebuilt label is its own row (held, not checked) and the read label is its own row, stale once it was read again; no stored record is rewritten. Suites: `scripts/smoke.mjs` 218 of 218, `scripts/smoke-git.mjs` 76 of 76 (13 new checks, red in `ae89315`; two record-shape checks extended in `3d7615a`, green in `2ff51c2`). | $0 (mock) | promote | `INVENTORY.md` QI10; `app/inventory.js` `checksum`, `view`; checks `joined view: ...` in `scripts/smoke-git.mjs`, `inventory: ...` checksum and join checks in `scripts/smoke.mjs` | Closed: no label convention was needed. Known limits, recorded in QI10: identical content in different files joins them (every label stays in the row); a read label keeps the checksum of its first read, so after a change and a re-read it stays stale and apart rather than rejoining (rejoining would need a new entry record per read of changed content, which changes the I3 contract); the hash is short and non-cryptographic. Not measured: any model's use of the joined view. |

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

### Live stepped session 1 · 2026-11-20 · a harness change made through the harness, shell on a host container

Not a silo pair: one session, no arms. It is recorded here because it is the first real model run of the host shell (`README.md`, Host shell) and the first record that lets F1 be retested on spec-first work.

Setup. Model `tencent/hy4-flash`, `strat-serial-2.0`, `pace both` (every model request and every tool call held, read by the operator and released one at a time), watcher and helper off. The page ran in the installed Chrome with a visible window on the Windows machine, served from a checkout at `160bd59`. `shellOn: host:box`: the session's shell ran in a Podman container (user `dev`, the repository at `/work/Web`, a clone at `160bd59`). The task was one message (1,590 chars): make `app/validators.js` use `perTurn[n].args`, checks first in a `Spec:` commit, then the implementation, `node scripts/ci.mjs validators profile` green, no push.

| Outcome | Turns / requests / tool calls | Operator messages | Result classes | Tokens | Cost (ledger) |
| --- | --- | --- | --- | --- | --- |
| completed: three commits in the container, `validators ok (32/32), profile ok (23/23)`; the same three apply unchanged on `dev` at `5e791be` (`b7a5c1e`, `f29dacc`, `8c8bb8d`; 2 files, +21 -3) with the same result | 18 / 125 / 145 (119 `shell`, 21 `output_read`, 5 `run_js`) | 1 steering (739 chars); 14 `continue` after a round-limit stop; 2 `continue` after a turn that stopped `failed` (HTTP 502 from the provider); 173 held steps released, 1 skipped | ok 138, error 4, find-absent 2, refused 1 | 4,716,396 prompt, 4,644,864 cached (98%), 18,442 out (3,401 reasoning); prompt per request grew from 3.3k to 55.4k | $0.01206; per request median $0.00009, max $0.00026 |

Profile (metadata only; command lines kept to their first line, content as size and hash): `docs/concepts/profile-live1-2026-11-20.json`.

Order of work, read from the command lines in the profile: the checks were written and run red, the implementation was set aside (`git checkout -- app/validators.js`), the suite was run again, the checks were committed alone as `Spec:`, then the implementation was restored and committed. The second `Spec:` commit (the one the steering message allowed) was amended once before the implementation commit.

What the model was told about where it ran. The first request's body held none of these terms: WebHarness, browser, page, tab, bridge, Alpine, wh-install, harness, in-page (checked in the saved trace; the only matches were in trace metadata, not in what was sent). It was offered 17 tools.

F1 retest on this record (`node scripts/validators.mjs .claude/skills/spec-first/SKILL.md --records docs/concepts/profile-live1-2026-11-20.json`, with the reader this session wrote): 11 of 11 checkable validators resolved from the profile alone (0 of 66 on the earlier profiles). Pass 1 (`ci-record.json | scripts/ci.mjs`), fail 10, all `absent`. Four of the ten are the `Spec:` message shapes: the session made three `Spec:` commits, but each message sits inside `git commit -m '...'` on a shell command line and the pattern is anchored at the start of an argument, so it is not seen. The other six name paths or commands the task did not call for (the skill says `node scripts/ci.mjs main git`; the task said `validators profile`). There is still no flow attribution, so a fail does not say the step applied.

What it taught

1. A provider 5xx ends the turn. Two requests of 125 came back `HTTP 502: Provider returned error`; nothing retried, and `wh say` / `wh step` printed nothing that named the failure. The operator found it by reading the last message.
2. `run_js` does not run where the shell runs. 4 of its 5 calls were errors: the model reached for the file system from it. With the shell on a host, a second tool that executes code somewhere else is a split view of the machine, and its errors are the nearest thing in the session to a tell.
3. There is no edit tool for files on the host. The model changed files by writing patch scripts (10 `python3` and 7 `node -e` command lines, 13 with a here-document) and re-read regions with `sed -n` (44 command lines) to copy exact text.
4. A shell result over about 1,500 chars comes back as a head and a tail, so reading a file region took a `shell` call and then `output_read` calls (21 in all).
5. The 8-round stop cut the work 14 times; 14 of the 17 follow-up messages were `continue` after it. Each cost a request and an operator action and carried no information.
6. The profile misreads this kind of session in two places: `calls before first write` says no write (a write made through `shell` is not seen), and `steering 3` counts the two `continue` messages after failed turns as steering. The real steering count is 1.
7. The one steering message fixed the operator's brief, not the model: the brief said "do not edit existing checks", and one existing check built its record with `profile(good)`, which the task itself changes. The model stopped and reported the contradiction instead of breaking the rule. Run a brief's rules against the repository before sending it.
8. Weight: 4.7M prompt tokens (98% cached) for a 21-line change. The serial strategy re-sent a prompt that grew to 55k tokens on each of 125 requests; the cost stayed at about a cent only because nearly all of it was read from cache.

Verdict for F1: `retest`, narrowed. A profile with argument summaries resolves every checkable validator; what is left is evidence inside a command line (a commit message in `git commit -m`) and flow attribution.

2026-11-20, evidence inside a command line (branch `validators-cmdline`, records `docs/concepts/f1-validators-live1-2026-11-20.jsonl`). `app/validators.js` now reads the message arguments of `git commit` out of a command line (`-m`, `--message`, `--message=`, `-m<msg>`, `-am`, several `-m`, in a line chained with `&&`, `;`, `||`, `|`; shell quoting, no substitution evaluated) and offers each as an evidence string of its own, for patterns anchored at the start of an argument only; it applies to the stored-session, trace and profile readers alike, and a message cut off by the profile's first-line limit is not evidence. A result that passes this way carries `in_command: true` besides the call it points at. Same command on the same profile: before pass 1, fail 10 (all `absent`), unresolved 5 (no shape); after pass 4, fail 7 (all `absent`), unresolved 5. The three that moved are the anchored `Spec:` shapes (`Spec: <what was wrong and why>`, and the two bare `Spec:` labels), each found at turn 5, call 3, the first `Spec:` commit. `Spec: <behaviour> (<why>)` still fails `absent`, and rightly: none of the three messages has a parenthesised why. The other six still name paths or commands the task did not call for. Flow attribution is still missing, so a fail does not say the step applied.

Note, 2026-11-20, after the release judge: the session ran as `strat-serial-2.0` at `160bd59`, where the neutral wording had been written into every strategy in place. Since `d8a3a52` that wording is `strat-serial-3.0`'s data and 2.0 sends the original wording again, so what this session was sent is what 3.0 sends now, not what 2.0 sends.

### Host files, tool rounds and run code · 2026-11-20 · the gaps of live stepped session 1, built as options

Not a model run: mock provider and the real bridge only. It answers points 2 to 5 of "What it taught" above with options a host session can turn on; nothing changes for a session that does not (suite `main`: the host session's tool list is the same bytes as before).

- Run code (point 2): no new option. The existing `run_js` capability, denied for the profile or the session, leaves `run_js` out of the tools offered and refuses its call (checked on a host session). Routing it to node on the host was not built: it needs node in the target, and the shell already runs `node -e`.
- Host files (point 3, setting `hostFiles`): `file_read`, `file_edit`, `file_write` after `shell`, through the same exec route. Round trip by `sha256sum` on the target, both kinds: LF (14 bytes), CRLF (17), BOM with non-ASCII and mixed endings (36), and 338,781 bytes (6,000 lines, half CRLF) exact after a whole write and after an edit near the end. Per call, median of 5, `wsl:` / `wsl-podman:`: read 0.36 s / 2.1 s; a 300 KB file read 0.36 s / 2.2 s; edit 0.66 s / 4.3 s (a read and a write); a 300 KB edit 1.3 s / 4.7 s; a bare `true` through the shell route 0.34 s / 2.1 s.
- Reading a region (point 4): `VIEW_MAX` left at 1,500. A 60-line range of the 300 KB file came back whole (3,417 chars, numbered); a whole read is cut at 40,000 chars at a line end and its last line names the lines to ask for (`lines "729-6000"`). No `output_read` step is needed for a file region.
- Round limit (point 5, setting `toolRounds`, default 8): with 3, a turn stopped after 3 rounds as `limit` and the notice named 3.
- What a host session with the options on is sent (`strat-serial-3.0`, `hostFiles` true, run code denied, no repository or local tools): 19 tools, `scratchpad_read, scratchpad_write, show_widget, output_read, fan_out, branch_read, pattern_find, pattern_get, pattern_put, pattern_run, entry_read, ask, value_request, value_set, value_get, shell, file_read, file_edit, file_write`; the first request (12,089 chars as built in node) holds none of WebHarness, browser, page, tab, bridge, Alpine, wh-install, harness, in-page. Under the strategies registered before `strat-serial-3.0` the `shell` description names the page (they keep their registered bytes), so a host session that must not learn it runs under 3.0.

Not measured: whether a real model uses the file tools in place of patch scripts and `sed -n`, and how many requests that saves; that needs a session like the one above with the options on.

### Live stepped session 2 · 2026-11-20 · the same kind of task with host files, 40 tool rounds and no run code

Not a silo pair and not a controlled comparison with session 1: the task is smaller and the options differ in four ways at once (strategy wording 3.0, `hostFiles`, `toolRounds` 40, run code denied). It is recorded as the first real model run of the host file tools.

Setup. Model `tencent/hy4-flash`, `strat-serial-3.0`, `pace both` (every request and tool call held and released one at a time), watcher and helper off, the installed Chrome with a visible window, page served from a checkout at `a678a76`. Shell on `host:box` (the same Podman container, repository at `a678a76` on a branch of its own). Profile `host-work` with the run code capability denied; `hostFiles` true; `toolRounds` 40. The task was one message (2,314 chars): make `commitMessages` return one message per commit (several `-m` joined as paragraphs), checks first in a `Spec:` commit, then the implementation, `node scripts/ci.mjs validators profile` green, no push. The brief named the two existing table rows that the change contradicts and allowed changing them (lesson 7 of session 1).

| Outcome | Turns / requests / tool calls | Operator messages | Result classes | Tokens | Cost (ledger) |
| --- | --- | --- | --- | --- | --- |
| completed in the first turn: two commits in the container, `validators ok (46/46), profile ok (34/34)`; applied on `dev` at `5dc8b2a` as `0ccc249` and `1f57fc9` (2 files, +16 -4) with the same result | 1 / 27 / 28 (11 `file_read`, 9 `file_edit`, 5 `shell`, 3 `output_read`) | 0 steering, 0 `continue`; every held step released, none skipped | ok 28 | 573,951 prompt, 539,648 cached (94%), 4,459 out (1,691 reasoning); prompt per request 3.9k, then 17.8k to 24.9k | $0.00264; per request median $0.00007 |

Profile (metadata only): `docs/concepts/profile-live2-2026-11-20.json`.

Side by side with session 1, as two numbers each and no ranking: turns 18 and 1; requests 125 and 27; tool calls 145 and 28; results other than ok 7 and 0; operator messages after the first 17 and 0; cost $0.01206 and $0.00264; change size +21 -3 and +16 -4.

What the model was told about where it ran. 19 tools were offered (the 17 of session 1 without `run_js`, plus `file_read`, `file_edit`, `file_write`). The first request's body (14,398 chars, from the saved trace) held none of these as words: WebHarness, browser, page, tab, bridge, Alpine, wh-install, harness, in-page, widget, sandbox, iframe, localhost, 127.0.0.1, Chrome, Windows, wsl, podman, container.

Order of work, from the profile: two whole-file reads, the test edits, the suite run red, the checks committed alone, the implementation edits, the suite run green, the implementation committed. 14 calls came before the first commit.

F1 on this record (`node scripts/validators.mjs .claude/skills/spec-first/SKILL.md --records docs/concepts/profile-live2-2026-11-20.json`): of the 11 checkable validators, pass 5, fail 6 (all `absent`), against pass 4, fail 7 on session 1's profile. The shape `Spec: <behaviour> (<why>)` passes here: the brief asked for that form and the message has the parenthesised reason.

What it taught

1. With file tools the model wrote no patch script and ran no `sed`: 11 reads by line range and 9 exact edits, every one accepted (no `find occurs 0 times`). After each edit it read the same range again (3 byte-identical `file_read` calls, counted as repeats; they are re-reads of changed text, not stale repeats).
2. The first two reads were whole files (the prompt went from 3.9k to 17.8k tokens in one step). Everything after was a range.
3. One turn was enough at 40 rounds: 27 requests would have been four limit stops at 8.
4. No provider failure occurred, so the retry was not exercised by a real 5xx.
5. Carried from the session, corrected by the operator: the model gave the implementation commit a `Spec:` subject too. It was reworded to `Validators: ...` when the commit was applied, and the author was set to an address no account can hold (see the fault recorded for session 1's commits).
6. Two of the nine `file_edit` calls had their arguments stored by handle, so the held step showed the operator only `{"ref": ...}`, and the profile's argument summary for those two calls is the handle, not the path. The operator released two edits without reading them. `wh held` needs to show what a held call will do, and the summary of a stored call needs its path.

Verdict: none (no hypothesis was under test). Host file tools and tool rounds move to measured for this model on this one task.

### H12. Host file tools cut requests on a file edit (registered 2026-11-20, before the canary)

- **Claim.** On one task with the same first message bytes, a session whose shell runs on a host completes with fewer requests and tool calls when `hostFiles` is on than when it is off, and writes no file by script.
- **Why now.** Live stepped sessions 1 and 2 differed in task and in four options at once (125 requests against 27); neither says which option did what.
- **Arms.** Blue: `hostFiles` off. Green: `hostFiles` on. Both: `tencent/hy4-flash`, `strat-serial-3.0`, `toolRounds` 40, run code denied, `pace both`, watcher and helper off, the same page build, a fresh browser profile per arm (stored recipes and the scratchpad must not carry over).
- **Task.** A real open item from the release judge: `transient` in `app/providers.js` treats every `TypeError` as a network error; narrow it to the messages a failed fetch produces. Checks first in `scripts/test-retry.mjs`, then the implementation. The brief names no tool.
- **Isolation.** Each arm has the container folder `/work/Web` to itself, a clone at the same commit on its own branch; blue's clone is moved out of the container's mount before green starts.
- **Measures.** Completed as asked (two commits, checks first, suites green); requests; tool calls; results other than ok; operator messages by kind (steering, after a limit stop, after a failed turn); ledger cost; prompt tokens; shell command lines that write a file by script (`python3`, `node -e`, a here-document, `sed -i`, a redirect into a source file).
- **Canary.** One blue, then one green. Stop if green costs over twice blue. The canary is not worse if green completes and its requests are at most blue's. A full run (three tasks of different shape per arm, alternating order) follows only then.
- **Null.** No difference, or green worse: recorded as it falls.

### H12 canary · 2026-11-20 · requests equal, green dearer · verdict `retest`

Setup as registered above: `tencent/hy4-flash`, `strat-serial-3.0`, `toolRounds` 40, run code denied, `pace both`, the installed Chrome with a visible window, page at `b7ea982`, shell on the container, a fresh browser profile and a fresh clone at `b7ea982` per arm (blue's clone was moved out of the mount before green started). Blue ran first. The first message was the same bytes in both arms (1,938 chars; same hash in both saved traces) and names no tool. Neither first request held an identifying term (the 19 words checked in session 2).

| Arm | Outcome | Requests / tool calls | Operator messages | Results other than ok | File writes by script | Tokens | Cost (ledger) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| blue, `hostFiles` off, 16 tools | completed in one turn: two commits, checks first (36 pass and 1 fail at the checks commit, re-run by the operator), then `retry ok (37/37), profile ok (34/34), validators ok (46/46)` | 18 / 18 (12 `shell`, 6 `output_read`) | 0 | 0 | 4 shell command lines (3 `python3` here-documents kept in the profile, 1 command stored by handle) | 250,064 prompt (92% cached), 3,041 out (874 reasoning) | $0.00147 |
| green, `hostFiles` on, 19 tools | completed in one turn: two commits, checks first, then `retry ok (32/32), profile ok (34/34), validators ok (46/46)` | 18 / 19 (11 `shell`, 3 `file_edit`, 2 `file_read`, 3 `output_read`) | 0 | 0 | 0 | 314,042 prompt (93% cached), 3,387 out (1,785 reasoning) | $0.00172 |

Profiles (metadata only): `docs/concepts/profile-h12-blue-2026-11-20.json`, `docs/concepts/profile-h12-green-2026-11-20.json`.

Read against the registered rule: green completed and its requests are at most blue's (18 and 18), so the canary is not worse, and the stop rule (green over twice blue's cost) did not trigger (1.17 times). The claim itself, fewer requests and tool calls, is not shown: requests are equal, green made one more call, and green cost 17% more. The part of the claim about scripts holds in this pair: blue wrote files with four scripted command lines, green with three `file_edit` calls.

What it taught

1. On this task the file tools did not save a request. Blue read both files with one `cat` and paged the stored output by line range (3 `output_read` calls); green read both files whole with `file_read` (2 calls). Writing took blue 4 command lines and green 3 edits.
2. Green's extra cost is prompt weight: its two whole-file reads put about 11.6k tokens into the prompt at request 1 (3.8k to 15.4k), where blue's prompt reached that size only at request 4; every later request re-sent it. 64k more prompt tokens over 18 requests.
3. The drop from session 1 (125 requests) to session 2 (27) is therefore not explained by the file tools. Blue here had none and took 18. What blue and session 2 share, and session 1 lacked, is 40 tool rounds, no run code, ranged reads of stored output that the model used, and a brief checked against the repository. Which of those matters is still open.
4. Both arms looked at their own edit before going on (blue by a ranged read of the script's output, green with `git diff`), and both committed the checks before the implementation without being reminded.
5. The two arms wrote different rules from the same brief: blue matches the network phrases as substrings, green as whole messages. The brief ("match those phrases without regard to case") allows both. Blue's change is the one carried to `dev` (`c73400b`, `3deceae`), because a failed fetch may wrap the phrase in more text; that choice is the operator's, not a result of the pair.
6. Operator note: the first page load of a fresh browser profile timed out once in `wh init` for green; the commands were repeated and the session started clean (the failed commands are in the command log as `no`).

Verdict: `retest`. One pair on one small task. By the programme a full run may follow (three tasks of different shape per arm); the question worth carrying into it is cost and scripted writes, since requests did not move.

Note, 2026-11-20, after the release judge: of blue's four scripted writes, the committed profile shows three (the python3 here-documents). The fourth is a shell call stored by handle, which the profile holds only as its handle; it was counted from the held step the operator read. On the profile alone the count is 3 and 0.

### H12 full stage · 2026-11-20 · two more tasks per arm · verdict `drop` (the claim as registered), the scripted-write part carried on

Setup as registered, and as run live and stepped (every request and tool call held and released with `wh step`), in a visible Chrome window: `tencent/hy4-flash`, `strat-serial-3.0`, `toolRounds` 40, run code denied, `pace both`, watcher and helper off, shell on the container. Page at `73b2d89` for all four sessions (the canary ran at `b7ea982`, which had no held-call view; that is a difference between the canary and this stage, not between arms). Per arm: a fresh browser profile, a fresh clone of `dev` at `73b2d89` as `/work/Web` on its own branch, the previous arm's clone moved to `/home/dev/old/` and its remote removed. Order alternated: task 4 green then blue, task 5 blue then green. The first message of both arms of a task is the same bytes (`task4.txt`, 1,721 chars; `task5.txt`, 2,466 chars) and names no tool. Each task is a real gap found on the board, not a toy: task 4 adds the fourth way in (`scripts/wh.mjs`) to `docs/PROTOCOL.md`; task 5 counts scripted file writes in the turn profile (the count the H12 measures were doing by hand), checks first.

| Task | Arm | Outcome | Requests / calls | Operator messages | Results other than ok | File writes by inline script | Prompt tokens | Cost (ledger) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 doc edit | green, 19 tools | completed in one turn; one commit `4a30fa7`, only `docs/PROTOCOL.md` (+18 -1), facts match `scripts/wh.mjs` | 8 / 10 (4 `shell`, 4 `file_read`, 2 `file_edit`) | 0 | 0 | 0 | 140.8k (84% cached) | $0.00211 |
| 4 doc edit | blue, 16 tools | completed in one turn; one commit `0cc2390`, only `docs/PROTOCOL.md` (+16 -1) | 11 / 15 (9 `shell`, 6 `output_read`) | 0 | 0 | 1 (`python3` here-document) | 141.3k (85% cached) | $0.00150 |
| 5 multi-file | blue | completed in two turns (a 40-round limit stop, then "continue"); checks first `e21727d` (red 38/67), implementation `3d601c0`; `profile` 67/67, `validators` 46/46 re-run in the clone | 48 / 54 (44 `shell`, 10 `output_read`) | 1 (after a limit stop) | 4 (2 `find-absent`, 2 `No stored call`) | 7 or more of 11 inline-program lines (see note 4) | 1,310.6k (97% cached) | $0.00536 |
| 5 multi-file | green | completed in two turns (a limit stop, then "continue"); checks first `80575e7` (32 failing), implementation `f952ccd`; `profile` 70/70, `validators` 46/46 re-run in the clone | 57 / 56 (35 `shell`, 10 `file_read`, 11 `file_edit`) | 1 (after a limit stop) | 4 (2 `find-absent`, 2 `No stored call`) | 0 | 1,509.3k (96% cached) | $0.00684 |

Profiles (metadata only): `docs/concepts/profile-h12-t4-green-2026-11-20.json`, `profile-h12-t4-blue-2026-11-20.json`, `profile-h12-t5-blue-2026-11-20.json`, `profile-h12-t5-green-2026-11-20.json`. Event lines as they happened: `docs/concepts/h12-full-progress.jsonl`.

Across the three tasks, canary included (one run per cell, so no spread is known):

| | Requests | Tool calls | Cost | Scripted writes |
| --- | --- | --- | --- | --- |
| blue | 18, 11, 48 (77) | 18, 15, 54 (87) | $0.00147, $0.00150, $0.00536 ($0.00833) | 4, 1, 7 or more |
| green | 18, 8, 57 (83) | 19, 10, 56 (85) | $0.00172, $0.00211, $0.00684 ($0.01067) | 0, 0, 0 |

Read against the registered claim ("fewer requests and tool calls, and no file written by script"): requests are fewer in green on one task of three (8 against 11), equal on one, and more on one (57 against 48), so fewer requests is not shown. Calls are within five of each other on every task. Writing by script does not occur in green in any task and occurs in blue in all three, so that part holds. Green cost more on all three tasks (1.17, 1.41 and 1.28 times; 1.28 in total); the stop rule (green over twice blue) did not trigger. Verdict `drop` for the claim as registered; the scripted-write part, and the cost of it, is a narrower question that would be registered before it is run.

What it taught

1. The file tools did not make sessions shorter. On a doc edit green needed 3 fewer requests; on the multi-file change blue did the same work in 9 fewer. The task sets the length (8 to 57 requests), not the arm.
2. The one thing the arms differ on, every time, is how files get written: blue by a script in a here-document, green by `file_edit` with the text it replaces. Green's edits are held and readable as calls (the held step shows `path`, `find`, `replace`); blue's are a Python program the operator reads to learn what will change. That is a gain in what an operator can check, not in requests or cost.
3. Green's cost is the prompt: more tool definitions at every request, and whole-file reads (10 `file_read` calls in task 5). Output rose too: 18.7k against 13.4k tokens on task 5, 66% of it reasoning (one request produced 10.7k output tokens).
4. The scripted-write count is a floor and over-reads at once. Blue's task 5 has 11 command lines of an inline-program shape on the kept first line; read by hand, 7 are here-documents (6 `python3`, 1 `node`) that stand in for an edit, and 4 are `node -e` lines that read a file or test a pattern. Four blue `shell` calls were stored by handle, so the profile keeps their handle, not their text; two of them ran nothing (note 5). Green's profile count is 2: two `node -e` programs that read a profile file (see the note after carrying); its writes by script are 0.
5. Both arms of task 5 made up a handle. Each called a tool with `{"ref": "os:..."}`, a handle that no earlier call of the session held (blue: both `shell`; green: one `shell`, one `file_edit`). The tool answered `No stored call` and a round was spent. The profile classed those answers as ok. The held step showed the handle and "the stored arguments are not in this browser's store" for each; that is true, but a person reading it cannot tell a handle the page lost from one the model invented. In all four cases the handle appears nowhere else in the session. Gap, to be specified before it is changed (not changed in this stage).
6. The profile's `held` class fired in all four sessions (2, 1, 1, 1) where nothing was held. The classifier matches "held" or "approval" in the first 120 characters of a result, and the repository text printed by `git log` and `cat` contains those words. Results other than ok, with those removed, are the `find-absent` and `No stored call` counts above. Gap, to be specified before it is changed.
7. Limit stops: both task 5 sessions stopped at 40 tool rounds and were continued with the same short message; neither task 4 session came near it. That is one operator message of kind "after a limit stop" per task 5 session. No provider failure, no guard stop and no approval card in any session.
8. Operator notes, not results: the commits that are kept on `dev` are the operator's choice. The container commits had the author `dev <dev@devbox.invalid>` and were not pushed; the `Spec:` subjects of task 5 were written by the model in both arms and are accurate.

Isolation, per arm. Container `wh-dev`, folder `/work/Web`, a clone at `73b2d89` on branch `task4` or `task5`; no token repository in the clone (remote removed); the browser profile `host-work` created fresh per arm with stored recipes and pads empty; the bridge on the host is the same process for both arms and its token is in the session settings only. The previous arm's clone was reachable from the container shell under `/home/dev/old/`; in all four dumps no command names `/home/dev`, `/old/` or an arm folder. The first message names no tool or product in either arm. The repository the model works on is the harness's own, so tool results contain its name (1 to 7 occurrences per session, from `docs/PROTOCOL.md`, `git log` and `cat`); the model was not told what it was running in, but a session that reads those files could infer it. That is a limit on every task drawn from this repository, in both arms equally, and was true of the canary.

Limits: one model; one run per cell; four sessions here and two in the canary; each task ran once per arm, the second arm of a task always after the first, and seeds are not controlled.

Note, 2026-11-20, after carrying the task commits to `dev`: the implementation carried from green's task 5 (`f952ccd`, now `0fa9fff`) was run on the four saved sessions. It reports scripted file writes 0, 1, 11 and 2 for task 4 green, task 4 blue, task 5 blue and task 5 green. Green's 2 are two `node -e` programs of 425 and 547 characters that read a profile file (their text is held by handle; the profile keeps the first line and the length), so the count is a shape count and green's real writes by script remain 0. The check "quoted text is not a redirect" held on all four.
