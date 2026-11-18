// Controller and DOM. Rendering is append-only: a message node is created once
// and never rebuilt. Which session is visible, row highlight and panel state are
// expressed as style rules (styles.js), not by touching the nodes.

import { state, load, saveMeta, saveSession, saveKeys, newSession, dropSession, exportBundle, importBundle, uid } from './store.js';
import { SCHEMA } from './migrate.js';
import { rule } from './styles.js';
import { providers } from './providers.js';
import { toolDefs, execTool } from './tools.js';
import { buildRequest, measure, report, padAttachment } from './context.js';

export const VERSION = '0.1.0';
const MAX_STEPS = 8; // model <-> tool round trips per user turn

const $ = (s, r = document) => r.querySelector(s);
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
  <details open><summary>Settings</summary>
    <label>API key (kept in this browser only, never exported)</label>
    <input id="key" type="password" autocomplete="off">
    <label>Pinned code ref (tag, branch or commit; empty = this branch)</label>
    <input id="ref" placeholder="e.g. v0.1.0">
    <p class="note" id="build"></p>
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
  </details>
  <details><summary>Last request</summary><pre id="req"></pre></details>
  <details><summary>Stream events</summary><pre id="events"></pre></details>
</aside>`;

let app, busy = false, ctl = null;
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

function widget(args) {
  let a = {};
  try { a = JSON.parse(args); } catch {}
  // sandbox without allow-same-origin: the widget cannot read this page or its storage
  return h('figure', { class: 'widget' },
    h('figcaption', { text: a.title || 'widget' }),
    h('iframe', { sandbox: 'allow-scripts', srcdoc: String(a.html || '') }));
}

function messageNode(m) {
  const el = h('article', { class: 'msg', 'data-role': m.role });
  if (m.x?.reasoning) el.append(h('div', { class: 'think', text: m.x.reasoning }));
  if (m.role === 'tool') {
    el.append(h('details', { class: 'call' }, h('summary', { text: 'result ' + m.tool_call_id }), h('pre', { text: m.content })));
  } else if (m.content) el.append(...blocks(m.content));
  for (const tc of m.tool_calls || []) {
    el.append(h('details', { class: 'call' }, h('summary', { text: `call ${tc.function.name} (${tc.id})` }), h('pre', { text: tc.function.arguments })));
    if (tc.function.name === 'show_widget') el.append(widget(tc.function.arguments));
  }
  if (m.content) el.append(h('button', { class: 'copy', 'data-copy': 'msg', type: 'button', text: 'copy' }));
  el._raw = m.content || '';
  return el;
}

function thread(s) {
  let t = $(`.thread[data-session="${s.id}"]`);
  if (!t) {
    t = h('section', { class: 'thread', 'data-session': s.id });
    t.append(...s.messages.map(messageNode));
    $('#threads').append(t);
  }
  return t;
}

const scrollDown = () => { const t = $('#threads'); t.scrollTop = t.scrollHeight; };

function push(s, m) {
  s.messages.push(m);
  saveSession(s);
  thread(s).append(messageNode(m));
  scrollDown();
}

const notice = (s, text) => { thread(s).append(h('article', { class: 'msg', 'data-role': 'error' }, h('div', { class: 'txt', text }))); scrollDown(); };

// ---------- sidebar, ledger, pads ----------

function sessionRow(s) {
  return h('div', { 'data-id': s.id }, h('span', { text: s.title }), h('button', { 'data-act': 'drop', type: 'button', title: 'Delete session', text: '×' }));
}

function ledgerRow(e, i) {
  const pct = e.kept == null ? '-' : Math.round(100 * e.kept / e.prevChars) + '%';
  const hit = e.kept == null ? '' : e.kept === e.prevChars ? 'full' : 'broken';
  const n = v => v == null ? '-' : String(v);
  return h('tr', {},
    h('td', { text: String(i + 1) }), h('td', { 'data-hit': hit, title: `${n(e.kept)} of ${n(e.prevChars)} chars; request ${e.chars} chars; ${e.model}`, text: pct }),
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
  rule('active', `.thread:not([data-session="${id}"]){display:none}\n#sessions [data-id="${id}"]{background:var(--sel)}`);
  $('#title').value = s.title;
  $('#system').value = s.system;
  $('#ledger tbody').replaceChildren(...s.ledger.map(ledgerRow));
  scrollDown();
}

function applyInspector() {
  rule('inspector', state.meta.settings.inspector ? '' : '#inspect{display:none}\n#app{grid-template-columns:var(--side) minmax(0,1fr)}');
}

async function loadModels() {
  try {
    const list = await provider().models(state.keys[state.meta.settings.provider]);
    $('#models').replaceChildren(...list.map(m => h('option', { value: m.id, label: m.name })));
  } catch (e) { $('#models').replaceChildren(); console.warn('model list failed:', e); }
}

// ---------- the turn loop ----------

async function send(text) {
  const s = cur();
  if (busy || !text.trim()) return;
  if (s.title === 'New session') {
    s.title = text.trim().slice(0, 40);
    $('#title').value = s.title;
    $(`#sessions [data-id="${s.id}"] span`).textContent = s.title;
  }
  push(s, { role: 'user', content: text + padAttachment(s, state.meta.pads) });
  await run(s);
}

async function run(s) {
  const set = state.meta.settings, p = provider(), key = state.keys[set.provider];
  if (!set.model) return notice(s, 'Choose a model first.');
  if (p.needsKey && !key) return notice(s, 'Add an API key in Settings first.');
  busy = true; app.setAttribute('data-busy', ''); ctl = new AbortController();
  const ctx = { pads: state.meta.pads, savePads: () => { saveMeta(); renderPads(); } };
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const body = buildRequest(s, set.model, toolDefs);
      const entry = measure(s.id, body);
      $('#req').textContent = JSON.stringify(body, null, 2);
      $('#events').textContent = '';

      const live = h('article', { class: 'msg', 'data-role': 'assistant', 'data-live': '' });
      const think = h('div', { class: 'think' }), txt = h('div', { class: 'txt' });
      live.append(think, txt);
      thread(s).append(live);
      const acc = { content: '', reasoning: '', calls: [], usage: null };
      let failure = null;
      try {
        for await (const ev of p.stream(body, key, ctl.signal)) {
          $('#events').append(JSON.stringify(ev) + '\n');
          if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
          if (ev.usage) acc.usage = ev.usage;
          const d = ev.choices?.[0]?.delta;
          if (!d) continue;
          if (d.reasoning) { acc.reasoning += d.reasoning; think.append(d.reasoning); }
          if (d.content) { acc.content += d.content; txt.append(d.content); scrollDown(); }
          for (const tc of d.tool_calls || []) {
            const c = acc.calls[tc.index ?? 0] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (tc.id) c.id = tc.id;
            if (tc.function?.name) c.function.name ||= tc.function.name;
            if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
          }
        }
      } catch (e) { failure = e; }
      live.remove();

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
      if (s.id === state.meta.active) $('#ledger tbody').append(ledgerRow(entry, s.ledger.length - 1));

      if (failure) { if (failure.name !== 'AbortError') notice(s, String(failure.message || failure)); return; }
      if (!calls.length) return;
      for (const tc of calls) push(s, { role: 'tool', tool_call_id: tc.id, content: await execTool(tc, ctx) });
    }
    notice(s, `Stopped after ${MAX_STEPS} tool rounds.`);
  } finally {
    busy = false; app.removeAttribute('data-busy'); ctl = null;
  }
}

// ---------- wiring ----------

const actions = {
  new() { const s = newSession(); $('#sessions').prepend(sessionRow(s)); activate(s.id); $('#input').focus(); },
  import() { $('#file').click(); },
  export() {
    const s = cur();
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(exportBundle(s), null, 1)], { type: 'application/json' })), download: (s.title.replace(/[^\w\- ]+/g, '').trim() || 'session') + '.session' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  inspector() { state.meta.settings.inspector = !state.meta.settings.inspector; saveMeta(); applyInspector(); },
  stop() { ctl?.abort(); },
  drop(el) {
    const id = el.closest('[data-id]').dataset.id;
    if (busy || !confirm(`Delete "${state.sessions[id].title}"? This cannot be undone.`)) return;
    dropSession(id);
    el.closest('[data-id]').remove();
    $(`.thread[data-session="${id}"]`)?.remove();
    if (state.meta.active === id) state.meta.order.length ? activate(state.meta.order[0]) : actions.new();
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
    const act = e.target.closest('[data-act]');
    if (act) return actions[act.dataset.act]?.(act);
    const row = e.target.closest('#sessions [data-id]');
    if (row) activate(row.dataset.id);
  });

  $('#composer').addEventListener('submit', e => { e.preventDefault(); const i = $('#input'); const v = i.value; if (busy || !v.trim()) return; i.value = ''; send(v); });
  $('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });

  $('#title').addEventListener('change', e => { const s = cur(); s.title = e.target.value || 'Untitled'; saveSession(s); $(`#sessions [data-id="${s.id}"] span`).textContent = s.title; });
  $('#system').addEventListener('change', e => { const s = cur(); s.system = e.target.value; saveSession(s); });
  $('#model').addEventListener('change', e => { state.meta.settings.model = e.target.value.trim(); saveMeta(); });
  $('#provider').addEventListener('change', e => { state.meta.settings.provider = e.target.value; saveMeta(); $('#key').value = state.keys[e.target.value] || ''; loadModels(); });
  $('#key').addEventListener('change', e => { state.keys[state.meta.settings.provider] = e.target.value.trim(); saveKeys(); });
  $('#ref').addEventListener('change', e => { location.search = '?ref=' + encodeURIComponent(e.target.value.trim()); });

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
      const added = importBundle(JSON.parse(await f.text()));
      for (const s of added) $('#sessions').prepend(sessionRow(s));
      renderPads();
      if (added[0]) activate(added[0].id);
    } catch (err) { alert('Import failed: ' + err.message); }
  });
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
  $('#sessions').append(...state.meta.order.map(id => sessionRow(state.sessions[id])));
  renderPads();
  applyInspector();
  bind();
  if (!state.sessions[state.meta.active]) state.meta.active = state.meta.order[0] || '';
  state.meta.active ? activate(state.meta.active) : actions.new();
  loadModels();
}
