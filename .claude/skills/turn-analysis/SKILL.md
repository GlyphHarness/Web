---
name: turn-analysis
description: Describe how WebHarness sessions and strategies operated, from turn metadata only (shape, sizes, counts, costs, cache, repeats, result classes), then drill into specific turns only where the numbers point. Use when asked how a strategy, model or run behaved, before proposing a hypothesis, or when documenting what a silo experiment did. Descriptive, not a verdict.
---

# Turn analysis

Purpose: see how strategies and models actually operate across all sessions, at a high level, without reading what was said. It records what happened and to what extent. It does not decide what works; deciding is the silo programme's job (`docs/concepts/PROGRAMME.md`).

## 1. Collect (metadata only)

```powershell
C:\wh\wh.ps1 profile -o C:\wh\profile-<date>.json
```

`wh profile` prints, per session: models and strategies, requests (main and helper by kind), cost with helper share, tokens, cache % per request and where the first hit came, prompt and output curves, tool calls by tool and by result class, repeated identical calls, calls before the first write, one line per turn (user size, assistant messages, tool sequence). Then spread by `strategy | model` (helper requests as `helper:<kind> | model`: median, p95 and max cost per request, cache, output per request, reasoning share), then per-session behaviour. The JSON holds no message content, so it is safe to keep and to commit.

Programmatic use: `scripts/turn-profile.mjs` exports `profile(session)`, `across(profiles)`, `behaviour(profiles)`, `drill(session, {msg|req})`.

## 2. Read it as description

For each strategy and model, write what it did, in the words of the numbers:

- shape: how many calls before the first write, what share of calls were reads, which tools
- friction: result classes other than `ok` (`find-absent`, `find-ambiguous`, `refused`, `error`, `held`, `not-run`), repeats and repeat runs, short follow-up user turns (a size proxy for operator nudges, not proof of one)
- weight: cost per request (median, p95, max), helper share of cost, output and reasoning per request, prompt growth
- cache: overall %, request index of the first hit, requests with 0 after a hit
- strategy machinery: checkpoint rows, helper kinds, flags by kind

Do not write "better", "worse", "works" or "fails" about a strategy here. Write "49 calls before the first write", "helper requests were 72% of cost", "first cache hit at request 6". A comparison is a pair of numbers, not a ranking. Say how small the sample is (sessions, requests) each time.

## 3. Drill where the numbers point

A number is a pointer. Examples: a run of repeats; a turn with a very large output; a request with 0 cache after hits; a `find-absent`; a cost spike. Then:

```powershell
C:\wh\wh.ps1 profile -i <session> -m <message index>   # one message: role, tool calls with args, content (truncated)
C:\wh\wh.ps1 profile -i <session> -r <ledger row>      # one request's ledger row
```

Drill is the only place content appears. Rules:

- Drill by index, one item at a time, and say why (which number pointed there).
- Never copy drilled content into docs, commits, issues or other models' prompts. Describe it in class terms ("the find string differed from the file in whitespace").
- Keys and tokens in a message are never repeated anywhere.
- If a drill needs a model to read content (a judgement that code cannot make), use a cheap model on that one item, record the cost, and keep the output as a class label.

## 4. Record

Append to `docs/concepts/OBSERVATIONS.md`, one entry per analysis:

```
### <date> · <sessions or experiment id> · n = <sessions>, <requests> requests
Source: profile JSON path or commit.
What it looked like: <numbers, per strategy | model>
Pointers drilled: <index, why, class of what was seen>
Open questions it raises: <questions, not conclusions>
Hypotheses touched: <H ids, with whether the data bears on them (supports / contradicts / silent), as description>
```

An observation may contradict a written expectation. Record that plainly; do not edit the earlier text.

## 5. Move forward

- A question from an observation becomes a hypothesis in `docs/concepts/HYPOTHESES.md` with a silo design, thresholds written first, and a cost cap.
- A silo run is profiled the same way (blue and green) and its entry names the profile files.
- What worked, to what extent, goes in `CATALOG.md` against the concept (the `Result so far` column) with the link.

## Cautions

- Cost fields come from the ledger as the provider reported them; a missing cost is zero here. Say so if rows lack cost.
- Small samples. Three sessions is a description, not a distribution.
- Session-level costs mix models; the grouped view slices by request. Use the slices.
- `helper` rows without a `kind` show as `helper:helper`.
