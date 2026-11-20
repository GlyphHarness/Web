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
