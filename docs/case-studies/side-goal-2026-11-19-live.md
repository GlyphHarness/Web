# Case study: side goal, live on qwen/qwen3.7-flash (2026-11-19)

Real model through OpenRouter (key added by the network proxy), every run in a fresh browser. The core designs a small CLI over 3 turns and needs two numbers for its docs (the 300th prime, 1987, and the sum of the first 300 primes, 271,061); the side goal computes them with run_js (2 turns and a wrap-up); the core goes on 2 turns; then it must state both numbers. Coherent = its final reply has both, correct. Cost is what OpenRouter reported. 3 runs per strategy; the median run by cost is shown, with the range.

## Round 1 (stems did not inherit the core's upstream)

| strategy | requests | uncached input | output (reasoning) | cost | vs serial | coherent |
|---|---|---|---|---|---|---|
| strat-serial-1.0 | 17 | 12.4k | 7.1k (4.0k) [7.1k–8.3k] | $0.00177 [0.00149–0.00206] | - | 3/3 |
| strat-stem-1.0 | 23 | 55.2k | 20.5k (15.2k) [9.3k–27.3k] | $0.00463 [0.00205–0.00587] | +161% | 3/3 |

## Round 2 (stems go to their core's upstream; strat-stem-2.0 added)

| strategy | requests | uncached input | output (reasoning) | cost | vs serial | core context | coherent |
|---|---|---|---|---|---|---|---|
| strat-serial-1.0 | 13 | 11.5k | 8.2k (5.3k) [7.1k–14.9k] | $0.00172 [0.00159–0.00264] | - | 32.8k chars | 3/3 |
| strat-stem-1.0 | 16 | 5.2k | 17.4k (15.8k) [10.1k–17.4k] | $0.00270 [0.00206–0.00290] | +58% | 47.8k chars | 3/3 |
| strat-stem-2.0 | 21 | 11.4k | 17.2k (12.6k) [11.3k–20.8k] | $0.00311 [0.00207–0.00343] | +81% | 33.6k chars | 3/3 |

## Reading

- **The upstream fix worked.** Stems missed the core's cache because a new session was routed to any provider: uncached input fell from 55.2k to 5.2k and the stem's extra cost from +161% to +58%.
- **On this model and scenario, stems still lose on cost.** The stem's own work produced 5.7k–12.2k output tokens (mostly reasoning), while serial did the whole scenario in 7.1k–14.9k. A stem also adds requests: opening it, the wrap-up, and the core reading the fold.
- **The framing hypothesis is not supported.** strat-stem-2.0 (the goal in plain words, low reasoning effort asked for) was no cheaper than 1.0; its reasoning stayed high. Whether this model and route honour the effort setting is not verified.
- **Variance is large.** Serial ranged from 7.1k to 14.9k output on the same script; one run per strategy could not have told these apart. The ranges of stem-1.0 and serial overlap at their ends.
- **Against the mock study.** The mock showed stems saving input on breakpoint providers and costing about the same on automatic caching. With a real cheap model, output dominates: the input stems save is cheap cache reads, and the output they add is not. Stems should be chosen where the core's context matters (long cores, costly input, context limits), not by default on cheap automatic-caching models.
- Next to test: a longer core tail (where stems' context saving should show), a breakpoint-caching model (where input is expensive), and whether the reasoning effort is applied.
