// Tools the model can call. Definitions are sent in a fixed order (they sit in
// the cacheable prefix) and are worded without reference to where they run.
//   { def: <OpenAI tool schema>, run(args, ctx) -> string | Promise<string> }
// ctx = { pads, savePads, depth, fanOut, branchRead } from the host.

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
    const done = out => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(JSON.stringify(out)); };
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
    'Run JavaScript in an isolated runtime. The code is the body of an async function: use `return` for the result. console output is captured. Returns JSON {ok, result|error, logs}.',
    { code: { type: 'string' } }, ['code'], runJs),
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
    'Display a small self-contained HTML widget (inline CSS and JS allowed) to the user.',
    { title: { type: 'string' }, html: { type: 'string' } }, ['html'],
    () => 'Displayed.'),
  fn('fan_out',
    'Work several concerns in parallel, each in its own isolated continuation of this conversation, and get back one compact fold per concern (OUTCOME, RESULT, EVIDENCE, OPEN). Use it for work whose intermediate steps are not needed here. `after` makes a concern wait for the folds of the listed concern ids.',
    { concerns: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, task: { type: 'string' }, after: { type: 'array', items: { type: 'string' } } }, required: ['id', 'task'] } } }, ['concerns'],
    (args, ctx) => ctx.depth ? 'fan_out is not available inside a concern.' : ctx.fanOut(args)),
  fn('branch_read',
    'Read the working transcript behind a fold, by its branch id. Use only when the fold lacks a needed detail.',
    { branch: { type: 'string' } }, ['branch'],
    (args, ctx) => ctx.branchRead(args)),
];

export const toolDefs = tools.map(t => t.def);

export async function execTool(call, ctx) {
  const t = tools.find(t => t.def.function.name === call.function.name);
  if (!t) return `Unknown tool: ${call.function.name}`;
  let args;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { return `Invalid JSON arguments: ${e.message}`; }
  try {
    const out = String(await t.run(args, ctx));
    return out.length > 8000 ? out.slice(0, 8000) + '\n[truncated]' : out;
  } catch (e) { return `Tool error: ${e.message || e}`; }
}
