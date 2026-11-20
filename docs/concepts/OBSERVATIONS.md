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
