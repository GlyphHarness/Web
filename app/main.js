// Controller and DOM. Rendering is append-only: a message node is created once
// and never rebuilt. Which session is visible, row highlight and panel state are
// expressed as style rules (styles.js), not by touching the nodes.

import { state, load, saveMeta, saveSession, saveKeys, newSession, dropSession, children, family, exportBundle, importBundle, uid } from './store.js';
import { SCHEMA } from './migrate.js';
import { rule } from './styles.js';
import { providers } from './providers.js';
import { toolDefs, execTool } from './tools.js';
import { render } from './widgets.js';
import { put, get, handlesIn } from './outstore.js';
import { buildRequest, measure, report, padAttachment, inherit } from './context.js';

export const VERSION = '0.5.0';
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
    <input id="model" list="models" placeholder="model id" aria-label="Model">
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
    <label>Pinned code ref (tag, branch or commit; empty = this branch)</label>
    <input id="ref" placeholder="e.g. v0.1.0">
    <label>API base URL (empty = provider default)</label>
    <input id="base" placeholder="">
    <label>Branch token budget (prompt + output, per fan_out branch)</label>
    <input id="budget" type="number" min="1000" step="1000">
    <p class="note" id="build"></p>
  </details>
  <details open><summary>Model</summary>
    <p class="note" id="pricenote"></p>
    <table id="price"></table>
    <button data-act="models">refresh list</button> <span class="note" id="modelsn"></span>
  </details>
  <details open><summary>System prompt</summary>
    <textarea id="system" rows="6"></textarea>
    <p class="note">First bytes of every request. Editing it mid-session breaks the cached prefix; the ledger will show it.</p>
  </details>
  <details><summary>Scratchpads</summary>
    <p class="note">"In context" pads are attached to your next message when new or changed.</p>
    <div id="pads"></div>
    <button data-act="pad-add">+ pad</button>
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

let app, busy = false, ctl = null;
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

function showWidget(s, tc) {
  let a = {};
  try { a = JSON.parse(tc.function.arguments); } catch {}
  if (!a.kind && a.html) a = { kind: 'html', title: a.title, data: { html: a.html } }; // calls stored before 0.5
  const slot = String(a.slot || tc.id), title = String(a.title || slot);
  const card = h('section', { class: 'card', 'data-kind': String(a.kind) },
    h('header', {}, h('b', { text: title }), h('span', { class: 'note', text: String(a.kind) }), h('button', { type: 'button', 'data-act': 'card-drop', title: 'Hide', text: '×' })),
    h('div', { class: 'body' }, render(a.kind, a.data, v => widgetEvent(s, slot, v))));
  card._slot = slot;
  const box = stagebox(s), old = [...box.children].find(c => c._slot === slot);
  old ? old.replaceWith(card) : box.prepend(card);
  const chip = h('button', { class: 'chip', type: 'button', text: '▣ ' + title });
  chip._slot = slot;
  return chip;
}

// A user interaction with a widget becomes a user message and a turn.
function widgetEvent(s, slot, value) {
  if (busy || !s || s.id !== state.meta.active) return;
  push(s, { role: 'user', content: `<widget_event slot=${JSON.stringify(slot)}>\n${(JSON.stringify(value) ?? 'null').slice(0, 4000)}\n</widget_event>` });
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
    el.append(h('details', { class: 'call' }, h('summary', { text: `call ${tc.function.name} (${tc.id})` }), h('pre', { text: tc.function.arguments })));
    if (tc.function.name === 'show_widget') el.append(showWidget(s, tc));
  }
  if (m.content) el.append(h('button', { class: 'copy', 'data-copy': 'msg', type: 'button', text: 'copy' }));
  el._raw = m.content || '';
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

const notice = (s, text) => { thread(s).append(h('article', { class: 'msg', 'data-role': 'error' }, h('div', { class: 'txt', text }))); scrollDown(); };

// ---------- sidebar, ledger, pads ----------

function sessionRow(s) {
  const attrs = { 'data-id': s.id };
  if (s.parent) attrs['data-parent'] = s.parent.id;
  return h('div', attrs, h('span', { text: s.title }), h('button', { 'data-act': 'drop', type: 'button', title: 'Delete session', text: '×' }));
}

function ledgerRow(e, i) {
  const pct = e.kept == null ? '-' : Math.round(100 * e.kept / e.prevChars) + '%';
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
  $('#ledger tbody').replaceChildren(...s.ledger.map(ledgerRow));
  s.parent ? app.setAttribute('data-branch', '') : app.removeAttribute('data-branch');
  ledgerSum();
  scrollDown();
}

// Totals for the visible session, and with its branches when it has any.
function ledgerSum() {
  const s = cur();
  if (!s) return;
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

function applyInspector() {
  rule('inspector', state.meta.settings.inspector ? '' : '#inspect{display:none}\n#app{grid-template-columns:var(--side) minmax(0,1fr)}');
}

// Model catalogue: fetched from the provider, cached per provider and base URL
// for a day under wh:models:<provider>. Prices are shown, never hardcoded.
const MODELS_TTL = 24 * 3600e3;
let catalogue = [], loadSeq = 0;

async function loadModels(force) {
  const id = state.meta.settings.provider, o = opt(), k = 'wh:models:' + id;
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

// [pricing key, label, multiplier, unit]. Token prices arrive as USD per token.
const PRICE_ROWS = [
  ['prompt', 'input', 1e6, '/ 1M tok'], ['input_cache_read', 'cached input', 1e6, '/ 1M tok'],
  ['input_cache_write', 'cache write', 1e6, '/ 1M tok'], ['completion', 'output', 1e6, '/ 1M tok'],
  ['internal_reasoning', 'reasoning', 1e6, '/ 1M tok'], ['web_search', 'web search', 1, '/ search'],
  ['input_cache_write_1h', 'cache write 1h', 1e6, '/ 1M tok'], ['request', 'request', 1, '/ request'],
];

function showPrice() {
  const m = catalogue.find(m => m.id === state.meta.settings.model);
  const rows = [];
  if (m) {
    const known = new Set(PRICE_ROWS.map(r => r[0]));
    for (const [k, label, mul, unit] of PRICE_ROWS) {
      const v = Number(m.pricing[k]);
      if (m.pricing[k] != null && v > 0) rows.push(h('tr', {}, h('td', { text: label }), h('td', { text: '$' + +(v * mul).toPrecision(4) + ' ' + unit })));
    }
    // anything the provider sends that this build has no label for is shown raw
    for (const [k, v] of Object.entries(m.pricing)) if (!known.has(k) && Number(v) > 0) rows.push(h('tr', {}, h('td', { text: k }), h('td', { text: String(v) + ' (raw)' })));
    if (m.ctx) rows.push(h('tr', {}, h('td', { text: 'context' }), h('td', { text: m.ctx.toLocaleString() + ' tok' })));
  }
  $('#price').replaceChildren(...rows);
  $('#pricenote').textContent = m ? m.id : state.meta.settings.model ? 'Not in the fetched list; no price data.' : 'No model chosen.';
}

// ---------- the turn loop ----------

async function send(text) {
  const s = cur();
  if (busy || !text.trim()) return;
  if (s.title === 'New session') retitle(s, text.trim().slice(0, 40));
  push(s, { role: 'user', content: text + padAttachment(s, state.meta.pads) });
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
  finally { busy = false; app.removeAttribute('data-busy'); ctl = null; }
}

// Request > stream > tool calls > repeat, for one session.
// Returns 'done', 'failed' or 'limit'. onFirst fires on the first response event.
async function turns(s, depth, onFirst) {
  const set = state.meta.settings, p = provider(), key = state.keys[set.provider];
  const shown = () => s.id === state.meta.active;
  const ctx = {
    pads: state.meta.pads, savePads: () => { saveMeta(); renderPads(); },
    depth, fanOut: args => fanOut(s, args, ctx), branchRead,
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const body = buildRequest(s, set.model, toolDefs);
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
    if (!calls.length) return 'done';
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

// ---------- branch and fold ----------
//
// A branch is a session that starts as a byte-identical copy of its source's
// log up to a cut, plus one message naming a concern. Its turns stay in the
// branch. Only its fold (the final message, in a fixed shape) goes back to the
// source, appended as a new message: the source's earlier bytes never change.

const FOLD_SHAPE = `When the work is finished, make your final message exactly this shape and nothing else:
OUTCOME: done | partial | failed
RESULT: what was found or produced, as tersely as accuracy allows
EVIDENCE: the specifics needed to act on it (values, names, short excerpts)
OPEN: what remains, or none
Do not recount the steps taken or tools used; that record is attached automatically.`;

const foldTag = (id, text, branch, did = '') => `<fold concern=${JSON.stringify(id)}${branch ? ` branch="${branch}"` : ''}${did}>\n${text}\n</fold>`;

// The harness's own record of a branch: counted from its log and ledger.
function auditOf(b, concern, status) {
  const names = {};
  for (const m of b.messages.slice(b.parent.at)) for (const t of m.tool_calls || []) names[t.function.name] = (names[t.function.name] || 0) + 1;
  const sum = k => b.ledger.reduce((n, e) => n + (Number(e[k]) || 0), 0);
  return { concern, branch: b.id, status, requests: b.ledger.length, tools: Object.entries(names).map(([k, n]) => `${k}:${n}`).join(' '), prompt: sum('prompt'), cached: sum('cached'), cost: sum('cost') };
}
const concernMessage = (id, task, deps = '') => `<concern id=${JSON.stringify(id)}>\n${task}\n</concern>\n${deps ? deps + '\n' : ''}\n${FOLD_SHAPE}`;

function fork(source, id, cut) {
  const b = newSession({
    title: '↳ ' + id, system: source.system, padSeen: { ...source.padSeen },
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
    const deps = (c.after || []).filter(id => folds.has(id)).map(id => foldTag(id, folds.get(id))).join('\n');
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
    return foldTag(c.id, folds.get(c.id), branches.get(c.id), a ? ` requests="${a.requests}"${a.tools ? ` tool_calls="${a.tools}"` : ''}` : '');
  }).join('\n');
}

// ---------- fold the session (new epoch) ----------
// The source is never edited. Its pocket is written by a branch (so the request
// reads the cached prefix), and a new session starts from the pocket alone.

const POCKET_REQUEST = `<pocket_request>
Write the pocket that will replace this conversation for whoever continues the work. At most 30 lines, in these sections, omitting empty ones:
## Goal
## Settled (decisions, with exact values, ids and handles)
## Worked
## Do not retry (what failed, and when a retry would make sense)
## Open
Keep what is needed to act. Drop exploration, retries and narration.
</pocket_request>`;

// Rough cost case for folding now, from the last request and the catalogue prices.
function foldCase(s) {
  const now = s.ledger.at(-1)?.prompt || Math.ceil(JSON.stringify(s.messages).length / 4);
  const after = Math.ceil((s.system.length + JSON.stringify(toolDefs).length) / 4) + 600;
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
  trace() { download('webharness-' + new Date().toISOString().replace(/[:.]/g, '-') + '.trace', { kind: 'webharness.trace', version: 1, build: VERSION, exchanges: trace }); },
  new() { const s = newSession(); $('#sessions').prepend(sessionRow(s)); activate(s.id); $('#input').focus(); },
  import() { $('#file').click(); },
  async export() {
    const s = cur(), bundle = exportBundle(s), blobs = {};
    // carry the stored outputs these sessions cite, so handles still resolve after import
    for (const hd of new Set(bundle.sessions.flatMap(x => x.messages.flatMap(m => handlesIn(m.content))))) { const t = await get(hd).catch(() => null); if (t != null) blobs[hd] = t; }
    if (Object.keys(blobs).length) bundle.blobs = blobs;
    download((s.title.replace(/[^\w\- ]+/g, '').trim() || 'session') + '.session', bundle);
  },
  inspector() { state.meta.settings.inspector = !state.meta.settings.inspector; saveMeta(); applyInspector(); },
  stop() { ctl?.abort(); },
  pane(el) { setPane(el.dataset.pane); saveMeta(); },
  'card-drop'(el) { el.closest('.card').remove(); },
  async epoch() {
    const src = cur();
    if (busy || !src.messages.length) return;
    if (!confirm('Fold this session into a new one? The original stays as it is.\n\n' + foldCase(src))) return;
    const b = fork(src, 'pocket', src.messages.length);
    push(b, { role: 'user', content: POCKET_REQUEST });
    const status = await run(b), m = b.messages.at(-1);
    if (status !== 'done' || m?.role !== 'assistant' || !m.content) return notice(src, 'The pocket was not written; nothing was folded.');
    const epoch = (src.epoch || 1) + 1;
    const n = newSession({ title: src.title.replace(/ · epoch \d+$/, '') + ' · epoch ' + epoch, system: src.system, epoch, from: src.id });
    $('#sessions').prepend(sessionRow(n));
    push(n, { role: 'user', content: `<pocket from="${src.id}">\n${m.content}\n</pocket>` });
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

  $('#title').addEventListener('change', e => { const s = cur(); s.title = e.target.value || 'Untitled'; saveSession(s); $(`#sessions [data-id="${s.id}"] span`).textContent = s.title; });
  $('#system').addEventListener('change', e => { const s = cur(); s.system = e.target.value; saveSession(s); });
  $('#model').addEventListener('change', e => { state.meta.settings.model = e.target.value.trim(); saveMeta(); showPrice(); });
  $('#provider').addEventListener('change', e => { state.meta.settings.provider = e.target.value; saveMeta(); $('#key').value = state.keys[e.target.value] || ''; showBase(); loadModels(); });
  $('#base').addEventListener('change', e => { (state.meta.settings.base ??= {})[state.meta.settings.provider] = e.target.value.trim(); saveMeta(); loadModels(); });
  $('#key').addEventListener('change', e => { state.keys[state.meta.settings.provider] = e.target.value.trim(); saveKeys(); });
  $('#ref').addEventListener('change', e => { location.search = '?ref=' + encodeURIComponent(e.target.value.trim()); });

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
  $('#sessions').append(...rows());
  $('#budget').value = set.branchBudget || BRANCH_BUDGET;
  setPane(set.pane || 'insp');
  showBase();
  renderPads();
  applyInspector();
  bind();
  if (!state.sessions[state.meta.active]) state.meta.active = state.meta.order[0] || '';
  state.meta.active ? activate(state.meta.active) : actions.new();
  loadModels();
}
