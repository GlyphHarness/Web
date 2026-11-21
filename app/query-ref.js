// Query surface, ref gate and audit (docs/QUERY.md 4, 4.4): a ref names <query>/<label> and an op the query declared.
// Refusals are results, never throws, and call nothing of the adapter. The audit keeps no text, only a hash.
import { clipText, pickReducer, applyReducer, addRow } from './query-reducers.js';

export const hashOf = s => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const OPS = ['get', 'property', 'set'];
const fail = (code, message) => ({ code, message });

// what the query declared for one label: {get: max|null, property: [names], set: [names]}
function declared(qr, rec) {
  const d = { get: null, property: [], set: [] };
  for (const r of qr.rows) {
    if (r.kind !== rec.kind || (r.labels && !r.labels.includes(rec.label))) continue;
    if (r.op === 'get') d.get = d.get === null ? r.max : Math.min(d.get, r.max);
    else d[r.op] = [...new Set([...d[r.op], ...r.names])];
  }
  return d;
}
const describe = d => [d.get !== null && 'get', d.property.length && `property[${d.property.join(',')}]`, d.set.length && `set[${d.set.join(',')}]`].filter(Boolean).join(', ') || 'none';

export function createGate(env) {
  const store = new Map(), rows = [];
  let ticks = 0;
  const log = o => rows.push(Object.fromEntries(Object.entries({ t: env.now(), ...o }).filter(([, v]) => v !== undefined)));

  const expired = qr => {
    const s = qr.scope;
    if (s === 'surface') return null;
    if (s.ticks !== undefined) return ticks - qr.tick > s.ticks ? `${s.ticks} ticks` : null;
    const n = s.queries ?? 8;
    return env.counter() - qr.n > n ? `${n} queries` : null;
  };

  // the gate proper: -> {fail} or {rec, d, qr}
  function gate(qr, str, rec, op, name, value, why) {
    const at = `${str}: `, pol = env.policy;
    if ((pol.deny || []).includes(op)) return fail('REF_POLICY', `${at}op "${op}" is refused by policy`);
    if ((pol.requireWhy || []).includes(op) && !why) return fail('REF_BAD_VALUE', `${at}op "${op}" needs a why (policy requireWhy)`);
    const d = declared(qr, rec), ok = op === 'get' ? d.get !== null : !!d[op]?.length;
    if (!OPS.includes(op) || !ok) return fail('REF_NOT_DECLARED', `${at}op "${op}" is not declared by this query (declared: ${describe(d)})`);
    if (op === 'get') return { d };
    if (name === undefined || name === null) return fail('REF_BAD_NAME', `${at}${op} needs a name (declared: ${d[op].join(', ')})`);
    if (!d[op].includes(name)) return fail('REF_BAD_NAME', `${at}${op} "${name}" is not declared (declared: ${d[op].join(', ')})`);
    if (op === 'set' && value === undefined) return fail('REF_BAD_VALUE', `${at}set ${name} needs a value`);
    return { d };
  }

  async function act(qr, rec, op, name, value, d) {
    const kind = env.schema.kinds[rec.kind], ctx = env.ctx();
    if (op === 'property') { const o = await kind.fn(rec.entry, { props: [name] }, ctx); return { data: o && typeof o === 'object' && !Array.isArray(o) && name in o ? o[name] : o }; }
    if (op === 'set') return { data: await kind.set(rec.entry, name, value, ctx) };
    let text = await kind.fn(rec.entry, { payload: true }, ctx);
    text = typeof text === 'string' ? text : text == null ? '' : String(text);
    const spec = pickReducer({ policy: env.policy, dec: rec.dec, attrs: rec.attrs, kind: rec.kind, text, forGet: true }), out = { data: text };
    if (spec) {
      const r = await applyReducer(env.registry, spec, text, { kind: rec.kind, label: rec.label, path: rec.path });
      if (r !== text) { const m = new Map(); addRow(m, spec, rec.kind, text.length, r.length); out.reducer = [...m.values()][0]; }
      out.data = r;
    }
    out.data = clipText(out.data, d.get);
    return out;
  }

  async function ref(str, o = {}) {
    const op = o.op, why = o.why === undefined ? undefined : String(o.why).slice(0, 200), m = /^(q\d+)\/(.+)$/.exec(String(str));
    const q = m?.[1], label = m?.[2];
    const done = (ok, f, data, extra = {}) => {
      const header = { v: 1, ...(q ? { q } : {}), ...(label ? { label } : {}), ...(op ? { op } : {}), ok, ...extra };
      const res = ok ? { header, data } : { header, errors: [{ message: f.message, extensions: { code: f.code, stage: 'ref' } }] };
      log({ q, label, op, ok, code: f?.code, why, h: hashOf(JSON.stringify(ok ? data ?? null : [f.code, f.message])) });
      return res;
    };
    if (!m) return done(false, fail('REF_FORMAT', 'ref must be <query>/<label>, for example q1/t0'));
    const qr = store.get(q);
    if (!qr) return done(false, fail('REF_UNKNOWN_QUERY', `unknown query ${q}`));
    const gone = expired(qr);
    if (gone) return done(false, fail('REF_EXPIRED', `query ${q} expired (scope: ${gone}); run the query again`));
    const rec = qr.labels.get(label);
    if (!rec) return done(false, fail('REF_UNKNOWN_LABEL', `${q} has no label ${label}`));
    const g = gate(qr, str, rec, op, o.name, o.value, why);
    if (g.code) return done(false, g);
    try {
      const r = await act(qr, rec, op, o.name, o.value, g.d);
      return done(true, null, r.data, r.reducer ? { reducer: r.reducer } : {});
    } catch (e) { return done(false, fail('REF_SOURCE', `${str}: ${e.message}`)); }
  }

  return {
    ref,
    audit: () => rows.map(r => ({ ...r })),
    tick: () => { ticks++; },
    remember(q, n, st, refRows) {
      const labels = new Map([...st.recs.values()].map(r => [r.label, r]));
      store.set(q, { n, tick: ticks, scope: st.fields[0]?.attrs.scope ?? { queries: 8 }, labels, rows: refRows });
    },
    logRun(q, result) {
      const code = result.errors?.[0]?.extensions?.code;
      log({ q, ok: result.header.ok, code, h: hashOf(JSON.stringify(result.data ?? result.errors ?? null)) });
    },
  };
}
