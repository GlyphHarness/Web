# Tabs, the shared machine, halts and updates

One browser, many tabs, one machine. This is how WebHarness runs sessions in parallel and updates the site without breaking a machine that is in use.

## Roles

| Tab | What it does | How |
|---|---|---|
| Session tab | runs one session at a time; open more tabs for more sessions in parallel (↗ on a session row, or `?s=<id>`) | Web Lock `wh-s:<id>`: the holder runs the session; another tab showing it is read-only, follows it through storage events, and can "run it here instead" (steals the lock; the old tab stops its turn) |
| Machine host | runs the Linux machine for every tab | Web Lock `wh-machine`; other tabs call it over BroadcastChannel `wh-machine` (`run`, `jobs`, `cancel`, `send`, `typed`), get its terminal bytes and events |
| Machine tab (`?machine`, "open a machine tab") | a host that does nothing else | never reloads for an update unless the machine protocol changed; a running machine is untouched by a deploy |

If the host tab closes, the browser releases its lock; clients learn it (their queued lock request is granted), fail what was in flight with a clear error, and the next command makes some tab the host. "Move it to this tab" hands the machine over: the host saves the homes, stops, releases; the new host boots and restores them.

Chrome does not freeze a background tab that holds a Web Lock; it can still discard one under memory pressure (keep the machine tab active, or exempt the site in Memory Saver).

## Inside the machine

- **Jobs.** Every command is a job: its script goes in as short base64 lines, runs in the background with output to a root-only file (`/var/wh`), and is read back when it ends. Commands from different sessions run at the same time; the console only carries short lines. Timeouts are enforced in the guest (`timeout -k 5 -s INT`); "stop" on a running job in the Machine pane sends it TERM.
- **Users.** Each top-level session (and its branches) is its own unix user, home `/home/u<id>` mode 700, so sessions cannot read each other's files. Setting `machineUser: root` (defaults, a profile or a session) runs as root in `/root` instead.
- **Quota.** `machineQuota` (MB, default 200): a home over it refuses new commands (exit 122) until files are deleted; it is also each file's size limit (`ulimit -f`).
- **Packages.** `wh-install <name>` works for every user: non-root calls go to a root install service that accepts package names only and installs from the page's own shelf.

## Halt, step, resume (every tab together)

Top bar: **halt all**, then **step** (every waiting session in every tab takes one step and holds again: lockstep) and **resume**.

Gates sit before each model request and each tool call. The request gate is the good state: every tool result is recorded and nothing is in flight, so a session waiting there is marked `resume: request` in storage and continues after a reload. A halt for an update holds only at request gates (a tool batch finishes first).

## Updating the site

1. Each deploy writes the code to `b/<commit>/` and `version.json` = `{version, build, machine}` (machine = `MPROTO` in `vmhost.js`). `index.html` reads `version.json` past every cache and loads exactly that build, so a reload never mixes cached old modules with new ones; a running tab keeps the build it loaded.
2. Tabs check `version.json` every 5 minutes and on focus; a newer build shows **update to vX**.
3. Update: halt every tab (mode `update`), wait until no tab has a turn between gates, then reload every tab. The machine tab stays up unless `machine` changed; a session tab that hosts the machine saves the homes (up to 4 MB, Cache API) first, and the next host restores them.
4. After the reload the first tab on the new build (Web Lock `wh-coord-lead`) waits until every tab reports the new version, then resumes; the halted sessions go on from their gates. A tab still on the old build stays halted and says so.

What is lost on a machine restart: processes and anything outside the homes, `/root` and the account files. Homes over 4 MB are not carried (the pane says so).

## Verified

- Live deploy (2026-11-18): `version.json` names the deployed commit and `b/<commit>/main.js` is served.
- Console input is paced (128-byte slices) and the tty settings line runs before anything else is sent: input bursts and input queued across that change were lost for good (the console stopped reading). Found with the raw console tail (`whDebug.vm().raw()`).

## Not verified yet

- The update flow on the live site with two real tabs (tested locally with a routed `version.json`).

- Chrome's tab discarding with a long-running machine tab.
- Save/restore time for homes near the 4 MB limit (the console carries them as base64).

## Prior art (searched 2026-11-18)

| Project | Relevant to | Note | Reliability |
|---|---|---|---|
| Web Locks API (MDN) | leader election | the browser releases a lock when its tab closes; needs a secure context | summarised |
| Vercel skew protection, https://vercel.com/docs/skew-protection | updates | deployment-id-tagged requests, reload on mismatch | self-reported |
| v86, https://github.com/copy/v86/blob/master/examples/save_restore.html | snapshots | `save_state()` / `restore_state()` of the whole emulator; no size or timing published | verified (API) |
| WebVM / CheerpX, https://github.com/leaningtech/webvm | sandbox | x86 JIT, ext2 disk images, root by default; no snapshot or multi-user story documented | verified |
| container2wasm, https://github.com/container2wasm/container2wasm | sandbox (ours) | Bochs in WASI; the project warns x86_64 start can take 30 s+ (we measure ~25 s to the first command with a cached image) | self-reported / measured |
| WebContainers (StackBlitz) | sandbox | Node only, one runtime per project in the tab | summarised |
| E2B (server-side Firecracker) | per-agent isolation reference | one microVM per agent; create ~0.7 s, resume ~0.7 s in one third-party harness | summarised |

No project found shares one in-browser VM across tabs or isolates agents as unix users inside one; no source gives verified boot, CPU, snapshot or disk numbers for an in-browser x86 guest. Our own numbers come from `scripts/smoke-vm.mjs` (prints boot and `gh api` times).

## GitHub from the machine

`machineGh` (defaults, a profile or a session):

| Mode | What the guest has | Who adds the credential |
|---|---|---|
| `inject` (default) | `GH_TOKEN=wh-placeholder-token` | the page, on each request to api.github.com: a repository call gets that repository's token (App: minted for it, else the PAT); a call naming no repository (`gh api user`, `gh auth status`) gets the PAT. With only an App set, account-level calls have no credential, and harness activity says so. |
| `env` | `GH_TOKEN=<your PAT>` for the session's own user (a 600 file in its 700 home) | nobody: gh and git use it as usual. The model can read the token; tool results still show it masked. Switching back to `inject` removes the file. |

One call through gh takes about 20 s in the emulator (Go start-up); use timeouts of 120 s or more.

## The person's commands

Under the terminal and the agent pty:

- **Target**: the tab in view (the machine's terminal, or this session's agent pty).
- **↻ last**: the last command *you typed* into that target, sent again (not the last one that ran).
- **history**: what you typed, per target, most recent first; pin (★) keeps one at the top; a row loads into the input to edit; ↑ / ↓ in the input walk it.
- **keys**: Tab, Ctrl-C, Esc, ↑ sent at once; `| ~ / - $ && > ' "` inserted (the ones a phone keyboard hides). Inputs have auto-capitalise, auto-correct and spell-check off.
- **scratch**: describe what you want; the helper model (the session's helper, else its model) may test up to 3 commands per round in a scratch account (`uscratch`, 50 MB, 30 s each), then returns commands with a "why" line each: copy, edit, or send to the target.

## stdio hooks (`app/term.js`)

Named, ordered filters, switched on per name in `settings.termHooks {up, down}` (the **hooks** button):

- `up` (what you send): `smartquotes` (“ ” ‘ ’ — … to ASCII), `autocap` (a capitalised first word from a phone keyboard), `trimend`.
- `down` (what comes back: the terminal view and the shell tool's result for the model): `mask` (known secrets: API keys, the GitHub credential, minted tokens).
- `register(dir, name, label, fn(text, ctx))` adds one (a sanitizer, a recorder, a policy check); a changed input is noted in harness activity.
