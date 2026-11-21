// Query surface (docs/QUERY.md, contracts Q1..Q22). Seams: parser, validator, executor, header builder, reducer
// hook, ref gate, adapter. Node only; no browser, no provider, no network. A mock adapter (in memory) is the whole
// of Q1..Q21; only Q22 uses the harness adapter, over scripts/fixtures/metrics-sessions.json and in-test slices.
// Run: node scripts/test-query.mjs
//
// A check is a function: a throw (the module or an export is not there yet) is a failed check, not a stopped suite.
//
// Readings taken where docs/QUERY.md leaves a determination open (narrowest reading; each also in the report):
//  R1  The AST shape is not specified, so Q1 is observed through surface.run: a form "parses" when no error of
//      stage "parse" comes back. The Out forms must give code PARSE, stage parse and a message with "unsupported".
//  R2  The surface passes the effective `first` (given, else policy defaultFirst, else 20) to adapter.resolve as
//      args.first, and `after` as given; the adapter returns {entries, total, next}.
//  R3  Entry-field data: a list root is an array, a single-entry root an object, in selection order, keyed by alias.
//  R4  adapter fn(entry, {props:[name]}) returns an object {name: value}; the property ref returns the one value.
//      The check accepts either the bare value or {name: value} (the doc says "that one value" and "properties").
//  R5  set returns the adapter's {value}; the ref data is checked only to carry the value (bare or wrapped).
//  R6  get (ref) uses the reducer attribute and the declared max cap; the payload-mode default clip is for the
//      inline `payload` pseudo field, not for get (else get could never return more than Example 1's clip).
//  R7  REF_POLICY: the policy object is read at ref time, so adding `deny` to it after the run refuses the ref.
//  R8  Scope: queries N is tested away from the boundary (QUERY.md 2.3 says "(N+1)th later query", 4.4 "among the N
//      most recent": these differ by one); ticks likewise. "surface" scope is set by policy defaults.
//  R9  Materialized descriptor: the text appears in the serialized header on `sent`/`always` and not on
//      `seen`/`off`/`prefaced`; the block's desc is `seen`/`off`/`prefaced` where the doc names them.
//  R10 `payload` is listed before `label` in field listings (the worked error example), not the 1.4 prose order.
//  R11 Registration errors are thrown by createSurface; the duplicate ones carry DUPLICATE_ROOT / DUPLICATE_KIND in
//      `code` or `message`.
//  R12 Harness adapter factory: app/query-harness.js exports createHarnessAdapter(sources) (name not in the doc).
//      Ledger and trail rows are labelled r<n>, k<n> with n the data's own `n`; only consistency is checked.
//  R13 LIMIT_DEPTH is not tested (how depth counts is not specified); LIMIT_FIRST and LIMIT_FIELDS are.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = await import('../app/query.js').catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
const H = await import('../app/query-harness.js').catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
const api = n => { if (Q.missing) throw new Error('app/query.js: ' + Q.missing); if (typeof Q[n] !== 'function') throw new Error('export missing: ' + n); return Q[n]; };
const harness = n => { if (H.missing) throw new Error('app/query-harness.js: ' + H.missing); if (typeof H[n] !== 'function') throw new Error('export missing: ' + n); return H[n]; };

let fails = 0, group = '';
const tally = {};
const check = async (name, fn) => {
  let ok = false, got = '';
  try { const r = await fn(); ok = r === true; if (!ok) got = JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  const g = name.split(' ')[0]; tally[g] ??= { pass: 0, fail: 0 }; tally[g][ok ? 'pass' : 'fail']++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + String(got).slice(0, 200)));
  if (!ok) fails++;
};
const J = v => JSON.stringify(v);
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => J(canon(a)) === J(canon(b));
const clip = (s, max) => s.length > max + 16 ? s.slice(0, max) + `...[+${s.length - max}]` : s;
const codes = r => (r.errors || []).map(e => e.extensions?.code);
const clock = () => { let t = 1700000000000; return () => (t += 10); };

// ---------------------------------------------------------------- the mock adapter (in memory)
const BODY = n => n === 1 ? 'B'.repeat(300) : n === 2 ? 'short body' : n === 3 ? 'C'.repeat(216) : n === 4 ? 'D'.repeat(217) : n === 5 ? 'l1\nl2\nl3\nl4\nl5' : 'body' + n;
const ITEMS = Array.from({ length: 12 }, (_, k) => { const n = k + 1; return { id: 'i' + n, name: 'name' + n, n, status: n % 2 ? 'open' : 'closed', tags: ['t' + n], body: BODY(n) }; });
const NOTES = Array.from({ length: 5 }, (_, k) => ({ n: k + 1, title: 'title' + (k + 1) }));
const page = (all, args) => { const first = args.first ?? 20, off = args.after ? Number(args.after) : 0, end = off + first; return { entries: all.slice(off, end), total: all.length, next: end < all.length ? String(end) : null }; };
const kindDef = (over = {}) => ({ name: 'item', type: 'Item', label: e => e.id, key: e => e.id, props: ['id', 'name'], gettable: true, settable: [], fn: () => null, ...over });
const adapterWith = (kinds, name = 'bad') => ({ name, schema: { types: { Item: { fields: { id: 'ID', name: 'String' }, kind: 'item' } }, roots: { [name + 'Items']: { type: '[Item]', args: { first: 'Int', after: 'String' } } } }, kinds, resolve: async () => ({ entries: [] }) });

function mkMock(over = {}) {
  const calls = { resolve: 0, fn: 0, set: 0, args: [], sets: [] };
  const adapter = {
    name: 'mock',
    schema: {
      types: {
        Item: { fields: { id: 'ID', name: 'String', n: 'Int', status: 'String', tags: '[String]' }, kind: 'item' },
        Note: { fields: { n: 'Int', title: 'String' }, kind: 'note' },
        Clash: { fields: { id: 'ID' }, kind: 'clash' },
        Render: { fields: { id: 'ID' }, kind: 'render' },
      },
      roots: {
        items: { type: '[Item]', args: { status: 'String', first: 'Int', after: 'String' } },
        item: { type: 'Item', args: { id: 'ID!' } },
        notes: { type: '[Note]', args: { first: 'Int', after: 'String' } },
        clashes: { type: '[Clash]', args: { first: 'Int', after: 'String' } },
        renders: { type: '[Render]', args: { first: 'Int', after: 'String' } },
        boom: { type: 'Item', args: { id: 'ID' } },
        version: { type: 'String', args: {} },
      },
    },
    kinds: {
      item: {
        name: 'item', type: 'Item', label: e => e.id, key: e => e.id,
        props: ['id', 'name', 'n', 'status', 'tags'], gettable: true, settable: ['status'],
        fn(e, what) { calls.fn++; if (what.payload) { if (over.failGet === e.id) throw new Error('disk gone'); return e.body; } const o = {}; for (const p of what.props) o[p] = e[p]; return o; },
        set(e, name, value) { calls.set++; calls.sets.push([e.id, name, value]); return { value }; },
      },
      note: { name: 'note', type: 'Note', label: e => 'n' + e.n, key: e => 'n' + e.n, props: ['n', 'title'], gettable: false, settable: [], fn(e, what) { calls.fn++; const o = {}; for (const p of what.props || []) o[p] = e[p]; return o; } },
      clash: { name: 'clash', type: 'Clash', label: e => e.id, key: e => 'c:' + e.id, props: ['id'], gettable: false, settable: [], fn: () => ({}) },
      render: { name: 'render', type: 'Render', label: e => e.id, key: e => e.id, props: ['id'], gettable: true, settable: [], fn(e, what) { calls.fn++; return what.payload ? 'rendered ' + e.id : {}; }, materialized: { descriptor: 'RENDER-SYNTAX: lines of text' } },
    },
    async resolve(root, args, ctx) {
      calls.resolve++; calls.args.push({ root, args: { ...args }, reader: ctx?.reader });
      if (root === 'items') return page(args.status ? ITEMS.filter(e => e.status === args.status) : ITEMS, args);
      if (root === 'item') { const e = ITEMS.find(x => x.id === args.id); return { entries: e ? [e] : [] }; }
      if (root === 'notes') return page(NOTES, args);
      if (root === 'clashes') return page([{ id: 'i1' }, { id: 'z9' }], args);
      if (root === 'renders') return page([{ id: 'r1' }, { id: 'r2' }], args);
      if (root === 'boom') throw new Error('source exploded');
      if (root === 'version') return { value: '1' };
      throw new Error('mock: no root ' + root);
    },
  };
  return { adapter, calls };
}
// a second, unrelated adapter: proves the seam does not know the first one
const mkLibrary = () => ({
  name: 'library',
  schema: { types: { Book: { fields: { isbn: 'ID', title: 'String' }, kind: 'book' } }, roots: { books: { type: '[Book]', args: { first: 'Int', after: 'String' } } } },
  kinds: { book: { name: 'book', type: 'Book', label: e => e.isbn, key: e => e.isbn, props: ['isbn', 'title'], gettable: false, settable: [], fn: (e, what) => Object.fromEntries((what.props || []).map(p => [p, e[p]])) } },
  async resolve(root, args) { return page([{ isbn: 'b001', title: 'One' }, { isbn: 'b002', title: 'Two' }, { isbn: 'b003', title: 'Three' }], args); },
});

const first3 = (v, args) => String(v).slice(0, args.n ?? 3);
const mk = (o = {}) => {
  const m = mkMock(o.mock || {});
  const S = api('createSurface')({ adapters: [m.adapter, ...(o.extra || [])], now: clock(), ...(o.policy ? { policy: o.policy } : {}), reducers: { first3, ...(o.reducers || {}) }, ...(o.reader ? { reader: o.reader } : {}), ...(o.prefaced ? { prefaced: o.prefaced } : {}) });
  return { S, m };
};
const go = async (text, o = {}, ro = {}) => { const { S, m } = mk(o); const r = await S.run(text, ro); return { S, m, r, h: r.header, d: r.data, e: r.errors || [] }; };
const parseErrs = r => (r.errors || []).filter(e => e.extensions?.stage === 'parse');
const oneValue = (data, name, v) => same(data, v) || same(data, { [name]: v });
const DEFAULT_ATTRS = '{"payload":{"mode":"summary","max":200},"reducer":"none","labels":"list","refs":"infer","descriptor":"first","scope":{"queries":8}}';
const HEADER_ORDER = ['v', 'q', 'op', 'ok', 'count', 'pages', 'attrs', 'src', 'kinds', 'reducers', 'refs', 'dropped', 'policy'];
const inOrder = keys => { let at = -1; for (const k of keys) { const i = HEADER_ORDER.indexOf(k); if (i <= at) return false; at = i; } return true; };

// ================================================================ Q1 parse the subset
await check('Q1 parse: a query with a name, variable definitions with defaults and list types, comments and commas parses', async () => {
  const { r } = await go('# a comment\nquery Q($a: Int = 1, $b: [String!]! = ["x", "y"], $c: Boolean) { items(first: $a, status: "open",) { id, name } }');
  return !parseErrs(r).length;
});
await check('Q1 parse: the shorthand operation, aliases, __typename and field directives parse', async () => {
  const { r } = await go('{ top: items(first: 2) @include(if: true) { ident: id __typename } }');
  return !parseErrs(r).length;
});
await check('Q1 parse: named fragments, spreads with directives and fragment directives parse', async () => {
  const { r } = await go('query { items(first: 1) { ...F @include(if: true) } } fragment F on Item @skip(if: false) { id }');
  return !parseErrs(r).length;
});
await check('Q1 parse: every value form (variable, int, float, string escapes, booleans, null, enum, list, object) parses', async () => {
  const { r } = await go('query ($v: String) { items(status: $v, first: -1, after: "a\\"b\\\\c\\n\\t\\u0041") { id } a: items(first: 1.5) { id } b: items(status: true) { id } c: items(status: null) { id } d: items(status: ENUM_VALUE) { id } e: items(status: [1, [2], "x"]) { id } f: items(status: {k: 1, o: {z: false}}) { id } }');
  return !parseErrs(r).length;
});
await check('Q1 parse: an operation may carry directives after its variable definitions', async () => {
  const { r } = await go('query Q($a: Int) @include(if: true) { version }');
  return !parseErrs(r).length;
});
const OUT = [
  ['mutation { x }', 'mutation'], ['subscription { x }', 'subscription'],
  ['{ items { ... on Item { id } } }', null], ['{ items { ... @include(if: true) { id } } }', null],
  ['interface X { a: Int }', null], ['union U = A | B', null], ['extend type X { a: Int }', null], ['type X { a: Int }', null], ['scalar Date', null],
  ['{ items(status: """block""") { id } }', null], ['query ($a: Int @d) { version }', null], ['directive @d on FIELD', null],
];
for (const [text, word] of OUT) await check('Q1 parse: out form fails with PARSE and unsupported, nothing runs: ' + text.replace(/[{}"]/g, '_').slice(0, 40), async () => {
  const { r, m } = await go(text);
  const e = r.errors?.[0];
  return !!e && e.extensions.code === 'PARSE' && e.extensions.stage === 'parse' && /unsupported/.test(e.message) && (!word || e.message.includes('unsupported: ' + word)) && m.calls.resolve === 0 && !('data' in r);
});
await check('Q1 parse: errors carry the line and column of the token', async () => {
  const { r } = await go('\n  mutation { x }');
  return same(r.errors?.[0]?.locations, [{ line: 2, column: 3 }]);
});
await check('Q1 parse: plain syntax errors are PARSE with a location', async () => {
  const { r } = await go('{ items(first: 2 { id } }');
  const e = r.errors?.[0];
  return e?.extensions?.code === 'PARSE' && Number.isInteger(e.locations?.[0]?.line) && Number.isInteger(e.locations[0].column);
});
await check('Q1 parse: introspection is a validate error UNKNOWN_FIELD, not a parse error', async () => {
  const { r } = await go('{ __schema { types { name } } }');
  return r.errors?.[0]?.extensions?.code === 'UNKNOWN_FIELD' && r.errors[0].extensions.stage === 'validate';
});
await check('Q1 parse: two operations in one document are MULTIPLE_OPERATIONS (validate)', async () => {
  const { r } = await go('query A { version } query B { version }');
  return codes(r).includes('MULTIPLE_OPERATIONS') && r.errors[0].extensions.stage === 'validate';
});
await check('Q1 parse: a custom scalar type on a variable is a validate error', async () => {
  const { r } = await go('query ($d: Date) { version }', {}, { variables: { d: 'x' } });
  return r.errors?.length > 0 && r.errors.every(e => e.extensions.stage === 'validate');
});

// ================================================================ Q2 validate collects everything
await check('Q2 validate: three faults give three errors, each stage validate, and nothing executes', async () => {
  const { r, m } = await go('{ item { id nope } items(bogus: 1) { id } }');
  return same([...codes(r)].sort(), ['MISSING_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FIELD']) && r.errors.length === 3 && r.errors.every(e => e.extensions.stage === 'validate') && m.calls.resolve === 0 && !('data' in r);
});
const longSel = Array.from({ length: 70 }, (_, k) => `a${k}: id`).join(' ');
const VCODES = [
  ['UNKNOWN_FIELD', '{ nope }'], ['UNKNOWN_ARG', '{ items(bogus: 1) { id } }'], ['MISSING_ARG', '{ item { id } }'], ['TYPE_MISMATCH', '{ items(first: "x") { id } }'],
  ['UNDEFINED_VARIABLE', '{ items(first: $f) { id } }'], ['UNUSED_VARIABLE', 'query ($f: Int) { version }', { f: 1 }], ['MISSING_VARIABLE', 'query ($f: Int!) { items(first: $f) { id } }'],
  ['UNKNOWN_FRAGMENT', '{ items { ...Nope } }'], ['FRAGMENT_CYCLE', 'fragment A on Item { id ...B } fragment B on Item { name ...A } { items { ...A } }'],
  ['UNUSED_FRAGMENT', 'fragment A on Item { id } { items { id } }'], ['UNKNOWN_DIRECTIVE', '{ items { id @nope } }'], ['UNKNOWN_DIRECTIVE', '{ version @payload(mode: "full") }'],
  ['BAD_SELECTION', '{ items }'], ['BAD_SELECTION', '{ version { x } }'], ['KEY_CONFLICT', '{ items(first: 1) { id } items(first: 2) { id } }'],
  ['UNKNOWN_REDUCER', '{ items(first: 1) @reduce(with: "nope") { id payload } }'], ['PAYLOAD_DENIED', '{ items(first: 1) @payload(mode: "none") { id payload } }'],
  ['LIMIT_FIRST', '{ items(first: 101) { id } }'], ['LIMIT_FIELDS', `{ items(first: 1) { ${longSel} } }`],
];
for (const [code, text, vars] of VCODES) await check('Q2 validate: ' + code + ' for ' + text.replace(/[{}"$]/g, '_').slice(0, 40), async () => {
  const { r, m } = await go(text, {}, { variables: vars });
  return codes(r).includes(code) && r.errors.every(e => e.extensions.stage === 'validate') && m.calls.resolve === 0;
});
await check('Q2 validate: the unknown field message lists the fields of the type with payload then label, and the location', async () => {
  const text = '{ items(first: 2) { id nam } }';
  const { r } = await go(text);
  const e = r.errors?.[0];
  return e?.message === 'unknown field "nam" on Item (fields: id, name, n, status, tags, payload, label)' && same(e.locations, [{ line: 1, column: text.indexOf('nam') + 1 }]) && same(r.header, { v: 1, q: 'q1', ok: false });
});

// ================================================================ Q3 variables, aliases, fragments, skip and include
await check('Q3 variables: a default applies, a supplied variable replaces it', async () => {
  const a = await go('query Q($s: String = "open") { items(status: $s) { id } }');
  const b = await go('query Q($s: String = "open") { items(status: $s) { id } }', {}, { variables: { s: 'closed' } });
  return a.d.items.length === 6 && a.d.items.every(e => Number(e.id.slice(1)) % 2 === 1) && b.d.items.length === 6 && b.d.items.every(e => Number(e.id.slice(1)) % 2 === 0);
});
await check('Q3 variables: a required variable that is not supplied is MISSING_VARIABLE and nothing runs', async () => {
  const { r, m } = await go('query Q($s: String!) { items(status: $s) { id } }');
  return codes(r).includes('MISSING_VARIABLE') && m.calls.resolve === 0 && !('data' in r);
});
await check('Q3 aliases: data is keyed by alias, at the field and the entry level', async () => {
  const { d } = await go('{ top: items(first: 1) { ident: id } }');
  return same(d, { top: [{ ident: 'i1' }] }) && !('items' in d);
});
await check('Q3 fragments: a named fragment expands where it is spread, declared before or after', async () => {
  const a = await go('{ items(first: 1) { ...F } } fragment F on Item { id name }');
  const b = await go('fragment F on Item { id name } { items(first: 1) { ...F } }');
  return J(a.d) === '{"items":[{"id":"i1","name":"name1"}]}' && J(b.d) === J(a.d);
});
await check('Q3 skip and include: @skip and @include drop fields, with literals and variables', async () => {
  const a = await go('query ($v: Boolean!) { items(first: 1) { id name @include(if: $v) n @skip(if: true) status @skip(if: false) } }', {}, { variables: { v: false } });
  const b = await go('query ($v: Boolean!) { items(first: 1) { id name @include(if: $v) } }', {}, { variables: { v: true } });
  const c = await go('fragment F on Item { name } { items(first: 1) { id ...F @skip(if: true) } }');
  return same(a.d, { items: [{ id: 'i1', status: 'open' }] }) && same(b.d, { items: [{ id: 'i1', name: 'name1' }] }) && same(c.d, { items: [{ id: 'i1' }] });
});
await check('Q3 typename: __typename is accepted on a selection set and names the type', async () => {
  const { d, r } = await go('{ items(first: 1) { __typename id } }');
  return d?.items?.[0]?.__typename === 'Item' && r.header.ok === true;
});
await check('Q3 operationName: the name that is run is in the header', async () => {
  const { h } = await go('query Named { version }');
  return h.op === 'Named';
});

// ================================================================ Q4 error shape
await check('Q4 shape: parse, validate, execute and ref errors all have message and extensions code and stage', async () => {
  const p = await go('mutation { x }'), v = await go('{ nope }'), x = await go('{ boom(id: "x") { id } }');
  const { S } = mk(); await S.run('{ items(first: 1) { id } }'); const f = await S.ref('q1/zzz', { op: 'get' });
  const all = [...p.e, ...v.e, ...x.e, ...(f.errors || [])];
  const stages = new Set(all.map(e => e.extensions.stage));
  return all.length === 4 && all.every(e => typeof e.message === 'string' && typeof e.extensions.code === 'string' && (!e.locations || e.locations.every(l => Number.isInteger(l.line) && Number.isInteger(l.column)))) && ['parse', 'validate', 'execute', 'ref'].every(s => stages.has(s));
});
await check('Q4 shape: parse and validate failure give header exactly v q ok false, no data, and the query still takes an id', async () => {
  const { S } = mk();
  const a = await S.run('mutation { x }'), b = await S.run('{ nope }');
  return J(a.header) === '{"v":1,"q":"q1","ok":false}' && J(b.header) === '{"v":1,"q":"q2","ok":false}' && !('data' in a) && !('data' in b);
});
await check('Q4 shape: an execute failure nulls only that field, keeps the rest, header ok false, errors has the path', async () => {
  const { r, d, e } = await go('{ items(first: 1) { id } boom(id: "x") { id } }');
  return same(d, { items: [{ id: 'i1' }], boom: null }) && r.header.ok === false && e.length === 1 && e[0].extensions.stage === 'execute' && same(e[0].path, ['boom']);
});
await check('Q4 shape: errors is omitted when empty and header ok is true', async () => {
  const { r } = await go('{ items(first: 1) { id } }');
  return !('errors' in r) && r.header.ok === true && Object.keys(r)[0] === 'header';
});

// ================================================================ Q5 flatten and dedupe
await check('Q5 flatten: two entry fields over one kind give one kind block with merged paths and the union of labels, entries deduped', async () => {
  const { h } = await go('{ a: items(first: 3) { id } b: items(first: 2) { id name } }');
  const k = h.kinds;
  return k.length === 1 && k[0].kind === 'item' && same(k[0].paths, ['a', 'b']) && same(k[0].labels, ['i1', 'i2', 'i3']) && k[0].n === 3 && h.count === 3;
});
await check('Q5 flatten: count is distinct entries across kinds and blocks are ordered by first appearance', async () => {
  const { h } = await go('{ items(first: 2) { id } notes(first: 2) { n } }');
  return h.count === 4 && h.kinds.map(k => k.kind).join() === 'item,note';
});
await check('Q5 flatten: attributes equal on every field are scalars, differing ones are keyed by path with the common value under star', async () => {
  const { h } = await go('{ a: items(first: 1) @payload(mode: "summary", max: 50) { id } b: items(first: 2) { id } c: items(first: 3) { id } }');
  return same(h.attrs.payload, { a: { mode: 'summary', max: 50 }, '*': { mode: 'summary', max: 200 } }) && h.attrs.labels === 'list' && h.attrs.reducer === 'none' && h.src.payload === 'query';
});
await check('Q5 dedupe: equal reducer rows of two fields merge, hit in and out summed', async () => {
  const { h } = await go('{ a: items(status: "open", first: 1) @reduce(with: "first3", n: 3) { id payload } b: items(status: "closed", first: 1) @reduce(with: "first3", n: 3) { id payload } }');
  return h.reducers?.length === 1 && J(h.reducers[0]) === '{"with":"first3","args":{"n":3},"on":["item.payload"],"by":"query","hit":2,"in":310,"out":6}' && h.attrs.reducer === 'first3';
});
await check('Q5 dedupe: equal refs rows of two fields merge into one row per op', async () => {
  const { h } = await go('{ a: items(first: 3) { id } b: items(first: 2) { id } }');
  return h.refs?.length === 2 && h.refs.filter(x => x.op === 'get').length === 1 && h.refs.filter(x => x.op === 'property').length === 1 && !('labels' in h.refs[0]);
});

// ================================================================ Q6 default attributes and policy override
await check('Q6 defaults: a query with no decorators gets the built-in attributes, empty src, the default policy', async () => {
  const { h } = await go('{ items(first: 1) { id } }');
  return J(h.attrs) === DEFAULT_ATTRS && J(h.src) === '{}' && J(h.policy) === '{"id":"default","rev":1,"ov":[]}';
});
await check('Q6 policy: a policy default changes the attribute and src says policy', async () => {
  const { h } = await go('{ items(first: 3) { id } }', { policy: { id: 'p1', rev: 2, defaults: { labels: 'range' } } });
  return h.attrs.labels === 'range' && h.src.labels === 'policy' && h.policy.id === 'p1' && h.policy.rev === 2 && h.kinds[0].labels === 'i1..i3';
});
await check('Q6 policy: a query decorator beats a policy default and src says query', async () => {
  const { h } = await go('{ items(first: 1) @payload(mode: "full", max: 500) { id } }', { policy: { id: 'p', rev: 1, defaults: { payload: { mode: 'summary', max: 50 } } } });
  return same(h.attrs.payload, { mode: 'full', max: 500 }) && h.src.payload === 'query';
});
await check('Q6 policy: a lock beats the query decorator, is not an error, src says policy and ov names the attribute', async () => {
  const { r, h, d } = await go('{ items(first: 1) @payload(mode: "full") { id payload } }', { policy: { id: 'p', rev: 2, defaults: { payload: { mode: 'summary', max: 50 } }, locks: ['payload'] } });
  return r.header.ok === true && same(h.attrs.payload, { mode: 'summary', max: 50 }) && h.src.payload === 'policy' && h.policy.ov.includes('payload') && d.items[0].payload === clip('B'.repeat(300), 50);
});
await check('Q6 policy: src is mixed when one path took a policy default and another a query decorator', async () => {
  const { h } = await go('{ a: items(first: 1) @payload(mode: "full", max: 500) { id } b: items(first: 2) { id } }', { policy: { id: 'p', rev: 1, defaults: { payload: { mode: 'summary', max: 50 } } } });
  return h.src.payload === 'mixed';
});
await check('Q6 policy: headerAttrs changed drops attributes that equal the built-in default', async () => {
  const a = await go('{ items(first: 1) { id } }', { policy: { id: 'p', rev: 1, headerAttrs: 'changed' } });
  const b = await go('{ items(first: 1) @labels(as: "range") { id } }', { policy: { id: 'p', rev: 1, headerAttrs: 'changed' } });
  return Object.keys(a.h.attrs || {}).length === 0 && same(Object.keys(b.h.attrs), ['labels']) && b.h.attrs.labels === 'range';
});

// ================================================================ Q7 decorators
const DEC = [
  ['@payload(mode: "summary", max: 50)', h => same(h.attrs.payload, { mode: 'summary', max: 50 })],
  ['@payload(mode: "full")', h => h.attrs.payload.mode === 'full'],
  ['@reduce(with: "clip", max: 20)', h => h.attrs.reducer === 'clip'],
  ['@labels(as: "range")', h => h.attrs.labels === 'range'],
  ['@descriptor(mode: "off")', h => h.attrs.descriptor === 'off'],
  ['@scope(queries: 3)', h => same(h.attrs.scope, { queries: 3 })],
  ['@scope(ticks: 2)', h => same(h.attrs.scope, { ticks: 2 })],
  ['@refs(ops: ["property"], names: ["n"])', h => h.refs?.length === 1 && h.refs[0].via === 'query'],
];
for (const [dec, ok] of DEC) await check('Q7 decorators: ' + dec.replace(/[{}"]/g, '_') + ' parses and sets its attribute', async () => {
  const { r, h } = await go(`{ items(first: 3) ${dec} { id } }`);
  return r.header.ok === true && ok(h);
});
await check('Q7 decorators: a decorator on a scalar field, on the operation, or an unknown one is UNKNOWN_DIRECTIVE', async () => {
  const a = await go('{ version @labels(as: "list") }'), b = await go('query @payload(mode: "full") { version }'), c = await go('{ items(first: 1) @nope { id } }'), d = await go('{ items(first: 1) { id @labels(as: "list") } }');
  return [a, b, c, d].every(x => codes(x.r).includes('UNKNOWN_DIRECTIVE') && x.m.calls.resolve === 0);
});
await check('Q7 decorators: skip and include are accepted wherever a field or spread is', async () => {
  const { r } = await go('{ version @include(if: true) items(first: 1) @skip(if: false) { id } }');
  return r.header.ok === true;
});

// ================================================================ Q8 payload modes
await check('Q8 payload: none refuses the payload field with PAYLOAD_DENIED, by decorator and by policy default', async () => {
  const a = await go('{ items(first: 1) @payload(mode: "none") { id payload } }');
  const b = await go('{ items(first: 1) { id payload } }', { policy: { id: 'p', rev: 1, defaults: { payload: { mode: 'none', max: 200 } } } });
  const c = await go('{ items(first: 1) @payload(mode: "none") { id } }');
  return codes(a.r).includes('PAYLOAD_DENIED') && codes(b.r).includes('PAYLOAD_DENIED') && c.r.header.ok === true;
});
await check('Q8 payload: summary clips above max plus 16 with the marker and records the default reducer row', async () => {
  const { d, h } = await go('{ items(first: 4) { id payload } }');
  const p = d.items.map(e => e.payload);
  return p[0] === 'B'.repeat(200) + '...[+100]' && p[1] === 'short body' && p[2] === 'C'.repeat(216) && p[3] === 'D'.repeat(200) + '...[+17]'
    && h.reducers?.length === 1 && J(h.reducers[0]) === '{"with":"clip","args":{"max":200},"on":["item.payload"],"by":"default","hit":2,"in":517,"out":417}';
});
await check('Q8 payload: summary honours max from the decorator', async () => {
  const { d, h } = await go('{ items(first: 2) @payload(mode: "summary", max: 50) { id payload } }');
  return d.items[0].payload === 'B'.repeat(50) + '...[+250]' && d.items[1].payload === 'short body' && h.reducers[0].args.max === 50;
});
await check('Q8 payload: full returns the payload whole and records no reducer', async () => {
  const { d, h } = await go('{ items(first: 1) @payload(mode: "full") { id payload } }');
  return d.items[0].payload === 'B'.repeat(300) && !('reducers' in h);
});
await check('Q8 payload: below the threshold nothing is recorded', async () => {
  const { d, h } = await go('{ item(id: "i2") { id payload } }');
  return d.item.payload === 'short body' && !('reducers' in h);
});

// ================================================================ Q9 reducer hook
await check('Q9 reducer: a registered reducer named in @reduce runs before the payload enters data, the row has exact counts', async () => {
  const { d, h } = await go('{ items(first: 2) @reduce(with: "first3", n: 4) { id payload } }');
  return d.items[0].payload === 'BBBB' && d.items[1].payload === 'shor' && h.reducers?.length === 1 && J(h.reducers[0]) === '{"with":"first3","args":{"n":4},"on":["item.payload"],"by":"query","hit":2,"in":310,"out":8}';
});
await check('Q9 reducer: a policy row picks the reducer for a matching payload only, by policy', async () => {
  const policy = { id: 'p', rev: 1, reducers: [{ when: { kind: 'item', minChars: 100 }, with: 'first3', args: { n: 3 } }] };
  const { d, h } = await go('{ items(first: 2) { id payload } }', { policy });
  return d.items[0].payload === 'BBB' && d.items[1].payload === 'short body' && h.reducers?.length === 1 && J(h.reducers[0]) === '{"with":"first3","args":{"n":3},"on":["item.payload"],"by":"policy","hit":1,"in":300,"out":3}';
});
await check('Q9 reducer: @reduce wins over a policy row, a policy lock wins over @reduce', async () => {
  const rows = [{ when: { kind: 'item', minChars: 100 }, with: 'first3', args: { n: 3 } }];
  const a = await go('{ items(first: 1) @reduce(with: "first3", n: 5) { id payload } }', { policy: { id: 'p', rev: 1, reducers: rows } });
  const b = await go('{ items(first: 1) @reduce(with: "clip", max: 20) { id payload } }', { policy: { id: 'p', rev: 1, defaults: { reducer: 'first3' }, locks: ['reducer'] } });
  return a.d.items[0].payload === 'BBBBB' && a.h.reducers[0].by === 'query' && b.d.items[0].payload === 'BBB' && b.h.reducers[0].by === 'policy';
});
await check('Q9 reducer: an unknown name is UNKNOWN_REDUCER at validate', async () => {
  const { r, m } = await go('{ items(first: 1) @reduce(with: "nope") { id payload } }');
  return codes(r).includes('UNKNOWN_REDUCER') && m.calls.resolve === 0;
});
await check('Q9 reducer: a throwing reducer withholds the payload, raises REDUCER_FAILED naming it, and the raw value never enters data', async () => {
  const { r, d, e } = await go('{ items(first: 1) @reduce(with: "explode") { id payload } }', { reducers: { explode: () => { throw new Error('kaboom'); } } });
  return d.items[0].payload === null && e.length === 1 && e[0].extensions.code === 'REDUCER_FAILED' && e[0].extensions.stage === 'execute' && e[0].message.includes('explode') && r.header.ok === false && !J(r).includes('BBBBBBBBBBBB');
});
await check('Q9 reducer: a reducer may return a value with a note, the value is what enters data', async () => {
  const { d } = await go('{ items(first: 1) @reduce(with: "noted") { id payload } }', { reducers: { noted: () => ({ value: 'V', note: 'n' }) } });
  return d.items[0].payload === 'V';
});
await check('Q9 reducer: built-ins none, clip, lines and omit', async () => {
  const q = w => `{ item(id: "i5") @reduce(with: ${w}) { payload } }`;
  const a = await go(q('"none"')), b = await go('{ item(id: "i1") @reduce(with: "clip", max: 20) { payload } }'), c = await go(q('"lines", head: 1, tail: 1')), e = await go(q('"omit"'));
  const l = c.d.item.payload;
  return a.d.item.payload === 'l1\nl2\nl3\nl4\nl5' && b.d.item.payload === 'B'.repeat(20) + '...[+280]' && l.startsWith('l1') && l.endsWith('l5') && l.includes('...[+3 lines]') && !l.includes('l3') && e.d.item.payload === '';
});

// ================================================================ Q10 policy shapes the result
await check('Q10 policy: verbose false downgrades full to summary, with dropped entries', async () => {
  const { d, h } = await go('{ items(first: 1) @payload(mode: "full") { id payload } }', { policy: { id: 'p', rev: 1, verbose: false } });
  return d.items[0].payload === 'B'.repeat(200) + '...[+100]' && h.attrs.payload.mode === 'summary' && Array.isArray(h.dropped) && h.dropped.length > 0 && h.dropped.every(x => typeof x.what === 'string' && typeof x.why === 'string');
});
await check('Q10 policy: verbose false caps a get at the summary max', async () => {
  const { S } = mk({ policy: { id: 'p', rev: 1, verbose: false } });
  await S.run('{ items(first: 1) { id } }');
  const g = await S.ref('q1/i1', { op: 'get' });
  return g.header.ok === true && g.data === 'B'.repeat(200) + '...[+100]';
});
await check('Q10 policy: deny set removes the set ref with the exact dropped row, and a later set is refused', async () => {
  const { S, m, r } = await (async () => { const x = mk({ policy: { id: 'p', rev: 1, deny: ['set'] } }); return { ...x, r: await x.S.run('{ items(first: 1) { id status } }') }; })();
  const g = await S.ref('q1/i1', { op: 'set', name: 'status', value: 'closed' });
  return !r.header.refs.some(x => x.op === 'set') && J(r.header.dropped) === '[{"what":"refs.set","why":"policy:deny set"}]' && g.header.ok === false && m.calls.set === 0;
});
await check('Q10 policy: one query under two policies differs only where the policy touches', async () => {
  const text = '{ items(first: 2) { id status payload } }';
  const a = await go(text), b = await go(text, { policy: { id: 'p2', rev: 1, deny: ['set'], reducers: [{ when: { kind: 'item', minChars: 100 }, with: 'first3', args: { n: 3 } }] } });
  const strip = h => { const { attrs, src, reducers, dropped, refs, policy, ...rest } = h; return rest; };
  const dataA = canon(a.d), dataB = canon(b.d);
  dataA.items.forEach(e => delete e.payload); dataB.items.forEach(e => delete e.payload);
  return same(strip(a.h), strip(b.h)) && same(dataA, dataB) && a.d.items[0].payload !== b.d.items[0].payload && J(a.h.policy) !== J(b.h.policy) && J(a.h.reducers) !== J(b.h.reducers) && !('dropped' in a.h) && b.h.dropped?.length > 0;
});

// ================================================================ Q11 kind registration and caps
const REG = [
  ['label', d => { delete d.label; }], ['key', d => { delete d.key; }], ['props', d => { delete d.props; }], ['fn', d => { delete d.fn; }],
  ['settable without set', d => { d.settable = ['name']; }], ['settable name not in props', d => { d.settable = ['zzz']; d.set = () => ({}); }],
];
for (const [what, brk] of REG) await check('Q11 kinds: a kind definition with a missing member is refused at registration: ' + what, async () => {
  const def = kindDef(); brk(def);
  const create = api('createSurface');
  let threw = false; try { create({ adapters: [adapterWith({ item: def })] }); } catch { threw = true; }
  return threw;
});
await check('Q11 kinds: a valid minimal kind registers', async () => !!api('createSurface')({ adapters: [adapterWith({ item: kindDef() })] }));
await check('Q11 kinds: caps in the header equal the definition', async () => {
  const { h } = await go('{ items(first: 1) { id } notes(first: 1) { n } }');
  return J(h.kinds[0].caps) === '{"get":true,"props":["id","name","n","status","tags"],"set":["status"]}' && J(h.kinds[1].caps) === '{"get":false,"props":["n","title"],"set":[]}';
});
await check('Q11 kinds: a kind that is not gettable never declares get, by inference or by @refs', async () => {
  const a = await go('{ notes(first: 2) { n } }'), b = await go('{ notes(first: 2) @refs(ops: ["get", "property"]) { n } }');
  return !a.h.refs.some(x => x.op === 'get') && !b.h.refs.some(x => x.op === 'get');
});

// ================================================================ Q12 labels
await check('Q12 labels: id labels and index labels', async () => {
  const { h } = await go('{ items(first: 2) { id } notes(first: 2) { n } }');
  return same(h.kinds[0].labels, ['i1', 'i2']) && same(h.kinds[1].labels, ['n1', 'n2']);
});
await check('Q12 labels: the label pseudo field returns the entry label', async () => {
  const { d } = await go('{ items(first: 2) { label } }');
  return same(d, { items: [{ label: 'i1' }, { label: 'i2' }] });
});
await check('Q12 labels: two kinds giving one label are prefixed with the kind, both blocks carry prefixed true, others stay plain', async () => {
  const { h } = await go('{ items(first: 2) { id } clashes { id } }');
  return same(h.kinds[0].labels, ['item:i1', 'i2']) && same(h.kinds[1].labels, ['clash:i1', 'z9']) && h.kinds[0].prefixed === true && h.kinds[1].prefixed === true;
});
await check('Q12 labels: a prefixed label is the one a ref names', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } clashes { id } }');
  const g = await S.ref('q1/item:i1', { op: 'get' });
  return g.header.ok === true && g.data === 'B'.repeat(300);
});
await check('Q12 labels: range gives first..last for consecutive labels with n of 3 or more, an array otherwise', async () => {
  const a = await go('{ items(first: 4) @labels(as: "range") { id } }'), b = await go('{ items(first: 2) @labels(as: "range") { id } }');
  const c = await go('{ items(status: "open", first: 4) @labels(as: "range") { id } }'), d = await go('{ notes(first: 3) @labels(as: "range") { n } }');
  return a.h.kinds[0].labels === 'i1..i4' && same(b.h.kinds[0].labels, ['i1', 'i2']) && same(c.h.kinds[0].labels, ['i1', 'i3', 'i5', 'i7']) && d.h.kinds[0].labels === 'n1..n3';
});
await check('Q12 labels: inline puts n and inline true in the header and the label in each data entry as underscore', async () => {
  const { h, d } = await go('{ items(first: 2) @labels(as: "inline") { id } }');
  return same(h.kinds[0].labels, { n: 2, inline: true }) && same(d.items.map(e => e._), ['i1', 'i2']);
});
await check('Q12 labels: none puts only n in the header, the label field still answers', async () => {
  const { h, d } = await go('{ items(first: 2) @labels(as: "none") { id label } }');
  return same(h.kinds[0].labels, { n: 2 }) && same(d.items.map(e => e.label), ['i1', 'i2']);
});
await check('Q12 labels: above labelsMax the list becomes first last n and entries carry the label automatically', async () => {
  const { h, d } = await go('{ items(first: 8) { id } }', { policy: { id: 'p', rev: 1, limits: { labelsMax: 5 } } });
  return same(h.kinds[0].labels, { first: 'i1', last: 'i8', n: 8 }) && h.kinds[0].n === 8 && d.items.every((e, k) => e._ === 'i' + (k + 1));
});

// ================================================================ Q13 materialized kinds
const RTEXT = 'RENDER-SYNTAX: lines of text';
const hasText = h => J(h).includes(RTEXT);
await check('Q13 materialized: first sends the descriptor once, then seen; the block says materialized true', async () => {
  const { S } = mk();
  const a = (await S.run('{ renders { id } }')).header, b = (await S.run('{ renders { id } }')).header;
  return hasText(a) && !hasText(b) && a.kinds[0].materialized === true && b.kinds[0].materialized === true && b.kinds[0].desc === 'seen';
});
await check('Q13 materialized: a new surface instance sends the descriptor again', async () => {
  const a = await go('{ renders { id } }'), b = await go('{ renders { id } }');
  return hasText(a.h) && hasText(b.h);
});
await check('Q13 materialized: always sends it every time, off never and the block says off', async () => {
  const { S } = mk();
  const a = (await S.run('{ renders @descriptor(mode: "always") { id } }')).header, b = (await S.run('{ renders @descriptor(mode: "always") { id } }')).header, c = (await S.run('{ renders @descriptor(mode: "off") { id } }')).header;
  return hasText(a) && hasText(b) && !hasText(c) && c.kinds[0].desc === 'off';
});
await check('Q13 materialized: a prefaced kind is never sent and says prefaced, by surface option and by policy', async () => {
  const a = await go('{ renders { id } }', { prefaced: ['render'] }), b = await go('{ renders { id } }', { policy: { id: 'p', rev: 1, prefaced: ['render'] } });
  return !hasText(a.h) && a.h.kinds[0].desc === 'prefaced' && !hasText(b.h) && b.h.kinds[0].desc === 'prefaced';
});
await check('Q13 materialized: a kind without the member has none of it', async () => {
  const { h } = await go('{ items(first: 1) { id } }');
  return !('materialized' in h.kinds[0]) && !('desc' in h.kinds[0]);
});

// ================================================================ Q14 staged intent
await check('Q14 intent: I1 and I3 with no payload selected', async () => {
  const { h } = await go('{ items(first: 2) { id } }');
  return J(h.refs) === '[{"kind":"item","op":"get","via":"I1","max":12000},{"kind":"item","op":"property","names":["name","n","status","tags"],"via":"I3"}]';
});
await check('Q14 intent: I2 declares get only for the labels the reducer changed', async () => {
  const { h } = await go('{ items(first: 2) { id payload } }');
  return J(h.refs) === '[{"kind":"item","op":"get","labels":["i1"],"via":"I2","max":12000},{"kind":"item","op":"property","names":["name","n","status","tags"],"via":"I3"}]';
});
await check('Q14 intent: I4 declares set for the selected settable props, and I3 is absent when every prop is selected', async () => {
  const { h } = await go('{ items(first: 1) { id name n status tags } }');
  return J(h.refs) === '[{"kind":"item","op":"get","via":"I1","max":12000},{"kind":"item","op":"set","names":["status"],"via":"I4"}]';
});
await check('Q14 intent: nothing changed by a reducer and payload selected gives no get row', async () => {
  const { h } = await go('{ item(id: "i2") { id name n status tags payload } }');
  return !h.refs?.some(x => x.op === 'get');
});
await check('Q14 intent: @refs replaces inference, limited to caps, with via query', async () => {
  const a = await go('{ items(first: 2) @refs(ops: ["property"], names: ["n"]) { id } }');
  const b = await go('{ notes(first: 2) @refs(ops: ["get", "set"]) { n } }');
  return J(a.h.refs) === '[{"kind":"item","op":"property","names":["n"],"via":"query"}]' && !('refs' in b.h);
});
await check('Q14 intent: an empty @refs ops list declares nothing and the refs key is omitted', async () => {
  const { h } = await go('{ items(first: 2) @refs(ops: []) { id } }');
  return !('refs' in h);
});

// ================================================================ Q15 ref ops
await check('Q15 ref get: returns the payload through fn, header has the 4.1 shape and no reducer when none changed it', async () => {
  const { S, m } = mk(); await S.run('{ items(first: 2) { id } }');
  const g = await S.ref('q1/i1', { op: 'get' });
  return J(g.header) === '{"v":1,"q":"q1","label":"i1","op":"get","ok":true}' && g.data === 'B'.repeat(300) && m.calls.fn >= 1 && Object.keys(g)[0] === 'header';
});
await check('Q15 ref get: the effective reducer is applied and its row is in the ref header', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) @reduce(with: "first3", n: 3) { id } }');
  const g = await S.ref('q1/i1', { op: 'get' });
  return g.data === 'BBB' && g.header.reducer?.with === 'first3' && g.header.reducer.hit === 1 && g.header.reducer.in === 300 && g.header.reducer.out === 3;
});
await check('Q15 ref get: the declared max caps the text and ends with the clip marker', async () => {
  const { S } = mk({ policy: { id: 'p', rev: 1, limits: { getMax: 20 } } });
  const r = await S.run('{ items(first: 1) { id } }');
  const g = await S.ref('q1/i1', { op: 'get' });
  return r.header.refs[0].max === 20 && g.data === 'B'.repeat(20) + '...[+280]';
});
await check('Q15 ref property: returns that one value through fn', async () => {
  const { S, m } = mk(); await S.run('{ items(first: 2) { id } }');
  const g = await S.ref('q1/i2', { op: 'property', name: 'n' });
  const t = await S.ref('q1/i2', { op: 'property', name: 'tags' });
  return g.header.ok === true && g.header.op === 'property' && oneValue(g.data, 'n', 2) && oneValue(t.data, 'tags', ['t2']) && m.calls.fn >= 2;
});
await check('Q15 ref set: calls the adapter set with entry, name and value and returns what it returned', async () => {
  const { S, m } = mk(); await S.run('{ items(first: 1) { id status } }');
  const g = await S.ref('q1/i1', { op: 'set', name: 'status', value: 'closed' });
  return g.header.ok === true && g.header.op === 'set' && same(m.calls.sets, [['i1', 'status', 'closed']]) && J(g.data).includes('closed');
});

// ================================================================ Q16 ref refusals
const refused = async (setup, ref, o, code, message, stage = 'ref') => {
  const { S, m } = mk(setup.mk || {});
  await S.run(setup.q);
  setup.after && await setup.after(S);
  const before = { fn: m.calls.fn, set: m.calls.set };
  const g = await S.ref(ref, o);
  const e = g.errors?.[0];
  return g.header.ok === false && e?.extensions?.code === code && (message === null || e.message === message) && e.extensions.stage === stage && m.calls.fn === before.fn && m.calls.set === before.set;
};
const Q1S = { q: '{ items(first: 1) { id } }' };
await check('Q16 refusal: REF_FORMAT', () => refused(Q1S, 'nonsense', { op: 'get' }, 'REF_FORMAT', 'ref must be <query>/<label>, for example q1/t0'));
await check('Q16 refusal: REF_UNKNOWN_QUERY', () => refused(Q1S, 'q9/i1', { op: 'get' }, 'REF_UNKNOWN_QUERY', 'unknown query q9'));
await check('Q16 refusal: REF_UNKNOWN_LABEL', () => refused(Q1S, 'q1/i999', { op: 'get' }, 'REF_UNKNOWN_LABEL', 'q1 has no label i999'));
await check('Q16 refusal: REF_NOT_DECLARED lists what is declared in op order with names', () => refused({ q: '{ items(first: 1) { id name n } }' }, 'q1/i1', { op: 'set', name: 'status', value: 'x' }, 'REF_NOT_DECLARED', 'q1/i1: op "set" is not declared by this query (declared: get, property[status,tags])'));
await check('Q16 refusal: REF_NOT_DECLARED with declared none, though the kind supports the op', () => refused({ q: '{ items(first: 1) @refs(ops: []) { id } }' }, 'q1/i1', { op: 'get' }, 'REF_NOT_DECLARED', 'q1/i1: op "get" is not declared by this query (declared: none)'));
await check('Q16 refusal: set on a kind with no settable props is REF_NOT_DECLARED', () => refused({ q: '{ notes(first: 1) { n } }' }, 'q1/n1', { op: 'set', name: 'title', value: 'x' }, 'REF_NOT_DECLARED', null));
await check('Q16 refusal: REF_BAD_NAME', () => refused({ q: '{ items(first: 1) { id name n } }' }, 'q1/i1', { op: 'property', name: 'foo' }, 'REF_BAD_NAME', 'q1/i1: property "foo" is not declared (declared: status, tags)'));
await check('Q16 refusal: REF_BAD_VALUE when set has no value', () => refused({ q: '{ items(first: 1) { id status } }' }, 'q1/i1', { op: 'set', name: 'status' }, 'REF_BAD_VALUE', 'q1/i1: set status needs a value'));
await check('Q16 refusal: REF_POLICY when the policy now forbids the op (policy object read at ref time)', async () => {
  const policy = { id: 'p', rev: 1 };
  return refused({ mk: { policy }, q: '{ items(first: 1) { id status } }', after: () => { policy.deny = ['set']; } }, 'q1/i1', { op: 'set', name: 'status', value: 'x' }, 'REF_POLICY', 'q1/i1: op "set" is refused by policy');
});
await check('Q16 refusal: REF_EXPIRED has the exact message and no adapter call', async () => {
  const { S, m } = mk(); await S.run('{ items(first: 1) { id } }');
  for (let k = 0; k < 10; k++) await S.run('{ version }');
  const fn = m.calls.fn, g = await S.ref('q1/i1', { op: 'get' });
  return g.errors?.[0]?.extensions?.code === 'REF_EXPIRED' && g.errors[0].message === 'query q1 expired (scope: 8 queries); run the query again' && m.calls.fn === fn;
});
await check('Q16 refusal: REF_SOURCE carries the adapter message and the label', async () => {
  const { S } = mk({ mock: { failGet: 'i1' } }); await S.run('{ items(first: 1) { id } }');
  const g = await S.ref('q1/i1', { op: 'get' }), e = g.errors?.[0];
  return g.header.ok === false && e?.extensions?.code === 'REF_SOURCE' && e.message.includes('disk gone') && e.message.includes('i1');
});

// ================================================================ Q17 scope and expiry
await check('Q17 scope: with the default of 8 queries a ref still works after a few later queries', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } }');
  for (let k = 0; k < 3; k++) await S.run('{ version }');
  return (await S.ref('q1/i1', { op: 'get' })).header.ok === true;
});
await check('Q17 scope: queries N expires after enough later queries, with the scope in the message', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) @scope(queries: 3) { id } }');
  await S.run('{ version }');
  const early = await S.ref('q1/i1', { op: 'get' });
  for (let k = 0; k < 5; k++) await S.run('{ version }');
  const late = await S.ref('q1/i1', { op: 'get' });
  return early.header.ok === true && late.errors?.[0]?.extensions?.code === 'REF_EXPIRED' && late.errors[0].message.startsWith('query q1 expired') && late.errors[0].message.includes('3 queries');
});
await check('Q17 scope: ticks N expires after enough tick calls', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) @scope(ticks: 3) { id } }');
  S.tick();
  const early = await S.ref('q1/i1', { op: 'get' });
  for (let k = 0; k < 6; k++) S.tick();
  const late = await S.ref('q1/i1', { op: 'get' });
  return early.header.ok === true && late.errors?.[0]?.extensions?.code === 'REF_EXPIRED';
});
await check('Q17 scope: surface scope never expires', async () => {
  const { S } = mk({ policy: { id: 'p', rev: 1, defaults: { scope: 'surface' } } });
  const r = await S.run('{ items(first: 1) { id } }');
  for (let k = 0; k < 30; k++) { await S.run('{ version }'); S.tick(); }
  return r.header.attrs.scope === 'surface' && (await S.ref('q1/i1', { op: 'get' })).header.ok === true;
});
await check('Q17 scope: another surface instance has no memory of the query', async () => {
  const a = mk(), b = mk(); await a.S.run('{ items(first: 1) { id } }');
  const g = await b.S.ref('q1/i1', { op: 'get' });
  return g.errors?.[0]?.extensions?.code === 'REF_UNKNOWN_QUERY' && g.errors[0].message === 'unknown query q1';
});
await check('Q17 scope: a ref acts only on its own query labels, and a re-run is a new query with a new id', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } }');
  const r2 = await S.run('{ items(first: 1, after: "1") { id } }');
  const g = await S.ref('q2/i1', { op: 'get' }), ok = await S.ref('q2/i2', { op: 'get' });
  return r2.header.q === 'q2' && g.errors?.[0]?.message === 'q2 has no label i1' && ok.header.ok === true;
});

// ================================================================ Q18 audit
await check('Q18 audit: one row per run and per ref, refusals included, in order, with t q ok and a hash', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } }');
  await S.ref('q1/i1', { op: 'get' }); await S.ref('q1/i1', { op: 'set', name: 'status', value: 'x' }); await S.ref('nonsense', { op: 'get' });
  const a = S.audit();
  return a.length === 4 && a.every(x => typeof x.t === 'number' && typeof x.ok === 'boolean' && typeof x.h === 'string' && x.h.length > 0) && a[0].q === 'q1' && a[0].ok === true
    && a[1].label === 'i1' && a[1].op === 'get' && a[1].ok === true && a[2].ok === false && typeof a[2].code === 'string' && a[3].ok === false && a[3].code === 'REF_FORMAT';
});
await check('Q18 audit: no text of what was returned is in the audit', async () => {
  const { S } = mk(); await S.run('{ items(first: 2) { id name payload } }'); await S.ref('q1/i1', { op: 'get' });
  const s = J(S.audit());
  return !s.includes('BBBBBBBB') && !s.includes('name1') && !s.includes('short body');
});
await check('Q18 audit: why is recorded as given, cut to 200 characters', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } }');
  await S.ref('q1/i1', { op: 'get', why: 'w'.repeat(500) }); await S.ref('q1/i1', { op: 'get', why: 'looking' });
  const a = S.audit();
  return a[1].why === 'w'.repeat(200) && a[2].why === 'looking';
});
await check('Q18 audit: requireWhy makes a ref without why REF_BAD_VALUE, with why it passes, both audited', async () => {
  const { S } = mk({ policy: { id: 'p', rev: 1, requireWhy: ['get'] } }); await S.run('{ items(first: 1) { id } }');
  const a = await S.ref('q1/i1', { op: 'get' }), b = await S.ref('q1/i1', { op: 'get', why: 'needed' });
  const au = S.audit();
  return a.errors?.[0]?.extensions?.code === 'REF_BAD_VALUE' && b.header.ok === true && au.length === 3 && au[1].ok === false && au[2].ok === true;
});
await check('Q18 audit: by default no op needs why (restrictions are off)', async () => {
  const { S } = mk(); await S.run('{ items(first: 1) { id } }');
  return (await S.ref('q1/i1', { op: 'get' })).header.ok === true;
});
await check('Q18 audit: the audit is not part of any result', async () => {
  const { S } = mk(); const r = await S.run('{ items(first: 1) { id } }');
  return !('audit' in r) && !('audit' in r.header);
});

// ================================================================ Q19 adapter seam and standalone
await check('Q19 adapters: two adapters merge into one schema and one query reaches both', async () => {
  const { r, d, h } = await go('{ items(first: 1) { id } books(first: 2) { isbn title } }', { extra: [mkLibrary()] });
  return r.header.ok === true && same(d, { items: [{ id: 'i1' }], books: [{ isbn: 'b001', title: 'One' }, { isbn: 'b002', title: 'Two' }] }) && h.kinds.map(k => k.kind).join() === 'item,book';
});
await check('Q19 adapters: a second adapter alone is a whole surface (the module does not know the first)', async () => {
  const S = api('createSurface')({ adapters: [mkLibrary()], now: clock() });
  const r = await S.run('{ books(first: 2) { isbn } }');
  const g = await S.ref('q1/b001', { op: 'get' });
  return same(r.data, { books: [{ isbn: 'b001' }, { isbn: 'b002' }] }) && r.header.kinds[0].caps.get === false && g.errors?.[0]?.extensions?.code === 'REF_NOT_DECLARED';
});
await check('Q19 adapters: a duplicate root name is a registration error DUPLICATE_ROOT', async () => {
  const dup = mkLibrary(); dup.schema.roots.items = dup.schema.roots.books;
  const create = api('createSurface');
  try { create({ adapters: [mkMock().adapter, dup] }); return false; } catch (e) { return /DUPLICATE_ROOT/.test(String(e.code) + e.message); }
});
await check('Q19 adapters: a duplicate kind name is a registration error DUPLICATE_KIND', async () => {
  const dup = mkLibrary(); dup.kinds.item = dup.kinds.book; delete dup.kinds.book; dup.schema.types.Book.kind = 'item';
  const create = api('createSurface');
  try { create({ adapters: [mkMock().adapter, dup] }); return false; } catch (e) { return /DUPLICATE_KIND/.test(String(e.code) + e.message); }
});
await check('Q19 adapters: the synopsis is plain deterministic text naming roots and types of every adapter, and __synopsis returns it', async () => {
  const { S } = mk({ extra: [mkLibrary()] });
  const s1 = S.synopsis(), s2 = S.synopsis(), r = await S.run('{ __synopsis }');
  return typeof s1 === 'string' && s1 === s2 && ['items', 'Item', 'books', 'Book'].every(w => s1.includes(w)) && r.data?.__synopsis === s1;
});
await check('Q19 standalone: the module graph imports nothing outside app/query files and touches no DOM, storage or network global', async () => {
  const dir = path.join(ROOT, 'app');
  const files = fs.readdirSync(dir).filter(f => /^query[\w-]*\.js$/.test(f));
  if (!files.includes('query.js')) return 'app/query.js missing';
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  for (const f of files) {
    const src = strip(fs.readFileSync(path.join(dir, f), 'utf8'));
    const specs = [...src.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1] || m[2] || m[3]);
    if (specs.some(s => !/^\.\/query[\w-]*\.js$/.test(s))) return f + ' imports ' + specs.join();
    if (/\b(window|document|indexedDB|localStorage|sessionStorage|navigator)\b|\bfetch\s*\(/.test(src)) return f + ' uses a browser global';
  }
  return typeof window === 'undefined' && typeof document === 'undefined' && typeof indexedDB === 'undefined' && typeof localStorage === 'undefined' && !Q.missing;
});

// ================================================================ Q20 determinism
await check('Q20 determinism: the same text, policy and state give byte-identical results on two fresh surfaces', async () => {
  const text = '{ a: items(first: 3) { id status payload } notes(first: 2) { n } }', policy = { id: 'p', rev: 1, deny: ['set'] };
  const a = await go(text, { policy }), b = await go(text, { policy });
  return J(a.r) === J(b.r) && J(a.r).length > 100;
});
await check('Q20 determinism: a re-run on one surface gets a new q and otherwise the same bytes', async () => {
  const { S } = mk(); const a = await S.run('{ items(first: 3) { id payload } }'), b = await S.run('{ items(first: 3) { id payload } }');
  return b.header.q === 'q2' && J(b).replace('"q":"q2"', '"q":"q1"') === J(a);
});
await check('Q20 determinism: the header keys are in the fixed order, and header is the first key of the result', async () => {
  const { r, h } = await go('{ a: items(first: 4) { id status payload } }', { policy: { id: 'p', rev: 1, deny: ['set'] } });
  return Object.keys(r)[0] === 'header' && ['v', 'q', 'op', 'ok', 'count', 'pages', 'attrs', 'src', 'kinds', 'reducers', 'refs', 'dropped', 'policy'].every(k => k in h) && inOrder(Object.keys(h));
});
await check('Q20 determinism: the default attributes serialize in the fixed order', async () => {
  const { h } = await go('{ items(first: 1) { id } }');
  return J(h.attrs) === DEFAULT_ATTRS;
});
await check('Q20 determinism: empty pages, reducers, refs and dropped are omitted, never empty arrays', async () => {
  const { h } = await go('{ version }');
  return !['pages', 'reducers', 'refs', 'dropped'].some(k => k in h);
});

// ================================================================ Q21 pagination
await check('Q21 pages: a page row carries path first total next, and count matches the entries', async () => {
  const { h, d } = await go('{ items(first: 5) { id } }');
  return J(h.pages) === '[{"path":"items","first":5,"total":12,"next":"5"}]' && h.count === 5 && d.items.length === 5;
});
await check('Q21 pages: after round-trips the adapter cursor and the last page has next null', async () => {
  const { S, m } = mk();
  const a = await S.run('{ items(first: 5, after: "5") { id } }'), b = await S.run('{ items(first: 5, after: "10") { id } }');
  return same(a.data.items.map(e => e.id), ['i6', 'i7', 'i8', 'i9', 'i10']) && a.header.pages[0].next === '10' && same(b.data.items.map(e => e.id), ['i11', 'i12']) && b.header.pages[0].next === null && b.header.count === 2 && m.calls.args.at(-1).args.after === '10';
});
await check('Q21 pages: the default first is 20 and a policy defaultFirst changes it', async () => {
  const a = await go('{ items { id } }'), b = await go('{ items { id } }', { policy: { id: 'p', rev: 1, limits: { defaultFirst: 3 } } });
  return a.h.pages[0].first === 20 && a.d.items.length === 12 && a.h.pages[0].next === null && b.h.pages[0].first === 3 && b.d.items.length === 3 && b.h.pages[0].next === '3';
});
await check('Q21 pages: first above maxFirst is LIMIT_FIRST, at maxFirst it passes, maxFirst is a policy limit', async () => {
  const a = await go('{ items(first: 100) { id } }'), b = await go('{ items(first: 101) { id } }');
  const c = await go('{ items(first: 6) { id } }', { policy: { id: 'p', rev: 1, limits: { maxFirst: 5 } } }), d = await go('{ items(first: 5) { id } }', { policy: { id: 'p', rev: 1, limits: { maxFirst: 5 } } });
  return a.r.header.ok === true && codes(b.r).includes('LIMIT_FIRST') && codes(c.r).includes('LIMIT_FIRST') && d.r.header.ok === true;
});
await check('Q21 pages: a filtered root reports its own total, and a single entry field has no pages row', async () => {
  const a = await go('{ items(status: "open", first: 2) { id } }'), b = await go('{ item(id: "i1") { id } }');
  return a.h.pages[0].total === 6 && !('pages' in b.h) && b.h.count === 1;
});
await check('Q21 pages: the effective first reaches the adapter', async () => {
  const { m } = await go('{ items { id } }', { policy: { id: 'p', rev: 1, limits: { defaultFirst: 4 } } });
  return m.calls.args[0].args.first === 4;
});

// ================================================================ Q22 harness adapter over fixtures
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/metrics-sessions.json'), 'utf8'));
const CLAIM = 'A model given procedures and background swaps or alters turns in a flow.';
const CATALOG = {
  concepts: [
    { id: 'ndgwdh', name: 'opaque handles re-pointed under a fixed context', claim: 'The model sees fixed id bytes while the store re-points what they resolve to.', status: 'implemented', models: [{ model: 'all', result: 'implemented', evidence: 'app/handles.js' }], since: '2026-11-19' },
    { id: 'oldone', name: 'an idea restated', claim: 'First wording.', status: 'hypothesis', models: [], since: '2026-11-18' },
    { id: 'tampqj', name: 'flow alteration by a second model', claim: CLAIM, status: 'hypothesis', models: [], since: '2026-11-19' },
    { id: 'qblgkn', name: 'warp', claim: 'A flow is warped.', status: 'hypothesis', models: [], since: '2026-11-20' },
    { id: 'newone', name: 'an idea restated', claim: 'Second wording.', status: 'implemented', models: [{ model: 'm1', result: 'ok', evidence: 'x' }, { model: 'm2', result: 'ok', evidence: 'y' }], since: '2026-11-21', supersedes: 'oldone' },
    { id: 'lastee', name: 'a third idea', claim: 'Third wording.', status: 'hypothesis', models: [], since: '2026-11-21' },
  ],
  faults: [
    { id: 'faulta', model: 'm1', fault: 'wrong path', class: 'common', seen: '2026-11-19', handled: 'x', evidence: 'e' },
    { id: 'faultb', model: 'm2', fault: 'wrong arg', class: 'uncommon', seen: '2026-11-20', handled: 'y', evidence: 'e' },
  ],
  terms: [
    { id: 'terma1', term: 'warp', means: 'a flow bend', see: 'docs/x.md', aka: [], since: '2026-11-19' },
    { id: 'termb2', term: 'stem', means: 'a branch', see: 'docs/y.md', aka: [], since: '2026-11-19' },
  ],
};
const TRAIL = [{ t: 1, tool: 'shell', via: 'model', ok: true, chars: 10, ms: 5 }, { t: 2, tool: 'repo_read', via: 'model', ok: true, chars: 20, ms: 6 }, { t: 3, tool: 'shell', via: 'model', ok: false, chars: 30, why: 'check', ms: 7 }];
const mkHandles = () => {
  const log = [{ t: 1700000000100, id: 'km7q2x', reader: 'sfixA', h: 'iok4xwb14t' }, { t: 1700000000200, id: 'km7q2x', reader: 'sfixA', h: '1i0va4l66g' }];
  const seen = { resolve: [] };
  return { seen, log, info: async id => id === 'km7q2x' ? { id, kind: 'stem', owner: 'sfixA', t: 1700000000150, readers: ['*', 'sfixA'] } : null, resolve: async (id, reader) => { seen.resolve.push([id, reader]); log.push({ t: 1700000000300, id, reader, h: 'ab12cd34ef' }); return 'stem 3 of 5 folded'; }, audit: () => log.slice() };
};
const hs = (handles = mkHandles()) => ({ handles, adapter: harness('createHarnessAdapter')({ sessions: () => FX.sessions, ckpt: () => FX.ckpt, trail: () => TRAIL, handles, catalog: () => CATALOG }) });
const hsurface = (o = {}) => { const x = hs(); return { ...x, S: api('createSurface')({ adapters: [x.adapter], now: clock(), ...o }) }; };
const T0 = FX.sessions[0].messages[0].content;
const EX1 = 'query Opening($s: ID!, $n: Int = 2) {\n  head: turns(session: $s, first: $n) { ...T }\n}\nfragment T on FlowTurn { i role chars payload }';

await check('Q22 harness: Example 1 reproduces literally, header and data, from the fixture session', async () => {
  const { S } = hsurface();
  const r = await S.run(EX1, { variables: { s: 'sfixA' } });
  const header = '{"v":1,"q":"q1","op":"Opening","ok":true,"count":2,"pages":[{"path":"head","first":2,"total":11,"next":"2"}],"attrs":' + DEFAULT_ATTRS + ',"src":{},"kinds":[{"kind":"flow-turn","paths":["head"],"n":2,"labels":["t0","t1"],"caps":{"get":true,"props":["i","role","chars","calls","tool","ok"],"set":[]}}],"reducers":[{"with":"clip","args":{"max":200},"on":["flow-turn.payload"],"by":"default","hit":1,"in":369,"out":209}],"refs":[{"kind":"flow-turn","op":"get","labels":["t0"],"via":"I2","max":12000},{"kind":"flow-turn","op":"property","names":["calls","tool","ok"],"via":"I3"}],"policy":{"id":"default","rev":1,"ov":[]}}';
  const data = J({ head: [{ i: 0, role: 'user', chars: 369, payload: T0.slice(0, 200) + '...[+169]' }, { i: 1, role: 'assistant', chars: 14, payload: 'SECRET-CONTENT' }] });
  return J(r.header) === header && J(r.data) === data;
});
await check('Q22 harness: Example 1 follow up: get is declared for the clipped turn only', async () => {
  const { S } = hsurface();
  await S.run(EX1, { variables: { s: 'sfixA' } });
  const g = await S.ref('q1/t0', { op: 'get' }), n = await S.ref('q1/t1', { op: 'get' });
  return g.data === T0 && g.header.ok === true && n.errors?.[0]?.message === 'q1/t1: op "get" is not declared by this query (declared: property[calls,tool,ok])';
});
await check('Q22 harness: flow turn properties calls, tool and ok follow the stored messages', async () => {
  const { S } = hsurface();
  const r = await S.run('{ turns(session: "sfixA", first: 11) { i role calls tool ok } }');
  const t = r.data.turns;
  return t.length === 11 && same(t[1].calls, ['repo_read', 'repo_read', 'file_edit']) && same(t[7].calls, ['repo_commit', 'shell']) && t[2].tool === 'repo_read' && t[2].ok === true && t[4].tool === 'file_edit' && t[4].ok === false && t[8].tool === 'repo_commit' && t[8].ok === true && t[9].tool === 'shell' && t[9].ok === false;
});
await check('Q22 harness: the role filter and its total', async () => {
  const { S } = hsurface();
  const r = await S.run('{ turns(session: "sfixA", role: "tool", first: 3) { i } }');
  return r.header.pages[0].total === 5 && same(r.data.turns.map(t => t.i), [2, 3, 4]) && same(r.header.kinds[0].labels, ['t2', 't3', 't4']);
});
await check('Q22 harness: Example 2 reproduces literally over a catalog slice, the supersedes chain tail is served', async () => {
  const { S } = hsurface();
  const r = await S.run('{ concepts(status: "hypothesis", first: 2) { id name since } }');
  const header = '{"v":1,"q":"q1","op":null,"ok":true,"count":2,"pages":[{"path":"concepts","first":2,"total":3,"next":"2"}],"attrs":' + DEFAULT_ATTRS + ',"src":{},"kinds":[{"kind":"concept","paths":["concepts"],"n":2,"labels":["tampqj","qblgkn"],"caps":{"get":true,"props":["id","name","status","since","supersedes","nmodels"],"set":[]}}],"refs":[{"kind":"concept","op":"get","via":"I1","max":12000},{"kind":"concept","op":"property","names":["status","supersedes","nmodels"],"via":"I3"}],"policy":{"id":"default","rev":1,"ov":[]}}';
  const data = '{"concepts":[{"id":"tampqj","name":"flow alteration by a second model","since":"2026-11-19"},{"id":"qblgkn","name":"warp","since":"2026-11-20"}]}';
  return J(r.header) === header && J(r.data) === data;
});
await check('Q22 harness: Example 2 follow up: get returns the claim, set is refused', async () => {
  const { S } = hsurface();
  await S.run('{ concepts(status: "hypothesis", first: 2) { id name since } }');
  const g = await S.ref('q1/tampqj', { op: 'get' }), s = await S.ref('q1/tampqj', { op: 'set', name: 'status', value: 'measured' });
  return J(g) === '{"header":{"v":1,"q":"q1","label":"tampqj","op":"get","ok":true},"data":' + J(CLAIM) + '}' && s.errors?.[0]?.extensions?.code === 'REF_NOT_DECLARED';
});
await check('Q22 harness: a record named by supersedes is not served and its tail is, with supersedes and nmodels', async () => {
  const { S } = hsurface();
  const r = await S.run('{ concepts(first: 10) { id status supersedes nmodels } }');
  const ids = r.data.concepts.map(c => c.id), tail = r.data.concepts.find(c => c.id === 'newone');
  return !ids.includes('oldone') && ids.join() === 'ndgwdh,tampqj,qblgkn,newone,lastee' && tail.supersedes === 'oldone' && tail.nmodels === 2 && r.header.pages[0].total === 5;
});
await check('Q22 harness: the concept payload is its claim', async () => {
  const { S } = hsurface();
  const r = await S.run('{ concepts(status: "hypothesis", first: 1) { id payload } }');
  return r.data.concepts[0].payload === CLAIM;
});
await check('Q22 harness: Example 3 reproduces literally with an in-test handle adapter', async () => {
  const { S, handles } = hsurface({ reader: 'sfixA' });
  const r = await S.run('query H($h: ID!) {\n  handle(id: $h) { id kind owner t readers payload }\n  audit(id: $h, first: 2) { t reader h }\n}', { variables: { h: 'km7q2x' } });
  const header = '{"v":1,"q":"q1","op":"H","ok":true,"count":3,"pages":[{"path":"audit","first":2,"total":3,"next":"2"}],"attrs":' + DEFAULT_ATTRS + ',"src":{},"kinds":[{"kind":"handle","paths":["handle"],"n":1,"labels":["km7q2x"],"caps":{"get":true,"props":["id","kind","owner","t","readers"],"set":[]}},{"kind":"handle-audit","paths":["audit"],"n":2,"labels":["a0","a1"],"caps":{"get":false,"props":["n","t","id","reader","h"],"set":[]}}],"refs":[{"kind":"handle-audit","op":"property","names":["n","id"],"via":"I3"}],"policy":{"id":"default","rev":1,"ov":[]}}';
  const data = '{"handle":{"id":"km7q2x","kind":"stem","owner":"sfixA","t":1700000000150,"readers":["*","sfixA"],"payload":"stem 3 of 5 folded"},"audit":[{"t":1700000000100,"reader":"sfixA","h":"iok4xwb14t"},{"t":1700000000200,"reader":"sfixA","h":"1i0va4l66g"}]}';
  return J(r.header) === header && J(r.data) === data && handles.seen.resolve.length === 1 && same(handles.seen.resolve[0], ['km7q2x', 'sfixA']) && handles.log.length === 3;
});
await check('Q22 harness: sessions, ledger and checkpoints serve the stored shapes', async () => {
  const { S } = hsurface();
  const a = await S.run('{ sessions(first: 5) { id title msgs } }');
  const b = await S.run('{ ledger(session: "sfixA", first: 2) { n model prompt cached cost } }');
  const c = await S.run('{ checkpoints(session: "sfixA") { id kind writes } }');
  const lb = b.header.kinds[0].labels, rows = b.data.ledger;
  return same(a.data.sessions.map(s => [s.id, s.msgs]), [['sfixA', 11], ['sfixB', 4]]) && same(a.header.kinds[0].labels, ['sfixA', 'sfixB'])
    && b.header.pages[0].total === 7 && rows.length === 2 && rows[0].model === 'vendor/model-a' && rows[0].prompt === 4000 && rows[1].cached === 3800 && lb.every?.((l, k) => l === 'r' + rows[k].n)
    && same(c.data.checkpoints.map(x => x.kind), ['system', 'tail', 'stem']) && same(c.header.kinds[0].labels, ['a1', 'a2', 'a3']);
});
await check('Q22 harness: trail, faults and terms roots', async () => {
  const { S } = hsurface();
  const a = await S.run('{ trail(tool: "shell", first: 5) { n tool ok why } }');
  const b = await S.run('{ faults(class: "common") { id } terms(first: 5) { id term } }');
  const lb = a.header.kinds[0].labels;
  return a.header.pages[0].total === 2 && a.data.trail.every(r => r.tool === 'shell') && lb.every?.((l, k) => l === 'k' + a.data.trail[k].n) && same(b.data.faults, [{ id: 'faulta' }]) && same(b.data.terms.map(t => t.id), ['terma1', 'termb2']);
});
await check('Q22 harness: the module graph of the harness adapter takes injected sources only (no import outside app/query files)', async () => {
  const f = path.join(ROOT, 'app/query-harness.js');
  if (!fs.existsSync(f)) return 'app/query-harness.js missing';
  const src = fs.readFileSync(f, 'utf8');
  return [...src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].every(m => /^\.\/query[\w-]*\.js$/.test(m[1]));
});

// ================================================================ summary
console.log('\ngroups: ' + Object.keys(tally).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map(g => `${g}=${tally[g].pass + tally[g].fail}`).join(' '));
const total = Object.values(tally).reduce((a, g) => ({ pass: a.pass + g.pass, fail: a.fail + g.fail }), { pass: 0, fail: 0 });
console.log(`\n${total.pass} pass / ${total.fail} fail`);
process.exitCode = fails ? 1 : 0;
