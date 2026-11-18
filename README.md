# WebHarness

A client-side LLM chat harness served straight from this repo with GitHub Pages. No server, no build step: the browser holds the API key, the sessions and the tools.

Status: working skeleton (v0.6.0). The OpenRouter path is written from the OpenAI-compatible conventions and has not yet been run against the live API.

## Run

- Hosted: enable Pages (Settings > Pages > Deploy from a branch > `main`, `/ (root)`), then open `https://glyphcore.github.io/WebHarness/`.
- Local: `python3 -m http.server 8787` in the repo root, then open `http://localhost:8787/`.
- No key needed to try it: choose the provider "Mock (offline)" and model `mock-1`. Say "tool", "big", "widget", "form", "chart" or "fan out" to see a tool round trip.
- Smoke test (needs Playwright): `node scripts/smoke.mjs`

## How it fits together

| File | Job |
| --- | --- |
| `index.html` | Shell. Picks the code ref, loads `app/` from it. |
| `app/main.js` | Controller, DOM, the turn loop (request > stream > tool calls > repeat). |
| `app/context.js` | Builds the request from the session log; measures the cached prefix. |
| `app/providers.js` | Pluggable providers: OpenRouter (OpenAI-compatible SSE) and an offline mock. |
| `app/tools.js` | Tools the model can call, and the Worker that runs code. |
| `app/widgets.js` | Built-in widget kinds for the stage. |
| `app/patterns.js` | Pattern store, recipes with slots, automatic trail. |
| `app/outstore.js` | Handle-addressed store for large tool output. |
| `app/store.js` | localStorage layout, `.session` export and import. |
| `app/migrate.js` | Schema number and forward migrations. |
| `app/styles.js` | Dynamic style tags for cosmetic state. |

### Versions: the repo is the release channel

`index.html` loads the app from `./app/` by default. Open `?ref=<tag|branch|commit>` (or set "Pinned code ref" in Settings) and it loads `app/` for that git ref through jsDelivr instead. The page origin does not change, so any build reads the same stored data.

Data carries a schema number. A change to stored data means `SCHEMA + 1` and a new step in `app/migrate.js`; shipped steps are never edited. Migration runs on load and on import. A build that meets data from a newer schema refuses to start instead of writing to it.

### Cache-stable context

The session log is append-only and is sent exactly as stored: system prompt, tool definitions, then messages in order. Each request is therefore the previous one plus a tail, which is what upstream prefix caches reward.

The cache ledger shows two numbers per request:

- **kept**: how much of the previous request this one repeats byte-for-byte, measured locally.
- **cached**: input tokens the provider reports as cache hits (`usage.prompt_tokens_details.cached_tokens`).

Editing the system prompt or switching model mid-session is allowed, and shows up as a broken prefix. Scratchpads marked "in context" are attached to the next user message only when new or changed, so they never rewrite earlier bytes.

### Trace and replay

Every request made during a page load is recorded in memory: the body sent, the HTTP status, and the raw response text in the chunks it arrived in, with millisecond offsets. The API key is not recorded; your message text is. "export .trace" in the inspector downloads the lot.

`node scripts/replay.mjs FILE.trace [port] [--fast]` serves the app and answers `/api/v1/chat/completions` from that file with the recorded chunks and timing. Set "API base URL" to `http://localhost:PORT/api/v1` and the real provider code runs with no upstream access. The server prints whether each incoming body matches the recorded one, so a change to request assembly can be checked against a real session. `scripts/sample.trace` is a hand-made example.

The same "API base URL" setting points the OpenRouter provider at any other OpenAI-compatible host.

### Model catalogue and prices

The model list and prices come from the provider's `/models` endpoint at run time and are cached per provider for a day (`wh:models:<provider>`, "refresh list" refetches). Nothing is hardcoded. The inspector shows the chosen model's price per 1M input, cached input, cache write, output and reasoning tokens, plus per-search and per-request charges. Price keys this build has no label for are shown raw. The ledger's cost column is what the provider reports per request.

### Branch and fold

A branch is a session forked from another at a cut point: a byte-identical copy of the source log plus one message naming a concern. Its turns stay in the branch. Only its fold comes back, in a fixed shape (OUTCOME, RESULT, EVIDENCE, OPEN), appended to the source.

- **By the model:** the `fan_out` tool takes a list of `{id, task, after}` concerns. Concerns with no unmet `after` run in parallel as a wave; a later wave gets the folds it depends on. All folds return as one tool result. `branch_read` fetches a branch's transcript by id.
- **By hand:** type a concern in the message box and press "branch". "fold back" appends the branch's last reply to its source without running it, so several folds can be batched.
- **Audit:** the table under a `fan_out` result (status, requests, tool calls, tokens, cost per branch) is built from the harness's records, not from what the model says it did.
- Limits: 6 concerns per call, 8 tool rounds and a token budget per branch (Settings, default 150,000), no fan-out inside a branch.

The rules this follows, where each is enforced, and what is still open are in [docs/TENETS.md](docs/TENETS.md).

### Stage: widgets, media and forms

The right pane has two tabs, Stage and Inspector. The stage shows what the model puts there with `show_widget`:

| Kind | Data |
|---|---|
| `html` | `{html}`, run in a sandboxed iframe; `emit(value)` reports an interaction |
| `text` | `{text}` |
| `image`, `audio`, `video`, `embed` | `{url}` (https; loaded only after you click) |
| `table` | `{columns, rows}` |
| `chart` | `{type: bar or line, labels, values}` |
| `form` | `{fields, submit}` |

- A call that reuses a `slot` replaces that card in place.
- A form submit or an `emit` call is sent as a `<widget_event>` user message and starts a turn.
- The thread shows a chip per widget; clicking it brings the card into view.
- The stage is rebuilt from the session log, so it survives reload, export and import.

### Large tool output

A tool result over 1,500 characters is stored whole in the browser (IndexedDB) under a handle such as `os:1k2j3h4g5f`. The log gets the first 900 and last 400 characters plus the handle, and the model can call `output_read` with `find` or an offset. Exports include the stored outputs their sessions cite.

### Folding a session

"fold session" asks the model, in a branch, for a pocket of at most 30 lines (Goal, Settled, Worked, Do not retry, Open), then starts a new session from that pocket. The original is untouched. Before spending anything it shows the context size before and after, and how many turns the fold needs to pay for itself at the model's prices.

### Pattern store and trail

Two records build up in the browser as the model works:

- **Trail (automatic):** one row per tool call: tool, argument shape, outcome, size, time, session. The harness writes it; the model is not asked. It is included in `.trace` exports.
- **Patterns (authored):** solutions, gotchas, patterns, philosophies and recipes the model stores with `pattern_put`. Each is at most 1,200 characters, labelled, and linked to outputs or branches by handle. Its id is a fingerprint of its content. Who stored it (session, message, model, time) is recorded by the harness.

How the model uses them:

- A new session's first message carries a one-line-per-pattern index of the 20 most used.
- `pattern_find` searches by words, labels or kind; `pattern_get` returns one in full.
- A **recipe** is a stored tool call with `{{slot}}` placeholders. `pattern_run(id, values)` fills the slots and runs it, so a solved problem costs a few tokens the next time.

The Patterns section of the inspector lists every pattern with its origin and use count, and lets you delete one. Patterns travel in `.session` exports.

### Tools

Tool definitions make no mention of where they run. Current set: `run_js`, `scratchpad_read`, `scratchpad_write`, `show_widget`, `output_read`, `fan_out`, `branch_read`, `pattern_find`, `pattern_get`, `pattern_put`, `pattern_run`.

- `run_js` runs in a dedicated Worker: no DOM, no localStorage (so no API key), killed after 5 s. It is not a network sandbox; code can still call `fetch`.
- An `html` widget runs in an iframe with `sandbox="allow-scripts"`, which cannot read the page or its storage. An `embed` is a third-party page and gets its own origin.

### Cosmetic state

Which session is visible, the highlighted row and the inspector toggle are each one small `<style data-bind="...">` whose selectors target data attributes. Switching session rewrites one rule; no message node is rebuilt.

## Data and privacy

- The API key lives in `localStorage` under `wh:keys` and is never included in an export.
- A `.session` file holds one session (system prompt, messages, ledger) plus the scratchpads.
- A pinned ref runs that ref's code with access to your key. Pin only refs you trust.

## Not built yet

- OpenRouter specifics: explicit `cache_control` breakpoints, provider pinning for cache affinity, passing `reasoning_details` back in tool loops.
- Context files with gitignore-style include patterns (CLAUDE.md-like constraints, skills, agents).
- Rewind, paradigm comparison runs. See the concerns list in `docs/TENETS.md`.
- Markdown rendering beyond fenced code blocks.
