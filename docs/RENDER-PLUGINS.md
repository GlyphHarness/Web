# Render plugins: templates and transforms for how a session looks

Spec first (this file), then `app/render.js`, `app/render-defaults.js`, `app/render.css`. The default look of the app is itself a set of templates registered through this mechanism, so a plugin can replace, wrap or extend any part of it.

## 1. What a developer can write

| Kind | What it is | Written as |
| --- | --- | --- |
| **Template** | Turns one *part* of a session (a user message, a tool call, an approval card...) into DOM. | A function `(data, ctx) => Node \| string \| null`, or a JSON markup template |
| **Transform** | Rewrites text on its way to the screen (linkify `owner/repo#n`, mark handles, fold long output). Runs in an ordered pipeline. | An object `{ id, match?, transform(text, ctx) }`, or a JSON `{ pattern, replace }` |
| **Plugin** | A named bundle of templates, transforms and optional CSS. The unit users switch on and off. | `render.register({...})` or a pasted JSON spec |

Nothing here changes the log. The stored session, the request sent to the model and the exports are untouched; a plugin only changes how the thread is drawn (tenet 1 is not at risk, and a plugin cannot cost a cache hit).

### Parts

| Part | Frame? | Drawn for | `data` (scalars usable as `{{name}}` in JSON templates) |
| --- | --- | --- | --- |
| `user` | yes | a user message | `role`, `text` |
| `assistant` | yes | a model reply | `role`, `text`, `model`, `reasoning` |
| `tool-result` | yes | a tool message (the result) | `role`, `id`, `tool`, `ok`, `text`, `size` |
| `tool-call` | no | one call inside an assistant message | `id`, `name`, `args`, `ref`, `hasRef`, and `load()` (async: the full text of a stored reference, for a template that expands it) |
| `reasoning` | no | the model's reasoning text | `text` |
| `approval` | yes | a write waiting for allow / deny | `ask`, `kind`, `repo`, `text`, `files` (a count) |
| `held` | yes | a paused model request or tool call | `title`, `kind`, `status`, `text` |
| `flag` | no | an inspector row for a smell or watch flag | `kind`, `name`, `meta`, `tone`, `note`, `from`, `to` |

A **frame** part is a whole card in the thread. The harness forces `class="msg"` and `data-role` on its result (the rest of the app finds messages by them) and keeps its machinery attached (see "Controls" below).

Besides scalars, every `data` carries things the harness already built, passed as DOM **slots**, so a template can rearrange them without rebuilding them:

| Part | Slots |
| --- | --- |
| `user`, `assistant` | `head` (role and numbers), `reasoning`, `body` (text blocks, code figures, handoff cards), `calls` (every tool call, with widget chips), `copy` |
| `tool-result` | `head`, `reasoning`, `body` (the result), `extras` (branch audit table, policy note), `copy` |
| `approval` | `ask`, `what` (the resolved change), `files` (previews), `controls` (allow, deny) |
| `held` | `what`, `status`, `controls` (release, release all, skip) |

In code, `ctx.slot('body')` returns the node. In JSON markup, write `<span data-slot="body"></span>` where it goes. **What the user must see is never droppable**: for `approval` and `held`, if a template leaves out `what` (the resolved change, written by the harness, not by the model) or `controls`, the harness appends them. A JSON template for `user`, `assistant` or `tool-result` that leaves out `body` gets it appended too.

When the plugin list or a plugin's on/off changes, the thread is redrawn in place from the log (log messages only; held, approval and notice cards are left alone). The redraw waits while a turn is running, and the one live streaming card stays plain text until the turn ends. Everything here is also reachable from the **look** button in the header (the dialog lists plugins, switches transforms, reorders, and takes a pasted spec).

### The template contract

```js
template(data, ctx) -> Node | string | null
```

- `Node` (an `Element` or `DocumentFragment`): used as is, after the guard pass (section 4).
- `string`: markup, parsed and **sanitized** (section 4), never trusted.
- `null` / `undefined` / a throw / anything else: *decline*; the next template down the chain is asked. The chain always ends at the built-in default, so a broken plugin degrades to the default look and the error is recorded (`render.errors()`).

`ctx`:

| | |
| --- | --- |
| `ctx.part` | the part name |
| `ctx.h(tag, attrs, ...kids)` | element builder; `text` attr sets `textContent`. Safe by construction |
| `ctx.text(str, {part})` | `DocumentFragment` of `str` after the transform pipeline; use this for any text you show |
| `ctx.html(markup, opts)` | sanitized `DocumentFragment` |
| `ctx.slot(name)` | a pre-built slot node (see above) |
| `ctx.next()` | the node the next template down would return (wrap the default instead of rebuilding it) |
| `ctx.render(part, data)` | draw a nested part through the full chain |
| `ctx.session` | the session id (or `''`) |

Order of plugins: the user's order, top first. A newly registered plugin goes on top. `render.move(id, +1/-1)` reorders. The first enabled template that returns a usable node wins.

## 2. Transforms

```js
{ id: 'gh-refs', title: 'Link owner/repo#n', scope: ['assistant', 'user'],
  match: /#\d/,                          // optional RegExp or (text, ctx) => bool; a cheap filter
  transform(text, ctx) { ... } }
```

- `scope`: parts whose text it applies to; default `['assistant','user','tool-result']`. Also available: `tool-call` (arguments), `reasoning`. Text inside fenced code blocks and handoff cards is never transformed (they are split off first).
- The pipeline starts from the raw text as one **text segment**. Each enabled transform sees every text segment, in order, and returns one of:
  - `undefined` / `null`: unchanged.
  - a `string`: the segment's new text (still text; later transforms see it).
  - an array of `string | Node | {html}` pieces: strings stay text segments, nodes and `{html}` become **final** segments (sanitized, and later transforms do not look inside them, so two transforms cannot linkify each other's output).
  - a `Node` or `{html}`: replaces the whole segment, final.
- Model text only ever becomes a **text node** unless a transform explicitly wraps it. A transform that builds an element with `ctx.h('a', {href, text})` cannot inject markup; one that returns `{html}` goes through the sanitizer.
- Helper: `render.rx(regex, (match, ctx) => string | Node | {html} | array)` builds a transform function from a regex: it splits the text by matches and maps each one. Use the `g` flag or it matches once.
- A transform that throws, or returns something unusable, is skipped for that text and recorded; the pipeline continues.
- Input over 400,000 characters skips the pipeline (shown as plain text).
- Enable/disable is per user, per plugin and per transform (`render.enable('plugin')`, `render.enable('plugin/transform')`), stored in the browser.

Shipped transforms (built-in plugin `core-transforms`, **off by default** so the first look is unchanged): `gh-refs` (links `owner/repo#123` to GitHub), `handles` (marks `os:...` output handles), `collapse-long` (folds tool output over 1,200 characters behind a "show all" toggle; the preview is its first 6 lines).

## 3. Registering

### From code

```js
import * as render from './render.js';

const off = render.register({
  id: 'compact-calls',                      // [a-z0-9-]{2,40}; required
  name: 'Compact tool calls',
  templates: { 'tool-call': (d, ctx) => { ... } },
  transforms: [ ... ],
  css: '.rp-compact-calls { ... }',         // optional; see section 4
  styles: ['color'],                        // optional: inline style properties this plugin's markup may use
});
off();                                       // unregister
```

`register` returns an unregister function. Registering an id that exists replaces it. A code plugin is code: it runs with the page's privileges. What the sanitizer and guard protect against is *untrusted text* (model, tool and file content) reaching the DOM as markup, not a plugin author who means harm. Only paste or load plugin code you read.

Other calls: `unregister(id)`, `enable(id, on)`, `enabled(id)`, `move(id, delta)`, `list()`, `errors()`, `reset()`, `onChange(fn)`.

### From a JSON spec (no code)

A spec is a JSON object a user can paste into **the **look** dialog** (or `render.addSpec(textOrObject)`). It is stored under `wh:render` in this browser. A spec contains no functions; everything in it is data checked at load.

```json
{
  "id": "compact-calls-json",
  "name": "One-line tool calls",
  "styles": ["color"],
  "templates": {
    "tool-call": {
      "markup": "<div class=\"rp-row\"><span class=\"rp-chip\">{{name}}</span><code class=\"rp-grow rp-clip rp-mono\" title=\"{{args}}\">{{args|clip:90}}</code><button type=\"button\" data-copy-text=\"{{args}}\">copy</button></div>"
    },
    "reasoning": {
      "markup": "<details class=\"rp-muted\"><summary>reasoning</summary><div>{{text}}</div></details>"
    }
  },
  "transforms": [
    {
      "id": "gh-refs",
      "title": "Link owner/repo#n",
      "scope": ["assistant", "user"],
      "pattern": "(?<![\\w/.:-])([A-Za-z0-9-]{1,39})/([\\w.-]{1,100})#(\\d{1,7})\\b",
      "flags": "g",
      "replace": "<a href=\"https://github.com/$1/$2/issues/$3\">$1/$2#$3</a>"
    }
  ]
}
```

- `markup`: HTML limited to the allowlist in section 4. `{{path}}` inserts a value from `data` **as text** (in a text position) or as an attribute value that is then checked like any other attribute (so `href="{{url}}"` holding `javascript:...` loses its `href`). Filters: `{{x|clip:N}}`, `{{x|upper}}`, `{{x|lower}}`, `{{x|json}}`. `<span data-slot="body"></span>` places a slot.
- Transform `pattern` / `flags` (`i m s u`; `g` always on): a JavaScript regex, at most 200 characters, with obvious nested quantifiers refused. `replace`: markup where `$0`..`$9` are the captures, used as text, with the same attribute checking. `text` instead of `replace` is a plain-text replacement (no markup).
- Limits: 64 KB per spec, 20 specs, 12 templates, 12 transforms per spec.
- A spec that fails any check is refused whole, with the reason; nothing is stored.

## 4. Threat model

Untrusted inputs: **model output** (replies, reasoning, tool-call arguments), **tool output** (results, files, web pages the model fetched), **user-pasted specs** (a user may paste a spec from a stranger), and the **branch/fold text** that flows between sessions. Trusted: the app's own code, and code plugins a user chose to install.

Assets to protect: the API key and GitHub token in `localStorage` (same origin as everything), the app's own controls (`data-act`, `data-hold`, ... are wired by delegated handlers), the user's attention (a fake approval card), and tenet 17 (no remote load without a click).

| Attack | Defence | Test |
| --- | --- | --- |
| Model text contains `<script>`, `<img onerror>`, `<svg onload>` | Text is only ever set as a **text node** (`createTextNode`); the default templates and the pipeline never use `innerHTML`. | `hostile: model text stays text` |
| A template or transform returns markup with the same | Markup goes through `sanitize`: parsed in an inert document, and the output is **rebuilt** with `createElement` from an allowlist; nothing parsed is carried over (no serialize/re-parse, so no mutation XSS). | `sanitize: script`, `sanitize: nested svg` |
| `on*` event attributes | Not in the attribute allowlist; stripped. A guard pass removes them from nodes a code plugin returns. The guard skips the harness-owned slot nodes, so the app's own buttons keep working. | `sanitize: event attributes` |
| `javascript:`, `vbscript:`, `data:text/html` URLs, including split by whitespace, control characters or entities | URLs are normalized (control characters and whitespace removed, entities already decoded by the parser), parsed with `URL`, and only `http:`, `https:`, `mailto:` (links) and `#fragment` pass. | `sanitize: javascript url` |
| Remote images that leak the user's context to a model-chosen host | `<img>` `src` allows **only** `data:image/png\|jpeg\|gif\|webp;base64,...` up to 150 KB. No remote image loads (tenet 17). SVG data URLs are refused. | `sanitize: img` |
| `<style>`, inline `style`, `expression()`, `url()`, `@import` | `<style>`, `<link>` are dropped with their content. The `style` attribute is stripped unless the plugin declares `styles: [...]` (a subset of a fixed property list: `color`, `background-color`, `font-weight`, `font-style`, `text-decoration`, `font-size`, `opacity`), and each value must match a strict pattern with no `url(`, `expression`, `\`, `;`, `@`, `/*`. Plugin `css` is refused whole if it contains `@import`, `expression(`, `javascript:`, `behavior`, `-moz-binding`, or a `url()` that is not a raster `data:` image. | `sanitize: style`, `css guard` |
| `<svg>`, `<math>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, `<base>`, `<meta>`, `<template>`, `<noscript>`, `<script>` | Dropped **with their content**; any element not in the HTML namespace is dropped, so nested svg cannot smuggle an `<a>` or `<script>`. Unknown but harmless tags are unwrapped (text kept). | `sanitize: nested svg` |
| `id`, `name` (DOM clobbering of `#app`, `#input`) and `class` to impersonate app UI (`modal-back`, full-screen overlays) | `id` and `name` are never allowed. `class` tokens are kept only when they start with `rp-` or are in a short list of inert utility classes (`note`, `bad`, `ok`, `mono`, `meta`, `name`, `txt`, `think`); app classes like `chip`, `card`, `modal`, `stagebox` and `slot` are never kept. | `sanitize: classes and ids` |
| `data-act`, `data-goto`, `data-hold`, `data-copy` on a button to trigger app actions through the app's delegated handlers | `data-*` is stripped except `data-copy-text` (handled by this module: it copies that text and does nothing else). `data-slot` and `data-rp-status` are accepted **only** in JSON templates (checked at load), never in model-reachable markup. | `sanitize: data attributes` |
| Link target hijack (`target`, `rel`) | `target` and `rel` are set by the sanitizer: `_blank` and `noopener noreferrer nofollow` on every link. | `sanitize: links` |
| A pasted spec holds a catastrophic regex | Length cap, refusal of nested quantifiers, input cap. This is a best-effort guard, not a proof; a regex you wrote is your own risk. | `spec: redos` |
| A pasted spec tries to inject through a placeholder (`{{text}}` in `href`, or markup in a value) | Values are substituted **after** parsing, as text or attribute values, and attributes are validated again after substitution. | `spec: placeholder injection` |
| A template draws a fake "allow" button that does something else, or hides the real one | Controls (`approval`, `held`) are harness-made nodes; a template cannot drop them (they are appended if missing). A template can restyle but not replace what they do. | `controls survive` |
| A template that throws or loops | Errors are caught and the chain falls through to the default. A node-count cap (5,000) and depth cap (30) apply to sanitized markup. A synchronous infinite loop in *code* cannot be stopped; that is code you installed. | `fallback on throw` |
| Stored plugin data is corrupted or edited by hand | `wh:render` is parsed with try/catch and every spec is re-validated on load; invalid specs are dropped, not rendered. | `persistence` |

Out of scope: a malicious code plugin (it is code in the page; and a code plugin that assigns model text to `innerHTML` of a *live* element has run `onerror` before the guard sees the node, so build with `ctx.h` / `ctx.text` / `ctx.html`, or parse in an inert document as the hostile-template test does), and the `html` widget iframe on the stage (that has its own sandbox, `widgets.js`).

## 5. Persistence

`localStorage['wh:render'] = { v: 1, specs: [spec, ...], on: { "<pluginId>": bool, "<pluginId>/<transformId>": bool }, order: [pluginId, ...] }`.

Every read and write is wrapped in try/catch; a browser that blocks storage just forgets the choices. It is a new key, not part of a session or the schema number (tenet 11 is unaffected). Exports and `.session` files do not include it. Code plugins are not stored (they register themselves at load); only their on/off and order are.

## 6. Default look

The look the app had before this module is now the plugin `core-look` (templates for all eight parts) and `core-transforms`. `core-look` cannot be switched off or removed; it is the last link of every chain. `scripts/smoke-render.mjs` checks, on fixture sessions, that the DOM and the rendered pixels of the default templates equal what the previous direct code produced.

Styling uses the existing custom properties; `app/render.css` writes them as `var(--card, var(--panel, #1b1e24))` so a theme that defines `--bg --fg --muted --accent --card --border --danger --ok` restyles plugin output with no change here, and the current palette applies until then.

## 7. Worked example: a compact one-line tool call with a copy button

Code, wrapping the default so the expandable arguments still work:

```js
import * as render from './render.js';

render.register({
  id: 'compact-calls',
  name: 'Compact tool calls',
  templates: {
    'tool-call'(d, ctx) {
      const row = ctx.h('div', { class: 'rp-row rp-compact' },
        ctx.h('span', { class: 'rp-chip', text: d.name }),
        ctx.h('code', { class: 'rp-grow rp-clip rp-mono', title: d.args, text: d.args.replace(/\s+/g, ' ').slice(0, 90) }),
        ctx.h('button', { type: 'button', 'data-copy-text': d.args, text: 'copy' }));
      return row;                             // return null to fall back to the default
    },
  },
});
```

The same thing as a pasted spec is the first JSON example in section 3. Both are exercised by `scripts/smoke-render.mjs` in a real browser.

A transform example (mark `@handles` in assistant text):

```js
render.register({
  id: 'at-handles',
  transforms: [{
    id: 'at',
    scope: ['assistant'],
    transform: render.rx(/(?<![\w@])@([a-z][\w-]{1,30})/gi, (m, ctx) => ctx.h('span', { class: 'rp-accent', text: m[0] })),
  }],
});
```

## 8. Not built

- Plugin-contributed *new* parts (only the eight above).
- Live re-render of the running turn when a plugin is toggled mid-stream; the thread is redrawn when the plugin list changes and nothing is running.
- A sandboxed way to run code plugins pasted by a user. Specs are the safe path for pasted content.
