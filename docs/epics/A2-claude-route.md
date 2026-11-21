# A2 Claude route

Project: WebHarness. Takes `claude-route` (branch `claude-route`, `docs/platform/claude-route-survey.md`, gateway core `app/claude-gateway.js`) from "green offline" to a stage-2 driver: Claude Code in WSL (UbuntuBase, tmux session `claude`) whose requests pass through the gateway, with the user's own sign-in and the gateway blind to credentials. Plan only; nothing started. Conventions: `README.md` in this folder.

## Goal
Heavy stories (multi-seam code, long specs, judge-grade review) run in Claude Code on the user's subscription, observed and, where a policy is switched on, shaped by the gateway, with the harness's ledger and flow records covering them as they cover stage 0. The route that exists is E (the user's signed-in binary through the gateway) and later A; there is no API key from us and no Anthropic model on OpenRouter. Route C (a key held by us) is out.

## Why not a toy
- It is the route by which the hardest remaining stories of A1, A3 and B1 will actually be done; failing a gate stops stage 2 outright.
- Its claims are about production behaviour that offline fixtures cannot show: a cache hit ratio over 30 or more turns of a real session, acceptance of a synthetic stop by Claude Code, thinking-block signatures, header blindness against a canary.
- The refutations are cheap to state and costly to miss: one credential byte in a log, one doubled retry, one broken prefix.

## Flows and concepts exercised
- Concepts: gateway, route, halt-and-alter, credential blindness, origin boundary (listener split), cache_control normalisation, thinking policy, progressive budget; hypotheses R1..R18 in the survey (step one: R1-R5, R11-R13, R16, R18; next: R6-R8, R14, R15, R17; later: R9, R10).
- Strategies: the route is not a strategy; any request-body policy the gateway applies is recorded as the policy's name and version in the ledger, and a policy that changes what the model sees is a new strategy id on the harness side.
- Flows: `ep-A2.5-direct-vs-passthrough` (same scripted session, two paths), `ep-A2.7-stage2-pilot` (one real story at stage 2 against the stage-0 attempt at the same story).
- Gate labels: the brief's "R-cache", "R14", "R15 thinking policy" are the survey's R13, R14 (with R12) and R6a with R17; see README section 3.

## Stories

### A2.1 Name and concept records
- Owner `context`, stage 0.
- Needs: G0.
- Acceptance: terms `gateway`, `route`, `halt` checked against catalog aliases and settled; R1..R18 merged as hypothesis records (they sit in the branch's inbox; steward merges after review, ids unique across branches); the gate definitions of README section 3 recorded as one concept with its thresholds.

### A2.2 WSL setup: doc and script check
- Owner `seams`, stage 0 drafts.
- Needs: none; reads the branch (slice 1 setup script and the container recipe doc).
- Acceptance: a written check of the setup against the survey's design constraint: no credential in a file or chat; the binary's install and login are the user's steps; the mode (own sign-in or the user's own key) is chosen only by the container's environment (R11); tmux session name `claude` fixed; no change to the C:\wh\Web checkout.
- Measure: none (doc check). Nothing is run on the user's WSL in this story.

### A2.3 Judge claude-route, merge to dev
- Owner `judge`, then `steward`.
- Needs: none.
- Acceptance: judge reads catalog, specs (G0..G11 of the gateway core), size rules and the design constraint; findings go back as spec or code changes; suites green; merge to `dev`. Pieces the survey lists as seams 2 to 4 (forwarder, listener split, harness listener) are checked for existence; any not built becomes A2.4.

### A2.4 Remaining pieces: forwarder, listeners, provider entry, page label
- Owner `seams` for the forwarder, listener split and harness listener; `ui` for the provider label, the halted marker on the card and the route status line (ui-style, no native dialogs).
- Needs: A2.3.
- Acceptance outline (specs red first): header copy is blind (a proxy value that throws on read, R18); streaming without buffering; status and `retry-after` pass through; the Claude Code listener forwards only requests of the Claude Code shape on the unpublished listener (R16); a harness-origin request on the published listener never reaches upstream with a client credential; the page's `retrying` acts only before the first chunk (R12); `providers.claude` is a registry entry with `needsKey: false`. Tests use the mock provider and fake upstream only.

### A2.5 Live: cache hit, no double retry, origin boundary, header blindness
- Owner `context`; the user signs in (user step); the operator observes through gateway traces and the tmux session.
- Needs: A2.4 merged; G0; the user's sign-in.
- Pre-registered thresholds (from the survey): R13 cache-hit ratio per turn within 2 percentage points of direct over the same scripted session of 30 or more turns; R12 no turn replayed or billed twice; R16 no client-supplied credential upstream from the published listener; R3 and R18 canary scan finds no credential byte in logs, traces, stores, page, harness trace or an exported session.
- Acceptance: records of result, faults and cost; a failure files a concern and blocks G2.

### A2.6 Live: halt-and-alter acceptance and thinking
- Owner `context` (runs), `seams` (fixes, each its own commit).
- Needs: A2.5 green on R12/R16 (so the route is safe to run).
- Pre-registered thresholds: R14 added latency under 5 ms per event at p95 (set by measurement), a halt ends the stream with a synthetic stop Claude Code accepts without retry or a continue prompt; R6a request-side thinking parameters or the container's thinking env lower thinking tokens per turn measurably; R17 dropping or editing a thinking block on the E stream causes rejection and Claude Code's documented recovery, which costs the cache prefix, so the rule becomes "never alter thinking on the E stream; reduce on the harness copy".
- Acceptance: the thinking policy and the rule recorded as concept results with evidence; G2 complete when A2.5 and A2.6 are green.

### A2.7 Stage-2 pilot story
- Owner `steward` selects; `context` measures; Claude Code does the work through the gateway.
- Needs: G2.
- Acceptance: one real story that stage 0 attempted or could not do (candidates: A1.3 adapter wiring, an A3 validator extension, a B1 spec chapter), run once at stage 0 and once at stage 2 with the same brief (goal, record ids, file paths, done-check); one owner per file; the work lands only through the story's own rigid order and the judge; comparison of tokens, ledger cost, turns, cache, completion, and the diff the operator judges.
- Measure: per-story stage 0 versus stage 2 ledger. The answer decides which stories are promoted.

### A2.8 Progressive budget and terse flow
- Owner `seams` (budget counters), `context` (measures).
- Needs: A2.6.
- Acceptance: R5 a counter check at each delta halts within one delta and the token estimate stays within 25 percent of the final output tokens over recorded turns; R8 a terse-style instruction plus a halt budget cuts output tokens per turn by a stated fraction on the same task without lowering completion, the check a pure lexical function with a trace (no model call).

### A2.9 Cache_control normalisation (option, only if policy mode is switched on)
- Owner `seams`, `context` measures.
- Needs: A2.5.
- Acceptance: R15 with policy on, a churning-prefix session (varied tool results, compaction) has a cache-hit ratio not below pass-through and higher in at least one scripted churn case; the attribution block stays stable. If not shown, policy mode stays off by default (CLAUDE.md: restrictions are options, off by default).

### A2.10 One-way mirror and single execution (later)
- Owner `seams`, later.
- Needs: A2.7 done, a measured need. R9 hash of message list equal on both sides over N turns with cache reads high; R10 every tool call id executed once, one executor chosen per call (harness tools as an MCP server or the CLI's own tools, never both).
- Acceptance: recorded refutation or support; may close as deferred.

### A2.11 Judge, runbook, release
- Owner `judge`, then `steward`; `context` writes the runbook inbox entries.
- Needs: A2.4 to A2.8.
- Acceptance: judge pass; a stage-2 runbook section in `docs/PROTOCOL.md` or `docs/TESTING.md` (how to start the tmux session, what is logged, what is never logged, how to stop); release to `main`, `version.json` updated; inboxes merged.

## Dependencies and lanes
Order: A2.1, A2.2, A2.3 (parallel, three sessions, different owners and files) then A2.4 then A2.5 then A2.6 then A2.7, A2.8, A2.9 then A2.11; A2.10 later.
Parallel: A2.4 seams side and ui side (different files); A2.8 and A2.9 after A2.6. Not parallel: two stage-2 sessions at once (README section 7).
The user's sign-in is the one external dependency; it blocks A2.5 onward and no agent works around it.

## Measurement points
1. A2.5 direct versus pass-through cache hit (R13), blindness (R3, R18), no double retry (R12), origin boundary (R16).
2. A2.6 halt acceptance and latency (R14), thinking (R6a, R17).
3. A2.7 stage 0 versus stage 2 on one real story.
4. A2.8 budget accuracy (R5), terse flow (R8).
5. A2.9 churn case (R15).

## Risks recorded in advance
- Claude Code or the account may change behaviour between versions; each live record names the CLI version and date.
- A cache hit below the 2-point bound means the gateway stays out of the path for that route, and stage 2 runs direct with only the harness ledger from the CLI's own session records.
- Subscription capacity is shared with the user's other work; stage 2 runs one session at a time.
