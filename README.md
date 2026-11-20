# WebHarness

A client-side LLM chat harness served straight from this repo with GitHub Pages. No server, no build step: the browser holds the API key, the sessions and the tools.

Status: working skeleton (v0.44.0). The OpenRouter path (streaming, tools, cached tokens, upstream pinning) and the GitHub paths (commit, branch, issue, repository creation) have been run live; see [docs/live-evidence](docs/live-evidence/2026-11-19-windows-chrome.md). GitHub App token minting has not.

## Run

- Hosted: enable Pages (Settings > Pages > Source > GitHub Actions); every push to `main` deploys to `https://<owner>.github.io/<repo>/` (paths are case-sensitive).
- Local: `python3 -m http.server 8787` in the repo root, then open `http://localhost:8787/`.
- No key needed to try it: choose the provider "Mock (offline)" and model `mock-1`. Say "tool", "big", "widget", "form", "chart" or "fan out" to see a tool round trip.
- Smoke tests (need Playwright): `node scripts/smoke.mjs`, `node scripts/smoke-git.mjs` (fake GitHub API), `node scripts/smoke-vm.mjs` (the Linux machine), `node scripts/smoke-theme.mjs` (colour modes)

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
| `app/theme.js`, `app/theme.css` | Dark / light / system mode and its colour tokens ([docs/THEME.md](docs/THEME.md)). |
| `app/profile.js` | Turn profile from stored records (counts, sizes, costs, cache); shared by the CLI and the metrics panel. |
| `app/panels.js` | Metrics widget registry, built-in widgets and the slot layout (`panels.register`). See `docs/METRICS-PANEL.md`. |
| `app/metrics.js` | Mounts the metrics slots and dashboard overlay with its layout editor. |

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

Tool definitions make no mention of where they run, and nothing else a model is given does either: the core prompt, tool definitions, tool results, injected turns and helper prompts hold none of the identifying terms listed in `app/neutral.js` (the product's and the organisation's names, "harness", "browser", "page", "tab", "this app", "bridge", `wh-local`, "cross-origin", "service worker", "github.io"). The suites collect that text from the same code the provider request is built from and fail on a term (`local` and `main`). A failure of the shell or the local tools reaches the model in plain words ("the machine is not available"); the reason goes to the person as a notice. Text for the person (the UI, this README) is not bound by this, and words the person writes (a system prompt, a credential label) reach the model as written. What wording cannot hide: a model that reads this repository can match its own tool list against `app/tools.js`.

Changing a tool description changes the cached prefix of sessions that have the tool (once), and the steering fingerprint. The neutral wording of `shell`, `concern_file` and `local_*` was such a change, made in place: no new strategy id, the core prompt text is the same.

Current set: `run_js`, `shell` (when the machine is on, or "shell runs on" names a host: see Host shell), `scratchpad_read`, `scratchpad_write`, `show_widget`, `output_read`, `fan_out`, `branch_read`, `pattern_find`, `pattern_get`, `pattern_put`, `pattern_run`, `entry_read`.

- `run_js` runs in a network-less sandbox (see Sandbox); killed after 5 s.
- An `html` widget runs in an iframe with `sandbox="allow-scripts"`, which cannot read the page or its storage. An `embed` is a third-party page and gets its own origin.

### Repositories (GitHub from the page)

A page can call `api.github.com` (it answers any origin) but not git's own HTTP endpoints or GitHub's sign-in token exchange, which send no CORS headers. So there is no clone and no OAuth flow. Reads, commits, branches and pull requests go through the REST and GraphQL APIs with a token you paste in Settings.

- **Credentials, either of:**
  - a fine-grained personal access token limited to the repos it may touch (Contents read/write, Pull requests read/write, Metadata read). GitHub has no API for creating these; they are made in the web UI.
  - a GitHub App (App ID + private key). For each request the page mints an installation token for exactly the repository that request touches, with only the permission it needs (contents read, contents write, or pull requests write), valid one hour. Commits are attributed to the app's bot account. The installation is looked up per repository, so one app installed on several repos or orgs works.
- Credentials are stored with the other keys, never exported, masked in the trace and redacted from the bridge. "check" shows the account or app.
- **Scope check (no model):** under the token, "intended use of this credential" lists the repositories it is for and what each needs (read or write), filled from the configuration (log repos, profile allowlists) and editable, plus whether it opens pull requests or creates repositories. "check scopes" compares that with what the credential can actually do, using plain API calls: the token type (by prefix), classic scopes (`X-OAuth-Scopes`), the repositories it reaches (`/user/repos`), and per intended repo metadata and contents read; contents write is probed only when you allow it, by creating an unreferenced blob (no commit, no branch change). For a GitHub App it reads each installation's permissions and repository selection. Every row is ok, missing, excess (more than intended: other repositories, risky classic scopes, admin, all repositories) or unverifiable (pull requests and repository creation cannot be proven without writing). The summary stays beside the credential; mismatches are recorded as smells.
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

Settings → "paste config" takes a JSON block (for example one an agent writes in a reply) and merges it into the settings after showing every change as `field: old → new`. Only the fields named change. Accepted: `provider`, `model`, `helper`, `policyModel`, `base` (`{provider: url}`), `ghlabel`, `logRepo`, `branchBudget`, `pace`, `machine` (reloads), and `policies`, merged by name (a known name takes the fields given, a new one needs `pattern` and `rule`, `"remove": true` drops it). Credentials are refused anywhere in the block except one door, a `keys` block: `{"keys": {"openrouter": "…", "github": "…"}}` (a provider id or `github`; `""` removes one). Keys are shown masked in the preview, go to this browser's key store on Apply, and are never in settings, "copy config" or an export. The import box takes the same as lines (`openrouter key: …`, `github token: …`, `api key: …` for the current provider), plus `concerns repo: owner/name` and `log repo: owner/name`. `concernRepo` is also a paste-config field. `newProfile` (by name) sets the profile new sessions use, and `values` adds scoped values (`{label, value, role, purpose, scope: "defaults" | "profile:<name>" | "session", expose}`), merged by label within their scope: a known label gets a new revision, made by "config". "copy config" gives the current non-secret configuration in the same shape.

    {"settings": {"model": "deepseek/deepseek-v4.1-flash-1017", "helper": "tencent/hy4-flash", "logRepo": "owner/name"},
     "policies": [{"name": "bounded-waits", "on": true}]}

### Zero sessions

Having no sessions is a valid state: a first visit, or deleting the last one, shows "No sessions." with a way to start one, and controls that only make sense for a session are hidden. Typing a message and sending it creates a session. Nothing is created behind your back.

### Concerns, targets and sealed sessions

- **Concerns as issues:** Settings → "file a concern…" files an issue in the concerns repository (Settings; empty = the repo this page is served from), labelled `concern` and `kind:<kind>` (pattern, interop, protocol, policy, cost, ui, other), with what happened (the evidence), what should happen, the intent, and where it came from (session, steering fingerprint, profile, model). Sessions with repository tools have `concern_file`, so agents can file them too; each waits for your approval on a card. The repository also has a matching issue form (`.github/ISSUE_TEMPLATE/concern.yml`).
- **Targets:** the Smells section holds targets (cache hit rate ≥ 50%, smells per request ≤ 0.05, cost per request ≤ $0.002 by default, all editable) and checks every steering version against them from the ledgers; the steering review is told which are missed.
- **Sealed profiles:** a sealed profile's sessions keep their directives inside their execution: exports carry `[sealed]` instead of the system prompt and the session's own settings; no transcripts or artifacts go to the log repo, and metrics and steering rows say `[sealed]`; the bridge's `session` directive refuses them; copied config names a sealed profile and nothing else about it; concerns and smells name it `[sealed]`.
- **Machine autostart:** with the machine switched on, it starts when the page loads (Defaults → "start the Linux machine when the page loads").

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

### The custodial queue

Housekeeping the harness would do on the sessions' behalf does not run on its own: conditions put it in a queue (Inspector → Queue, and a "queue N" button in the top bar) and you drain it. Each item shows its type and intent; the targets it touches (sessions, policies, smell kinds, repos; sessions link to themselves); why it was queued (the condition, the policy or smell that fired, details, and how often it fired, since identical items merge); the estimated cost (input tokens from the real input size, the output cap, the model and its price); and the procedure that keeps it cheap.

| Type | Queued when | Cost controls |
|---|---|---|
| condense (steward) | a turn ends with replies waiting to be condensed or a session without a title | one request for all sessions, at most 12 items, replies cut to 8,000 chars, fixed instructions, helper model, output capped at 1,500 tokens |
| steering review | 3 or more new smells since the last review, or any refusal | counts and steering texts only, last 200 rows, policy model, output capped at 600 tokens |
| credential check | the credential was never checked, or not for a week | plain API calls; no model |
| retry log sync | a log sync failed | plain API calls; no model |

Running enforces it: inputs are capped, `max_tokens` is set, an item estimated over the per-item budget (default 20,000 tokens) asks first, and what it actually used is recorded against the estimate (more than 1.5× is a `queue-overrun` smell). "drain all" shows the total estimate before it starts. With the helper edge mode, replies go out whole until a condense item is drained.

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

Settings → "Linux machine" gives new sessions a `shell` tool: an x86_64 Alpine 3.20 machine with bash, coreutils, git, python3, gh, curl and jq, emulated in the page ([container2wasm](https://github.com/ktock/container2wasm), Bochs, WASI). There is also a per-session switch under the system prompt. The tool's description says only that it runs a bash script on a Linux machine and that what is installed and reachable depends on the machine; the same tool can run on a host of yours instead (Host shell, below).

- **Cost of use:** about 200 MB, downloaded once in 45 MB parts and kept in the browser's Cache API. In headless Chromium here, boot plus a first command took about 30 s, and a `gh api` call about 20 s. It is slow, but it is a real machine.
- **Isolation:** the emulator needs SharedArrayBuffer, so the switch registers `coi-serviceworker` (MIT), which adds COOP/COEP headers that Pages cannot send. Switching it off removes the service worker. COEP `credentialless` keeps CDN scripts and third-party media loading; Safari falls back to `require-corp`.
- **Network:** the guest's HTTP(S) goes through container2wasm's network stack and leaves as the page's own `fetch`. Only hosts that allow cross-origin requests answer. `api.github.com` does, so `gh api ...` works; git's smart HTTP does not, so `git clone`/`push` over HTTPS do not.
- **Agent pty (tmux):** with "run the model's commands in this pty" on (Machine → *agent pty*), the model's shell calls run in a persistent tmux session `agent` instead of a fresh non-interactive bash: the command is typed into the pane, its output recorded from the pane (`pipe-pane`), completion signalled with `tmux wait-for`, and the exit status returned as before; a timeout sends Ctrl-C to the pane. tmux comes from the package shelf on first use. The *agent pty* tab mirrors the pane while open (polled quietly, not logged as activity), and what you type there, or the Ctrl-C button, goes into the same session: you can answer a prompt or stop a program the model started.
- **Package shelf:** `wh-install <name>` installs Alpine packages kept next to the image on the page's own site (`app/vm/image/pkgs/`, from the `vm-image` branch). The machine's network can reach its own site (same origin) but not Alpine's mirrors, which do not allow cross-origin requests. `pkgs/index.txt` lists each package and its files; they are fetched and installed offline (`apk --no-network`). The shelf holds what you put there: currently `tmux`.
- **Credentials:** the guest's `GH_TOKEN` is the placeholder `wh-placeholder-token`. The page replaces it on requests to `api.github.com` with the configured credential (minted per repository and permission in app mode). No token exists inside the machine, so a model that runs `env` finds nothing.
- **Status, for the current session:** the Machine pane lists what the machine needs and whether each holds: switched on in Defaults; the page cross-origin isolated (with the service worker's state, and what to do if it stays off); this session has the shell tool; its scope allows the machine; and whether it has started (it starts on first use, or with "start now").
- **Files (explorer):** "explore files" in the Machine pane opens a VS Code-style panel for the current session: its pinned folders as a tree (`/root` by default; pin or unpin any path), a directory listed only when you expand it, a file read only when you open it (in a tab: text with line numbers, images rendered, binary as a hex preview; copy path, copy text, download; files over 512 KB show their first 512 KB). Every entry is marked against the session's start: when a session first runs `shell` (or first opens the explorer) the harness touches a marker file in the machine and records a baseline listing of the pinned folders, so **N** = made since, **M** = in the baseline and changed, unmarked = already there. "changed since this session started" lists only what was touched; "find deleted" lists baseline files that are gone. Plain shell commands, no model. Files are read as base64 so the exact bytes survive the terminal (which would otherwise convert line endings and interpret control characters); the page decodes them.
- **Terminal and harness activity, separate:** the Machine pane has two tabs. *terminal* shows only what went into the machine and what came out, interleaved in order: commands from the model and from you as `$ …` input lines (continuation lines as `> …`), then their output, with end markers stripped. *harness activity* is its own list, fed by its own event channel: each command the harness ran for itself (start-up, the sleep shim, the network wait, the session mark, explorer listings and reads) with time, duration and output size, plus policy refusals. Nothing harness-side is drawn in the terminal unless "raw" is on (a debugging view).
- **Visible:** the Machine pane shows everything the guest prints and has a line for typing into it. Guest requests appear in the trace (URL, method, status).
- **State:** the machine persists for the page load and is shared by the sessions that have the tool. A reload starts a fresh machine.
- **Image:** built with `c2w` from `Dockerfile` (Alpine + packages), split by `scripts/vm-pack.mjs`, kept on the `vm-image` branch and copied in by the Pages workflow. `node scripts/smoke-vm.mjs` runs it end to end (needs `app/vm/image/`).

### Tabs, the shared machine, halts and updates

Open a session in a tab of its own (↗ on its row) to run sessions in parallel; one tab hosts the machine for all of them (or a dedicated machine tab, `?machine`, that stays up through site updates). Each session is its own unix user with a 700 home and a size quota; commands run as concurrent jobs. **halt all / step / resume** move every session in every tab together, stopping at the gate before a model request (a state that survives a reload). **update to vX** appears when a newer build is published: every tab halts at a safe point, reloads onto the new build (served from `b/<commit>/`, named in `version.json`), and the halted sessions continue; the machine restarts only when its protocol changed, with the homes saved and restored. Details: [docs/TABS.md](docs/TABS.md).

### Terminal commands, scratch helper, stdio hooks, GitHub auth in the machine

Under the terminal: send again the last command you typed, your history (pins, ↑ / ↓), keys a phone keyboard hides, and a scratch helper that drafts commands and tests them in a scratch account first. Inbound and outbound text passes named hooks (smart punctuation and phone capitals undone on the way in, secrets masked on the way out; `register()` adds more). GitHub calls from the machine get your PAT for account-level calls and the repository's token otherwise (`machineGh: inject`), or the session's user gets a real `GH_TOKEN` (`machineGh: env`). Details: [docs/TABS.md](docs/TABS.md).

### Debug bridge

Opening the page with `#bridge=<owner/repo>~<branch>~<key>` connects it to an agent running `scripts/bridge.mjs`. The channel is a git branch: the page commits encrypted batches to `up/` through the API with your GitHub token; the agent pushes directives to `down/` with plain git; the page polls with ETags (304s are free). Payloads are AES-GCM; the key exists only in the fragment, which is moved to sessionStorage and removed from the address bar.

- **Up, automatically:** hello, errors, console warnings and errors, notices, approval requests, finished trace records.
- **Directives:** `ping`, `state`, `session`, `trace`, `trail`, `dom` (read-only selector), `run` (in the sandbox), `act` (new, inspector). `send`, `set` (provider, model and helper; never the API base) and `reload` wait for your click in the banner.
- **Keys:** stored key values are replaced with `[key]` in every payload before encryption.
- **Paired agent as the model:** choose provider "Paired agent (bridge)" and each request goes up as a `turn` event; the agent answers with `do answer '{"turn":"...","content":"...","tool_calls":[{"name":"...","args":{}}]}'`. Tool runs, approvals and the log follow the normal path, from the page's own network.
- **Agent side:** `node scripts/bridge.mjs pair --repo OWNER/NAME --page URL` prints the link; `listen`, `do NAME JSON`, `show N`, `close`.

### Local bridge: the page reaching your computer

The page is served from github.io, so it cannot see localhost by itself. `localbridge/wh-local.mjs` is a small no-dependency node server you run on your own machine; the page calls it, and it exposes only what you list. Off by default.

```
node localbridge/wh-local.mjs --http app=http://127.0.0.1:3000 --dir notes=C:\Users\you\notes
```

It prints a URL (default `http://127.0.0.1:8791`) and a random token for this run (`--token` or `WH_BRIDGE_TOKEN` to fix it). In Settings, "Local bridge": the URL, the token, then "check". Turn on "Local bridge tools" for a session (System prompt) to give the model `local_info`, `local_http` (GET/POST to a listed service) and `local_read` (read a file or list a folder, read-only). A profile can switch the capability off (`local`).

- **Protection.** Listens on 127.0.0.1 only; every call but `/health` needs the bearer token; the page origin must be the github.io page, a `localhost` page, or one you add with `--origin`; a non-loopback Host is refused (DNS rebinding); `--http` targets must be loopback http; files are read-only and must resolve inside a listed folder (links that leave it are refused), 2 MB per file, 5 MB per body, 30 s per call. The page's cookies and token are not forwarded to the service.
- **Credentials.** The token is a key in the key store (id `localbridge`): the `keys` block of Paste config, the import line `local bridge token: …`, or its Settings field; masked, never in settings, copy config or exports. The URL is an ordinary setting (`localBridge`) and must be loopback.
- **The browser.** Chrome asks once to allow "Local network access" for an https page to reach localhost; the bridge answers the Private Network Access preflight so the request can go through. If the bridge is not running, or the browser or an extension blocks the call, the page cannot tell which, and the Settings status says both.
- **Not the debug bridge.** `scripts/bridge.mjs` pairs an agent with the page through a git branch; this one is a loopback server the page calls directly.
- **Tests.** `node scripts/test-localbridge.mjs` (suite `local` in `scripts/ci.mjs`) starts the real bridge with a throwaway service and folder. See `docs/TESTING.md` for the other suites and their gotchas.

### Host shell: the shell tool on a host of yours

The `shell` tool can run its commands on a Linux host you name instead of the in-page machine: a WSL distro, a container, or the computer the bridge runs on. The model is sent the same tool (name, schema and description, byte for byte) and reads the same result text either way; where the command ran is harness data and is not in anything the model is given.

```
node localbridge/wh-local.mjs --exec dev=wsl:Ubuntu:you:/home/you/work/repo
node localbridge/wh-local.mjs --exec box=wsl-podman:Ubuntu:devbox:dev:/work/repo --exec-max 4
```

**Security: `--exec` runs commands.** It is off unless you give the flag. With it, a page that holds the bridge token can run any command as the user you named, in the place you named, with everything that user may do there; the bridge adds no sandbox of its own. Name a user and a folder you would hand to the model. A request can name only the target (`NAME`), the command, a folder inside the target's folder and a timeout; the launcher, the user, the distro or container and the folder come from your flag alone.

| `--exec NAME=…` | Runs | Bridge runs on |
|---|---|---|
| `local:DIR` | bash here, as the user running the bridge | Linux, macOS (refused on Windows) |
| `wsl:DISTRO:USER:DIR` | `wsl.exe -d DISTRO -u USER --cd DIR -e bash` | Windows |
| `podman:CONTAINER:USER:DIR` (`docker:` the same) | `podman exec -i -u USER -w DIR CONTAINER bash` | Linux, macOS |
| `wsl-podman:DISTRO:CONTAINER:USER:DIR` (`wsl-docker:` the same) | `wsl.exe -d DISTRO -u root -e podman exec -i -u USER -w DIR CONTAINER bash` | Windows |

A launcher is one entry of `LAUNCHERS` in `localbridge/wh-local.mjs`: its fields and the argv that goes in front of `bash`. The container must be running; the bridge does not start it.

- **The page setting.** "shell runs on" (`shellOn`) is `machine` (the in-page machine; also the meaning of blank) or `host:NAME`. It is a harness setting like any other: Defaults, a profile, or one session (the scope editor's "shell runs on" row), and Paste config (`{"settings": {"shellOn": "host:dev"}}`). The bridge's URL and token are the Local bridge settings above. While the resolved value names a host, new sessions get the `shell` tool without the in-page machine being on. The Machine pane says which one the current session uses.
- **How a command runs.** `POST /exec/NAME` with `{cmd, cwd?, timeout?}`. The command goes to a login bash in the target on stdin, never on a command line, so quoting, non-ASCII text and long scripts arrive intact. It runs with no stdin, both output streams as one in their real order, in a process group of its own. The answer is `{code, output, timed_out, truncated, ms}`.
- **Limits.** Timeout 1 to 900 s per call (120 when the request names none; the page sends the tool's own). At the timeout, or when the page drops the request, the bridge stops the command's process group inside the target (TERM, then KILL a second later), then the launcher's own process tree if that is still there: stopping `wsl.exe` or the `podman exec` client alone would leave the command running. Output is cut at 4 MB and marked; the command still runs to its end. 4 commands at once over all targets (`--exec-max N`, 1 to 64); one more is refused with 429, not queued. The same protection as the other routes applies (loopback only, token, Origin and Host checks, 5 MB body). The bridge's token is not in the command's environment.
- **State between calls** matches the in-page machine. Each call is a fresh bash that starts in the target's folder; files stay, `cd` and `export` do not. With the tmux option on (Machine → *agent pty*, or `{"settings": {"vmTmux": true}}` in Paste config) the command is typed into one lasting tmux session of the session tree on the host, `agent-<last 8 characters of the session id>`, made on first use; attach with `tmux attach -t agent-…` to watch or type. tmux must be installed in the target. The *agent pty* tab mirrors only the in-page machine.
- **What does not apply on a host:** the per-session unix user, quota and CPU shares, the package shelf, the file explorer and its session mark, the injected GitHub credential, and the Machine pane's terminal. The command's output still passes the outbound hooks (known secrets are masked before the model reads it).
- **When it cannot run.** The model reads `Tool error: the machine is not available` (or busy, or could not start the command); the person gets a notice with the reason (bridge not running, wrong token, unknown target, what the launcher said).
- **Containers without an init.** When a command is stopped, its orphaned children are reaped by the container's process 1. A container whose process 1 never reaps (for example `sleep infinity`) keeps them as defunct entries until it restarts: nothing is running, but the entries pile up. Start such a container with `--init`.
- **Measured (2026-11-20, Windows 11, bridge on Windows, WSL2 Ubuntu 24.04, podman 4.9.3, node 22 in both targets).** A call costs about 0.35 s through `wsl:` and about 1.8 s through `wsl-podman:` before the command's own time. `node --check app/main.js`: status 0, no output, 0.37 s / 1.97 s. `git status --short`: status 0, 0.35 s / 1.80 s. `exit 7` after writing to both streams: status 7, both lines in order. A 3 s timeout on a command with a background child: answered after 3.3 s / 4.7 s with the output so far and `timed_out`; two matching processes during, none after, in the distro and in the container. A dropped request: its command gone within 3.5 s. `seq 1 200000` (1.3 MB): whole. `seq 1 3000000` (21 MB): 4,000,000 characters and `truncated`. Five at once: four ran, one refused. From the page (headless Chrome, mock provider, real bridge): a turn with one shell call took 1.0 s / 2.5 s; with the tmux option both calls ran on the same pty of one tmux session.
- **Tests.** Suite `local` runs the real bridge; its run checks need a bash target: on Linux and macOS they use `local:` in a temporary folder, on Windows set `WH_TEST_EXEC` (for example `wsl:DISTRO:USER:DIR`), else they print one `SKIP` line. Suite `main` checks the page side against a labelled mock of the bridge.

### Live values through CSS (slots)

Values that change while you work (section counts, the trace count, the ledger summary, the Machine status, the GitHub, log repo and bridge status lines, the status on held and question cards) are not text nodes. `slot(el, value)` in `styles.js` sets a `data-v` attribute and `.slot::after { content: attr(data-v) }` draws it. An update is one attribute write: no node is rebuilt, focus, selection and scroll survive, and the devtools tree does not churn. Such values cannot be selected or found with Ctrl+F, so messages, results, rules and cards stay real text. `slotText(el)` reads an element with its slot values; the bridge's `dom` directive and the tests use it.

### Inline edit and uptext

- **Scope grid:** the session's attributes are a grid of rows grouped by audience (*Harness settings*, *Tools*), not a table: label, value and source shrink and truncate (uptext shows them whole), the edit icon has its own fixed column, so a row never runs past its container, at any width.
- **Inline edit:** each attribute row has an edit icon (✎); clicking or tapping the row, or Enter/Space on it, shows or hides its controls, prefilled with the current value. The edit panel stacks under its row at full width (level, value, Cancel and Save). Enter saves, Escape closes. Closing with a change (the row, the icon, or opening another row) asks first, showing the change from → to: Discard, Keep editing, or Save.
- **Uptext:** hover (mouse, about 0.4 s) or press and hold (touch, about 0.45 s) on any text that is cut short shows its full value in a bubble above it. Truncation is detected, so session names, card names, chips, badges and scope values need no wiring; labels shortened on purpose carry their full value (`data-full`, e.g. the model id in a card header), and slot values are read too. It goes on leave, release, scroll or Escape.

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
