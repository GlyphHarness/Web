# Testing notes and gotchas

How the suites run: `node scripts/ci.mjs [main git cpu keys local validators vm]` (serve the repo on a port first for `main`, `git`, `vm`: `python -m http.server 8787`). `keys`, `cpu`, `local` and `validators` are plain node, no browser.

## Playwright

- **Version.** CI pins `playwright@1.49.1`. A newer Playwright wants a newer browser build; if `chromium.launch()` says the executable doesn't exist, either `npx playwright install chromium` or, on a machine with Chrome, launch with `{ channel: 'chrome' }` (a temporary copy of the script is enough; don't commit the change).
- **Service workers and routing.** `page.route` / `ctx.route` do not see requests made by a service worker or a worker unless the process runs with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`. The machine's guest network goes through `coi-serviceworker.js`, which re-fetches every request; without the switch a mocked `https://api.github.com/**` is bypassed and the real API answers (this broke the scheduled vm suite). The switch is set in `.github/workflows/test.yml`; set it locally too when running `smoke-vm.mjs`.
- **Cross-origin isolation.** The page turns on COOP/COEP through the service worker, which reloads the page once on first load. Wait for the reload (`waitForLoadState`, then for the app's ready marker) before querying; a locator taken before it dies with "execution context destroyed".
- **Fresh state.** Each `newContext()` is a clean profile: no keys, no settings, no service worker. A test that needs a key puts it in the key store through the page's own paths (Paste config `keys` block), never by writing `localStorage` directly.
- **Local network access.** Real Chrome asks before an https page may reach localhost (the local bridge). Headless Playwright does not show the prompt; test the bridge's CORS and Private Network Access answers in node (`scripts/test-localbridge.mjs`), and the Chrome prompt by hand.
- **Mocks are labelled.** A route that fakes a service belongs to the test that needs it; the harness itself has no fakes.
- **Console text is data.** The smoke prints the page's console; read `FAIL` lines, not the log noise.

## Shell and editing gotchas (this is what mangles)

Writing JS through a shell loses characters. Seen repeatedly:

- **Backslashes.** `node -e "..."` and heredocs through Git Bash or PowerShell eat or double backslashes: `/^[a-z]+:\/\//` arrives as `/^[a-z]+:///` and fails to parse. Edit with the editor tools (Edit/Write), not `sed`, `node -e` or `echo`.
- **Backticks and `$`.** Bash expands them inside double quotes and unquoted heredocs; PowerShell expands `$` in double-quoted strings. Quote heredocs (`<<'EOF'`) or use a single-quoted here-string `@'...'@`.
- **Apostrophes in generated strings.** A tool description written as `'...the person's computer...'` ends the string early. Reword, or escape properly, then run `node --check` on every changed file.
- **CRLF.** Several files (README.md, scripts/ci.mjs, app files) have CRLF endings. A multi-line replace written with `\n` does not match. Normalise on read and restore on write (the patch-script pattern: split on CRLF, replace, join back), and check `git diff --stat` for whole-file noise afterwards.
- **`cd` does not persist.** Use absolute paths.
- **Quote what leaves the machine.** Never put a key in a command line or a log; keys come from the key store or `C:\wh\secrets.env` and are not repeated in chat.

After any scripted edit: `node --check` each touched file, then the suites.
