// Dark / light mode. Spec and token list: docs/THEME.md.
// The mode ('system' | 'light' | 'dark') is written on <html data-theme>, so the choice is
// visible to CSS and to any code that reads the DOM. Stored under wh:theme; storage may be blocked.

const KEY = 'wh:theme';
const MODES = ['system', 'light', 'dark'];
const root = document.documentElement;
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
const fns = new Set();

const clean = m => MODES.includes(m) ? m : 'system';
const read = () => { try { return clean(localStorage.getItem(KEY)); } catch { return 'system'; } };

let mode = read();

export const get = () => mode;
export const resolved = () => mode === 'system' ? (mq && mq.matches ? 'light' : 'dark') : mode;

function notify() { for (const fn of [...fns]) { try { fn(mode, resolved()); } catch {} } }

// Put the stored (or given) mode on the page. Does not notify.
export function apply(m = mode) {
  mode = clean(m);
  root.setAttribute('data-theme', mode);
}

export function set(m) {
  mode = clean(m);
  try { localStorage.setItem(KEY, mode); } catch {}
  apply();
  notify();
  return mode;
}

export function onChange(fn) { fns.add(fn); return () => fns.delete(fn); }

// A small mode control; appended to `el`.
export function mount(el) {
  const sel = document.createElement('select');
  sel.id = 'theme';
  sel.title = 'Colour mode: follow the system, light, or dark';
  sel.setAttribute('aria-label', 'Colour mode');
  for (const [v, t] of [['system', 'auto'], ['light', 'light'], ['dark', 'dark']]) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.append(o);
  }
  sel.value = mode;
  sel.addEventListener('change', () => set(sel.value));
  onChange(m => { if (sel.value !== m) sel.value = m; });
  el.append(sel);
  return sel;
}

apply();
// the OS changed while following it, or another tab chose a mode
if (mq) mq.addEventListener('change', () => { if (mode === 'system') notify(); });
addEventListener('storage', e => { if (e.key === KEY) { const m = read(); if (m !== mode) { apply(m); notify(); } } });
