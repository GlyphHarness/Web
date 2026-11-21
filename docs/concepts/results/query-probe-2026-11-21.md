# Query surface: live probe (2026-11-21)

Model qwen/qwen3.7-flash via OpenRouter, 30 requests (cap 40, 5 per task), 8 tasks, n = 1 run per task: a smoke-level probe, not a rate estimate. This is a scripted loop with two mock tools (query, query_ref) executed by the real surface in a plain node process over fixtures, outside the harness: it is not a production-style session (CLAUDE.md step 5, docs/QUERY.md section 8 preamble), and it says nothing on whether a model re-reads less with the surface than with output_read and entry_read (not tested with a model). Raw: query-probe-2026-11-21.jsonl. A first canary series (T2, with the synthetic scratch adapter in the schema, 4 requests) is in query-probe-canary-scratch-2026-11-21.jsonl and is not counted in these numbers.

| task | completed | requests | queries | parse/validate fails | refs | ref refusals | reruns | prompt tok | completion tok | ended |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | false | 5 | 3 | 2 (PARSE,PARSE) | 6 | REF_UNKNOWN_LABEL | 1 | 13063 | 2326 | request cap per task |
| T2 | false | 5 | 4 | 3 (PARSE,PARSE,TYPE_MISMATCH) | 1 | - | 0 | 7167 | 951 | request cap per task |
| T3 | false | 5 | 5 | 4 (PARSE,PARSE,PARSE,UNKNOWN_FIELD) | 0 | - | 3 | 7020 | 713 | request cap per task |
| T4 | true | 3 | 2 | 1 (PARSE) | 0 | - | 0 | 4141 | 308 | answered |
| T5 | false | 2 | 1 | 0 | 0 | - | 0 | 2667 | 298 | answered |
| T6 | true | 3 | 4 | 2 (PARSE,PARSE) | 0 | - | 0 | 4394 | 397 | answered |
| T7 | true | 3 | 2 | 1 (PARSE) | 0 | - | 0 | 4514 | 1923 | answered |
| T8 | true | 4 | 2 | 1 (PARSE) | 1 | - | 0 | 8759 | 2143 | answered |

## OQ1 (docs/QUERY.md section 8): parse/validate failures, target under 15% by the third query

TARGET MISSED. 14 of 23 queries failed at parse or validate (60.9%); 7 of 8 first queries failed; 3 of 8 queries from the third on failed (37.5%). One model, one run per task, n = 8 tasks: smoke level, a miss at this size is a signal to look at the preface and the PARSE message (faults eapysy, sfzowp), not a rate.

`{"model":"qwen/qwen3.7-flash","tasks":8,"requests":30,"completed":4,"queries":23,"parseValidateFail":14,"parseValidateFailRate":0.609,"firstQueryFailed":7,"laterQueries":8,"laterQueryParseValidateFail":3,"refs":8,"misRef":1,"misRefRate":0.125,"reruns":4,"roundTrips":30,"promptTokens":51725,"completionTokens":9059,"reasoningTokens":7534,"cost":0.00249,"tokensPerTask":7598,"codes":{"PARSE":12,"TYPE_MISMATCH":1,"UNKNOWN_FIELD":1}}`
