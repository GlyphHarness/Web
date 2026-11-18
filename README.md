# WebHarness

A client-side LLM chat harness served straight from this repo with GitHub Pages. No server, no build step: the browser holds the API key, the sessions and the tools.

Status: working skeleton (v0.32.0). The OpenRouter path is written from the OpenAI-compatible conventions and has not yet been run against the live API.

## Run

- Hosted: enable Pages (Settings > Pages > Source > GitHub Actions); every push to `main` deploys to `https://<owner>.github.io/<repo>/` (paths are case-sensitive).
- Local: `python3 -m http.server 8787` in the repo root, then open `http://localhost:8787/`.
- No key needed to try it: choose the provider "Mock (offline)" and model `mock-1`. Say "tool", "big", "widget", "form", "chart" or "fan out" to see a tool round trip.
- Smoke tests (need Playwright): `node scripts/smoke.mjs`, `node scripts/smoke-git.mjs` (fake GitHub API), `node scripts/smoke-vm.mjs` (the Linux machine)

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

### Upstream pinning

OpenRouter names the upstream provider that served each response. The ledger shows it (hover a row), and later requests in the session ask for the same upstream first (`provider.order`, fallbacks allowed), so its prefix cache stays warm. Requests that land on different upstreams were the cause of low cached counts in real sessions. Untested against the live API.

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

Tool definitions make no mention of where they run. Current set: `run_js`, `shell` (when the machine is on), `scratchpad_read`, `scratchpad_write`, `show_widget`, `output_read`, `fan_out`, `branch_read`, `pattern_find`, `pattern_get`, `pattern_put`, `pattern_run`, `entry_read`.

- `run_js` runs in a network-less sandbox (see Sandbox); killed after 5 s.
- An `html` widget runs in an iframe with `sandbox="allow-scripts"`, which cannot read the page or its storage. An `embed` is a third-party page and gets its own origin.

### Repositories (GitHub from the page)

A page can call `api.github.com` (it answers any origin) but not git's own HTTP endpoints or GitHub's sign-in token exchange, which send no CORS headers. So there is no clone and no OAuth flow. Reads, commits, branches and pull requests go through the REST and GraphQL APIs with a token you paste in Settings.

- **Credentials, either of:**
  - a fine-grained personal access token limited to the repos it may touch (Contents read/write, Pull requests read/write, Metadata read). GitHub has no API for creating these; they are made in the web UI.
  - a GitHub App (App ID + private key). For each request the page mints an installation token for exactly the repository that request touches, with only the permission it needs (contents read, contents write, or pull requests write), valid one hour. Commits are attributed to the app's bot account. The installation is looked up per repository, so one app installed on several repos or orgs works.
- Credentials are stored with the other keys, never exported, masked in the trace and redacted from the bridge. "check" shows the account or app.
- **Tools:** sessions created while a token is set get `repo_read` (file, tree, log, diff, branches, prs), `repo_commit`, `repo_pr` and `repo_create`. Older sessions keep their tool list, so their cached prefix is unchanged; the "Repository tools" switch under the system prompt adds or removes them for one session (one prefix break, shown in the ledger).
- **Commits:** one commit per call through GraphQL `createCommitOnBranch`, guarded by the branch head it read. A change is whole `content`, `edits` (exact find/replace, each match unique), `from` (an `os:` handle) or `delete`. A missing branch is created from `from` or the default branch.
- **Approval:** every commit and pull request waits for a click on a card showing what will be written, built from the resolved files rather than the model's description.

### Sandbox

`run_js` runs in a Worker started inside a hidden `sandbox="allow-scripts"` iframe whose CSP is `default-src 'none'`. The code cannot fetch, open sockets, import scripts or reach the page's storage. It is killed on timeout. `html` widgets get the same no-network CSP, so remote media goes only through the click-gated kinds. Verified in Chromium (`scripts/smoke-git.mjs`); Firefox and Safari are untested.

### Profiles: scoped, hierarchical configuration

Sessions can belong to a profile (Inspector → Profiles). Access is decided by configuration level, not by user. A profile has a parent, a colour, settings (model, helper, policy model, pace, branch budget), capabilities (run code, fan out, ask, machine, repositories none/read/write), an allowlist of repositories (`owner/name`, `owner/*`), its own policies, and locks. A session's scope is resolved down the chain:

- **Settings** are overridden going down, unless a profile above locked them; a locked model shows the model box disabled. Where a profile supplies the model, choosing another one sets this session's own override instead of the global setting.
- **Capabilities only narrow**: a child never grants what its parent withholds. The session's tool list is built from them, and a call to a tool outside the scope is refused even if the model names it (recorded as a `scope-refused` smell).
- **Repositories** must be allowed by every profile in the chain that lists them; repo tools refuse others before any token is used.
- **Policies** add up: Settings policies first, then each profile's; a lower profile cannot replace one above it.
- **Hierarchy of sessions:** branches and folded sessions inherit their source's profile, and a session can only be moved to its profile or one below it. "New sessions use" picks the profile for new sessions.
- **In the sidebar** sessions are grouped under their scope path (`org / research`), with a coloured edge and badge.
- **The inspector is per session, and the session is a profile level.** Profiles is the first inspector section. Its first card is the current session itself: its profile (only that one or one below it), every setting and capability as the session resolves it, with the level it comes from (this session, a named profile, or defaults) and a lock mark, an "edit" row to set a value at a level from this session up (levels below a lock are disabled), and import. The profiles in its chain come next ("in this session"), then the others. Capabilities can be narrowed for one session, never widened. The former Settings section is "Defaults and connections", the bottom of every chain.
- **Harness properties vs tools.** Each attribute says who it is for. *harness*: configuration the harness uses on the session's behalf (models, pace, budget, log repo, transcripts); it never appears in anything the model reads, including refusal messages, which say only that something is not available in this session. *tools*: capabilities, which shape the model's tool list. Configuration is not access control: the log repo is where the harness keeps its records, not a wall around anything.
- **Log repo per scope.** `logRepo` and `logTranscripts` resolve down the chain like the model, so a profile (or a session) can keep its records in its own repo. Each sync goes to the repo each session resolves to. The defaults' repo is set up by hand ("set up"); a repo first met through a profile is checked: an empty one gets the layout, a missing one is never created silently (a `log-repo-unavailable` smell; skipped).
- **Mutable state.** Every profile, and each session, has a "mutable" toggle. Mutable (the default) can be changed as you work: from its card, the scope table, import, or the top-bar model and pace. Frozen is read-only: the card's fields are disabled, the level cannot be chosen anywhere, paste config and import refuse to change it, and a frozen session refuses its own changes and says why. Switching it back is always allowed.
- Profiles are part of paste config (merged by name, `parent` by name) and of steering fingerprints and log-repo session rows.

### Scoped values

Named values a session can use (an endpoint, a region, a naming rule, a decision), kept in the scope they belong to: settings-wide, a profile, or one session. A session sees its own, its profile chain's and the settings-wide ones (Inspector → Values).

- **Identity:** an incrementing id (`v1`, `v2`…), a short label, a role and a purpose. Many per scope; labels need not be unique.
- **Who adds them:** you (+ value), the model on its own (`value_set`, in its session or its own profile, never a profile above), or the model asking you (`value_request`: a card with the label, role, purpose and why; you choose the value, where it is kept and what the model may see). Over the bridge, the paired agent can answer with `answer_value`.
- **Revisions, not overwrites:** every change appends a revision with who made it, where and why; hiding is a revision; any earlier revision can be restored (appended again). `value_get id history` gives the model the list.
- **What the model sees**, per value: the value; only the label and purpose, writing `{{v3}}` in tool arguments, which the harness fills in when the call runs (the logged call keeps `{{v3}}`); or nothing. Notes are yours and never sent.
- **How it learns about them:** the values in scope are listed once in the first message; afterwards a value that is new or changed adds one line to the next message. Cached bytes are never rewritten and the model does not need tool calls to know what a value is for.
- **Provenance:** made by whom (and whether the model asked for it), in which session, at which message, when, with which model; "go to source" opens that session. "show in chat" puts the value's purpose in the thread.

### Paste config

Settings → "paste config" takes a JSON block (for example one an agent writes in a reply) and merges it into the settings after showing every change as `field: old → new`. Only the fields named change. Accepted: `provider`, `model`, `helper`, `policyModel`, `base` (`{provider: url}`), `ghlabel`, `logRepo`, `branchBudget`, `pace`, `machine` (reloads), and `policies`, merged by name (a known name takes the fields given, a new one needs `pattern` and `rule`, `"remove": true` drops it). Anything that looks like a credential is refused and listed, never applied; tokens and keys are only ever typed into their own fields. "copy config" gives the current non-secret configuration in the same shape.

    {"settings": {"model": "deepseek/deepseek-v4.1-flash-1017", "helper": "tencent/hy4-flash", "logRepo": "owner/name"},
     "policies": [{"name": "bounded-waits", "on": true}]}

### Handoff blocks

Content in a reply that you take away rather than read is a handoff block: a fence whose info string starts with `handoff:`. New sessions (core prompt v3) are told the convention up front, in one line.

| Fence | Card |
|---|---|
| ` ```handoff:copy <title> ` | the text; **copy** |
| ` ```handoff:file <name> ` | **copy**, **download** as `<name>` |
| ` ```handoff:command <title> ` | **copy**; **run on the machine** when the session has it (your click; output shown in the card) |
| ` ```handoff:view html|json|csv <title> ` | rendered: html in the no-network sandbox, json formatted, csv as a table; **copy** the source |
| ` ```handoff:config <title> ` | **copy**; **apply…** opens the paste-config preview filled in |

Plain fences stay code. When your message asked to show, copy, save or run something and the reply used plain fences anyway, they are shown as copy handoffs ("shown as a handoff because you asked for one"): a deterministic helper, display only, no request and no change to the reply. Each session's handoffs are also listed at the top of its stage, newest first, with copy buttons.

### Import labels and values

"import" (Defaults, and under this session's scope) takes loose lines copied from anywhere: `label: value`, `label = value`, tab-separated, `- label: value`, or markdown table rows (first cell label, second value; header and separator rows skipped; backticks stripped). Each line is matched in order:

1. a setting by name or alias (`main`, `model` → model; `helper model` → helper; `repair model`, `policy model` → policy model; `budget`; `pace`; `log repo`; `access label`; `provider`);
2. an existing scoped value with that label → a new revision;
3. otherwise a new value (role `imported`).

You pick the level relative to the session (this session, a profile in its chain, or defaults); settings that only exist as defaults go there, and locks are respected. The preview lists each line's target and action (update, create, unchanged, refused) with a checkbox to leave it out. Credential-looking labels or values are refused and never shown.

### Pacing, questions and card metrics

- **Metrics in every card header**, from the harness's records: replies show model, input tokens (cached part), output tokens, cost, time and upstream; tool results show the tool, time, size, ok or failed, and the policy if one applied.
- **Pace** (top bar): *run*, *hold model requests*, *hold tool calls* or *hold both*. A held step waits as a card showing what will go out: the request's model, message count and size, or the tool call as it will run (after any policy repair). **release** sends it, **skip** drops it (a skipped tool call returns "Not run: skipped by the user"), **release all** switches back to *run* and lets everything waiting go. The bridge sends held steps up as `held` events; the paired agent can `release` them.
- **`ask` tool** (new sessions): the model puts typed questions on a card and waits. Types: `text`, `number` (min, max), `choice` and `multi` (options), `confirm`, `json` (a JSON Schema subset: type, enum, const, required, properties, additionalProperties false, items, min/max, length and item counts). Answers are validated on the card, the same way whoever answers, and go back as JSON keyed by question id; "decline" returns that the person declined. Over the bridge the paired agent gets an `ask` event and can answer with `answer_ask`.
- **No browser dialogs:** confirmations and errors use an in-page modal; the tests fail if a native `alert`/`confirm`/`prompt` ever appears.

### Policies: repair before a call runs

Inspector → Policies holds rules checked against every tool call's arguments before it runs. Each is its own card: a name (what smells and the thread refer to), the tool (`*` for any), a pattern matched against the call's arguments as JSON, the rule in plain words, and on/off; the card shows how often it has fired. Policies written in the earlier one-line text form are converted once. A call that breaks one is not just blocked: the policy model (Settings; else the helper, else the session's model) gets a small fixed context (the rule, the tool's schema and the call) and returns corrected arguments. The repair is checked again and runs instead. The log keeps the repaired call (that message has not been sent back yet, so no cached byte changes), the result starts with `[policy p1: call rewritten]`, and the thread shows the original beside it. No repair, or one that still breaks the rule, means `Not run: policy ...`. The default policy turns long fixed `sleep`s in `shell` into bounded waits on a condition. Because a pattern only sees the literal call (`s=sleep; $s 60` gets past it), the machine also has a `sleep` ahead of the real one on `PATH` that refuses fixed waits of 20 s or more however they are spelled, tells the model what to do instead, and leaves a marker the harness strips from the output and records as a `policy-runtime` smell under the same policy.

### Smells and review: steering quality over time

Policy rewrites and refusals, call notes written as text, tool errors and timeouts are recorded as they happen (`wh:smells`), each with the fingerprint of the steering in effect: core prompt version, system prompt, policies and tool list. Inspector → Smells shows counts, and per steering version the requests made and smells per request, so versions can be compared. Nothing is changed mid-session. "review" sends the policy model the counts and the current steering texts (no transcripts) and stores what it proposes as pending; you adopt or dismiss each one. An adopted change is yours to apply, and it reaches new sessions only, so a cached prefix never changes under a running session. Smells and proposals are in `.trace` exports and are sent up the bridge.

### Log repo: tracking in a private repo of yours

Settings → Log repo names a private repository (`owner/name`) where the harness keeps that tracking over time, in the repo-as-a-service way: the frontend bootstraps it and writes it, and agents read it.

- **Cold start:** "set up" checks the repo. If it is missing, it offers to create it as a private repo with your credential; if it is empty, it writes the layout: `README.md`, `.harness/manifest.json` (schema 1), `smells/`, `sessions/`, `steering/`, `proposals/`.
- **Sync:** at every session start and on "sync", one commit with what is new: smell rows, per-session metrics (model, requests, tokens, cache hits, cost, smell count, steering fingerprint; never message text), each new steering version's texts under its fingerprint, and proposals. Batch files are named `<device>-<time>` and never edited, so devices do not conflict. Stored keys are redacted.
- **Agents read, do not write:** model-facing repo tools treat the log repo as read-only and refuse writes to it before any token is used; in app mode, reads get a contents:read token. Changes to steering go through review proposals and you.
- **Transcripts and artifacts** (on by default; Settings switch, per-session opt-out "keep this session out"): each session's messages go to an orphan branch `wh-sessions` as append-only chunks (`sessions/<id>/<n>.jsonl` and `meta.json`), after each turn (at most once a minute), at session start and on "sync". Outputs the messages cite go to `artifacts/os_<handle>.txt`, and images, audio and video found as `data:` URLs go to `artifacts/media/<hash>.<ext>` as binary files, with the chunk keeping an `artifact:` reference. It is a record to read, never fed back into a session's cache. "browse transcripts" lists the sessions and loads one a chunk at a time. If the browser no longer has a stored output (cleared storage, another device), `output_read` fetches it from there.
- **Masking:** stored credentials become `[key]`; values the model may not read are replaced by their `{{id}}`; value notes never appear; a session kept out writes nothing.
- **Size:** media over 20 MB is noted in `meta.json` and not stored. Git LFS is not used: its endpoints do not allow cross-origin requests, so a page cannot reach them without a proxy.
- Agents that improve on it from sessions come later; this is the scaffold.

### Linux machine

Settings → "Linux machine" gives new sessions a `shell` tool: an x86_64 Alpine 3.20 machine with bash, coreutils, git, python3, gh, curl and jq, emulated in the page ([container2wasm](https://github.com/ktock/container2wasm), Bochs, WASI). There is also a per-session switch under the system prompt.

- **Cost of use:** about 200 MB, downloaded once in 45 MB parts and kept in the browser's Cache API. In headless Chromium here, boot plus a first command took about 30 s, and a `gh api` call about 20 s. It is slow, but it is a real machine.
- **Isolation:** the emulator needs SharedArrayBuffer, so the switch registers `coi-serviceworker` (MIT), which adds COOP/COEP headers that Pages cannot send. Switching it off removes the service worker. COEP `credentialless` keeps CDN scripts and third-party media loading; Safari falls back to `require-corp`.
- **Network:** the guest's HTTP(S) goes through container2wasm's network stack and leaves as the page's own `fetch`. Only hosts that allow cross-origin requests answer. `api.github.com` does, so `gh api ...` works; git's smart HTTP does not, so `git clone`/`push` over HTTPS do not.
- **Credentials:** the guest's `GH_TOKEN` is the placeholder `wh-placeholder-token`. The page replaces it on requests to `api.github.com` with the configured credential (minted per repository and permission in app mode). No token exists inside the machine, so a model that runs `env` finds nothing.
- **Visible:** the Machine pane shows everything the guest prints and has a line for typing into it. Guest requests appear in the trace (URL, method, status).
- **State:** the machine persists for the page load and is shared by the sessions that have the tool. A reload starts a fresh machine.
- **Image:** built with `c2w` from `Dockerfile` (Alpine + packages), split by `scripts/vm-pack.mjs`, kept on the `vm-image` branch and copied in by the Pages workflow. `node scripts/smoke-vm.mjs` runs it end to end (needs `app/vm/image/`).

### Debug bridge

Opening the page with `#bridge=<owner/repo>~<branch>~<key>` connects it to an agent running `scripts/bridge.mjs`. The channel is a git branch: the page commits encrypted batches to `up/` through the API with your GitHub token; the agent pushes directives to `down/` with plain git; the page polls with ETags (304s are free). Payloads are AES-GCM; the key exists only in the fragment, which is moved to sessionStorage and removed from the address bar.

- **Up, automatically:** hello, errors, console warnings and errors, notices, approval requests, finished trace records.
- **Directives:** `ping`, `state`, `session`, `trace`, `trail`, `dom` (read-only selector), `run` (in the sandbox), `act` (new, inspector). `send`, `set` (provider, model and helper; never the API base) and `reload` wait for your click in the banner.
- **Keys:** stored key values are replaced with `[key]` in every payload before encryption.
- **Paired agent as the model:** choose provider "Paired agent (bridge)" and each request goes up as a `turn` event; the agent answers with `do answer '{"turn":"...","content":"...","tool_calls":[{"name":"...","args":{}}]}'`. Tool runs, approvals and the log follow the normal path, from the page's own network.
- **Agent side:** `node scripts/bridge.mjs pair --repo OWNER/NAME --page URL` prints the link; `listen`, `do NAME JSON`, `show N`, `close`.

### Live values through CSS (slots)

Values that change while you work (section counts, the trace count, the ledger summary, the Machine status, the GitHub, log repo and bridge status lines, the status on held and question cards) are not text nodes. `slot(el, value)` in `styles.js` sets a `data-v` attribute and `.slot::after { content: attr(data-v) }` draws it. An update is one attribute write: no node is rebuilt, focus, selection and scroll survive, and the devtools tree does not churn. Such values cannot be selected or found with Ctrl+F, so messages, results, rules and cards stay real text. `slotText(el)` reads an element with its slot values; the bridge's `dom` directive and the tests use it.

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
