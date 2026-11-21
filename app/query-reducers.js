// Query surface, reducer hook (docs/QUERY.md section 5): the built-ins and the order in which a payload's reducer is chosen.
// Pure. A reducer is (value, args, ctx) -> value | {value, note?}, registered by name.
export const clipText = (s, max) => (s.length > max + 16 ? s.slice(0, max) + `...[+${s.length - max}]` : s);

const linesOf = (v, a) => {
  const s = String(v), ls = s.split('\n'), head = a.head ?? 10, tail = a.tail ?? 10;
  if (ls.length <= head + tail) return s;
  return [...ls.slice(0, head), `...[+${ls.length - head - tail} lines]`, ...ls.slice(ls.length - tail)].join('\n');
};

export const BUILTIN_REDUCERS = {
  none: v => v,
  clip: (v, a) => clipText(String(v), a.max ?? 200),
  lines: linesOf,
  omit: () => '',
};

export const makeRegistry = user => ({ ...BUILTIN_REDUCERS, ...(user || {}) });

const matches = (when, kind, text) =>
  (when.kind === undefined || when.kind === kind) && (when.prop === undefined || when.prop === 'payload') && (when.minChars === undefined || text.length >= when.minChars);

// Resolution order (5.2): lock on `reducer`, else @reduce, else the first matching policy row, else policy defaults.reducer,
// else the payload-mode default (inline payload only), else none. -> {with, args, by} or null.
export function pickReducer({ policy, dec, attrs, kind, text, forGet }) {
  const p = policy || {}, def = p.defaults?.reducer;
  if ((p.locks || []).includes('reducer')) { if (def && def !== 'none') return { with: def, args: {}, by: 'policy' }; }
  else if (dec.reduce) return { with: dec.reduce.with, args: dec.reduce.args, by: 'query' };
  const row = (p.reducers || []).find(r => matches(r.when || {}, kind, text));
  if (row) return { with: row.with, args: row.args || {}, by: 'policy' };
  if (def && def !== 'none') return { with: def, args: {}, by: 'policy' };
  if (!forGet && attrs.payload.mode === 'summary') return { with: 'clip', args: { max: attrs.payload.max }, by: 'default' };
  return null;
}

// -> the reduced string; throws when the reducer is unknown or throws (the caller turns that into REDUCER_FAILED)
export async function applyReducer(registry, spec, text, ctx) {
  const fn = registry[spec.with];
  if (typeof fn !== 'function') throw new Error(`unknown reducer "${spec.with}"`);
  const out = await fn(text, spec.args, ctx);
  const v = out && typeof out === 'object' && 'value' in out ? out.value : out;
  return typeof v === 'string' ? v : String(v);
}

// one row per (with, args, on, by); hit, in, out summed (5.3, H5)
export function addRow(rows, spec, kind, inLen, outLen) {
  const base = { with: spec.with, args: spec.args, on: [kind + '.payload'], by: spec.by }, k = JSON.stringify(base);
  const row = rows.get(k) || rows.set(k, { ...base, hit: 0, in: 0, out: 0 }).get(k);
  row.hit++; row.in += inLen; row.out += outLen;
}
