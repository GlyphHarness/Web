# Case study: side goal (2026-11-19-live)

Mock models: `mock-bp` caches only at explicit breakpoints (writes 1.25x input, reads 0.1x); `mock-1` caches prefixes automatically (reads 0.02x input). Prices per token: {"mock-bp":{"in":0.000003,"out":0.000015,"read":3e-7,"write":0.00000375},"mock-1":{"in":1.5e-7,"out":6e-7,"read":3e-9,"write":1.5e-7}}.

The core works 3 turns; a side goal needs 3 turns of bulky work and a wrap-up; the core goes on (the tail: 2 turns); then it needs the side goal's result. Serial and checkpoint do the side goal inline; stem works it in a stem from the turn it came up, and the core pulls the fold by handle.

| model | core tail | strategy | requests | input (uncached) | cache read | cache write | output (reasoning) | cost | vs serial | core context | coherent |
|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen/qwen3.7-flash | 2 | strat-serial-1.0 | 17 | 12.4k | 79.4k | 0 | 7.1k (4.0k) [7.1k–8.3k] | $0.00177 [0.00149–0.00206] | - | 32.2k chars | 3/3 |
| qwen/qwen3.7-flash | 2 | strat-stem-1.0 | 23 | 55.2k | 53.2k | 0 | 20.5k (15.2k) [9.3k–27.3k] | $0.00463 [0.00205–0.00587] | +161% | 50.1k chars | 3/3 |

Coherent: the side goal's result is in what the core holds at the end.
