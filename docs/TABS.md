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

## Not verified yet

- A real deploy on GitHub Pages (the `b/<commit>/` path and `version.json` are produced by the workflow; tested locally with a routed `version.json`).
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
