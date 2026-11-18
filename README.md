# WebHarness

A client-side LLM chat harness served straight from this repo with GitHub Pages. No server, no build step: the browser holds the API key, the sessions and the tools.

Status: working skeleton (v0.14.0). The OpenRouter path is written from the OpenAI-compatible conventions and has not yet been run against the live API.

## Run

- Hosted: enable Pages (Settings > Pages > Source > GitHub Actions); every push to `main` deploys to `https://glyphharness.github.io/web/`.
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

The model list and prices come from the provider's `/models` endpoint at run time and are cached per provider for a day (`wh:models:<provider>`, "refresh list" refetches). Nothing is hardcoded. Click the model box to open the picker: each row shows the model id, context size and price per 1M input, cached-input and output tokens, with `--` where there is no cost or none is listed. A warning sign marks models without tool calling. Typing filters the list: plain words match the id or name, and `free`, `tools`, `cache`, `cheap` (sort by input price) and `<0.1` (input under $0.10 per 1M) are filters. Enter picks the first row.

The inspector's Models section is collapsed to one line: input / cached input / output per 1M tokens for the main model and for the helper model when one is set. Opened, it lists every price each of them has (cache write, reasoning, per-search and per-request charges included), context size and whether it supports tool calls. Price keys this build has no label for are shown raw. The ledger's cost column is what the provider reports per request.

### Branch and fold

A branch is a session forked from another at a cut point: a byte-identical copy of the source log plus one message naming a concern. Its turns stay in the branch. Only its fold comes back, as four lines (OUTCOME, RESULT, EVIDENCE, OPEN) under a one-line header, appended to the source.

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
- A form submit or an `emit` call is sent as a one-line `event <slot>: <json>` user message and starts a turn.
- The thread shows a chip per widget; clicking it brings the card into view.
- The stage is rebuilt from the session log, so it survives reload, export and import.

### Keeping calls and results terse

Both halves of a tool call can be bulky: the arguments the model wrote, and the result. Each is cut down once, when it enters the log, and the full text is kept in the browser (IndexedDB) under a handle such as `os:1k2j3h4g5f`.

**Arguments.** A `run_js` or `show_widget` call with more than 400 characters of arguments is logged as `{ref, name, want}`. `name` is the label the model gave the call and `want` is what it said it was looking for. Calling a tool with only `{ref}` runs the stored arguments again. Opening the call in the thread shows the full text.

**Results.** Every result first has colour codes, trailing spaces, blank runs and repeated lines removed. If it is still over 1,500 characters it is reduced, in this order:

1. The call said what it `want`s and a helper model is set in Settings: the helper returns at most 12 lines that answer it.
2. The call said what it `want`s: the lines that mention those words.
3. Otherwise: the first 900 and last 400 characters.

Every reduced result starts with a short tag such as `[os:1k2j3h4g5f 305L keywords 1/1]` (handle, line count, filter), so the model and you can see what was done and fetch the rest with `output_read`. A helper that fails falls through to the next step. Helper requests appear in the trace and the ledger. Exports include the stored text their sessions cite.

### Core prompt

New sessions open every request with a short fixed block of conventions, ahead of your own system prompt. It tells the model to make real tool calls with complete arguments every time, that the abbreviated calls it sees in its history are records written by the system and must never be written by hand, what a result tag means, and (when on) how keep marks work. The exact text is shown above your system prompt in the inspector and changes only with the two settings below it. Sessions created before v0.10 do not get it, so their cached prefix is unchanged.

### How past tool calls are sent: calls or notes

Each session has a setting under the system prompt for how its earlier tool calls go back to the model. The stored log is the same either way.

- **calls** (default): structured tool calls and tool results, as the model made them.
- **notes**: each call becomes one line in the assistant's turn, such as `[called run_js "sum rows" os:1k2j3h want: total]`, and each result becomes a `[result run_js "sum rows"]` block in the next user turn. There are no call ids or argument JSON, and what the call was looking for sits in the cached prefix right before its result.

The risk with notes is that a model copies the pattern and writes a `[called ...]` line instead of making a real call. That is detected: nothing runs, a notice appears, and the trail counts it. Changing the setting mid-session rewrites the prefix once; branches and folded sessions inherit it.

### Keep marks

New sessions have "Keep marks" on (System prompt section). It adds one sentence to the system prompt telling the model to start a line with `!` if it must survive condensing, or `!!` if it is critical. That costs one character per kept line and no wrapper markup.

Nothing is cut while the session runs, because that would break the cached prefix. The marks are read when you fold the session: the pocket is the marked lines, critical ones first, then in order of appearance, up to 30. A fold built this way makes no model request. A session with no marked lines falls back to asking the model for a pocket.

### Edge folding and the steward

A reply the model has just written has not been sent back to it yet, so it is not in any cached prefix. That makes it the one place where text can be shortened for free. Each session has a setting for it (System prompt section, "Replies, when first sent back to the model"):

- **off**: replies go back whole.
- **marks** (default for new sessions): a reply over 600 characters that has `!` lines goes back as those lines only.
- **helper**: as marks; a long reply with no marks is condensed by the helper model.

The full reply stays in the log and on screen; a condensed one has a coloured edge and a "sent back as" line showing what the model will see. Once a reply has been sent, its form never changes again.

A condensed reply goes back as a reference: one line such as `[os:1k2j3h4g5f troubleshot]`, then the kept lines. The word after the handle says what that turn did (searched, verified, troubleshot, built, decided or answered). The model can open the record with `entry_read`, one part at a time:

| Part | What it returns | Source |
|---|---|---|
| `gotchas` | the calls that failed, with their first line | the log |
| `steps` | the calls made, in order, with outcome and output handle | the log |
| `transcript` | the full reply | the log |
| `summary` | at most 6 lines on what was done and concluded | the helper model (the kept lines if none is set) |

`entry_read` refuses without a `why`, and the reason is written to the trail, so you can see how often records are opened and for what.

The **steward** is a single helper-model request that serves all sessions at once, about a second after the app goes idle. It receives numbered items (a reply to condense, a session to title), not conversations, and the harness applies its answers. If it fails, nothing is changed. It needs a helper model in Settings.

The **Sessions** section of the inspector lists every session side by side from the ledgers alone: branches, requests, context size, cached share, condensed and pending replies, cost, plus the steward's own totals.

### Folding a session

"fold session" starts a new session from a pocket and leaves the original untouched. The pocket is the lines the model marked to keep; if there are none, the model is asked, in a branch, for at most 30 lines under Goal, Settled, Worked, Do not retry and Open. Before anything is spent, a dialog shows the context size before and after, how many turns the fold needs to pay for itself at the model's prices, and which of the two pocket sources will be used.

### Tools

Tool definitions make no mention of where they run. Current set: `run_js`, `scratchpad_read`, `scratchpad_write`, `show_widget`, `output_read`, `fan_out`, `branch_read`, `pattern_find`, `pattern_get`, `pattern_put`, `pattern_run`, `entry_read`.

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
