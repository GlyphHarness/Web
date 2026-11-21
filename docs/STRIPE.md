# Text striping (implemented, unintegrated; measured in part, 2026-11-21)

Status: implemented as `app/stripe.js` (`stripe-1.0`, `scripts/test-stripe.mjs`), not integrated into outstore or any tool; measured in part. Deterministic run over 43 repo blobs (`docs/concepts/results/stripe-det-2026-11-21.md`): parse-back, determinism and idempotence hold; rare units 1.57x and number units 1.49x the head-and-tail baseline at equal chars (auto, 0.25), identifiers 2.62x; marker overhead 36%, above the 30% bar. Live probe, one model, no marker legend, 6 blobs (`docs/concepts/results/stripe-probe-2026-11-21.md`): NO benefit over head-and-tail (fact 1/6 vs 1/6, about score 0.37 vs 0.57). Faults recorded: marker overhead, single-tab listings classed as prose, chars mode weaker than auto, chars budget undercounts tokens, the model reads the skeleton as garbled without a legend, and the S16 known check is weak (`after < K.length`). Note: the S12 spec fixture is synthetic (tuned to be feasible); the real-corpus ratios are 1.57x rare and 1.49x num, so S12 is a feasibility property of the algorithm, not the measured claim. Specified below to the level a failing check can be written from. Reducer id `stripe-1.0` (ids are never reused: a changed byte is `stripe-1.1` or `stripe-2.0`).

Text striping shrinks a blob of text to a striped skeleton: kept spans interleaved with omission markers that say how much was left out and roughly what kind. A model reading the skeleton gets an idea of what is there, which identifiers and numbers occur, and where to drill in, without reading every token. The full blob stays behind its `os:` handle (tenets 13, 20), so the reduction is lossy only on the wire.

It is one reducer among others. `outstore.js` already has three (squeeze: noise removal; shortlist: keyword lines; head and tail: `ends`), chosen by what the caller wants (tenet 25). Striping is a fourth, for the case where the caller wants "what is in here" and has no keyword and no helper. The policy that chooses it, and the query-surface header that records which reducer was applied, are a later piece (section 10).

Terms are in `catalog/nomenclature.jsonl` (stripe, skeleton, kept span, omission marker, stripe policy, reducer, reducer class, lexical rarity, analyzed-before indicator, minimum kept width, retained fraction). Concepts: text striping reducer, striped skeleton notation, lexical rarity heuristics, reducer class with analyzed-before indicator (`catalog/concepts.jsonl`); related: handles, stems and ambiguous markers (C3 in `docs/concepts/CATALOG.md`).

Scope: a standalone pure module. No DOM, no page, no storage, no clock, no randomness, no imports.

## 0. Conventions

- Length and offsets are UTF-16 code units (JS `string.length`), the unit `output_read` offsets use (`outstore.slice` / `range`). Never code points, never bytes.
- A *unit* is a maximal match of `/[\p{L}\p{N}_]+(?:[./:\\@#-][\p{L}\p{N}_]+)*/gu` (a word, or a compound identifier or path counted as one). Delimiters are every other character.
- The input is text as the harness stores it after `squeeze` (CRLF normalized to LF, noise removed). The reducer does not squeeze; if CR remains it is ordinary text.
- n = input length. A *line* is text between `\n`. A *segment* is a line, with lines over `segment` (120) chars cut at the last space at or before 120 (hard cut if none).

## 1. Output notation

### 1.1 Shape

```
skeleton = header "\n" body
header   = "[" ref " " lines "L " rid " " class " " pct "%" [ " seen" [ " " pct "%" ] ] "]"
ref      = handle | "fp:" fingerprint          ; handle = caller's, e.g. os:7k2m9x3q1a
lines    = 1*DIGIT                              ; count of LF-separated lines of the source (a trailing newline adds one)
rid      = "stripe-" 1*DIGIT "." 1*DIGIT       ; reducer id
class    = 1*(%x21-5C / %x5E-7E)                ; no space, no "]": e.g. list+headed
pct      = 1*DIGIT                              ; round(100 * kept source units / n)
body     = *( kept / marker )                   ; never two markers adjacent, never an empty kept span
marker   = "[~" count *( "," detail ) "]"
count    = 1*DIGIT                              ; omitted UTF-16 units, >= 1
detail   = "w" 1*DIGIT                          ; words (maximal non-space runs) in the omitted run, if >= 1
         / "l" 1*DIGIT                          ; "\n" count in the omitted run, if >= 1
         / "k" ("a" / "d" / "p" / "s" / "m")  ; kind sketch
```

Details appear in the fixed order w, l, k, and only when `count >= detailFrom` (default 48); below it the marker is bare `[~N]`. Kind sketch: letters `a`, digits `d`, punctuation `p` (share of non-space chars, >= 60%), whitespace only `s`, else mixed `m`. Marker cost is about 9 chars with details, 4 to 6 without; that overhead is why `detailFrom` exists.

The header is exactly one line (tenet 30: markers are single lines, never wrappers), at most 80 chars with a handle ref. `fp:` is a 10-char base36 hash of the input (`fingerprint`, pure, defined in 4). `seen` is section 5.

### 1.2 Parse-back and collisions

- Escape: in a kept span every literal `[~` is written `[~~`. Decoding left to right: `[~~` is the two chars `[~`; `[~` followed by a digit starts a marker and must match `marker` exactly; any other `[~` is a parse error. So source `[~12]` renders `[~~12]` and source `[~~` renders `[~~~`.
- A kept span may end with `[` immediately before a marker (`[[~266]`): the decoder reads the first `[` as text because it is not followed by `~`.
- Offsets: summing the lengths of decoded kept spans and the `count` of markers gives the original offset of every kept span. `parse(skeleton)` returns `{header, parts}` with `parts` = `[{kept: string} | {omit: {n, w?, l?, k?}}]`; `verify(original, parsed)` is true iff every kept span equals the source at its offset, every marker's `n`, `w`, `l`, `k` equal what the omitted source run yields, and the offsets sum to n.
- A text that already begins with a line matching `header` is a skeleton: the reducer returns it unchanged (idempotent, no nested skeletons). A source that is not a skeleton but begins that way is a known corner (open question 11).
- No kept span or marker ever splits a surrogate pair or a `\r\n`.

### 1.3 Worked examples

Five reference runs at default policy, `fraction` 0.3 unless stated, with the caller supplying the `os:` ref. Regenerated by `app/stripe.js` (the implementation) from the then-current sources and verified by `verify`; the sources have drifted a few chars since the first draft; they show shape and are not golden bytes (golden bytes become contract only when `seams` freezes `stripe-1.0`; checks assert invariants and parse-back).

E1, prose with headings and bullets: `docs/STEMS.md` section 1 (n 1407, out 409, class `list+headed`).

```
[os:7k2m9x3q1a 9L stripe-1.0 list+headed 16%]
## 1. Handles (main solution, first)

- **Opaque short ids** (`k7fq2x`): random base32, no order, no revision [~130,w27,l1,ka]*Re-pointed [~161,w30,ka] debugging [~101,w19,l1,ka]*Pulled,[~185,w34,ka] narrative [~173,w30,l1,ka] tersely:[~69,w12,ka] Without [~131,w26,l1,ka] resolver.[~98,w15,ka] re-point.[~106,w20,l1,ka] returned, so a review reconstructs [~25]
```

E2, catalog record shape: last three lines of `catalog/nomenclature.jsonl` at `fraction` 0.4 (n 864, out 328, class `json`). The header and body begin as below; keys and path-like values survive, long means-strings are omitted.

```
[os:1q8w2e3r4t 3L stripe-1.0 json 25%]
{"id":"dbnrfa","term":"graphics baseline","means":"Candidate GPU API a shader spec targets (WebGPU,[~18] WebGL)[~33] docs/platfor[~17] S7.1, 2026-11-21. 'Settled'[~18]"docs/platform/look.md"[~248,w26,l1,ka]"docs/platform/trust.md"[~102,w3,l1,km]"Per-trigger [~51,w10,ka] busy:[~164,w12,ka]
```

E3, a stored tool result: stdout of `node scripts/test-validators.mjs`, first 26 lines (n 2092, out 623, class `log`). Log class keeps the lead token of each line (the `PASS` status) within 40% of the budget, so the line structure survives.

```
[os:4d9z6c0b2n 26L stripe-1.0 log 15%]
PASS extract: every bullet becomes one step validator record, in file order
PASS [~43]
PASS [~110,w21,l1,ka] records [~35]
PASS [~78,w16,ka]
PASS [~81,w13,ka]
PASS [~73,w13,l1,ka] commands [~36]
PASS [~23] placeholders [~19]
PASS [~87,w14,ka]
PASS [~130,w25,l1,ka]
PASS extract: the spec-first [~78,w15,ka]
PASS [~72,w11,ka]
PASS [~159,w28,l1,ka]
PASS [~99,w17,ka]
PASS [~50,w8,ka] touched it
PASS [~167,w27,l1,ka]
PASS [~67,w11,ka]
PASS [~82,w14,ka]
PASS [~23] without [~24] exactly [~59,w11,l1,ka] arguments [~71,w11,ka]
PASS resolve: a failed [~33] returned [~23]
PASS [~56,w10,ka]
```

E4, code: 1300 chars of `app/outstore.js` from `// find: matching lines` (out 381, class `code`, 15%). Call and member expressions survive as short stubs; the `k` sketch marks `p` (punctuation heavy) and `m` (mixed) runs.

```
[os:8h3j5k7l9m 19L stripe-1.0 code 15%]
// find: matching lines; else a slice from offset
[~165,w30,l2,ka] l.includes(String([~34] hits.slice([~31]{l.slice([~130,w22,l2,km] Math.max(0, Number([~18] Math.min([~53,w6,l1,km] text.slice([~20] text.length [~88,w18,l3,ka] Ranged reads (strategies [~108,w19,l1,ka] 12000;[~193,w36,l2,ka] capLines([~152,w29,l4,ka] while [~112,w20,l1,ka]
```

E5, `chars` mode against `auto` on one bullet of STEMS section 1 (n 198, `fraction` 0.5, `keepFirst` 0). In `chars` mode grams of 2 to 3 chars survive; `auto` keeps whole words and identifier stubs and omits more per marker.

```
[os:2p5q8r1s4t 1L stripe-1.0 list 11%]
[~3]*Op[~18]`k7fq2x`[~9] base32,[~46] No[~100,w21,ka]
```

```
[os:2p5q8r1s4t 1L stripe-1.0 list 13%]
[~24]`k7fq2x`): random base32,[~149,w29,ka]
```

Escape: `note: the marker form [~12] is literal here, and [~~ too.` striped contains `[~~12]` and `[~~~` in kept spans; `parse` returns the original `[~12]` and `[~~`.

Observed limits in the examples (kept for honesty): a small blob has no frequency signal, so cues (identifiers, numbers, heading lines, line leads) drive selection; the markers cost tokens, so a small `minGap` is not worth it; class-neutral output on a log is weak, which is why the class changes the cue weights (section 2.5).

## 2. Algorithm family

`stripe(text, policy)` returns `{text, reduced, parts, class, kept, n, rid, ignored}`. When n <= budget the text is returned unchanged (`reduced: false`, no header).

### 2.1 Budget

budget = min(`maxChars`, `fraction` * n, `maxTokens` * `cpt`), each term only if set; `fraction` defaults to 0.3 so a budget always exists. `cpt` (chars per token) is 4. The cost of a candidate output is `header.length + 1 + body.length`, so the header is inside the budget. `pct` in the header is retained source units over n, distinct from the output-length budget (markers and header make the output longer than the kept spans).

Below a *floor* (header plus protected spans plus the markers between them) the output is the floor skeleton: header, protected spans, markers. It may exceed the budget; nothing else may (S7).

### 2.2 Atoms and scores

An *atom* is a unit (modes `auto`, `words`), a line stub (`lines`), or a gram (`chars`). Atoms are ranked by an integer band, then tie-broken, then selected in prefix order until the budget is spent.

Statistics, over the whole blob and over windows of `window` (25) segments, as pure arithmetic (no `log`, `exp`, `pow`, no locale functions: cross-engine byte-identical):

- df(u) = number of segments containing the lowercased unit u; L = segments; tau = max(1, floor(L / 32)).
- global rarity g = tau / (tau + df - 1). A hapax (df 1) has g = 1; df = tau + 1 halves it. This is an IDF-shaped smooth decay with a smoothing constant tied to the blob size, so a 10-line blob and a 10,000-line blob both separate singletons from repeats.
- local rarity = 1 / (1 + dfw - 1) with dfw the df of u inside its window. Terms common here but rare elsewhere (a topic burst) keep local weight; terms repeating all over lose it.
- R = (1 - `localWeight`) * g + `localWeight` * local, `localWeight` 0.5.
- Length factor Lf = min(1, (len + 1) / 9): short tokens ("a", "to") cannot win on rarity alone.

Cues C, first match wins:

| cue | C |
| --- | --- |
| unit on a heading line (`#`-heading, ALL-CAPS line of at most 60 chars with 3 or more consecutive capitals, line above `===` or `---`) | 1.0 |
| signal word (error, fail, failed, failure, exception, fatal, warn, warning, todo, fixme, panic, denied, timeout; case-insensitive) | 0.9 |
| identifier: contains `_`, `.`, `/`, `:`, `\`, `@`, `#`, an inner lower-to-upper step, or letters and digits mixed | 0.8 |
| number: `^\d[\d.,:]*$` | 0.7 |
| key: followed by `:` or `":`, with optional quote | 0.6 |
| line lead in class `log` or `tabular` (first token on the line) | 0.9, and exempt from the later-occurrence fade |
| line lead or first token after a list or heading marker | 0.5 |
| capitalized unit not at the start of its line | 0.3 |
| otherwise | 0 |

score = (0.6 * R * Lf + 0.4 * C) * f, with f = 1 for the first occurrence of the lowercased unit (or a log lead), 0.5 for later ones; a unit in `known` multiplies by 0.5. band = round(score * 20).

Order: band descending, then the van der Corput bit-reversal of the atom index (20 bits), then index. Ties therefore spread evenly across the blob instead of clustering at the head, and prefixes of the order stay nested.

### 2.3 Must-keep

- Hard: spans matching any `protect` regex (default `os:[a-z0-9]{6,12}`, so a handle in the text is never cut).
- Soft, ordered, each dropped before any budget is exceeded: the first `keepFirst` lines (default 1, capped at `lineCap` 80 chars); the last `keepLast` lines (default 0); the first 6 chars of any unit of 40 or more chars containing a digit (hashes, base64, long numbers); in class `log`/`tabular` the lead token (up to 12 chars) of each line, chosen in van der Corput line order, stopping at 40% of the budget.

Soft items enter the order ahead of every scored atom, in the order listed.

### 2.4 Selection and closure

Let order be hard set, soft items, scored atoms. For k atoms from the order take their union with the hard set, then apply the closure below, then render; cost(k) is the rendered cost. k* = the largest k with cost'(k) <= budget, where cost'(k) = max over j <= k of cost(j) (monotone envelope; any search that returns this k* is valid; binary search plus a verifying scan is fine).

Closure, in this order:

1. Delimiters: include the delimiter char immediately before and after each kept run (so `"k7fq2x"` keeps its quotes).
2. Gap fill: an omitted run shorter than `minGap` (default 16; 5 in `chars` mode) becomes kept. A marker for fewer chars costs more than it saves.
3. Short runs: an unprotected kept run shorter than `minKeep` (default 2) is dropped. Step 1 has already attached the adjacent delimiter to kept runs, so a 2-char unit next to a space or punctuation arrives here as a 3-char run: the design's "keep 2, or 3 near a space, punctuation or another kept piece, or nothing" is this rule plus step 1. A lone 1-char run never survives unless protected.

Closure is monotone (kept(k) is a subset of kept(k+1): step 1 and 2 only add around kept positions, and step 3 never removes a position whose run only grows), therefore retained sets nest as the budget grows. The surrogate-pair and CRLF rules are applied last, extending the kept side.

### 2.5 Modes and class profile

- `auto` (default): lines, words and identifier stubs together, as above.
- `words`: whole words only (no identifier stubs; compounds stay whole).
- `lines`: whole lines ranked by their best atom score; the marker runs are line-aligned.
- `chars`: character-level striping. Each unit is cut into grams of 2 chars with a remainder merged so the last gram is 3 (a unit of 5 is 2+3); a unit of 1 is one atom that survives only when merged. Gram factor on the unit score: first 1.0, last 0.8, interior 0.5. `minGap` 5. Whether `chars` beats `auto` at equal tokens is to be measured (it keeps many tiny pieces and pays many markers).

The class (section 5) selects a profile: `log` and `tabular` turn on the lead-token cue and soft must-keep; `json` raises the key cue to 0.8; `headed` leaves heading lines at 1.0; the others use the table as is. A policy `class` override picks the profile directly.

## 3. Policy object

A stripe policy is a plain object; every key optional; `stripe(text, {})` equals `stripe(text, DEFAULTS)`; key order is irrelevant; unknown keys are ignored and listed in `result.ignored`.

| key | default | meaning |
| --- | --- | --- |
| `mode` | `auto` | `auto`, `words`, `lines`, `chars` |
| `fraction` | 0.3 | budget as a fraction of n |
| `maxChars` | unset | budget cap in chars (the later integration passes the view size here) |
| `maxTokens`, `cpt` | unset, 4 | token cap, converted by `cpt` chars per token |
| `minKeep` | 2 | minimum kept width |
| `minGap` | 16 (5 in `chars`) | smallest omission worth a marker |
| `gram` | 2 | gram width in `chars` mode |
| `localWeight`, `window`, `segment` | 0.5, 25, 120 | rarity mix and statistics windows |
| `keepFirst`, `keepLast`, `lineCap` | 1, 0, 80 | head and tail lines always kept |
| `protect` | `['os:[a-z0-9]{6,12}']` | regexes (source strings) of spans never cut |
| `detailFrom` | 48 | smallest omission that carries `w`, `l`, `k` |
| `known` | `[]` | terms already in the model's context; damps rarity |
| `class` | unset | class override |
| `handle` | unset | ref for the header (else `fp:` fingerprint) |
| `seen` | `{}` | analyzed-before map (section 5) |
| `maxInput` | off | refuse above n chars (a restriction; off by default, CLAUDE.md) |

Restrictions (an input cap, a deny pattern, a mandatory handle) are options, off by default. The only built-in keep rule is the handle regex, because a skeleton that cuts a handle breaks tenet 20. "Policy can forbid verbose exposure" is expressed as the budget keys: the policy layer that later chooses this reducer sets `maxChars` or `maxTokens`; the module obeys the smaller of all budget terms.

## 4. Determinism

`stripe`, `parse`, `verify`, `classify`, `fingerprint`, `locate` are pure functions: same text and same policy value give a byte-identical result on any engine. No `Date`, no `Math.random`, no `Intl`, no `toLocale*`, no `Math.log/exp/pow` (arithmetic and integer ops only), no regex flag or property whose result varies by engine beyond `\p{L}`/`\p{N}` Unicode data (pinned in open question 12), no iteration over an unordered structure into the output. Inputs are not mutated. Memoizing statistics by fingerprint is allowed and must not change bytes.

`fingerprint(text)`: 10 chars, lowercase base36 of a 53-bit two-lane multiplicative hash (cyrb53 family) over UTF-16 code units. Used for `fp:` refs and blob ids. Not cryptographic; collisions only cause a wrong `seen` hit and are rare enough to accept (open question 9).

## 5. Reducer class and analyzed-before indicator

### 5.1 Reducer class

The reducer classifies, notionally, which kind of filtering it applied. `classify(text)` returns `{label, features}`. Features are line shares: `headed` (`#` heading or `===`/`---` underline; threshold 0.08), `list` (bullet or number), `tabular` (two or more `|` or tabs), `code` (statement-ish endings and keywords; `json` subsumes it), `log` (timestamp, level word, `PASS`/`FAIL`, or a hash lead), `json` (lines starting with `{`/`[` or containing `"key":`); thresholds 0.3 each except headed. The label is the top two features by share/threshold ratio joined by `+` (`list+headed`), else `prose` (mean non-blank line length at least 40), else `mixed`. Prototype labels: `docs/STEMS.md` `headed+list`; `CLAUDE.md` `list+headed`; `catalog/concepts.jsonl` `json`; `scripts/ci.mjs`, `app/outstore.js` `code`; `node scripts/test-validators.mjs` output `log`.

The label rides in the header (`class`), so the model and an audit both see what profile ran. It is a notional label, not a promise: the claim to test is that it correlates with which cues carried the selection.

### 5.2 Analyzed-before indicator

The caller owns memory (the module stays pure). `policy.seen` maps blob id (handle, else fingerprint) to `{rid, policyDigest, pct, class}`. `policyDigest` = fingerprint of the canonical (sorted-key) JSON of the policy minus `handle` and `seen`.

- Same blob id, same `rid`, same digest: output is the header alone with ` seen` (`[os:.. 8L stripe-1.0 list+headed 16% seen]`, no body): the model already has this skeleton.
- Same blob id, different digest, or a narrower budget than before (`pct` smaller): full skeleton with header suffix ` seen PCT%` (the earlier retained percent), "again with another cut".
- Not seen: no suffix.

`known` (terms already in the model's context, from the caller) damps rarity by 0.5 so a skeleton does not spend budget on what the model already has; `known` empty yields byte-identical output to not passing it. Blob-only statistics is the default (open question 7).

## 6. Handle link

The skeleton always cites the full blob: `ref` is the caller's `os:` handle (tenet 13) or `fp:`. The module stores nothing. Because marker counts are UTF-16 units, the original offset of any kept span is recoverable by summing, and `locate(parsed, i)` returns `{offset, line}` of the i-th kept span. `outstore.slice(text, {offset, length})` at that offset starts with the kept span, and `output_read` with the same offset reads the omitted run next to it: a model that sees `[~129,w27,l1,ka]` can drill in by handle and offset, not by guessing. The handle in a stored skeleton is a reference (tenet 37); re-pointing it (stems, warp) changes what it resolves to, not the skeleton bytes (tenets 1, 2).

## 7. What to measure (step 5, later)

All on production-style sessions per `docs/concepts/PROGRAMME.md` and `.claude/skills/context-experiments/SKILL.md`; thresholds below are provisional and are written down before any run. No puzzles, no arithmetic prompts, no graft sessions built for the test.

Offline, no model (plain node over the repo's own docs, catalog and a corpus of real stored tool results from silo sessions):

1. Retained fraction: kept chars and estimated tokens against the budget, and the budget error. Provisional: within 10% of budget for n >= 2000. Marker overhead (marker chars over output chars): provisional under 30% for n >= 2000.
2. Rare-token retention: share of df-1 units kept versus share of top-decile-df units kept, against head-and-tail at equal chars. Provisional: rare retention at least 2x the head-and-tail baseline.
3. Identifier and number retention: share of identifier-class and number-class units kept versus baseline. Provisional: at least 1.5x.
4. Parse-back exactness: `verify` true on 100% of runs; determinism 100%; nesting violations 0.
5. `chars` versus `auto` at equal estimated tokens (marker cost), and the `minGap` break-even.

Live, bounded (cheap models only: `tencent/hy4-flash`, `qwen/qwen3.7-flash`; never an Anthropic model through OpenRouter):

6. Probe on real work: on stored results from the session, show the model the skeleton versus head-and-tail `ends` at equal chars and at equal tokens; ask "what is in this output" (graded by a keyword rubric written before the run) and one question the session actually needed answered (ground-truth string recorded before the run). Record the drill-in `output_read` count and cost; cap about $0.02 per run.
7. Canary 1+1, then 3+3 per arm per PROGRAMME.md, in a silo (own strategy id, throwaway branch). The operator judges from diff and ledger, never from a model's own report. Results recorded per model in the concept's `models[]`, negative results too.

## 8. Contracts (seams and interactions only)

Checks run in plain node as `scripts/test-stripe.mjs`, printing `PASS name` / `FAIL name`, over fixed fixtures (the five worked inputs plus a synthetic blob generator with a seeded PRNG inside the test). Each is observable pass/fail.

- S1 Pure: two calls with equal inputs return deep-equal results; the input string and policy object are not mutated; policy key order does not change the output.
- S2 Identity: for n <= budget, `text === input`, `reduced === false`, no header. A text that begins with a header line is returned unchanged (idempotent), byte-for-byte.
- S3 Header grammar: for every reduced output the first line matches the `header` grammar exactly, is one line, at most 80 chars with an `os:` handle, and carries `rid` equal to `ID`, `lines` equal to the source line count, and `pct` equal to `round(100 * kept / n)` computed from `parse`.
- S4 Parse-back: `verify(input, parse(output))` is true over a corpus of at least 50 inputs (the repo's docs, catalog files, code files, generated log and JSON text) and every mode and budget in {0.1, 0.2, 0.3, 0.5, 0.7}.
- S5 Marker grammar: every marker matches `marker`; details are in order `w`, `l`, `k`; none below `detailFrom`, all `w`/`l`/`k` equal recomputation from the omitted run; no two markers adjacent; no empty kept span.
- S6 Escape round-trip: an input containing `[~12]`, `[~~`, `[~` before a non-digit, and a kept span ending in `[` before a marker decodes back exactly; a stray `[~x` in a skeleton makes `parse` throw.
- S7 Budget: for reduced outputs `output.length <= max(budget, floorLength)` where `floorLength` is the header plus hard-kept spans plus markers; with no protect match in the input, `output.length <= budget`.
- S8 Nesting: for budgets b1 < b2 on the same input and policy, the kept positions of the b1 output are a subset of the b2 output's (by decoded offsets), for all modes.
- S9 Min width and gap: no unprotected kept run shorter than `minKeep`; no omitted run shorter than `minGap` (except at input edges); `chars` mode uses its own `minGap`.
- S10 No splits: no kept span or marker boundary falls between the halves of a surrogate pair or between `\r` and `\n`.
- S11 Must-keep: every `protect` match survives whole at any budget; with `keepFirst` 1 the first line (to `lineCap`) is the start of the body unless the budget is below the floor, in which case soft items yield first; `keepLast` k keeps the last k lines.
- S12 Retention preference: on a seeded blob with hapax identifiers, numbers and frequent filler words, the share of hapax identifiers and numbers retained exceeds the baseline's (head and tail from `outstore.present` at equal output chars) by at least the provisional factors in 7.2 and 7.3.
- S13 Mode shapes: `lines` outputs have markers only at line boundaries; `words` keeps no partial unit (every kept run starts and ends at a unit edge); `chars` kept grams are 2 or 3 chars except protected spans; `auto` is the default and equals `{mode: 'auto'}`.
- S14 Class record: `classify` is deterministic, returns a label in {feature, feature+feature, `prose`, `mixed`}; the header class equals `classify(text).label`, or the `class` override verbatim; the five prototype fixtures yield the labels in 5.1.
- S15 Analyzed-before: the three forms in 5.2 (header-only ` seen` for same rid+digest; full skeleton with ` seen PCT%` for a different digest or narrower budget; no suffix when absent) round-trip through `parse`, and `header.seen` is recovered.
- S16 Known: an empty `known` yields bytes identical to no `known`; a term in `known` ranks below the same term not in `known` (retention not higher, same blob).
- S17 Defaults: `stripe(t, {})` equals `stripe(t, DEFAULTS)`; unknown policy keys do not change bytes and appear in `ignored`; `maxInput` unset never refuses.
- S18 Handle link: the header ref equals `policy.handle` when given, else `fp:` + `fingerprint(text)`; for each kept span, `outstore.slice(input, {offset, length})` at its decoded offset equals the span (the interaction with `app/outstore.js`).
- S19 Edges: empty string, one char, whitespace-only text, a single long line with no spaces, text of only delimiters, and an astral-plane (surrogate) text all return without throwing, pass S4, and satisfy S7.
- S20 No dependencies: `app/stripe.js` has no `import` and no reference to `document`, `window`, `localStorage`, `fetch`, `Date`, `Math.random`, `Math.log`, `Math.exp`, `Math.pow`, `Intl` or `toLocale` (source scan); runs under bare node.
- S21 Fingerprint: `fingerprint` returns 10 chars of `[0-9a-z]`, equal for equal text, different for 1-char edits on the fixture set.

Deferred integration contracts (not part of this piece, written when the join is specified): D1 `outstore.present(raw, {want, helper, reducer})` takes a policy-chosen reducer, default `ends` unchanged (a changed model view is a new strategy id); D2 the query-surface header records the reducer id and policy digest; D3 a stored skeleton is wire-stable once first sent (tenet 33); D4 the `os:` handle in the header re-points with the store.

## 9. Open questions and decisions

1. Token versus char break-even for `minGap`. Decision: 16 default, 5 in `chars`; measure (7.5) and change by a new reducer id.
2. Marker count unit. Decision: UTF-16 code units (matches `output_read`), `w` and `l` as detail.
3. Kind sketch in the marker. Decision: yes, from `detailFrom` 48, to keep small markers cheap.
4. Default mode. Decision: `auto`; `chars` is opt-in and must beat `auto` at equal tokens to be considered.
5. Markdown and tilde safety of `[~N]`. Decision: single tilde (not `~~` strikethrough); in-text `[~` escaped as `[~~`.
6. Does the reducer squeeze? Decision: no. The caller squeezes (`outstore.squeeze`) and normalizes CRLF first; striping runs on stored text.
7. Blob-only statistics or session-wide `known`. Decision: blob-only by default; `known` is caller-supplied and off.
8. Opaque and base64 runs. Decision: keep the first 6 chars of a 40+ char unit containing a digit.
9. Fingerprint collisions. Decision: accepted (non-cryptographic); a collision can only cause a wrong `seen` header; handles are the primary ref.
10. Budget below the floor. Decision: floor skeleton (section 2.1); hard keeps may exceed the budget, nothing else.
11. Source that begins like a skeleton header. Decision: returned unchanged; a caller that must reduce such text passes it through a policy `protectHeader: false` later (not in `stripe-1.0`).
12. Unicode data pinning. Decision: `\p{L}`/`\p{N}` follow the engine's Unicode tables; fixtures avoid characters whose class changed recently; an engine difference is a recorded fault, not a contract change.
13. Unsegmented scripts (CJK, Thai). Decision: a run is one long unit; `chars` mode applies; limitation recorded, not solved here.
14. Re-striping a skeleton. Decision: identity (idempotence, S2).
15. `pct` versus output-length budget. Decision: `pct` is retained source units over n; budget is on output length; both reported.
16. Rarity form (Zipf rank, IDF with logs, df-smoothing). Decision: df-smoothing in `stripe-1.0` (arithmetic only); rank and IDF variants are separate reducer ids if measurement favours them.
17. Soft must-keeps versus the budget (the reference prototype kept them unconditionally). Decision: soft items enter the order ahead of scored atoms and yield first below the floor; worked-example bytes may differ from a conforming implementation only where the budget is below the soft set.
18. Class override and profile list. Decision: the override takes any class label; unknown labels use the default profile.

## Decisions taken at implementation

Where the doc was open, `app/stripe.js` took these (one file: S20 forbids imports, so no sibling modules).

- Atoms: `words`/`auto` use one atom per unit; `auto` cuts a unit over 24 chars to its first 12; `chars` cuts units into grams of `gram` with factors first 1, interior 0.5, last 0.8; `lines` scores a line by its best unit, times `min(1, lineCap/length)` so long lines sink.
- Rarity: `tau = max(1, floor(segments/32))`, `g = tau/(tau+df-1)`, `local = 1/df_window`, `R = (1-localWeight)*g + localWeight*local`; score `(0.6*R*min(1,(len+1)/9) + 0.4*cue) * (first occurrence or exempt ? 1 : 0.5)`, `known` terms times 0.5. Band is `round(20*score)`; ties by van der Corput bit reversal (20 bits) of the atom index.
- Cues: heading 1, signal words (error, fail, todo, ...) 0.9, identifier-like 0.8, number 0.7, key before a colon 0.6 (0.8 in `json`), line lead 0.9 (log and tabular, exempt from the later-occurrence fade) else 0.5, capitalised 0.3.
- Class features are line shares over non-blank lines; thresholds headed 0.08, others 0.3; the label joins the (at most two) features by share/threshold ratio, else `prose` when the mean line is 40 chars or more, else `mixed`.
- Soft must-keeps enter the order first: first and last lines, the first 6 chars of 40+ char digit units, and in `log`/`tabular` the lead token per line (van der Corput line order) until 40% of the budget; they yield below the floor (decision 17).
- Selection: binary search on the rendered cost (header counted) over a prefix of the order; cost is treated as monotone, k = 0 is the floor and is returned when it is already over budget. Closure order: delimiters, fill gaps under `minGap`, drop unprotected runs under `minKeep`, then pair and CRLF completion.
- Seen: the ref is `policy.handle` or `fp:`+fingerprint; the policy digest is the fingerprint of the key-sorted policy without `handle` and `seen`; an equal rid and digest returns the header alone with `seen`, a different digest returns the skeleton with `seen` and the earlier percent.
- `stripe-1.0` is not frozen: the doc names no freezing step; example bytes above are regenerated by the implementation and are not golden.

## 10. Proposed files and later join

- `app/stripe.js`: the pure module. Exports `stripe`, `parse`, `verify`, `classify`, `fingerprint`, `locate`, `DEFAULTS`, `ID` (`'stripe-1.0'`).
- `scripts/test-stripe.mjs`: plain node, no browser, mock fixtures only; one line per check, `PASS name` / `FAIL name` (S1..S21). Register in `scripts/ci.mjs`: `FILES.stripe = 'scripts/test-stripe.mjs'` and add `stripe` to the default list and the usage line.
- Later (a separate piece, its own spec): `app/outstore.js` `present` gains a `reducer` option chosen by the policy layer (`app/policy.js`), default `ends` unchanged; the sibling query-surface header records the reducer id and policy digest, so the model, the log and an audit see which reducer produced a view. Strategy ids change when the model's view changes (`strat-<name>-<major>.<minor>`, never reused).
