# stripe-1.0 live probe, 2026-11-21

Model `qwen/qwen3.7-flash` (temperature 0, reasoning off, max_tokens 160/60); 36 requests; one run per cell, so n is 6 blobs per condition: read the counts, not the percentages. Script `scripts/probe-stripe.mjs`; pairs in `stripe-probe-2026-11-21.jsonl` (no keys, no headers). No legend for the marker notation was given to the model in any condition.

| condition | view chars (mean) | prompt tokens (mean, fact asks) | fact correct | fact answer in view | about keyword score (mean of 6) | about keywords in view (mean) |
| --- | --- | --- | --- | --- | --- | --- |
| full | 5124 | 1930 | 6/6 | 6/6 | 0.73 (n 6) | 0.90 |
| stripe | 1273 | 792 | 1/6 | 4/6 | 0.37 (n 6) | 0.53 |
| ends | 1273 | 532 | 1/6 | 1/6 | 0.57 (n 6) | 0.77 |

## Per blob (fact: 1 correct, 0 wrong, in view y/n; about: keyword score)

| blob | view chars full/stripe/ends | fact full | fact stripe | fact ends | about full | about stripe | about ends |
| --- | --- | --- | --- | --- | --- | --- | --- |
| docs | 5721/1419/1419 | 1 y | 1 y | 0 n | 0.6 | 0.4 | 0.4 |
| catalog | 3585/892/892 | 1 y | 0 n | 0 n | 0.4 | 0.0 | 0.0 |
| json | 4364/1081/1081 | 1 y | 0 y | 1 y | 0.8 | 0.4 | 0.6 |
| code | 7202/1798/1798 | 1 y | 0 y | 0 n | 0.8 | 0.4 | 0.8 |
| log | 5128/1271/1271 | 1 y | 0 y | 0 n | 1.0 | 0.4 | 0.8 |
| table | 4741/1177/1177 | 1 y | 0 n | 0 n | 0.8 | 0.6 | 0.8 |

Totals: prompt tokens 38746, completion tokens 850, cost 0.000975 (as reported by the provider). Finish reasons: {"stop":35,"length":1}.
