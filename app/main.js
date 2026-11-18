// Controller and DOM. Rendering is append-only: a message node is created once
// and never rebuilt. Which session is visible, row highlight and panel state are
// expressed as style rules (styles.js), not by touching the nodes.

import { state, load, saveMeta, saveSession, saveKeys, newSession, dropSession, children, family, exportBundle, importBundle, uid } from './store.js';
import { SCHEMA } from './migrate.js';
import { rule } from './styles.js';
import { providers } from './providers.js';
import { defsFor, execTool, SWAPPABLE, ARG_MAX, runJs } from './tools.js';
import { client as gitClient } from './git.js';
import * as bridge from './bridge.js';
import { render } from './widgets.js';
import * as pat from './patterns.js';
import { put, get, handlesIn } from './outstore.js';
import { buildRequest, measure, report, padAttachment, inherit, imitatesNote, keptLines, corePrompt, EDGE_MIN, markedOnly, edgeReplies, turnOf, KINDS } from './context.js';

export const VERSION = '0.15.0';
const MAX_STEPS = 8; // model <-> tool round trips per user turn
const MAX_BRANCHES = 6; // concerns per fan_out
const FOLD_MAX = 2000; // chars of a fold handed back to the source
const BRANCH_BUDGET = 150000; // default prompt+output tokens a fan_out branch may spend

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'text' ? e.textContent = v : e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

const SHELL = `
<aside id="side">
  <header><b>WebHarness</b><span id="ver"></span></header>
  <button data-act="new">+ session</button>
  <button data-act="import">import</button>
  <input type="file" id="file" accept=".session,.json" hidden>
  <nav id="sessions"></nav>
</aside>
<main>
  <header id="bar">
    <input id="title" aria-label="Session title">
    <select id="provider" aria-label="Provider"></select>
    <span id="modelbox"><input id="model" placeholder="model: type to filter" aria-label="Model" autocomplete="off"><div id="picker"></div></span>
    <datalist id="models"></datalist>
    <button data-act="export">export .session</button>
    <button data-act="branch" title="Fork this session at its tail to work the text in the message box as one concern">branch</button>
    <button data-act="epoch" title="Replace this conversation with a short pocket in a new session">fold session</button>
    <button data-act="foldback" title="Append this branch's last reply to its source as a fold">fold back</button>
    <button data-act="inspector">inspector</button>
  </header>
  <div id="threads"></div>
  <form id="composer">
    <textarea id="input" rows="3" placeholder="Message (Enter to send, Shift+Enter for a new line)"></textarea>
    <button id="send">send</button>
    <button type="button" data-act="stop">stop</button>
  </form>
</main>
<aside id="inspect">
  <nav id="panes"><button data-act="pane" data-pane="stage">Stage</button><button data-act="pane" data-pane="insp">Inspector</button></nav>
  <div id="stage"></div>
  <div id="insp">
  <details open><summary>Settings</summary>
    <label>API key (kept in this browser only, never exported)</label>
    <input id="key" type="password" autocomplete="off">
    <label>GitHub token (fine-grained, limited to the repos it may touch; kept in this browser only). New sessions get repository tools while one is set.</label>
    <div style="display:flex;gap:6px"><input id="ghkey" type="password" autocomplete="off"><button data-act="ghcheck">check</button></div>
    <p class="note" id="ghwho"></p>
    <label>Pinned code ref (tag, branch or commit; empty = this branch)</label>
    <input id="ref" placeholder="e.g. v0.1.0">
    <label>API base URL (empty = provider default)</label>
    <input id="base" placeholder="">
    <label>Helper model (extracts what was asked for from long tool output; empty = keyword filter)</label>
    <input id="helper" list="models" placeholder="a small, cheap model id">
    <label>Branch token budget (prompt + output, per fan_out branch)</label>
    <input id="budget" type="number" min="1000" step="1000">
    <p class="note" id="build"></p>
  </details>
  <details><summary id="pricesum">Models</summary>
    <p class="note">Collapsed line: input / cached input / output, per 1M tokens.</p>
    <table id="price"></table>
    <button data-act="models">refresh list</button> <span class="note" id="modelsn"></span>
  </details>
  <details open><summary>System prompt</summary>
    <label>Core prompt (sent first; follows the two settings below)</label>
    <pre id="core"></pre>
    <label>Your system prompt</label>
    <textarea id="system" rows="6"></textarea>
    <label>How past tool calls are sent</label>
    <select id="wire"><option value="calls">calls: structured, as the model made them</option><option value="notes">notes: one text line per call, results as text</option></select>
    <label>Replies, when first sent back to the model</label>
    <select id="edge"><option value="off">off: sent whole</option><option value="marks">marks: a long reply with "!" lines is sent as those lines</option><option value="helper">helper: marks, else condensed by the helper model</option></select>
    <label><input type="checkbox" id="keep"> Keep marks: the model flags lines to keep with "!" (adds one sentence to the system prompt)</label>
    <p class="note">First bytes of every request. Editing it mid-session breaks the cached prefix; the ledger will show it.</p>
  </details>
  <details><summary>Scratchpads</summary>
    <p class="note">"In context" pads are attached to your next message when new or changed.</p>
    <div id="pads"></div>
    <button data-act="pad-add">+ pad</button>
  </details>
  <details><summary>Patterns</summary>
    <p class="note">Solutions, gotchas and recipes the model stored, with where each came from. The trail is one automatic row per tool call.</p>
    <div id="patterns"></div>
    <p class="note" id="patn"></p>
  </details>
  <details><summary>Sessions</summary>
    <p class="note">All sessions from their ledgers, with branches included. context = last request's prompt tokens; condensed = replies sent back in short form; edge = long replies not yet sent back.</p>
    <table id="overview" class="audit"></table>
    <p class="note" id="stewardsum"></p>
  </details>
  <details open><summary>Cache ledger</summary>
    <p class="note">kept = how much of the previous request this one repeats byte-for-byte (local). cached = input tokens the provider reports as cache hits.</p>
    <table id="ledger"><thead><tr><th>#</th><th>kept</th><th>prompt</th><th>cached</th><th>out</th><th>$</th></tr></thead><tbody></tbody></table>
    <p class="note" id="ledgersum"></p>
  </details>
  <details><summary>Last request</summary><pre id="req"></pre></details>
  <details><summary>Stream events</summary><pre id="events"></pre></details>
  <details open><summary>Trace</summary>
    <p class="note">Every request this page load: body sent, status, raw response chunks with ms offsets. No API key. Contains your message text.</p>
    <button data-act="trace">export .trace</button> <span class="note" id="tracen">0 requests</span>
  </details>
  </div>
</aside>`;

let app, busy = false, ctl = null, link = null;
const trace = []; // raw request/response records, memory only
const opt = () => ({ base: state.meta.settings.base?.[state.meta.settings.provider] || '', trace });
const cur = () => state.sessions[state.meta.active];
const provider = () => providers[state.meta.settings.provider] || providers.openrouter;

// ---------- message rendering ----------

function blocks(text) {
  const out = [];
  const re = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(h('div', { class: 'txt', text: text.slice(i, m.index).trim() }));
    out.push(h('figure', { class: 'code' },
      h('figcaption', {}, h('span', { text: m[1].trim() || 'text' }), h('button', { 'data-copy': 'code', type: 'button', text: 'copy' })),
      h('pre', {}, h('code', { text: m[2].replace(/\n$/, '') }))));
    i = re.lastIndex;
  }
  const rest = text.slice(i).trim();
  if (rest) out.push(h('div', { class: 'txt', text: rest }));
  return out;
}

// ---------- stage: where widgets live ----------
// The stage is derived from the log: every show_widget call, in order, with a
// later call to the same slot replacing the earlier card. Restoring a session
// rebuilds it. The thread only carries a chip that points at the card.

function stagebox(s) {
  let b = $(`.stagebox[data-session="${s.id}"]`);
  if (!b) { b = h('div', { class: 'stagebox', 'data-session': s.id }); $('#stage').append(b); }
  return b;
}

const staging = new Map(); // sessionId -> promise chain, so cards mount in log order even when arguments load from the store

function showWidget(s, tc) {
  let logged = {};
  try { logged = JSON.parse(tc.function.arguments); } catch {}
  const chip = h('button', { class: 'chip', type: 'button', text: '▣ ' + String(logged.name || logged.title || logged.slot || 'widget') });
  staging.set(s.id, (staging.get(s.id) || Promise.resolve()).then(async () => {
    let a = logged;
    if (a.ref) { try { a = JSON.parse(await get(a.ref)); } catch { a = { kind: 'text', title: logged.name, data: { text: `Stored widget ${logged.ref} is not in this browser.` } }; } }
    mountWidget(s, tc, a, chip);
  }));
  return chip;
}

function mountWidget(s, tc, a, chip) {
  if (!a.kind && a.html) a = { kind: 'html', title: a.title, data: { html: a.html } }; // calls stored before 0.5
  const slot = String(a.slot || tc.id), title = String(a.title || slot);
  const card = h('section', { class: 'card', 'data-kind': String(a.kind) },
    h('header', {}, h('b', { text: title }), h('span', { class: 'note', text: String(a.kind) }), h('button', { type: 'button', 'data-act': 'card-drop', title: 'Hide', text: '×' })),
    h('div', { class: 'body' }, render(a.kind, a.data, v => widgetEvent(s, slot, v))));
  card._slot = slot;
  const box = stagebox(s), old = [...box.children].find(c => c._slot === slot);
  old ? old.replaceWith(card) : box.prepend(card);
  chip._slot = slot;
}

// A user interaction with a widget becomes a user message and a turn.
function widgetEvent(s, slot, value) {
  if (busy || !s || s.id !== state.meta.active) return;
  push(s, { role: 'user', content: `event ${slot}: ${(JSON.stringify(value) ?? 'null').slice(0, 4000)}` });
  run(s);
}

function setPane(p) {
  state.meta.settings.pane = p;
  rule('pane', `#${p === 'stage' ? 'insp' : 'stage'}{display:none}\n#panes [data-pane="${p}"]{border-color:var(--accent);color:var(--accent)}`);
}

function messageNode(m, s) {
  const el = h('article', { class: 'msg', 'data-role': m.role });
  if (m.x?.reasoning) el.append(h('div', { class: 'think', text: m.x.reasoning }));
  if (m.role === 'tool') {
    el.append(h('details', { class: 'call' }, h('summary', { text: 'result ' + m.tool_call_id }), h('pre', { text: m.content })));
    if (m.x?.audit) el.append(auditTable(m.x.audit));
  } else if (m.content) el.append(...blocks(m.content));
  for (const tc of m.tool_calls || []) {
    const d = h('details', { class: 'call' }, h('summary', { text: `call ${tc.function.name} (${tc.id})` }), h('pre', { text: tc.function.arguments }));
    const ref = /^\{"ref":"(os:[a-z0-9]+)"/.exec(tc.function.arguments)?.[1];
    if (ref) d.addEventListener('toggle', async () => { // show the stored arguments on first open
      if (!d.open || d._full) return;
      d._full = true;
      d.append(h('pre', { class: 'full', text: await get(ref).catch(() => null) ?? 'Stored arguments are not in this browser.' }));
    });
    el.append(d);
    if (tc.function.name === 'show_widget') el.append(showWidget(s, tc));
  }
  if (m.content) el.append(h('button', { class: 'copy', 'data-copy': 'msg', type: 'button', text: 'copy' }));
  el._raw = m.content || '';
  el._m = m;
  if (m.x?.wire != null) wireNote(el, m);
  return el;
}

// What each branch literally did, from the harness's own records (never from the model's account).
function auditTable(audit) {
  const head = h('tr', {}, ...['concern', 'status', 'requests', 'tool calls', 'prompt', 'cached', '$'].map(t => h('th', { text: t })));
  return h('table', { class: 'audit' }, head, ...audit.map(a => h('tr', {},
    h('td', {}, h('button', { type: 'button', 'data-goto': a.branch, text: a.concern })),
    h('td', { text: a.status }), h('td', { text: String(a.requests) }), h('td', { text: a.tools || '-' }),
    h('td', { text: String(a.prompt) }), h('td', { text: String(a.cached) }), h('td', { text: a.cost.toFixed(5) }))));
}

function thread(s) {
  let t = $(`.thread[data-session="${s.id}"]`);
  if (!t) {
    t = h('section', { class: 'thread', 'data-session': s.id });
    t.append(...s.messages.map(m => messageNode(m, s)));
    $('#threads').append(t);
  }
  return t;
}

const scrollDown = () => { const t = $('#threads'); t.scrollTop = t.scrollHeight; };

function push(s, m) {
  const t = thread(s); // built from the log as it stands, before the new message joins it
  s.messages.push(m);
  saveSession(s);
  t.append(messageNode(m, s));
  if (s.id === state.meta.active && m.tool_calls?.some(t => t.function.name === 'show_widget')) setPane('stage');
  scrollDown();
}

const notice = (s, text) => { link?.emit('notice', { session: s.id, text }); thread(s).append(h('article', { class: 'msg', 'data-role': 'error' }, h('div', { class: 'txt', text }))); scrollDown(); };

// ---------- sidebar, ledger, pads ----------

function sessionRow(s) {
  const attrs = { 'data-id': s.id };
  if (s.parent) attrs['data-parent'] = s.parent.id;
  return h('div', attrs, h('span', { text: s.title }), h('button', { 'data-act': 'drop', type: 'button', title: 'Delete session', text: '×' }));
}

function ledgerRow(e, i) {
  const pct = e.helper ? 'helper' : e.kept == null ? '-' : Math.round(100 * e.kept / e.prevChars) + '%';
  const hit = e.kept == null ? '' : e.kept === e.prevChars ? 'full' : 'broken';
  const n = v => v == null ? '-' : String(v);
  return h('tr', {},
    h('td', { text: String(i + 1) }), h('td', { 'data-hit': hit, title: `${e.broke ? 'first difference in ' + e.broke + '; ' : ''}${n(e.kept)} of ${n(e.prevChars)} chars; request ${e.chars} chars; ${e.model}`, text: pct }),
    h('td', { text: n(e.prompt) }), h('td', { text: n(e.cached) }), h('td', { text: n(e.completion) }),
    h('td', { text: e.cost == null ? '-' : Number(e.cost).toFixed(5) }));
}

function padNode(p) {
  return h('div', { class: 'pad', 'data-pad': p.id },
    h('div', {},
      h('input', { 'data-f': 'label', value: p.label, 'aria-label': 'Label' }),
      h('label', {}, Object.assign(h('input', { type: 'checkbox', 'data-f': 'include' }), { checked: !!p.include }), ' in context'),
      h('button', { 'data-act': 'pad-drop', type: 'button', text: '×' })),
    Object.assign(h('textarea', { 'data-f': 'text', rows: '4' }), { value: p.text }));
}
function renderPatterns() {
  const list = pat.live().sort((a, b) => b.by.t - a.by.t);
  $('#patterns').replaceChildren(...list.map(p => h('details', { class: 'pat', 'data-pat': p.id },
    h('summary', {}, h('span', { class: 'kind', text: p.kind }), ' ' + p.title),
    h('p', { class: 'note', text: `${p.id} · ${p.labels.map(l => '#' + l).join(' ') || 'no labels'} · used ${p.uses} · from ${state.sessions[p.by.session]?.title || p.by.session}, message ${p.by.message}, ${p.by.model}` }),
    h('pre', { text: p.recipe ? JSON.stringify(p.recipe, null, 1) + (p.body ? '\n\n' + p.body : '') : p.body }),
    p.refs?.length ? h('p', { class: 'note', text: 'refs: ' + p.refs.join(' ') }) : '',
    h('button', { type: 'button', 'data-act': 'pat-drop', text: 'delete' }))));
  $('#patn').textContent = `${list.length} patterns · ${pat.trail().length} trail rows`;
}

const renderPads = () => $('#pads').replaceChildren(...state.meta.pads.map(padNode));

function activate(id) {
  state.meta.active = id;
  saveMeta();
  const s = cur();
  thread(s);
  stagebox(s);
  rule('active', `.thread:not([data-session="${id}"]),.stagebox:not([data-session="${id}"]){display:none}\n#sessions [data-id="${id}"]{background:var(--sel)}`);
  $('#title').value = s.title;
  $('#system').value = s.system;
  $('#wire').value = s.wire || 'calls';
  $('#keep').checked = !!s.keep;
  $('#edge').value = s.edge || 'off';
  showCore();
  $('#ledger tbody').replaceChildren(...s.ledger.map(ledgerRow));
  s.parent ? app.setAttribute('data-branch', '') : app.removeAttribute('data-branch');
  ledgerSum();
  scrollDown();
}

// Totals for the visible session, and with its branches when it has any.
function ledgerSum() {
  const s = cur();
  if (!s) return;
  overview();
  const sum = list => {
    const t = { n: 0, prompt: 0, cached: 0, out: 0, cost: 0 };
    for (const e of list) { t.n++; t.prompt += e.prompt || 0; t.cached += e.cached || 0; t.out += e.completion || 0; t.cost += Number(e.cost) || 0; }
    return `${t.n} requests, ${t.prompt} prompt (${t.prompt ? Math.round(100 * t.cached / t.prompt) : 0}% cached), ${t.out} out, $${t.cost.toFixed(5)}`;
  };
  const fam = family(s);
  $('#ledgersum').textContent = 'this session: ' + sum(s.ledger) + (fam.length > 1 ? `\nwith ${fam.length - 1} branches: ` + sum(fam.flatMap(x => x.ledger)) : '');
}

function showBase() {
  const id = state.meta.settings.provider;
  $('#base').value = state.meta.settings.base?.[id] || '';
  $('#base').placeholder = providers[id].base || 'not used by this provider';
}

function showCore() {
  const s = cur();
  $('#core').textContent = s.core ? corePrompt(s) : 'Not used in this session (created before v0.10).';
}

function applyInspector() {
  rule('inspector', state.meta.settings.inspector ? '' : '#inspect{display:none}\n#app{grid-template-columns:var(--side) minmax(0,1fr)}');
}

// Model catalogue: fetched from the provider, cached per provider and base URL
// for a day under wh:models:<provider>. Prices are shown, never hardcoded.
const MODELS_TTL = 24 * 3600e3;
let catalogue = [], loadSeq = 0;

async function loadModels(force) {
  const id = state.meta.settings.provider, o = opt(), k = 'wh:models2:' + id;
  const turn = ++loadSeq, stale = () => turn !== loadSeq; // a slower earlier load must not win
  let c = null;
  try { c = JSON.parse(localStorage.getItem(k)); } catch {}
  if (!force && c && c.base === o.base && Date.now() - c.t < MODELS_TTL) catalogue = c.list;
  else {
    try {
      const list = await provider().models(state.keys[id], o);
      if (stale()) return;
      catalogue = list;
      try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), base: o.base, list: catalogue })); } catch {}
      c = { t: Date.now() };
    } catch (e) { if (stale()) return; catalogue = c?.base === o.base ? c.list : []; console.warn('model list failed:', e); }
  }
  $('#models').replaceChildren(...catalogue.map(m => h('option', { value: m.id, label: m.name })));
  $('#modelsn').textContent = `${catalogue.length} models` + (c?.t ? `, fetched ${new Date(c.t).toLocaleString()}` : '');
  showPrice();
}

// ---------- model picker ----------
// Filter words all have to match the id or name. Some words are filters instead:
//   free    costs nothing            tools   supports tool calls
//   cache   lists a cached price     cheap   sort by input price
//   <0.1    input under $0.10 / 1M
const per1M = v => v == null || v === '' || !(Number(v) > 0) ? '--' : '$' + +(Number(v) * 1e6).toPrecision(3);
const ctxText = n => !n ? '--' : n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k';

function filterModels(q) {
  let list = catalogue, cheap = false;
  const price = m => Number(m.pricing.prompt) || 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const under = /^<(\d*\.?\d+)$/.exec(w);
    if (w === 'free') list = list.filter(m => price(m) === 0 && !(Number(m.pricing.completion) > 0));
    else if (w === 'tools') list = list.filter(m => m.tools);
    else if (w === 'cache') list = list.filter(m => Number(m.pricing.input_cache_read) > 0);
    else if (w === 'cheap') cheap = true;
    else if (under) list = list.filter(m => price(m) * 1e6 < Number(under[1]));
    else list = list.filter(m => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w));
  }
  return cheap ? [...list].sort((a, b) => price(a) - price(b)) : list;
}

function showPicker() {
  const hits = filterModels($('#model').value);
  $('#picker').replaceChildren(
    h('div', { class: 'hint', text: `${hits.length} of ${catalogue.length} · words match the name · free · tools · cache · cheap · <0.1` }),
    h('div', { class: 'row head' }, ...['model', 'context', 'input', 'cached', 'output'].map(t => h('span', { text: t }))),
    ...hits.slice(0, 80).map(m => h('div', { class: 'row', 'data-model': m.id, title: m.name + (m.tools ? '' : ' (no tool calls)') },
      h('span', { text: m.id + (m.tools ? '' : ' ⚠') }), h('span', { text: ctxText(m.ctx) }),
      h('span', { text: per1M(m.pricing.prompt) }), h('span', { text: per1M(m.pricing.input_cache_read) }), h('span', { text: per1M(m.pricing.completion) }))));
  app.setAttribute('data-picking', '');
}

function pickModel(id) {
  $('#model').value = id;
  state.meta.settings.model = id;
  saveMeta();
  showPrice();
  app.removeAttribute('data-picking');
}

// [pricing key, label, multiplier, unit]. Token prices arrive as USD per token.
const PRICE_ROWS = [
  ['prompt', 'input', 1e6, '/ 1M tok'], ['input_cache_read', 'cached input', 1e6, '/ 1M tok'],
  ['input_cache_write', 'cache write', 1e6, '/ 1M tok'], ['completion', 'output', 1e6, '/ 1M tok'],
  ['internal_reasoning', 'reasoning', 1e6, '/ 1M tok'], ['web_search', 'web search', 1, '/ search'],
  ['input_cache_write_1h', 'cache write 1h', 1e6, '/ 1M tok'], ['request', 'request', 1, '/ request'],
];

// Full price list for one model: every key the provider sends.
function priceRows(id) {
  const m = catalogue.find(m => m.id === id), rows = [];
  if (!m) return [h('tr', {}, h('td', { text: id ? 'Not in the fetched list; no price data.' : 'None chosen.' }))];
  const known = new Set(PRICE_ROWS.map(r => r[0]));
  for (const [k, label, mul, unit] of PRICE_ROWS) {
    const v = Number(m.pricing[k]), core = k === 'prompt' || k === 'input_cache_read' || k === 'completion';
    if (m.pricing[k] != null && v > 0) rows.push(h('tr', {}, h('td', { text: label }), h('td', { text: '$' + +(v * mul).toPrecision(4) + ' ' + unit })));
    else if (core) rows.push(h('tr', {}, h('td', { text: label }), h('td', { text: '--' }))); // no cost, or none listed
  }
  // anything the provider sends that this build has no label for is shown raw
  for (const [k, v] of Object.entries(m.pricing)) if (!known.has(k) && Number(v) > 0) rows.push(h('tr', {}, h('td', { text: k }), h('td', { text: String(v) + ' (raw)' })));
  if (m.ctx) rows.push(h('tr', {}, h('td', { text: 'context' }), h('td', { text: m.ctx.toLocaleString() + ' tok' })));
  rows.push(h('tr', {}, h('td', { text: 'tool calls' }), h('td', { text: m.tools ? 'yes' : 'no' })));
  return rows;
}

// The Models section: main and helper, collapsed to one line of input / cached / output per 1M.
function showPrice() {
  const set = state.meta.settings;
  const brief = id => { const m = catalogue.find(m => m.id === id); return m ? `${per1M(m.pricing.prompt)} / ${per1M(m.pricing.input_cache_read)} / ${per1M(m.pricing.completion)}` : '--'; };
  const roles = [['main', set.model], ['helper', set.helper]].filter(([role, id]) => role === 'main' || id);
  $('#pricesum').textContent = 'Models · ' + roles.map(([role, id]) => `${role} ${brief(id)}`).join(' · ');
  $('#price').replaceChildren(...roles.flatMap(([role, id]) => [h('tr', { class: 'role' }, h('th', { colspan: '2', text: `${role}: ${id || 'none'}` })), ...priceRows(id)]));
}

// ---------- the turn loop ----------

async function send(text) {
  const s = cur();
  if (busy || !text.trim()) return;
  if (s.title === 'New session') { retitle(s, text.trim().slice(0, 40)); s.autoTitle = true; }
  await stewarding; // a pass already under way may be condensing this session's edge
  await edgeFold(s);
  // a new session opens with the pattern index; it is part of the first message from then on
  push(s, { role: 'user', content: text + (s.messages.length ? '' : pat.index()) + padAttachment(s, state.meta.pads) });
  await run(s);
}

function retitle(s, title) {
  s.title = title;
  saveSession(s);
  if (s.id === state.meta.active) $('#title').value = title;
  $(`#sessions [data-id="${s.id}"] span`).textContent = title;
}

// One user-initiated run. Branches started inside it go through turns() directly.
async function run(s) {
  const set = state.meta.settings, p = provider();
  if (!set.model) return notice(s, 'Choose a model first.');
  if (p.needsKey && !state.keys[set.provider]) return notice(s, 'Add an API key in Settings first.');
  busy = true; app.setAttribute('data-busy', ''); ctl = new AbortController();
  try { return await turns(s, 0); }
  finally { busy = false; app.removeAttribute('data-busy'); ctl = null; queueSteward(); }
}

// ---------- edge folding and the steward ----------
//
// Edge folding: before a reply is first sent back to the model, it may be
// replaced on the wire by a short form (x.wire). The stored message is untouched
// and still shown. Per session (session.edge):
//   'off'     send replies whole
//   'marks'   a long reply with "!" lines is sent as those lines only
//   'helper'  marks first; a long reply without marks is condensed by the steward
//
// The steward is one helper-model request that serves every session at once. It
// is given items (a reply to condense, a session to title), not conversations,
// and its answer is applied by the harness. It runs when the app goes idle.

// A condensed reply goes back as a reference: one line "[handle kind]" and the
// kept lines. The handle is a stored record holding the full reply plus what the
// harness read off the turn (steps, failures), which entry_read serves by part.
async function setWire(s, i, kept, kind) {
  const m = s.messages[i];
  if (i < (s.sent || 0) || !kept) return false; // never rewrite sent bytes
  const turn = turnOf(s, i);
  const k = KINDS.includes(kind) ? kind : turn.kind;
  const handle = await put(JSON.stringify({ v: 1, kind: k, session: s.id, reply: i, text: m.content, kept, steps: turn.steps, gotchas: turn.gotchas }));
  const text = `[${handle} ${k}]\n${kept}`;
  if (text.length >= m.content.length || i < (s.sent || 0)) return false; // never grow
  (m.x ??= {}).wire = text;
  saveSession(s);
  const node = $$(`.thread[data-session="${s.id}"] > .msg`).find(n => n._m === m);
  if (node) wireNote(node, m);
  return true;
}

function wireNote(el, m) {
  el.setAttribute('data-condensed', '');
  el.append(h('details', { class: 'call wire' }, h('summary', { text: `sent back as ${m.x.wire.length} of ${m.content.length} chars` }), h('pre', { text: m.x.wire })));
}

// Deterministic part, run right before a send. Anything left for the helper is done here too if the idle pass has not got to it.
async function edgeFold(s) {
  if (!s.edge || s.edge === 'off') return;
  for (const { m, i } of edgeReplies(s)) { const kept = markedOnly(m.content); if (kept) await setWire(s, i, kept); }
  if (s.edge === 'helper' && edgeReplies(s).length) await steward(s);
}

const STEWARD_SYSTEM = 'You condense records for other programs. The input is a list of items, each starting with a line "#n title" or "#n reply". For a title item, answer with a title of at most 6 words. For a reply item, answer with only the lines a later reader needs to continue the work: decisions, exact values, names, open questions; at most 8 short lines, no narration. You may put one word after the "#n" of a reply to say what it did: searched, verified, troubleshot, built, decided or answered. Output one block per item, each starting with its "#n" line, and nothing else.';

let stewarding = null, stewardTimer = 0;
const queueSteward = () => { clearTimeout(stewardTimer); stewardTimer = setTimeout(() => { if (!busy) steward(); }, 800); };

function steward(only) {
  return stewarding = (async () => {
    const set = state.meta.settings, items = [];
    if (!set.helper) return;
    for (const s of only ? [only] : Object.values(state.sessions)) {
      if (s.autoTitle && !s.parent && s.messages.length >= 2) items.push({ kind: 'title', s, text: s.messages.slice(0, 2).map(m => String(m.content || '').slice(0, 300)).join('\n') });
      if (s.edge === 'helper') for (const { m, i } of edgeReplies(s)) if (!markedOnly(m.content)) items.push({ kind: 'reply', s, i, text: m.content.slice(0, 8000) });
    }
    if (!items.length) return;
    const body = { model: set.helper, stream: true, messages: [{ role: 'system', content: STEWARD_SYSTEM }, { role: 'user', content: items.map((it, n) => `#${n + 1} ${it.kind}\n${it.text}`).join('\n\n') }] };
    let out = '', usage = null;
    try {
      for await (const ev of provider().stream(body, state.keys[set.provider], undefined, opt())) { if (ev.error) throw new Error(ev.error.message); if (ev.usage) usage = ev.usage; out += ev.choices?.[0]?.delta?.content || ''; }
    } catch (e) { console.warn('steward failed:', e); return; } // nothing is applied; replies go out whole
    let applied = 0;
    for (const block of out.split(/^#(?=\d+)/m).slice(1)) {
      const n = parseInt(block), it = items[n - 1], text = block.replace(/^\d+[^\n]*\n?/, '').trim();
      if (!it || !text) continue;
      if (it.kind === 'title') { it.s.autoTitle = false; retitle(it.s, text.split('\n')[0].slice(0, 60)); applied++; }
      else if (await setWire(it.s, it.i, text.slice(0, 1200), (/^\d+\s+(\w+)/.exec(block) || [])[1])) applied++;
    }
    (state.meta.steward ??= []).push(report({ t: Date.now(), model: set.helper, items: items.length, applied, sessions: new Set(items.map(it => it.s.id)).size }, usage));
    saveMeta();
    $('#tracen').textContent = trace.length + ' requests';
    overview();
  })();
}

// Every session side by side, from the ledgers alone: no message text.
function overview() {
  const row = s => {
    const fam = family(s), led = fam.flatMap(x => x.ledger), sum = k => led.reduce((n, e) => n + (Number(e[k]) || 0), 0);
    const prompt = sum('prompt'), condensed = fam.reduce((n, x) => n + x.messages.filter(m => m.x?.wire != null).length, 0);
    return h('tr', {}, h('td', {}, h('button', { type: 'button', 'data-goto': s.id, text: s.title.slice(0, 22) })),
      ...[fam.length - 1, led.length, s.ledger.at(-1)?.prompt ?? '-', prompt ? Math.round(100 * sum('cached') / prompt) + '%' : '-', condensed, edgeReplies(s).length, sum('cost').toFixed(4)].map(v => h('td', { text: String(v) })));
  };
  const tops = state.meta.order.map(id => state.sessions[id]).filter(s => !s.parent);
  $('#overview').replaceChildren(h('tr', {}, ...['session', 'branches', 'requests', 'context', 'cached', 'condensed', 'edge', '$'].map(t => h('th', { text: t }))), ...tops.map(row));
  const st = state.meta.steward || [];
  $('#stewardsum').textContent = st.length ? `steward: ${st.length} passes, ${st.reduce((n, e) => n + (e.applied || 0), 0)} items applied, ${st.reduce((n, e) => n + (e.prompt || 0), 0)} prompt tokens, $${st.reduce((n, e) => n + (Number(e.cost) || 0), 0).toFixed(5)}` : 'steward: no passes yet';
}

// Request > stream > tool calls > repeat, for one session.
// Returns 'done', 'failed' or 'limit'. onFirst fires on the first response event.
async function turns(s, depth, onFirst) {
  const set = state.meta.settings, p = provider(), key = state.keys[set.provider];
  const shown = () => s.id === state.meta.active;
  const ctx = {
    pads: state.meta.pads, savePads: () => { saveMeta(); renderPads(); },
    depth, fanOut: args => fanOut(s, args, ctx), branchRead,
    // attribution and reference checks come from the harness's view of the session
    by: () => ({ session: s.id, message: s.messages.length - 1, model: set.model, t: Date.now() }),
    knownRef: r => !!state.sessions[r] || s.messages.some(m => typeof m.content === 'string' && m.content.includes(r)),
    onPatterns: renderPatterns,
    helper: set.helper ? (want, text) => helper(s, want, text) : null,
    git: s.tools?.includes('repo') ? gitClient({ token: () => state.keys.github, trace, get, confirm: what => approve(s, what) }) : null,
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const body = buildRequest(s, set.model, defsFor(s));
    s.sent = s.messages.length; // everything in the log has now gone out; its wire form is fixed
    const entry = measure(s.id, body);
    if (shown()) { $('#req').textContent = JSON.stringify(body, null, 2); $('#events').textContent = ''; }

    const live = h('article', { class: 'msg', 'data-role': 'assistant', 'data-live': '' });
    const think = h('div', { class: 'think' }), txt = h('div', { class: 'txt' });
    live.append(think, txt);
    thread(s).append(live);
    const acc = { content: '', reasoning: '', calls: [], usage: null };
    let failure = null;
    try {
      for await (const ev of p.stream(body, key, ctl?.signal, opt())) {
        if (onFirst) { onFirst(); onFirst = null; }
        if (shown()) $('#events').append(JSON.stringify(ev) + '\n');
        if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
        if (ev.usage) acc.usage = ev.usage;
        const d = ev.choices?.[0]?.delta;
        if (!d) continue;
        if (d.reasoning) { acc.reasoning += d.reasoning; think.append(d.reasoning); }
        if (d.content) { acc.content += d.content; txt.append(d.content); if (shown()) scrollDown(); }
        for (const tc of d.tool_calls || []) {
          const c = acc.calls[tc.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.function.name ||= tc.function.name;
          if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
        }
      }
    } catch (e) { failure = e; }
    live.remove();
    $('#tracen').textContent = trace.length + ' requests';

    const calls = failure ? [] : acc.calls.filter(Boolean); // drop half-streamed calls
    if (acc.content || calls.length) {
      // Long arguments leave the log here, once, before the message is stored:
      // the log keeps {ref, name} and the full text sits in the output store.
      for (const c of calls) {
        if (!SWAPPABLE.has(c.function.name) || c.function.arguments.length <= ARG_MAX) continue;
        let a;
        try { a = JSON.parse(c.function.arguments); } catch { continue; }
        // what the call was looking for stays inline: it is the hint the next turns read
        c.function.arguments = JSON.stringify({ ref: await put(c.function.arguments), name: String(a.name || a.title || '').slice(0, 60) || undefined, want: a.want ? String(a.want).slice(0, 160) : undefined });
      }
      const m = { role: 'assistant', content: acc.content || null };
      if (calls.length) m.tool_calls = calls;
      m.x = { model: set.model, usage: acc.usage };
      if (acc.reasoning) m.x.reasoning = acc.reasoning;
      push(s, m);
    }
    s.ledger.push(report(entry, acc.usage));
    saveSession(s);
    if (shown()) $('#ledger tbody').append(ledgerRow(entry, s.ledger.length - 1));
    ledgerSum();

    if (failure) { if (failure.name !== 'AbortError') notice(s, String(failure.message || failure)); return 'failed'; }
    if (!calls.length) {
      if (s.wire === 'notes' && imitatesNote(acc.content)) {
        pat.trailAdd({ t: Date.now(), ...ctx.by(), tool: 'imitated_note', shape: 'imitated', ok: false, chars: acc.content.length, ms: 0 });
        notice(s, 'The reply wrote a call note as text instead of calling the tool, so nothing ran. This is the known risk of the "notes" log form.');
      }
      return 'done';
    }
    if (depth && s.ledger.reduce((n, e) => n + (e.prompt || 0) + (e.completion || 0), 0) > (Number(set.branchBudget) || BRANCH_BUDGET)) {
      notice(s, 'Branch token budget reached; stopped before running more tools.');
      return 'budget';
    }
    for (const tc of calls) {
      ctx.audit = null;
      const m = { role: 'tool', tool_call_id: tc.id, content: await execTool(tc, ctx) };
      if (ctx.audit) m.x = { audit: ctx.audit };
      push(s, m);
    }
  }
  notice(s, `Stopped after ${MAX_STEPS} tool rounds.`);
  return 'limit';
}

// ---------- helper model ----------
// A small model that reads a long tool output and returns only what the caller
// said it wanted. Its requests are traced and get their own ledger rows.

const HELPER_SYSTEM = 'You filter tool output for another program. You are given WANT and OUTPUT. Reply with only the parts of OUTPUT that answer WANT: at most 12 short lines, values copied exactly, no commentary. If OUTPUT does not contain it, reply exactly: not found';

async function helper(s, want, text) {
  const set = state.meta.settings, p = provider();
  const body = { model: set.helper, messages: [{ role: 'system', content: HELPER_SYSTEM }, { role: 'user', content: `WANT: ${want}\n\nOUTPUT:\n${text.slice(0, 60000)}` }], stream: true };
  let out = '', usage = null;
  for await (const ev of p.stream(body, state.keys[set.provider], ctl?.signal, opt())) {
    if (ev.error) throw new Error(ev.error.message || 'helper failed');
    if (ev.usage) usage = ev.usage;
    out += ev.choices?.[0]?.delta?.content || '';
  }
  const entry = report({ t: Date.now(), model: set.helper, helper: true, chars: text.length, kept: null, prevChars: null }, usage);
  s.ledger.push(entry);
  saveSession(s);
  if (s.id === state.meta.active) $('#ledger tbody').append(ledgerRow(entry, s.ledger.length - 1));
  $('#tracen').textContent = trace.length + ' requests';
  return out.trim();
}

// ---------- branch and fold ----------
//
// A branch is a session that starts as a byte-identical copy of its source's
// log up to a cut, plus one message naming a concern. Its turns stay in the
// branch. Only its fold (the final message, in a fixed shape) goes back to the
// source, appended as a new message: the source's earlier bytes never change.

// Markers are single lines, never wrappers: every tag pair would be paid for on every later turn.
const FOLD_SHAPE = 'End with only these four lines: OUTCOME (done, partial or failed), RESULT, EVIDENCE (exact values needed to act), OPEN. No account of steps.';

const foldTag = (id, text, branch, did = '') => `fold ${id}${branch ? ' ' + branch : ''}${did}:\n${text}`;

// The harness's own record of a branch: counted from its log and ledger.
function auditOf(b, concern, status) {
  const names = {};
  for (const m of b.messages.slice(b.parent.at)) for (const t of m.tool_calls || []) names[t.function.name] = (names[t.function.name] || 0) + 1;
  const sum = k => b.ledger.reduce((n, e) => n + (Number(e[k]) || 0), 0);
  return { concern, branch: b.id, status, requests: b.ledger.length, tools: Object.entries(names).map(([k, n]) => `${k}:${n}`).join(' '), prompt: sum('prompt'), cached: sum('cached'), cost: sum('cost') };
}
const concernMessage = (id, task, deps = '') => `concern ${id}: ${task}\n${deps ? deps + '\n' : ''}${FOLD_SHAPE}`;

function fork(source, id, cut) {
  const b = newSession({
    title: '↳ ' + id, system: source.system, tools: source.tools, wire: source.wire, keep: source.keep, core: source.core, edge: source.edge, sent: Math.min(source.sent || 0, cut), padSeen: { ...source.padSeen },
    parent: { id: source.id, at: cut, concern: id },
    messages: structuredClone(source.messages.slice(0, cut)),
  });
  inherit(b.id, source.id);
  ($$(`#sessions [data-parent="${source.id}"]`).at(-1) || $(`#sessions [data-id="${source.id}"]`)).after(sessionRow(b));
  return b;
}

const foldOf = (b, status, task) => {
  const m = b.messages.at(-1);
  if (status === 'done' && m?.role === 'assistant' && m.content) return m.content.length > FOLD_MAX ? m.content.slice(0, FOLD_MAX) + '\n[truncated; see branch_read]' : m.content;
  return `OUTCOME: failed\nRESULT: the branch ended without a fold (${status})\nEVIDENCE: none\nOPEN: ${task}`;
};

// The fan_out tool. Concerns with no unmet `after` run together as a wave; the
// next wave gets the folds it depends on. The very first branch goes out alone
// until its response starts, so its siblings can read the cache it writes.
async function fanOut(source, args, ctx) {
  const list = (Array.isArray(args?.concerns) ? args.concerns : [])
    .filter(c => c && typeof c.id === 'string' && typeof c.task === 'string').slice(0, MAX_BRANCHES);
  if (!list.length) return 'No valid concerns. Each needs {id, task}.';
  if (new Set(list.map(c => c.id)).size !== list.length) return 'Concern ids must be unique.';
  // The source log ends with the assistant message that made this call. Branches
  // fork just before it: exactly the bytes of the source's last request.
  const cut = source.messages.length - 1;
  const folds = new Map(), branches = new Map(), audits = new Map(), pending = new Map(list.map(c => [c.id, c]));
  let warm = null;
  const work = async (c, first) => {
    const deps = (c.after || []).filter(id => folds.has(id)).map(id => foldTag(id, folds.get(id))).join('\n\n');
    const b = fork(source, c.id, cut);
    branches.set(c.id, b.id);
    push(b, { role: 'user', content: concernMessage(c.id, c.task, deps) });
    let status;
    if (first) {
      let go;
      warm = new Promise(r => go = r);
      try { status = await turns(b, 1, go); } finally { go(); }
    } else { await warm; status = await turns(b, 1); }
    folds.set(c.id, foldOf(b, status, c.task));
    audits.set(c.id, auditOf(b, c.id, status));
  };
  let started = false;
  while (pending.size) {
    const wave = [...pending.values()].filter(c => (c.after || []).every(id => !pending.has(id)));
    if (!wave.length) { for (const c of pending.values()) folds.set(c.id, `OUTCOME: failed\nRESULT: dependency cycle in "after"\nEVIDENCE: none\nOPEN: ${c.task}`); break; }
    for (const c of wave) pending.delete(c.id);
    await Promise.all(wave.map((c, i) => work(c, !started && i === 0)));
    started = true;
  }
  ctx.audit = list.map(c => audits.get(c.id)).filter(Boolean);
  // The fold's attributes are harness-recorded facts; its body is the branch's own words.
  return list.map(c => {
    const a = audits.get(c.id);
    return foldTag(c.id, folds.get(c.id), branches.get(c.id), a ? ` ${a.requests}req${a.tools ? ' ' + a.tools : ''}` : '');
  }).join('\n\n');
}

// ---------- fold the session (new epoch) ----------
// The source is never edited. Its pocket is written by a branch (so the request
// reads the cached prefix), and a new session starts from the pocket alone.

const POCKET_REQUEST = 'Write the pocket that replaces this conversation for whoever continues the work: at most 30 lines under the headings Goal, Settled (decisions with exact values, ids, handles), Worked, Do not retry, Open. Omit empty headings. Drop exploration, retries and narration.';

// Rough cost case for folding now, from the last request and the catalogue prices.
function foldCase(s) {
  const now = s.ledger.at(-1)?.prompt || Math.ceil(JSON.stringify(s.messages).length / 4);
  const after = Math.ceil((s.system.length + JSON.stringify(defsFor(s)).length) / 4) + 600;
  const m = catalogue.find(m => m.id === state.meta.settings.model);
  const pin = Number(m?.pricing.prompt) || 0, pc = m?.pricing.input_cache_read != null ? Number(m.pricing.input_cache_read) : pin, pout = Number(m?.pricing.completion) || 0;
  const saving = (now - after) * pc, cost = now * pc + 600 * pout + after * (pin - pc);
  let text = `Context is about ${now.toLocaleString()} tokens; after folding, about ${after.toLocaleString()}.`;
  if (now <= after) text += '\nThere is nothing to gain yet.';
  else if (pin) text += `\nEach later turn saves about $${saving.toFixed(5)}. The fold costs about $${cost.toFixed(5)}, so it pays for itself after about ${Math.ceil(cost / saving)} turns.`;
  else text += '\nNo price data for this model, so the break-even is unknown.';
  return text;
}

function branchRead({ branch }) {
  const b = state.sessions[branch];
  if (!b?.parent) return `No branch "${branch}".`;
  const out = JSON.stringify(b.messages.slice(b.parent.at).map(m => ({ role: m.role, content: m.content, calls: m.tool_calls?.map(t => t.function) })));
  return out.length > 6000 ? out.slice(0, 6000) + '\n[truncated]' : out;
}

// ---------- wiring ----------

const download = (name, obj) => {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const actions = {
  trace() { download('webharness-' + new Date().toISOString().replace(/[:.]/g, '-') + '.trace', { kind: 'webharness.trace', version: 1, build: VERSION, exchanges: trace, trail: pat.trail() }); },
  new() { const s = newSession({ keep: true, core: 2, edge: 'marks', ...(state.keys.github ? { tools: ['repo'] } : {}) }); $('#sessions').prepend(sessionRow(s)); activate(s.id); $('#input').focus(); },
  import() { $('#file').click(); },
  async export() {
    const s = cur(), bundle = exportBundle(s), blobs = {};
    // carry the stored outputs these sessions cite, so handles still resolve after import
    for (const hd of new Set(bundle.sessions.flatMap(x => x.messages.flatMap(m => [...handlesIn(m.content), ...handlesIn(m.x?.wire), ...(m.tool_calls || []).flatMap(t => handlesIn(t.function.arguments))])))) { const t = await get(hd).catch(() => null); if (t != null) blobs[hd] = t; }
    if (Object.keys(blobs).length) bundle.blobs = blobs;
    if (pat.all().length) bundle.patterns = pat.all();
    download((s.title.replace(/[^\w\- ]+/g, '').trim() || 'session') + '.session', bundle);
  },
  async ghcheck() {
    const who = $('#ghwho');
    who.textContent = 'checking…';
    try { who.textContent = 'signed in as ' + await gitClient({ token: () => state.keys.github, trace }).whoami(); }
    catch (e) { who.textContent = e.message; }
  },
  inspector() { state.meta.settings.inspector = !state.meta.settings.inspector; saveMeta(); applyInspector(); },
  stop() { ctl?.abort(); },
  pane(el) { setPane(el.dataset.pane); saveMeta(); },
  'pat-drop'(el) { pat.drop(el.closest('[data-pat]').dataset.pat); renderPatterns(); },
  'card-drop'(el) { el.closest('.card').remove(); },
  async epoch() {
    const src = cur();
    if (busy || !src.messages.length) return;
    // Lines the model marked with ! are the pocket: no request, no cost. Otherwise a branch writes one.
    const kept = keptLines(src);
    if (!confirm('Fold this session into a new one? The original stays as it is.\n\n' + foldCase(src) + (kept.length ? `\n\n${kept.length} marked lines will be carried over; no model request is needed.` : '\n\nNo marked lines, so the model will be asked to write the pocket.'))) return;
    let pocket = kept.join('\n');
    if (!pocket) {
      const b = fork(src, 'pocket', src.messages.length);
      push(b, { role: 'user', content: POCKET_REQUEST });
      const status = await run(b), m = b.messages.at(-1);
      if (status !== 'done' || m?.role !== 'assistant' || !m.content) return notice(src, 'The pocket was not written; nothing was folded.');
      pocket = m.content;
    }
    const epoch = (src.epoch || 1) + 1;
    const n = newSession({ title: src.title.replace(/ · epoch \d+$/, '') + ' · epoch ' + epoch, system: src.system, tools: src.tools, wire: src.wire, keep: src.keep, core: src.core, edge: src.edge, epoch, from: src.id });
    $('#sessions').prepend(sessionRow(n));
    push(n, { role: 'user', content: 'Pocket:\n' + pocket });
    activate(n.id);
  },
  // Manual branch: the message box text becomes the concern.
  async branch() {
    const src = cur(), task = $('#input').value.trim();
    if (busy) return;
    if (!task) return notice(src, 'Type the concern for the branch in the message box first.');
    $('#input').value = '';
    const b = fork(src, task.slice(0, 30), src.messages.length);
    activate(b.id);
    push(b, { role: 'user', content: concernMessage(b.parent.concern, task) });
    await run(b);
  },
  // Manual fold: appended to the source, which is not run, so several folds can be batched before the next send.
  foldback() {
    const b = cur(), src = state.sessions[b.parent?.id];
    if (busy || !src) return;
    const m = b.messages.at(-1);
    if (m?.role !== 'assistant' || !m.content) return notice(b, 'Nothing to fold: the branch has no final reply yet.');
    if (b.folded && !confirm('This branch was already folded back. Append it again?')) return;
    b.folded = true;
    saveSession(b);
    push(src, { role: 'user', content: foldTag(b.parent.concern, foldOf(b, 'done', ''), b.id) });
    activate(src.id);
  },
  models() { loadModels(true); },
  drop(el) {
    const id = el.closest('[data-id]').dataset.id;
    if (busy || !confirm(`Delete "${state.sessions[id].title}"? This cannot be undone.`)) return;
    const gone = dropSession(id);
    for (const x of gone) { $(`#sessions [data-id="${x}"]`)?.remove(); $(`.thread[data-session="${x}"]`)?.remove(); }
    if (gone.includes(state.meta.active)) state.meta.order.length ? activate(state.meta.order[0]) : actions.new();
  },
  'pad-add'() { state.meta.pads.push({ id: uid('p'), label: 'pad ' + (state.meta.pads.length + 1), text: '', include: false }); saveMeta(); renderPads(); },
  'pad-drop'(el) { const id = el.closest('[data-pad]').dataset.pad; state.meta.pads = state.meta.pads.filter(p => p.id !== id); saveMeta(); renderPads(); },
};

function bind() {
  app.addEventListener('click', e => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const text = copy.dataset.copy === 'code' ? copy.closest('figure').querySelector('code').textContent : copy.closest('.msg')._raw;
      navigator.clipboard.writeText(text).then(() => { copy.textContent = 'copied'; setTimeout(() => copy.textContent = 'copy', 900); });
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      const card = [...stagebox(cur()).children].find(c => c._slot === chip._slot);
      setPane('stage');
      if (card) { card.scrollIntoView({ block: 'nearest' }); card.setAttribute('data-flash', ''); setTimeout(() => card.removeAttribute('data-flash'), 900); }
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) return state.sessions[go.dataset.goto] ? activate(go.dataset.goto) : undefined;
    const act = e.target.closest('[data-act]');
    if (act) return actions[act.dataset.act]?.(act);
    const row = e.target.closest('#sessions [data-id]');
    if (row) activate(row.dataset.id);
  });

  $('#composer').addEventListener('submit', e => { e.preventDefault(); const i = $('#input'); const v = i.value; if (busy || !v.trim()) return; i.value = ''; send(v); });
  $('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });

  $('#title').addEventListener('change', e => { const s = cur(); s.title = e.target.value || 'Untitled'; s.autoTitle = false; saveSession(s); $(`#sessions [data-id="${s.id}"] span`).textContent = s.title; });
  $('#system').addEventListener('change', e => { const s = cur(); s.system = e.target.value; saveSession(s); });
  $('#edge').addEventListener('change', e => { const s = cur(); s.edge = e.target.value; saveSession(s); showCore(); });
  $('#keep').addEventListener('change', e => { const s = cur(); s.keep = e.target.checked; saveSession(s); showCore(); });
  $('#wire').addEventListener('change', e => { const s = cur(); s.wire = e.target.value; saveSession(s); showCore(); });
  $('#model').addEventListener('change', e => { state.meta.settings.model = e.target.value.trim(); saveMeta(); showPrice(); });
  $('#model').addEventListener('input', showPicker);
  $('#model').addEventListener('focus', e => { e.target.select(); showPicker(); });
  $('#model').addEventListener('blur', () => app.removeAttribute('data-picking'));
  $('#model').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = state.meta.settings.model; e.target.blur(); }
    if (e.key === 'Enter') { const first = $('#picker .row[data-model]'); if (first) { e.preventDefault(); pickModel(first.dataset.model); e.target.blur(); } }
  });
  // mousedown, not click: the choice has to land before the input's blur closes the list
  $('#picker').addEventListener('mousedown', e => { const r = e.target.closest('[data-model]'); if (r) { e.preventDefault(); pickModel(r.dataset.model); $('#model').blur(); } });
  $('#provider').addEventListener('change', e => { state.meta.settings.provider = e.target.value; saveMeta(); $('#key').value = state.keys[e.target.value] || ''; showBase(); loadModels(); });
  $('#base').addEventListener('change', e => { (state.meta.settings.base ??= {})[state.meta.settings.provider] = e.target.value.trim(); saveMeta(); loadModels(); });
  $('#ghkey').addEventListener('change', e => { state.keys.github = e.target.value.trim(); saveKeys(); $('#ghwho').textContent = ''; });
  $('#key').addEventListener('change', e => { state.keys[state.meta.settings.provider] = e.target.value.trim(); saveKeys(); });
  $('#ref').addEventListener('change', e => { location.search = '?ref=' + encodeURIComponent(e.target.value.trim()); });

  $('#helper').addEventListener('change', e => { state.meta.settings.helper = e.target.value.trim(); saveMeta(); showPrice(); });
  $('#budget').addEventListener('change', e => { state.meta.settings.branchBudget = Number(e.target.value) || BRANCH_BUDGET; saveMeta(); });
  // html widgets report through postMessage; match the sender to its card
  addEventListener('message', e => {
    if (e.data?.wh !== 1) return;
    const f = $$('#stage iframe').find(f => f.contentWindow === e.source);
    if (f) widgetEvent(state.sessions[f.closest('.stagebox').dataset.session], f.closest('.card')._slot, e.data.data);
  });

  $('#pads').addEventListener('change', e => {
    const p = state.meta.pads.find(p => p.id === e.target.closest('[data-pad]')?.dataset.pad);
    const f = e.target.dataset.f;
    if (!p || !f) return;
    p[f] = f === 'include' ? e.target.checked : e.target.value;
    saveMeta();
  });

  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const added = importBundle(obj);
      for (const t of Object.values(obj.blobs || {})) await put(String(t));
      pat.merge(obj.patterns);
      renderPatterns();
      $('#sessions').replaceChildren(...rows());
      renderPads();
      const top = added.find(s => !s.parent) || added[0];
      if (top) activate(top.id);
    } catch (err) { alert('Import failed: ' + err.message); }
  });
}

// Sidebar rows: top-level sessions in order, each followed by its branches.
function rows() {
  const all = state.meta.order.map(id => state.sessions[id]);
  const under = s => [sessionRow(s), ...all.filter(x => x.parent?.id === s.id).reverse().flatMap(under)];
  return all.filter(s => !s.parent || !state.sessions[s.parent.id]).flatMap(under);
}

export function boot(env) {
  load(); // throws (and the shell shows why) if stored data is newer than this build
  app = $('#app');
  app.innerHTML = SHELL;
  $('#ver').textContent = 'v' + VERSION;
  $('#build').textContent = `build ${VERSION} · schema ${SCHEMA} · ${env.ref ? 'ref ' + env.ref : 'default branch'}`;
  $('#ref').value = env.ref;
  const set = state.meta.settings;
  $('#provider').append(...Object.entries(providers).map(([id, p]) => h('option', { value: id, text: p.label })));
  $('#provider').value = set.provider;
  $('#model').value = set.model;
  $('#key').value = state.keys[set.provider] || '';
  $('#ghkey').value = state.keys.github || '';
  $('#sessions').append(...rows());
  $('#budget').value = set.branchBudget || BRANCH_BUDGET;
  $('#helper').value = set.helper || '';
  setPane(set.pane || 'insp');
  showBase();
  renderPatterns();
  renderPads();
  applyInspector();
  bind();
  if (!state.sessions[state.meta.active]) state.meta.active = state.meta.order[0] || '';
  state.meta.active ? activate(state.meta.active) : actions.new();
  loadModels();
  const pair = bridge.pairing();
  if (pair) startBridge(pair, env).catch(e => console.error('bridge:', e));
}

// ---------- approvals for outward-facing writes ----------

// A repository write waits for a click. The card shows what will be written,
// built from the resolved changes, not from the model's description of them.
function approve(s, what) {
  link?.emit('approve', { session: s.id, what: { ...what, preview: undefined } });
  return new Promise(ok => {
    const card = h('article', { class: 'msg approve', 'data-role': 'approve' });
    const head = what.what === 'commit'
      ? `${what.repo} ${what.branch}${what.newBranchFrom ? ' (new, from ' + what.newBranchFrom + ')' : ''}\n${what.message}\n\n${what.files.join('\n')}`
      : `${what.repo} ${what.head} -> ${what.base}\n${what.title}\n\n${what.body}`;
    card.append(h('b', { text: what.what === 'commit' ? 'Commit to GitHub?' : 'Open a pull request?' }), h('pre', { text: head }));
    for (const f of what.preview || []) {
      const d = h('details', {}, h('summary', { text: f.path }), h('pre', { class: 'full', text: f.text.length > 20000 ? f.text.slice(0, 20000) + '\n…' : f.text }));
      card.append(d);
    }
    const yes = h('button', { text: 'allow' }), no = h('button', { text: 'deny' });
    const done = v => { yes.disabled = no.disabled = true; card.dataset.done = v ? 'allowed' : 'denied'; ok(v); };
    yes.onclick = () => done(true); no.onclick = () => done(false);
    card.append(h('div', { class: 'row' }, yes, no));
    thread(s).append(card);
    scrollDown();
  });
}

// ---------- debug bridge (bridge.js) ----------

const BRIDGE_ACTS = new Set(['new', 'inspector']);
async function startBridge(pair, env) {
  const set = state.meta.settings;
  const hello = () => ({ build: VERSION, schema: SCHEMA, ref: env.ref || '', url: location.origin + location.pathname, ua: navigator.userAgent, provider: set.provider, model: set.model, helper: set.helper || '', sessions: state.meta.order.length });
  const lastReply = s => { const m = [...s.messages].reverse().find(m => m.role === 'assistant'); return m?.content || ''; };
  link = await bridge.start(pair, {
    trace, hello, token: () => state.keys.github,
    secrets: () => Object.values(state.keys),
    gated: new Set(['send', 'set', 'reload']),
    directives: {
      ping: hello,
      state: () => ({ active: state.meta.active, busy, settings: { ...set }, sessions: state.meta.order.map(id => { const s = state.sessions[id]; return { id, title: s.title, parent: s.parent?.id || null, messages: s.messages.length, ledger: s.ledger?.length || 0 }; }) }),
      session: ({ id }) => exportBundle(state.sessions[id || state.meta.active]),
      trace: ({ from = 0 }) => trace.slice(from),
      trail: () => pat.trail(),
      dom: ({ sel, html, max = 20 }) => [...document.querySelectorAll(sel)].slice(0, max).map(e => (html ? e.outerHTML : e.textContent).slice(0, 4000)),
      run: ({ code, timeout = 5000 }) => runJs({ code }, null, timeout),
      act: ({ name }) => { if (!BRIDGE_ACTS.has(name)) throw new Error('act allows: ' + [...BRIDGE_ACTS].join(' ')); actions[name](); return state.meta.active; },
      async send({ text, session }) {
        if (session) activate(session);
        await send(String(text || ''));
        return { session: state.meta.active, reply: lastReply(cur()), ledger: cur().ledger?.slice(-3) };
      },
      set({ provider, model, helper }) { // never base: that would move where the key is sent
        if (provider) set.provider = provider;
        if (model) { set.model = model; $('#model').value = model; }
        if (helper != null) { set.helper = helper; $('#helper').value = helper; }
        saveMeta();
        return { provider: set.provider, model: set.model, helper: set.helper };
      },
      reload({ ref }) { const u = new URL(location.href); ref ? u.searchParams.set('ref', ref) : u.searchParams.delete('ref'); setTimeout(() => location.assign(u), 300); return { to: u.search }; },
    },
    banner() {
      const b = h('div', { id: 'bridgebar' }, h('b', { text: 'Debug bridge on' }),
        h('span', { class: 'note', text: 'Sends errors, notices, traces and what the paired agent asks for, encrypted. Never the keys.' }),
        h('span', { class: 'note', 'data-bstat': '' }), h('span', { 'data-bask': '' }), h('button', { 'data-bend': '', text: 'end' }));
      document.body.append(b);
      return b;
    },
    ask(text) {
      const slot = $('#bridgebar [data-bask]');
      return new Promise(ok => {
        const yes = h('button', { text: 'allow' }), no = h('button', { text: 'deny' });
        const done = v => { slot.replaceChildren(); ok(v); };
        yes.onclick = () => done(true); no.onclick = () => done(false);
        slot.replaceChildren(h('span', { text: text + ' ' }), yes, no);
      });
    },
  });
}
