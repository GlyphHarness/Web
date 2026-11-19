# Metrics panel

A view of one session's cost, tokens, cache, calls and checkpoints, and a dashboard across sessions, built from the stored records only (ledger rows, message shape, checkpoint stats). Where each widget goes is the user's choice.

Tenets this follows: 4 (metrics, not narration: one number per ledger row, nothing the model said), 5 (evidence from the harness's own records), 36 (sessions compared by numbers). **Content never enters a metric**: a widget receives counts, sizes, names of tools, classes of results and costs. It never receives message text, tool arguments or tool results.

## Parts

| File | What |
|---|---|
| `app/profile.js` | The pure profile logic (moved from `scripts/turn-profile.mjs`, which now re-exports it). `profile(session)`, `across(profiles)`, `behaviour(profiles)`, `resultClass`, text renderers, `drill`. No Node API: the argument hash is a small pure FNV-1a. |
| `app/panels.js` | The widget registry (`register`, `unregister`, `list`, `get`), the built-in widgets, the layout model (`getLayout`, `setLayout`, `reset`, `move`, `hide`, `add`, `remove`, `validate`, `exportLayout`, `importLayout`), and `renderSlot`. No page needed to import it. |
| `app/metrics.js` | The page side: finds the slots in the shell, builds the dashboard overlay and the layout editor, redraws when the active session or its ledger changes. One call, `mount(env)`, from `main.js`. |

## Widgets

```js
panels.register({
  id: 'my-widget',            // unique, [a-z0-9-]; registering an existing id replaces it
  title: 'My widget',         // shown in the layout editor and as the widget's heading
  size: 's' | 'm' | 'l',      // s: one line (chip); m: a card; l: a wide card
  render(session, all, ctx),  // returns a DOM Node (or a string, shown as text)
})
```

- `session`: the **profile** of the active session (the output of `profile()`: `cost`, `tokens`, `cache`, `requests` (counts), `rows` (one object per request: `i, helper, strat, model, prompt, cached, write, out, reasoning, cost, cachePct`), `calls`, `perTurn` (counts and tool names only), `flags`, `slices`). `null` when no session is open.
- `all`: `{ profiles, across, behaviour, checkpoints, activeId }`, for every stored session. `across` is grouped by strategy and model (the dashboard table).
- `ctx`: `{ slot, h, fmt }`. `h(tag, attrs, ...kids)` builds DOM safely (`text:` sets textContent), and `fmt` has `k` (1.2k), `usd` (`$0.01234`), `pct`. `ctx.svg` builds SVG elements.
- A widget that throws is replaced by a one-line error in its own box; it does not stop the other widgets.
- Colours come only from CSS custom properties (`--fg`, `--muted`, `--accent`, `--card`, `--border`, `--danger`, `--ok`, `--bg`), each with a fallback to the current app value, so a theme changes them without touching a widget. Use `ctx.color.accent` etc. (the `var(...)` strings) in inline SVG.
- Plain DOM and inline SVG; no libraries, no network.

### Built-in widgets

| id | size | shows |
|---|---|---|
| `cost-chip` | s | total cost of the session |
| `cache-chip` | s | cached share of prompt tokens |
| `cost` | m | total, main, helper, helper share, median per request, helper max |
| `tokens` | m | prompt, cached, written, output, reasoning, with bars |
| `cache-curve` | m | cache % per request as a line |
| `prompt-curve` | m | prompt tokens per request as a line |
| `requests` | l | one row per request: strategy or helper kind, model, prompt, cache %, output, cost |
| `tool-calls` | m | calls by tool name and by result class |
| `repeats-flags` | m | repeated identical calls, runs, calls before the first write, flags, short follow-ups |
| `checkpoints` | m | cache checkpoints by kind: set, paid (read at least once), reads, writes |
| `strategy-model` | l | across all sessions: strategy and model, requests, cost, median, cache %, first hit |
| `sessions` | l | across all sessions: repeats, failed share, helper share of cost |

## Slots and layout

Slots are named places in the page:

| slot | where | accepts |
|---|---|---|
| `header-right` | the top bar, after the buttons | size `s` |
| `side-top` | left column, under the title | `s`, `m` |
| `side-bottom` | left column, below the session list | `s`, `m` |
| `dashboard-grid` | the dashboard overlay (the **metrics** button in the top bar) | `s`, `m`, `l` |

The layout is
```json
{ "webharness": "metrics-layout", "v": 1,
  "slots": { "header-right": [{"id": "cost-chip"}, {"id": "cache-chip", "hidden": true}],
             "side-top": [], "side-bottom": [{"id": "cost"}], "dashboard-grid": [{"id": "requests"}] } }
```
An entry is `{id, hidden?}`. Order is the order shown. A slot not named is empty; the default layout (`DEFAULT_LAYOUT`) is used until the user changes something, and **reset** returns to it.

- **Editing**: in the dashboard overlay, "layout" shows each slot as a list: move up, move down, hide/show, remove, and a picker to add any registered widget that fits the slot. Changes apply at once.
- **Persistence**: `localStorage['wh:metrics-layout']`, written on every change, read at load; every access is in try/catch, and a missing or damaged value means the default. An id that is not registered (a custom widget not loaded yet) is kept in the layout and skipped when drawing, so it comes back when the widget registers.
- **Export / import**: the editor has a JSON box with "copy" and "import". Settings → **paste config** also accepts `{"settings": {"metricsLayout": { ... }}}` (shown as one change, `metricsLayout: old → new`), and **copy config** includes the current layout. A layout that fails `validate` (unknown slot, entry without a string id, an id used twice in one slot, more than 12 per slot) is refused with the reason and nothing changes.

## Data

`profile()` is run once per session per redraw, from `state.sessions` (a session and its branches each have their own ledger; the active session's profile is the one widgets receive, and `all.profiles` has every top-level and branch session). Checkpoint stats come from `checkpoints.stats()` (the `wh:ckpt` record), grouped by kind. No request is made and nothing is stored beyond the layout.

A redraw happens when the active session changes, a request is appended to the ledger, or the layout changes (not per streamed token).

## Developer example

A widget that shows the helper's share of requests, registered from the browser console or any module:

```js
const panels = await import('./app/panels.js');   // same module the app uses
panels.register({
  id: 'helper-requests', title: 'Helper requests', size: 's',
  render(s, all, { h }) {
    if (!s) return h('span', { text: 'no session' });
    const { main, helper } = s.requests;
    return h('span', { text: `helper ${helper}/${main + helper}` });
  },
});
panels.add('header-right', 'helper-requests');      // put it in a slot (saved)
```
`globalThis.whPanels` is the same module, for a console. Registering again with the same `id` replaces the widget and redraws.

## Test

`scripts/smoke-metrics.mjs` (Playwright; serve the repo with `python -m http.server <port>`, then `node scripts/smoke-metrics.mjs http://localhost:<port>/`): seeds two sessions from `scripts/fixtures/metrics-sessions.json` into localStorage, opens the dashboard, checks every built-in widget draws for both sessions, moves a widget to another slot and reloads to see it kept, registers a custom widget, and checks import/export and paste config. It also loads `scripts/fixtures/metrics-test.html`, a bare page that imports `panels.js` without the app and renders a custom widget, and asserts that no message text reaches the panel's DOM. `WH_CHROME=1` drives the installed Chrome instead of Playwright's bundled Chromium. `scripts/fixtures/make-metrics-fixture.mjs` regenerates the fixture (invented data only).
