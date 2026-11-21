# Driving WebHarness sessions

Four ways in, one record. Whatever drives a session, the evidence is the harness's own: the session log, the ledger, the trace, smells, the trail, and (for scripted runs) screenshots and a step record. Nothing relies on a model saying what it did.

## 1. A person in the browser

The page itself. Pacing (top bar) holds model requests and/or tool calls as cards to release one at a time; the custodial queue holds the harness's own housekeeping until drained.

## 2. A paired agent over the bridge

`node scripts/bridge.mjs pair --repo OWNER/NAME --page URL` prints a link; opened in the browser, the page and the agent share an encrypted channel on a `bridge/<id>` branch (`listen`, `do NAME JSON`, `show N`, `close`).

| Directive | Effect | Needs a click on the page |
|---|---|---|
| `ping`, `state`, `trace`, `trail`, `smells`, `held` | read | no |
| `session {id}` | a session's export (refused for sealed sessions) | no |
| `dom {sel, html}` | text (slot values included) or HTML of matching elements | no |
| `run {code}` | JavaScript in the no-network sandbox | no |
| `act {name}` | `new`, `inspector` | no |
| `answer {turn, content, tool_calls}` | answers a model turn when the provider is "Paired agent" | no |
| `release {id \| all, skip}` | releases or skips held steps | no |
| `answer_ask {ask, answers \| decline}` | answers a question card | no |
| `answer_value {req, value, scope, expose \| decline}` | answers a value request | no |
| `send {text}`, `set {provider, model, helper}`, `reload {ref}` | spend credit or change what runs | yes |

Up-events arrive without being asked: `hello`, `trace`, `error`, `console`, `notice`, `smell`, `approve`, `held`, `ask`, `value-request`, `queued`, `turn`.

## 3. A scripted browser (screenshots, repeatable runs)

`node scripts/drive.mjs SCENARIO.json [--url URL] [--out DIR] [--headed]` runs a scenario against the live page or a local copy and writes `DIR/record.json` (each step, its result, timing, page errors) plus screenshots at device scale 2.

```json
{"setup": {"provider": "mock", "model": "mock-1"}, "steps": [
  {"new": true},
  {"say": "please use a tool"},
  {"read": ".thread:not([style*=none]) .msg[data-role=tool] pre", "as": "result"},
  {"screenshot": "after-tool"},
  {"pane": "machine"}, {"click": "#vmdiag [data-act=explore]"}, {"wait": "#explorer .xnode"},
  {"screenshot": "files"}
]}
```

Steps: `new`, `say` (waits for the turn unless `"wait": "none"`), `click`, `fill`/`value`, `press`/`key`, `pane`, `wait` (a selector or `idle`), `read` (slot values included), `eval`, `screenshot`. `setup` is merged with paste config (non-secret settings only), so a scenario never carries a key; use the mock provider, or a page where the person has entered one.

The smoke suites (`scripts/smoke*.mjs`) are the same idea with assertions; a new feature gets checks there.

## 4. A command line (held, stepped runs)

`node scripts/wh.mjs` (wh) is a terse CLI for operators (agents or people) driving WebHarness one short command at a time. A daemon keeps one browser running, one tab per session, so held turns survive between commands; output is terse text, or JSON with `--json`.

| Step | Command | Effect |
|---|---|---|
| Start | `wh init [-m model] [-s strategy] [-w watchModel] [-p pace]` | OpenRouter provider (key added by the network proxy) |
| | `wh new [title]`, `wh use <id>` | a new session, becomes current; make a session current |
| Set what runs | `wh paste <file>` | paste a config block (settings, profiles, keys) through the page's Paste config |
| | `wh pace run\|requests\|tools\|both` | hold model requests and/or tool calls |
| Send | `wh say [-i id] <text...>`, `wh sayfile [-i id] <file>` | send; returns at the end of the turn or at a hold; a file's text uses LF line ends |
| See held | `wh held [-i id]` | what is held or waiting for approval, in full |
| Release | `wh step [-i id] [--all]`, `wh skip` | release (or skip) the held step(s) |
| Read | `wh show [-i id] [-n 6]`, `wh dump [-i id] [-o file]` | the last turns, one line each; the session's record (messages, ledger; holds message text, keys masked) |

Every command is appended to `<dir>/log.jsonl` (default `.wh`): time, command, session id, outcome, sizes and hashes. Arguments are never copied: no message text, no key. `wh log [-i id] [-n 20]` reads that command log back in order.

## Adding a tool

1. Define it in `app/tools.js` with `fn(name, description, properties, required, run)`; the description says what it does, never where it runs.
2. Put it in a group (`tools`, `repoTools`, `vmTools`, `askTools`, `valueTools`) so sessions carry it only when created with that group; a session's tool list never changes under it (cached prefix). Exception: the query tools (`query`, `query_ref`) are in no group; a strategy spec flag (`query: true`) gives them, appended last to the definitions, and only to strategies registered with it (docs/QUERY.md 6.3).
3. Map it to a capability in `profiles.js` `allowedTool`, so profiles can withhold it; calls outside the scope are refused.
4. Writes that leave the browser (GitHub, files) wait for the person: use the approval card (`ctx.git` / `approve`).
5. Large outputs go through `present()` (squeeze, `want`, helper, handle); say so in the description with `want`. Exception: `query` and `query_ref` have no `want`; the surface owns reduction and a second-model squeeze would break the header-describes-data contract (docs/QUERY.md 6.3).
6. Add a mock trigger in `app/providers.js` and checks in a smoke suite.

## Concerns and the background loop

Concerns are issues labelled `concern` (and `kind:<kind>`) in the harness repository, filed from the page, by agents through `concern_file` (approved by the person), or by hand with the issue form. A scheduled background session (Haiku) triages open concerns: labels, duplicates, one summary comment each, and a message to the working session when something needs code. Targets (Smells section) give the loop something to aim at: cache hit rate, smells per request, cost per request, per steering version.
