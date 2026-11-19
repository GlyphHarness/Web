// Tools the model can call. Definitions are sent in a fixed order (they sit in
// the cacheable prefix) and are worded without reference to where they run.
//   { def: <OpenAI tool schema>, run(args, ctx) -> string | Promise<string> }
import { present, read, slice, get, handlesIn } from './outstore.js';
import * as H from './handles.js';
import * as pat from './patterns.js';

// ctx = { pads, savePads, depth, fanOut, branchRead, by(), knownRef(h), onPatterns(), helper(want, text) } from the host.

// Long arguments are stored by handle when the call is logged (main.js), so a
// logged call can read {ref, name}. That form is also a valid call: it runs the
// stored arguments again.
const REF_NOTE = ' An earlier call may appear as {ref, name}: its arguments are stored under that handle and are implied; calling with {ref} repeats it.';
const REF_PROPS = { ref: { type: 'string' }, name: { type: 'string', description: 'short name for this call, kept as its label' } };
export const SWAPPABLE = new Set(['run_js', 'show_widget', 'repo_commit', 'shell']);
export const ARG_MAX = 400; // chars of arguments kept inline in the log

const WORKER = `
const fmt = v => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return String(v); } };
onmessage = async e => {
  const logs = [];
  console.log = console.info = console.warn = console.error = (...a) => logs.push(a.map(fmt).join(' '));
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const result = await new AsyncFunction(e.data)();
    postMessage({ ok: true, result: result === undefined ? null : result, logs });
  } catch (err) { postMessage({ ok: false, error: String(err), logs }); }
};`;

// Code runs in a Worker started inside a hidden sandboxed iframe whose CSP
// allows no network at all: no fetch, XHR, WebSocket, EventSource or script
// import, and (opaque origin) no access to this page, its storage or the API key.
// The frame terminates the Worker on timeout. Verified in Chromium (smoke test).
// 'unsafe-eval' is needed to run the code as a function body; it grants no network.
export const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; worker-src blob: data:";
const FRAME = `<meta http-equiv="Content-Security-Policy" content="${RUNNER_CSP}"><script>
const SRC = ${JSON.stringify(WORKER)};
const start = () => { try { return new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }))); } catch { return new Worker('data:text/javascript,' + encodeURIComponent(SRC)); } };
onmessage = e => {
  const { id, code, timeout } = e.data || {};
  if (!id) return;
  let w;
  const done = out => { clearTimeout(t); try { w && w.terminate(); } catch {} parent.postMessage({ whRun: id, out }, '*'); };
  const t = setTimeout(() => done({ ok: false, error: 'Timed out after ' + timeout + ' ms' }), timeout);
  try { w = start(); } catch (err) { return done({ ok: false, error: 'runtime unavailable: ' + err.message }); }
  w.onmessage = m => { let out = m.data; try { JSON.stringify(out); } catch { out = { ok: true, result: String(out.result), logs: out.logs }; } done(out); };
  w.onerror = m => done({ ok: false, error: m.message || 'Script error' });
  w.postMessage(code);
};
parent.postMessage({ whRunReady: 1 }, '*');
<\/script>`;

let runner = null; // { frame, ready: Promise, waiting: Map }
function getRunner() {
  if (runner?.frame.isConnected) return runner;
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.hidden = true;
  frame.dataset.runner = '';
  frame.srcdoc = FRAME;
  const waiting = new Map();
  let ready;
  const p = new Promise(ok => { ready = ok; });
  addEventListener('message', e => {
    if (e.source !== frame.contentWindow) return;
    if (e.data?.whRunReady) ready();
    const w = waiting.get(e.data?.whRun);
    if (w) { waiting.delete(e.data.whRun); w(e.data.out); }
  });
  document.body.append(frame);
  return runner = { frame, ready: p, waiting };
}

// Plain text, not JSON: a long result keeps its line breaks, so it can be searched by line later.
const asText = o => {
  const r = o.ok ? (typeof o.result === 'string' ? o.result : JSON.stringify(o.result)) : 'Error: ' + o.error;
  return o.logs?.length ? `${r}\n[console]\n${o.logs.join('\n')}` : r;
};

// Models often send a whole function rather than its body: `async function () {…}`,
// `function name() {…}` or `() => …` on its own. Such code is called, not rejected.
export function asBody(code) {
  const c = String(code ?? '').trim();
  if (/^(async\s+)?function\b[^(]*\([^)]*\)\s*\{[\s\S]*\}\s*;?$/.test(c) || /^(async\s*)?(\([^)]*\)|[\w$]+)\s*=>[\s\S]+$/.test(c)) return `return await (${c.replace(/;\s*$/, '')})();`;
  return code;
}
export async function runJs({ code }, _ctx, timeout = 5000) {
  code = asBody(code);
  const r = getRunner();
  await Promise.race([r.ready, new Promise(ok => setTimeout(ok, 3000))]);
  const id = Math.random().toString(36).slice(2);
  return new Promise(resolve => {
    const guard = setTimeout(() => { r.waiting.delete(id); r.frame.remove(); resolve(asText({ ok: false, error: `No answer from the runtime after ${timeout + 2000} ms` })); }, timeout + 2000);
    r.waiting.set(id, out => { clearTimeout(guard); resolve(asText(out)); });
    r.frame.contentWindow.postMessage({ id, code: String(code ?? ''), timeout }, '*');
  });
}

const fn = (name, description, properties, required, run) =>
  ({ def: { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } }, run });

export const tools = [
  fn('run_js',
    'Run JavaScript in an isolated runtime. The code is the body of an async function: use `return` for the result. console output is captured. Returns the result as text, then any console output. If the output may be long, say in `want` what you are looking for (a few words) and only that comes back.' + REF_NOTE,
    { code: { type: 'string' }, want: { type: 'string' }, ...REF_PROPS }, [], runJs),
  fn('scratchpad_read',
    'Read a labelled scratchpad. With no label, lists the available labels.',
    { label: { type: 'string' } }, [],
    ({ label }, ctx) => {
      if (!label) return JSON.stringify(ctx.pads.map(p => p.label));
      const p = ctx.pads.find(p => p.label === label);
      return p ? p.text : `No scratchpad labelled "${label}".`;
    }),
  fn('scratchpad_write',
    'Create or replace a labelled scratchpad.',
    { label: { type: 'string' }, text: { type: 'string' } }, ['label', 'text'],
    ({ label, text }, ctx) => {
      const p = ctx.pads.find(p => p.label === label);
      if (p) p.text = String(text); else ctx.pads.push({ id: 'p' + Date.now().toString(36), label: String(label), text: String(text), include: false });
      ctx.savePads();
      return 'Saved.';
    }),
  fn('show_widget',
    'Show something to the user in a side pane. kind and its data: html {html} (self-contained; call emit(value) to report an interaction), text {text}, image|audio|video|embed {url} (https), table {columns, rows}, chart {type: bar|line, labels, values}, form {fields: [{name, label, type: text|number|select|checkbox|textarea, options, value}], submit}. Reusing a slot replaces what it shows. A user interaction arrives later as an `event <slot>: <json>` message.' + REF_NOTE,
    { slot: { type: 'string' }, kind: { type: 'string', enum: ['html', 'text', 'image', 'audio', 'video', 'embed', 'table', 'chart', 'form'] }, title: { type: 'string' }, data: { type: 'object' }, ...REF_PROPS }, [],
    ({ slot }) => `Displayed${slot ? ` in slot "${slot}"` : ''}.`),
  fn('output_read',
    'Read what a handle holds now: stored output (os:...) or an id you were given. Give `find` to get matching lines, or `offset` and `length` for a slice.',
    { handle: { type: 'string' }, find: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['handle'],
    async (args, ctx) => {
      if (!H.ID.test(String(args.handle || ''))) return read(args);
      // an opaque id: resolved for this reader as it stands now; the session records it
      const text = await H.resolve(args.handle, ctx?.reader || '*', get);
      if (text == null) return `Nothing is held under "${args.handle}".`;
      ctx?.onResolve?.(args.handle, H.contentHash(text));
      return slice(text, args);
    }),
  fn('fan_out',
    'Work several concerns in parallel, each in its own isolated continuation of this conversation, and get back one compact fold per concern (OUTCOME, RESULT, EVIDENCE, OPEN). Use it for work whose intermediate steps are not needed here. `after` makes a concern wait for the folds of the listed concern ids.',
    { concerns: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, task: { type: 'string' }, after: { type: 'array', items: { type: 'string' } } }, required: ['id', 'task'] } } }, ['concerns'],
    (args, ctx) => ctx.depth ? 'fan_out is not available inside a concern.' : ctx.fanOut(args)),
  fn('branch_read',
    'Read the working transcript behind a fold, by its branch id. Use only when the fold lacks a needed detail.',
    { branch: { type: 'string' } }, ['branch'],
    (args, ctx) => ctx.branchRead(args)),
  fn('pattern_find',
    'Search stored solutions, gotchas, patterns, philosophies and recipes before working something out again. Returns one line per match.',
    { query: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: pat.KINDS } }, [],
    args => { const hits = pat.find(args); return hits.length ? hits.map(pat.line).join('\n') : 'No matches.'; }),
  fn('pattern_get',
    'Read one stored pattern in full, by id.',
    { id: { type: 'string' } }, ['id'],
    ({ id }) => { const p = pat.get(id); return p ? JSON.stringify({ ...p, by: undefined }) : `No pattern "${id}".`; }),
  fn('pattern_put',
    'Store what was learned once something non-obvious works or a quirk costs time: the approach, the gotcha, the design reason, or a recipe. Terse. A recipe is a stored call {tool, args} whose string values may hold {{slot}} placeholders named in `slots`. `refs` are handles of outputs or branches that show it. `supersedes` replaces an earlier id.',
    { kind: { type: 'string', enum: pat.KINDS }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } }, slots: { type: 'array', items: { type: 'string' } }, recipe: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } } }, refs: { type: 'array', items: { type: 'string' } }, supersedes: { type: 'string' } }, ['kind', 'title'],
    (args, ctx) => {
      if (args.kind === 'recipe' && (!tools.some(t => t.def.function.name === args.recipe?.tool) || /^pattern_/.test(args.recipe.tool))) return 'recipe.tool must name an existing non-pattern tool.';
      const r = pat.put(args, ctx.by(), ctx.knownRef);
      ctx.onPatterns?.();
      return r.error ? 'Not stored: ' + r.error : r.existed ? `Already stored as ${r.id}.` : `Stored ${r.id}.`;
    }),
  fn('pattern_run',
    'Run a stored recipe with concrete slot values.',
    { id: { type: 'string' }, values: { type: 'object' } }, ['id'],
    async ({ id, values }, ctx) => {
      const p = pat.get(id);
      if (!p?.recipe) return `No recipe "${id}".`;
      const f = pat.fill(p.recipe.args, p.slots, values || {});
      if (f.error) return f.error;
      pat.used(id);
      ctx.onPatterns?.();
      return execTool({ function: { name: p.recipe.tool, arguments: JSON.stringify(f.args) } }, ctx, id);
    }),
  fn('entry_read',
    'Open a condensed record of an earlier reply, by the handle in its [os:... kind] line. part: gotchas (what failed), steps (the calls made), transcript (the full reply), summary. State the specific reason in `why`.',
    { handle: { type: 'string' }, part: { type: 'string', enum: ['gotchas', 'steps', 'transcript', 'summary'] }, why: { type: 'string' } }, ['handle', 'part', 'why'],
    async ({ handle, part, why }, ctx) => {
      if (!String(why || '').trim()) return 'Not opened: give the specific reason in `why`.';
      let e;
      try { e = JSON.parse(await get(String(handle))); } catch {}
      if (!e || e.v !== 1 || typeof e.text !== 'string') return `No condensed record "${handle}".`;
      if (part === 'gotchas') return e.gotchas.length ? e.gotchas.join('\n') : 'None recorded: no call in that turn failed.';
      if (part === 'steps') return e.steps.length ? e.steps.map((x, n) => `${n + 1}. ${x.tool}${x.name ? ` "${x.name}"` : ''}${x.ref ? ' ' + x.ref : ''}${x.want ? ` want: ${x.want}` : ''} -> ${x.ok ? 'ok' : 'failed'}${x.out ? ' ' + x.out : ''}`).join('\n') : 'No calls were made in that turn.';
      if (part === 'transcript') return e.text.length > 4000 ? e.text.slice(0, 4000) + `\n[${e.text.length - 4000} chars more]` : e.text;
      const made = ctx.helper && await ctx.helper('what was done and what was concluded, in at most 6 lines', e.text).catch(() => null);
      return made || e.kept; // no helper: the kept lines are the summary
    }),
];

// Repository tools (git.js). Only sessions created with repository access get
// them, so a session's tool list, which sits in the cached prefix, never changes.
const CHANGE = { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, from: { type: 'string', description: 'an os: handle whose stored text becomes the file' }, edits: { type: 'array', items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } }, required: ['find', 'replace'] } }, delete: { type: 'boolean' } }, required: ['path'] };
const noRepo = 'No repository access is configured.';
export const repoTools = [
  fn('repo_read',
    'Read a GitHub repository. op: file (path, optional lines "a-b"; a directory path lists it), tree (all file paths, optional path prefix), log (optional path, n), diff (base, head, optional path), branches, prs (state). ref is a branch, tag or commit; default branch if omitted. Say in `want` what you are looking for when the output may be long.',
    { repo: { type: 'string', description: 'owner/name' }, op: { type: 'string', enum: ['file', 'tree', 'log', 'diff', 'branches', 'prs'] }, path: { type: 'string' }, ref: { type: 'string' }, lines: { type: 'string' }, n: { type: 'integer' }, base: { type: 'string' }, head: { type: 'string' }, state: { type: 'string' }, want: { type: 'string' } }, ['repo'],
    (a, ctx) => ctx.git ? ctx.git.read(a) : noRepo),
  fn('repo_commit',
    'Commit changes to a branch in one commit; the branch is created from `from` (default branch if omitted) when it does not exist. Each change is {path, content}, {path, edits: [{find, replace}]} (each find must occur exactly once in the current file; prefer this for small changes), {path, from: "os:..."} or {path, delete: true}. The user approves each commit.' + REF_NOTE,
    { repo: { type: 'string' }, branch: { type: 'string' }, from: { type: 'string' }, message: { type: 'string' }, changes: { type: 'array', items: CHANGE }, ...REF_PROPS }, [],
    (a, ctx) => ctx.git ? ctx.git.commit(a) : noRepo),
  fn('repo_pr',
    'Open a pull request from head into base (default branch if omitted). The user approves it.',
    { repo: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' } }, ['repo', 'head', 'title'],
    (a, ctx) => ctx.git ? ctx.git.pr(a) : noRepo),
  fn('concern_file',
    'File a concern about the harness itself as an issue in its repository, for later: a pattern worth keeping or fixing, input formed badly for a tool or an interop, a protocol gap, a policy or cost problem. Give the evidence, not a claim. The user approves each one.',
    { kind: { type: 'string', enum: ['pattern', 'interop', 'protocol', 'policy', 'cost', 'ui', 'other'] }, title: { type: 'string' }, what: { type: 'string', description: 'what happened: the call, the output, the evidence' }, expected: { type: 'string' }, intent: { type: 'string' } }, ['kind', 'title', 'what'],
    (a, ctx) => ctx.concern ? ctx.concern(a, 'model') : 'No concerns repository is configured.'),
  fn('repo_create',
    'Create a new repository, private unless private is false, with a README unless readme is false. owner is an organization; omit it for the account itself. The user approves it.',
    { name: { type: 'string' }, owner: { type: 'string' }, private: { type: 'boolean' }, description: { type: 'string' }, readme: { type: 'boolean' } }, ['name'],
    (a, ctx) => ctx.git ? ctx.git.create(a) : noRepo),
];
// The Linux machine (vm.js). Only sessions created with it, or switched on, get it.
export const vmTools = [
  fn('shell',
    'Run a bash script on a Linux machine (Alpine: bash, coreutils, git, python3, gh, curl, jq; more with wh-install <name>, e.g. tmux). State persists between calls until the page is reloaded. Returns the combined output and the exit status. Outbound HTTPS works only for hosts that allow cross-origin requests: the GitHub API does (gh is authenticated), git clone/push over HTTPS does not. If the output may be long, say in `want` what you are looking for.',
    { cmd: { type: 'string' }, timeout: { type: 'integer', description: 'seconds, default 120, max 600' }, want: { type: 'string' }, ...REF_PROPS }, [],
    async (a, ctx) => {
      if (!ctx.vm) return 'No machine is available.';
      await ctx.fsMark?.(); // first use in this session: mark and baseline for the file explorer
      const r = await ctx.vm.run(String(a.cmd ?? ''), Math.min(Math.max(Number(a.timeout) || 120, 5), 600));
      // runtime policy markers (vm.js shims) are recorded by the harness and taken out of the text
      r.out = String(r.out || '').replace(/__WH_RUNTIME_POLICY (\S+) ([^\n]*?)__\n?/g, (_, id, what) => { ctx.runtime?.(id, what); return ''; }).trimEnd();
      return (r.out || '(no output)') + (r.timedOut ? `\n[timed out after ${a.timeout || 120}s; interrupted]` : `\n[exit ${r.code}]`);
    }),
];
// Questions to the person (or the agent orchestrating the session); ask.js.
export const askTools = [
  fn('ask',
    'Ask the person you are working for one or more questions and wait for the answers. Use it when a decision is theirs or a needed fact is missing, not to report progress. Each question: {id, prompt, type: text|number|choice|multi|confirm|json, options (choice, multi), default, min, max (number), schema (json: a JSON Schema the answer must satisfy), optional}. Returns the answers as JSON keyed by id, or that they declined.',
    { questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, prompt: { type: 'string' }, type: { type: 'string', enum: ['text', 'number', 'choice', 'multi', 'confirm', 'json'] }, options: { type: 'array', items: { type: 'string' } }, default: {}, min: { type: 'number' }, max: { type: 'number' }, schema: { type: 'object' }, optional: { type: 'boolean' } }, required: ['id', 'prompt', 'type'] } } }, ['questions'],
    (a, ctx) => ctx.ask ? ctx.ask(a) : 'No one is available to answer.'),
];
// Scoped values (values.js): request one from the person, set or revise one, read one.
export const valueTools = [
  fn('value_request',
    'Ask the person for a value you need and keep it in scope for later (an endpoint, a region, a naming rule, a decision). Give a short label, a role, and the purpose it serves. type: text|number|choice|json; options for choice. Returns the stored value line.',
    { label: { type: 'string' }, role: { type: 'string' }, purpose: { type: 'string' }, type: { type: 'string', enum: ['text', 'number', 'choice', 'json'] }, options: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } }, ['label', 'purpose'],
    (a, ctx) => ctx.values ? ctx.values.request(a) : 'Values are not available.'),
  fn('value_set',
    'Record a value worth keeping in scope, or revise one by id (a new revision; earlier ones are kept). Set hidden: true to retire one. scope: session (default) or profile.',
    { id: { type: 'string' }, label: { type: 'string' }, role: { type: 'string' }, value: {}, purpose: { type: 'string' }, scope: { type: 'string', enum: ['session', 'profile'] }, hidden: { type: 'boolean' }, why: { type: 'string' } }, [],
    (a, ctx) => ctx.values ? ctx.values.set(a) : 'Values are not available.'),
  fn('value_get',
    'Read a value in scope by id, or its revision history with history: true.',
    { id: { type: 'string' }, history: { type: 'boolean' } }, ['id'],
    (a, ctx) => ctx.values ? ctx.values.get(a) : 'Values are not available.'),
];
const all = () => [...tools, ...repoTools, ...vmTools, ...askTools, ...valueTools];

const WHOLE = new Set(['ask', 'value_request', 'value_set', 'value_get', 'entry_read', 'fan_out', 'output_read', 'branch_read', 'pattern_find', 'pattern_get', 'pattern_put', 'pattern_run']);

export const toolDefs = tools.map(t => t.def);
export const defsFor = s => [...toolDefs, ...(s.tools?.includes('ask') ? askTools.map(t => t.def) : []), ...(s.tools?.includes('values') ? valueTools.map(t => t.def) : []), ...(s.tools?.includes('repo') ? repoTools.map(t => t.def) : []), ...(s.tools?.includes('vm') ? vmTools.map(t => t.def) : [])];

// Every call leaves a trail row written by the harness: tool, argument shape, outcome, size, time.
export async function execTool(call, ctx, via) {
  const t0 = performance.now();
  const out = await exec(call, ctx);
  let args = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
  pat.trailAdd({ t: Date.now(), ...ctx.by?.(), tool: call.function.name, shape: pat.shape(call.function.name, args), via: via || undefined, ok: !/^(Tool error|Error:|Unknown tool|Invalid JSON|Not stored|No )/.test(out), chars: out.length, why: typeof args.why === 'string' ? args.why.slice(0, 200) : undefined, ref: typeof args.ref === 'string' ? args.ref : undefined, out: handlesIn(out)[0], ms: Math.round(performance.now() - t0) });
  return out;
}

async function exec(call, ctx) {
  const t = all().find(t => t.def.function.name === call.function.name);
  if (!t) return `Unknown tool: ${call.function.name}`;
  let args;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { return `Invalid JSON arguments: ${e.message}`; }
  if (typeof args.ref === 'string' && Object.keys(args).every(k => k === 'ref' || k === 'name' || k === 'want')) {
    const stored = await get(args.ref).catch(() => null);
    if (stored == null) return `No stored call "${args.ref}".`;
    try { args = JSON.parse(stored); } catch { return `Stored call "${args.ref}" is not valid JSON.`; }
  }
  try {
    const out = String(await t.run(args, ctx));
    // Bounded by construction: folds are capped, reads are sliced. Everything else goes through the store.
    return WHOLE.has(call.function.name) ? out : await present(out, { want: args.want, helper: ctx.helper });
  } catch (e) { return `Tool error: ${e.message || e}`; }
}
