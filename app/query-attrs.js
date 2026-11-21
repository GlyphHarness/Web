// Query surface, decorators and attributes (docs/QUERY.md 2.2, 2.3): what a field's directives say, and the effective value of
// each attribute under a policy (lock, else decorator, else policy default, else built-in). Pure.
import { jsValue } from './query-parse.js';

export const ATTRS = ['payload', 'reducer', 'labels', 'refs', 'descriptor', 'scope'];
export const BUILTIN = Object.freeze({ payload: { mode: 'summary', max: 200 }, reducer: 'none', labels: 'list', refs: 'infer', descriptor: 'first', scope: { queries: 8 } });
export const DECORATORS = new Set(['payload', 'reduce', 'labels', 'refs', 'descriptor', 'scope']);

const argMap = (d, vars) => Object.fromEntries(d.args.map(a => [a.name, jsValue(a.value, vars)]));

// the decorators written on one field -> {payload?, reduce?, labels?, refs?, descriptor?, scope?}
export function readDecorators(node, vars) {
  const dec = {};
  for (const d of node.directives) if (DECORATORS.has(d.name)) {
    const a = argMap(d, vars);
    if (d.name === 'reduce') { const { with: w, ...args } = a; dec.reduce = { with: w, args }; }
    else dec[d.name] = a;
  }
  return dec;
}

const payloadOf = (base, a) => ({ mode: a.mode ?? base.mode, max: a.max ?? base.max });
const fromDecorator = (name, dec, base) => {
  const a = dec[name === 'reducer' ? 'reduce' : name];
  if (a === undefined) return undefined;
  switch (name) {
    case 'payload': return payloadOf(base, a);
    case 'reducer': return a.with;
    case 'labels': return a.as;
    case 'refs': return a.names ? { ops: a.ops ?? [], names: a.names } : { ops: a.ops ?? [] };
    case 'descriptor': return a.mode;
    default: return a.ticks !== undefined ? { ticks: a.ticks } : { queries: a.queries };
  }
};

// -> {attrs, src: {name: 'query'|'policy'|undefined}, ov: [names a lock overrode], dropped: [{what, why}]}
export function resolveAttrs(dec, policy) {
  const p = policy || {}, locks = p.locks || [], attrs = {}, src = {}, ov = [], dropped = [];
  for (const name of ATTRS) {
    const pd = p.defaults?.[name];
    const base = pd === undefined ? BUILTIN[name] : name === 'payload' ? payloadOf(BUILTIN.payload, pd) : pd;
    const q = fromDecorator(name, dec, base);
    if (locks.includes(name)) { attrs[name] = base; src[name] = 'policy'; if (q !== undefined) ov.push(name); }
    else if (q !== undefined) { attrs[name] = q; src[name] = 'query'; }
    else { attrs[name] = base; if (pd !== undefined) src[name] = 'policy'; }
  }
  if (p.verbose === false && attrs.payload.mode === 'full') {
    attrs.payload = { mode: 'summary', max: attrs.payload.max };
    dropped.push({ what: 'payload.mode full', why: 'policy:verbose false' });
  }
  return { attrs, src, ov, dropped };
}

// one value per path -> scalar when all equal, else {path: value} for the differing paths and "*" for the most common
export function flatten(perPath) {
  const keys = perPath.map(([, v]) => JSON.stringify(v)), distinct = [...new Set(keys)];
  if (distinct.length <= 1) return perPath.length ? perPath[0][1] : undefined;
  const count = k => keys.filter(x => x === k).length;
  const common = distinct.reduce((a, b) => (count(b) > count(a) ? b : a));
  const out = {};
  perPath.forEach(([path, v], i) => { if (keys[i] !== common) out[path] = v; });
  out['*'] = JSON.parse(common);
  return out;
}

// the sources of one attribute across paths: "query", "policy", "mixed" or undefined
export function mergeSrc(list) {
  const s = new Set(list.filter(Boolean));
  return s.size === 0 ? undefined : s.size === 1 ? [...s][0] : 'mixed';
}
