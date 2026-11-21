// Query surface, header (docs/QUERY.md 2, 3.3, 4.2): labels, kind blocks, declared refs and the header in its fixed key order.
// Pure over the state the executor leaves. Byte-deterministic: no time, no randomness.
import { ATTRS, BUILTIN, flatten, mergeSrc, resolveAttrs } from './query-attrs.js';

// a label two kinds both give is prefixed with its kind in both; -> the set of kinds that got a prefix
export function settleLabels(st) {
  const owners = new Map(), prefixed = new Set();
  for (const r of st.recs.values()) { if (!owners.has(r.raw)) owners.set(r.raw, new Set()); owners.get(r.raw).add(r.kind); }
  for (const r of st.recs.values()) if (owners.get(r.raw).size > 1) { r.label = r.kind + ':' + r.raw; prefixed.add(r.kind); }
  for (const [o, k, r] of st.fix) o[k] = r.label;
  return prefixed;
}

const range = ls => {
  const m = ls.map(l => /^(.*?)(\d+)$/.exec(l));
  if (ls.length < 3 || m.some(x => !x || x[1] !== m[0][1])) return null;
  const nums = m.map(x => Number(x[2]));
  return nums.every((v, i) => i === 0 || v === nums[i - 1] + 1) ? `${ls[0]}..${ls[ls.length - 1]}` : null;
};

// -> {labels, under}: the header form, and whether each data entry then carries its label as "_"
function labelsOf(recs, mode, max) {
  const ls = recs.map(r => r.label), n = ls.length;
  if (mode === 'none') return { labels: { n }, under: false };
  if (mode === 'inline') return { labels: { n, inline: true }, under: true };
  const rg = mode === 'range' ? range(ls) : null;
  if (rg) return { labels: rg, under: false };
  return n > max ? { labels: { first: ls[0], last: ls[n - 1], n }, under: true } : { labels: ls, under: false };
}

function descriptor(def, kname, mode, prefaced, sent) {
  const text = def.materialized.descriptor, o = { materialized: true };
  if (prefaced.includes(kname)) o.desc = 'prefaced';
  else if (mode === 'off') o.desc = 'off';
  else if (mode === 'always') { o.desc = 'always'; o.text = text; }
  else if (sent.has(kname)) o.desc = 'seen';
  else { sent.add(kname); o.desc = 'sent'; o.text = text; }
  return o;
}

export function buildBlocks(st, env, prefixed) {
  const max = env.policy.limits?.labelsMax ?? 50, pre = [...(env.prefaced || []), ...(env.policy.prefaced || [])], blocks = [];
  for (const [kname, recs] of st.byKind) {
    const def = env.schema.kinds[kname], fs = st.fields.filter(f => f.kind === kname), lab = labelsOf(recs, fs[0].attrs.labels, max);
    const b = { kind: kname, paths: [...new Set(fs.map(f => f.path))], n: recs.length, labels: lab.labels, caps: { get: !!def.gettable, props: def.props, set: def.settable || [] } };
    if (def.materialized) Object.assign(b, descriptor(def, kname, fs[0].attrs.descriptor, pre, env.sent));
    if (prefixed.has(kname)) b.prefixed = true;
    if (lab.under) for (const o of st.occ) if (o.rec.kind === kname) o.obj._ = o.rec.label;
    blocks.push(b);
  }
  return blocks;
}

// ---- declared refs (4.2): inference I1..I4, or @refs; merged; policy deny removes ops
const row = (kind, op, labels, names, via, max) => {
  const r = { kind, op };
  if (labels) r.labels = labels;
  if (names) r.names = names;
  r.via = via;
  if (max !== undefined) r.max = max;
  return r;
};

function fieldRows(f, def, max) {
  const k = def.name, sel = f.fnProps, out = [], want = f.attrs.refs;
  if (want !== 'infer') {
    const ops = want.ops || [], pick = (all, names) => (names ? all.filter(p => names.includes(p)) : all);
    if (ops.includes('get') && def.gettable) out.push(row(k, 'get', null, null, 'query', max));
    const prop = ops.includes('property') ? pick(def.props, want.names) : [], set = ops.includes('set') ? pick(def.settable || [], want.names) : [];
    if (prop.length) out.push(row(k, 'property', null, prop, 'query'));
    if (set.length) out.push(row(k, 'set', null, set, 'query'));
    return out;
  }
  if (def.gettable && !f.payloadSel) out.push(row(k, 'get', null, null, 'I1', max));
  if (def.gettable && f.payloadSel && f.changed.size) out.push(row(k, 'get', [...f.changed].map(r => r.label), null, 'I2', max));
  const rest = def.props.filter(p => !sel.includes(p)), set = (def.settable || []).filter(p => sel.includes(p));
  if (rest.length) out.push(row(k, 'property', null, rest, 'I3'));
  if (set.length) out.push(row(k, 'set', null, set, 'I4'));
  return out;
}

function mergeRow(rows, r) {
  const key = JSON.stringify([r.kind, r.op, r.names, r.via, r.max]), had = rows.get(key);
  if (!had) { rows.set(key, { ...r, ...(r.labels ? { labels: [...r.labels] } : {}) }); return; }
  if (had.labels && r.labels) had.labels = [...new Set([...had.labels, ...r.labels])];
  else delete had.labels;
}

// -> {rows, dropped}
export function refRows(st, env) {
  const p = env.policy, max0 = p.limits?.getMax ?? 12000, rows = new Map(), deny = p.deny || [], dropped = [];
  for (const f of st.fields) {
    const max = p.verbose === false ? Math.min(max0, f.attrs.payload.max) : max0;
    for (const r of fieldRows(f, env.schema.kinds[f.kind], max)) mergeRow(rows, r);
  }
  const kept = [];
  for (const r of rows.values()) {
    if (!deny.includes(r.op)) { kept.push(r); continue; }
    const d = { what: 'refs.' + r.op, why: 'policy:deny ' + r.op };
    if (!dropped.some(x => x.what === d.what)) dropped.push(d);
  }
  return { rows: kept, dropped };
}

// ---- the header, in its fixed key order (v q op ok count pages attrs src kinds reducers refs dropped policy)
export function buildHeader({ q, plan, st, env, errors, blocks, refs, dropped }) {
  const fs = st.fields, base = resolveAttrs({}, env.policy), attrs = {}, src = {};
  for (const name of ATTRS) {
    attrs[name] = fs.length ? flatten(fs.map(f => [f.path, f.attrs[name]])) : base.attrs[name];
    const s = fs.length ? mergeSrc(fs.map(f => f.src[name])) : base.src[name];
    if (s) src[name] = s;
  }
  const shown = env.policy.headerAttrs === 'changed' ? Object.fromEntries(Object.entries(attrs).filter(([k, v]) => src[k] || JSON.stringify(v) !== JSON.stringify(BUILTIN[k]))) : attrs;
  const pages = fs.filter(f => f.page).map(f => f.page), reducers = [...st.reducers.values()];
  const drops = [...new Map([...fs.flatMap(f => f.dropped), ...dropped].map(d => [JSON.stringify(d), d])).values()];
  const h = { v: 1, q, op: plan.op.name ?? null, ok: !errors.length, count: st.recs.size };
  if (pages.length) h.pages = pages;
  h.attrs = shown; h.src = src; h.kinds = blocks;
  if (reducers.length) h.reducers = reducers;
  if (refs.length) h.refs = refs;
  if (drops.length) h.dropped = drops;
  h.policy = { id: env.policy.id ?? 'default', rev: env.policy.rev ?? 1, ov: [...new Set(fs.flatMap(f => f.ov))] };
  return h;
}
