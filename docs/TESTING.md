# Testing notes and gotchas

How the suites run: `node scripts/ci.mjs [main git cpu keys local validators profile retry vm]` (serve the repo on a port first for `main`, `git`, `vm`: `python -m http.server 8787`). `keys`, `cpu`, `local`, `validators`, `profile` and `retry` (the provider seam's retry, with the mock provider and a stand-in for fetch) are plain node, no browser. `local` starts the real local bridge; its exec run checks need a bash target (see Host shell below).

## Playwright

- **Version.** CI pins `playwright@1.49.1`. A newer Playwright wants a newer browser build; if `chromium.launch()` says the executable doesn't exist, either `npx playwright install chromium` or, on a machine with Chrome, launch with `{ channel: 'chrome' }` (a temporary copy of the script is enough; don't commit the change).
- **Service workers and routing.** `page.route` / `ctx.route` do not see requests made by a service worker or a worker unless the process runs with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. The machine's guest network goes through `coi-serviceworker.js`, which re-fetches every request; without the switch a mocked `https://api.github.com/**` is bypassed and the real API answers (this broke the scheduled vm suite). The switch is set in `.github/workflows/test.yml`; set it locally too when running `smoke-vm.mjs`.
- **Cross-origin isolation.** The page turns on COOP/COEP through the service worker, which reloads the page once on first load. Wait for the reload (`waitForLoadState`, then for the app's ready marker) before querying; a locator taken before it dies with "execution context destroyed".
- **Fresh state.** Each `newContext()` is a clean profile: no keys, no settings, no service worker. A test that needs a key puts it in the key store through the page's own paths (Paste config `keys` block), never by writing `localStorage` directly.
- **Local network access.** Real Chrome asks before an https page may reach localhost (the local bridge). Headless Playwright does not show the prompt; test the bridge's CORS and Private Network Access answers in node (`scripts/test-localbridge.mjs`), and the Chrome prompt by hand.
- **Mocks are labelled.** A route that fakes a service belongs to the test that needs it; the harness itself has no fakes.
- **Console text is data.** The smoke prints the page's console; read `FAIL` lines, not the log noise.

## Host shell (the bridge's `--exec`) and neutral wording

- **`--exec` runs commands.** A bridge started with `--exec NAME=...` runs whatever a page holding its token sends, as the configured user in the configured place. It is off unless the flag is given. For a test, use a throwaway token on a free port, a user and folder made for the purpose, and stop the bridge afterwards.
- **A bash target for suite `local`.** The run checks (exit status, merged output, timeout, output cap, concurrency, no stdin) start real commands. On Linux and macOS they use `local:` in a temporary folder. On Windows there is no bash target by default and they print one `SKIP` line; name one with `WH_TEST_EXEC`, for example `WH_TEST_EXEC=wsl:DISTRO:USER:DIR` or `WH_TEST_EXEC=wsl-podman:DISTRO:CONTAINER:USER:DIR`. On Windows the suite has 134 checks with the variable set and 120 without (135 on Linux); say which you ran.
- **Stopped means gone inside the target.** After a timeout check, look for the command's processes in the distro and in the container (`pgrep -fa`), not only at the `wsl.exe` or `podman exec` client. Defunct entries (`Z` in `ps`) under a container's process 1 are not running commands: that container has no init (`--init`).
- **A real run from the page.** Serve the worktree, start the bridge with `--exec`, open the page in headless Chrome with the mock provider, paste `{"settings": {"localBridge": URL, "shellOn": "host:NAME"}, "keys": {"localbridge": TOKEN}}` and send `shell: <command>` (the mock turns that into one shell call). `{"settings": {"vmTmux": true}}` switches the tmux option on without the in-page machine. Kill the `agent-â€¦` tmux sessions the run made.
- **What a model was given.** `providers.mock.requests` keeps the request bodies the mock provider was sent since the page loaded (at most 400; a reload empties it). The neutral-wording checks read tool definitions and prompts from `buildRequest` in node and from the last request and `mock.requests` in the page; they do not keep a second copy of any string.
- **Neutral wording is a strategy.** The checks that nothing names what runs the tools read the request as `strat-serial-3.0` sends it (suite `local`: `defsAs(defs, reads, wording)`; suite `main`: the host-shell block pastes that strategy and restores `strat-stem-1.0`). The strategies registered before it must send their original bytes: `scripts/fixtures/model-view-pre-aa62df3.json` holds them (generated once from `git show aa62df3^`); do not regenerate it from the current tree.
- **Identifying terms.** `app/neutral.js` is the list. A new model-visible string that needs one of those words (for example "page" as in a page of results) must be reworded, not excused; a new identifying word goes into the list with a check line in `scripts/test-localbridge.mjs`. Words of the person (system prompt, credential label) are not the harness's: give fixtures plain ones in a check that scans a whole request.
- **A node client that blocks loses its connection.** `execFileSync` between two `fetch` calls kept the client from tending its kept-alive connection; the next POST ended in `ECONNRESET` once the server's 5 s keep-alive had passed. Use the asynchronous `execFile` in scripts that talk to the bridge.

## Shell and editing gotchas (this is what mangles)

Writing JS through a shell loses characters. Seen repeatedly:

- **Backslashes.** `node -e "..."` and heredocs through Git Bash or PowerShell eat or double backslashes: `/^[a-z]+:\/\//` arrives as `/^[a-z]+:///` and fails to parse. Edit with the editor tools (Edit/Write), not `sed`, `node -e` or `echo`.
- **Backticks and `$`.** Bash expands them inside double quotes and unquoted heredocs; PowerShell expands `$` in double-quoted strings. Quote heredocs (`<<'EOF'`) or use a single-quoted here-string `@'...'@`.
- **Apostrophes in generated strings.** A tool description written as `'...the person's computer...'` ends the string early. Reword, or escape properly, then run `node --check` on every changed file.
- **CRLF.** Several files (README.md, scripts/ci.mjs, app files) have CRLF endings. A multi-line replace written with `\n` does not match. Normalise on read and restore on write (the patch-script pattern: split on CRLF, replace, join back), and check `git diff --stat` for whole-file noise afterwards.
- **Quotes in a commit message.** In Windows PowerShell 5.1 a here-string passed to `git commit -m` is split at its double quotes (the rest become pathspecs). Write the message to a file outside the repo and use `git commit -F`.
- **Quotes through `wsl.exe`.** Inner double quotes of a PowerShell argument do not survive to the Linux side (`pgrep -fa "sleep 47"` arrives as two words). Use a pattern without spaces, or put the script in a file.
- **`cd` does not persist.** Use absolute paths.
- **Quote what leaves the machine.** Never put a key in a command line or a log; keys come from the key store or `C:\wh\secrets.env` and are not repeated in chat.

After any scripted edit: `node --check` each touched file, then the suites.
