---
name: ui-style
description: Add or change a piece of page UI under the append-once, rule and slot approach, with a state-based smoke check.
---

## When
Any new or changed UI in `app/main.js`, `app/styles.js` or `index.html`: a count, status, panel, row highlight, card, dialog or edit control.

## Steps
1. Classify the change: text a person reads (slot), which things show (rule), or structure (append once).
2. Structure: build the node once with `h()` or `item()`, give it stable `data-*` hooks, append it. Do not rebuild it later.
3. Visibility, highlight, panel open: write `rule('<concern>', css)` with selectors on those `data-*` hooks. Reuse the concern's key so one `<style data-bind>` holds it.
4. Live value: `slot(el, value)`. Do not set `textContent`.
5. Confirmation or notice: `modal()`. Editable row: `inlineEdit()`. Cut-short text: CSS truncation, and uptext shows it whole.
6. Write the check in `scripts/smoke.mjs` first, red, then implement (below).
7. Run `python3 -m http.server 8787` and `node scripts/smoke.mjs`; all PASS.

Example. Task: show a row's item count.
- Wrong: `row.replaceChildren(h('b', {text: n}))` or `row.textContent = n`. The node is rebuilt, focus and selection are lost.
- Right: build `count` once with `h('span', {class: 'slot', 'data-hook': 'count'})`, then on each change `slot(count, n)`.

## Checks
- State, not wording: `const slotOf = sel => page.evaluate(async s => (await import('./app/styles.js')).slotText(document.querySelector(s)), sel)` already exists in `scripts/smoke.mjs`; use it for slot values.
- Rule effect: assert visibility with `page.locator('[data-session=...]').isVisible()` or the `style[data-bind=name]` text, not a class.
- No rebuild: grab the node, trigger the change, assert it is the same node (tag it with a property first) and its `data-v` changed.
- Hook, not wording: locate with `[data-act=...]`, `[data-role=...]`. Use `check(name, ok)`.
- No native dialogs: assert `.modal-back` appears; never accept a browser dialog.

## Rules
- A change that adds a class toggle or rebuilds a node to change state is wrong; make it a rule or a slot.
- A slot value is not in `textContent`; read it with `slotText` or `data-v`.
- Tests use the mock provider only.

## Records
- Reads session, ledger, smells (`wh:smells`), flags and check-offs; writes none of them.
- Spec and result notes go to `catalog/inbox/ui-<shortid>.jsonl`, never `catalog/*.jsonl`.
