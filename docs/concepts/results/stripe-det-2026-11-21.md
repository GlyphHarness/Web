# stripe-1.0 deterministic measurement, 2026-11-21

Script `scripts/measure-stripe.mjs` (node v24.1.0); 43 blobs, 516 runs; no model. Baseline: head and tail (`ends`) at equal output chars. Retention is pooled over blobs with n >= 2000 (type level; see JSON `meta.definitions`). Raw rows in `stripe-det-2026-11-21.json`.

| mode | frac | blobs | retained (median) | out/budget | marker overhead | rare s/e (ratio) | common s/e | ident s/e (ratio) | num s/e (ratio) | parse-back | determinism | idempotent | ms/100KB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| auto | 0.1 | 42 | 5% vs 10% | 0.9905 | 43% | 14%/12% (1.21x) | 12%/59% | 45%/14% (3.18x) | 12%/13% (0.95x) | 43/43 | 43/43 | 43/43 | 105.7513 |
| auto | 0.25 | 42 | 15% vs 25% | 0.9965 | 36% | 43%/27% (1.57x) | 38%/85% | 87%/33% (2.62x) | 47%/31% (1.49x) | 43/43 | 43/43 | 43/43 | 93.5139 |
| auto | 0.5 | 42 | 39% vs 50% | 0.999 | 21% | 84%/53% (1.57x) | 85%/97% | 99%/59% (1.68x) | 86%/61% (1.41x) | 43/43 | 43/43 | 43/43 | 82.6695 |
| words | 0.1 | 42 | 5% vs 10% | 0.9892 | 42% | 13%/12% (1.13x) | 11%/59% | 43%/14% (3.06x) | 11%/13% (0.83x) | 43/43 | 43/43 | 43/43 | 92.1373 |
| words | 0.25 | 42 | 16% vs 25% | 0.996 | 36% | 42%/27% (1.52x) | 37%/85% | 86%/33% (2.61x) | 44%/31% (1.40x) | 43/43 | 43/43 | 43/43 | 88.0108 |
| words | 0.5 | 42 | 39% vs 50% | 0.999 | 20% | 83%/53% (1.55x) | 84%/97% | 97%/59% (1.65x) | 88%/61% (1.44x) | 43/43 | 43/43 | 43/43 | 88.0247 |
| lines | 0.1 | 42 | 7% vs 9% | 0.9722 | 22% | 10%/11% (0.85x) | 45%/58% | 22%/14% (1.59x) | 18%/13% (1.42x) | 43/43 | 43/43 | 43/43 | 63.7829 |
| lines | 0.25 | 42 | 20% vs 24% | 0.9839 | 13% | 26%/27% (0.96x) | 78%/84% | 48%/33% (1.46x) | 34%/31% (1.11x) | 43/43 | 43/43 | 43/43 | 62.0744 |
| lines | 0.5 | 42 | 45% vs 49% | 0.9891 | 6% | 52%/53% (0.99x) | 97%/96% | 73%/58% (1.25x) | 59%/60% (0.98x) | 43/43 | 43/43 | 43/43 | 61.7671 |
| chars | 0.1 | 42 | 3% vs 10% | 0.9958 | 63% | 5%/12% (0.41x) | 6%/59% | 14%/14% (1.00x) | 7%/13% (0.58x) | 43/43 | 43/43 | 43/43 | 129.895 |
| chars | 0.25 | 42 | 11% vs 25% | 0.9987 | 54% | 26%/27% (0.96x) | 16%/85% | 59%/33% (1.78x) | 52%/31% (1.66x) | 43/43 | 43/43 | 43/43 | 140.7404 |
| chars | 0.5 | 42 | 33% vs 50% | 0.9994 | 33% | 79%/54% (1.48x) | 57%/97% | 96%/59% (1.64x) | 99%/61% (1.62x) | 43/43 | 43/43 | 43/43 | 122.7008 |

Parse-back, determinism and idempotence columns are over all blobs of the group (any n). Retained (median) is stripe kept chars over n against the baseline's at equal output chars.

## Class labels (blob level)

| label | blobs |
| --- | --- |
| json | 10 |
| code | 9 |
| list+headed | 5 |
| headed+list | 4 |
| headed+tabular | 3 |
| prose | 3 |
| log | 3 |
| list | 2 |
| tabular | 1 |
| tabular+headed | 1 |
| headed | 1 |
| tabular+log | 1 |

## auto at 0.25 by class (all sizes, pooled)

| class | runs | rare s/e | ident s/e | num s/e |
| --- | --- | --- | --- | --- |
| code | 9 | 47%/28% | 90%/32% | 35%/45% |
| headed | 1 | 21%/22% | 44%/67% | 0%/100% |
| headed+list | 4 | 36%/22% | 80%/23% | 33%/27% |
| headed+tabular | 3 | 19%/28% | 81%/25% | 24%/29% |
| json | 10 | 62%/35% | 97%/42% | 85%/24% |
| list | 2 | 39%/23% | 89%/36% | 43%/54% |
| list+headed | 5 | 45%/23% | 88%/31% | 66%/22% |
| log | 3 | 32%/31% | 84%/38% | 19%/29% |
| prose | 3 | 35%/21% | 62%/27% | 10%/28% |
| tabular | 1 | 30%/28% | 88%/39% | 89%/30% |
| tabular+headed | 1 | 18%/21% | 79%/23% | 15%/46% |
| tabular+log | 1 | 36%/37% | 86%/32% | 29%/33% |

Provisional thresholds (auto, n >= 2000): budget within 10%: 125/126; marker overhead under 30%: 43/126; rows over budget (all modes): 0. Failures (parse-back, determinism, idempotence): 0. Header class equal to classify() on all reduced rows: true.

## Class profile against class-neutral (concept axkihp; same budget, pooled; lead = first unit of each line, key = JSON key units)

| group | frac | runs | lead profile/neutral | key profile/neutral | rare | ident | num |
| --- | --- | --- | --- | --- | --- | --- | --- |
| json | 0.1 | 10 | 4%/3% | 1%/1% | 21%/21% | 77%/79% | 21%/22% |
| log-or-tabular | 0.1 | 9 | 39%/16% | 18%/4% | 8%/10% | 22%/41% | 17%/4% |
| json | 0.25 | 10 | 11%/9% | 6%/6% | 62%/63% | 97%/97% | 85%/87% |
| log-or-tabular | 0.25 | 9 | 90%/47% | 36%/7% | 27%/32% | 84%/85% | 40%/23% |
