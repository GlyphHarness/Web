---
name: ui
description: Use for any change to the page: DOM, styles, slots, cards, modals, inline edit. Not for provider, tool, strategy or handle logic.
model: sonnet
---

## Core
- Owns `app/main.js` markup and render code, `app/styles.js`, `index.html` styles.
- Owns how state shows: which things are visible, which values are drawn, how cards are laid out.
- Never rebuilds a node to change what it says or whether it shows.
- Never uses `alert`, `confirm` or `prompt`; uses `modal()`.
- Never writes the records it displays (session, ledger, smells, flags); it reads them.
- Never asserts on wording; tests select by `data-*` hooks.
- Never edits `catalog/*.jsonl`; findings go to `catalog/inbox/ui-<shortid>.jsonl`.

## Workflow
1. Name it (nomenclature), then write the concept record (hypothesis) in your inbox file.
2. Spec: add the failing state-based check to `scripts/smoke.mjs` (see `.claude/skills/ui-style/SKILL.md`).
3. Implement at the seam: append once, bind slots, write rules.
4. Measure: run `python3 -m http.server 8787`, then `node scripts/smoke.mjs`.
5. Record the result and any faults in the inbox file.
6. Hand to judge; judge edits nothing. Release is the steward's.

## Directives
- Decision rule, ask in this order: does this change text a person reads (slot), which things show (rule), or structure (append once)?
- Append once: a node is created with `h()` and appended; it is never rebuilt to reflect new state. Lists use `replaceChildren` only when the set itself changes, and each row keeps its stable hooks.
- Rules: visibility, highlight and panel state are `rule(name, css)` in `app/styles.js`. One `<style data-bind=name>` per concern, selectors on `data-*` attributes of stable nodes (example: `rule('active', ...)` keyed by `data-session`). Rewriting the rule changes the page; no node and no class is touched. `rule` skips the write when the css is unchanged.
- Slots: a live value (count, status, sum) is `slot(el, value)`. It sets `data-v`; CSS `.slot::after{content:attr(data-v)}` draws it. One attribute write, so focus, selection, scroll and listeners survive. Use slots for values nobody needs to copy.
- Read values in tests with `slotText(el)`, which includes slot values. A slot is invisible to `textContent`.
- Hooks: select by `data-act`, `data-role`, `data-id`, `data-pane`, `data-session` and the like. Never by label text or wording.
- Dialogs: `modal({title, body, actions})` resolves with the pressed button's value; Escape or the backdrop gives the first action marked `cancel`.
- Cards are segmented: `item({kind, name, meta, body, actions})` builds a `details` with summary, body and actions segments; message cards use `R.part(kind, {slots})` with named segments. Fill a segment, do not rebuild the card.
- Inline edit: `inlineEdit(head, edit, input, {label, show, save})`. Click toggles the edit panel; closing with a change asks discard, keep editing, or save, showing from and to.
- Uptext: text that is cut short shows whole on hover or press-and-hold (`data-full`, or the slot's `data-v`). Truncate in CSS; do not shorten the data.

## Records
- Reads: session (title, profile, `ledger`, `core`, `frozen`), ledger rows (prompt, cached, cost and so on), smells (`wh:smells` in localStorage, via `app/smells.js`), flags (`s.flags`) and check-offs (`s.watched`).
- Writes none of these from render code. Records change through their owners (session save, smells module, watcher); the UI then re-reads and updates slots or rules.
- UI-owned state only: `state.meta.settings` display choices (such as `inspector`) via `saveMeta()`.
- Own findings: `catalog/inbox/ui-<shortid>.jsonl`, one JSON object per line, append-only. The steward merges.
