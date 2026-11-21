// Query surface, validate stage (docs/QUERY.md 1.3, 1.4): the AST and the variables against the merged schema.
// Collects every error; nothing executes if any exists. Pure.
import { jsValue } from './query-parse.js';
import { parseType, SCALARS, fieldNames } from './query-schema.js';
import { DECORATORS, readDecorators, resolveAttrs } from './query-attrs.js';

const DIRS = {
  payload: { mode: 'enum:summary|full|none', max: 'Int' }, reduce: { with: 'String!' }, labels: { as: 'enum:list|range|inline|none' },
  refs: { ops: '[enum:get|property|set]', names: '[String]' }, descriptor: { mode: 'enum:first|always|off' },
  scope: { queries: 'Int', ticks: 'Int' }, skip: { if: 'Boolean!' }, include: { if: 'Boolean!' },
};
const COND = new Set(['skip', 'include']);

const baseOk = (exp, got) => exp === got || (exp === 'ID' && (got === 'String' || got === 'Int')) || (exp === 'String' && got === 'ID') || (exp === 'Float' && got === 'Int');
const tinfo = t => (t.kind === 'list' ? { list: true, base: tinfo(t.of).base, nn: t.nn } : { list: false, base: t.name, nn: t.nn });
const KIND_OF = { int: ['Int', 'Float', 'ID'], float: ['Float'], string: ['String', 'ID'], bool: ['Boolean'] };

function fitsItem(base, n, vt) {
  if (n.k === 'var') { const v = vt[n.name]; return !v || baseOk(base, tinfo(v).base); }
  return n.k === 'null' || !!KIND_OF[n.k]?.includes(base);
}
function fitsNode(exp, n, vt) {
  if (n.k === 'var') { const v = vt[n.name]; if (!v) return true; const i = tinfo(v); return i.list === exp.list && baseOk(exp.base, i.base); }
  if (n.k === 'null') return !exp.nn;
  if (exp.list && n.k === 'list') return n.v.every(x => fitsItem(exp.base, x, vt));
  return !exp.list && n.k !== 'list' && n.k !== 'obj' && fitsItem(exp.base, n, vt);
}
const JS_OK = { Int: Number.isInteger, Float: v => typeof v === 'number', String: v => typeof v === 'string', Boolean: v => typeof v === 'boolean', ID: v => typeof v === 'string' || Number.isInteger(v) };
function fitsJs(exp, v) {
  if (v === null || v === undefined) return !exp.nn;
  return exp.list ? Array.isArray(v) && v.every(x => JS_OK[exp.base]?.(x)) : !!JS_OK[exp.base]?.(v);
}

function dirValueOk(spec, v) {
  const [, enums] = /^\[?enum:([\w|]+)\]?$/.exec(spec) || [];
  const one = x => (enums ? enums.split('|').includes(x) : spec.replace(/[![\]]/g, '') === 'Int' ? Number.isInteger(x) : spec.replace(/[![\]]/g, '') === 'Boolean' ? typeof x === 'boolean' : typeof x === 'string');
  return spec.startsWith('[') ? Array.isArray(v) && v.every(one) : one(v);
}

export function skipped(directives, vars) {
  for (const d of directives) if (COND.has(d.name)) {
    const v = jsValue(d.args.find(a => a.name === 'if')?.value ?? { k: 'null' }, vars);
    if (d.name === 'skip' ? v === true : v === false) return true;
  }
  return false;
}

// the fields of a selection set with named fragments expanded; with vars, @skip and @include are applied
export function expand(sel, frags, vars, stack = []) {
  const out = [];
  for (const n of sel) {
    if (n.kind === 'field') { if (!vars || !skipped(n.directives, vars)) out.push(n); continue; }
    const f = frags.get(n.name);
    if (!f || stack.includes(n.name) || (vars && (skipped(n.directives, vars) || skipped(f.directives, vars)))) continue;
    out.push(...expand(f.sel, frags, vars, [...stack, n.name]));
  }
  return out;
}

const varsIn = (n, out) => {
  if (!n) return out;
  if (n.k === 'var') out.push(n);
  else if (n.k === 'list') n.v.forEach(x => varsIn(x, out));
  else if (n.k === 'obj') n.v.forEach(([, x]) => varsIn(x, out));
  return out;
};
function usedVars(op, frags) {
  const out = [], walkDirs = ds => ds.forEach(d => d.args.forEach(a => varsIn(a.value, out)));
  const walk = sel => sel.forEach(n => { walkDirs(n.directives); if (n.kind === 'field') { n.args.forEach(a => varsIn(a.value, out)); n.sel && walk(n.sel); } });
  walkDirs(op.directives); walk(op.sel);
  for (const f of frags.values()) { walkDirs(f.directives); walk(f.sel); }
  return out;
}

const argKey = n => JSON.stringify(n.args.map(a => [a.name, a.value]), (k, v) => (k === 'loc' ? undefined : v));

class Check {
  constructor(schema, policy, registry, frags, vars, varTypes) { Object.assign(this, { schema, policy, registry, frags, vars, varTypes }); this.errors = []; this.lim = policy?.limits || {}; }
  err(message, code, loc) { this.errors.push({ message, ...(loc ? { locations: [loc] } : {}), extensions: { code, stage: 'validate' } }); }

  directives(node, entry) {
    for (const d of node.directives) {
      if (COND.has(d.name) || (entry && DECORATORS.has(d.name))) { this.dirArgs(d); continue; }
      this.err(DECORATORS.has(d.name) ? `directive "@${d.name}" is allowed on entry fields only` : `unknown directive "@${d.name}"`, 'UNKNOWN_DIRECTIVE', d.loc);
    }
  }
  dirArgs(d) {
    const spec = DIRS[d.name], given = new Set();
    for (const a of d.args) {
      given.add(a.name);
      const s = spec[a.name];
      if (!s) { if (d.name !== 'reduce') this.err(`unknown argument "${a.name}" on @${d.name} (arguments: ${Object.keys(spec).join(', ')})`, 'UNKNOWN_ARG', a.loc); continue; }
      if (!dirValueOk(s, jsValue(a.value, this.vars))) this.err(`argument "${a.name}" of @${d.name} does not fit ${s.replace(/^\[?enum:/, 'one of ').replace(/\]$/, '')}`, 'TYPE_MISMATCH', a.loc);
    }
    for (const [k, s] of Object.entries(spec)) if (s.endsWith('!') && !given.has(k)) this.err(`@${d.name} needs argument "${k}"`, 'MISSING_ARG', d.loc);
    if (d.name === 'scope' && given.size !== 1) this.err('@scope takes exactly one of queries, ticks', 'MISSING_ARG', d.loc);
    if (d.name === 'reduce') {
      const w = jsValue(d.args.find(a => a.name === 'with')?.value ?? { k: 'null' }, this.vars);
      if (typeof w === 'string' && typeof this.registry[w] !== 'function') this.err(`unknown reducer "${w}" (reducers: ${Object.keys(this.registry).join(', ')})`, 'UNKNOWN_REDUCER', d.loc);
    }
  }

  args(node, def, label) {
    const known = Object.keys(def.args || {}), given = new Set();
    for (const a of node.args) {
      given.add(a.name);
      if (!(a.name in (def.args || {}))) { this.err(`unknown argument "${a.name}" on ${label} (arguments: ${known.join(', ') || 'none'})`, 'UNKNOWN_ARG', a.loc); continue; }
      if (!fitsNode(parseType(def.args[a.name]), a.value, this.varTypes)) this.err(`argument "${a.name}" of ${label} does not fit ${def.args[a.name]}`, 'TYPE_MISMATCH', a.loc);
      else if (a.name === 'first') this.first(jsValue(a.value, this.vars), a);
    }
    for (const [k, t] of Object.entries(def.args || {})) {
      if (!t.endsWith('!')) continue;
      const a = node.args.find(x => x.name === k);
      if (!a || jsValue(a.value, this.vars) == null) this.err(`${label} needs argument "${k}" (${t})`, 'MISSING_ARG', node.loc);
    }
  }
  first(v, a) {
    const max = this.lim.maxFirst ?? 100;
    if (!Number.isInteger(v)) return;
    if (v < 0) this.err('first must not be negative', 'TYPE_MISMATCH', a.loc);
    else if (v > max) this.err(`first ${v} is above the limit ${max}`, 'LIMIT_FIRST', a.loc);
  }

  conflicts(sel, where) {
    const seen = new Map();
    for (const n of expand(sel, this.frags)) {
      const key = n.alias || n.name, sig = n.name + argKey(n), had = seen.get(key);
      if (had && had !== sig) this.err(`response key "${key}" is used by two different fields in ${where}`, 'KEY_CONFLICT', n.loc);
      seen.set(key, had ?? sig);
    }
  }

  // a selection under an entry field
  entrySel(node, root) {
    const type = this.schema.types[root.base], kind = this.schema.kinds[root.kind];
    const mode = resolveAttrs(readDecorators(node, this.vars), this.policy).attrs.payload.mode;
    this.conflicts(node.sel, node.alias || node.name);
    for (const n of node.sel) {
      if (n.kind === 'spread') {
        this.spread(n, root.base);
        for (const f of expand([n], this.frags)) if (f.name === 'payload' && mode === 'none') this.err('payload is denied: the effective payload mode is none', 'PAYLOAD_DENIED', f.loc);
        continue;
      }
      this.sub(n, type, kind, mode, root.base);
    }
  }
  sub(n, type, kind, mode, tname) {
    this.directives(n, false);
    if (n.name === '__typename') return;
    if (!(n.name in (type.fields || {})) && n.name !== 'payload' && n.name !== 'label') {
      this.err(`unknown field "${n.name}" on ${tname} (fields: ${fieldNames(type).join(', ')})`, 'UNKNOWN_FIELD', n.loc); return;
    }
    if (n.args.length) this.err(`field "${n.name}" takes no arguments`, 'UNKNOWN_ARG', n.args[0].loc);
    if (n.sel) this.err(`field "${n.name}" is a scalar and takes no selection`, 'BAD_SELECTION', n.loc);
    if (n.name === 'payload' && !kind.gettable) this.err(`payload is not available: kind ${kind.name} is not gettable`, 'BAD_SELECTION', n.loc);
    else if (n.name === 'payload' && mode === 'none') this.err('payload is denied: the effective payload mode is none', 'PAYLOAD_DENIED', n.loc);
  }
  spread(n, parent) {
    this.directives(n, false);
    const f = this.frags.get(n.name);
    if (!f) this.err(`unknown fragment "${n.name}"`, 'UNKNOWN_FRAGMENT', n.loc);
    else if (f.on !== parent) this.err(`fragment "${n.name}" is on ${f.on} and cannot be spread in ${parent}`, 'BAD_SELECTION', n.loc);
  }

  root(node) {
    const r = node.name === '__synopsis' ? { name: '__synopsis', type: 'String', args: {}, entry: false } : this.schema.roots[node.name];
    this.directives(node, !!r?.entry);
    if (node.name === '__typename') return;
    if (!r) { this.err(`unknown field "${node.name}" on Query (fields: ${[...Object.keys(this.schema.roots), '__synopsis'].join(', ')})`, 'UNKNOWN_FIELD', node.loc); return; }
    this.args(node, r, node.name);
    if (!r.entry) { node.sel && this.err(`field "${node.name}" is a scalar and takes no selection`, 'BAD_SELECTION', node.loc); return; }
    if (!node.sel) { this.err(`field "${node.name}" returns ${r.type} and needs a selection`, 'BAD_SELECTION', node.loc); return; }
    this.entrySel(node, r);
  }
}

function checkVariables(op, supplied, c) {
  const vars = {}, types = {};
  for (const d of op.vars) {
    types[d.name] = d.type;
    const info = tinfo(d.type);
    if (!SCALARS.has(info.base)) { c.err(`variable $${d.name} has type "${info.base}"; only Int, Float, String, Boolean, ID are supported`, 'TYPE_MISMATCH', d.loc); continue; }
    const v = supplied[d.name];
    if (v === undefined) {
      if (d.def) vars[d.name] = jsValue(d.def, {});
      else if (info.nn) c.err(`variable $${d.name} is required and was not supplied`, 'MISSING_VARIABLE', d.loc);
    } else if (!fitsJs(info, v)) c.err(`variable $${d.name} does not fit ${info.list ? '[' + info.base + ']' : info.base}`, 'TYPE_MISMATCH', d.loc);
    else vars[d.name] = v;
  }
  return { vars, types };
}

function checkFragments(c, op) {
  const reached = new Set(), cyc = new Set();
  const visit = (sel, stack) => sel.forEach(n => {
    if (n.kind === 'field') { n.sel && visit(n.sel, stack); return; }
    const f = c.frags.get(n.name);
    if (!f) return;
    if (stack.includes(n.name)) { if (!cyc.has(n.name)) { cyc.add(n.name); c.err(`fragment "${n.name}" spreads itself (${[...stack.slice(stack.indexOf(n.name)), n.name].join(' -> ')})`, 'FRAGMENT_CYCLE', f.loc); } return; }
    if (reached.has(n.name)) return;
    reached.add(n.name); visit(f.sel, [...stack, n.name]);
  });
  visit(op.sel, []);
  for (const [name, f] of c.frags) {
    if (!reached.has(name)) c.err(`fragment "${name}" is never used`, 'UNUSED_FRAGMENT', f.loc);
    c.directives(f, false);
    if (f.on === 'Query') continue;
    const type = c.schema.types[f.on], root = Object.values(c.schema.roots).find(r => r.base === f.on && r.entry);
    if (!type || !type.kind || !root) { c.err(`fragment "${name}" is on unknown type "${f.on}"`, 'BAD_SELECTION', f.loc); continue; }
    for (const n of f.sel) n.kind === 'spread' ? c.spread(n, f.on) : c.sub(n, type, c.schema.kinds[type.kind], 'summary', f.on);
  }
}

function countLimits(c, op) {
  const maxF = c.lim.maxFields ?? 60, maxD = c.lim.maxDepth ?? 5;
  let n = 0, deep = false;
  const walk = (sel, depth, stack) => {
    for (const x of sel) {
      if (x.kind === 'field') { n++; if (depth > maxD && !deep) { deep = true; c.err(`selection is deeper than the limit ${maxD}`, 'LIMIT_DEPTH', x.loc); } x.sel && walk(x.sel, depth + 1, stack); continue; }
      const f = c.frags.get(x.name);
      if (f && !stack.includes(x.name)) walk(f.sel, depth, [...stack, x.name]);
    }
  };
  walk(op.sel, 1, []);
  if (n > maxF) c.err(`the query selects ${n} fields; the limit is ${maxF}`, 'LIMIT_FIELDS', op.loc);
}

// -> {errors, plan: {op, frags, vars}}
export function validate({ ast, variables, schema, policy, registry }) {
  const c0 = new Check(schema, policy, registry, new Map(ast.frags.map(f => [f.name, f])), {}, {});
  if (ast.ops.length > 1) { c0.err('only one operation per query text is supported', 'MULTIPLE_OPERATIONS', ast.ops[1].loc); return { errors: c0.errors }; }
  if (!ast.ops.length) { c0.err('the query text has no operation', 'NO_OPERATION', ast.frags[0]?.loc); return { errors: c0.errors }; }
  const op = ast.ops[0], { vars, types } = checkVariables(op, variables || {}, c0);
  const c = new Check(schema, policy, registry, c0.frags, vars, types);
  c.errors = c0.errors;
  c.directives(op, false);
  const decls = new Set(op.vars.map(v => v.name)), used = usedVars(op, c.frags);
  for (const u of used) if (!decls.has(u.name)) c.err(`variable $${u.name} is not defined`, 'UNDEFINED_VARIABLE', u.loc);
  for (const d of op.vars) if (!used.some(u => u.name === d.name)) c.err(`variable $${d.name} is defined and never used`, 'UNUSED_VARIABLE', d.loc);
  checkFragments(c, op);
  c.conflicts(op.sel, 'the operation');
  for (const n of op.sel) n.kind === 'spread' ? c.spread(n, 'Query') : c.root(n);
  countLimits(c, op);
  return { errors: c.errors, plan: { op, frags: c.frags, vars } };
}
