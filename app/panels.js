// Metric widgets and where they go. A registry of widgets {id, title, size, render(session, all, ctx)},
// the built-in set, and the layout (which widget is in which named slot, in what order, hidden or not).
// Widgets receive profiles (counts, sizes, names, costs: app/profile.js), never message text.
// No page is needed to import this file; app/metrics.js puts it on the page. Spec: docs/METRICS-PANEL.md.
import { profile, across, behaviour } from './profile.js';

// ---------- colours: custom properties only, with the app's current values as fallbacks ----------
export const color = {
  fg: 'var(--fg, #e6e8ec)', muted: 'var(--muted, var(--dim, #8b93a1))', accent: 'var(--accent, #7fb4ff)',
  card: 'var(--card, var(--panel, #1b1e24))', border: 'var(--border, var(--line, #2c313a))',
  danger: 'var(--danger, var(--bad, #ff8a80))', ok: 'var(--ok, #6fd08c)', bg: 'var(--bg, #14161a)',
};

// ---------- small helpers handed to widgets as ctx ----------
export const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) k === 'text' ? e.textContent = v : e.setAttribute(k, v);
  e.append(...kids.flat().filter(x => x != null && x !== false));
  return e;
};
export const svg = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) k === 'text' ? e.textContent = v : e.setAttribute(k, v);
  e.append(...kids.flat().filter(Boolean));
  return e;
};
const n0 = v => Number(v) || 0;
export const fmt = {
  k: n => n == null || Number.isNaN(Number(n)) ? '-' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)),
  usd: n => n == null ? '-' : '$' + (Math.abs(n) >= 0.01 ? Number(n).toFixed(4) : Number(n).toFixed(5)),
  pct: n => n == null ? '-' : Math.round(n) + '%',
};
const ctxFor = slot => ({ slot, h, svg, fmt, color });

const table = (head, rows, opt = {}) => h('table', { class: 'wmp-t' + (opt.cls ? ' ' + opt.cls : '') },
  h('thead', {}, h('tr', {}, ...head.map((c, i) => h('th', { text: c, ...(i && !opt.left ? { class: 'num' } : {}) })))),
  h('tbody', {}, ...rows.map(r => h('tr', {}, ...r.map((c, i) => c instanceof Node ? c : h('td', { text: String(c ?? '-'), ...(i && !opt.left ? { class: 'num' } : {}) }))))));
const none = text => h('p', { class: 'wmp-none', text });
const kv = rows => h('dl', { class: 'wmp-kv' }, ...rows.flatMap(([a, b, tone]) => [h('dt', { text: a }), h('dd', { text: String(b), ...(tone ? { 'data-tone': tone } : {}) })]));

// A line over request numbers; null values leave a gap. min/max are labelled; each point has a tooltip.
function lineChart(values, { max, unit = '', fmtY = fmt.k, label = '' } = {}) {
  const W = 260, H = 84, L = 30, R = 6, T = 8, B = 14, pts = values.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (!pts.length) return none('no requests yet');
  const top = max ?? Math.max(...pts.map(p => p.v), 1), x = i => L + (values.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (values.length - 1)), y = v => T + (H - T - B) * (1 - v / top);
  let d = '', pen = false;
  for (const p of pts) { d += (pen && values[p.i - 1] != null ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1) + ' '; pen = true; }
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wmp-chart', role: 'img', 'aria-label': label },
    svg('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: color.border }),
    svg('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: color.border }),
    svg('text', { x: L - 3, y: T + 3, 'text-anchor': 'end', 'font-size': 8, fill: color.muted, text: fmtY(top) + unit }),
    svg('text', { x: L - 3, y: H - B, 'text-anchor': 'end', 'font-size': 8, fill: color.muted, text: '0' }),
    svg('text', { x: L, y: H - 3, 'font-size': 8, fill: color.muted, text: '1' }),
    svg('text', { x: W - R, y: H - 3, 'text-anchor': 'end', 'font-size': 8, fill: color.muted, text: String(values.length) }),
    svg('path', { d, fill: 'none', stroke: color.accent, 'stroke-width': 1.6 }),
    ...pts.map(p => svg('circle', { cx: x(p.i), cy: y(p.v), r: 2.2, fill: color.accent }, svg('title', { text: `request ${p.i + 1}: ${fmtY(p.v)}${unit}` }))));
}

// ---------- the registry ----------
const reg = new Map(), hear = new Set();
const SIZES = ['s', 'm', 'l'];
const note = () => hear.forEach(f => { try { f(); } catch {} });
export function register(w) {
  if (!w || typeof w.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(w.id)) throw new Error('widget id must be lowercase letters, digits and dashes');
  if (typeof w.render !== 'function') throw new Error(`widget ${w.id}: render must be a function`);
  if (!SIZES.includes(w.size)) throw new Error(`widget ${w.id}: size must be s, m or l`);
  reg.set(w.id, { title: w.id, ...w });
  note();
  return w.id;
}
export const unregister = id => { const had = reg.delete(id); if (had) note(); return had; };
export const get = id => reg.get(id);
export const list = () => [...reg.values()];
export const onChange = f => (hear.add(f), () => hear.delete(f));

// ---------- slots and layout ----------
export const SLOTS = { 'header-right': ['s'], 'side-top': ['s', 'm'], 'side-bottom': ['s', 'm'], 'dashboard-grid': ['s', 'm', 'l'] };
export const SLOT_LABEL = { 'header-right': 'top bar, right', 'side-top': 'left column, top', 'side-bottom': 'left column, bottom', 'dashboard-grid': 'dashboard' };
export const KEY = 'wh:metrics-layout';
const MAX_PER_SLOT = 12;
export const DEFAULT_LAYOUT = Object.freeze({
  webharness: 'metrics-layout', v: 1,
  slots: {
    'header-right': [{ id: 'cost-chip' }, { id: 'cache-chip' }],
    'side-top': [], 'side-bottom': [],
    'dashboard-grid': ['cost', 'tokens', 'cache-curve', 'prompt-curve', 'tool-calls', 'repeats-flags', 'checkpoints', 'requests', 'strategy-model', 'sessions'].map(id => ({ id })),
  },
});
const clone = x => JSON.parse(JSON.stringify(x));

// -> {ok: true, layout} | {ok: false, error}. Accepts {slots} with or without the wrapper fields.
export function validate(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'Expected a JSON object.' };
  if (j.webharness != null && j.webharness !== 'metrics-layout') return { ok: false, error: `Not a metrics layout (webharness: ${JSON.stringify(j.webharness)}).` };
  if (!j.slots || typeof j.slots !== 'object' || Array.isArray(j.slots)) return { ok: false, error: 'Needs "slots": {slot: [{id}]}.' };
  const slots = Object.fromEntries(Object.keys(SLOTS).map(s => [s, []]));
  for (const [s, items] of Object.entries(j.slots)) {
    if (!SLOTS[s]) return { ok: false, error: `Unknown slot "${s}" (slots: ${Object.keys(SLOTS).join(', ')}).` };
    if (!Array.isArray(items)) return { ok: false, error: `Slot "${s}" must be a list.` };
    if (items.length > MAX_PER_SLOT) return { ok: false, error: `Slot "${s}" has more than ${MAX_PER_SLOT} widgets.` };
    for (const it of items) {
      const e = typeof it === 'string' ? { id: it } : it;
      if (!e || typeof e.id !== 'string' || !e.id) return { ok: false, error: `Slot "${s}": every entry needs a string id.` };
      if (slots[s].some(x => x.id === e.id)) return { ok: false, error: `Slot "${s}": "${e.id}" appears twice.` };
      slots[s].push(e.hidden === true ? { id: e.id, hidden: true } : { id: e.id });
    }
  }
  return { ok: true, layout: { webharness: 'metrics-layout', v: 1, slots } };
}

let layout = null, saved = false;
const load = () => {
  try { const t = localStorage.getItem(KEY); if (t) { const v = validate(JSON.parse(t)); if (v.ok) { saved = true; return v.layout; } } } catch {}
  saved = false; return clone(DEFAULT_LAYOUT);
};
const persist = () => { saved = true; try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch {} note(); };
const cur = () => (layout ||= load());
export const getLayout = () => clone(cur());
export const isCustom = () => (cur(), saved);
export function setLayout(j) { const v = validate(j); if (v.ok) { layout = v.layout; persist(); } return v; }
export function reset() { layout = clone(DEFAULT_LAYOUT); saved = false; try { localStorage.removeItem(KEY); } catch {} note(); }
export const exportLayout = () => JSON.stringify(cur(), null, 1);
export function importLayout(text) { let j; try { j = JSON.parse(String(text).trim()); } catch (e) { return { ok: false, error: 'Not JSON: ' + e.message }; } return setLayout(j); }
const entries = slot => { if (!SLOTS[slot]) throw new Error('unknown slot ' + slot); return cur().slots[slot]; };
export function add(slot, id) {
  const a = entries(slot);
  if (a.some(e => e.id === id)) return false;
  if (a.length >= MAX_PER_SLOT) return false;
  a.push({ id }); persist(); return true;
}
export function remove(slot, id) { const a = entries(slot), i = a.findIndex(e => e.id === id); if (i < 0) return false; a.splice(i, 1); persist(); return true; }
export function move(slot, id, delta) { const a = entries(slot), i = a.findIndex(e => e.id === id), j = i + delta; if (i < 0 || j < 0 || j >= a.length) return false; [a[i], a[j]] = [a[j], a[i]]; persist(); return true; }
export function hide(slot, id, hidden = true) { const e = entries(slot).find(x => x.id === id); if (!e) return false; if (hidden) e.hidden = true; else delete e.hidden; persist(); return true; }
export const fits = (w, slot) => SLOTS[slot]?.includes(w.size);

// ---------- data handed to widgets ----------
// sessions: the stored session objects; ck: checkpoints.stats(). Profiles carry no message text.
export function gather(sessions, activeId, ck = {}) {
  const list = Object.values(sessions || {}).filter(s => s && Array.isArray(s.ledger));
  const profiles = list.map(s => { try { return profile(s); } catch { return null; } }).filter(Boolean);
  const session = profiles.find(p => p.id === activeId) || null;
  return { session, all: { profiles, across: across(profiles), behaviour: behaviour(profiles), checkpoints: ck, activeId } };
}

// The DOM for one slot: one box per visible widget that is registered and fits. A widget that throws shows its error in its own box.
export function renderSlot(slot, session, all) {
  const out = [];
  for (const e of entries(slot)) {
    const w = reg.get(e.id);
    if (e.hidden || !w || !fits(w, slot)) continue;
    let body;
    try { body = w.render(session, all, ctxFor(slot)); if (!(body instanceof Node)) body = h('span', { text: String(body ?? '') }); }
    catch (err) { body = h('span', { class: 'wmp-err', text: `${w.id}: ${err?.message || err}` }); }
    out.push(w.size === 's'
      ? h('span', { class: 'wmp wmp-s', 'data-w': w.id, title: w.title }, body)
      : h('section', { class: 'wmp wmp-' + w.size, 'data-w': w.id }, h('h4', { text: w.title }), body));
  }
  return out;
}

// ---------- built-in widgets ----------
const needs = (s, f) => s ? f(s) : none('no session open');
const real = [
  { id: 'cost-chip', title: 'Session cost', size: 's', render: s => h('span', { text: s ? fmt.usd(s.cost.total) : '-' }) },
  { id: 'cache-chip', title: 'Share of prompt tokens served from cache', size: 's', render: s => h('span', { text: s ? 'cache ' + fmt.pct(s.cache.overallPct) : 'cache -' }) },
  { id: 'cost', title: 'Cost', size: 'm', render: s => needs(s, p => kv([
    ['total', fmt.usd(p.cost.total)], ['main requests', fmt.usd(p.cost.main)], ['helper requests', fmt.usd(p.cost.helper)],
    ['helper share', p.cost.total ? fmt.pct(100 * p.cost.helper / p.cost.total) : '-', p.cost.total && p.cost.helper / p.cost.total > 0.3 ? 'warn' : ''],
    ['per request, median', fmt.usd(p.cost.perRequestMedian)], ['helper, largest', fmt.usd(p.cost.helperMax)],
    ['requests', `${p.requests.main} main + ${p.requests.helper} helper`]])) },
  { id: 'tokens', title: 'Tokens', size: 'm', render: s => needs(s, p => {
    const t = p.tokens, top = Math.max(t.prompt, 1);
    const row = (name, v, of) => h('div', { class: 'wmp-bar' }, h('span', { text: name }), h('i', {}, h('b', { style: `width:${Math.min(100, 100 * n0(v) / n0(of || top)).toFixed(1)}%` })), h('em', { text: fmt.k(v) }));
    return h('div', {}, row('prompt', t.prompt), row('cached', t.cached), row('written', t.write), row('output', t.out), row('reasoning', t.reasoning, t.out || 1));
  }) },
  { id: 'cache-curve', title: 'Cache % per request', size: 'm', render: s => needs(s, p => h('div', {}, lineChart(p.cache.curve, { max: 100, unit: '%', fmtY: v => String(Math.round(v)), label: 'cache percent per request' }),
    h('p', { class: 'wmp-note', text: `overall ${fmt.pct(p.cache.overallPct)} · first hit at request ${p.cache.firstHitAtRequest == null ? 'never' : p.cache.firstHitAtRequest + 1}` }))) },
  { id: 'prompt-curve', title: 'Prompt tokens per request', size: 'm', render: s => needs(s, p => lineChart(p.growth.promptCurve, { label: 'prompt tokens per request' })) },
  { id: 'requests', title: 'Requests', size: 'l', render: s => needs(s, p => {
    if (!p.rows.length) return none('no requests yet');
    const shown = p.rows.slice(-200);
    return h('div', { class: 'wmp-scroll' }, table(['#', 'strategy / helper', 'model', 'prompt', 'cache', 'out', 'cost'], shown.map(r => [r.i + 1, r.helper ? 'helper:' + r.helper : r.strat || '-', r.model || '-', fmt.k(r.prompt), fmt.pct(r.cachePct), fmt.k(r.out), fmt.usd(r.cost)]), { left: false }),
      p.rows.length > shown.length ? h('p', { class: 'wmp-note', text: `last ${shown.length} of ${p.rows.length}` }) : null);
  }) },
  { id: 'tool-calls', title: 'Tool calls', size: 'm', render: s => needs(s, p => {
    const c = p.calls;
    if (!c.total) return none('no tool calls');
    const rows = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
    return h('div', {}, table(['tool', 'calls'], rows(c.byTool).map(([a, b]) => [a, b])),
      table(['result', 'calls'], rows(c.byResultClass).map(([a, b]) => [h('td', { text: a, 'data-tone': a === 'ok' ? 'ok' : a === 'held' || a === 'empty' ? '' : 'bad' }), b])));
  }) },
  { id: 'repeats-flags', title: 'Repeats and flags', size: 'm', render: s => needs(s, p => kv([
    ['identical calls repeated', p.calls.repeats, p.calls.repeats ? 'warn' : ''], ['repeat runs', p.calls.repeatRuns],
    ['calls before first write', p.calls.callsBeforeFirstWrite == null ? 'no write' : `${p.calls.callsBeforeFirstWrite} (${p.calls.firstWriteTool})`],
    ['scripted file writes', p.calls.scriptedWrites ?? 0],
    ['failed calls', p.calls.total - (p.calls.byResultClass.ok || 0), p.calls.total - (p.calls.byResultClass.ok || 0) ? 'warn' : ''],
    ['short follow-ups', p.perTurn.filter(t => t.shortFollowUp).length], ['turns', p.turns],
    ...Object.entries(p.flags).map(([k, n]) => ['flag ' + k, n, 'warn'])])) },
  { id: 'checkpoints', title: 'Cache checkpoints', size: 'm', render: (s, all) => {
    const rows = Object.entries(all.checkpoints || {});
    return rows.length ? table(['kind', 'set', 'paid', 'reads', 'writes'], rows.map(([k, o]) => [k, o.set, o.paid, o.reads, o.writes])) : none('no checkpoints recorded');
  } },
  { id: 'strategy-model', title: 'Strategy and model, all sessions', size: 'l', render: (s, all) => all.across.length
    ? h('div', { class: 'wmp-scroll' }, table(['strategy | model', 'sessions', 'req', 'cost', 'median', 'cache', 'first hit', 'out/req'], all.across.map(r => [r.group, r.sessions, r.requests, fmt.usd(r.costTotal), fmt.usd(r.costMedian), fmt.pct(r.cachePct), r.firstHitAtRequest == null ? '-' : r.firstHitAtRequest + 1, fmt.k(r.outPerRequest)]), { left: false }))
    : none('no requests in any session') },
  { id: 'sessions', title: 'Sessions side by side', size: 'l', render: (s, all) => all.behaviour.length
    ? h('div', { class: 'wmp-scroll' }, table(['session', 'repeats', 'before 1st write', 'failed', 'short follow-ups', 'helper cost'], all.behaviour.map(r => [String(r.title || r.id).slice(0, 28), r.repeats, r.callsBeforeFirstWrite ?? '-', r.failedShare == null ? '-' : fmt.pct(100 * r.failedShare), r.shortFollowUps, r.helperShareOfCost == null ? '-' : fmt.pct(100 * r.helperShareOfCost)])))
    : none('no sessions') },
];
for (const w of real) register(w);

// ---------- styles (injected once by app/metrics.js) ----------
export const CSS = `
.wmp { box-sizing: border-box; color: ${color.fg}; font-size: 12px; }
.wmp-s { display: inline-block; padding: 1px 8px; border: 1px solid ${color.border}; border-radius: 10px; background: ${color.card}; color: ${color.muted}; white-space: nowrap; }
.wmp-m, .wmp-l { border: 1px solid ${color.border}; border-radius: 6px; background: ${color.card}; padding: 6px 8px; margin: 6px 0; min-width: 0; }
.wmp h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: ${color.muted}; }
.wmp-t { width: 100%; border-collapse: collapse; font-size: 11px; }
.wmp-t th, .wmp-t td { text-align: left; padding: 2px 4px; border-bottom: 1px solid ${color.border}; overflow-wrap: anywhere; }
.wmp-t th { color: ${color.muted}; font-weight: 600; }
.wmp-t .num { text-align: right; font-variant-numeric: tabular-nums; }
.wmp-t [data-tone=ok] { color: ${color.ok}; } .wmp-t [data-tone=bad] { color: ${color.danger}; }
.wmp-kv { display: grid; grid-template-columns: 1fr auto; gap: 1px 10px; margin: 0; }
.wmp-kv dt { color: ${color.muted}; } .wmp-kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.wmp-kv dd[data-tone=warn] { color: ${color.danger}; }
.wmp-bar { display: grid; grid-template-columns: 62px 1fr 44px; align-items: center; gap: 6px; margin: 2px 0; }
.wmp-bar i { display: block; height: 6px; background: ${color.border}; border-radius: 3px; overflow: hidden; }
.wmp-bar b { display: block; height: 100%; background: ${color.accent}; }
.wmp-bar span { color: ${color.muted}; } .wmp-bar em { font-style: normal; text-align: right; font-variant-numeric: tabular-nums; }
.wmp-chart { width: 100%; height: auto; display: block; }
.wmp-note, .wmp-none { margin: 4px 0 0; color: ${color.muted}; font-size: 11px; }
.wmp-err { color: ${color.danger}; }
.wmp-scroll { max-height: 280px; overflow: auto; }
`;
