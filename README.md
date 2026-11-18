# WebHarness

A client-side LLM chat harness served straight from this repo with GitHub Pages. No server, no build step: the browser holds the API key, the sessions and the tools.

Status: working skeleton (v0.1.0). The OpenRouter path is written from the OpenAI-compatible conventions and has not yet been run against the live API.

## Run

- Hosted: enable Pages (Settings > Pages > Deploy from a branch > `main`, `/ (root)`), then open `https://glyphcore.github.io/WebHarness/`.
- Local: `python3 -m http.server 8787` in the repo root, then open `http://localhost:8787/`.
- No key needed to try it: choose the provider "Mock (offline)" and model `mock-1`. Say "tool" or "widget" to see a tool round trip.
- Smoke test (needs Playwright): `node scripts/smoke.mjs`

## How it fits together

| File | Job |
| --- | --- |
| `index.html` | Shell. Picks the code ref, loads `app/` from it. |
| `app/main.js` | Controller, DOM, the turn loop (request > stream > tool calls > repeat). |
| `app/context.js` | Builds the request from the session log; measures the cached prefix. |
| `app/providers.js` | Pluggable providers: OpenRouter (OpenAI-compatible SSE) and an offline mock. |
| `app/tools.js` | Tools the model can call, and the Worker that runs code. |
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

### Tools

Tool definitions make no mention of where they run. Current set: `run_js`, `scratchpad_read`, `scratchpad_write`, `show_widget`.

- `run_js` runs in a dedicated Worker: no DOM, no localStorage (so no API key), killed after 5 s. It is not a network sandbox; code can still call `fetch`.
- `show_widget` renders HTML in an iframe with `sandbox="allow-scripts"`, which cannot read the page or its storage.

### Cosmetic state

Which session is visible, the highlighted row and the inspector toggle are each one small `<style data-bind="...">` whose selectors target data attributes. Switching session rewrites one rule; no message node is rebuilt.

## Data and privacy

- The API key lives in `localStorage` under `wh:keys` and is never included in an export.
- A `.session` file holds one session (system prompt, messages, ledger) plus the scratchpads.
- A pinned ref runs that ref's code with access to your key. Pin only refs you trust.

## Not built yet

- OpenRouter specifics: explicit `cache_control` breakpoints, provider pinning for cache affinity, passing `reasoning_details` back in tool loops.
- Context files with gitignore-style include patterns (CLAUDE.md-like constraints, skills, agents).
- Rewind and summarise, subagent fan-out on a shared prefix, paradigm comparison runs.
- Markdown rendering beyond fenced code blocks.
