// Tools the model can call. Definitions are sent in a fixed order (they sit in
// the cacheable prefix) and are worded without reference to where they run.
//   { def: <OpenAI tool schema>, run(args, ctx) -> string | Promise<string> }
import { present, read, get, handlesIn } from './outstore.js';
import * as pat from './patterns.js';

// ctx = { pads, savePads, depth, fanOut, branchRead, by(), knownRef(h), onPatterns(), helper(want, text) } from the host.

// Long arguments are stored by handle when the call is logged (main.js), so a
// logged call can read {ref, name}. That form is also a valid call: it runs the
// stored arguments again.
const REF_NOTE = ' An earlier call may appear as {ref, name}: its arguments are stored under that handle and are implied; calling with {ref} repeats it.';
const REF_PROPS = { ref: { type: 'string' }, name: { type: 'string', description: 'short name for this call, kept as its label' } };
export const SWAPPABLE = new Set(['run_js', 'show_widget']);
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

// Code runs in a dedicated Worker: no DOM, no localStorage (so no API key), and
// it is terminated on timeout. It is not a network sandbox: fetch still works.
function runJs({ code }, _ctx, timeout = 5000) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const w = new Worker(url);
    // Plain text, not JSON: a long result keeps its line breaks, so it can be searched by line later.
    const text = o => {
      const r = o.ok ? (typeof o.result === 'string' ? o.result : JSON.stringify(o.result)) : 'Error: ' + o.error;
      return o.logs?.length ? `${r}\n[console]\n${o.logs.join('\n')}` : r;
    };
    const done = out => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(text(out)); };
    const t = setTimeout(() => done({ ok: false, error: `Timed out after ${timeout} ms` }), timeout);
    w.onmessage = e => {
      let out = e.data;
      try { JSON.stringify(out); } catch { out = { ok: true, result: String(out.result), logs: out.logs }; }
      done(out);
    };
    w.onerror = e => done({ ok: false, error: e.message || 'Script error' });
    w.postMessage(String(code ?? ''));
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
    'Show something to the user in a side pane. kind and its data: html {html} (self-contained; call emit(value) to report an interaction), text {text}, image|audio|video|embed {url} (https), table {columns, rows}, chart {type: bar|line, labels, values}, form {fields: [{name, label, type: text|number|select|checkbox|textarea, options, value}], submit}. Reusing a slot replaces what it shows. A user interaction arrives later as a <widget_event> message.' + REF_NOTE,
    { slot: { type: 'string' }, kind: { type: 'string', enum: ['html', 'text', 'image', 'audio', 'video', 'embed', 'table', 'chart', 'form'] }, title: { type: 'string' }, data: { type: 'object' }, ...REF_PROPS }, [],
    ({ slot }) => `Displayed${slot ? ` in slot "${slot}"` : ''}.`),
  fn('output_read',
    'Read stored output by its handle (os:...). Give `find` to get matching lines, or `offset` and `length` for a slice.',
    { handle: { type: 'string' }, find: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['handle'],
    args => read(args)),
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
];

const WHOLE = new Set(['fan_out', 'output_read', 'branch_read', 'pattern_find', 'pattern_get', 'pattern_put', 'pattern_run']);

export const toolDefs = tools.map(t => t.def);

// Every call leaves a trail row written by the harness: tool, argument shape, outcome, size, time.
export async function execTool(call, ctx, via) {
  const t0 = performance.now();
  const out = await exec(call, ctx);
  let args = {};
  try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
  pat.trailAdd({ t: Date.now(), ...ctx.by?.(), tool: call.function.name, shape: pat.shape(call.function.name, args), via: via || undefined, ok: !/^(Tool error|Error:|Unknown tool|Invalid JSON|Not stored|No )/.test(out), chars: out.length, ref: typeof args.ref === 'string' ? args.ref : undefined, out: handlesIn(out)[0], ms: Math.round(performance.now() - t0) });
  return out;
}

async function exec(call, ctx) {
  const t = tools.find(t => t.def.function.name === call.function.name);
  if (!t) return `Unknown tool: ${call.function.name}`;
  let args;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { return `Invalid JSON arguments: ${e.message}`; }
  if (typeof args.ref === 'string' && Object.keys(args).every(k => k === 'ref' || k === 'name')) {
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
