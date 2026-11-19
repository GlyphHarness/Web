// Controller and DOM. Rendering is append-only: a message node is created once
// and never rebuilt. Which session is visible, row highlight and panel state are
// expressed as style rules (styles.js), not by touching the nodes.

import { state, load, saveMeta, saveSession, saveKeys, newSession, dropSession, children, family, exportBundle, importBundle, uid } from './store.js';
import { SCHEMA } from './migrate.js';
import { rule, slot, slotText } from './styles.js';
import { providers } from './providers.js';
import { defsFor, execTool, SWAPPABLE, ARG_MAX, runJs } from './tools.js';
import { client as gitClient } from './git.js';
import { auth as ghAuth, appJwt } from './ghauth.js';
import * as tokencheck from './tokencheck.js';
import * as cust from './custodial.js';
import * as fx from './explorer.js';
import { machine, vmWanted, vmReady } from './vm.js';
import { sharedMachine, MPROTO, stashed } from './vmhost.js';
import { coordinator, published } from './coord.js';
import * as termx from './term.js';
import * as H from './handles.js';
import * as ck from './checkpoints.js';
import * as strategies from './strategies.js';
import * as policy from './policy.js';
import * as smells from './smells.js';
import { logRepo } from './logrepo.js';
import * as asks from './ask.js';
import * as config from './config.js';
import * as metricsPanel from './metrics.js';
import * as panels from './panels.js';
import * as prof from './profiles.js';
import * as handoff from './handoff.js';
import * as vals from './values.js';
import * as bridge from './bridge.js';
import { render } from './widgets.js';
import * as theme from './theme.js';
import * as pat from './patterns.js';
import { put, get, handlesIn, setFallback } from './outstore.js';
import { buildRequest, measure, report, padAttachment, inherit, imitatesNote, keptLines, corePrompt, EDGE_MIN, markedOnly, edgeReplies, turnOf, KINDS } from './context.js';

export const VERSION = '0.54.0';
// This tab: an id kept for the tab's life (sessionStorage survives its reloads).
const TAB = (() => { const mk = () => 't' + Math.random().toString(36).slice(2, 8); try { let t = sessionStorage.getItem('wh:tab'); if (!t) sessionStorage.setItem('wh:tab', t = mk()); return t; } catch { return mk(); } })();
const QS = new URLSearchParams(location.search);
const MACHINE_TAB = QS.has('machine'); // a tab that only hosts the machine (never reloads for an update)
let co = null; // coord.js: halt, step, resume, update across tabs
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
    <input id="title" class="needs-session" aria-label="Session title">
    <select id="provider" aria-label="Provider"></select>
    <span id="modelbox"><input id="model" placeholder="model: type to filter" aria-label="Model" autocomplete="off"><div id="picker"></div></span>
    <datalist id="models"></datalist>
    <button data-act="export" class="needs-session">export .session</button>
    <button data-act="branch" class="needs-session" title="Fork this session at its tail to work the text in the message box as one concern">branch</button>
    <button data-act="stem" class="needs-session" title="Work the goal in the message box in a branch from the turn where it was stated; this session keeps only a handle the stem re-points as it goes">stem</button>
    <button data-act="epoch" class="needs-session" title="Replace this conversation with a short pocket in a new session">fold session</button>
    <button data-act="foldback" title="Append this branch's last reply to its source as a fold">fold back</button>
    <button data-act="inspector">inspector</button>
    <button class="qbar slot" id="queuebar" data-act="q-show" title="custodial queue"></button>
    <label class="pace" title="Hold model requests and/or tool calls until you release them">pace <select id="pace"><option value="run">run</option><option value="requests">hold model requests</option><option value="tools">hold tool calls</option><option value="both">hold both</option></select></label>
    <span id="coord" class="coord"><button data-act="haltall" title="Halt every session in every tab at its next gate (before a model request or tool call)">halt all</button><button data-act="stepall" title="Every halted session in every tab takes one step, then holds again" hidden>step</button><button data-act="resumeall" hidden>resume</button><span class="slot note" id="coordstat"></span><button id="updbtn" data-act="update" class="primary slot" hidden></button></span>
  </header>
  <p id="rohint" class="note" hidden><span class="slot" id="rotext"></span> <button data-act="takeover" type="button">run it here instead</button></p>
  <div id="threads"></div>
  <form id="composer">
    <textarea id="input" rows="3" placeholder="Message. Enter adds a line; the send button sends."></textarea>
    <button id="send">send</button>
    <button type="button" data-act="stop">stop</button>
  </form>
</main>
<aside id="inspect">
  <nav id="panes"><button data-act="pane" data-pane="stage">Stage</button><button data-act="pane" data-pane="insp">Inspector</button><button data-act="pane" data-pane="machine">Machine</button></nav>
  <div id="stage"></div>
  <div id="machine"><div id="vmdiag"></div><p class="note" id="vmstat"></p><div id="vmterm"></div></div>
  <div id="insp">
  <details open><summary>Profiles <span class="count" id="profcount"></span></summary>
    <p class="note">Scopes for sessions, by configuration level. A session in a profile resolves its settings down the chain (a locked setting cannot be overridden below), its capabilities only narrow, its repositories must be allowed at every level that lists them, and policies add up. Branches stay in their profile or one below it.</p>
    <details class="item needs-session" id="sessioncard" open>
      <summary><span class="chip">session</span><span class="name" id="sessname"></span><span class="meta" id="scopecount"></span></summary>
      <div class="body">
        <div class="row2"><label class="field"><span title="Only this profile or one below it. Changing it can change the tools, which breaks the cached prefix once.">profile (this one or below)</span><select id="sprofile"></select></label></div>
        <p class="note" id="sscope"></p>
        <div class="scope" id="scope"></div>
      </div>
      <div class="actions"><label class="check" title="Frozen: read-only; nothing can change this session's own settings"><input type="checkbox" id="smutable"> mutable</label><button data-act="cfgimport">import labels and values…</button></div>
    </details>
    <label>New sessions use</label>
    <select id="newprofile"></select>
    <div class="items" id="profiles"></div>
    <button data-act="prof-add">+ profile</button>
  </details>
  <details open><summary>Queue <span class="count" id="queuecount"></span></summary>
    <p class="note">Housekeeping the harness would do on the sessions' behalf waits here for you: what it is, what it touches, why it was queued, what it is for, what it should cost and how that is kept down. Nothing here runs on its own.</p>
    <div class="cfgbar"><button data-act="q-drain" class="primary">drain all</button><label class="field"><span>per-item budget (tokens; asks above it)</span><input id="qbudget" type="number" min="1000" step="1000"></label></div>
    <div class="items" id="queue"></div>
  </details>
  <details open><summary>Defaults and connections</summary>
    <div class="cfgbar"><button data-act="cfgimport">import</button><button data-act="cfgpaste">paste config</button><button data-act="cfgcopy">copy config</button></div>
    <label>API key (kept in this browser only, never exported)</label>
    <input id="key" type="password" autocomplete="off">
    <label>GitHub token (fine-grained, limited to the repos it may touch; kept in this browser only). New sessions get repository tools while one is set.</label>
    <div style="display:flex;gap:6px"><input id="ghkey" type="password" autocomplete="off"><button data-act="ghcheck">check</button></div>
    <details class="sub"><summary>or a GitHub App (mints a one-hour token per repository and permission)</summary>
      <label>App ID</label><input id="ghappid" autocomplete="off">
      <label>Private key (.pem, as downloaded)</label><textarea id="ghpem" rows="3" spellcheck="false" placeholder="-----BEGIN RSA PRIVATE KEY-----"></textarea>
      <p class="note">When both are set the app is used and the token above is ignored.</p>
    </details>
    <label>Label for this access, told to the model in new sessions (e.g. "fine-grained token: one repo, contents + PRs")</label>
    <input id="ghlabel" autocomplete="off">
    <p class="note" id="ghwho"></p>
    <details class="sub" id="ghintentbox"><summary>intended use of this credential <span class="note" id="ghscopes"></span></summary>
      <p class="note">One line per repository or pattern and what it needs (read or write). Filled from the configuration (log repos, profile allowlists); edit freely. The check compares this with what the credential can actually do, using plain API calls.</p>
      <textarea id="ghintent" rows="3" class="mono" spellcheck="false" placeholder="owner/name write&#10;owner/* read"></textarea>
      <label class="check"><input type="checkbox" id="ghpulls"> opens pull requests</label>
      <label class="check"><input type="checkbox" id="ghcreate"> creates repositories</label>
      <label class="check"><input type="checkbox" id="ghprobe"> probe write access (creates an unreferenced blob in each repo that needs write; no commit, no branch change)</label>
      <div class="cfgbar"><button data-act="ghderive">fill from configuration</button><button data-act="ghscopes" class="primary">check scopes</button></div>
    </details>
    <label><input type="checkbox" id="vmauto"> start the Linux machine when the page loads</label>
    <label><input type="checkbox" id="vmon"> Linux machine: a <code>shell</code> tool for new sessions (bash, git, python3, gh). Downloads the image once; switching this reloads the page to turn cross-origin isolation on or off.</label>
    <label>Log repo: a private repo of yours where the harness keeps tracking over time (owner/name). Only the harness writes to it; agents can read it.</label>
    <div style="display:flex;gap:6px"><input id="logrepo" placeholder="owner/name" autocomplete="off"><button data-act="logsetup">set up</button><button data-act="logsync">sync</button></div>
    <p class="note" id="logstat"></p>
    <label>Concerns repository (issues labelled "concern"; empty = the repo this page is served from)</label>
    <div style="display:flex;gap:6px"><input id="concernrepo" placeholder="owner/name" autocomplete="off"><button data-act="concern">file a concern…</button></div>
    <label><input type="checkbox" id="logtx"> Keep session transcripts and the outputs and media they cite in the log repo (branch wh-sessions; masked; read progressively)</label>
    <button data-act="logbrowse">browse transcripts</button>
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
  <details class="needs-session"><summary>Values <span class="count" id="valcount"></span></summary>
    <p class="note">Named values in this session's scope: its own, its profile chain's and settings-wide ones. Every change is a new revision; hiding is one too. The model is told each value's label and purpose (and the value, if visible) once, when it is new or changed; notes are never sent.</p>
    <div class="items" id="values"></div>
    <button data-act="val-add">+ value</button>
  </details>
  <details><summary>Policies <span class="count" id="polcount"></span></summary>
    <p class="note">Checked before every tool call. A call that breaks one is repaired by the policy model from the policy and the call alone, re-checked, and runs as repaired; the original stays visible. The pattern is matched against the call's arguments as JSON.</p>
    <div class="items" id="policies"></div>
    <datalist id="toolnames"></datalist>
    <button data-act="pol-add">+ policy</button>
    <label>Policy model (empty = helper model, else the session's model)</label>
    <input id="polmodel" list="models" placeholder="a small, cheap model id">
  </details>
  <details><summary>Smells <span class="count" id="smellcount"></span></summary>
    <p class="note">Policy rewrites and refusals, call notes written as text, tool errors and timeouts, recorded as they happen with the steering in effect (core prompt, system prompt, policies, tools), across sessions. Nothing changes mid-session. "review" asks the policy model for steering changes from these counts alone; adopted ones are yours to apply, and reach new sessions only.</p>
    <div id="smells"></div>
    <button data-act="review">review</button> <button data-act="smellsclear">clear</button>
  </details>
  <details><summary id="pricesum">Models</summary>
    <p class="note">Collapsed line: input / cached input / output, per 1M tokens.</p>
    <table id="price"></table>
    <button data-act="models">refresh list</button> <span class="note" id="modelsn"></span>
  </details>
  <details open class="needs-session"><summary>System prompt</summary>
    <label>Core prompt (sent first; follows the two settings below)</label>
    <pre id="core"></pre>
    <label>Your system prompt</label>
    <textarea id="system" rows="6"></textarea>
    <label>How past tool calls are sent</label>
    <select id="wire"><option value="calls">calls: structured, as the model made them</option><option value="notes">notes: one text line per call, results as text</option></select>
    <label>Replies, when first sent back to the model</label>
    <select id="edge"><option value="off">off: sent whole</option><option value="marks">marks: a long reply with "!" lines is sent as those lines</option><option value="helper">helper: marks, else condensed by the helper model</option></select>
    <label><input type="checkbox" id="sprivate"> Keep this session out of the log repo (no transcript, no artifacts)</label>
    <label><input type="checkbox" id="repotools"> Repository tools (repo_read, repo_commit, repo_pr, repo_create; needs GitHub access in Settings). Turning this on or off changes the tool list, which breaks the cached prefix once.</label>
    <label><input type="checkbox" id="vmtools"> Linux machine (shell tool). Changes the tool list, which breaks the cached prefix once.</label>
    <label><input type="checkbox" id="keep"> Keep marks: the model flags lines to keep with "!" (adds one sentence to the system prompt)</label>
    <p class="note">First bytes of every request. Editing it mid-session breaks the cached prefix; the ledger will show it.</p>
  </details>
  <details><summary>Scratchpads <span class="count" id="padcount"></span></summary>
    <p class="note">"In context" pads are attached to your next message when new or changed.</p>
    <div class="items" id="pads"></div>
    <button data-act="pad-add">+ pad</button>
  </details>
  <details><summary>Patterns <span class="count" id="patcount"></span></summary>
    <p class="note">Solutions, gotchas and recipes the model stored, with where each came from. The trail is one automatic row per tool call.</p>
    <div class="items" id="patterns"></div>
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

let app, busy = false, ctl = null, link = null, runningId = null;
const trace = []; // raw request/response records, memory only
const gh = ghAuth(() => state.keys, trace); // mint and lookup calls appear in the trace, tokens masked
const opt = () => ({ base: state.meta.settings.base?.[state.meta.settings.provider] || '', trace });
const cur = () => state.sessions[state.meta.active];
const provider = () => providers[state.meta.settings.provider] || providers.openrouter;
// A session's resolved scope: its profile chain over the Settings values, then its
// own overrides (profiles.js). cfg(s) is the settings a turn uses; toolsFor(s) the
// tools its capabilities allow.
const profiles = () => (state.meta.profiles ??= []);
const eff = s => prof.effective(profiles(), s?.profile, state.meta.settings, s?.over);
const cfg = s => eff(s).settings;
const toolsFor = s => { const c = eff(s).caps; return defsFor(s).filter(d => prof.allowedTool(d.function.name, c)); };

// ---------- message rendering ----------

// opt = {s, promote}: promote shows plain fences as copy handoffs (the person asked for one)
function blocks(text, opt = {}) {
  const out = [];
  const re = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(h('div', { class: 'txt', text: text.slice(i, m.index).trim() }));
    const body = m[2].replace(/\n$/, ''), ho = handoff.parse(m[1]) || (opt.promote ? { kind: 'copy', arg: '', title: m[1].trim(), promoted: true } : null);
    if (ho) out.push(handoffCard(ho, body, opt.s));
    else out.push(h('figure', { class: 'code' },
      h('figcaption', {}, h('span', { text: m[1].trim() || 'text' }), h('button', { 'data-copy': 'code', type: 'button', text: 'copy' })),
      h('pre', {}, h('code', { text: body }))));
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

// ---------- handoff blocks (handoff.js) ----------

// A card for content the person takes away; also listed on the session's stage.
function handoffCard(ho, body, s) {
  const copyBtn = btn('copy', { class: 'primary' });
  copyBtn.onclick = () => navigator.clipboard.writeText(body).then(() => { copyBtn.textContent = 'copied'; setTimeout(() => copyBtn.textContent = 'copy', 900); }, () => modal({ title: 'Copy', body: [h('pre', { class: 'cfgshow', text: body })] }));
  const actions = [copyBtn];
  let view = h('pre', {}, h('code', { text: body }));
  if (ho.kind === 'file') {
    const name = (ho.arg || 'file.txt').replace(/[\\/:*?"<>|]+/g, '_');
    const dl = btn('download ' + name);
    dl.onclick = () => { const a = h('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/plain' })), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    actions.push(dl);
  } else if (ho.kind === 'command') {
    const out = h('pre', { class: 'hout', hidden: '' });
    if (s?.tools?.includes('vm') && eff(s).caps.vm) {
      const run = btn('run on the machine');
      run.onclick = async () => { run.disabled = true; out.hidden = false; out.textContent = 'running…'; const r = await vm().run(body, 300).catch(e => ({ out: String(e.message || e), code: null })); out.textContent = (r.out || '(no output)') + (r.timedOut ? '\n[timed out]' : `\n[exit ${r.code}]`); run.disabled = false; };
      actions.push(run);
    }
    view = h('div', {}, view, out);
  } else if (ho.kind === 'view') {
    const fmt = (ho.arg || '').toLowerCase();
    if (fmt === 'html') view = render('html', { html: body }, () => {});
    else if (fmt === 'csv') view = render('table', handoff.csvRows(body), () => {});
    else if (fmt === 'json') { try { view = h('pre', {}, h('code', { text: JSON.stringify(JSON.parse(body), null, 2) })); } catch {} }
  } else if (ho.kind === 'config') {
    const ap = btn('apply…');
    ap.onclick = () => pasteConfig(body);
    actions.push(ap);
  }
  const card = h('figure', { class: 'handoff', 'data-kind': ho.kind },
    h('figcaption', {}, h('span', { class: 'hkind', text: ho.kind + (ho.kind === 'view' && ho.arg ? ' ' + ho.arg : '') }), h('b', { text: ho.title || (ho.kind === 'file' ? ho.arg : '') || ho.kind }), ho.promoted ? h('span', { class: 'meta', text: 'shown as a handoff because you asked for one' }) : '', h('span', { class: 'acts' }, ...actions)),
    h('div', { class: 'hbody' }, view));
  card._raw = body;
  if (s) stageHandoff(s, ho, body, card);
  return card;
}
// the session's handoffs, newest first, at the top of its stage
function stageHandoff(s, ho, body, card) {
  const box = stagebox(s);
  let list = box.querySelector('.handoffs');
  if (!list) { list = h('div', { class: 'handoffs' }, h('p', { class: 'note', text: 'Handoffs' })); box.prepend(list); }
  const go = btn(ho.title || ho.arg || ho.kind, { class: 'hname' });
  go.onclick = () => { setPane('stage'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.dataset.flash = ''; setTimeout(() => delete card.dataset.flash, 800); };
  const cp = btn('copy');
  cp.onclick = () => navigator.clipboard.writeText(body).then(() => { cp.textContent = 'copied'; setTimeout(() => cp.textContent = 'copy', 900); });
  list.children[0].after(h('div', { class: 'hitem' }, h('span', { class: 'hkind', text: ho.kind }), go, cp));
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
  if (p === 'machine') setTimeout(machineDiag);
  state.meta.settings.pane = p;
  const hide = ['stage', 'insp', 'machine'].filter(x => x !== p).map(x => '#' + x).join(',');
  rule('pane', `${hide}{display:none}\n#panes [data-pane="${p}"]{border-color:var(--accent);color:var(--accent)}`);
}

// The numbers for one card's header, from the harness's own records.
const k = n => n == null ? '' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
function metrics(m) {
  const x = m.x || {}, u = x.usage || {}, out = [];
  if (m.role === 'assistant') {
    if (x.model) out.push(['model', x.model.split('/').pop(), x.model]);
    if (u.prompt_tokens != null) out.push(['in', k(u.prompt_tokens) + (u.prompt_tokens_details?.cached_tokens ? ` (${k(u.prompt_tokens_details.cached_tokens)} cached)` : '')]);
    if (u.completion_tokens != null) out.push(['out', k(u.completion_tokens)]);
    if (u.cost != null) out.push(['$', Number(u.cost).toFixed(5)]);
    if (x.ms != null) out.push(['time', (x.ms / 1000).toFixed(1) + ' s']);
    if (x.upstream) out.push(['via', x.upstream]);
  } else if (m.role === 'tool') {
    if (x.tool) out.push(['tool', x.tool]);
    if (x.ms != null) out.push(['time', x.ms >= 1000 ? (x.ms / 1000).toFixed(1) + ' s' : x.ms + ' ms']);
    out.push(['size', k(String(m.content || '').length) + ' chars']);
    if (x.ok != null) out.push(['', x.ok ? 'ok' : 'failed']);
    if (x.policy) out.push(['policy', x.policy.id]);
    if (x.values) out.push(['values', x.values.join(' ')]);
  } else if (m.role === 'user' && typeof m.content === 'string') out.push(['', k(m.content.length) + ' chars']);
  return out;
}

function messageNode(m, s) {
  const el = h('article', { class: 'msg', 'data-role': m.role });
  el.append(h('header', { class: 'mhead' }, h('span', { class: 'role', text: m.role }),
    ...metrics(m).map(([a, b, f]) => h('span', { class: 'mx' + (b === 'failed' ? ' bad' : ''), ...(f ? { 'data-full': f } : {}), text: a && a !== '$' ? `${a} ${b}` : a + b }))));
  if (m.x?.reasoning) el.append(h('div', { class: 'think', text: m.x.reasoning }));
  if (m.role === 'tool') {
    el.append(h('details', { class: 'call' }, h('summary', { text: 'result ' + m.tool_call_id }), h('pre', { text: m.content })));
    if (m.x?.audit) el.append(auditTable(m.x.audit));
    if (m.x?.policy) { const p = m.x.policy; el.append(h('details', { class: 'call policy' }, h('summary', { text: `policy ${p.id} ${p.refused ? 'refused the call' : 'rewrote the call'} (${p.model})` }), h('pre', { text: `${p.rule}\n\nfrom: ${p.from}${p.to ? '\nto:   ' + p.to : ''}${p.refused ? '\nwhy:  ' + p.refused : ''}` }))); }
  } else if (m.content) {
    let promote = false;
    if (m.role === 'assistant' && s) { const i = s.messages.indexOf(m); const u = s.messages.slice(0, i < 0 ? s.messages.length : i).findLast(x => x.role === 'user'); promote = handoff.wants(u?.content); }
    el.append(...blocks(m.content, { s: m.role === 'assistant' ? s : null, promote }));
  }
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
  const pr = profiles().find(p => p.id === s.profile);
  const parentProfile = s.parent ? state.sessions[s.parent.id]?.profile : undefined;
  const badge = pr && (!s.parent || parentProfile !== s.profile) ? h('i', { class: 'pbadge', style: `--pc:${pr.color || '#888'}`, title: eff(s).path, text: pr.name }) : '';
  if (pr) attrs.style = `--pc:${pr.color || '#888'}`;
  return h('div', attrs, h('span', { text: s.title }), badge, h('button', { 'data-act': 'newtab', type: 'button', title: 'Open in a tab of its own (it runs there; sessions in different tabs run at the same time)', text: '↗' }), h('button', { 'data-act': 'drop', type: 'button', title: 'Delete session', text: '×' }));
}

function ledgerRow(e, i) {
  const pct = e.helper ? (e.kind || 'helper') : e.kept == null ? '-' : Math.round(100 * e.kept / e.prevChars) + '%';
  const hit = e.kept == null ? '' : e.kept === e.prevChars ? 'full' : 'broken';
  const n = v => v == null ? '-' : String(v);
  return h('tr', {},
    h('td', { text: String(i + 1) }), h('td', { 'data-hit': hit, title: `${e.broke ? 'first difference in ' + e.broke + '; ' : ''}${n(e.kept)} of ${n(e.prevChars)} chars; request ${e.chars} chars; ${e.model}${e.upstream ? ' via ' + e.upstream : ''}`, text: pct }),
    h('td', { text: n(e.prompt) }), h('td', { text: n(e.cached) }), h('td', { text: n(e.completion) }),
    h('td', { text: e.cost == null ? '-' : Number(e.cost).toFixed(5) }));
}

// In-page modal instead of alert/confirm/prompt. Resolves with the value of the
// button pressed (Escape or the backdrop = the first button marked cancel, or false).
function modal({ title, body, actions = [{ text: 'OK', value: true }] }) {
  return new Promise(ok => {
    const back = h('div', { class: 'modal-back' });
    const done = v => { back.remove(); removeEventListener('keydown', key, true); ok(v); };
    const cancel = actions.find(a => a.cancel)?.value ?? false;
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(cancel); } };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('h3', { text: title }),
      ...[].concat(body || []).map(b => typeof b === 'string' ? h('p', { class: 'modal-text', text: b }) : b),
      h('div', { class: 'actions' }, ...actions.map(a => { const b = btn(a.text, a.primary ? { class: 'primary', 'data-modal': '' } : { 'data-modal': '' }); b.onclick = () => done(a.value); return b; })));
    back.addEventListener('mousedown', e => { if (e.target === back) done(cancel); });
    back.append(box);
    document.body.append(back);
    addEventListener('keydown', key, true);
    (box.querySelector('.primary') || box.querySelector('button'))?.focus();
  });
}
const ask2 = (title, text, yes = 'OK', no = 'Cancel') => modal({ title, body: text, actions: [{ text: no, value: false, cancel: true }, { text: yes, value: true, primary: true }] });

// ---------- paste-to-configure (config.js) ----------

const cfgCurrent = () => ({ settings: { ...state.meta.settings, newProfile: profiles().find(p => p.id === state.meta.settings.newProfile)?.name, metricsLayout: panels.getLayout() }, policies: policyList(), profiles: profiles(), providers: Object.keys(providers), machine: vmWanted(),
  values: allValues().map(v => { const r = vals.current(v); return { id: v.id, scope: v.scope.kind === 'global' ? 'defaults' : v.scope.kind === 'session' ? 'session' : 'profile:' + (profiles().find(p => p.id === v.scope.id)?.name || v.scope.id), label: r.label, value: r.value, purpose: r.purpose }; }) });
// Inputs re-read from state after a merge.
function showSettings() {
  const set = state.meta.settings;
  $('#provider').value = set.provider; $('#model').value = set.model || ''; $('#helper').value = set.helper || '';
  $('#polmodel').value = set.policyModel || ''; $('#ghlabel').value = set.ghlabel || ''; $('#logrepo').value = set.logRepo || '';
  $('#budget').value = set.branchBudget || BRANCH_BUDGET; $('#pace').value = pace();
  showBase(); renderPolicies(); renderProfiles(); redrawSessions(); showPrice(); renderScope(); renderValues();
}
async function pasteConfig(prefill = '') {
  const ta = h('textarea', { rows: '10', class: 'mono', spellcheck: 'false', placeholder: '{"settings": {"model": "...", "helper": "..."}, "policies": [{"name": "...", "rule": "..."}]}' });
  const out = h('div', { class: 'cfgplan' });
  let last = null;
  const show = () => {
    const text = ta.value.trim();
    if (!text) { last = null; out.replaceChildren(h('p', { class: 'note', text: 'Paste a JSON block. Only the fields it names change; credentials are refused.' })); return; }
    last = config.plan(text, cfgCurrent());
    if (last.error) { out.replaceChildren(h('p', { class: 'note bad', text: last.error })); return; }
    out.replaceChildren(
      h('p', { class: 'note', text: last.changes.length ? `${last.changes.length} change${last.changes.length > 1 ? 's' : ''}:` : 'Nothing would change.' }),
      ...last.changes.map(c => h('div', { class: 'cfgrow' }, h('code', { text: c.path }), h('span', { class: 'from', text: JSON.stringify(c.from) }), h('span', { text: '→' }), h('span', { class: 'to', text: JSON.stringify(c.to) }))),
      ...last.refused.map(r => h('div', { class: 'cfgrow bad' }, h('code', { text: r.path }), h('span', { text: 'refused: ' + r.why }))),
      last.next.machine != null ? h('p', { class: 'note', text: 'The machine switch changes: the page reloads after applying.' }) : '');
  };
  ta.addEventListener('input', show);
  if (prefill) ta.value = prefill;
  show();
  setTimeout(() => ta.focus());
  const go = await modal({ title: 'Paste config', body: [ta, out], actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Apply', value: true, primary: true }] });
  if (!go || !last || last.error || !last.changes.length) return;
  const { settings, policies, machine, profiles: nextProfiles, values: nextValues } = last.next;
  if (nextProfiles) state.meta.profiles = nextProfiles;
  if (settings.newProfile) settings.newProfile = profiles().find(p => p.name === settings.newProfile)?.id;
  for (const v of nextValues || []) {
    const scope = v.scope === 'defaults' ? { kind: 'global' } : v.scope === 'session' ? { kind: 'session', id: cur()?.id } : { kind: 'profile', id: profiles().find(p => p.name === v.scope.slice(8))?.id };
    if (!scope.id && scope.kind !== 'global') continue;
    const by = { who: 'config', session: cur()?.id, title: cur()?.title };
    const old = v.id && allValues().find(x => x.id === v.id);
    if (old) vals.revise(old, { value: v.value, purpose: v.purpose || undefined, role: v.role, expose: v.expose, why: 'paste config' }, by);
    else vals.create(state.meta, scope, { label: v.label, role: v.role, value: v.value, purpose: v.purpose, expose: v.expose, notes: v.notes, why: 'paste config' }, by);
  }
  if (settings.metricsLayout) { panels.setLayout(settings.metricsLayout); delete settings.metricsLayout; } // kept in its own key (wh:metrics-layout), not in the settings
  Object.assign(state.meta.settings, settings);
  if ('logRepo' in settings) state.meta.settings.logReady = false;
  if (policies) state.meta.settings.policyList = policies;
  saveMeta();
  smells.add({ kind: 'config-applied', detail: last.changes.map(c => c.path).join(', ').slice(0, 300) });
  if (machine != null) { try { localStorage.setItem('wh:vm', machine ? '1' : '0'); } catch {} location.reload(); return; }
  if ('provider' in settings) loadModels();
  showSettings();
  renderSmells();
}

// Import loose "label: value" lines (config.js planImport): settings by name or
// alias at a chosen level, else existing values by label (new revision), else new values.
async function importLines() {
  const s = cur(), levels = scopeLevels(s);
  const ta = h('textarea', { rows: '8', class: 'mono', spellcheck: 'false', placeholder: 'model: …\nhelper model: …\nlog repo: owner/name\nregion = eu-west-1\n| main | some/model | … |' });
  const lv = h('select', {}, ...levels.map((l, i) => Object.assign(h('option', { value: l.id, text: (l.id === 'session' ? 'this session' : l.id === 'default' ? 'defaults (all sessions)' : 'profile ' + l.name) + (levelFrozen(s, l.id) ? ' (frozen)' : '') }), { selected: i === 0, disabled: levelFrozen(s, l.id) })));
  const out = h('div', { class: 'cfgplan' });
  let rows = [];
  const plan = () => {
    const visibleVals = valuesFor(s).map(v => { const r = vals.current(v); return { id: v.id, label: r.label, value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) }; });
    rows = config.planImport(ta.value, { settings: state.meta.settings, current: k => eff(s).settings[k], values: visibleVals, providers: Object.keys(providers) });
    const level = lv.value, e = eff(s);
    if (levelFrozen(s, level)) for (const r of rows) if (r.target?.kind === 'setting' && r.target.level === 'chosen') { r.action = 'refused'; r.why = 'that level is frozen'; }
    out.replaceChildren(h('p', { class: 'note', text: rows.length ? `${rows.filter(r => r.action === 'update' || r.action === 'create').length} to apply · uncheck a line to leave it out` : 'Paste lines of label and value.' }), ...rows.map((r, i) => {
      const lockBy = r.target?.kind === 'setting' && r.target.level === 'chosen' ? e.locked.get(r.target.key) : null;
      const li = levels.findIndex(l => l.id === level), lk = lockBy ? levels.findIndex(l => l.name === lockBy) : -1;
      if (lockBy && li < lk) { r.action = 'refused'; r.why = `locked by profile ${lockBy}`; }
      const where = !r.target ? '' : r.target.kind === 'setting' ? `${r.target.key}${r.target.level === 'default' ? ' (defaults)' : ''}` : r.target.id ? `value ${r.target.id}` : 'new value';
      const box = Object.assign(h('input', { type: 'checkbox', 'data-i': String(i) }), { checked: r.action === 'update' || r.action === 'create', disabled: r.action === 'refused' || r.action === 'unchanged' });
      return h('label', { class: 'cfgrow imp ' + (r.action === 'refused' ? 'bad' : '') }, box, h('code', { text: r.label }), h('span', { text: '→ ' + (where || '—') }),
        r.action === 'refused' ? h('span', { text: 'refused: ' + r.why }) : h('span', {}, h('span', { class: 'from', text: JSON.stringify(r.from ?? '') }), h('span', { text: ' → ' }), h('span', { class: 'to', text: JSON.stringify(r.value) }), h('span', { class: 'note', text: ' ' + r.action })));
    }));
  };
  ta.addEventListener('input', plan); lv.addEventListener('change', plan); plan();
  setTimeout(() => ta.focus());
  const go = await modal({ title: 'Import labels and values', body: [ta, field('apply at', lv), out], actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Apply', value: true, primary: true }] });
  if (!go) return;
  const picked = rows.filter((r, i) => (r.action === 'update' || r.action === 'create') && out.querySelector(`[data-i="${i}"]`)?.checked);
  const level = lv.value, done = [];
  const scope = level === 'default' ? { kind: 'global' } : level === 'session' ? { kind: 'session', id: s.id } : { kind: 'profile', id: level.slice(2) };
  for (const r of picked) {
    if (r.target.kind === 'setting') {
      if (r.target.level === 'default') { state.meta.settings[r.target.key] = r.value; if (r.target.key === 'logRepo') state.meta.settings.logReady = false; saveMeta(); done.push(r.target.key); }
      else { const err = setAt(s, level, r.target.key, r.value); if (!err) { done.push(r.target.key); if (r.target.key === 'logRepo' && level === 'default') { state.meta.settings.logReady = false; saveMeta(); } } }
    } else if (r.target.id) { const v = allValues().find(x => x.id === r.target.id); vals.revise(v, { value: r.value, why: 'imported' }, valueBy(s, 'you')); done.push(v.id); }
    else { const v = vals.create(state.meta, scope, { label: r.label.slice(0, 60), role: 'imported', value: r.value, purpose: '' }, valueBy(s, 'you')); done.push(v.id); }
  }
  saveMeta();
  smells.add({ kind: 'config-imported', detail: `${done.length} lines at ${level}: ${done.join(', ')}`.slice(0, 300) });
  showSettings(); renderValues(); renderScope(); renderSmells();
}

// One card for every list in the inspector (policies, patterns, scratchpads,
// smells, proposals): a kind chip and a name in the header, a short meta line,
// the body, then actions. tone: ok | warn | bad | off colours the edge.
function item({ kind, name, meta = '', body = [], actions = [], tone = '', open = false, attrs = {} }) {
  const el = h('details', { class: 'item', ...(tone ? { 'data-tone': tone } : {}), ...attrs },
    h('summary', {}, h('span', { class: 'chip', text: kind }), h('span', { class: 'name', text: name }), meta ? h('span', { class: 'meta', text: meta }) : ''),
    h('div', { class: 'body' }, ...body.filter(Boolean)),
    actions.length ? h('div', { class: 'actions' }, ...actions) : '');
  el.open = open;
  return el;
}
const field = (label, input) => h('label', { class: 'field' }, h('span', { text: label }), input);
const btn = (text, attrs = {}) => h('button', { type: 'button', text, ...attrs });

function padNode(p) {
  return item({ kind: 'pad', name: p.label || '(no label)', meta: p.include ? 'in context' : '', tone: p.include ? 'ok' : '', open: true, attrs: { 'data-pad': p.id },
    body: [
      field('label', h('input', { 'data-f': 'label', value: p.label })),
      Object.assign(h('textarea', { 'data-f': 'text', rows: '4' }), { value: p.text }),
      h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', 'data-f': 'include' }), { checked: !!p.include }), ' in context'),
    ],
    actions: [btn('delete', { 'data-act': 'pad-drop' })] });
}
function renderPatterns() {
  const list = pat.live().sort((a, b) => b.by.t - a.by.t);
  $('#patterns').replaceChildren(...list.map(p => item({ kind: p.kind, name: p.title, meta: `used ${p.uses}`, attrs: { 'data-pat': p.id },
    body: [
      h('p', { class: 'note', text: `${p.id} · ${p.labels.map(l => '#' + l).join(' ') || 'no labels'} · from ${state.sessions[p.by.session]?.title || p.by.session || p.by.steward || '?'}${p.by.message != null ? ', message ' + p.by.message : ''}${p.by.model ? ', ' + p.by.model : ''}` }),
      h('pre', { text: p.recipe ? JSON.stringify(p.recipe, null, 1) + (p.body ? '\n\n' + p.body : '') : p.body }),
      p.refs?.length ? h('p', { class: 'note', text: 'refs: ' + p.refs.join(' ') }) : null,
    ],
    actions: [btn('delete', { 'data-act': 'pat-drop' })] })));
  slot($('#patn'), `${pat.trail().length} trail rows`);
  slot($('#patcount'), list.length || '');
}

// ---------- policy items ----------
function policyList() {
  const set = state.meta.settings;
  if (!Array.isArray(set.policyList)) { set.policyList = typeof set.policies === 'string' ? policy.fromText(set.policies) : structuredClone(policy.DEFAULT_LIST); delete set.policies; saveMeta(); }
  return set.policyList;
}
// ---------- uptext: the full value of anything cut short ----------

// Hover (mouse) or press and hold (touch) on text that is truncated, or that
// carries data-full, shows its whole value in a bubble above it.
function uptext() {
  const tip = h('div', { id: 'uptext', role: 'tooltip', hidden: '' });
  document.body.append(tip);
  let timer = null, shownFor = null;
  const full = el => el.dataset?.full || (el.classList?.contains('slot') ? el.getAttribute('data-v') : '') || slotText(el).trim();
  const truncated = el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  const target = start => {
    for (let el = start; el && el !== document.body; el = el.parentElement) {
      if (el.dataset?.full) return el;
      if (el.matches?.('input, textarea, select, pre, .msg, .body, #threads, .thread')) return null; // long text areas scroll; no bubble
      const cs = getComputedStyle(el);
      if ((cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && truncated(el) && full(el)) return el;
    }
    return null;
  };
  const hide = () => { clearTimeout(timer); timer = null; tip.hidden = true; shownFor = null; };
  const show = el => {
    const text = full(el);
    if (!text) return;
    tip.textContent = text; tip.hidden = false; shownFor = el;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const left = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
    const top = r.top - t.height - 6 >= 6 ? r.top - t.height - 6 : r.bottom + 6;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  };
  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = target(e.target);
    if (el === shownFor) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 400);
  });
  document.addEventListener('pointerout', e => { if (e.pointerType !== 'touch' && shownFor && !shownFor.contains(e.relatedTarget)) hide(); });
  document.addEventListener('pointerdown', e => {
    hide();
    if (e.pointerType !== 'touch') return;
    const el = target(e.target);
    if (el) timer = setTimeout(() => show(el), 450); // press and hold
  });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, e => { if (e.pointerType === 'touch') { clearTimeout(timer); timer = null; setTimeout(hide, shownFor ? 1500 : 0); } });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  // a held press that showed a bubble should not also click
  document.addEventListener('click', e => { if (shownFor && e.pointerType === 'touch') { e.preventDefault(); e.stopPropagation(); } }, true);
}

// ---------- inline edit: a row shows or hides its edit controls ----------

// head: the row you click or tap; edit: the controls it shows; input: the field
// whose value is compared with what it opened with. Closing with a change asks:
// discard, keep editing, or save (the dialog shows from -> to).
let openEdit = null;
function inlineEdit(head, edit, input, { label, show = v => v, save }) {
  let start = input.value;
  const dirty = () => input.value !== start;
  const close = () => { edit.hidden = true; head.removeAttribute('data-editing'); if (openEdit?.edit === edit) openEdit = null; };
  const open = () => { start = input.value; edit.hidden = false; head.setAttribute('data-editing', ''); openEdit = { edit, tryClose }; setTimeout(() => input.focus()); };
  async function tryClose() {
    if (!dirty()) { close(); return true; }
    const r = await modal({ title: `Unsaved change to ${label}`, body: [h('div', { class: 'cfgrow' }, h('code', { text: label }), h('span', { class: 'from', text: show(start) }), h('span', { text: '→' }), h('span', { class: 'to', text: show(input.value) }))],
      actions: [{ text: 'Discard', value: 'discard' }, { text: 'Keep editing', value: 'keep', cancel: true }, { text: 'Save', value: 'save', primary: true }] });
    if (r === 'save') { save(); return true; }
    if (r === 'discard') { input.value = start; close(); return true; }
    input.focus(); return false;
  }
  const toggle = async () => {
    if (!edit.hidden) return tryClose();
    if (openEdit && openEdit.edit !== edit && !(await openEdit.tryClose())) return;
    open();
  };
  head.addEventListener('click', e => { if (!e.target.closest('input, select, textarea, a')) toggle(); });
  head.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === head) { e.preventDefault(); toggle(); } });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') tryClose(); if (e.key === 'Enter' && input.tagName === 'INPUT') save(); });
}

// ---------- this session's scope, attribute by attribute ----------

const SCOPE_ROWS = [...prof.SETTING_KEYS.map(k => ({ k, kind: 'set' })), ...prof.CAP_KEYS.map(k => ({ k, kind: 'cap' }))];
const SCOPE_LABEL = { watchModel: 'watcher model', strategy: 'strategy', machineGh: 'machine GitHub auth', machineUser: 'machine user', machineQuota: 'machine quota (MB)', logRepo: 'log repo', logTranscripts: 'transcripts', model: 'model', helper: 'helper model', policyModel: 'policy model', pace: 'pace', branchBudget: 'branch budget', run_js: 'run code', fanout: 'fan out', ask: 'ask and values', vm: 'machine', repo: 'repositories' };
// levels from this session up: session, each profile leaf to root, defaults
function scopeLevels(s) {
  const ch = eff(s).chain;
  return [{ id: 'session', name: 'this session' }, ...ch.slice().reverse().map(p => ({ id: 'p:' + p.id, name: p.name, p })), { id: 'default', name: 'defaults' }];
}
// The scope as a grid of rows that always fits its container: label, value and
// source shrink and truncate (uptext shows them whole); the edit icon has a fixed
// column; the edit panel stacks under its row. Grouped by audience.
function renderScope() {
  const s = cur(), box = $('#scope');
  if (!s || !box) return;
  const e = eff(s), levels = scopeLevels(s);
  const opt = (v, t, sel, dis) => Object.assign(h('option', { value: v, text: t }), { selected: !!sel, disabled: !!dis });
  const show = (row, v) => row.kind === 'cap' ? (v === true ? 'yes' : v === false ? 'no' : v) : (v === '' || v == null ? '—' : String(v));
  const rowOf = row => {
    const k = row.k, label = SCOPE_LABEL[k] || k, val = row.kind === 'set' ? e.settings[k] : e.caps[k];
    const from = row.kind === 'set' ? (e.from[k] || 'defaults') : (e.capFrom[k] || 'defaults');
    const lockBy = row.kind === 'set' ? e.locked.get(k) : null;
    // a lock held by profile P allows P and the levels above it; nothing below
    const lockIdx = lockBy ? levels.findIndex(l => l.name === lockBy) : -1;
    const lv = h('select', { 'data-sl': k }, ...levels.map((l, i) => opt(l.id, l.name + (levelFrozen(s, l.id) ? ' (frozen)' : ''), i === 0 && lockIdx < 0 || i === lockIdx, (lockIdx >= 0 && i < lockIdx) || (row.kind === 'cap' && l.id === 'default') || levelFrozen(s, l.id))));
    const input = k === 'logTranscripts' ? h('select', { 'data-sv': k }, opt('', 'inherit', true), opt('true', 'on'), opt('false', 'off'))
      : row.kind === 'set'
      ? h('input', { 'data-sv': k, value: val == null ? '' : String(val), placeholder: 'blank = inherit', list: /model|helper/i.test(k) ? 'models' : '', class: 'mono' })
      : k === 'repo' ? h('select', { 'data-sv': k }, opt('', 'inherit'), ...['none', 'read', 'write'].map(x => opt(x, x, x === val)))
      : h('select', { 'data-sv': k }, opt('', 'inherit'), opt('1', 'allow', val === true), opt('0', 'deny', val === false));
    if (k === 'logTranscripts') input.value = val === false ? 'false' : 'true';
    const cancel = btn('cancel');
    const edit = h('div', { class: 'scope-edit', 'data-row': k, hidden: '' },
      field('set at', lv), field(row.kind === 'set' ? 'value (blank = inherit)' : 'value', input),
      lockBy ? h('p', { class: 'note', text: `Locked by ${lockBy}: only ${lockBy} or a level above it can change this.` }) : '',
      h('div', { class: 'actions' }, cancel, btn('save', { 'data-act': 'scope-set', class: 'primary' })));
    const toggle = h('button', { type: 'button', class: 'scope-toggle', title: 'edit ' + label, 'aria-label': 'edit ' + label, 'aria-expanded': 'false', text: '✎' });
    const fromKind = from === 'this session' ? 'session' : from === 'defaults' ? 'default' : 'profile';
    const head = h('div', { class: 'srow', 'data-attr': k, role: 'button', tabindex: '0', 'aria-label': `${label}: ${show(row, val)}, from ${from}`, ...(lockBy ? { 'data-locked': '' } : {}) },
      h('span', { class: 'slabel', text: label }),
      h('span', { class: 'sval mono', text: show(row, val) }),
      h('span', { class: 'from', 'data-from': fromKind, ...(lockBy ? { 'data-full': `${from} · locked by ${lockBy}` } : {}), text: (lockBy ? '🔒 ' : '') + from }),
      toggle);
    inlineEdit(head, edit, input, { label, show: v => row.kind === 'cap' ? ({ '': 'inherit', '1': 'allow', '0': 'deny' }[v] ?? v) : (v === '' ? '(inherit)' : v), save: () => edit.querySelector('[data-act="scope-set"]').click() });
    cancel.onclick = () => head.click();
    new MutationObserver(() => toggle.setAttribute('aria-expanded', String(!edit.hidden))).observe(edit, { attributes: true, attributeFilter: ['hidden'] });
    return [head, edit];
  };
  const group = (title, note, rows) => h('div', { class: 'sgroup' }, h('div', { class: 'shead', 'data-full': note }, h('span', { text: title }), h('span', { class: 'note', text: note })), ...rows.flatMap(rowOf));
  box.replaceChildren(
    group('Harness settings', 'used on the session’s behalf; never shown to the model', SCOPE_ROWS.filter(r => prof.AUDIENCE[r.k] === 'harness')),
    group('Tools', 'what the model gets to use', SCOPE_ROWS.filter(r => prof.AUDIENCE[r.k] !== 'harness')));
  slot($('#scopecount'), (s.frozen ? 'frozen · ' : '') + (e.path || 'no profile'));
  slot($('#sessname'), s.title);
  $('#smutable').checked = !s.frozen;
  $('#sessioncard').toggleAttribute('data-frozen', !!s.frozen);
}
// set one scoped setting at a level relative to the session; returns an error or null
const levelFrozen = (s, level) => level === 'session' ? !!s.frozen : level.startsWith('p:') ? profiles().find(p => 'p:' + p.id === level)?.mutable === false : false;
function setAt(s, level, k, v, kind = 'set') {
  if (levelFrozen(s, level)) return level === 'session' ? 'this session is frozen' : `profile ${profiles().find(p => 'p:' + p.id === level)?.name} is frozen`;
  const e = eff(s), lockBy = kind === 'set' ? e.locked.get(k) : null, levels = scopeLevels(s);
  const at = levels.findIndex(l => l.id === level), lockIdx = lockBy ? levels.findIndex(l => l.name === lockBy) : -1;
  if (lockIdx >= 0 && at < lockIdx) return `locked by profile ${lockBy}`;
  const assign = (obj, key) => { if (v == null) delete obj[key]; else obj[key] = v; };
  if (level === 'session') { s.over ??= {}; if (kind === 'cap') { s.over.caps ??= {}; assign(s.over.caps, k); } else assign(s.over, k); saveSession(s); }
  else if (level === 'default') { if (kind === 'set') { assign(state.meta.settings, k); saveMeta(); } }
  else { const p = profiles().find(x => 'p:' + x.id === level); if (!p) return 'no such profile'; if (kind === 'cap') { p.caps ??= {}; assign(p.caps, k); } else { p.settings ??= {}; assign(p.settings, k); } saveMeta(); }
  return null;
}
function scopeSet(el) {
  const s = cur(), tr = el.closest('[data-row]'), k = tr.dataset.row, row = SCOPE_ROWS.find(r => r.k === k);
  const level = tr.querySelector('[data-sl]').value, raw = tr.querySelector('[data-sv]').value.trim();
  const v = row.kind === 'cap' ? (raw === '' ? null : k === 'repo' ? raw : raw === '1') : raw === '' ? null : k === 'branchBudget' ? Number(raw) || null : k === 'logTranscripts' ? raw === 'true' : raw;
  if (k === 'logRepo' && v && !/^[\w.-]+\/[\w.-]+$/.test(v)) return modal({ title: 'Not changed', body: 'log repo is owner/name.' });
  const err = setAt(s, level, k, v, row.kind);
  if (!err) openEdit = null;
  if (err) return modal({ title: 'Not changed', body: `${SCOPE_LABEL[k]}: ${err}.` });
  if (level === 'default') showSettings();
  else if (level !== 'session') renderProfiles();
  renderScope(); showScope();
}

// ---------- profiles (profiles.js) ----------

const CAP_LABEL = { run_js: 'run code', fanout: 'fan out', ask: 'ask', vm: 'machine' };
function renderProfiles() {
  const ps = profiles();
  const opt = (v, t, sel) => Object.assign(h('option', { value: v, text: t }), { selected: sel });
  const tri = (k, v) => h('select', { 'data-pf': 'cap.' + k }, opt('', 'inherit', v == null), opt('1', 'allow', v === true), opt('0', 'deny', v === false));
  const chainIds = cur() ? eff(cur()).chain.map(p => p.id) : [];
  const ordered = [...chainIds.slice().reverse().map(id => ps.find(p => p.id === id)), ...ps.filter(p => !chainIds.includes(p.id))].filter(Boolean);
  $('#profiles').replaceChildren(...ordered.map(p => {
    const e = prof.effective(ps, p.id, state.meta.settings), frozen = p.mutable === false;
    const card = item({ kind: chainIds.includes(p.id) ? 'in this session' : 'profile', name: e.path, meta: `${frozen ? 'frozen · ' : ''}${state.meta.order.filter(id => state.sessions[id]?.profile === p.id).length} sessions`, attrs: { 'data-prof': p.id, style: `--pc:${p.color}`, ...(frozen ? { 'data-frozen': '' } : {}) }, tone: frozen ? 'off' : '',
      body: [
        h('div', { class: 'row2' }, field('name', h('input', { 'data-pf': 'name', value: p.name })), field('parent', h('select', { 'data-pf': 'parent' }, opt('', '(top level)', !p.parent), ...ps.filter(x => x.id !== p.id && !prof.chain(ps, x.id).some(a => a.id === p.id)).map(x => opt(x.id, prof.chain(ps, x.id).map(c => c.name).join(' / '), p.parent === x.id)))), field('colour', h('input', { type: 'color', 'data-pf': 'color', value: p.color, class: 'narrow' }))),
        h('p', { class: 'note', text: 'Settings (blank = inherit; lock = no profile or session below may change it)' }),
        ...prof.SETTING_KEYS.map(k => h('div', { class: 'row2' }, field(k + (e.from[k] && e.from[k] !== p.name ? ` (now: ${e.settings[k]} from ${e.from[k]})` : ''), h('input', { 'data-pf': 'set.' + k, value: p.settings?.[k] ?? '', list: /model|helper/i.test(k) ? 'models' : '' })), h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', 'data-pf': 'lock.' + k }), { checked: (p.locks || []).includes(k) }), ' lock'))),
        h('p', { class: 'note', text: 'Capabilities (can only narrow what the parent allows)' }),
        h('div', { class: 'caps' }, ...['run_js', 'fanout', 'ask', 'vm'].map(k => field(CAP_LABEL[k], tri(k, p.caps?.[k]))),
          field('repos', h('select', { 'data-pf': 'cap.repo' }, opt('', 'inherit', p.caps?.repo == null), ...['none', 'read', 'write'].map(v => opt(v, v, p.caps?.repo === v))))),
        field('allowed repositories (owner/name or owner/*, comma separated; blank = inherit)', h('input', { 'data-pf': 'repos', value: (p.repos || []).join(', '), class: 'mono' })),
        h('p', { class: 'note', text: `resolved: ${Object.entries(e.caps).map(([k, v]) => `${CAP_LABEL[k] || k} ${v === true ? 'yes' : v === false ? 'no' : v}`).join(' · ')}${e.repoLists.length ? ' · repos ' + e.repoLists.map(r => r.list.join('|')).join(' ∩ ') : ''}${(p.policies || []).length ? ' · own policies: ' + p.policies.map(x => x.name).join(', ') : ''}` }),
      ],
      actions: [h('label', { class: 'check', title: 'Frozen: read-only until switched back' }, Object.assign(h('input', { type: 'checkbox', 'data-pf': 'mutable' }), { checked: !frozen }), ' mutable'),
 h('label', { class: 'check', title: 'Sealed: its sessions\u2019 directives stay inside their execution (not exported, synced or bridged)' }, Object.assign(h('input', { type: 'checkbox', 'data-pf': 'sealed', ...(frozen ? { disabled: '' } : {}) }), { checked: !!p.sealed }), ' sealed'), btn('delete', { 'data-act': 'prof-drop', ...(frozen ? { disabled: '' } : {}) })] });
    if (frozen) for (const el of card.querySelectorAll('.body input, .body select, .body textarea')) el.disabled = true;
    return card;
  }));
  slot($('#profcount'), ps.length || '');
  renderScope();
  $('#newprofile').replaceChildren(opt('', '(no profile)', !state.meta.settings.newProfile), ...ps.map(p => opt(p.id, prof.chain(ps, p.id).map(c => c.name).join(' / '), state.meta.settings.newProfile === p.id)));
  showScope();
}
// The current session's profile picker and resolved scope; the model box follows it.
function showScope() {
  const s = cur();
  if (!s || !$('#sprofile')) return;
  const ps = profiles(), e = eff(s);
  const choices = prof.assignable(ps, s.profile);
  const opt = (v, t, sel) => Object.assign(h('option', { value: v, text: t }), { selected: sel });
  $('#sprofile').disabled = !!s.frozen;
  $('#sprofile').replaceChildren(...(s.profile ? [] : [opt('', '(no profile)', true)]), ...choices.map(p => opt(p.id, prof.chain(ps, p.id).map(c => c.name).join(' / '), p.id === s.profile)));
  slot($('#sscope'), e.chain.length ? `model ${e.settings.model || '-'}${e.from.model ? ' (' + e.from.model + ')' : ''}${e.locked.size ? ' · locked: ' + [...e.locked.keys()].join(', ') : ''} · tools ${toolsFor(s).length}` : '');
  const lockedModel = e.locked.has('model');
  $('#model').value = e.settings.model || '';
  $('#model').disabled = lockedModel;
  $('#model').title = lockedModel ? `locked by profile ${e.locked.get('model')}` : '';
  $('#pace').value = pace(s);
}

// Settings policies first; a profile adds its own but cannot replace one above it.
function policiesFor(s) {
  const base = policyList();
  return [...base, ...eff(s).policies.filter(p => !base.some(b => b.name === p.name))];
}
function renderPolicies() {
  const list = policyList(), compiled = policy.compile(list.map(p => ({ ...p, on: true })));
  const fired = name => smells.count(r => r.policy === name && /^policy-/.test(r.kind));
  $('#policies').replaceChildren(...list.map((p, i) => {
    const err = compiled[i]?.error;
    return item({ kind: p.tool || '*', name: p.name || '(unnamed)', meta: err ? 'error' : p.on === false ? 'off' : `fired ${fired(p.name)}`, tone: err ? 'bad' : p.on === false ? 'off' : 'warn', attrs: { 'data-pol': String(i) },
      body: [
        h('p', { class: 'rule', text: p.rule || '(no rule yet)' }),
        h('div', { class: 'row2' }, field('name', h('input', { 'data-pf': 'name', value: p.name || '' })), field('tool', h('input', { 'data-pf': 'tool', value: p.tool || '*', list: 'toolnames' }))),
        h('div', { class: 'row2' }, field('pattern', h('input', { 'data-pf': 'pattern', value: p.pattern || '', spellcheck: 'false', class: 'mono' })), field('flags', h('input', { 'data-pf': 'flags', value: p.flags || '', class: 'mono narrow' }))),
        field('rule', Object.assign(h('textarea', { 'data-pf': 'rule', rows: '3' }), { value: p.rule || '' })),
        err ? h('p', { class: 'note bad', text: err }) : null,
        h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', 'data-pf': 'on' }), { checked: p.on !== false }), ' on'),
      ],
      actions: [btn('delete', { 'data-act': 'pol-drop' })] });
  }));
  slot($('#polcount'), list.filter(p => p.on !== false).length + '/' + list.length);
}

const renderPads = () => { $('#pads').replaceChildren(...state.meta.pads.map(padNode)); slot($('#padcount'), state.meta.pads.length || ''); };

function activate(id) {
  app.removeAttribute('data-empty');
  state.meta.active = id;
  saveMeta();
  try { sessionStorage.setItem('wh:tab-active', id); } catch {}
  claimSession(id);
  const s = cur();
  thread(s);
  stagebox(s);
  rule('active', `.thread:not([data-session="${id}"]),.stagebox:not([data-session="${id}"]){display:none}\n#sessions [data-id="${id}"]{background:var(--sel)}`);
  $('#title').value = s.title;
  $('#system').value = s.system;
  showScope();
  renderValues();
  renderProfiles(); // this session's card and chain come first
  if (state.meta.settings.pane === 'machine') machineDiag();
  $('#wire').value = s.wire || 'calls';
  $('#repotools').checked = !!s.tools?.includes('repo');
  $('#sprivate').checked = !!s.private;
  $('#vmtools').checked = !!s.tools?.includes('vm');
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
  slot($('#ledgersum'), 'this session: ' + sum(s.ledger) + (fam.length > 1 ? `\nwith ${fam.length - 1} branches: ` + sum(fam.flatMap(x => x.ledger)) : ''));
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
  slot($('#modelsn'), `${catalogue.length} models` + (c?.t ? `, fetched ${new Date(c.t).toLocaleString()}` : ''));
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

function pickModelSession(id) { const s = cur(), e = eff(s); if (e.from.model && e.from.model !== 'this session' || s?.over?.model) { if (s.frozen) { modal({ title: 'Session is frozen', body: 'Switch "mutable" back on in this session\'s card to change its model.' }); showScope(); return true; } (s.over ??= {}).model = id; saveSession(s); return true; } return false; }
function pickModel(id) {
  $('#model').value = id;
  if (!pickModelSession(id)) { state.meta.settings.model = id; saveMeta(); }
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
  slot($('#pricesum'), 'Models · ' + roles.map(([role, id]) => `${role} ${brief(id)}`).join(' · '));
  $('#price').replaceChildren(...roles.flatMap(([role, id]) => [h('tr', { class: 'role' }, h('th', { colspan: '2', text: `${role}: ${id || 'none'}` })), ...priceRows(id)]));
}

// ---------- the turn loop ----------

async function send(text) {
  const s = cur();
  if (busy || !text.trim()) return;
  if (!owns(s.id)) return notice(s, 'This session runs in another tab. Switch to that tab, or "run it here instead".');
  if (s.title === 'New session') { retitle(s, text.trim().slice(0, 40)); s.autoTitle = true; }
  await stewarding; // a pass already under way may be condensing this session's edge
  await edgeFold(s);
  // a new session opens with the pattern index; it is part of the first message from then on
  push(s, { role: 'user', content: text + (s.messages.length ? '' : pat.index() + ghNote(s)) + valueLines(s, !s.messages.length) + padAttachment(s, state.meta.pads) + stemLines(s) });
  await run(s);
}

// What GitHub access a repo-tool session has, stated once in its first message
// (so it sits in the cached prefix and never changes): the label the user gave
// the credential and the account or app the last "check" reported.
function ghNote(s) {
  if (!s.tools?.includes('repo')) return '';
  const set = state.meta.settings;
  const parts = [set.ghlabel, set.ghwho].filter(Boolean);
  return parts.length ? `\ngithub access: ${parts.join(' · ')}` : '';
}

function retitle(s, title) {
  s.title = title;
  saveSession(s);
  if (s.id === state.meta.active) $('#title').value = title;
  $(`#sessions [data-id="${s.id}"] span`).textContent = title;
}

// One user-initiated run. Branches started inside it go through turns() directly.
async function run(s) {
  try { return await runInner(s); } finally { transcriptSoon(); }
}
async function runInner(s) {
  if (!owns(s.id)) return notice(s, 'This session runs in another tab. Switch to that tab, or "run it here instead".');
  const set = cfg(s), p = provider();
  if (!set.model) return notice(s, 'Choose a model first.');
  if (p.needsKey && !state.keys[set.provider]) return notice(s, 'Add an API key in Settings first.');
  busy = true; runningId = s.id; app.setAttribute('data-busy', ''); ctl = new AbortController();
  try { return await turns(s, 0); }
  finally { await stemProgress(s).catch(() => {}); busy = false; runningId = null; app.removeAttribute('data-busy'); ctl = null; queueSteward(); }
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
// after a turn: queue what the steward would do (it does not run on its own)
const queueSteward = () => { clearTimeout(stewardTimer); stewardTimer = setTimeout(() => { if (!busy) queueCondense(); }, 800); };
function stewardItems(only) {
  const items = [];
  for (const s of only ? [only] : Object.values(state.sessions)) {
    if (s.autoTitle && !s.parent && s.messages.length >= 2) items.push({ kind: 'title', s, text: s.messages.slice(0, 2).map(m => String(m.content || '').slice(0, 300)).join('\n') });
    if (s.edge === 'helper') for (const { m, i } of edgeReplies(s)) if (!markedOnly(m.content)) items.push({ kind: 'reply', s, i, text: m.content.slice(0, 8000) });
  }
  return items.slice(0, 12);
}

function steward(only) {
  return stewarding = (async () => {
    const set = state.meta.settings, items = stewardItems(only);
    if (!set.helper || !items.length) return;
    const body = { model: set.helper, stream: true, max_tokens: cust.TYPES.condense.maxOut, messages: [{ role: 'system', content: STEWARD_SYSTEM }, { role: 'user', content: items.map((it, n) => `#${n + 1} ${it.kind}\n${it.text}`).join('\n\n') }] };
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
    slot($('#tracen'), trace.length + ' requests');
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
  slot($('#stewardsum'), st.length ? `steward: ${st.length} passes, ${st.reduce((n, e) => n + (e.applied || 0), 0)} items applied, ${st.reduce((n, e) => n + (e.prompt || 0), 0)} prompt tokens, $${st.reduce((n, e) => n + (Number(e.cost) || 0), 0).toFixed(5)}` : 'steward: no passes yet');
}

// Request > stream > tool calls > repeat, for one session.
// Returns 'done', 'failed' or 'limit'. onFirst fires on the first response event.
// A turn counts as running (for halts and updates) from its start to its end,
// except while it waits at a gate.
async function turns(s, depth, onFirst) {
  co?.enter();
  try { return await turnsInner(s, depth, onFirst); } finally { co?.leave(); }
}
async function turnsInner(s, depth, onFirst) {
  const set = cfg(s), p = provider(), key = state.keys[set.provider];
  const shown = () => s.id === state.meta.active;
  const ctx = {
    pads: state.meta.pads, savePads: () => { saveMeta(); renderPads(); },
    depth, fanOut: args => fanOut(s, args, ctx), branchRead,
    // attribution and reference checks come from the harness's view of the session
    by: () => ({ session: s.id, message: s.messages.length - 1, model: set.model, t: Date.now() }),
    knownRef: r => !!state.sessions[r] || s.messages.some(m => typeof m.content === 'string' && m.content.includes(r)),
    onPatterns: renderPatterns,
    helper: set.helper ? (want, text) => helper(s, want, text) : null,
    vm: s.tools?.includes('vm') ? shellRunner(s) : null,
    fsMark: () => fsMark(s),
    // handles (handles.js): this session is the reader; which ids it resolved, with a hash of what came back
    reader: s.id,
    onResolve: (id, h) => { (s.resolved ??= []).push({ t: Date.now(), id, h, at: s.messages.length }); saveSession(s); },
    ask: a => askCard(s, a),
    concern: (a, who) => fileConcern(s, a, who),
    values: valueTools(s, () => ctx.by()),
    runtime: (id, what) => smell(s, { kind: 'policy-runtime', tool: 'shell', policy: id, detail: what.slice(0, 200), rule: policyList().find(p => p.name === id)?.rule }),
    git: s.tools?.includes('repo') ? gitClient({ token: gh.token, trace, get, confirm: what => approve(s, what), readOnly: () => [state.meta.settings.logRepo].filter(Boolean), scope: repo => eff(s).repoAllowed(repo) ? null : `${repo} is not available in this session.` }) : null,
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const body = buildRequest(s, set.model, toolsFor(s));
    // Cache affinity: ask OpenRouter for the upstream that served this session last, so
    // its prefix cache is warm. Fallbacks stay allowed. Outside the messages, so the prefix is unchanged.
    if (set.provider === 'openrouter' && s.upstream && s.pin !== false) body.provider = { order: [s.upstream], allow_fallbacks: true };
    // a strategy may ask for a reasoning effort on stem turns (outside the messages: the prefix is unchanged)
    { const sp = strategies.spec(set.strategy); if (s.stem && sp.stemReasoning && set.provider === 'openrouter') body.reasoning = { effort: sp.stemReasoning }; }
    // halt gate: every tool result is recorded and nothing is in flight, so the turn
    // can be continued from storage alone (s.resume marks it for after a reload)
    if (co?.halted()) { s.resume = 'request'; saveSession(s); await co.gate(s.id, 'request'); delete s.resume; saveSession(s); }
    // pacing: the request waits here, before anything counts as sent
    const go = await hold(s, 'request', `${set.model} · ${body.messages.length} messages · ${(body.tools || []).length} tools · about ${k(Math.ceil(JSON.stringify(body).length / 4))} tokens`);
    if (go === 'skip') { notice(s, 'Model request skipped; the turn stopped here.'); return 'held'; }
    s.sent = s.messages.length; // everything in the log has now gone out; its wire form is fixed
    const entry = measure(s.id, body);
    // explicit cache breakpoints, only where reuse is expected (checkpoints.js); the stored log is unchanged
    // the session group's strategy decides which kinds it may set; bpKinds narrows them further
    const strat = strategies.spec(set.strategy), kinds = strat.checkpoints.filter(k => (state.meta.settings.bpKinds || ck.KINDS).includes(k));
    const bps = ck.supports(set.model) && kinds.length ? ck.choose(s, body, kinds) : [];
    const wire = ck.apply(body, bps);
    if (shown()) { $('#req').textContent = JSON.stringify(wire, null, 2); $('#events').textContent = ''; }

    const live = h('article', { class: 'msg', 'data-role': 'assistant', 'data-live': '' });
    const think = h('div', { class: 'think' }), txt = h('div', { class: 'txt' });
    live.append(think, txt);
    thread(s).append(live);
    const acc = { content: '', reasoning: '', calls: [], usage: null, t0: performance.now() };
    let failure = null, stalled = false;
    // idle watchdog: a stream that sends nothing for streamIdle seconds is aborted and asked
    // again once (seen live: an upstream stopped mid-stream and the turn waited forever)
    const IDLE = Number(state.meta.settings.streamIdle) || 90;
    for (let attempt = 0; attempt < 2; attempt++) {
    Object.assign(acc, { content: '', reasoning: '', calls: [], usage: null }); think.textContent = ''; txt.textContent = '';
    const req = new AbortController(), stop = () => req.abort();
    ctl?.signal.addEventListener('abort', stop);
    let idle = null;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => { stalled = true; req.abort(); }, IDLE * 1000); };
    stalled = false; failure = null; arm();
    try {
      for await (const ev of p.stream(wire, key, req.signal, opt())) {
        arm();
        if (onFirst) { onFirst(); onFirst = null; }
        if (shown()) $('#events').append(JSON.stringify(ev) + '\n');
        if (ev.error) throw new Error(ev.error.message || JSON.stringify(ev.error));
        if (ev.usage) acc.usage = ev.usage;
        if (typeof ev.provider === 'string') acc.upstream = ev.provider; // OpenRouter names the upstream that served it
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
    finally { clearTimeout(idle); ctl?.signal.removeEventListener('abort', stop); }
    if (!stalled) break;
    smell(s, { kind: 'stream-stall', upstream: acc.upstream || 'unknown', detail: `no data for ${IDLE} s (attempt ${attempt + 1})` });
    notice(s, `The provider stopped sending for ${IDLE} s; ${attempt ? 'stopped the turn' : 'asking again'}.`);
    }
    if (stalled) failure = new Error(`the provider stopped sending for ${IDLE} s, twice`);
    live.remove();
    slot($('#tracen'), trace.length + ' requests');

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
      m.x = { model: set.model, usage: acc.usage, ms: Math.round(performance.now() - acc.t0), ...(acc.upstream ? { upstream: acc.upstream } : {}) };
      if (acc.upstream && s.pin !== false) s.upstream = acc.upstream;
      if (acc.reasoning) m.x.reasoning = acc.reasoning;
      push(s, m);
    }
    s.ledger.push({ ...report(entry, acc.usage), ...(acc.upstream ? { upstream: acc.upstream } : {}), ...(bps.length ? { bp: bps.map(b => b.kind) } : {}), strat: strat.id });
    if (bps.length && acc.usage) ck.credit(body, bps, { prompt: acc.usage.prompt_tokens || 0, cached: acc.usage.prompt_tokens_details?.cached_tokens || 0, cacheWrite: acc.usage.prompt_tokens_details?.cache_write_tokens || acc.usage.cache_creation_input_tokens || 0 }, s.id);
    saveSession(s);
    if (shown()) $('#ledger tbody').append(ledgerRow(entry, s.ledger.length - 1));
    ledgerSum();

    if (failure) { if (failure.name !== 'AbortError') notice(s, String(failure.message || failure)); return 'failed'; }
    if (!calls.length) {
      if (s.wire === 'notes' && imitatesNote(acc.content)) {
        pat.trailAdd({ t: Date.now(), ...ctx.by(), tool: 'imitated_note', shape: 'imitated', ok: false, chars: acc.content.length, ms: 0 });
        smell(s, { kind: 'imitated-note', detail: acc.content.slice(0, 200) });
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
      // a call streamed without a tool name (an upstream dropped it) is never guessed at: not run, said so
      const nameless = !tc.function.name;
      // scope: a tool the profile does not allow never runs, even if the model names it
      const scopeNo = !nameless && !toolsFor(s).some(d => d.function.name === tc.function.name) && tools_known(tc.function.name);
      const pol = scopeNo || nameless ? null : await enforce(s, tc);
      let content;
      if (nameless) {
        content = `Not run: the call arrived without a tool name (the stream from ${acc.upstream || 'the provider'} dropped it). Make the call again.`;
        smell(s, { kind: 'malformed-call', upstream: acc.upstream || 'unknown', detail: String(tc.function.arguments || '').slice(0, 120) });
      }
      // pacing: the call waits as it will run (after any policy repair)
      if (!nameless && !scopeNo && !pol?.refused && co?.halted()) await co.gate(s.id, 'tool');
      const go = nameless || scopeNo || pol?.refused ? 'release' : await hold(s, 'tool', `${tc.function.name} ${pol ? pol.to : await fullArgs(tc)}`);
      if (nameless) { /* content set above */ }
      else if (scopeNo) { content = `Not run: ${tc.function.name} is not available in this session.`; smell(s, { kind: 'scope-refused', tool: tc.function.name, detail: eff(s).path }); }
      else if (go === 'skip') content = 'Not run: skipped by the user.';
      else if (pol?.refused) {
        content = `Not run: policy ${pol.id} (${pol.rule}): ${pol.refused}`;
        pat.trailAdd({ t: Date.now(), ...ctx.by(), tool: tc.function.name, shape: 'policy-refused', via: 'policy', ok: false, chars: content.length, ms: 0 });
      } else {
        if (pol) await relog(s, tc, pol.to);
        tc._t0 = performance.now();
        // {{v7}} in arguments becomes the value when the call runs; the log keeps the reference
        const runArgs = pol ? pol.to : await fullArgs(tc), filled = vals.fill(runArgs, valuesFor(s));
        if (filled.used.length) tc._used = filled.used;
        content = await execTool({ ...tc, function: { ...tc.function, arguments: filled.args } }, ctx, pol ? 'policy' : undefined);
        if (pol) content = `[policy ${pol.id}: call rewritten]\n` + content;
      }
      if (pol) smell(s, { kind: pol.refused ? 'policy-refused' : 'policy-rewritten', tool: tc.function.name, policy: pol.id, rule: pol.rule, model: pol.model, from: pol.from.slice(0, 300), to: pol.to?.slice(0, 300), why: pol.refused });
      else if (/^(Tool error|Error:)/.test(content)) smell(s, { kind: 'tool-error', tool: tc.function.name, detail: content.split('\n')[0].slice(0, 200) });
      watchCall(s, tc, content); // on-hook check by a small model, for every call (not awaited; flags only)
      if (/\n\[timed out after/.test(content)) smell(s, { kind: 'tool-timeout', tool: tc.function.name, detail: content.slice(-120) });
      const m = { role: 'tool', tool_call_id: tc.id, content };
      m.x = { tool: tc.function.name, ms: tc._t0 ? Math.round(performance.now() - tc._t0) : 0, ...(tc._used ? { values: tc._used } : {}), ok: !/^(Tool error|Error:|Not run:|Unknown tool|Invalid JSON)/.test(content), ...(ctx.audit ? { audit: ctx.audit } : {}), ...(pol ? { policy: pol } : {}) };
      delete tc._t0; delete tc._used;
      push(s, m);
    }
  }
  notice(s, `Stopped after ${MAX_STEPS} tool rounds.`);
  return 'limit';
}

const tools_known = name => defsFor({ tools: ['ask', 'repo', 'vm'] }).some(d => d.function.name === name);

// ---------- scoped values (values.js) ----------

const allValues = () => (state.meta.values ??= []);
const valuesFor = s => vals.visible(allValues(), eff(s).chain, s.id);
const scopeName = sc => sc.kind === 'global' ? 'settings' : sc.kind === 'session' ? 'session ' + (state.sessions[sc.id]?.title || sc.id) : 'profile ' + (profiles().find(p => p.id === sc.id)?.name || sc.id);

// What the model is told about values: the index once, at the start; afterwards one
// line per value that is new or changed since this session last saw it. Both ride
// on a user message, so nothing already cached is rewritten.
function valueLines(s, first) {
  s.valSeen ??= {};
  const out = [];
  for (const v of valuesFor(s)) {
    const r = vals.current(v), seen = s.valSeen[v.id];
    if (seen === r.rev) continue;
    const l = vals.line(v);
    if (l) out.push(l); else if (seen != null) out.push(`${v.id} ${r.label}: no longer in use`);
    s.valSeen[v.id] = r.rev;
  }
  if (!out.length) return '';
  return '\n\n' + (first ? vals.INDEX_HEAD : 'values changed:') + '\n' + out.join('\n');
}

function valueBy(s, who, by) {
  const b = by?.() || {};
  return { who, session: s.id, title: s.title, message: b.message ?? s.messages.length - 1, model: who === 'model' ? cfg(s).model : undefined };
}
function valueChip(s, v, r, verb) {
  if (!r.show) return;
  thread(s).append(h('article', { class: 'msg', 'data-role': 'value' }, h('header', { class: 'mhead' }, h('span', { class: 'role', text: 'value ' + verb }), h('span', { class: 'mx', text: `${v.id} rev ${r.rev} · ${scopeName(v.scope)}` })),
    h('div', { class: 'txt', text: `${r.label} [${r.role}]${r.purpose ? ' · ' + r.purpose : ''}` })));
}

// The value tools for one session.
function valueTools(s, by) {
  const find = id => valuesFor(s).find(v => v.id === String(id || '').trim());
  const leaf = s.profile && profiles().some(p => p.id === s.profile) ? s.profile : null;
  const done = v => { s.valSeen ??= {}; s.valSeen[v.id] = vals.current(v).rev; saveMeta(); saveSession(s); renderValues(); };
  return {
    async request(a) {
      const v = await valueCard(s, a, by);
      if (!v) return 'The person declined to give a value.';
      done(v);
      return vals.line(v) || `${v.id} stored (not visible to you)`;
    },
    set(a) {
      if (a.id) {
        const v = find(a.id);
        if (!v) return `No value ${a.id} in this session's scope.`;
        if (!vals.modelWritable(v, leaf, s.id)) return `Not changed: ${v.id} belongs to ${scopeName(v.scope)}; you can change values of this session${leaf ? ' or its profile' : ''} only.`;
        const r = vals.revise(v, { label: a.label, role: a.role, value: a.value, purpose: a.purpose, hidden: a.hidden === true, why: a.why }, valueBy(s, 'model', by));
        done(v); valueChip(s, v, r, r.hidden ? 'hidden' : 'revised');
        return `${v.id} rev ${r.rev}${r.hidden ? ' (hidden)' : ''}`;
      }
      if (!a.label || a.value === undefined) return 'Give label and value (and role, purpose) to record a new value.';
      const scope = a.scope === 'profile' && leaf ? { kind: 'profile', id: leaf } : { kind: 'session', id: s.id };
      const v = vals.create(state.meta, scope, { label: a.label, role: a.role, value: a.value, purpose: a.purpose, why: a.why }, valueBy(s, 'model', by));
      done(v); valueChip(s, v, vals.current(v), 'added');
      return `${v.id} rev 1 in ${scope.kind === 'profile' ? 'the profile' : 'this session'}`;
    },
    get(a) {
      const v = find(a.id);
      if (!v) return `No value ${a.id} in this session's scope.`;
      const r = vals.current(v);
      if (a.history) return vals.history(v, r.expose === 'value');
      if (r.hidden || r.expose === 'hidden') return `${v.id} is not available to you.`;
      return vals.line(v);
    },
  };
}

// The person (or the paired agent) answers a value request on a card.
const valueAsks = new Map();
function valueCard(s, a, by) {
  return new Promise(ok => {
    const id = uid('r'), ch = eff(s).chain;
    const type = ['text', 'number', 'choice', 'json'].includes(a.type) ? a.type : 'text';
    const opt = (v, t, sel) => Object.assign(h('option', { value: v, text: t }), { selected: !!sel });
    const input = type === 'choice' && Array.isArray(a.options) && a.options.length ? h('select', { name: 'value' }, ...a.options.map(o => opt(String(o), String(o))))
      : Object.assign(h(type === 'json' ? 'textarea' : 'input', { name: 'value', ...(type === 'number' ? { type: 'number' } : {}), class: type === 'json' ? 'mono' : '' }), {});
    const scopeSel = h('select', { name: 'scope' }, opt('session', 'this session', true), ...ch.slice().reverse().map(p => opt('profile:' + p.id, 'profile ' + prof.chain(profiles(), p.id).map(c => c.name).join(' / '))), opt('global', 'settings-wide'));
    const expose = h('select', { name: 'expose' }, opt('value', 'the model reads it', true), opt('purpose', 'the model sees label and purpose only'), opt('hidden', 'hidden from the model'));
    const err = h('p', { class: 'note bad' });
    const card = h('article', { class: 'msg', 'data-role': 'ask', 'data-vreq': id },
      h('header', { class: 'mhead' }, h('span', { class: 'role', text: 'value requested' }), h('span', { class: 'mx', text: 'waiting' })),
      h('form', { class: 'askform', novalidate: '' },
        h('div', { class: 'askp' }, h('span', { class: 'qtype', text: a.role || 'value' }), h('b', { text: ' ' + clipText(a.label, 60) }), h('span', { text: ' · ' + clipText(a.purpose, 300) })),
        a.why ? h('p', { class: 'note', text: 'why: ' + clipText(a.why, 300) }) : '',
        field('value', input), field('notes (yours; never sent)', h('textarea', { name: 'notes', rows: '2' })),
        h('div', { class: 'row2' }, field('keep in', scopeSel), field('visibility', expose)),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'show' }), ' show its purpose in the chat'),
        err, h('div', { class: 'actions' }, btn('decline', { 'data-vact': 'decline' }), h('button', { type: 'submit', class: 'primary', text: 'store' }))));
    const finish = (v, who) => { valueAsks.delete(id); slot(card.querySelector('.mhead .mx'), v ? `${v.id} stored by ${who}` : `declined by ${who}`); for (const e of card.querySelectorAll('input, textarea, select, button')) e.disabled = true; link?.emit('value-done', { id, value: v?.id || null, who }); ok(v); };
    const store = (raw, sc, ex, notes, show, who) => {
      let value = raw;
      if (type === 'number') { value = Number(raw); if (raw === '' || !Number.isFinite(value)) return 'a number is required'; }
      else if (type === 'json') { try { value = JSON.parse(raw); } catch (e) { return 'not valid JSON: ' + e.message; } }
      else if (String(raw).trim() === '') return 'a value is required';
      const scope = sc === 'global' ? { kind: 'global' } : String(sc).startsWith('profile:') && ch.some(p => 'profile:' + p.id === sc) ? { kind: 'profile', id: sc.slice(8) } : { kind: 'session', id: s.id };
      const v = vals.create(state.meta, scope, { label: a.label, role: a.role, purpose: a.purpose, value, notes, expose: ex, show, why: a.why }, { ...valueBy(s, who === 'you' ? 'you' : 'agent', by), requestedBy: 'model' });
      saveMeta(); valueChip(s, v, vals.current(v), 'added'); finish(v, who); return null;
    };
    card.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const f = e.target; err.textContent = store(f.value.value, f.scope.value, f.expose.value, f.notes.value, f.show.checked, 'you') || ''; });
    card.querySelector('[data-vact=decline]').addEventListener('click', () => finish(null, 'you'));
    valueAsks.set(id, { store: (x, who) => store(x.value, x.scope || 'session', x.expose || 'value', '', !!x.show, who), decline: who => finish(null, who), label: a.label });
    thread(s).append(card); scrollDown();
    link?.emit('value-request', { id, session: s.id, label: a.label, role: a.role, purpose: a.purpose, type });
  });
}
const clipText = (t, n) => String(t ?? '').slice(0, n);

// Inspector: the values in the current session's scope, with history and provenance.
function renderValues() {
  const s = cur(), box = $('#values');
  if (!s || !box) return;
  const list = valuesFor(s);
  const exposeSel = r => h('select', { 'data-vf': 'expose' }, ...vals.EXPOSE.map(x => Object.assign(h('option', { value: x, text: { value: 'model reads it', purpose: 'model sees purpose only', hidden: 'hidden from the model' }[x] }), { selected: r.expose === x })));
  box.replaceChildren(...list.map(v => {
    const r = vals.current(v), b = r.by || {};
    return item({ kind: r.role, name: `${v.id} ${r.label}`, meta: `${scopeName(v.scope)} · rev ${r.rev}${r.hidden ? ' · hidden' : ''}`, tone: r.hidden ? 'off' : r.expose === 'value' ? 'ok' : 'warn', attrs: { 'data-val': v.id },
      body: [
        field('value', Object.assign(h('textarea', { 'data-vf': 'value', rows: '2', class: 'mono' }), { value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) })),
        field('purpose', h('input', { 'data-vf': 'purpose', value: r.purpose || '' })),
        field('notes (yours; never sent)', Object.assign(h('textarea', { 'data-vf': 'notes', rows: '2' }), { value: r.notes || '' })),
        h('div', { class: 'row2' }, field('visibility', exposeSel(r)), h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', 'data-vf': 'show' }), { checked: !!r.show }), ' show in chat')),
        h('p', { class: 'note', text: `made by ${v.revs[0].by?.who || '?'}${v.revs[0].by?.requestedBy ? ' (asked for by the ' + v.revs[0].by.requestedBy + ')' : ''} in "${v.revs[0].by?.title || '?'}" at message ${v.revs[0].by?.message ?? '?'}, ${new Date(v.revs[0].t).toLocaleString()}${v.revs[0].by?.model ? ', ' + v.revs[0].by.model : ''}` }),
        h('details', { class: 'hist' }, h('summary', { text: `${v.revs.length} revision${v.revs.length > 1 ? 's' : ''}` }),
          ...v.revs.slice().reverse().map(x => h('div', { class: 'histrow' }, h('code', { text: 'rev ' + x.rev }), h('span', { class: 'note', text: ` ${new Date(x.t).toLocaleString()} by ${x.by?.who || '?'}${x.hidden ? ' (hidden)' : ''}${x.why ? ' · ' + x.why : ''}` }), h('span', { class: 'mono', text: ' ' + clipText(typeof x.value === 'string' ? x.value : JSON.stringify(x.value), 80) }),
            x.rev !== r.rev ? btn('restore', { 'data-act': 'val-restore', 'data-rev': String(x.rev) }) : ''))),
      ],
      actions: [btn('go to source', { 'data-act': 'val-goto' }), btn(r.hidden ? 'unhide' : 'hide', { 'data-act': 'val-hide' })] });
  }));
  slot($('#valcount'), list.length || '');
}
function valueEdit(v, fields, why) {
  vals.revise(v, fields, { who: 'you', session: cur()?.id, title: cur()?.title, message: (cur()?.messages.length || 0) - 1 }).why = why;
  saveMeta(); renderValues();
}

// ---------- pacing: hold model requests and/or tool calls ----------

// settings.pace: run | requests | tools | both. A held step is a card with what
// will go out; release, release all (back to run) or skip. The paired agent can
// release too (bridge directive "release").
const held = new Map();
const pace = s => (s ? cfg(s).pace : state.meta.settings.pace) || 'run';
function hold(s, kind, detail) {
  const p = pace(s);
  if (p === 'run' || (p === 'requests' && kind !== 'request') || (p === 'tools' && kind !== 'tool')) return Promise.resolve('release');
  return new Promise(ok => {
    const id = uid('h');
    const card = h('article', { class: 'msg', 'data-role': 'held', 'data-held': id });
    const done = (v, by = 'you') => { if (!held.has(id)) return; held.delete(id); card.dataset.done = v === 'skip' ? 'skipped' : 'released'; slot(card.querySelector('.mhead .mx'), `${card.dataset.done} by ${by}`); for (const b of card.querySelectorAll('button')) b.disabled = true; link?.emit('held-done', { id, by, v }); ok(v); };
    card.append(h('header', { class: 'mhead' }, h('span', { class: 'role', text: 'held ' + (kind === 'request' ? 'model request' : 'tool call') }), h('span', { class: 'mx', text: 'waiting' })),
      h('pre', { text: detail.length > 3000 ? detail.slice(0, 3000) + '…' : detail }),
      h('div', { class: 'actions' }, btn('release', { 'data-hold': 'release', class: 'primary' }), btn('release all', { 'data-hold': 'all' }), btn('skip', { 'data-hold': 'skip' })));
    card.addEventListener('click', e => { const a = e.target.dataset?.hold; if (!a) return; if (a === 'all') letLoose(); else done(a); });
    held.set(id, { done, kind, s: s.id, detail });
    thread(s).append(card);
    scrollDown();
    link?.emit('held', { id, session: s.id, kind, detail: detail.slice(0, 2000) });
  });
}
function letLoose(by = 'you') {
  // where the pace comes from a profile, the session gets its own "run" (unless locked)
  for (const x of state.meta.order.map(id => state.sessions[id]).filter(Boolean)) {
    const e = eff(x);
    if (e.from.pace && e.from.pace !== 'this session' && !e.locked.has('pace')) { (x.over ??= {}).pace = 'run'; saveSession(x); }
  }
  state.meta.settings.pace = 'run'; saveMeta(); $('#pace').value = 'run';
  for (const x of [...held.values()]) x.done('release', by);
}
async function fullArgs(tc) {
  const a = tc.function.arguments || '{}';
  try { const j = JSON.parse(a); if (typeof j.ref === 'string' && Object.keys(j).every(k => k === 'ref' || k === 'name' || k === 'want')) return (await get(j.ref).catch(() => null)) || a; } catch {}
  return a;
}

// ---------- questions to the person (ask.js) ----------

// The ask tool: a card with one field per question. Answers are validated before
// they go back; the paired agent can answer instead (bridge directive "answer_ask").
const asking = new Map();
function askCard(s, args) {
  const q = asks.questions(args);
  if (q.error) return Promise.resolve('Not asked: ' + q.error);
  return new Promise(ok => {
    const id = uid('a');
    const { rows, read } = asks.form(q.questions, h);
    const err = h('p', { class: 'note bad' });
    const card = h('article', { class: 'msg', 'data-role': 'ask', 'data-ask': id },
      h('header', { class: 'mhead' }, h('span', { class: 'role', text: 'question' + (q.questions.length > 1 ? 's' : '') }), h('span', { class: 'mx', text: 'waiting for an answer' })),
      h('form', { class: 'askform', novalidate: '' }, ...rows, err, h('div', { class: 'actions' }, btn('decline', { 'data-askact': 'decline' }), h('button', { type: 'submit', class: 'primary', text: 'answer' }))));
    const finish = (out, by) => {
      asking.delete(id);
      card.dataset.done = by;
      slot(card.querySelector('.mhead .mx'), out.declined ? `declined by ${by}` : `answered by ${by}`);
      for (const e of card.querySelectorAll('input, textarea, button')) e.disabled = true;
      link?.emit('ask-done', { id, by, ...out });
      ok(out.declined ? 'The person declined to answer.' : JSON.stringify(out.answers));
    };
    const submit = (given, by) => { const v = asks.validate(q.questions, given); if (v.errors) return v; finish({ answers: v.answers }, by); return v; };
    card.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const v = submit(read(card), 'you'); err.textContent = v.errors ? v.errors.join('; ') : ''; });
    card.querySelector('[data-askact=decline]').addEventListener('click', () => finish({ declined: true }, 'you'));
    asking.set(id, { submit, decline: by => finish({ declined: true }, by), questions: q.questions });
    thread(s).append(card);
    scrollDown();
    link?.emit('ask', { id, session: s.id, questions: q.questions });
  });
}

// ---------- policies (policy.js) ----------

// Check a call against the policies; on a match ask the policy model for a repair.
// Returns null (no policy applies), {..., to} (run this instead) or {..., refused}.
async function enforce(s, tc) {
  const set = cfg(s);
  const pols = policy.compile(policiesFor(s));
  let args = tc.function.arguments || '{}';
  try {
    const a = JSON.parse(args);
    if (typeof a.ref === 'string' && Object.keys(a).every(k => k === 'ref' || k === 'name' || k === 'want')) args = (await get(a.ref).catch(() => null)) || args;
  } catch {}
  const p = policy.broken(pols, tc.function.name, args)[0];
  if (!p) return null;
  const def = toolsFor(s).find(d => d.function.name === tc.function.name);
  const model = set.policyModel || set.helper || set.model;
  const rec = { id: p.id, rule: p.rule, model, from: args };
  let fix = null;
  try { fix = policy.readFix(await aux(s, model, policy.FIX_SYSTEM, policy.fixPrompt(p, tc.function.name, def?.function.parameters, args), 'policy')); } catch (e) { return { ...rec, refused: 'repair failed: ' + (e.message || e) }; }
  if (!fix || fix.refuse) return { ...rec, refused: fix?.refuse || 'no usable repair' };
  const to = JSON.stringify(fix.arguments);
  const still = policy.broken(pols, tc.function.name, to)[0];
  return still ? { ...rec, to, refused: `the repair still breaks ${still.id}` } : { ...rec, to };
}

// The rewritten call replaces the original in the log (that message has not been
// sent back yet, so no cached byte changes); long arguments are swapped as usual.
async function relog(s, tc, to) {
  const m = s.messages.findLast(m => m.tool_calls?.some(c => c.id === tc.id));
  const c = m?.tool_calls.find(c => c.id === tc.id);
  if (!c) return;
  let a = {};
  try { a = JSON.parse(to); } catch {}
  c.function.arguments = SWAPPABLE.has(c.function.name) && to.length > ARG_MAX
    ? JSON.stringify({ ref: await put(to), name: String(a.name || '').slice(0, 60) || undefined, want: a.want ? String(a.want).slice(0, 160) : undefined })
    : to;
  saveSession(s);
}

// Record a smell with the steering it happened under. Nothing is changed here:
// steering is reviewed later, across sessions (review below), before any change
// reaches a session's cached prefix.
function steerOf(s) {
  if (!s) return '';
  const set = state.meta.settings;
  return smells.fp([s.core || 0, s.keep ? 1 : 0, s.edge || '', s.system || '', eff(s).path, JSON.stringify(policiesFor(s)), JSON.stringify(toolsFor(s).map(d => d.function.name + d.function.description))].join('\u0000'));
}
function smell(s, row) {
  const r = smells.add({ session: s.id, model: cfg(s).model, profile: pathOut(s) || undefined, steer: steerOf(s), ...row });
  link?.emit('smell', r);
  renderSmells();
  considerReview(r);
  if (r.policy) renderPolicies();
}

// Targets: what the harness should achieve, checked per steering version from the
// ledgers (cache hit rate, smells per request, cost per request).
const TARGETS = { cache: { label: 'cache hit rate', def: 0.5, better: 'higher', fmt: v => Math.round(v * 100) + '%' }, smells: { label: 'smells per request', def: 0.05, better: 'lower', fmt: v => v.toFixed(3) }, cost: { label: 'cost per request', def: 0.002, better: 'lower', fmt: v => '$' + v.toFixed(4) } };
const targetOf = k => Number(state.meta.settings.targets?.[k] ?? TARGETS[k].def);
function steerStats() {
  const by = {};
  for (const x of state.meta.order.map(id => state.sessions[id]).filter(Boolean)) {
    const o = by[steerOf(x)] ||= { steer: steerOf(x), requests: 0, prompt: 0, cached: 0, cost: 0, smells: 0 };
    for (const e of x.ledger.filter(e => !e.helper)) { o.requests++; o.prompt += e.prompt || 0; o.cached += e.cached || 0; o.cost += Number(e.cost) || 0; }
  }
  for (const r of smells.all()) if (r.steer && by[r.steer]) by[r.steer].smells++;
  return Object.values(by).filter(o => o.requests).map(o => ({ ...o, cache: o.prompt ? o.cached / o.prompt : null, smellRate: o.smells / o.requests, costRate: o.cost / o.requests }));
}
const meets = (k, v) => v == null ? null : TARGETS[k].better === 'higher' ? v >= targetOf(k) : v <= targetOf(k);
const missedTargets = () => steerStats().flatMap(o => [['cache', o.cache], ['smells', o.smellRate], ['cost', o.costRate]].filter(([k, v]) => meets(k, v) === false).map(([k, v]) => `${o.steer}: ${TARGETS[k].label} ${TARGETS[k].fmt(v)} (target ${TARGETS[k].better === 'higher' ? '≥' : '≤'} ${TARGETS[k].fmt(targetOf(k))})`));

// results by strategy and model (main requests; helper rows are separate)
function strategyStats() {
  const by = {};
  for (const x of state.meta.order.map(id => state.sessions[id]).filter(Boolean)) {
    for (const e of x.ledger.filter(e => !e.helper && e.strat)) {
      const o = by[e.strat + '|' + e.model] ||= { strat: e.strat, model: e.model, requests: 0, prompt: 0, cached: 0, cost: 0, smells: 0, sessions: new Set() };
      o.requests++; o.prompt += e.prompt || 0; o.cached += e.cached || 0; o.cost += Number(e.cost) || 0; o.sessions.add(x.id);
    }
  }
  for (const r of smells.all()) for (const o of Object.values(by)) if (o.sessions.has(r.session)) o.smells++;
  return Object.values(by).map(({ sessions, ...o }) => ({ ...o, cache: o.prompt ? o.cached / o.prompt : null, costRate: o.cost / o.requests, smellRate: o.smells / o.requests }));
}

function renderSmells() {
  const box = $('#smells');
  if (!box) return;
  const list = smells.all();
  const steer = smells.bySteer(state.meta.order.map(id => state.sessions[id]).filter(Boolean).map(x => ({ steer: steerOf(x), requests: x.ledger.filter(e => !e.helper).length }))).filter(o => o.smells || o.requests);
  const props = smells.proposals();
  box.replaceChildren(
    h('div', { class: 'chips' }, ...(list.length ? smells.summary(list).map(([k, n]) => h('span', { class: 'chip', text: `${k} ×${n}` })) : [h('span', { class: 'note', text: 'Nothing recorded.' })])),
    h('div', { class: 'targets' }, h('b', { text: 'targets' }), ...Object.entries(TARGETS).map(([k, t]) => h('label', { class: 'field' }, h('span', { text: `${t.label} (${t.better === 'higher' ? '≥' : '≤'})` }), h('input', { type: 'number', step: k === 'cost' ? '0.0005' : '0.01', min: '0', 'data-target': k, value: String(targetOf(k)) })))),
    (() => { const st = steerStats(); if (!st.length) return ''; const cell = (k, v) => h('td', { 'data-met': String(meets(k, v)), text: v == null ? '-' : TARGETS[k].fmt(v) });
      return h('table', { class: 'audit targets-t' }, h('tr', {}, ...['steering', 'requests', 'cache', 'smells/req', '$/req'].map(t => h('th', { text: t }))),
        ...st.map(o => h('tr', {}, h('td', { text: o.steer + (o.steer === steerOf(cur()) ? ' (this session)' : '') }), h('td', { text: String(o.requests) }), cell('cache', o.cache), cell('smells', o.smellRate), cell('cost', o.costRate)))); })(),
    // by strategy and model: what routing by tested proficiency will read
    (() => { const r = strategyStats(); if (!r.length) return '';
      return h('table', { class: 'audit strat-t' }, h('tr', {}, ...['strategy', 'model', 'requests', 'cache', '$/req', 'smells/req'].map(t => h('th', { text: t }))),
        ...r.map(o => h('tr', {}, h('td', { text: o.strat }), h('td', { text: o.model }), h('td', { text: String(o.requests) }), h('td', { text: o.cache == null ? '-' : Math.round(o.cache * 100) + '%' }), h('td', { text: '$' + o.costRate.toFixed(4) }), h('td', { text: o.smellRate.toFixed(3) })))); })(),
    // cache checkpoints by kind: written once, then read (paid) or never read (a kind to switch off)
    (() => { const c = ck.stats(), kinds = Object.keys(c); if (!kinds.length) return '';
      return h('table', { class: 'audit ckpt-t' }, h('tr', {}, ...['checkpoint', 'set', 'paid', 'written tok', 'reads', 'read tok'].map(t => h('th', { text: t }))),
        ...kinds.map(k => h('tr', {}, h('td', { text: k + (state.meta.settings.bpKinds && !state.meta.settings.bpKinds.includes(k) ? ' (off)' : '') }), h('td', { text: String(c[k].set) }), h('td', { 'data-met': String(c[k].paid > 0), text: `${c[k].paid}/${c[k].set}` }), h('td', { text: String(c[k].writeTokens) }), h('td', { text: String(c[k].reads) }), h('td', { text: String(c[k].readTokens) })))); })(),
    h('div', { class: 'items' }, ...props.filter(p => p.status === 'pending').map(p => item({ kind: 'proposal', name: p.id, meta: p.model, tone: 'warn', open: true, attrs: { 'data-kind': 'proposal' },
      body: [h('pre', { text: p.text })],
      actions: [btn('adopt', { 'data-act': 'propose', 'data-id': p.id, 'data-to': 'adopted' }), btn('dismiss', { 'data-act': 'propose', 'data-id': p.id, 'data-to': 'dismissed' })] }))),
    h('div', { class: 'items' }, ...list.slice(-20).reverse().map(r => item({ kind: r.kind, name: r.policy || r.tool || '', meta: new Date(r.t).toLocaleTimeString(),
      tone: /refused|error|failed/.test(r.kind) ? 'bad' : r.kind === 'policy-rewritten' ? 'warn' : '', attrs: { 'data-kind': r.kind },
      body: [h('p', { class: 'note', text: (r.why || r.detail || r.rule || '').slice(0, 300) }), r.from ? h('pre', { text: 'from: ' + r.from + (r.to ? '\nto:   ' + r.to : '') }) : null] }))));
  slot($('#smellcount'), list.length || '');
}

// One request to a side model (policy repair); traced, with its own ledger row.
async function aux(s, model, system, content, kind, maxOut) {
  const set = cfg(s), p = provider();
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content }], stream: true, ...(maxOut ? { max_tokens: maxOut } : {}) };
  let out = '', usage = null;
  for await (const ev of p.stream(body, state.keys[set.provider], ctl?.signal, opt())) {
    if (ev.error) throw new Error(ev.error.message || kind + ' failed');
    if (ev.usage) usage = ev.usage;
    out += ev.choices?.[0]?.delta?.content || '';
  }
  const entry = report({ t: Date.now(), model, helper: true, kind, chars: content.length, kept: null, prevChars: null }, usage);
  if (!s) return out.trim(); // no session to record it against
  s.ledger.push(entry);
  saveSession(s);
  if (s.id === state.meta.active) $('#ledger tbody').append(ledgerRow(entry, s.ledger.length - 1));
  return out.trim();
}

// ---------- helper model ----------
// A small model that reads a long tool output and returns only what the caller
// said it wanted. Its requests are traced and get their own ledger rows.

// Watcher: a small (free or cheap) model checks each tool call as it completes and
// raises a flag only when something needs attention; flags are smells too, so they
// are tracked over time and reach whoever oversees the session (wh flags, the log repo).
const WATCH_SYSTEM = 'WATCH. You check one tool call made by an agent, for the harness that runs it. Reply exactly "ok", or "FLAG: <one short line>" when the call failed, repeated earlier work, wasted effort, broke a rule, or its result needs a person. Nothing else.';
// Each call is assessed once: s.watched[callId] = 'ok' | 'flag' (or 'pending' while it runs).
function watchCall(s, tc, content) {
  const m = cfg(s).watchModel, key = tc.id || '';
  if (!m || !key) return Promise.resolve('off');
  if ((s.watched ??= {})[key]) return Promise.resolve('skip');
  const res = String(content ?? '');
  const flag = why => {
    s.watched[key] = 'flag';
    const f = { t: Date.now(), tool: tc.function.name, why: why.split('\n')[0].slice(0, 200), at: s.messages.length, call: key };
    (s.flags ??= []).push(f);
    saveSession(s);
    smell(s, { kind: 'watch-flag', tool: f.tool, detail: f.why });
    return 'flag';
  };
  // the certain cases need no model: a failed call, or one that repeats an earlier call's result
  if (/^(Tool error|Error:|Not run)/.test(res)) return Promise.resolve(flag('failed: ' + res));
  const names = new Map(s.messages.flatMap(x => x.tool_calls || []).map(t => [t.id, t.function.name]));
  const prev = s.messages.findIndex(x => x.role === 'tool' && x.tool_call_id !== key && names.get(x.tool_call_id) === tc.function.name && res.length > 0 && String(x.content) === res);
  if (prev >= 0) return Promise.resolve(flag(`repeated work: the same result as #${prev}`));
  s.watched[key] = 'pending';
  const text = `TOOL: ${tc.function.name}\nARGS: ${String(tc.function.arguments || '').slice(0, 600)}\nRESULT:\n${res.slice(0, 2500)}`;
  return aux(s, m, WATCH_SYSTEM, text, 'watch', 60).then(r => {
    if (/^\s*FLAG:/i.test(r)) return flag(r.replace(/^\s*FLAG:\s*/i, ''));
    s.watched[key] = 'ok'; saveSession(s);
    return 'ok';
  }).catch(() => { delete s.watched[key]; return 'error'; });
}
// backfill: assess the calls of a session not checked off yet (for sessions run before the watcher was on)
async function rewatch(id) {
  const s = state.sessions[id];
  if (!s) return { checked: 0, skipped: 0 };
  const res = new Map(s.messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, m.content]));
  let checked = 0, skipped = 0;
  for (const m of s.messages) for (const tc of m.tool_calls || []) {
    const r = await watchCall(s, tc, res.get(tc.id) ?? '');
    if (r === 'skip') skipped++; else if (r === 'ok' || r === 'flag') checked++;
  }
  return { checked, skipped };
}

const HELPER_SYSTEM = 'You filter tool output for another program. You are given WANT and OUTPUT. Reply with only the parts of OUTPUT that answer WANT: at most 12 short lines, values copied exactly, no commentary. If OUTPUT does not contain it, reply exactly: not found';

async function helper(s, want, text) {
  const set = cfg(s), p = provider();
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
  slot($('#tracen'), trace.length + ' requests');
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
    title: '↳ ' + id, system: source.system, tools: source.tools, profile: source.profile, over: source.over ? { ...source.over } : undefined, wire: source.wire, keep: source.keep, core: source.core, edge: source.edge, sent: Math.min(source.sent || 0, cut), padSeen: { ...source.padSeen },
    parent: { id: source.id, at: cut, concern: id },
    // same upstream as its source, so its first request reads the prefix the source already cached
    ...(source.upstream ? { upstream: source.upstream } : {}),
    messages: structuredClone(source.messages.slice(0, cut)),
  });
  inherit(b.id, source.id);
  redrawSessions();
  return b;
}

// ---------- stems (docs/STEMS.md §2) ----------
//
// A stem works a goal in a branch forked at the turn where the goal was stated.
// The core keeps only an opaque handle (handles.js) and one step line when the
// stem opens and when it folds; the stem re-points the handle to its progress
// after each run, and to its fold (with what the core did since the anchor).
async function openStem(src, goal, at) {
  const handle = await H.mint({ kind: 'stem', owner: src.id, text: `stem open: ${goal}\n(no progress yet)` });
  const b = fork(src, 'stem-' + handle, at);
  b.stem = { handle, goal, anchor: at, core: src.id, coreLen: src.messages.length, t: Date.now() };
  b.title = '⎇ ' + goal.slice(0, 30);
  saveSession(b); redrawSessions();
  (src.stemNotes ??= []).push(`stem ${handle}: ${goal.split('\n')[0].slice(0, 120)}`);
  saveSession(src);
  return b;
}
async function stemProgress(b) {
  if (!b?.stem || b.stem.folded) return;
  const replies = b.messages.slice(b.parent.at).filter(m => m.role === 'assistant' && m.content);
  const last = replies.at(-1)?.content || '';
  const head = (markedOnly(last) || last).split('\n').filter(l => l.trim()).slice(0, 6).join('\n');
  await H.point(b.stem.handle, { text: `stem open: ${b.stem.goal}\n${replies.length} turn${replies.length === 1 ? '' : 's'} so far; latest:\n${head}` });
}
async function stemFold(b) {
  const core = state.sessions[b.stem.core];
  const since = core ? core.messages.slice(b.stem.coreLen).filter(m => m.role === 'user').length : 0;
  await H.point(b.stem.handle, { text: `stem folded: ${b.stem.goal}\ncore since the anchor: ${since} turn${since === 1 ? '' : 's'}\n${foldOf(b, 'done', '')}` });
  b.stem.folded = true; b.folded = true;
  saveSession(b);
  if (!core) return;
  (core.stemNotes ??= []).push(`stem ${b.stem.handle} folded`);
  saveSession(core);
  activate(core.id);
}
// the step lines waiting for the core's next message (sent once)
function stemLines(s) {
  const n = s.stemNotes?.splice(0) || [];
  if (!n.length) return '';
  saveSession(s);
  return '\n' + n.join('\n');
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
  const after = Math.ceil((s.system.length + JSON.stringify(toolsFor(s)).length) / 4) + 600;
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
  newtab(b) { const id = b.closest('[data-id]')?.dataset.id; if (id) window.open('?s=' + encodeURIComponent(id), '_blank'); },
  machinetab() { window.open('?machine', 'wh-machine'); },
  async vmhere() { slot($('#vmstat'), 'Machine: moving to this tab'); const r = await vm().takeOver().catch(e => ({ error: e.message })); slot($('#vmstat'), r?.tooBig ? `Machine: moved; the homes (${humanSize(r.tooBig)}) were too big to carry` : r?.error ? 'Machine: ' + r.error : 'Machine: moved here; it starts with the next command'); machineDiag(); },
  async vmsave() { const r = await vmInst?.saveNow(); slot($('#vmstat'), r?.tooBig ? `Machine: homes are ${humanSize(r.tooBig)}, over the 4 MB that is kept` : r ? `Machine: homes saved (${humanSize(r.saved)})` : 'Machine: not running here'); },
  haltall() { co.halt('halted by you'); },
  stepall() { co.step(); },
  resumeall() { co.resume(); },
  update() { updateAll(); },
  takeover() { const s = cur(); if (s) claimSession(s.id, true); },
  trace() { download('webharness-' + new Date().toISOString().replace(/[:.]/g, '-') + '.trace', { kind: 'webharness.trace', version: 1, build: VERSION, exchanges: trace, trail: pat.trail(), smells: smells.all(), proposals: smells.proposals() }); },
  new() { logSync('session start'); const np = profiles().some(p => p.id === state.meta.settings.newProfile) ? state.meta.settings.newProfile : undefined; const s = newSession({ keep: true, core: 3, edge: 'marks', ...(np ? { profile: np } : {}), ...(() => { const t = ['ask', 'values', ...(gh.mode() ? ['repo'] : []), ...(vmWanted() && vmReady() ? ['vm'] : [])]; return t.length ? { tools: t } : {}; })() }); redrawSessions(); activate(s.id); $('#input').focus(); },
  import() { $('#file').click(); },
  async export() {
    if (!cur()) return;
    const s = cur(), bundle = exportBundle(s), blobs = {};
    for (const x of bundle.sessions) if (sealedOf(state.sessions[x.id] || x)) { x.system = '[sealed]'; delete x.over; x.sealed = true; }
    // carry the stored outputs these sessions cite, so handles still resolve after import
    for (const hd of new Set(bundle.sessions.flatMap(x => x.messages.flatMap(m => [...handlesIn(m.content), ...handlesIn(m.x?.wire), ...(m.tool_calls || []).flatMap(t => handlesIn(t.function.arguments))])))) { const t = await get(hd).catch(() => null); if (t != null) blobs[hd] = t; }
    if (Object.keys(blobs).length) bundle.blobs = blobs;
    if (pat.all().length) bundle.patterns = pat.all();
    download((s.title.replace(/[^\w\- ]+/g, '').trim() || 'session') + '.session', bundle);
  },
  smellsclear() { smells.clear(); renderSmells(); },
  concern() { return concernForm(); },
  explore() { return openExplorer(); },
  async 'q-run'(el) { const it = queue().find(x => x.id === el.closest('[data-q]').dataset.q); if (it) await runItem(it); },
  'q-dismiss'(el) { const it = queue().find(x => x.id === el.closest('[data-q]').dataset.q); if (it) { it.status = 'dismissed'; it.done = Date.now(); saveMeta(); renderQueue(); } },
  async 'q-drain'() {
    const p = cust.pending(queue()); if (!p.length) return;
    const t = cust.total(queue());
    if (!await ask2('Drain the queue?', `${p.length} items: about ${k(t.in)} input tokens, at most ${k(t.out)} output, ${t.cost ? '$' + t.cost.toFixed(4) : 'price unknown'}. Items over the per-item budget still ask.`, 'Drain')) return;
    for (const it of p) await runItem(it);
  },
  'q-show'() { setPane('insp'); const d = $('#queue').closest('details'); d.open = true; d.scrollIntoView({ block: 'start' }); },
  ghscopes() { return checkScopes(); },
  ghderive() { state.meta.settings.ghIntent = tokencheck.derive({ settings: state.meta.settings, profiles: profiles() }); saveMeta(); showIntent(); },
  cfgpaste() { return pasteConfig(); },
  cfgimport() { return importLines(); },
  async cfgcopy() {
    const text = JSON.stringify(config.snapshot(cfgCurrent()), null, 2);
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    modal({ title: copied ? 'Config copied' : 'Config', body: [copied ? 'Copied to the clipboard (no credentials):' : 'Copy it from here (no credentials):', h('pre', { class: 'cfgshow', text })] });
  },
  async 'val-add'() {
    const s = cur(), ch = eff(s).chain;
    const opt = (v, t) => h('option', { value: v, text: t });
    const f = { label: h('input', { placeholder: 'short label' }), role: h('input', { placeholder: 'role, e.g. config, decision, endpoint', value: 'config' }), value: h('textarea', { rows: '2', class: 'mono' }), purpose: h('input', { placeholder: 'what it is for' }), scope: h('select', {}, opt('session', 'this session'), ...ch.slice().reverse().map(p => opt('profile:' + p.id, 'profile ' + p.name)), opt('global', 'settings-wide')) };
    if (!await modal({ title: 'Add a value', body: Object.entries(f).map(([k, el]) => field(k, el)), actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Add', value: true, primary: true }] })) return;
    if (!f.label.value.trim()) return;
    const sc = f.scope.value, scope = sc === 'global' ? { kind: 'global' } : sc.startsWith('profile:') ? { kind: 'profile', id: sc.slice(8) } : { kind: 'session', id: s.id };
    vals.create(state.meta, scope, { label: f.label.value.trim(), role: f.role.value.trim() || 'config', value: f.value.value, purpose: f.purpose.value.trim() }, valueBy(s, 'you'));
    saveMeta(); renderValues();
  },
  'val-hide'(el) { const v = allValues().find(x => x.id === el.closest('[data-val]').dataset.val); const r = vals.current(v); valueEdit(v, { hidden: !r.hidden }, r.hidden ? 'unhidden' : 'hidden'); },
  'val-restore'(el) { const v = allValues().find(x => x.id === el.closest('[data-val]').dataset.val); const old = v.revs.find(x => x.rev === Number(el.dataset.rev)); valueEdit(v, { label: old.label, role: old.role, value: old.value, purpose: old.purpose, expose: old.expose, show: old.show }, 'restored rev ' + old.rev); },
  'val-goto'(el) { const v = allValues().find(x => x.id === el.closest('[data-val]').dataset.val); const sid = v.revs[0].by?.session; if (state.sessions[sid]) activate(sid); },
  'scope-set'(el) { return scopeSet(el); },
  'prof-add'() { const ps = profiles(); const p = { id: uid('p'), name: 'profile-' + (ps.length + 1), color: prof.PALETTE[ps.length % prof.PALETTE.length], settings: {}, caps: {}, locks: [], policies: [] }; ps.push(p); saveMeta(); renderProfiles(); const c = $(`#profiles [data-prof="${p.id}"]`); c.open = true; c.querySelector('[data-pf=name]').focus(); },
  async 'prof-drop'(el) {
    const id = el.closest('[data-prof]').dataset.prof, ps = profiles(), p = ps.find(x => x.id === id);
    const used = state.meta.order.filter(x => state.sessions[x]?.profile === id).length, kids = ps.filter(x => x.parent === id).length;
    if (!await ask2('Delete profile?', `Delete "${p.name}"? ${used} sessions move to its parent${kids ? `, and ${kids} profiles below it move up a level` : ''}.`, 'Delete')) return;
    for (const x of state.meta.order.map(i => state.sessions[i]).filter(Boolean)) if (x.profile === id) { x.profile = p.parent || undefined; saveSession(x); }
    for (const x of ps) if (x.parent === id) x.parent = p.parent || undefined;
    ps.splice(ps.indexOf(p), 1); saveMeta(); renderProfiles(); redrawSessions();
  },
  'pol-add'() { const list = policyList(); let n = list.length + 1; while (list.some(p => p.name === 'policy-' + n)) n++; list.push({ name: 'policy-' + n, tool: '*', pattern: '', flags: '', rule: '', on: true }); saveMeta(); renderPolicies(); const c = $(`#policies [data-pol="${list.length - 1}"]`); c.open = true; c.querySelector('[data-pf=name]').focus(); },
  'pol-drop'(el) { const i = Number(el.closest('[data-pol]').dataset.pol); policyList().splice(i, 1); saveMeta(); renderPolicies(); },
  async logsetup() {
    const set = state.meta.settings, stat = $('#logstat'), l = logs();
    if (!l) { slot(stat, 'Enter owner/name first.'); return; }
    try {
      slot(stat, 'checking ' + l.repo + '…');
      let st = await l.status();
      if (st.state === 'missing') {
        if (!(await ask2('Create the log repo?', `${l.repo} does not exist, or this credential cannot see it. Create it now as a private repository?`, 'Create private repo'))) { slot(stat, 'Not created.'); return; }
        slot(stat, (await l.create()).split('\n')[0]);
        st = await l.status();
      }
      if (st.state === 'empty') { slot(stat, 'writing the layout…'); await l.init(); st = await l.status(); }
      set.logReady = st.state === 'ready'; saveMeta();
      slot(stat, set.logReady ? `${l.repo}: ready (schema ${st.manifest.schema})` : `${l.repo}: ${st.state}`);
      if (set.logReady) await logSync('set up');
    } catch (e) { slot(stat, e.message); }
  },
  logsync() { return logSync('by hand'); },
  logbrowse() { return browseTranscripts(); },
  async review() { return runReview(); },
  async _oldReview() {
    const s = cur(), set = state.meta.settings;
    const model = set.policyModel || set.helper || set.model;
    const steer = smells.bySteer(state.meta.order.map(id => state.sessions[id]).filter(Boolean).map(x => ({ steer: steerOf(x), requests: x.ledger.filter(e => !e.helper).length })));
    const rows = smells.all().slice(-200).map(r => ({ kind: r.kind, steer: r.steer, tool: r.tool, policy: r.policy, why: r.why, detail: r.detail?.slice(0, 120) }));
    const input = `STEERING VERSIONS:\n${JSON.stringify(steer)}\n\nRECENT ROWS:\n${rows.map(r => JSON.stringify(r)).join('\n')}\n\nCURRENT CONVENTIONS:\n${corePrompt(s)}\n\nCURRENT POLICIES:\n${policyList().map(p => `${p.name} [${p.tool}${p.on === false ? ', off' : ''}] /${p.pattern}/${p.flags || ''} ${p.rule}`).join('\n')}\n\nCURRENT SYSTEM PROMPT:\n${s.system || '(empty)'}`;
    const text = await aux(s, model, smells.REVIEW_SYSTEM, input, 'review').catch(e => 'review failed: ' + (e.message || e));
    const list = smells.proposals();
    list.push({ id: 'r' + Date.now().toString(36), t: Date.now(), model, text, status: 'pending', basis: { rows: rows.length, steer: steer.length } });
    smells.saveProposals(list);
    renderSmells();
  },
  propose(el) { const list = smells.proposals(); const p = list.find(x => x.id === el.dataset.id); if (p) { p.status = el.dataset.to; p.decided = Date.now(); smells.saveProposals(list); } renderSmells(); },
  async ghcheck() {
    const who = $('#ghwho');
    slot(who, 'checking…');
    try { slot(who, state.meta.settings.ghwho = await gh.whoami()); saveMeta(); }
    catch (e) { slot(who, e.message); }
  },
  inspector() { state.meta.settings.inspector = !state.meta.settings.inspector; saveMeta(); applyInspector(); },
  stop() { ctl?.abort(); },
  pane(el) { setPane(el.dataset.pane); saveMeta(); },
  'pat-drop'(el) { pat.drop(el.closest('[data-pat]').dataset.pat); renderPatterns(); },
  'card-drop'(el) { el.closest('.card').remove(); },
  async epoch() {
    const src = cur();
    if (busy || !src?.messages.length) return;
    // Lines the model marked with ! are the pocket: no request, no cost. Otherwise a branch writes one.
    const kept = keptLines(src);
    if (!await ask2('Fold this session?', 'A new session starts from the pocket; the original stays as it is.\n\n' + foldCase(src) + (kept.length ? `\n\n${kept.length} marked lines will be carried over; no model request is needed.` : '\n\nNo marked lines, so the model will be asked to write the pocket.'))) return;
    let pocket = kept.join('\n');
    if (!pocket) {
      const b = fork(src, 'pocket', src.messages.length);
      push(b, { role: 'user', content: POCKET_REQUEST });
      const status = await run(b), m = b.messages.at(-1);
      if (status !== 'done' || m?.role !== 'assistant' || !m.content) return notice(src, 'The pocket was not written; nothing was folded.');
      pocket = m.content;
    }
    const epoch = (src.epoch || 1) + 1;
    const n = newSession({ title: src.title.replace(/ · epoch \d+$/, '') + ' · epoch ' + epoch, system: src.system, tools: src.tools, profile: src.profile, over: src.over ? { ...src.over } : undefined, wire: src.wire, keep: src.keep, core: src.core, edge: src.edge, epoch, from: src.id });
    redrawSessions();
    push(n, { role: 'user', content: 'Pocket:\n' + pocket });
    activate(n.id);
  },
  // Manual branch: the message box text becomes the concern.
  async branch() {
    const src = cur(), task = $('#input').value.trim();
    if (busy || !src) return;
    if (!task) return notice(src, 'Type the concern for the branch in the message box first.');
    $('#input').value = '';
    const b = fork(src, task.slice(0, 30), src.messages.length);
    activate(b.id);
    push(b, { role: 'user', content: concernMessage(b.parent.concern, task) });
    await run(b);
  },
  // Manual fold: appended to the source, which is not run, so several folds can be batched before the next send.
  async stem() {
    const src = cur(), goal = $('#input').value.trim();
    if (busy || !src) return;
    if (!goal) return notice(src, 'Type the goal for the stem in the message box first.');
    const strat = strategies.spec(cfg(src).strategy);
    if (!strat.stems) return notice(src, `This session's strategy ${strat.id} has no stems (${strat.describe}).`);
    const ups = src.messages.map((m, i) => [m, i]).filter(([m]) => m.role === 'user');
    const sel = h('select', {}, ...ups.map(([m, i]) => h('option', { value: String(i), text: String(m.content).split('\n')[0].slice(0, 70) })), h('option', { value: String(src.messages.length), text: '(the end: after everything so far)' }));
    sel.value = String(ups.at(-1)?.[1] ?? src.messages.length);
    const ok = await modal({ title: 'Stem', body: h('div', {}, h('p', { text: 'Work this goal in a branch from the turn where it was stated. This session keeps a handle; the stem re-points it to its progress and, when folded, to its fold.' }), field('from the turn', sel)), actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Open the stem', value: true, primary: true }] });
    if (!ok) return;
    $('#input').value = '';
    const b = await openStem(src, goal, Number(sel.value));
    activate(b.id);
    push(b, { role: 'user', content: strat.stemFraming === 'plain' ? goal : concernMessage(b.stem.handle, goal) });
    await run(b);
  },
  async foldback() {
    const b = cur(), src = state.sessions[b.parent?.id];
    if (busy || !src) return;
    const m = b.messages.at(-1);
    if (m?.role !== 'assistant' || !m.content) return notice(b, 'Nothing to fold: the branch has no final reply yet.');
    if (b.stem) return stemFold(b);
    if (b.folded && !await ask2('Fold back again?', 'This branch was already folded back. Append it to the source again?', 'Append again')) return;
    b.folded = true;
    saveSession(b);
    push(src, { role: 'user', content: foldTag(b.parent.concern, foldOf(b, 'done', ''), b.id) });
    activate(src.id);
  },
  models() { loadModels(true); },
  async drop(el) {
    const id = el.closest('[data-id]').dataset.id;
    if (busy || !await ask2('Delete session?', `Delete "${state.sessions[id].title}" and its branches? This cannot be undone.`, 'Delete')) return;
    const gone = dropSession(id);
    for (const x of gone) { $(`#sessions [data-id="${x}"]`)?.remove(); $(`.thread[data-session="${x}"]`)?.remove(); }
    if (gone.includes(state.meta.active)) state.meta.order.length ? activate(state.meta.order[0]) : showEmpty();
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

  $('#composer').addEventListener('submit', e => { e.preventDefault(); const i = $('#input'); const v = i.value; if (busy || !v.trim()) return; if (!cur()) actions.new(); i.value = ''; send(v); });
  // Enter is a new line; only the send button sends.

  $('#title').addEventListener('change', e => { const s = cur(); if (!s) return; s.title = e.target.value || 'Untitled'; s.autoTitle = false; saveSession(s); $(`#sessions [data-id="${s.id}"] span`).textContent = s.title; });
  $('#system').addEventListener('change', e => { const s = cur(); if (!s) return; s.system = e.target.value; saveSession(s); });
  $('#edge').addEventListener('change', e => { const s = cur(); if (!s) return; s.edge = e.target.value; saveSession(s); showCore(); });
  $('#keep').addEventListener('change', e => { const s = cur(); if (!s) return; s.keep = e.target.checked; saveSession(s); showCore(); });
  $('#repotools').addEventListener('change', e => {
    const s = cur(); if (!s) return;
    s.tools = e.target.checked ? [...new Set([...(s.tools || []), 'repo'])] : (s.tools || []).filter(t => t !== 'repo');
    saveSession(s);
    // said once in the log, where it is cacheable from then on, rather than rewriting the first message
    if (e.target.checked && s.messages.length) { const n = ghNote(s).trim(); if (n) push(s, { role: 'user', content: n }); }
  });
  $('#sprivate').addEventListener('change', e => { const s = cur(); if (!s) return; s.private = e.target.checked || undefined; saveSession(s); });
  $('#logtx').checked = state.meta.settings.logTranscripts !== false;
  $('#logtx').addEventListener('change', e => { state.meta.settings.logTranscripts = e.target.checked; saveMeta(); });
  // outputs the browser no longer has come back from the log repo
  // try the ready log repos in turn: the defaults' first, then those profiles use
  setFallback(async hd => { for (const repo of [state.meta.settings.logRepo, ...Object.keys(state.meta.logRepos || {})].filter(repoReady)) { const t = await logs(repo).artifact(hd).catch(() => null); if (t != null) return t; } return null; });
  $('#vmtools').addEventListener('change', e => {
    const s = cur(); if (!s) return;
    s.tools = e.target.checked ? [...new Set([...(s.tools || []), 'vm'])] : (s.tools || []).filter(t => t !== 'vm');
    saveSession(s);
  });
  $('#values').addEventListener('change', e => {
    const f = e.target.dataset.vf, card = e.target.closest('[data-val]');
    if (!f || !card) return;
    const v = allValues().find(x => x.id === card.dataset.val);
    let val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'value') { try { const j = JSON.parse(val); if (typeof j === 'object' && j !== null) val = j; } catch {} }
    valueEdit(v, { [f]: val }, 'edited ' + f);
    const again = $(`#values [data-val="${v.id}"]`); if (again) again.open = true;
  });
  renderProfiles();
  $('#newprofile').addEventListener('change', e => { state.meta.settings.newProfile = e.target.value || undefined; saveMeta(); });
  $('#profiles').addEventListener('change', e => {
    const f = e.target.dataset.pf, card = e.target.closest('[data-prof]');
    if (!f || !card) return;
    const p = profiles().find(x => x.id === card.dataset.prof), v = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
    if (f === 'mutable') p.mutable = v ? undefined : false;
    else if (f === 'sealed' && p.mutable !== false) p.sealed = v || undefined;
    else if (p.mutable === false) { renderProfiles(); return; }
    else if (f === 'name') p.name = v || p.name;
    else if (f === 'parent') p.parent = v || undefined;
    else if (f === 'color') p.color = v;
    else if (f === 'repos') p.repos = v ? v.split(/[\s,]+/).filter(Boolean) : undefined;
    else if (f.startsWith('set.')) { const k = f.slice(4); p.settings ??= {}; if (v === '') delete p.settings[k]; else p.settings[k] = k === 'branchBudget' ? Number(v) || undefined : k === 'logTranscripts' ? !/^(false|off|no|0)$/i.test(v) : v; }
    else if (f.startsWith('lock.')) { const k = f.slice(5); p.locks = (p.locks || []).filter(x => x !== k); if (v) p.locks.push(k); }
    else if (f.startsWith('cap.')) { const k = f.slice(4); p.caps ??= {}; if (v === '') delete p.caps[k]; else p.caps[k] = k === 'repo' ? v : v === '1'; }
    saveMeta();
    const open = card.open; renderProfiles(); const again = $(`#profiles [data-prof="${p.id}"]`); if (again) again.open = open;
    redrawSessions();
  });
  $('#smutable').addEventListener('change', e => { const s = cur(); if (!s) return; s.frozen = e.target.checked ? undefined : true; saveSession(s); renderScope(); showScope(); });
  $('#sprofile').addEventListener('change', async e => {
    const s = cur(), to = e.target.value || undefined, before = toolsFor(s).map(d => d.function.name).join(); if (!s) return;
    const after = (() => { const o = s.profile; s.profile = to; const t = toolsFor(s).map(d => d.function.name).join(); s.profile = o; return t; })();
    if (before !== after && s.messages.length && !await ask2('Change profile?', `This changes the session's tools (${after.split(',').length} instead of ${before.split(',').length}), which breaks the cached prefix once.`, 'Change')) { showScope(); return; }
    s.profile = to; saveSession(s); redrawSessions(); showScope(); renderProfiles();
  });
  $('#pace').value = pace(cur());
  $('#pace').addEventListener('change', e => { if (e.target.value === 'run') letLoose(); else { state.meta.settings.pace = e.target.value; saveMeta(); } });
  $('#polmodel').value = state.meta.settings.policyModel || '';
  $('#toolnames').replaceChildren(...['*', ...defsFor({ tools: ['repo', 'vm'] }).map(d => d.function.name)].map(n => h('option', { value: n })));
  renderPolicies();
  $('#policies').addEventListener('change', e => {
    const f = e.target.dataset.pf, card = e.target.closest('[data-pol]');
    if (!f || !card) return;
    const p = policyList()[Number(card.dataset.pol)];
    p[f] = f === 'on' ? e.target.checked : e.target.value.trim();
    saveMeta();
    const open = card.open; renderPolicies(); const again = $(`#policies [data-pol="${card.dataset.pol}"]`); if (again) again.open = open;
  });
  $('#polmodel').addEventListener('change', e => { state.meta.settings.policyModel = e.target.value.trim(); saveMeta(); });
  showIntent();
  $('#smells').addEventListener('change', e => { const k = e.target.dataset?.target; if (!k) return; (state.meta.settings.targets ??= {})[k] = Number(e.target.value); saveMeta(); renderSmells(); });
  $('#qbudget').value = state.meta.settings.queueBudget || 20000;
  $('#qbudget').addEventListener('change', e => { state.meta.settings.queueBudget = Number(e.target.value) || 20000; saveMeta(); });
  renderQueue();
  // autostart: with the machine switched on (and the page isolated), boot it now
  // autostart: the machine tab always; another tab only when no tab runs it yet
  if (vmWanted() && vmReady() && (MACHINE_TAB || state.meta.settings.vmAutostart !== false)) setTimeout(async () => { const v = vm(); const h0 = await v.who().catch(() => null); if (MACHINE_TAB && h0 && !/ready|booting|loading|downloading|waiting/.test(h0.status)) await v.takeOver().catch(() => {}); if (MACHINE_TAB || !h0) v.run('true', 300, { quiet: true, label: 'autostart' }).catch(() => {}); else { v.connect().catch(() => {}); } }, 1500);
  $('#machine').addEventListener('click', e => { const j = e.target.dataset?.job; if (j) { vmInst?.cancel(j); setTimeout(renderJobs, 500); } });
  if (MACHINE_TAB) { document.title = 'WebHarness · machine'; app.setAttribute('data-machine-tab', ''); setPane('machine'); }
  checkPublished(); setInterval(checkPublished, 5 * 60e3); addEventListener('visibilitychange', () => { if (!document.hidden) checkPublished(); });
  setTimeout(finishUpdate, 1200);
  globalThis.whDebug = { vm, co: () => co, checkpoints: () => ck.stats(), strategyStats, rewatch, tab: TAB, owns, userOf: id => userOf(state.sessions[id]) }; // scripted checks (smoke suites, drive.mjs)
  renderCoord();
  // conditions checked at start: a credential never checked, or not for a week
  if ((state.keys.github || state.keys.ghapp) && Date.now() - (state.meta.settings.ghScopeAt || 0) > 7 * 864e5) enqueue({ type: 'scope-check', targets: [{ kind: 'credential', id: gh.mode() || 'github', label: 'GitHub credential' }], reason: { kind: state.meta.settings.ghScopeAt ? 'stale' : 'never checked', detail: state.meta.settings.ghScopeAt ? 'last checked over a week ago' : 'the credential has not been checked against its intended use' } });
  for (const id of ['#ghintent', '#ghpulls', '#ghcreate']) $(id).addEventListener('change', readIntent);
  $('#concernrepo').value = state.meta.settings.concernRepo || '';
  $('#concernrepo').placeholder = bootEnv?.repo || 'owner/name';
  $('#concernrepo').addEventListener('change', e => { state.meta.settings.concernRepo = e.target.value.trim() || undefined; saveMeta(); });
  $('#logrepo').value = state.meta.settings.logRepo || '';
  $('#logrepo').addEventListener('change', e => { state.meta.settings.logRepo = e.target.value.trim(); state.meta.settings.logReady = false; saveMeta(); slot($('#logstat'), 'press "set up"'); });
  if (state.meta.settings.logReady) slot($('#logstat'), state.meta.settings.logRepo + ': ready');
  $('#vmon').checked = vmWanted();
  $('#vmauto').checked = state.meta.settings.vmAutostart !== false;
  $('#vmauto').addEventListener('change', e => { state.meta.settings.vmAutostart = e.target.checked; saveMeta(); });
  $('#vmon').addEventListener('change', e => { try { localStorage.setItem('wh:vm', e.target.checked ? '1' : '0'); } catch {} location.reload(); });
  $('#wire').addEventListener('change', e => { const s = cur(); if (!s) return; s.wire = e.target.value; saveSession(s); showCore(); });
  // a session whose profile supplies the model gets its own override; otherwise the Settings value changes
  $('#model').addEventListener('change', e => { const s = cur(), e2 = eff(s), v = e.target.value.trim(); if (!s) { state.meta.settings.model = v; saveMeta(); showPrice(); return; } if (e2.from.model && e2.from.model !== 'this session' || s?.over?.model) { if (s.frozen) { modal({ title: 'Session is frozen', body: 'Switch "mutable" back on in this session\'s card to change its model.' }); showScope(); return; } (s.over ??= {}).model = v; saveSession(s); } else { state.meta.settings.model = v; saveMeta(); } showPrice(); showScope(); });
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
  const saveApp = () => { const appId = $('#ghappid').value.trim(), pem = $('#ghpem').value.trim(); state.keys.ghapp = appId || pem ? { appId, pem } : undefined; saveKeys(); state.meta.settings.ghwho = ''; saveMeta(); slot($('#ghwho'), ''); };
  $('#ghappid').addEventListener('change', saveApp);
  $('#ghpem').addEventListener('change', saveApp);
  $('#ghkey').addEventListener('change', e => { state.keys.github = e.target.value.trim(); saveKeys(); state.meta.settings.ghwho = ''; saveMeta(); slot($('#ghwho'), ''); });
  $('#ghlabel').addEventListener('change', e => { state.meta.settings.ghlabel = e.target.value.trim(); saveMeta(); });
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
    } catch (err) { modal({ title: 'Import failed', body: err.message }); }
  });
}

// Sidebar rows: top-level sessions in order, each followed by its branches.
// No sessions is a valid state: the thread area says so and offers one; controls
// that only make sense for a session are hidden (#app[data-empty]).
function showEmpty() {
  state.meta.active = ''; saveMeta();
  app.setAttribute('data-empty', '');
  rule('active', `.thread,.stagebox{display:none}`);
  let e = $('#empty');
  if (!e) { e = h('div', { id: 'empty' }, h('p', { text: 'No sessions.' }), h('p', { class: 'note', text: 'Start one, or just type a message below: sending creates a session.' }), btn('+ session', { 'data-act': 'new', class: 'primary' })); $('#threads').append(e); }
  slot($('#scopecount'), ''); slot($('#sessname'), '');
  $('#title').value = '';
}

// Sidebar: top-level sessions grouped by profile (in profile-tree order), each
// followed by its branches. A header names the scope; a badge marks a branch that
// was moved to a subordinate profile.
function rows() {
  const all = state.meta.order.map(id => state.sessions[id]).filter(Boolean);
  const under = s => [sessionRow(s), ...all.filter(x => x.parent?.id === s.id).reverse().flatMap(under)];
  const tops = all.filter(s => !s.parent || !state.sessions[s.parent.id]);
  const ps = profiles();
  const order = [undefined, ...ps.slice().sort((a, b) => prof.chain(ps, a.id).map(p => p.name).join('/').localeCompare(prof.chain(ps, b.id).map(p => p.name).join('/'))).map(p => p.id)];
  const out = [];
  for (const id of order) {
    const group = tops.filter(s => (ps.some(p => p.id === s.profile) ? s.profile : undefined) === id);
    if (!group.length) continue;
    if (ps.length) {
      const p = ps.find(x => x.id === id), depth = p ? prof.chain(ps, id).length - 1 : 0;
      out.push(h('p', { class: 'pgroup', style: `--pc:${p?.color || 'var(--line)'};--pd:${depth}`, text: p ? prof.chain(ps, id).map(x => x.name).join(' / ') : 'no profile' }));
    }
    out.push(...group.flatMap(under));
  }
  return out;
}
const redrawSessions = () => { $('#sessions').replaceChildren(...rows()); rule('active', `.thread:not([data-session="${state.meta.active}"]),.stagebox:not([data-session="${state.meta.active}"]){display:none}\n#sessions [data-id="${state.meta.active}"]{background:var(--sel)}`); };

let bootEnv = null;
export function boot(env) {
  bootEnv = env;
  load(); // throws (and the shell shows why) if stored data is newer than this build
  app = $('#app');
  app.innerHTML = SHELL;
  $('#ver').textContent = 'v' + VERSION;
  theme.mount($('#side > header'));
  $('#build').textContent = `build ${VERSION} · schema ${SCHEMA} · ${env.ref ? 'ref ' + env.ref : 'default branch'}`;
  $('#ref').value = env.ref;
  const set = state.meta.settings;
  $('#provider').append(...Object.entries(providers).map(([id, p]) => h('option', { value: id, text: p.label })));
  $('#provider').value = set.provider;
  $('#model').value = set.model;
  $('#key').value = state.keys[set.provider] || '';
  $('#ghkey').value = state.keys.github || '';
  $('#ghlabel').value = state.meta.settings.ghlabel || '';
  slot($('#ghwho'), state.meta.settings.ghwho || '');
  $('#ghappid').value = state.keys.ghapp?.appId || '';
  $('#ghpem').value = state.keys.ghapp?.pem || '';
  $('#sessions').append(...rows());
  $('#budget').value = set.branchBudget || BRANCH_BUDGET;
  $('#helper').value = set.helper || '';
  setPane(set.pane || 'insp');
  showBase();
  renderPatterns();
  renderPads();
  renderSmells();
  applyInspector();
  bind();
  metricsPanel.mount(); // metrics panel (docs/METRICS-PANEL.md)
  uptext();
  { let ta = ''; try { ta = sessionStorage.getItem('wh:tab-active') || ''; } catch {} const want = QS.get('s') || ta; if (state.sessions[want]) state.meta.active = want; }
  co = coordinator({ tab: TAB, version: VERSION, describe: () => ({ machine: vmInst?.role() || 'idle', dedicated: MACHINE_TAB, session: state.meta.active, build: bootEnv?.build || '' }), onChange: renderCoord, onReload: x => onCoordReload(x) });
  addEventListener('storage', adopt);
  if (!state.sessions[state.meta.active]) state.meta.active = state.meta.order[0] || '';
  state.meta.active ? activate(state.meta.active) : showEmpty();
  loadModels();
  const pair = bridge.pairing();
  if (pair) startBridge(pair, env).catch(e => console.error('bridge:', e));
}

// ---------- file explorer for the machine (explorer.js) ----------

// per session, for this page load (the machine starts fresh on reload)
const fsState = new Map(); // sessionId -> {mark: seconds, base: Map(path -> row)}
// Each top-level session (with its branches) is its own unix user on the machine,
// home /home/<user> (700), with a size quota; "root" runs as root in /root.
const userOf = s => {
  if (!s || cfg(s).machineUser === 'root') return '';
  let r = s; while (r.parent && state.sessions[r.parent.id]) r = state.sessions[r.parent.id];
  return 'u' + r.id.slice(-8).toLowerCase().replace(/[^a-z0-9]/g, '');
};
const homeOf = s => userOf(s) ? '/home/' + userOf(s) : '/root';
const shellOpt = s => s ? { user: userOf(s), quotaMB: Number(cfg(s).machineQuota ?? 200) || 0, session: s.id } : {};
const pinsOf = s => s?.pins?.length ? s.pins : [homeOf(s)];
async function fsMark(s) {
  if (fsState.has(s.id)) return fsState.get(s.id);
  const st = { mark: 0, base: new Map() };
  fsState.set(s.id, st);
  const r = await vm().run(fx.markCmd(s.id, pinsOf(s)), 120, { quiet: true, label: `mark the session start and list ${pinsOf(s).join(', ')}` });
  const [first, ...rest] = String(r.out || '').split('\n');
  st.mark = Number(first) || Date.now() / 1000;
  for (const row of fx.parse(rest.join('\n'))) st.base.set(row.path, row);
  return st;
}

function fileIcon(row) { return row.type === 'dir' ? '▸' : row.type === 'link' ? '↪' : fx.IMAGE.test(row.path) ? '▣' : '▤'; }
const humanSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

async function openExplorer() {
  const s = cur();
  if (!s) return;
  if (!vmInst || !/ready/.test(vmInst.status())) {
    const go = await modal({ title: 'The machine is not running', body: 'The explorer reads the machine’s files. Start it now?', actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Start the machine', value: true, primary: true }] });
    if (!go || !(vmWanted() && vmReady())) { if (go) machineDiag(); setPane('machine'); return; }
    await vm().run('true', 120, { quiet: true, label: 'start' });
  }
  const st = await fsMark(s);
  $('#explorer')?.remove();
  const tree = h('div', { class: 'xtree', role: 'tree' }), tabs = h('div', { class: 'xtabs' }), view = h('div', { class: 'xview' }, h('p', { class: 'note', text: 'Open a file from the tree.' }));
  const filter = h('select', { class: 'xfilter' }, h('option', { value: 'all', text: 'all files' }), h('option', { value: 'changed', text: 'changed since this session started' }));
  const pinIn = h('input', { class: 'mono', placeholder: '/path to pin' });
  const pinBox = h('div', { class: 'xpins' });
  const close = btn('✕', { class: 'xclose', title: 'close (Escape)' });
  const panel = h('div', { id: 'explorer', role: 'dialog', 'aria-label': 'Files' },
    h('header', {}, h('b', { text: 'Files' }), h('span', { class: 'note', text: s.title }), filter, btn('refresh', { 'data-x': 'refresh' }), btn('find deleted', { 'data-x': 'deleted' }), close),
    h('div', { class: 'xbody' }, h('aside', {}, pinBox, h('div', { class: 'xpinadd' }, pinIn, btn('pin', { 'data-x': 'pin' })), tree), h('section', {}, tabs, view)));
  document.body.append(panel);
  const shut = () => { panel.remove(); removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape' && !document.querySelector('.modal')) { e.stopPropagation(); shut(); } };
  addEventListener('keydown', esc, true);
  close.onclick = shut;

  const badge = row => { const k = fx.status(row, st.mark, st.base); return k === 'existing' ? '' : h('span', { class: 'xst', 'data-st': k, title: k === 'new' ? 'made since this session started' : 'changed since this session started', text: k === 'new' ? 'N' : 'M' }); };
  const nodeOf = (row, depth) => {
    const name = row.path.split('/').pop() || row.path;
    const line = h('div', { class: 'xnode', role: 'treeitem', tabindex: '0', 'data-path': row.path, 'data-type': row.type, style: `--d:${depth}` },
      h('span', { class: 'xicon', text: fileIcon(row) }), h('span', { class: 'xname', 'data-full': row.path, text: name }), badge(row), row.type === 'file' ? h('span', { class: 'xsize', text: humanSize(row.size) }) : '');
    const kids = h('div', { class: 'xkids', hidden: '' });
    const wrap = h('div', {}, line, kids);
    const toggle = async () => {
      if (row.type !== 'dir') return openFile(row);
      if (!kids.hidden) { kids.hidden = true; line.querySelector('.xicon').textContent = '▸'; return; }
      line.querySelector('.xicon').textContent = '▾'; kids.hidden = false;
      if (!kids.dataset.loaded) {
        kids.replaceChildren(h('div', { class: 'xnode note', style: `--d:${depth + 1}`, text: 'loading…' }));
        const r = await vm().run(fx.listCmd(row.path), 60, { quiet: true, label: 'list ' + row.path });
        const rows = fx.parse(r.out).sort((a, b) => (a.type === 'dir') === (b.type === 'dir') ? a.path.localeCompare(b.path) : a.type === 'dir' ? -1 : 1);
        kids.replaceChildren(...(rows.length ? rows.map(x => nodeOf(x, depth + 1)) : [h('div', { class: 'xnode note', style: `--d:${depth + 1}`, text: '(empty)' })]));
        kids.dataset.loaded = '1';
      }
    };
    line.addEventListener('click', toggle);
    line.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    return wrap;
  };
  const drawPins = () => pinBox.replaceChildren(...pinsOf(s).map(p => h('span', { class: 'hkind', text: p }, h('button', { type: 'button', class: 'xunpin', 'data-pin': p, title: 'unpin', text: '×' }))));
  async function draw() {
    drawPins();
    if (filter.value === 'all') { tree.replaceChildren(...pinsOf(s).map(p => nodeOf({ type: 'dir', path: p, size: 0, mtime: 0 }, 0))); for (const n of tree.querySelectorAll(':scope > div > .xnode')) n.click(); return; }
    // changed only: the paths newer than the mark, with their folders, all open
    tree.replaceChildren(h('p', { class: 'note', text: 'looking…' }));
    const rows = fx.parse((await vm().run(fx.changedCmd(s.id, pinsOf(s)), 120, { quiet: true, label: 'find what changed since the session started' })).out).filter(r => r.type !== 'dir' || fx.status(r, st.mark, st.base) === 'new');
    if (!rows.length) { tree.replaceChildren(h('p', { class: 'note', text: 'Nothing changed in the pinned folders since this session started.' })); return; }
    tree.replaceChildren(...rows.sort((a, b) => a.path.localeCompare(b.path)).map(r => nodeOf(r, (r.path.match(/\//g) || []).length - 1)));
  }
  async function openFile(row) {
    let tab = tabs.querySelector(`[data-tab="${CSS.escape(row.path)}"]`);
    if (!tab) {
      tab = h('div', { class: 'xtab', 'data-tab': row.path }, h('span', { 'data-full': row.path, text: row.path.split('/').pop() }), h('button', { type: 'button', class: 'xtabx', title: 'close', text: '×' }));
      tab.addEventListener('click', e => { if (e.target.classList.contains('xtabx')) { tab.remove(); const next = tabs.lastElementChild; next ? next.click() : view.replaceChildren(h('p', { class: 'note', text: 'Open a file from the tree.' })); return; } show(row, tab); });
      tabs.append(tab);
    }
    show(row, tab);
  }
  async function show(row, tab) {
    for (const t of tabs.children) t.toggleAttribute('data-on', t === tab);
    view.replaceChildren(h('p', { class: 'note', text: 'reading ' + row.path + '…' }));
    const f = fx.decode((await vm().run(fx.readCmd(row.path), 120, { quiet: true, label: 'read ' + row.path })).out);
    if (!f || f.size < 0) { view.replaceChildren(h('p', { class: 'note bad', text: 'Could not read ' + row.path })); return; }
    const k = fx.status(row, st.mark, st.base);
    const bar = h('div', { class: 'xbar' }, h('code', { text: row.path }), h('span', { class: 'note', text: `${humanSize(f.size)}${k !== 'existing' ? ' · ' + k + ' since this session started' : ''}${f.truncated ? ' · first ' + humanSize(f.bytes.length) + ' shown' : ''}` }));
    const copyPath = btn('copy path'); copyPath.onclick = () => navigator.clipboard.writeText(row.path);
    const dl = btn('download'); dl.onclick = () => { const a = h('a', { href: URL.createObjectURL(new Blob([f.bytes])), download: row.path.split('/').pop() }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    const acts = h('div', { class: 'acts' }, copyPath, dl);
    let body;
    if (fx.IMAGE.test(row.path)) body = h('img', { class: 'ximg', alt: row.path, src: URL.createObjectURL(new Blob([f.bytes], { type: fx.mimeOf(row.path) })) });
    else if (f.binary) body = h('pre', { class: 'xcode', text: `binary file, ${humanSize(f.size)}\n\n` + [...f.bytes.subarray(0, 256)].map(b => b.toString(16).padStart(2, '0')).join(' ').replace(/(.{48})/g, '$1\n') });
    else {
      const text = new TextDecoder().decode(f.bytes);
      const copyText = btn('copy text'); copyText.onclick = () => navigator.clipboard.writeText(text); acts.prepend(copyText);
      body = h('ol', { class: 'xcode xlines' }, ...text.split('\n').map(l => h('li', { text: l })));
    }
    bar.append(acts);
    view.replaceChildren(bar, body);
  }
  panel.addEventListener('click', async e => {
    const x = e.target.dataset?.x, un = e.target.dataset?.pin;
    if (un) { s.pins = pinsOf(s).filter(p => p !== un); if (!s.pins.length) s.pins = ['/root']; saveSession(s); draw(); }
    if (x === 'pin') { const p = pinIn.value.trim(); if (p.startsWith('/') && !pinsOf(s).includes(p)) { s.pins = [...pinsOf(s), p]; saveSession(s); pinIn.value = ''; draw(); } }
    if (x === 'refresh') draw();
    if (x === 'deleted') {
      const now = new Set(fx.parse((await vm().run(fx.allCmd(pinsOf(s)), 120, { quiet: true, label: 'list everything pinned, to find deletions' })).out).map(r => r.path));
      const gone = [...st.base.keys()].filter(p => !now.has(p));
      view.replaceChildren(h('div', { class: 'xbar' }, h('b', { text: `Deleted since this session started (${gone.length})` })), gone.length ? h('ol', { class: 'xcode' }, ...gone.map(p => h('li', { text: p }))) : h('p', { class: 'note', text: 'Nothing from the baseline is missing.' }));
    }
  });
  filter.addEventListener('change', draw);
  pinIn.addEventListener('keydown', e => { if (e.key === 'Enter') panel.querySelector('[data-x=pin]').click(); });
  draw();
}

// ---------- agent pty: the model's commands in a tmux session ----------

// With settings.vmTmux on, the model's shell calls run in a persistent tmux
// session "agent": typed into its pane, output recorded from the pane, completion
// signalled with tmux wait-for. The person can watch the pane and type into it.
const TMUX = 'agent';
const tmuxReady = new Map(); // user -> promise
const shq = t => "'" + String(t).replace(/'/g, "'\\''") + "'";
const INSTALL_ONLY = /^\s*wh-install(\s+[\w.+-]+)+\s*$/;
function ensureTmux(o = {}) {
  const k = o.user || '';
  if (!tmuxReady.has(k)) tmuxReady.set(k, (async () => {
    await vm().run('command -v tmux >/dev/null || wh-install tmux', 300, { quiet: true, label: 'install tmux' });
    const r = await vm().run(`tmux has-session -t ${TMUX} 2>/dev/null || tmux new-session -d -s ${TMUX} -x 160 -y 48; tmux set -g history-limit 5000 >/dev/null; echo tmux-ok`, 120, { ...o, quiet: true, label: 'start the agent pty (tmux)' + (k ? ' for ' + k : '') });
    if (!/tmux-ok/.test(r.out)) throw new Error('tmux did not start: ' + r.out.slice(-200));
  })().catch(e => { tmuxReady.delete(k); throw e; }));
  return tmuxReady.get(k);
}
async function agentRun(cmd, timeoutS, o = {}) {
  await ensureTmux(o);
  const id = Math.random().toString(36).slice(2, 10), d = '$HOME/.wh';
  const script = `mkdir -p ${d}; cat > ${d}/c-${id}.sh <<'WH_EOF_${id}'\n${cmd}\nWH_EOF_${id}\n: > ${d}/o-${id}\n`
    + `tmux pipe-pane -t ${TMUX} -o "cat >> ${d}/o-${id}"\n`
    + `tmux send-keys -t ${TMUX} "bash ${d}/c-${id}.sh; echo \\$? > ${d}/r-${id}; tmux wait-for -S d-${id}" Enter\n`
    + `timeout ${timeoutS} tmux wait-for d-${id} || { tmux send-keys -t ${TMUX} C-c; sleep 1; echo "[timed out after ${timeoutS}s; interrupted]" >> ${d}/o-${id}; }\n`
    + `tmux pipe-pane -t ${TMUX}\n`
    + `sed -e 's/\\x1b\\[[0-9;?]*[ -\\/]*[@-~]//g' -e 's/\\x1b[()][0-9A-B]//g' -e 's/\\r//g' ${d}/o-${id} | grep -v ${shq(`c-${id}.sh`)}\n`
    + `s=$(cat ${d}/r-${id} 2>/dev/null || echo 124); rm -f ${d}/?-${id}*; exit $s`;
  const r = await vm().run(script, timeoutS + 30, { ...o, display: cmd });
  return { ...r, timedOut: /\[timed out after \d+s; interrupted\]/.test(r.out) || r.timedOut };
}
// The guest's GitHub credential, added by the page (machineGh "inject", the default):
// a repository call gets that repository's token (App: minted for it; else the PAT),
// a call that names no repository (gh api user, gh auth status) gets the PAT.
async function vmToken(repo, level) {
  if (repo && gh.mode() === 'app') { try { return await gh.token(repo, level); } catch (e) { if (!state.keys.github) throw e; } }
  if (state.keys.github) return state.keys.github;
  if (gh.mode() === 'app') throw new Error(repo ? 'the App could not mint a token for ' + repo : 'App tokens are minted per repository and this call names none; add a personal access token in GitHub settings for account-level calls');
  return '';
}
// machineGh "env": the conventional way. The session's own user gets GH_TOKEN = the
// PAT in its environment (a 600 file in its 700 home); the model can read it then.
const ghFile = new Map(); // user -> 'env' | 'inject' (this boot)
async function syncGhFile(s) {
  const u = userOf(s), mode = cfg(s).machineGh === 'env' ? 'env' : 'inject';
  if (!u || ghFile.get(u) === mode) return;
  if (mode === 'env') {
    if (!state.keys.github) throw new Error('machineGh "env" needs a personal access token in GitHub settings');
    await vm().run(`id ${u} >/dev/null 2>&1 || adduser -D -s /bin/bash ${u} >/dev/null 2>&1; mkdir -p /home/${u}/.wh; umask 077; printf %s ${shq(state.keys.github)} > /home/${u}/.wh/gh; chown -R ${u}:${u} /home/${u}/.wh; chmod 600 /home/${u}/.wh/gh`, 60, { quiet: true, label: `give ${u} the GitHub token (machineGh env)`, display: '' });
  } else if (ghFile.has(u)) await vm().run(`rm -f /home/${u}/.wh/gh`, 30, { quiet: true, label: `take the GitHub token from ${u}` });
  ghFile.set(u, mode);
}
const secretsNow = () => [...Object.values(state.keys).filter(v => typeof v === 'string'), ...gh.secrets()];
const hooksOn = dir => state.meta.settings.termHooks?.[dir] ?? termx.DEFAULT_ON[dir];
const down = text => termx.apply('down', text, { secrets: secretsNow() }, hooksOn('down')).text;

// Scratch helper: the helper model drafts commands for the person, testing them first
// as the scratch user (home /home/uscratch, 50 MB, 30 s per try), at most 3 rounds.
async function scratchDraft(ask, onStep = () => {}) {
  const s = cur(), model = (s && (cfg(s).helper || cfg(s).model)) || state.meta.settings.helper || state.meta.settings.model;
  if (!model) throw new Error('choose a model (or a helper model) first');
  let text = `TASK: ${ask}\nTHE PERSON'S SESSION USER: ${s ? userOf(s) || 'root' : 'root'} (home ${s ? homeOf(s) : '/root'})`;
  const tries = [];
  for (let round = 0; round < 4; round++) {
    const reply = await aux(s, model, termx.SCRATCH_SYSTEM, text, 'scratch', 700);
    const p = termx.parseScratch(reply);
    if (p.commands.length || !p.tries.length || round === 3) return { ...p, tries, reply };
    for (const t of p.tries) {
      onStep({ trying: t });
      const r = vmInst && /ready/.test(vmInst.status()) ? await vm().run(t, 30, { user: 'uscratch', quotaMB: 50, quiet: true, label: 'scratch: ' + t.slice(0, 80) }) : { out: 'not run: the machine is not started', code: null };
      const out = down(r.out || '').slice(0, 1500);
      tries.push({ cmd: t, code: r.code, out });
      text += `\n\nTRIED: ${t}\nEXIT: ${r.timedOut ? 'timed out' : r.code}\nOUTPUT:\n${out || '(none)'}`;
    }
  }
}

// what the shell tool runs on for a session: its own user, plain or in its agent pty
// (installing a package is one command of its own, run as root)
// (results pass the "down" hooks: known secrets are masked before the model reads them)
function shellRunner(s) {
  const o = shellOpt(s);
  const go = async (cmd, t, opt) => { await syncGhFile(s); return INSTALL_ONLY.test(cmd) ? vm().run(cmd, t, { ...opt, session: s.id }) : state.meta.settings.vmTmux ? agentRun(cmd, t, o) : vm().run(cmd, t, { ...o, ...opt }); };
  return { run: (cmd, t, opt = {}) => go(cmd, t, opt).then(r => ({ ...r, out: down(r.out || '') })) };
}

// ---------- machine status: what is on, what is missing, and why ----------

// Each condition the machine needs, checked as it stands now, for the current session.
async function machineDiag() {
  const s = cur(), e = s ? eff(s) : null;
  let sw = 'not supported';
  try { if (navigator.serviceWorker) { const reg = await navigator.serviceWorker.getRegistration(); sw = reg ? (navigator.serviceWorker.controller ? 'registered, controlling this page' : 'registered, not controlling this page yet') : 'not registered'; } } catch { sw = 'unavailable'; }
  const rows = [
    ['switched on in Defaults', vmWanted(), vmWanted() ? 'on' : 'off: Defaults and connections → Linux machine'],
    ['page is cross-origin isolated', vmReady(), vmReady() ? 'yes' : `no (service worker: ${sw}${!isSecureContext ? '; not a secure context' : ''}). ${vmWanted() ? 'Reload once; if it stays "no", the browser is blocking the service worker (private window, blocked site data or an extension).' : ''}`],
    ['this session has the shell tool', !!s?.tools?.includes('vm'), s?.tools?.includes('vm') ? 'yes' : 'no: System prompt → "Linux machine (shell tool)" switch, or a new session'],
    ['its scope allows the machine', !!e?.caps.vm, e?.caps.vm ? 'yes' : `no: denied by ${e?.capFrom.vm || 'its profile'}`],
    ['machine started', !!vmInst && /ready/.test(vmInst.status()), vmInst ? vmInst.status() : 'not yet: it starts when a session first uses it, or with "start now"'],
    ['runs in', true, !vmInst || vmInst.role() === 'idle' ? 'whichever tab needs it first (or open a machine tab)' : vmInst.role() === 'host' ? (MACHINE_TAB ? 'this machine tab' : 'this tab: closing or reloading it stops the machine (homes are saved for an update)') : `another tab (${vmInst.host()?.dedicated ? 'the machine tab' : 'tab ' + vmInst.host()?.tab}, build ${vmInst.host()?.version || '?'})`],
    ['this session’s user', true, s ? (userOf(s) ? `${userOf(s)} (home ${homeOf(s)}, quota ${shellOpt(s).quotaMB || 'none'} MB)` : 'root (/root)') : '-'],
  ];
  const box = $('#vmdiag');
  const start = btn('start now', { class: 'primary' });
  start.disabled = !(vmWanted() && vmReady()) || (vmInst && /ready|booting|loading|downloading|waiting/.test(vmInst.status()));
  start.onclick = async () => { start.disabled = true; try { await vm().run('true', 60, { quiet: true, label: 'start' }); } catch {} machineDiag(); };
  const recheck = btn('check again'); recheck.onclick = () => machineDiag();
  box.replaceChildren(h('div', { class: 'sgroup' }, h('div', { class: 'shead' }, h('span', { text: 'Machine' }), h('span', { class: 'note', text: rows.every(r => r[1]) ? 'ready' : 'what it needs, for this session' })),
    ...rows.map(([label, ok, detail]) => h('div', { class: 'vrow', 'data-ok': String(!!ok) }, h('span', { class: 'vmark', text: ok ? '✓' : '·' }), h('span', { class: 'slabel', text: label }), h('span', { class: 'vdetail', text: detail })))),
    h('div', { class: 'cfgbar' }, start, recheck, btn('explore files', { 'data-act': 'explore' }),
      MACHINE_TAB ? '' : btn('open a machine tab', { 'data-act': 'machinetab', title: 'A tab that only runs the machine: sessions in other tabs share it, and it stays up through site updates' }),
      vmInst?.role() === 'client' ? btn('move it to this tab', { 'data-act': 'vmhere', title: 'The machine saves its homes, stops there and starts here with them' }) : '',
      vmInst?.role() === 'host' && /ready/.test(vmInst.status()) ? btn('save homes now', { 'data-act': 'vmsave', title: 'Kept in this browser; restored by the next start' }) : ''),
    h('div', { id: 'vmjobs' }));
  renderJobs();
  return rows;
}

// running commands across every tab's sessions, with a stop button each
async function renderJobs() {
  const box = $('#vmjobs');
  if (!box || !vmInst || vmInst.role() === 'idle') return;
  const jobs = await vmInst.jobs().catch(() => []);
  box.replaceChildren(...(jobs.length ? [h('div', { class: 'shead' }, h('span', { text: 'Running now' }), h('span', { class: 'note', text: String(jobs.length) })),
    ...jobs.map(j => h('div', { class: 'jrow' }, h('span', { class: 'vmark', text: '▸' }), h('span', { class: 'slabel', text: (j.user || 'root') + (j.session && state.sessions[j.session] ? ' · ' + state.sessions[j.session].title : '') }), h('span', { class: 'vdetail', text: `${Math.round(j.ms / 1000)} s · ${String(j.label || j.cmd).slice(0, 120)}` }), btn('stop', { 'data-job': j.id })))] : []));
  if (jobs.length && state.meta.settings.pane === 'machine') { clearTimeout(renderJobs.t); renderJobs.t = setTimeout(renderJobs, 2000); }
}

// ---------- one session per tab, and every tab together (coord.js) ----------

// A session runs in one tab at a time: the tab holding the Web Lock "wh-s:<id>".
// Another tab shows it read-only, follows it through storage events, and can take it over.
const owned = new Map(), foreign = new Set(); // session id -> release; sessions another tab holds
const owns = id => !foreign.has(id); // a claim still being granted counts as ours
function setReadOnly(id, on) {
  if (state.meta.active !== id) return;
  app.toggleAttribute('data-readonly', on);
  $('#rohint').hidden = !on;
  if (on) slot($('#rotext'), 'This session is open in another tab, which runs it; this view follows it.');
}
function claimSession(id, steal = false) {
  for (const [k, rel] of [...owned]) if (k !== id && k !== runningId) { rel(); owned.delete(k); }
  if (owned.has(id) || !navigator.locks) { setReadOnly(id, false); continueGated(); return; }
  navigator.locks.request('wh-s:' + id, steal ? { steal: true } : { ifAvailable: true }, lock => {
    if (!lock) { foreign.add(id); setReadOnly(id, true); return; }
    foreign.delete(id); setReadOnly(id, false);
    setTimeout(continueGated, 0);
    return new Promise(r => owned.set(id, r));
  }).catch(() => { owned.delete(id); foreign.add(id); if (runningId === id) ctl?.abort(); setReadOnly(id, true); }); // taken over by another tab
}
// another tab saved: take its version of what this tab does not own
function adopt(e) {
  if (!e.newValue) return;
  let v; try { v = JSON.parse(e.newValue); } catch { return; }
  if (e.key === 'wh:meta') {
    const active = state.meta.active;
    state.meta = { ...v, active, settings: { provider: 'openrouter', model: '', inspector: true, ...v.settings } };
    for (const id of state.meta.order) if (!state.sessions[id]) { try { const x = JSON.parse(localStorage.getItem('wh:s:' + id)); if (x) state.sessions[id] = x; } catch {} }
    redrawSessions(); renderPads();
  } else if (e.key.startsWith('wh:s:') && v?.id && !owned.has(v.id)) {
    state.sessions[v.id] = v;
    $(`.thread[data-session="${v.id}"]`)?.remove();
    if (state.meta.active === v.id) { thread(v); scrollDown(); }
  }
}
// a session stopped at a halt gate continues once the halt is off (also after a reload)
function continueGated() {
  const s = cur();
  if (!s?.resume || busy || co?.halted() || !owns(s.id)) return;
  delete s.resume; saveSession(s);
  notice(s, 'Continuing from the gate where the halt stopped this session.');
  run(s);
}
function renderCoord() {
  if (!co || !app) return;
  const h0 = co.halted(), tabs = co.tabs();
  const waiting = tabs.reduce((n, t) => n + (t.waiting?.length || 0), 0), running = tabs.filter(t => t.active > 0).length;
  $('[data-act=haltall]').hidden = !!h0; $('[data-act=stepall]').hidden = !h0 || h0.mode === 'update'; $('[data-act=resumeall]').hidden = !h0;
  const st = $('#coordstat');
  slot(st, `${tabs.length} tab${tabs.length === 1 ? '' : 's'}${h0 ? ` · halted (${h0.reason}) · ${waiting} at a gate · ${running} finishing` : running ? ` · ${running} running` : ''}`);
  st.title = tabs.map(t => `${t.tab === TAB ? 'this tab' : t.tab}: v${t.version}${t.dedicated ? ' (machine tab)' : ''}${t.machine === 'host' ? ' · runs the machine' : ''} · ${t.active} running · ${t.waiting?.length || 0} at a gate${t.session && state.sessions[t.session] ? ' · ' + state.sessions[t.session].title : ''}`).join('\n');
  if (!h0) continueGated();
}
let pub = null;
async function checkPublished() {
  const v = await published(); if (!v) return;
  pub = v;
  const newer = (v.build && bootEnv?.build && v.build !== bootEnv.build) || (v.version && v.version !== VERSION);
  const b = $('#updbtn'); if (!b) return;
  b.hidden = !newer || MACHINE_TAB;
  if (newer) { slot(b, `update to v${v.version}`); b.title = `Published: v${v.version}${v.build ? ' (' + v.build.slice(0, 7) + ')' : ''}; this tab runs v${VERSION}. Halts every session at a safe point, reloads the tabs, and continues.`; }
}
// The update: halt everything at the request gate, wait until every tab is at
// rest, save and restart the machine only when its protocol changed, reload the
// tabs onto the new build; the first tab on the new build resumes (finishUpdate).
async function updateAll() {
  const v = pub || await published();
  if (!v) return;
  const hostProto = vmInst?.role() === 'host' ? MPROTO : vmInst?.host()?.proto;
  const restartMachine = hostProto != null && Number(v.machine ?? MPROTO) !== hostProto;
  const dedicated = vmInst?.role() === 'client' && vmInst.host()?.dedicated;
  const ok = await modal({ title: `Update every tab to v${v.version}`, body: `Every session stops at its next model request (tool calls already running finish first). Then the tabs reload onto the new build and the stopped sessions go on. ${restartMachine ? 'The machine has to restart for this build: its homes are saved (up to 4 MB) and put back.' : dedicated ? 'The machine tab keeps running; the machine is not touched.' : vmInst && vmInst.role() !== 'idle' ? 'The machine runs in a session tab, so it restarts with that tab: its homes are saved (up to 4 MB) and put back. A machine tab avoids this.' : ''}`, actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Update', value: true, primary: true }] });
  if (!ok) return;
  co.halt(`update to v${v.version}`, 'update', { to: v.version, build: v.build || '', restartMachine });
  const t0 = Date.now();
  for (;;) {
    const tabs = await co.poll(600), busyTabs = tabs.filter(t => t.active > 0);
    slot($('#coordstat'), `updating: waiting for ${busyTabs.length} tab${busyTabs.length === 1 ? '' : 's'} to reach a safe point`);
    if (!busyTabs.length) break;
    if (Date.now() - t0 > 600e3) {
      const go = await modal({ title: 'Some tabs are still running', body: busyTabs.map(t => `${t.tab}: ${t.active} running`).join('\n') + '\n\nA tool call can run up to its own timeout.', actions: [{ text: 'Keep waiting', value: false }, { text: 'Reload anyway', value: true, primary: true }] });
      if (go) break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  co.reload({ restartMachine });
  await onCoordReload({ restartMachine });
}
async function onCoordReload(x) {
  if (vmInst?.role() === 'host' && /ready|booting|loading|downloading|waiting/.test(vmInst.status())) {
    if (MACHINE_TAB && !x.restartMachine) { slot($('#vmstat'), 'Machine: kept running through the update'); return; }
    slot($('#vmstat'), 'Machine: saving the homes before the reload');
    await vmInst.restart().catch(() => {});
  }
  location.reload();
}
// after a reload: the first tab on the new build waits for the others, then resumes
async function finishUpdate() {
  const h0 = co.halted();
  if (h0?.mode !== 'update') return;
  if (h0.to !== VERSION) {
    let tried = false; try { tried = sessionStorage.getItem('wh:upd-retry') === h0.id; sessionStorage.setItem('wh:upd-retry', h0.id); } catch {}
    if (!tried && !MACHINE_TAB) { location.reload(); return; }
    slot($('#coordstat'), `this tab loaded v${VERSION}, the update is to v${h0.to}: reload it`);
    return;
  }
  if (!navigator.locks) return co.resume();
  await navigator.locks.request('wh-coord-lead', { ifAvailable: true }, async lock => {
    if (!lock) return;
    for (let i = 0; i < 90 && co.halted()?.id === h0.id; i++) {
      const tabs = await co.poll(800);
      const behind = tabs.filter(t => t.version !== h0.to && !(t.dedicated && !h0.restartMachine));
      if (!behind.length) { co.resume(); return; }
      slot($('#coordstat'), `updating: ${behind.length} tab${behind.length === 1 ? '' : 's'} not on v${h0.to} yet`);
      await new Promise(r => setTimeout(r, 1000));
    }
  });
}

// ---------- the Linux machine (vm.js) ----------

// One machine per page load, shared by the sessions that have the shell tool.
// Its terminal lives in the Machine pane: every byte the guest prints is shown.
let vmInst = null;
function vm() {
  if (vmInst) return vmInst;
  vmInst = sharedMachine({
    tab: TAB, dedicated: MACHINE_TAB, info: () => ({ version: VERSION }),
    local: cb => machine({ token: vmToken, trace, onStatus: cb.onStatus, showHarness: () => !!state.meta.settings.vmShowHarness }),
  });
  vmInst.onStatus(t => { if (!/ready/.test(t)) ghFile.clear(); slot($('#vmstat'), 'Machine: ' + t + (vmInst.role() === 'client' ? ' (in another tab)' : '')); link?.emit('notice', { session: 'machine', text: t }); machineDiag(); });
  vmInst.onRole(() => { machineDiag(); co?.announce(); });
  mountMachine();
  return vmInst;
}
// The Machine pane's terminal: the same in every tab (the host's bytes come over the channel).
function mountMachine() {
  const type = d => vmInst.send(d);
  {
    {
      const box = $('#vmterm');
      // Terminal: what went in and what came out, in order. Harness activity: its own list.
      const term = h('div', { class: 'vmout', role: 'log', 'aria-label': 'terminal' });
      const acts = h('div', { class: 'vmacts', role: 'log', 'aria-label': 'harness activity', hidden: '' });
      const tabT = btn('terminal', { class: 'vmtab', 'data-on': '' }), tabH = btn('harness activity', { class: 'vmtab' }), tabP = btn('agent pty', { class: 'vmtab', title: 'the tmux session the model’s commands run in' });
      const ptyView = h('pre', { class: 'vmpty', 'aria-label': 'agent pty', hidden: '' }), ptyIn = h('input', { class: 'vmin', placeholder: 'type into the agent pty; Enter sends (Ctrl-C button interrupts)', hidden: '' });
      const ptyBar = h('div', { class: 'vmptybar', hidden: '' }, h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', id: 'vmtmux' }), { checked: !!state.meta.settings.vmTmux }), ' run the model’s commands in this pty (tmux)'), btn('Ctrl-C', { 'data-pty': 'C-c' }));
      let ptyTimer = null;
      const ptyPoll = async () => {
        if (ptyView.hidden) { ptyTimer = null; return; }
        try { const o = shellOpt(cur()); await ensureTmux(o); const r = await vm().run(`tmux capture-pane -p -t ${TMUX} -S -200`, 20, { ...o, quiet: true, silent: true }); ptyView.textContent = r.out.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\r/g, ''); ptyView.scrollTop = ptyView.scrollHeight; }
        catch (e) { ptyView.textContent = 'The agent pty is not available: ' + (e.message || e); }
        ptyTimer = setTimeout(ptyPoll, 1500);
      };

      ptyBar.addEventListener('click', async e => { const k = e.target.dataset?.pty; if (k) { const o = shellOpt(cur()); await ensureTmux(o); await vm().run(`tmux send-keys -t ${TMUX} ${k}`, 20, { ...o, quiet: true, label: 'sent ' + k + ' to the agent pty' }); } });
      ptyBar.querySelector('#vmtmux').addEventListener('change', e => { state.meta.settings.vmTmux = e.target.checked; saveMeta(); });
      const nAct = h('span', { class: 'count slot' });
      tabH.append(' ', nAct);
      const pick = which => {
        term.hidden = which !== 'term'; line.hidden = which !== 'term'; acts.hidden = which !== 'acts'; panel.hidden = which === 'acts';
        ptyView.hidden = ptyIn.hidden = ptyBar.hidden = which !== 'pty';
        tabT.toggleAttribute('data-on', which === 'term'); tabH.toggleAttribute('data-on', which === 'acts'); tabP.toggleAttribute('data-on', which === 'pty');
        if (which === 'pty' && !ptyTimer) ptyPoll();
      };
      tabT.onclick = () => pick('term'); tabH.onclick = () => pick('acts'); tabP.onclick = () => pick('pty');
      const line = h('input', { class: 'vmin', placeholder: 'a command for the machine (root); Enter runs it, ↑ ↓ your history; interactive programs: agent pty' });
      const raw = Object.assign(h('input', { type: 'checkbox', id: 'vmraw' }), { checked: !!state.meta.settings.vmShowHarness });
      raw.addEventListener('change', () => { state.meta.settings.vmShowHarness = raw.checked; saveMeta(); });
      // ---- the person's commands: "up" hooks, history, send again, keys a phone keyboard lacks ----
      // the target is the tab in view: the machine's terminal (root) or this session's agent pty
      for (const el of [line, ptyIn]) for (const [k, v] of Object.entries({ autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'send' })) el.setAttribute(k, v);
      const target = () => ptyView.hidden ? 'terminal' : 'pty';
      const field = () => target() === 'pty' ? ptyIn : line;
      const lastBtn = btn('', { class: 'slot vmlast', 'data-cmd': 'again', title: 'send the last command you typed into this terminal again' });
      const hist = h('div', { class: 'vmhist', hidden: '' }), scratch = h('div', { class: 'vmscratch', hidden: '' });
      const KEYS = [['Tab', '\t', 'Tab'], ['Ctrl-C', '\x03', 'C-c'], ['Esc', '\x1b', 'Escape'], ['↑', '\x1b[A', 'Up'], ['|'], ['~'], ['/'], ['-'], ['$'], ['&&', ' && '], ['>'], ["'"], ['"']];
      const keys = h('div', { class: 'vmkeys' }, ...KEYS.map(([l, v, tm]) => btn(l, { 'data-k': l, title: tm ? 'send ' + l + ' now' : 'insert ' + l })));
      const cmdbar = h('div', { class: 'vmcmdbar' }, lastBtn, btn('history', { 'data-cmd': 'hist' }), btn('scratch', { 'data-cmd': 'scratch', title: 'draft commands with the helper model; it can test them in a scratch account first' }), btn('hooks', { 'data-cmd': 'hooks', title: 'filters on what you send and what comes back' }), keys);
      const ensureOn = async () => { if (!/ready/.test(vmInst.status())) await vm().run('true', 300, { quiet: true, label: 'start' }); };
      async function sendTo(tg, text) {
        const { text: cmd, changed } = termx.apply('up', text, {}, hooksOn('up'));
        if (!cmd.trim()) return;
        if (changed.length) addAct(`your input changed by: ${changed.join(', ')}`, `${JSON.stringify(text)} → ${JSON.stringify(cmd)}`, 'hook');
        termx.remember(cmd, tg); showLast(); if (!hist.hidden) renderHist();
        await ensureOn();
        if (tg === 'pty') { const o = shellOpt(cur()); await ensureTmux(o); await vm().run(`tmux send-keys -t ${TMUX} -l ${shq(cmd)}; tmux send-keys -t ${TMUX} Enter`, 20, { ...o, quiet: true, label: 'typed into the agent pty' }); }
        // as a job, like every other command: free-form text never reaches the console the
        // harness writes its jobs to (an open quote there would stall every session)
        else await vm().run(cmd, 900, { by: 'you', display: cmd });
      }
      async function sendKey(tg, raw, tm) {
        await ensureOn();
        if (tg === 'pty') { const o = shellOpt(cur()); await ensureTmux(o); await vm().run(`tmux send-keys -t ${TMUX} ${tm}`, 20, { ...o, quiet: true, label: 'sent ' + tm + ' to the agent pty' }); }
        else if (tm === 'C-c') { for (const j of await vmInst.jobs()) if (j.by === 'you') await vmInst.cancel(j.id); addAct('Ctrl-C: stopped your running commands', '', 'hook'); }
        else if (tm === 'Up') line.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      }
      const showLast = () => { const l = termx.lastTyped(target()); lastBtn.hidden = !l; if (l) { slot(lastBtn, '↻ ' + (l.cmd.length > 42 ? l.cmd.slice(0, 42) + '…' : l.cmd)); lastBtn.dataset.full = l.cmd; } };
      const renderHist = () => {
        const list = termx.history().filter(e => e.target === target()).sort((a, b) => (b.pinned - a.pinned) || (b.t - a.t));
        hist.replaceChildren(...(list.length ? list.slice(0, 60).map(e => h('div', { class: 'hrow', 'data-c': e.cmd }, h('code', { 'data-cmd': 'load', title: 'put it in the input to edit', text: e.cmd }), h('span', { class: 'note', text: e.n > 1 ? '×' + e.n : '' }), btn('▶', { 'data-cmd': 'send', title: 'send it now' }), btn(e.pinned ? '★' : '☆', { 'data-cmd': 'pin', title: e.pinned ? 'unpin' : 'pin (kept first)' }), btn('×', { 'data-cmd': 'forget', title: 'forget it' }))) : [h('p', { class: 'note', text: 'Commands you type here are listed here.' })]));
      };
      const renderScratch = () => {
        const ask = h('textarea', { rows: '2', placeholder: 'what do you want to do? e.g. find the 10 largest files under my home', ...{ autocapitalize: 'sentences' } });
        const out = h('div', { class: 'scratchout' });
        const go = btn('draft', { class: 'primary' });
        go.onclick = async () => {
          if (!ask.value.trim()) return;
          go.disabled = true; out.replaceChildren(h('p', { class: 'note', text: 'drafting…' }));
          try {
            const r = await scratchDraft(ask.value.trim(), st => out.append(h('p', { class: 'note', text: 'testing: ' + st.trying })));
            out.replaceChildren(
              ...r.tries.map(t => h('details', { class: 'scratchtry' }, h('summary', { text: `tested: ${t.cmd} (${t.code == null ? 'not run' : 'exit ' + t.code})` }), h('pre', { text: t.out || '(no output)' }))),
              ...(r.commands.length ? r.commands.map(c => h('div', { class: 'scratchcmd', 'data-c': c.cmd }, h('code', { text: c.cmd }), c.note ? h('span', { class: 'note', text: c.note }) : '', h('span', { class: 'acts' }, btn('copy', { 'data-cmd': 'copy' }), btn('edit', { 'data-cmd': 'load' }), btn('send', { 'data-cmd': 'send', class: 'primary', title: 'send to the terminal in view' })))) : [h('pre', { class: 'note', text: r.reply || 'no commands came back' })]));
          } catch (e) { out.replaceChildren(h('p', { class: 'note', text: 'scratch helper: ' + (e.message || e) })); }
          go.disabled = false;
        };
        scratch.replaceChildren(h('div', { class: 'scratchask' }, ask, go), out);
      };
      const hookModal = async () => {
        const rows = dir => Object.entries(termx.HOOKS[dir]).map(([k, v]) => h('label', { class: 'check' }, Object.assign(h('input', { type: 'checkbox', 'data-hk': dir + ':' + k }), { checked: hooksOn(dir).includes(k) }), ' ' + v.label));
        const body = h('div', {}, h('b', { text: 'What you send (up)' }), ...rows('up'), h('b', { text: 'What comes back (down): the terminal and the shell tool’s result' }), ...rows('down'));
        const ok = await modal({ title: 'Terminal hooks', body, actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'Save', value: true, primary: true }] });
        if (!ok) return;
        const next = { up: [], down: [] };
        for (const c of body.querySelectorAll('[data-hk]')) if (c.checked) { const [d, k] = c.dataset.hk.split(':'); next[d].push(k); }
        state.meta.settings.termHooks = next; saveMeta();
      };
      // history walk with ↑ ↓ in the input
      let walk = -1;
      for (const el of [line, ptyIn]) el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const v = el.value; el.value = ''; walk = -1; sendTo(target(), v); return; }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const list = termx.history().filter(x => x.target === target());
        if (!list.length) return;
        e.preventDefault();
        walk = Math.max(-1, Math.min(list.length - 1, walk + (e.key === 'ArrowUp' ? 1 : -1)));
        el.value = walk < 0 ? '' : list[walk].cmd;
      });
      const panel = h('div', { class: 'vmpanel' }, cmdbar, hist, scratch);
      panel.addEventListener('click', async e => {
        const k = e.target.closest('[data-k]')?.dataset.k, c = e.target.closest('[data-cmd]')?.dataset.cmd, row = e.target.closest('[data-c]')?.dataset.c;
        if (k) { const def = KEYS.find(x => x[0] === k); if (def[2]) sendKey(target(), def[1], def[2]); else { const f = field(), at = f.selectionStart ?? f.value.length; f.value = f.value.slice(0, at) + (def[1] ?? def[0]) + f.value.slice(f.selectionEnd ?? at); f.focus(); f.selectionStart = f.selectionEnd = at + (def[1] ?? def[0]).length; } return; }
        if (c === 'again' && lastBtn.dataset.full) sendTo(target(), lastBtn.dataset.full);
        else if (c === 'hist') { hist.hidden = !hist.hidden; scratch.hidden = true; if (!hist.hidden) renderHist(); }
        else if (c === 'scratch') { scratch.hidden = !scratch.hidden; hist.hidden = true; if (!scratch.hidden && !scratch.firstChild) renderScratch(); }
        else if (c === 'hooks') hookModal();
        else if (c === 'load' && row) { const f = field(); f.value = row; f.focus(); }
        else if (c === 'send' && row) sendTo(target(), row);
        else if (c === 'copy' && row) { try { await navigator.clipboard.writeText(row); } catch {} }
        else if (c === 'pin' && row) { termx.pin(row, e.target.textContent === '☆'); renderHist(); }
        else if (c === 'forget' && row) { termx.forget(row); renderHist(); showLast(); }
      });
      for (const t of [tabT, tabP]) t.addEventListener('click', () => { walk = -1; showLast(); if (!hist.hidden) renderHist(); });
      showLast();
      box.replaceChildren(h('div', { class: 'vmtabs' }, tabT, tabH, tabP, h('label', { class: 'check vmrawsw', title: 'debug: also draw the harness’s own commands in the terminal' }, raw, ' raw')), term, line, acts, ptyBar, ptyView, ptyIn, panel);
      let carry = '', count = 0;
      const addAct = (label, meta, kind = '') => { count++; slot(nAct, count); acts.append(h('div', { class: 'vmact', 'data-kind': kind }, h('span', { class: 'vmt', text: new Date().toLocaleTimeString() }), h('span', { class: 'vml', text: label }), h('span', { class: 'vmm', text: meta || '' }))); acts.scrollTop = acts.scrollHeight; };
      vmInst.onEvent(e => addAct(e.label, e.ms != null ? `${e.ms} ms · ${e.bytes} chars${e.timedOut ? ' · timed out' : e.code ? ' · exit ' + e.code : ''}` : '', e.kind));
      const put = (cls, text) => { term.append(h('div', { class: cls, text })); while (term.childElementCount > 4000) term.firstElementChild.remove(); term.scrollTop = term.scrollHeight; };
      // the console's own bytes (person typing, plumbing) vs a job's result (seg.code set):
      // markers are cut out of a line (the guest may print one with no newline after it)
      const MARK = /__WH_(?:A|D|S|R|SET|NET|UP)_[\w"$()+]*?__/g;
      const flush = () => { const c = raw.checked ? carry : carry.replace(MARK, ''); if (c.trim()) put('vmline', c); carry = ''; };
      const emit = (l, cls) => {
        const rt = /__WH_RUNTIME_POLICY (\S+) (.*?)__/.exec(l);
        if (rt) { addAct(`policy ${rt[1]}: refused ${rt[2]}`, '', 'policy'); if (!raw.checked) return; }
        put(cls, down(l)); // "down" hooks (known secrets masked)
      };
      vmInst.onView(seg => {
        if (seg.k === 'in') { flush(); const [first, ...more] = String(seg.text).split('\n'); put('vmin-line', '$ ' + first); for (const m of more) put('vmin-line', '> ' + m); return; }
        if (seg.code !== undefined || seg.timedOut) { flush(); for (const l of String(seg.text).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g, '').replace(/\n$/, '').split('\n')) if (seg.text) emit(l, 'vmline'); return; }
        const text = carry + seg.text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g, '');
        const parts = text.split('\n'); carry = parts.pop();
        for (const l0 of parts) {
          const l = raw.checked ? l0 : l0.replace(MARK, '');
          if (!raw.checked && (!l.trim() || /__WH_UP_|__WH_NET_|\/var\/wh\/|^\s*stty -echo/.test(l))) continue; // plumbing (the guest echoes what is typed)
          emit(l, seg.k === 'raw' ? 'vmline vmraw' : 'vmline');
        }
      });
      return term;
    }
  }
}

// ---------- log repo (logrepo.js) ----------

// Tracking over time in a private repo of the user's: written by the harness
// alone (system writes, no approval card), synced at session start and on demand.
// A session's log repo is a harness property resolved down its chain; sessions
// are synced to the repo they resolve to. The defaults' repo is set up by hand
// ("set up"); another repo met first through a profile is checked: an empty one
// gets the layout, a missing one is never created silently (a smell, skipped).
const logRepoOf = s => cfg(s).logRepo || '';
const repoReady = repo => repo && (repo === state.meta.settings.logRepo ? !!state.meta.settings.logReady : state.meta.logRepos?.[repo] === 'ready');
async function ensureLogRepo(repo) {
  if (repoReady(repo)) return true;
  if (repo === state.meta.settings.logRepo) return false; // the defaults' repo waits for "set up"
  const l = logs(repo);
  const st = await l.status().catch(() => ({ state: 'error' }));
  if (st.state === 'empty') { await l.init(); }
  else if (st.state !== 'ready') { smells.add({ kind: 'log-repo-unavailable', detail: `${repo}: ${st.state}` }); (state.meta.logRepos ??= {})[repo] = st.state; saveMeta(); return false; }
  (state.meta.logRepos ??= {})[repo] = 'ready'; saveMeta();
  return true;
}
function logs(repoArg) {
  const repo = repoArg || state.meta.settings.logRepo;
  if (!repo) return null;
  const redact = t => [...Object.values(state.keys).filter(v => typeof v === 'string' && v.length > 8), ...gh.secrets()].reduce((x, k) => x.split(k).join('[key]'), t);
  return logRepo({ git: gitClient({ token: gh.token, trace, get, confirm: async () => true }), repo, redact });
}
function logPayload(since, repo = state.meta.settings.logRepo) {
  const list = state.meta.order.map(id => state.sessions[id]).filter(s => s && logRepoOf(s) === repo);
  const ids = new Set(list.map(s => s.id)), isDefault = repo === state.meta.settings.logRepo;
  const sm = smells.all().filter(r => r.session ? ids.has(r.session) : isDefault);
  const steering = [...new Map(list.map(x => [steerOf(x), x])).entries()].map(([fp, x]) => sealedOf(x) ? { fp, sealed: true } : ({ fp, core: corePrompt(x), system: x.system || '', policies: policiesFor(x), profile: eff(x).path, tools: toolsFor(x).map(d => d.function.name) }));
  const sessions = list.filter(x => (x.ledger.at(-1)?.t || x.created) > since).map(x => {
    const sum = k => x.ledger.reduce((n, e) => n + (Number(e[k]) || 0), 0);
    return { session: x.id, parent: x.parent?.id || null, profile: pathOut(x), created: x.created, model: x.ledger.at(-1)?.model || null, steer: steerOf(x), tools: x.tools || [], requests: x.ledger.filter(e => !e.helper).length, side: x.ledger.filter(e => e.helper).length, prompt: sum('prompt'), cached: sum('cached'), completion: sum('completion'), cost: +sum('cost').toFixed(6), smells: sm.filter(r => r.session === x.id).length };
  });
  return { smells: sm, sessions, steering, proposals: isDefault ? smells.proposals() : [] };
}
let logBusy = null;
async function logSync(why) {
  if (logBusy) return logBusy;
  const repos = [...new Set([state.meta.settings.logRepo, ...state.meta.order.map(id => state.sessions[id]).filter(Boolean).map(logRepoOf)].filter(Boolean))];
  if (!repos.length) return null;
  slot($('#logstat'), 'syncing (' + why + ')…');
  logBusy = (async () => {
    const notes = [];
    for (const repo of repos) {
      if (!(await ensureLogRepo(repo).catch(() => false))) continue;
      const l = logs(repo);
      const since = (() => { try { return JSON.parse(localStorage.getItem('wh:logsync') || '{}')[repo]?.t || 0; } catch { return 0; } })();
      try { const r = await l.sync(logPayload(since, repo)); const t = await transcriptSync(l).catch(e => 'transcripts failed: ' + e.message); notes.push(`${repo}: ${r}; ${t}`); }
      catch (e) { notes.push(`${repo}: sync failed: ${e.message}`); smells.add({ kind: 'log-sync-failed', detail: `${repo}: ${e.message}`.slice(0, 200) }); enqueue({ type: 'log-retry', targets: [{ kind: 'repo', id: repo, label: repo }], reason: { kind: 'log-sync-failed', detail: e.message.slice(0, 200) } }); }
    }
    slot($('#logstat'), notes.join(' | ') || 'no log repo ready');
  })().finally(() => { logBusy = null; });
  return logBusy;
}

// ---------- transcripts and artifacts in the log repo (logrepo.js) ----------
//
// Each session's messages go to the log repo's wh-sessions branch as append-only
// chunks, with the outputs and media they cite as artifacts. On by default; a
// session can be kept out. Masked: stored credentials are redacted, values hidden
// from the model are replaced by their {{id}}, media leaves as a file reference.
const MEDIA_MAX = 20 * 1024 * 1024; // larger media is noted, not stored (Git LFS is not reachable from a page)
const DATA_URL = /data:((?:image|audio|video)\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)/g;
const EXT = t => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm' }[t] || t.split('/')[1].replace(/[^\w]/g, '').slice(0, 8) || 'bin');
const shash = t => { let a = 5381, b = 52711; for (let i = 0; i < t.length; i += 7) { const c = t.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36) + t.length.toString(36)).slice(0, 14); };

function maskFor(s) {
  // values the model may not read: their current text becomes {{id}} wherever it appears
  const masks = valuesFor(s).map(v => [v, vals.current(v)]).filter(([, r]) => (r.hidden || r.expose !== 'value') && String(typeof r.value === 'string' ? r.value : JSON.stringify(r.value)).length >= 3)
    .map(([v, r]) => [typeof r.value === 'string' ? r.value : JSON.stringify(r.value), `{{${v.id}}}`]);
  return t => masks.reduce((x, [a, b]) => x.split(a).join(b), t);
}

async function transcriptItems(l) {
  let st = {};
  try { st = JSON.parse(localStorage.getItem('wh:logsync') || '{}')[l.repo] || {}; } catch {}
  const sent = st.sent || {};
  const items = [], artifacts = [];
  for (const s of state.meta.order.map(id => state.sessions[id]).filter(Boolean)) {
    if (s.private || sealedOf(s) || logRepoOf(s) !== l.repo || cfg(s).logTranscripts === false) continue;
    const skipped = [];
    const from = sent[s.id] || 0;
    const mask = maskFor(s);
    const msgs = [];
    for (let i = from; i < s.messages.length; i++) {
      const m = s.messages[i];
      let text = JSON.stringify({ i, role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        x: m.x ? { model: m.x.model, usage: m.x.usage, ms: m.x.ms, tool: m.x.tool, ok: m.x.ok, policy: m.x.policy?.id, values: m.x.values, wire: m.x.wire } : undefined });
      // media out of the line, into files
      text = text.replace(DATA_URL, (all, type, b64) => {
        const name = `media/${shash(b64)}.${EXT(type)}`;
        if (b64.length * 3 / 4 > MEDIA_MAX) { skipped.push({ name, bytes: Math.floor(b64.length * 3 / 4) }); return `artifact:${name} (too large, not stored)`; }
        if (!artifacts.some(a => a.handle === name)) artifacts.push({ handle: name, base64: b64 });
        return `artifact:${name}`;
      });
      text = mask(text);
      msgs.push(JSON.parse(text));
      for (const hd of handlesIn(text)) if (!artifacts.some(a => a.handle === hd)) { const t = await get(hd).catch(() => null); if (typeof t === 'string' && t.length < 500000) artifacts.push({ handle: hd, text: mask(t) }); }
    }
    const meta = { id: s.id, title: s.title, created: s.created, profile: eff(s).path || null, parent: s.parent?.id || null, model: cfg(s).model, messages: s.messages.length, updated: Date.now(), ...(skipped.length ? { skippedMedia: skipped } : {}) };
    if (msgs.length || from === 0) items.push({ session: s.id, meta, messages: msgs, upto: s.messages.length });
  }
  return { items, artifacts };
}
async function transcriptSync(l) {
  const { items, artifacts } = await transcriptItems(l);
  const r = await l.transcripts(items, artifacts);
  let all = {}; try { all = JSON.parse(localStorage.getItem('wh:logsync') || '{}'); } catch {}
  const cur = all[l.repo] ||= {}; cur.sent ||= {};
  for (const it of items) cur.sent[it.session] = it.upto;
  localStorage.setItem('wh:logsync', JSON.stringify(all));
  return r;
}
// after a turn: at most one transcript sync a minute
let transcriptTimer = null, transcriptLast = 0;
function transcriptSoon() {
  if (transcriptTimer || !state.meta.order.some(id => state.sessions[id] && repoReady(logRepoOf(state.sessions[id])) && cfg(state.sessions[id]).logTranscripts !== false)) return;
  transcriptTimer = setTimeout(() => { transcriptTimer = null; transcriptLast = Date.now(); logSync('turn'); }, Math.max(0, 60e3 - (Date.now() - transcriptLast)));
}

// Read a session from the log repo, a chunk at a time.
async function browseTranscripts() {
  const l = logs();
  if (!l || !state.meta.settings.logReady) return modal({ title: 'Transcripts', body: 'Set up a log repo first (Settings).' });
  const list = h('div', { class: 'tlist' }, h('p', { class: 'note', text: 'loading…' }));
  const view = h('div', { class: 'tview' });
  const more = btn('load more', { class: 'tmore', hidden: '' });
  let open = null;
  more.onclick = async () => {
    if (!open || !open.left.length) return;
    const name = open.left.shift();
    more.disabled = true;
    for (const m of await l.chunk(open.id, name)) view.append(h('div', { class: 'trow', 'data-role': m.role }, h('span', { class: 'role', text: `${m.i} ${m.role}${m.x?.tool ? ' ' + m.x.tool : ''}` }), h('pre', { text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? m.tool_calls, null, 1) })));
    more.disabled = false; more.hidden = !open.left.length; more.textContent = `load more (${open.left.length} chunks left)`;
  };
  const ids = await l.sessions().catch(e => { list.replaceChildren(h('p', { class: 'note bad', text: e.message })); return []; });
  list.replaceChildren(...(ids.length ? [] : [h('p', { class: 'note', text: 'No transcripts yet.' })]), ...ids.map(id => {
    const b = btn(id, { class: 'trec' });
    l.meta(id).then(m => { b.textContent = `${m.title} · ${m.messages} messages${m.profile ? ' · ' + m.profile : ''}`; }).catch(() => {});
    b.onclick = async () => { view.replaceChildren(); open = { id, left: await l.chunks(id) }; more.hidden = false; more.click(); };
    return b;
  }));
  return modal({ title: `Transcripts in ${l.repo} (${'wh-sessions'})`, body: [list, view, more], actions: [{ text: 'Close', value: true, primary: true }] });
}

// ---------- token scope check (tokencheck.js) ----------

const intentText = it => it.repos.map(r => `${r.pattern} ${r.need}`).join('\n');
function ghIntent() {
  const set = state.meta.settings;
  if (!set.ghIntent) set.ghIntent = tokencheck.derive({ settings: set, profiles: profiles() });
  return set.ghIntent;
}
function showIntent() {
  const it = ghIntent();
  $('#ghintent').value = intentText(it); $('#ghpulls').checked = !!it.pulls; $('#ghcreate').checked = !!it.create;
  slot($('#ghscopes'), state.meta.settings.ghScopeSummary ? '· last check: ' + state.meta.settings.ghScopeSummary : '');
}
function readIntent() {
  const repos = $('#ghintent').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [pattern, need] = l.split(/\s+/); return { pattern, need: need === 'read' ? 'read' : 'write', why: 'intended' }; }).filter(r => /^[\w.-]+\/[\w.*-]+$/.test(r.pattern));
  state.meta.settings.ghIntent = { repos, pulls: $('#ghpulls').checked, create: $('#ghcreate').checked };
  saveMeta();
  return state.meta.settings.ghIntent;
}
async function checkScopes() {
  const it = readIntent();
  slot($('#ghscopes'), '· checking…');
  let rows;
  try {
    if (gh.mode() === 'app') rows = await tokencheck.checkApp(await appJwt(state.keys.ghapp), it);
    else if (state.keys.github) rows = await tokencheck.check(state.keys.github, it, { probeWrite: $('#ghprobe').checked });
    else rows = [{ check: 'credential', expected: 'a token or a GitHub App', observed: 'none set', status: 'missing' }];
  } catch (e) { rows = [{ check: 'check', expected: 'completed', observed: e.message, status: 'missing' }]; }
  const sum = tokencheck.summary(rows);
  state.meta.settings.ghScopeSummary = `${sum} (${new Date().toLocaleString()})`; saveMeta();
  slot($('#ghscopes'), '· ' + sum);
  const bad = rows.filter(r => r.status === 'missing' || r.status === 'excess');
  if (bad.length) smells.add({ kind: 'token-scope', detail: bad.map(r => `${r.status}: ${r.check}`).join('; ').slice(0, 300) });
  state.meta.settings.ghScopeAt = Date.now(); saveMeta();
  renderSmells();
  return modal({ title: 'Credential scopes', body: [h('p', { class: 'note', text: sum + '. Compared with the intended use; no model was involved.' }),
    h('table', { class: 'audit tcheck' }, h('tr', {}, ...['check', 'expected', 'observed', ''].map(t => h('th', { text: t }))),
      ...rows.map(r => h('tr', { 'data-st': r.status }, h('td', { text: r.check }), h('td', { text: r.expected }), h('td', { text: r.observed }), h('td', { class: 'st', text: r.status }))))] });
}

// ---------- the custodial queue (custodial.js) ----------

const queue = () => (state.meta.queue ??= []);
const priceOf = id => catalogue.find(m => m.id === id)?.pricing || null;
function enqueue(args) {
  const it = cust.enqueue(queue(), args);
  // drop what is long finished, keep the list short
  state.meta.queue = queue().filter(x => x.status === 'queued' || Date.now() - (x.done || x.created) < 7 * 864e5).slice(-200);
  saveMeta(); renderQueue();
  link?.emit('queued', { id: it.id, type: it.type, reason: it.reason, estimate: it.estimate });
  return it;
}
function queueCondense() {
  const items = stewardItems(), helperModel = state.meta.settings.helper;
  if (!items.length || !helperModel) return;
  const sessionsIn = [...new Map(items.map(it => [it.s.id, it.s])).values()];
  enqueue({ type: 'condense', targets: sessionsIn.map(x => ({ kind: 'session', id: x.id, label: x.title })),
    reason: { kind: 'edge', detail: `${items.filter(i => i.kind === 'reply').length} replies waiting to be condensed, ${items.filter(i => i.kind === 'title').length} sessions without a title` },
    inChars: STEWARD_SYSTEM.length + items.reduce((n, it) => n + it.text.length + 12, 0), model: helperModel, price: priceOf(helperModel) });
}
function reviewInput(s) {
  s ||= { core: 3, keep: true, edge: 'marks', system: '' }; // no session: the defaults new sessions get
  const steer = smells.bySteer(state.meta.order.map(id => state.sessions[id]).filter(Boolean).map(x => ({ steer: steerOf(x), requests: x.ledger.filter(e => !e.helper).length })));
  const rows = smells.all().slice(-200).map(r => ({ kind: r.kind, steer: r.steer, tool: r.tool, policy: r.policy, why: r.why, detail: r.detail?.slice(0, 120) }));
  const missed = missedTargets();
  return { steer, rows, text: `TARGETS MISSED:\n${missed.join('\n') || '(none)'}\n\nSTEERING VERSIONS:\n${JSON.stringify(steer)}\n\nRECENT ROWS:\n${rows.map(r => JSON.stringify(r)).join('\n')}\n\nCURRENT CONVENTIONS:\n${corePrompt(s)}\n\nCURRENT POLICIES:\n${policyList().map(p => `${p.name} [${p.tool}${p.on === false ? ', off' : ''}] /${p.pattern}/${p.flags || ''} ${p.rule}`).join('\n')}\n\nCURRENT SYSTEM PROMPT:\n${s.system || '(empty)'}` };
}
// conditions: enough new smells, or any refusal, queue a review
function considerReview(r) {
  const last = state.meta.lastReview || 0, fresh = smells.all().filter(x => x.t > last && !/^(addressed|config-|queue-)/.test(x.kind));
  if (fresh.length < 3 && !/refused/.test(r.kind)) return;
  const s = cur(), set = state.meta.settings, model = set.policyModel || set.helper || set.model;
  const pols = [...new Set(fresh.map(x => x.policy).filter(Boolean))], kinds = [...new Set(fresh.map(x => x.kind))];
  enqueue({ type: 'review', targets: [...pols.map(p => ({ kind: 'policy', id: p, label: p })), ...kinds.map(k => ({ kind: 'smell', id: k, label: k }))],
    reason: { kind: r.kind, policy: r.policy, detail: `${fresh.length} smells since the last review: ${kinds.join(', ')}` },
    inChars: smells.REVIEW_SYSTEM.length + reviewInput(s).text.length, model, price: priceOf(model) });
}
async function runReview() {
  const s = cur() || Object.values(state.sessions)[0], set = state.meta.settings, model = set.policyModel || set.helper || set.model;
  const inp = reviewInput(s);
  const text = await aux(s, model, smells.REVIEW_SYSTEM, inp.text, 'review', cust.TYPES.review.maxOut).catch(e => 'review failed: ' + (e.message || e));
  const list = smells.proposals();
  list.push({ id: 'r' + Date.now().toString(36), t: Date.now(), model, text, status: 'pending', basis: { rows: inp.rows.length, steer: inp.steer.length } });
  smells.saveProposals(list);
  state.meta.lastReview = Date.now(); saveMeta();
  renderSmells();
}
// actual tokens of the side requests made while running an item
const sideTokens = () => ({ n: Object.values(state.sessions).reduce((a, x) => a + x.ledger.filter(e => e.helper).reduce((b, e) => b + (e.prompt || 0) + (e.completion || 0), 0), 0) + (state.meta.steward || []).reduce((b, e) => b + (e.prompt || 0) + (e.completion || 0), 0),
  cost: Object.values(state.sessions).reduce((a, x) => a + x.ledger.filter(e => e.helper).reduce((b, e) => b + (Number(e.cost) || 0), 0), 0) + (state.meta.steward || []).reduce((b, e) => b + (Number(e.cost) || 0), 0) });
async function runItem(it, { confirmBudget = true } = {}) {
  const budget = Number(state.meta.settings.queueBudget) || 20000, est = it.estimate.in + it.estimate.out;
  if (confirmBudget && est > budget && !await ask2('Over the per-item budget', `${cust.TYPES[it.type].label}: about ${k(est)} tokens, over the ${k(budget)} budget. Run it anyway?`, 'Run')) return false;
  it.status = 'running'; saveMeta(); renderQueue();
  const before = sideTokens();
  try {
    if (it.type === 'condense') await steward();
    else if (it.type === 'review') await runReview();
    else if (it.type === 'scope-check') await checkScopes();
    else if (it.type === 'log-retry') await logSync('queue');
    const after = sideTokens(), used = after.n - before.n;
    it.status = 'done'; it.done = Date.now(); it.result = { tokens: used, cost: +(after.cost - before.cost).toFixed(6) };
    if (est && used > est * 1.5) smells.add({ kind: 'queue-overrun', detail: `${it.type}: ${used} tokens against an estimate of ${est}` });
  } catch (e) { it.status = 'failed'; it.done = Date.now(); it.result = { error: String(e.message || e) }; }
  saveMeta(); renderQueue(); renderSmells();
  return true;
}
function renderQueue() {
  const box = $('#queue');
  if (!box) return;
  const list = queue().slice().reverse(), tot = cust.total(queue());
  const money = c => c == null ? 'price unknown' : '$' + c.toFixed(c < 0.01 ? 5 : 3);
  box.replaceChildren(...list.map(it => {
    const est = it.estimate, T = cust.TYPES[it.type];
    return item({ kind: T.label, name: it.reason.detail, meta: it.status === 'queued' ? (est.model ? `~${k(est.in)} in · ≤${k(est.out)} out · ${money(est.cost)}` : 'no tokens') : it.status + (it.result?.tokens != null ? ` · ${k(it.result.tokens)} tokens · ${money(it.result.cost)}` : ''),
      tone: it.status === 'queued' ? 'warn' : it.status === 'failed' ? 'bad' : 'off', attrs: { 'data-q': it.id, 'data-status': it.status },
      body: [
        h('div', { class: 'qrow' }, h('b', { text: 'for' }), h('span', { text: it.intent })),
        h('div', { class: 'qrow' }, h('b', { text: 'why' }), h('span', { text: `${it.reason.kind}${it.reason.policy ? ' · policy ' + it.reason.policy : ''}${it.fired > 1 ? ` · fired ${it.fired}×` : ''} — ${it.reason.detail}` })),
        h('div', { class: 'qrow' }, h('b', { text: 'targets' }), h('span', { class: 'qtargets' }, ...it.targets.map(t => t.kind === 'session' && state.sessions[t.id] ? btn(t.label || t.id, { 'data-goto': t.id, class: 'qt' }) : h('span', { class: 'hkind', text: `${t.kind} ${t.label || t.id}` })))),
        h('div', { class: 'qrow' }, h('b', { text: 'cost' }), h('span', { text: est.model ? `${est.model}: about ${k(est.in)} input tokens, at most ${k(est.out)} output · ${money(est.cost)}` : 'no model, no tokens' })),
        h('details', { class: 'hist' }, h('summary', { text: 'how the cost is kept down' }), h('ul', { class: 'qproc' }, ...it.procedure.map(p => h('li', { text: p })))),
        it.result?.error ? h('p', { class: 'note bad', text: it.result.error }) : null,
      ],
      actions: it.status === 'queued' ? [btn('dismiss', { 'data-act': 'q-dismiss' }), btn('run', { 'data-act': 'q-run', class: 'primary' })] : [] });
  }));
  slot($('#queuecount'), tot && pending(queue()) ? `${pending(queue())} · ${money(tot.cost)}` : '');
  slot($('#queuebar'), pending(queue()) ? `queue ${pending(queue())}` : '');
}
const pending = list => cust.pending(list).length;

// ---------- sealed sessions ----------

// A session whose profile chain is sealed keeps its directives (system prompt,
// profile and session settings, values) inside its execution: exports, the log
// repo, the bridge and copied config get "[sealed]" instead.
const sealedOf = s => !!(s && eff(s).sealed);
const pathOut = s => sealedOf(s) ? '[sealed]' : (eff(s).path || null);

// ---------- concerns: issues in the harness repo ----------

// The repo concerns go to: Settings, else the repo this page is served from.
const concernRepo = () => state.meta.settings.concernRepo || bootEnv?.repo || '';
function concernBody(s, a, who) {
  const e = s ? eff(s) : null;
  return [
    `**Kind:** ${a.kind}`, '', '### What happened', a.what || '', '',
    a.expected ? '### What should happen instead\n' + a.expected + '\n' : '',
    a.intent ? '### Intent\n' + a.intent + '\n' : '',
    '### Where', s ? `session \`${s.id}\` · steering \`${steerOf(s)}\`${e?.path ? ' · profile `' + pathOut(s) + '`' : ''} · model \`${cfg(s).model || '-'}\`` : 'no session', '',
    `<sub>Filed by ${who} from WebHarness ${VERSION} · ${new Date().toISOString()}</sub>`,
  ].filter(x => x !== '').join('\n');
}
async function fileConcern(s, a, who) {
  const repo = concernRepo();
  if (!repo) return 'No concerns repository is configured.';
  const g = gitClient({ token: gh.token, trace, get, confirm: what => s ? approve(s, what) : ask2('File this concern?', `${what.repo}\n${what.title}\n\n${what.body}`, 'File'), scope: () => null });
  const r = await g.issue({ repo, title: '[concern] ' + String(a.title).slice(0, 120), kind: a.kind, body: concernBody(s, a, who), approved: who === 'you' });
  smells.add({ kind: 'concern-filed', session: s?.id, detail: r.split('\n')[0] });
  return r;
}
async function concernForm() {
  const s = cur();
  const f = { kind: h('select', {}, ...['pattern', 'interop', 'protocol', 'policy', 'cost', 'ui', 'other'].map(k => h('option', { value: k, text: k }))), title: h('input', { placeholder: 'short title' }), what: h('textarea', { rows: '4', placeholder: 'what happened: the evidence' }), expected: h('textarea', { rows: '2' }), intent: h('input', { placeholder: 'what the change is for' }) };
  const repo = concernRepo();
  if (!await modal({ title: 'File a concern', body: [h('p', { class: 'note', text: repo ? `As an issue in ${repo}, labelled "concern".` : 'Set the concerns repository in Settings first.' }), ...Object.entries(f).map(([k, el]) => field(k, el))], actions: [{ text: 'Cancel', value: false, cancel: true }, { text: 'File', value: true, primary: true }] })) return;
  if (!repo || !f.title.value.trim() || !f.what.value.trim()) return;
  const r = await fileConcern(s, { kind: f.kind.value, title: f.title.value.trim(), what: f.what.value, expected: f.expected.value, intent: f.intent.value }, 'you').catch(e => 'Not filed: ' + e.message);
  modal({ title: 'Concern', body: r });
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
    const ask = { commit: 'Commit to GitHub?', 'pull request': 'Open a pull request?', repository: 'Create a GitHub repository?', issue: 'File this concern as an issue?' }[what.what];
    card.append(h('b', { text: ask }), h('pre', { text: what.what === 'repository' ? `${what.repo} (${what.title})\n${what.body}` : what.what === 'issue' ? `${what.repo}\n${what.title}\n\n${what.body}` : head }));
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

// ---------- paired agent as the model ----------

// Provider "agent": each request goes up the bridge as a turn event and the
// paired agent answers it with an `answer` directive ({turn, content, tool_calls:
// [{name, args}]}). Everything after that (tool runs, approvals, the log) is the
// harness's ordinary path.
const waiting = new Map();
providers.agent = {
  label: 'Paired agent (bridge)', needsKey: false,
  async models() { return [{ id: 'agent', name: 'Paired agent', ctx: 1e6, tools: true, pricing: { prompt: '0', completion: '0' } }]; },
  async *stream(body, _key, signal) {
    if (!link) throw new Error('No bridge is paired: open the page with a #bridge= link.');
    const turn = uid('t');
    const last = body.messages.slice(-3);
    link.emit('turn', { turn, messages: body.messages.length, tail: last, tools: (body.tools || []).map(t => t.function.name) });
    const r = await new Promise((ok, no) => {
      waiting.set(turn, ok);
      signal?.addEventListener('abort', () => { waiting.delete(turn); no(new DOMException('Aborted', 'AbortError')); });
    });
    const calls = (r.tool_calls || []).map((c, index) => ({ index, id: 'call_' + uid('c'), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
    yield { choices: [{ delta: { content: r.content || '', ...(calls.length ? { tool_calls: calls } : {}) } }] };
    yield { choices: [{ delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 }, cost: 0 } };
  },
};

// ---------- debug bridge (bridge.js) ----------

const BRIDGE_ACTS = new Set(['new', 'inspector']);
async function startBridge(pair, env) {
  const set = state.meta.settings;
  const hello = () => ({ build: VERSION, schema: SCHEMA, ref: env.ref || '', url: location.origin + location.pathname, ua: navigator.userAgent, provider: set.provider, model: set.model, helper: set.helper || '', sessions: state.meta.order.length });
  const lastReply = s => { const m = [...s.messages].reverse().find(m => m.role === 'assistant'); return m?.content || ''; };
  link = await bridge.start(pair, {
    trace, hello, token: () => gh.token(pair.repo, 'write'),
    secrets: () => [...Object.values(state.keys).filter(v => typeof v === 'string'), ...gh.secrets()],
    gated: new Set(['send', 'set', 'reload']),
    directives: {
      ping: hello,
      held: () => [...held.entries()].map(([id, x]) => ({ id, kind: x.kind, session: x.s, detail: x.detail.slice(0, 500) })),
      release({ id, all, skip }) {
        if (all) { letLoose('the paired agent'); return { released: 'all', pace: 'run' }; }
        const x = held.get(id);
        if (!x) throw new Error('nothing held with id ' + id + '; held: ' + [...held.keys()].join(' '));
        x.done(skip ? 'skip' : 'release', 'the paired agent');
        return { [skip ? 'skipped' : 'released']: id };
      },
      answer_value({ req, value, scope, expose, decline }) {
        const x = valueAsks.get(req);
        if (!x) throw new Error('no open value request with id ' + req);
        if (decline) { x.decline('the paired agent'); return { declined: req }; }
        const e = x.store({ value, scope, expose }, 'the paired agent');
        if (e) throw new Error(e);
        return { stored: req };
      },
      answer_ask({ ask, answers, decline }) {
        const x = asking.get(ask);
        if (!x) throw new Error('no open question with id ' + ask);
        if (decline) { x.decline('the paired agent'); return { declined: ask }; }
        const v = x.submit(answers || {}, 'the paired agent');
        if (v.errors) throw new Error(v.errors.join('; '));
        return { answered: ask };
      },
      answer({ turn, content, tool_calls }) {
        const w = waiting.get(turn);
        if (!w) throw new Error('no turn waiting with id ' + turn + '; waiting: ' + [...waiting.keys()].join(' '));
        waiting.delete(turn); w({ content, tool_calls });
        return { answered: turn };
      },
      state: () => ({ active: state.meta.active, busy, settings: { ...set }, profiles: profiles().map(p => ({ id: p.id, name: p.name, parent: p.parent || null })), sessions: state.meta.order.map(id => { const s = state.sessions[id]; return { id, title: s.title, profile: pathOut(s), parent: s.parent?.id || null, messages: s.messages.length, ledger: s.ledger?.length || 0 }; }) }),
      session: ({ id }) => { const t = state.sessions[id || state.meta.active]; if (sealedOf(t)) throw new Error('that session is sealed'); return exportBundle(t); },
      trace: ({ from = 0 }) => trace.slice(from),
      trail: () => pat.trail(),
      smells: () => smells.all(),
      dom: ({ sel, html, max = 20 }) => [...document.querySelectorAll(sel)].slice(0, max).map(e => (html ? e.outerHTML : slotText(e)).slice(0, 4000)), // slot values included
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
