// The page side of the metrics panel: puts the named slots into the shell, builds the dashboard
// overlay with the layout editor, and redraws when the active session or its ledger changes.
// Widgets, layout and data live in panels.js; this file only touches the page. Spec: docs/METRICS-PANEL.md.
import { state } from './store.js';
import { stats as checkpointStats } from './checkpoints.js';
import * as panels from './panels.js';
import { rule } from './styles.js';

const { h, SLOTS, SLOT_LABEL, color } = panels;
const $ = (s, r = document) => r.querySelector(s);
let mounted = false, dash = null, editing = false, pending = 0, status = '';
const where = {}; // slot -> its element

const OVERLAY_CSS = `
#wmp-header { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-left: auto; }
#wmp-header:empty { display: none; }
.wmp-side { display: flex; flex-direction: column; gap: 2px; margin: 4px 0; }
.wmp-side:empty { display: none; }
.wmp-side .wmp-s { align-self: flex-start; }
#wmp-dash { position: fixed; inset: 0; z-index: 40; background: #0008; display: flex; align-items: stretch; justify-content: center; padding: 16px; }
#wmp-dash[hidden] { display: none; }
#wmp-dash .wmp-panel { background: ${color.bg}; color: ${color.fg}; border: 1px solid ${color.border}; border-radius: 10px; box-shadow: 0 12px 40px #0008; width: min(1100px, 100%); display: flex; flex-direction: column; min-height: 0; }
#wmp-dash .wmp-head { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-bottom: 1px solid ${color.border}; }
#wmp-dash .wmp-head b { margin-right: auto; }
#wmp-dash .wmp-body { overflow: auto; padding: 8px 12px 12px; min-height: 0; }
#wmp-dash .wmp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0 10px; align-items: start; }
#wmp-dash .wmp-grid > .wmp-l { grid-column: 1 / -1; }
#wmp-dash .wmp-grid > .wmp-s { justify-self: start; margin: 6px 0; }
.wmp-edit { border-top: 1px solid ${color.border}; margin-top: 10px; padding-top: 8px; }
.wmp-edit fieldset { border: 1px solid ${color.border}; border-radius: 6px; margin: 6px 0; padding: 4px 8px 6px; }
.wmp-edit legend { font-size: 11px; color: ${color.muted}; padding: 0 4px; }
.wmp-edit .row { display: flex; gap: 4px; align-items: center; padding: 1px 0; }
.wmp-edit .row span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wmp-edit .row[data-hidden] span { color: ${color.muted}; text-decoration: line-through; }
.wmp-edit .row[data-missing] span::after { content: ' (not loaded)'; color: ${color.muted}; }
.wmp-edit button, .wmp-edit select, #wmp-dash .wmp-head button { font-size: 11px; padding: 1px 6px; }
.wmp-edit textarea { width: 100%; box-sizing: border-box; font: 11px ui-monospace, monospace; }
.wmp-edit .st { font-size: 11px; color: ${color.muted}; min-height: 1.2em; } .wmp-edit .st[data-bad] { color: ${color.danger}; }
`;

function draw() {
  pending = 0;
  if (!mounted) return;
  const { session, all } = panels.gather(state.sessions, state.meta?.active, safeStats());
  for (const [slot, el] of Object.entries(where)) {
    if (slot === 'dashboard-grid' && dash.hidden) continue;
    el.replaceChildren(...panels.renderSlot(slot, session, all));
  }
  if (!dash.hidden) { const t = $('.wmp-title', dash); if (t) t.textContent = session ? '· ' + (session.title || session.id) : '· no session open'; if (editing) drawEditor(); }
}
const safeStats = () => { try { return checkpointStats(); } catch { return {}; } };
export const refresh = () => { if (!pending) pending = setTimeout(draw, 60); };

function drawEditor() {
  const box = $('.wmp-edit', dash), lay = panels.getLayout();
  const same = (fn, ...a) => () => { fn(...a); };
  const btn = (text, title, on, attrs = {}) => { const b = h('button', { type: 'button', title, 'aria-label': title, text, ...attrs }); b.onclick = on; return b; };
  const area = h('textarea', { rows: '6', spellcheck: 'false', 'aria-label': 'Layout JSON' });
  area.value = panels.exportLayout();
  const st = h('p', { class: 'st', text: status || (panels.isCustom() ? 'Saved in this browser.' : 'Default layout.') });
  if (status.startsWith('Refused')) st.setAttribute('data-bad', '');
  box.replaceChildren(
    h('p', { class: 'wmp-note', text: 'Choose where each widget goes. The top bar and left column take small widgets; the dashboard takes any.' }),
    ...Object.keys(SLOTS).map(slot => {
      const items = lay.slots[slot];
      const free = panels.list().filter(w => panels.fits(w, slot) && !items.some(e => e.id === w.id));
      const pick = h('select', { 'aria-label': 'Add to ' + slot, 'data-wmp-pick': slot }, h('option', { value: '', text: 'add widget…' }), ...free.map(w => h('option', { value: w.id, text: `${w.title} (${w.size})` })));
      return h('fieldset', { 'data-slot': slot }, h('legend', { text: `${slot} · ${SLOT_LABEL[slot]}` }),
        ...items.map(e => {
          const w = panels.get(e.id), row = h('div', { class: 'row', 'data-id': e.id, ...(e.hidden ? { 'data-hidden': '' } : {}), ...(w ? {} : { 'data-missing': '' }) },
            h('span', { text: w ? w.title : e.id }),
            btn('↑', 'Move up', () => { panels.move(slot, e.id, -1); }, { 'data-wmp': 'up' }), btn('↓', 'Move down', () => { panels.move(slot, e.id, 1); }, { 'data-wmp': 'down' }),
            btn(e.hidden ? 'show' : 'hide', e.hidden ? 'Show' : 'Hide', () => { panels.hide(slot, e.id, !e.hidden); }, { 'data-wmp': 'hide' }),
            btn('×', 'Remove from this slot', () => { panels.remove(slot, e.id); }, { 'data-wmp': 'remove' }));
          return row;
        }),
        items.length ? '' : h('p', { class: 'wmp-note', text: 'empty' }),
        pick);
    }),
    h('div', { class: 'row' }, btn('reset to default', 'Return every slot to the default layout', () => { status = 'Default layout.'; panels.reset(); }, { 'data-wmp': 'reset' })),
    h('label', { class: 'wmp-note', text: 'Layout as JSON (copy it elsewhere, or paste one and import)' }), area,
    h('div', { class: 'row' },
      btn('copy', 'Copy the layout JSON', () => { navigator.clipboard?.writeText(area.value).then(() => { st.textContent = 'Copied.'; }, () => { area.select(); st.textContent = 'Select and copy.'; }); }, { 'data-wmp': 'copy' }),
      btn('import', 'Replace the layout with this JSON', () => { const r = panels.importLayout(area.value); status = r.ok ? 'Imported.' : 'Refused: ' + r.error; if (!r.ok) { st.textContent = status; st.setAttribute('data-bad', ''); } }, { 'data-wmp': 'import' })),
    st);
  for (const sel of box.querySelectorAll('select[data-wmp-pick]')) sel.onchange = () => { if (sel.value) { status = ''; panels.add(sel.dataset.wmpPick, sel.value); } };
}

export function open(editor = false) { if (!mounted) return; dash.hidden = false; editing = editing || editor; $('.wmp-edit', dash).hidden = !editing; draw(); }
export function close() { if (dash) dash.hidden = true; }

// env: {} (nothing needed; the page's stores are imported). Safe to call once the shell exists.
export function mount() {
  if (mounted || !$('#bar') || !$('#side')) return false;
  rule('metrics', panels.CSS + OVERLAY_CSS);
  const bar = $('#bar'), side = $('#side');
  where['header-right'] = h('span', { id: 'wmp-header', 'data-slot': 'header-right' });
  where['side-top'] = h('div', { class: 'wmp-side', 'data-slot': 'side-top' });
  where['side-bottom'] = h('div', { class: 'wmp-side', 'data-slot': 'side-bottom' });
  const openBtn = h('button', { type: 'button', id: 'wmp-open', title: 'Session and dashboard metrics', text: 'metrics' });
  const grid = h('div', { class: 'wmp-grid', 'data-slot': 'dashboard-grid' });
  where['dashboard-grid'] = grid;
  const edit = h('div', { class: 'wmp-edit', hidden: '' });
  const toggle = h('button', { type: 'button', id: 'wmp-layout', title: 'Choose which widget goes in each slot', text: 'layout' });
  const x = h('button', { type: 'button', id: 'wmp-close', title: 'Close', 'aria-label': 'Close metrics', text: '×' });
  dash = h('div', { id: 'wmp-dash', hidden: '', role: 'dialog', 'aria-label': 'Metrics' },
    h('div', { class: 'wmp-panel' }, h('div', { class: 'wmp-head' }, h('b', { text: 'Metrics ' }, h('span', { class: 'wmp-title wmp-note' })), toggle, x), h('div', { class: 'wmp-body' }, grid, edit)));
  bar.append(where['header-right'], openBtn);
  $('header', side)?.after(where['side-top']);
  side.append(where['side-bottom']);
  document.body.append(dash);
  mounted = true;
  openBtn.onclick = () => open();
  x.onclick = close;
  toggle.onclick = () => { editing = !editing; edit.hidden = !editing; if (editing) status = ''; draw(); };
  dash.addEventListener('mousedown', e => { if (e.target === dash) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !dash.hidden && !document.querySelector('.modal-back')) close(); });
  // redraw when the visible ledger or the session list changes, or when a widget is registered or the layout moves
  const mo = new MutationObserver(refresh);
  for (const sel of ['#ledger tbody', '#sessions']) { const el = $(sel); if (el) mo.observe(el, { childList: true }); }
  $('#sessions')?.addEventListener('click', refresh);
  panels.onChange(refresh);
  globalThis.whPanels = panels;
  draw();
  return true;
}
