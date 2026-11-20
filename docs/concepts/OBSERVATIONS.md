# Observations

How strategies, models and helpers operated, from turn metadata (`.claude/skills/turn-analysis/SKILL.md`, `wh profile`). Descriptive: each entry says what the numbers were, never which strategy is better. Newest last.

### 2026-11-19 · six local sessions · n = 6 sessions, 80 main requests + 99 helper requests

Source: `docs/concepts/profile-2026-11-19.json` (no message content). Models: tencent/hy4-flash, qwen/qwen3.7-flash, anthropic/claude-sonnet-5.5, all under `strat-stem-1.0`. This is the only strategy so far, so there is no strategy-to-strategy comparison here; only model-to-model and helper-to-main.

What it looked like

| Group | Requests | Cost per request: median / p95 / max | Cache | Output per request | Reasoning share |
| --- | --- | --- | --- | --- | --- |
| main, hy4-flash | 25 | $0.00006 / $0.00015 / $0.00023 | 93%, first hit at request 1 | 248 | 41% |
| main, qwen3.7-flash | 44 (5 sessions) | $0.00016 / $0.00063 / $0.00124 | 82% pooled; per session 0% to 91%; first hit at request 1 pooled, at request 6 in the issue 4 session | 809 | 84% |
| main, Sonnet 5.5 | 14 | $0.01274 / $0.03552 / $0.03552 | 64% | 284 | 17% |
| helper (kind not recorded), on hy4-flash | 20 (2 sessions) | $0.00041 / $0.00141 / $0.00141 | 0% | 3.6k | 95% |
| helper `watch`, on qwen3.7-flash | 44 | $0.00001 / $0.00002 / $0.00004 | 0% | 60 | 100% |
| helper `watch`, on hy4-flash | 27 | $0.00002 / $0.00003 / $0.00003 | 0% | 60 | 100% |

Per session

- hy4-flash, issue 1: 25 main requests and 53 helper requests; helper requests were 72% of the session's cost. 56 tool calls, of which 38 `output_read` and 15 `repo_read`; the first write (`repo_commit`) was call 49. Two repeated identical calls. Twelve `repeated work: the same result` flags. Four user turns; one was a 23-character follow-up. Every call result was `ok`.
- Sonnet and qwen3.7-flash, issue 1 (one session, model changed mid-way): 35 main requests; the first write was call 40; two `repo_commit` calls were `find-absent`; four short follow-up user turns. Prompt grew from 5.3k to 25.9k tokens. Sonnet's 14 requests cost $0.17 of the session's $0.19.
- qwen3.7-flash, four short sessions (issue 4 evidence, probes, smoke): 0 to 3 calls before the first write; no repeats; one `error` result in the smoke session. The issue 4 session's prompts were 4.0k to 4.8k tokens and the first six requests reported 0% cached; requests 7 to 10 reported 91% to 97%. The smoke session's prompts were 2.9k to 3.3k tokens and requests 2 to 4 reported 91% to 95%.

Pointers drilled: none yet. Candidates, with the number that points there: hy4-flash session message range for calls 1 to 27 (turn 0, 27 calls, 17 of them `output_read`); session smwnwaeohj38j, main request 13 (prompt 0, cache `-`) and main request 32 (8.2k output).

Open questions it raises

- Why did helper requests on hy4-flash come to 72% of one session's cost, with 53 requests for 56 calls (is it one helper request per tool call, from the watcher)?
- What is the helper request with no `kind` (3.6k output, 95% reasoning, $0.0004 median)? Both sessions carrying it used hy4-flash as the helper.
- What separates a 0%-cache run on qwen3.7-flash with 4k to 4.8k prompts from a 95%-cache run on 3k prompts?
- Is the 38-`output_read` pattern an artefact of how handles page long results, or the model re-reading?

Hypotheses touched (description only)

- H2 (cache floor near 4,096 tokens): silent to unfavourable. The smoke session's cache hits came at 2.9k to 3.3k prompt tokens, so a floor at 4,096 does not fit that session. Upstream provider is not in this profile; the raw responses carry it (`served-by` in the live evidence traces).
- H3 (every helper under one cent, p95 under $0.001): supported for `watch`; the unlabelled helper on hy4-flash had a p95 of $0.00141 and a max of $0.00141 on 20 requests, above the written $0.001 threshold and under one cent. Main Sonnet requests were over one cent at the median.
- H7 (repeat note): the repeat count in the hy4-flash session was 2 byte-identical calls, against 12 `repeated work` flags. The flags and the byte-identical test are not measuring the same thing; H7 should say which it targets.
- H1 (exact brief as directive): silent. It needs the silo runs.

Limits: one strategy, one run per model per task, two of the six sessions by Sonnet or a mid-session model change. Descriptive only.

### 2026-11-20 · live stepped session 1 (host shell in a container) · n = 1 session, 125 requests
Source: `docs/concepts/profile-live1-2026-11-20.json`.

What it looked like: `strat-serial-2.0 | tencent/hy4-flash`, 18 turns, 125 main requests, 0 helper requests, $0.01206 (median $0.00009 per request, p95 $0.00016, max $0.00026). 145 calls: `shell` 119, `output_read` 21, `run_js` 5. Result classes: ok 138, error 4, find-absent 2, refused 1. 0 byte-identical repeats. Cache 98% overall, first hit at request 1, no request at 0 after a hit except two rows with no usage (the failed requests). Prompt per request 3.3k to 55.4k tokens, rising on every request; output per request 148 tokens on average, max 1.1k; reasoning 18% of output. Stops: 14 turns `limit`, 2 `failed`, 1 `held` (a skipped request), 1 `done`. Follow-ups: 16 of 17 were 8 chars; 14 continue a round-limit stop.

Shell command lines by first word (104 kept, 15 longer than the kept length and stored as size and hash): `sed` 32, `git` 24, `node` 15, `python3` 9, `cat` 8, `grep` 7, `nl` 6, `cp` 2.

Pointers drilled: none by content. The command lines in the profile were read (they are kept by design): the 4 `run_js` errors are in turns 3 (two), 4 and 16; the 2 find-absent and the 1 refused are `shell` results classed by their leading words.

Open questions it raises:
- How much of the 125 requests is reading? `sed`, `cat`, `nl`, `grep` and `output_read` are 74 of 145 calls for a change of 21 lines in 2 files.
- Would a host edit tool remove the `python3` and `run_js` calls, and how many requests with them?
- Is a round limit of 8 the right default when one tool call is one round? 14 limit stops in one task.
- What does a session of this length cost on a provider that does not cache? The uncached rate for 4.7M prompt tokens was not looked up.

Hypotheses touched (description only):
- F1: supports the narrow claim (a profile with argument summaries resolves path and command steps): 11 of 11 checkable validators resolved, against 0 of 66 before. Silent on whether a fail is meaningful (no flow attribution).
- H2 (cache floor): silent: request 0 (3.3k prompt tokens) had no hit and request 1 (4.6k) had one, which a floor near 4,096 and a plain first request both produce.
- H7 (repeat note): silent, 0 repeats.
- H10 (templated nudge): silent; every `continue` here followed a limit or a provider failure, none a stall.

Limits: one session, one model, one task, one operator; the operator held and read every step, which a person would not do at this length.

### 2026-11-20 · live stepped session 2 (host files, 40 tool rounds, no run code) · n = 1 session, 27 requests
Source: `docs/concepts/profile-live2-2026-11-20.json`.

What it looked like: `strat-serial-3.0 | tencent/hy4-flash`, 1 turn, 27 main requests, 0 helper requests, $0.00264 (median $0.00007 per request). 28 calls: `file_read` 11, `file_edit` 9, `shell` 5, `output_read` 3; all results ok. 3 byte-identical repeats in 3 runs (the same line range read again after an edit). Cache 94% overall, first hit at request 1 (20%), 92% or more from request 2. Prompt per request 3.9k, then 17.8k to 24.9k; output 4,459 tokens, 38% reasoning. 3 calls before the first write (`file_edit`), 14 before the first commit. Stop: done. No follow-up messages.

Pointers drilled: none.

Open questions it raises:
- Session 1 and session 2 differ in task and in four options at once. Which of the four accounts for the drop from 125 requests to 27 cannot be read from these two runs; a pair on one task with one option changed would say.
- The two whole-file reads cost about 14k prompt tokens that every later request re-sent. Would a brief that names line ranges, or a cap on a whole read, change the total?
- Is re-reading a range after each edit worth its request? 3 of 27 requests here.

Hypotheses touched (description only):
- F1: 5 of 11 checkable validators pass on this profile (4 of 11 on session 1). Still no flow attribution.
- H7 (repeat note): the 3 repeats here are reads of text that had just changed; a repeat note keyed on byte-identical calls would have fired on useful reads.

Limits: one session, one model, one small task.

### 2026-11-20 · H12 canary pair (host files off and on, one task) · n = 2 sessions, 36 requests
Source: `docs/concepts/profile-h12-blue-2026-11-20.json`, `docs/concepts/profile-h12-green-2026-11-20.json`.

What it looked like, blue then green, both `strat-serial-3.0 | tencent/hy4-flash`, one turn each, stop done, no follow-ups: requests 18 and 18; calls 18 and 19; all results ok in both; repeats 0 and 0; cost $0.00147 and $0.00172; prompt tokens 250.1k and 314.0k; cache 92% and 93%, first hit at request 1 in both (82% and 23%); output 3.0k and 3.4k tokens, reasoning 29% and 53% of it; calls before the first commit 12 and 11; calls before the first write: none seen for blue (its writes are shell command lines), 7 for green.

Pointers drilled: none.

Open questions it raises:
- Green's reasoning share is 53% against blue's 29% on the same task. Is that the three extra tool definitions, or run-to-run spread? One pair cannot say.
- A whole-file read is the dearest single call in both arms. Would a brief that points at the function, or a tool answer that offers an outline before the whole file, cut the prompt weight?

Hypotheses touched (description only):
- H12: requests equal (does not support the claim), scripted writes 4 and 0 (supports that part), cost 1.17 times in green's disfavour.
- H2 (cache floor): request 1 hit the cache at 3.8k prompt tokens in blue, below 4,096; that does not fit a floor at 4,096 for this route.

Limits: two sessions, one task, one model; blue ran first.

### 2026-11-20 · H12 full stage, written as it runs (task 4 pair done, task 5 blue done, task 5 green running) · n = 3 sessions so far, 67 requests
Source: `docs/concepts/profile-h12-t4-green-2026-11-20.json`, `docs/concepts/profile-h12-t4-blue-2026-11-20.json`, `docs/concepts/profile-h12-t5-blue-2026-11-20.json`; event lines in `docs/concepts/h12-full-progress.jsonl`.

What it looked like, `strat-serial-3.0 | tencent/hy4-flash`, page at `73b2d89`, live and stepped:
- Task 4 (doc edit, one file), green then blue: requests 8 and 11; calls 10 and 15; cost $0.00211 and $0.00150; prompt 140.8k and 141.3k tokens (84% and 85% cached); output 8.2k and 4.1k tokens; one turn each, no operator message; scripted file writes 0 and 1 (one `python3` here-document); both completed as asked, one commit each, only `docs/PROTOCOL.md` changed.
- Task 5 (checks first, then three files), blue: 48 requests, 54 calls (44 `shell`, 10 `output_read`), two turns (a 40-round limit stop, then the operator sent "continue"), cost $0.00536, prompt 1.31M tokens (97% cached), output 13.4k; two commits (Spec, red 38/67; then the implementation), `profile` 67/67 and `validators` 46/46 re-run in the clone. Calls before first commit 31. 11 shell command lines have an inline-program shape on the kept first line; read by hand, at least 3 of them read a file or test a string rather than write one, so the shape count over-reads writes.
- The profile reports `held` results in all three sessions (2, 1, 1) where nothing was held: the classifier matches the word "held" in the first 120 characters of a result, and the repository text printed by `git log` and `cat` contains it. Results other than ok, held excluded: 0, 0 and 4 (2 `find-absent`, 2 `No stored call`).
- Two blue calls of task 5 were `shell {"ref": "os:..."}` with handles no earlier call held. The held step showed the handle and "the stored arguments are not in this browser's store"; released, each came back as `No stored call` and cost a round. The profile counted both as ok.

Pointers drilled: `dump` of each session for the held-class check and for the two refs (message text stays out of the repository).

Open questions it raises:
- The held step's note for an unknown handle is true; is it enough? An operator reading it cannot tell a handle the page lost from one the model made up. Here both were made up (each appears only in the call and its answer). A gap to specify before changing: say that no call of this session holds the handle and that releasing it will fail.
- Task 5 blue took 48 requests against 11 for the doc edit; is the multi-file shape what the file tools help most, or not? Green's task 5 answers.
- Blue's 4 stored-by-handle shell calls cannot be counted from the profile; the count of scripted writes is a floor.

Hypotheses touched (description only):
- H12: task 4 requests 8 (green) against 11 (blue) and calls 10 against 15 support the claim on a doc edit; cost was 1.41 times higher in green, so the claim holds on requests and calls and fails on cost there. Task 5 not complete.

Limits: one model, one run per cell, blue and green not interleaved within a task beyond the order given (task 4 green first, task 5 blue first).
