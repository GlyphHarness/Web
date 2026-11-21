// Query surface, execute stage (docs/QUERY.md 1.4, 3.2, 5): root fields run in the order written, one at a time, through the adapter.
// Builds the data and the state the header is made from. A failure nulls only its own field. No DOM, no storage.
import { jsValue } from './query-parse.js';
import { expand } from './query-validate.js';
import { readDecorators, resolveAttrs } from './query-attrs.js';
import { pickReducer, applyReducer, addRow } from './query-reducers.js';

const PSEUDO = new Set(['__typename', 'label', 'payload']);
const err = (message, code, path) => ({ message, ...(path ? { path } : {}), extensions: { code, stage: 'execute' } });
const textOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v));

function rootArgs(node, def, vars, policy) {
  const a = {};
  for (const x of node.args) { const v = jsValue(x.value, vars); if (v !== undefined && v !== null) a[x.name] = v; }
  if (def.list) a.first = a.first ?? policy.limits?.defaultFirst ?? 20;
  return a;
}

function register(entry, i, list, kind, f, st) {
  const rk = kind.name + '\0' + kind.key(entry);
  let rec = st.recs.get(rk);
  if (!rec) {
    const raw = String(kind.label(entry, i, list));
    rec = { kind: kind.name, entry, raw, label: raw, dec: f.dec, attrs: f.attrs, path: f.path };
    st.recs.set(rk, rec);
    if (!st.byKind.has(kind.name)) st.byKind.set(kind.name, []);
    st.byKind.get(kind.name).push(rec);
  }
  return rec;
}

async function payload(entry, rec, kind, f, i, env, st) {
  const path = f.list ? [f.path, i, 'payload'] : [f.path, 'payload'];
  let text;
  try { text = textOf(await kind.fn(entry, { payload: true }, env.ctx)); }
  catch (e) { st.errors.push(err(`${kind.name} ${rec.raw}: payload failed: ${e.message}`, 'RESOLVE_FAILED', path)); return null; }
  const spec = pickReducer({ policy: env.policy, dec: f.dec, attrs: f.attrs, kind: kind.name, text, forGet: false });
  if (!spec) return text;
  try {
    const out = await applyReducer(env.registry, spec, text, { kind: kind.name, label: rec.raw, path: f.path });
    if (out !== text) { addRow(st.reducers, spec, kind.name, text.length, out.length); f.changed.add(rec); }
    return out;
  } catch {
    st.errors.push(err(`reducer "${spec.with}" failed on ${kind.name} payload; the value is withheld`, 'REDUCER_FAILED', path));
    return null;
  }
}

async function one(entry, i, list, kind, f, sel, env, st) {
  const rec = register(entry, i, list, kind, f, st), out = {};
  const got = f.fnProps.length ? (await kind.fn(entry, { props: f.fnProps }, env.ctx)) || {} : {};
  for (const n of sel) {
    const k = n.alias || n.name;
    if (n.name === '__typename') out[k] = f.base;
    else if (n.name === 'label') { out[k] = null; st.fix.push([out, k, rec]); }
    else if (n.name === 'payload') out[k] = await payload(entry, rec, kind, f, i, env, st);
    else out[k] = (f.fnProps.includes(n.name) && n.name in got ? got[n.name] : entry[n.name]) ?? null;
  }
  st.occ.push({ obj: out, rec });
  return out;
}

async function entries(node, key, def, res, args, plan, env, st) {
  const kind = env.schema.kinds[def.kind], dec = readDecorators(node, plan.vars), ra = resolveAttrs(dec, env.policy);
  const list = res.entries || [], sel = expand(node.sel, plan.frags, plan.vars);
  const names = sel.map(n => n.name).filter(n => !PSEUDO.has(n));
  const f = {
    path: key, kind: kind.name, base: def.base, list: def.list, attrs: ra.attrs, src: ra.src, ov: ra.ov, dropped: ra.dropped, dec,
    fnProps: kind.props.filter(p => names.includes(p)), payloadSel: sel.some(n => n.name === 'payload'), changed: new Set(),
  };
  st.fields.push(f);
  if (def.list) f.page = { path: key, first: args.first, total: res.total ?? list.length, next: res.next ?? null };
  const rows = [];
  for (let i = 0; i < list.length; i++) rows.push(await one(list[i], i, list, kind, f, sel, env, st));
  return def.list ? rows : rows[0] ?? null;
}

async function root(node, key, plan, env, st) {
  if (node.name === '__typename') return 'Query';
  if (node.name === '__synopsis') return env.synopsis();
  const def = env.schema.roots[node.name], args = rootArgs(node, def, plan.vars, env.policy);
  try {
    const res = await def.adapter.resolve(node.name, args, env.ctx);
    return def.entry ? await entries(node, key, def, res || {}, args, plan, env, st) : res?.value ?? null;
  } catch (e) {
    st.errors.push(err(`${node.name} failed: ${e.message}`, 'RESOLVE_FAILED', [key]));
    return null;
  }
}

// -> {data, st}; st carries fields, records, reducer rows and the data objects whose labels are settled afterwards
export async function execute(plan, env) {
  const st = { fields: [], recs: new Map(), byKind: new Map(), reducers: new Map(), occ: [], fix: [], errors: [] }, data = {};
  for (const node of expand(plan.op.sel, plan.frags, plan.vars)) {
    const key = node.alias || node.name;
    if (!(key in data)) data[key] = await root(node, key, plan, env, st);
  }
  return { data, st };
}
