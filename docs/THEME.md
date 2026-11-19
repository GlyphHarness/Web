# Theme: dark and light mode

Status: spec, written before the code. The code is `app/theme.css` (tokens), `app/theme.js` (mode logic and the control) and `app/app.css` (uses the tokens, holds no colour of its own). `index.html` links `theme.css` and `app.css` side by side (not `@import`, which would load them one after the other).

## Goals

- The whole UI renders in a dark set and a light set of colours, chosen by the user.
- Every colour is a CSS custom property on `:root`. `app/app.css` contains no colour literal, so another stylesheet can restyle the app by redefining tokens, with no edit to `app.css`.
- The token names are a stable contract. Panels and templates added later (metrics panel, turn templates) use these tokens and nothing else for colour, so they follow the mode for free.
- No build step, no external fonts or CDNs, no change to layout or scrolling.

## Modes

| Mode | Meaning |
| --- | --- |
| `system` | Follow the OS (`prefers-color-scheme`). The default. |
| `light` | Always the light set. |
| `dark` | Always the dark set. |

The choice is written on the root element: `<html data-theme="system|light|dark">`. With no attribute (the page before the script ran, or a stylesheet loaded alone) the app behaves as `system`. The dark set is the base; the light set applies when `data-theme="light"`, or when the mode is not `dark` and the OS prefers light.

The choice is stored in `localStorage` under `wh:theme` (`system`, `light` or `dark`; anything else reads as `system`). Reads and writes are wrapped in try/catch, so a browser with storage blocked still works for the session. The shell (`index.html`) applies the stored mode in a one-line head script before the first paint, so an explicit choice does not flash the other set while the app loads.

## API (`app/theme.js`)

```js
import * as theme from './theme.js';
theme.get()          // 'system' | 'light' | 'dark'  (the chosen mode)
theme.resolved()     // 'light' | 'dark'             (what is on screen now)
theme.set(mode)      // validates, stores, applies, notifies; returns the mode in effect
theme.onChange(fn)   // fn(mode, resolved) on set(), on a change from another tab, and on an OS change while the mode is 'system'; returns an unsubscribe function
theme.mount(el)      // appends the small mode control (a select) to el
```

`theme.apply()` runs at import time, so importing the module is enough to put the stored mode on the page. A change made in another tab (the `storage` event) is applied here too.

## Tokens (stable)

Role names. Values listed are the shipped ones; a theme may change values but must not remove a name.

| Token | Role | Dark | Light |
| --- | --- | --- | --- |
| `--bg` | page background | `#14161a` | `#f6f7f9` |
| `--fg` | primary text | `#e6e8ec` | `#1c2026` |
| `--muted` | secondary text, hints, meta | `#8b93a1` | `#667080` |
| `--card` | raised surface: side panes, inputs, modals, popups | `#1b1e24` | `#ffffff` |
| `--border` | lines, outlines, dividers | `#2c313a` | `#d9dde3` |
| `--accent` | links, focus, selected state, chips | `#7fb4ff` | `#1f6fd6` |
| `--sel` | selected or hovered row background | `#263246` | `#dfeaff` |
| `--ok` | success text and marks | `#6fd08c` | `#167a34` |
| `--danger` | errors, destructive marks | `#ff8a80` | `#c62828` |
| `--warn` | caution: held, policy, modified | `#e0a040` | `#8a5a00` |
| `--scrim` | backdrop behind a modal | `#00000088` | `#14181e66` |
| `--shadow` | shadow colour under popups | `#00000066` | `#00000030` |
| `--term-bg` | terminal and machine output background | `#0b0c0e` | `#eef0f4` |
| `--term-fg` | terminal and machine output text | `#d8dde6` | `#1c2026` |
| `--paper` | background behind embedded pages and images (they assume white) | `#ffffff` | `#ffffff` |

Text on `--bg` and `--card` uses `--fg` (at least 4.5:1 in both sets) or `--muted` (at least 4.5:1 in both sets). `--accent`, `--ok`, `--danger` and `--warn` are meant as text and border colours on `--bg` and `--card`, and are held to 4.5:1 there in both sets. On `--sel` (a hover or selected row) the pairs are about 4:1.

### Legacy aliases

The first version of the stylesheet used other names. They stay, defined as aliases of the role tokens, so existing rules and any code using them keep working. Prefer the role names in new code.

| Alias | Is |
| --- | --- |
| `--panel` | `var(--card)` |
| `--line` | `var(--border)` |
| `--dim` | `var(--muted)` |
| `--bad` | `var(--danger)` |

Because an alias is resolved on `:root`, override the role token, not the alias (overriding `--card` moves `--panel` with it).

### Not colour tokens

`--side` and `--insp` (pane widths) stay in `app.css`. `--pc` is set per element from a profile's own colour and is user data, not part of the theme.

## Overriding without editing `app.css`

Load a stylesheet after `app.css` (or paste it in a user style extension). Redefine tokens for the set you want to change:

```css
/* every mode */
:root { --accent: #c586ff; }

/* only the dark set, whether chosen or resolved from the OS */
:root[data-theme="dark"] { --bg: #000; --card: #0a0a0a; }

/* only the light set when chosen explicitly */
:root[data-theme="light"] { --bg: #fffdf7; }
```

Specificity: the shipped sets use `:root`, `:root[data-theme="light"]` and, for `system` on a light OS, `:root:not([data-theme="dark"]):not([data-theme="light"])` inside a `prefers-color-scheme: light` media query. A `:root[data-theme="…"]` override of the same attribute wins by order if it loads later. To restyle the `system` mode on a light OS, put the same selector in a `@media (prefers-color-scheme: light)` block of your own.

Code that must follow the mode (a chart library, an iframe) reads `getComputedStyle(document.documentElement).getPropertyValue('--fg')`, or subscribes with `theme.onChange` and re-reads.

`color-scheme` is set per set (`dark` / `light`), so native controls, scrollbars and form fields follow the mode.

## How it is checked

- `grep` for `#hex`, `rgb(`, `hsl(` and named colours in `app/app.css` finds nothing.
- `scripts/smoke-theme.mjs` (Playwright): each mode applies the right set to the page, `system` follows an emulated OS preference, the choice survives a reload, and a blocked `localStorage` does not break the page.
- Contrast of the token pairs is computed from the values in this table.
