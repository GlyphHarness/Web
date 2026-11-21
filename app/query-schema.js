// Query surface, schema seam (docs/QUERY.md 3.1, 6.1, 6.4): kind registration checks, the merge of adapter schemas, the synopsis.
// Pure. An adapter is plain data plus functions; nothing here knows which adapter it is.
export class RegistrationError extends Error {
  constructor(code, message) { super(code + ': ' + message); this.code = code; }
}

const isFn = f => typeof f === 'function';

export function checkKind(key, d) {
  const bad = m => { throw new RegistrationError('BAD_KIND', `kind "${key}": ${m}`); };
  if (!d || typeof d !== 'object') bad('not an object');
  if (!isFn(d.label)) bad('label is missing');
  if (!isFn(d.key)) bad('key is missing');
  if (!Array.isArray(d.props)) bad('props is missing');
  if (!isFn(d.fn)) bad('fn is missing');
  const settable = d.settable || [];
  if (settable.length && !isFn(d.set)) bad('settable is not empty and set is missing');
  for (const s of settable) if (!d.props.includes(s)) bad(`settable "${s}" is not in props`);
}

// "[Item]", "Item!", "[ID!]!" -> {list, base, nn}
export function parseType(s) {
  const m = /^\[(\w+)!?\](!?)$|^(\w+)(!?)$/.exec(String(s).replace(/\s/g, ''));
  if (!m) return { list: false, base: String(s), nn: false };
  return m[1] ? { list: true, base: m[1], nn: m[2] === '!' } : { list: false, base: m[3], nn: m[4] === '!' };
}

export const SCALARS = new Set(['Int', 'Float', 'String', 'Boolean', 'ID']);

// -> {types, roots, kinds}; roots carry their adapter and whether they are entry fields
export function mergeAdapters(adapters) {
  const types = {}, roots = {}, kinds = {};
  for (const a of adapters) {
    for (const [k, d] of Object.entries(a.kinds || {})) {
      if (kinds[k]) throw new RegistrationError('DUPLICATE_KIND', `kind "${k}" is registered twice (adapter ${a.name})`);
      checkKind(k, d);
      kinds[k] = { ...d, name: k, adapter: a };
    }
    for (const [t, d] of Object.entries(a.schema?.types || {})) types[t] = d;
    for (const [r, d] of Object.entries(a.schema?.roots || {})) {
      if (roots[r]) throw new RegistrationError('DUPLICATE_ROOT', `root field "${r}" is registered twice (adapter ${a.name})`);
      const ty = parseType(d.type), entry = !!types[ty.base]?.kind;
      roots[r] = { name: r, type: d.type, args: d.args || {}, adapter: a, list: ty.list, base: ty.base, entry, kind: entry ? types[ty.base].kind : null };
    }
  }
  for (const [t, d] of Object.entries(types)) if (d.kind && !kinds[d.kind]) throw new RegistrationError('UNKNOWN_KIND', `type "${t}" names kind "${d.kind}", which no adapter registers`);
  return { types, roots, kinds };
}

export const fieldNames = type => [...Object.keys(type.fields || {}), 'payload', 'label'];

// plain deterministic text: the query shape a preface can carry (6.4)
export function synopsis(schema) {
  const out = ['QUERY SHAPE', 'roots:'];
  for (const r of Object.values(schema.roots)) {
    const args = Object.entries(r.args).map(([k, v]) => `${k}: ${v}`).join(', ');
    out.push(`  ${r.name}(${args}): ${r.type}`);
  }
  out.push('  __synopsis: String', 'types (every entry type also has label and payload):');
  for (const [t, d] of Object.entries(schema.types)) {
    out.push(`  ${t}${d.kind ? ' [kind ' + d.kind + ']' : ''} { ${Object.entries(d.fields || {}).map(([k, v]) => `${k}: ${v}`).join(', ')} }`);
  }
  out.push('decorators on entry fields: @payload(mode, max) @reduce(with, args) @labels(as) @refs(ops, names) @descriptor(mode) @scope(queries|ticks)');
  return out.join('\n');
}
