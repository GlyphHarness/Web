// The Look dialog: which render plugins are on, in what order, and a box to paste
// a template spec. Nothing here draws a session; render.js does. Mounted by
// main.js with the app's own modal and button helpers.

import * as R from './render.js';

const { h } = R;

export function mount({ modal, after }) {
  if (!after || document.querySelector('[data-act=look]')) return null;
  const b = h('button', { type: 'button', 'data-act': 'look', title: 'How session turns look: templates and text transforms', text: 'look' });
  after.after(b);
  b.addEventListener('click', () => open(modal));
  return b;
}

function check(label, on, locked, set) {
  const i = h('input', { type: 'checkbox' });
  i.checked = on;
  i.disabled = !!locked;
  i.addEventListener('change', () => set(i.checked));
  return h('label', {}, i, h('span', { text: label }));
}

function view(box, msg) {
  const list = R.list();
  const users = list.filter(p => !p.builtin);
  const paste = box._paste ??= h('textarea', { rows: '8', placeholder: '{ "id": "my-look", "templates": { "tool-call": "<details>…</details>" } }', 'aria-label': 'template spec' });
  const status = h('div', { class: msg?.error ? 'rp-err' : 'rp-ok', text: msg?.error || msg?.ok || '' });
  const add = h('button', { type: 'button', text: 'add spec' });
  add.addEventListener('click', () => { const r = R.addSpec(paste.value); view(box, r.ok ? { ok: 'added ' + r.id } : { error: r.error }); });
  const reset = h('button', { type: 'button', text: 'remove pasted specs' });
  reset.addEventListener('click', () => { R.reset(); view(box, { ok: 'removed' }); });
  const errs = R.errors().slice(-5);
  box.replaceChildren(
    h('p', { class: 'rp-note', text: 'Plugins change how messages, tool calls, approvals and flags are drawn. The default look cannot be turned off; plugins sit on top of it, first in the list first.' }),
    ...list.map(p => {
      const i = users.findIndex(x => x.id === p.id);
      return h('div', { class: 'rp-plugin' },
        h('label', {}, ...[check(p.name, p.on, p.locked, v => R.enable(p.id, v)).firstChild, h('span', { text: p.name }), h('span', { class: 'rp-tier', text: p.tier + (p.templates.length ? ' · ' + p.templates.join(' ') : '') })]),
        p.transforms.length ? h('div', { class: 'rp-sub' }, ...p.transforms.map(t => check(t.title, t.on, false, v => R.enable(p.id + '/' + t.id, v)))) : '',
        i >= 0 ? h('span', { class: 'rp-mv' }, ...[['up', -1], ['down', 1]].map(([t, d]) => { const m = h('button', { type: 'button', text: t, disabled: (d < 0 ? i === 0 : i === users.length - 1) ? '' : null }); m.addEventListener('click', () => R.move(p.id, d)); return m; }),
          ...(p.spec ? [(() => { const x = h('button', { type: 'button', text: 'remove' }); x.addEventListener('click', () => R.removeSpec(p.id)); return x; })()] : [])) : '');
    }),
    h('p', { class: 'rp-note', text: 'Paste a template spec (JSON). It is checked and stored in this browser only; markup in it goes through an allowlist.' }),
    paste, h('div', {}, add, ' ', reset), status,
    errs.length ? h('p', { class: 'rp-err', text: errs.map(e => `${e.plugin} ${e.where}: ${e.message}`).join('\n') }) : '');
}

function open(modal) {
  const box = h('div', { class: 'rp-look' });
  view(box);
  const off = R.onChange(() => { if (box.isConnected) view(box); });
  modal({ title: 'Look', body: [box], actions: [{ text: 'Close', value: true, primary: true, cancel: true }] }).then(off);
}
