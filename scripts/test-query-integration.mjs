// Query surface integration (Epic A1, story A1.2): the contract between the query surface (docs/QUERY.md) and the
// harness modules it joins: tools.js (tools `query`, `query_ref`), strategies.js (the strategy they live under),
// outstore.js and handles.js (the result behind a handle), the ledger and trail rows, session turns, the provider
// seam (mock triggers) and the reducer hook. Plain node, mock data only, no network, no browser.
// Run: node scripts/test-query-integration.mjs
// This suite is RED BY DESIGN until A1.3 (adapter and tool wiring) lands. It is registered in scripts/ci.mjs as
// `queryint` but is NOT in the default list and not in test.yml until then:
//   node scripts/ci.mjs queryint        (or node scripts/test-query-integration.mjs)
// A1.3 adds `queryint` to the default list and to test.yml in the commit that turns it green.
// stripe-1.0 registered by name is the separate suite scripts/test-query-stripe.mjs (ci key `querystripe`): it stays
// out of the default list and of test.yml until A1.4 decides and adds it, in the commit that turns it green.
//
// Check names are `QI<n> <group>: <behaviour>`. A check is a function: a throw is a failed check, not a stopped suite.
// Checks QI3-QI5, QI11 and the shape checks that pin what dev already does are GREEN today on purpose (guards);
// every other one names a behaviour that does not exist yet.
//
// Decisions the spec takes where docs/QUERY.md is silent (each also in the A1.2 report, and open for A1.3 to
// propose a spec change with a reason):
//  D1  Gate: a strategy spec flag `query: true` (strat-query-1.0 = strat-stem-1.0 plus the two tools). tools.js
//      `defsAs(defs, reads, wording, query)` appends the two definitions last, in the order query, query_ref.
//      defsFor and toolDefs never list them; a strategy without the flag is sent byte-identical definitions.
//  D2  Group: tools.js exports `queryTools` (the group of the two), registered for execution in `all()`.
//  D3  The surface reaches a tool as `ctx.query` (the host builds it from sources and the registered reducers).
//      Without it the tool answers a plain "No ..." line (a failed call), never throws.
//  D4  Wire text of a result: line 1 is JSON.stringify(header); the rest is JSON of {data, errors}, or, when the whole
//      text is over VIEW_MAX, the outstore view (a [os:... nL ends] tag line, then head and tail). The handle holds the
//      body; output_read(handle) returns it. The header is never cut.
//  D5  `query` goes through present() (PROTOCOL.md "Adding a tool" step 5); `query_ref` is in WHOLE (bounded by the
//      surface's getMax, 12000, plus a header).
//  D7  `query_ref` never goes through the stored-call path of exec ({ref} alone is a label, not a stored call).
//
// Open decisions, NOT checks (each a question for the spec owner of docs/QUERY.md; the suite takes no side):
//  O1  Failure agreement. QUERY.md 3.2 defines a flow-turn `ok` as false on a result that starts with `Tool error` or
//      `Not run`. The trail `ok` and context.turnOf already also treat `Unknown tool`, `Invalid JSON arguments` and
//      `No stored call` as failed. Whether the adapter's `ok` should follow them, and whether a `query` result whose
//      header says ok:false reads as failed in turnOf and in the adapter, is a change of a written contract
//      (QUERY.md 3.2), not a bug fix. Fault dgnuqs (catalog/inbox/seams-m4vb9e.jsonl). Only the trail row of a refused
//      `query_ref` is pinned (QI23, QUERY.md 6.3).
//  O2  Ledger `broke`. Serving the prefix-break field of measure on LedgerRow changes the kind (QUERY.md 3.2, OQ11), so
//      it belongs to the spec owner; A1.5 (the measure) needs it. Concept wjpfhz, deferred.
//  O3  Mechanism. The gate D1 (`defsAs` fourth parameter, spec flag `query`) is the one mechanism the suite pins; QI6
//      and QI8 call it. A1.3 may propose another by a `Spec:` commit with a reason.
//  Out of this suite, by design: `ctx.query` built by the host from real sources and the host `tick()` per turn
//  (QUERY.md 4.4, 6.3) need main.js and the page; a browser-suite check (scripts/smoke.mjs, named and added by A1.3)
//  owns them. Here ctx.query is a surface built over the harness adapter, as the host builds it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- storage shims (the modules keep state in IndexedDB and localStorage)
const dbs = {};
const req = fn => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
globalThis.indexedDB = {
  open(name) {
    const r = {};
    setTimeout(() => {
      const first = !dbs[name], data = dbs[name] ??= {};
      r.result = { createObjectStore(s) { data[s] ??= new Map(); }, transaction: s => ({ objectStore: () => ({ get: k => req(() => structuredClone(data[s].get(k))), put: (v, k) => req(() => { data[s].set(k, structuredClone(v)); return k; }) }) }) };
      if (first) r.onupgradeneeded?.();
      r.onsuccess?.();
    });
    return r;
  },
};
const ls = new Map();
globalThis.localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: k => { ls.delete(k); } };

const load = async p => import(p).catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
const T = await load('../app/tools.js'), S = await load('../app/strategies.js'), C = await load('../app/context.js'), OS = await load('../app/outstore.js');
const H = await load('../app/handles.js'), PR = await load('../app/providers.js'), PAT = await load('../app/patterns.js'), PROF = await load('../app/profiles.js');
const NEUT = await load('../app/neutral.js'), Q = await load('../app/query.js'), QH = await load('../app/query-harness.js'), ST = await load('../app/stripe.js');
const G = await load('./fixtures/query-guard.mjs');
const FIX = JSON.parse(rd('scripts/fixtures/model-view-pre-query.json'));

let fails = 0;
const check = async (name, fn) => {
  let ok = false, got = '';
  try { const r = await fn(); ok = r === true; if (!ok) got = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + String(got).replace(/\n/g, ' ').slice(0, 220)));
  if (!ok) fails++;
};
const J = v => JSON.stringify(v);
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => J(canon(a)) === J(canon(b));
const need = (m, name) => { if (m.missing) throw new Error(name + ': ' + m.missing); return m; };

// ---------------------------------------------------------------- the harness data, built the way the harness builds it
const SID = 'sq1', LONG = Array.from({ length: 60 }, (_, i) => `row ${i}: the quick brown fox jumps over the lazy dog near the river bank number ${i}`).join('\n');
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: J(args) } });
const TOOL_TEXT = { 5: 'Tool error: boom', 7: 'Unknown tool: nope', 9: 'Invalid JSON arguments: Unexpected end', 11: 'No stored call "os:zzzzzz".' };
let MEASURED = 0;
function mkSession() {
  const mid = SID + '-m' + (++MEASURED); // measure keeps the previous request per id: a fresh id per fixture, so every env sees the same rows
  const s = { id: SID, title: 'Query fixture', created: 1700000000000, system: 'You help with files.', core: 3, messages: [{ role: 'user', content: 'read the log' }], ledger: [] };
  s.messages.push({ role: 'assistant', content: '', tool_calls: [call('cL', 'run_js', { code: 'return log()' })] }, { role: 'tool', tool_call_id: 'cL', content: LONG });
  for (let i = 0; i < 30; i++) {
    s.messages.push({ role: 'assistant', content: '', tool_calls: [call('c' + i, i % 3 ? 'run_js' : 'output_read', { code: 'return ' + i })] });
    s.messages.push({ role: 'tool', tool_call_id: 'c' + i, content: TOOL_TEXT[i] || `line ${i} ` + 'x'.repeat(60) });
  }
  s.messages.push({ role: 'assistant', content: 'done' });
  // ledger rows as main.js writes them: measure (local half), report (the provider's half), strat
  const defsA = T.defsFor({ tools: [] }), defsB = T.defsFor({ tools: ['ask'] });
  const strat = 'strat-query-1.0';
  for (const defs of [defsA, defsA, defsB]) {
    const e = C.measure(mid, C.buildRequest(s, 'mock-1', defs));
    s.ledger.push({ ...C.report(e, { prompt_tokens: 900, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 640 }, cost: 0.0001 }), strat });
  }
  return s;
}
const clock = () => { let t = 1700000000000; return () => (t += 10); };
const emptyCat = { concepts: [], faults: [], terms: [] };

// env: a session, real handles, sources for the adapter, a surface, a tool ctx; spy = calls the adapter received
async function mkEnv({ spy = false, reducers, policy } = {}) {
  need(Q, 'app/query.js'); need(QH, 'app/query-harness.js');
  const session = mkSession(), hid = await need(H, 'app/handles.js').mint({ kind: 'stem', owner: SID, text: 'stem 3 of 5 folded' });
  const src = { sessions: () => [session], ckpt: () => ({}), trail: () => PAT.trail(), handles: { info: H.info, resolve: (id, reader) => H.resolve(id, reader, OS.get), audit: H.audit }, catalog: () => emptyCat };
  let adapter = QH.createHarnessAdapter(src);
  const calls = { fn: 0, resolve: 0 };
  if (spy) adapter = { ...adapter, kinds: Object.fromEntries(Object.entries(adapter.kinds).map(([k, v]) => [k, { ...v, fn: (...a) => (calls.fn++, v.fn(...a)) }])), resolve: (...a) => (calls.resolve++, QH.createHarnessAdapter(src).resolve(...a)) };
  const opts = { adapters: [adapter], now: clock(), ...(policy ? { policy } : {}), ...(reducers ? { reducers } : {}) };
  const surface = Q.createSurface(opts);
  const twin = () => Q.createSurface({ adapters: [QH.createHarnessAdapter(src)], now: clock(), ...(policy ? { policy } : {}), ...(reducers ? { reducers } : {}) });
  const ctx = { query: surface, by: () => ({ session: SID, message: session.messages.length - 1, model: 'mock-1', t: 1 }) };
  return { session, hid, src, surface, twin, ctx, calls };
}
const run = (env, name, args) => need(T, 'app/tools.js').execTool({ id: 'x' + Math.random().toString(36).slice(2, 6), type: 'function', function: { name, arguments: typeof args === 'string' ? args : J(args) } }, env.ctx);
// a model-visible result text: line 1 the header, the rest the body
const split = out => { const nl = out.indexOf('\n'), head = nl < 0 ? out : out.slice(0, nl); let header = null; try { header = JSON.parse(head); } catch {} return { head, header, rest: nl < 0 ? '' : out.slice(nl + 1) }; };
const bodyOf = out => { const { rest } = split(out); try { return JSON.parse(rest); } catch { return null; } };
const lastTrail = () => PAT.trail().at(-1);
const errMsg = out => bodyOf(out)?.errors?.[0]?.message;

const Q_SMALL = '{ turns(session: "sq1", first: 3) { i role chars calls tool ok } }';
// a query that selects fewer props than the kind has, so the surface declares a property ref (QUERY.md 4.3 I3, names calls, tool, ok)
const Q_REF = '{ turns(session: "sq1", first: 3) { i role chars } }';
const Q_BIG = '{ turns(session: "sq1", first: 100) { i role chars calls tool ok } ledger(session: "sq1") { n model strat prompt cached } trail(first: 50) { n tool ok chars } sessions { id title msgs } }';

// ================================================================ strategies (seam: strategies.js register)
await check('QI1 strategy: strat-query-1.0 is registered with the query flag and the stem strategy\'s other settings', () => {
  need(S, 'app/strategies.js');
  const q = S.spec('strat-query-1.0'), s = S.spec('strat-stem-1.0');
  if (!S.known('strat-query-1.0')) return 'strat-query-1.0 is not registered';
  return q.query === true && q.name === 'query' && same(q.checkpoints, s.checkpoints) && q.stems === s.stems && q.handles === s.handles && q.reads === s.reads && q.wording === s.wording;
});
await check('QI2 strategy: only strat-query-1.0 carries the query flag, and its id cannot be registered twice', () => {
  need(S, 'app/strategies.js');
  const withFlag = S.list().filter(s => s.query).map(s => s.id);
  let threw = false;
  try { S.register({ id: 'strat-query-1.0', name: 'query' }); } catch { threw = true; }
  return same(withFlag, ['strat-query-1.0']) && threw;
});
await check('QI3 strategy (guard): the six strategies registered on 135f592 keep their specs byte for byte', () => {
  need(G, 'fixtures/query-guard.mjs');
  const bad = G.PRE.filter(id => G.specOf(id) !== FIX.spec[id]);
  return bad.length === 0 || 'spec changed: ' + bad.join();
});

// ================================================================ the request prefix (seam: tools.js defsAs, context.js measure)
await check('QI4 prefix (guard): every strategy registered on 135f592 is sent the same tool definitions, for both tool groups', () => {
  need(G, 'fixtures/query-guard.mjs');
  const bad = [];
  for (const id of G.PRE) for (const g of Object.keys(G.GROUPS)) if (G.viewOf(id, g).defs !== FIX.view[id][g].defs) bad.push(id + '/' + g);
  return bad.length === 0 || 'definitions changed: ' + bad.join();
});
await check('QI5 prefix (guard): and the same request bytes, so context.measure reports no break against an earlier request of any of them', () => {
  need(G, 'fixtures/query-guard.mjs');
  const bad = [];
  for (const id of G.PRE) for (const g of Object.keys(G.GROUPS)) if (G.viewOf(id, g).body !== FIX.view[id][g].body) bad.push(id + '/' + g);
  if (bad.length) return 'request changed: ' + bad.join();
  // the live check on the same ground: two requests under one strategy, nothing in tools or turns changes, measure reports no break
  const defs = T.defsAs(T.defsFor(G.GROUPS.all), 'ranged', undefined, undefined);
  const a = C.measure('guard-a', C.buildRequest(G.SESSION, 'mock-1', defs)), b = C.measure('guard-a', C.buildRequest(G.SESSION, 'mock-1', defs));
  return a.broke === null && b.broke === null;
});
await check('QI6 prefix: under strat-query-1.0 the definitions are the strat-stem-1.0 definitions with query and query_ref appended last, in that order', () => {
  need(T, 'app/tools.js'); need(S, 'app/strategies.js');
  const q = S.spec('strat-query-1.0'), s = S.spec('strat-stem-1.0');
  if (!q?.query) return 'strat-query-1.0 has no query flag';
  for (const g of Object.keys(G.GROUPS)) {
    const base = T.defsAs(T.defsFor(G.GROUPS[g]), s.reads, s.wording, s.query), withQ = T.defsAs(T.defsFor(G.GROUPS[g]), q.reads, q.wording, q.query);
    if (J(withQ.slice(0, base.length)) !== J(base)) return g + ': the stem definitions are not a byte-identical prefix';
    if (!same(withQ.slice(base.length).map(d => d.function.name), ['query', 'query_ref'])) return g + ': appended ' + withQ.slice(base.length).map(d => d.function.name).join();
  }
  return true;
});
await check('QI7 prefix: the two tools are a group of their own (queryTools); defsFor, toolDefs and the other groups never list them', () => {
  need(T, 'app/tools.js');
  if (!Array.isArray(T.queryTools)) return 'tools.js exports no queryTools';
  const names = T.queryTools.map(t => t.def.function.name), listed = [...T.toolDefs, ...T.defsFor({ tools: ['ask', 'values', 'repo', 'vm', 'files', 'local'] })].map(d => d.function.name);
  return same(names, ['query', 'query_ref']) && !listed.includes('query') && !listed.includes('query_ref');
});
await check('QI8 prefix: the definitions carry the QUERY.md wire (q and variables; ref, op, name, value, why), name no identifying term, and the strategy call site passes the flag', () => {
  need(T, 'app/tools.js'); need(NEUT, 'app/neutral.js');
  const defs = T.defsAs(T.defsFor({ tools: [] }), undefined, 'neutral', true), q = defs.find(d => d.function.name === 'query')?.function, r = defs.find(d => d.function.name === 'query_ref')?.function;
  if (!q || !r) return 'a definition is missing';
  const pq = q.parameters.properties, pr = r.parameters.properties;
  const shape = same(Object.keys(pq).sort(), ['q', 'variables']) && same(q.parameters.required, ['q']) && same(Object.keys(pr).sort(), ['name', 'op', 'ref', 'value', 'why']) && same(r.parameters.required, ['ref', 'op']) && same(pr.op.enum, ['get', 'property', 'set']);
  const words = /header/i.test(q.description) && /<q>\/<label>|q1\/t0/.test(r.description);
  const neutral = NEUT.found(J(defs)).length === 0;
  // main.js does not load in node: its call site is read as text (the browser suites cover the live path in A1.3)
  const site = /defsAs\([^;]*sp\.reads, sp\.wording, sp\.query\)/.test(rd('app/main.js'));
  return shape && words && neutral && site || J({ shape, words, neutral, site });
});
await check('QI9 prefix (guard): neither tool is withheld by a capability: allowedTool is true under every caps set (restrictions are options, off by default)', () => {
  need(PROF, 'app/profiles.js');
  const caps = { run_js: false, fanout: false, ask: false, vm: false, repo: 'none', local: false };
  return PROF.allowedTool('query', caps) === true && PROF.allowedTool('query_ref', caps) === true;
});

// ================================================================ the provider seam (providers.js, mock triggers only)
const toolCall = async text => {
  need(PR, 'app/providers.js');
  let name = '', args = '';
  for await (const ch of PR.providers.mock.stream({ model: 'mock-1', messages: [{ role: 'user', content: text }], stream: true }))
    for (const tc of ch.choices?.[0]?.delta?.tool_calls || []) { name += tc.function?.name || ''; args += tc.function?.arguments || ''; }
  return { name, args: args ? JSON.parse(args) : null };
};
await check('QI10 provider (guard): the provider seam is unchanged: the same three providers, the same mock models, a stream(body) generator', async () => {
  need(PR, 'app/providers.js');
  const models = (await PR.providers.mock.models()).map(m => m.id);
  return same(Object.keys(PR.providers).sort(), ['claude', 'mock', 'openrouter']) && same(models, ['mock-1', 'mock-bp', 'mock-pro', 'mock-free:free']) && PR.providers.mock.stream.constructor.name === 'AsyncGeneratorFunction' || J({ keys: Object.keys(PR.providers), models });
});
await check('QI11 provider: the mock answers "query: <text>" with a query call carrying that text', async () => {
  const c = await toolCall('query: ' + Q_SMALL);
  return c.name === 'query' && c.args?.q === Q_SMALL || J(c);
});
await check('QI12 provider: the mock answers "qref <ref> get" and "qref <ref> property <name>" with query_ref calls', async () => {
  const a = await toolCall('qref q1/t0 get'), b = await toolCall('qref q1/t1 property calls');
  return a.name === 'query_ref' && same(a.args, { ref: 'q1/t0', op: 'get' }) && b.name === 'query_ref' && same(b.args, { ref: 'q1/t1', op: 'property', name: 'calls' }) || J({ a, b });
});
await check('QI13 provider: the mock answers "qref q9/t0 set status done" with a query_ref call that the surface refuses (op set, a value)', async () => {
  const a = await toolCall('qref q9/t0 set status done');
  return a.name === 'query_ref' && a.args?.ref === 'q9/t0' && a.args?.op === 'set' && a.args?.name === 'status' && a.args?.value === 'done' || J(a);
});

// ================================================================ the tool run (seam: tools.js execTool, outstore.js present)
await check('QI14 tool: query returns the header on line 1 and {data} after it, equal to what the surface itself returns, and leaves a trail row', async () => {
  const env = await mkEnv(), out = await run(env, 'query', { q: Q_SMALL }), direct = await env.twin().run(Q_SMALL), { head, header } = split(out);
  const row = lastTrail();
  return head === J(direct.header) && same(header, direct.header) && same(bodyOf(out)?.data, direct.data) && row?.tool === 'query' && row.ok === true && row.chars === out.length && row.session === SID || J({ out: out.slice(0, 120), row });
});
await check('QI15 tool: a result over VIEW_MAX keeps the whole header on line 1, names an os: handle, stays bounded, and output_read of the handle returns every turn', async () => {
  const env = await mkEnv(), out = await run(env, 'query', { q: Q_BIG }), { head, header } = split(out), direct = await env.twin().run(Q_BIG);
  if (J(direct).length <= OS.VIEW_MAX) return 'precondition: the fixture result is not over VIEW_MAX';
  if (head.length <= 900) return 'precondition: the header is ' + head.length + ' chars, a cut at 900 would not show';
  const handle = /\[(os:[a-z0-9]{6,12}) /.exec(out)?.[1];
  if (!handle) return 'no os: handle in the output: ' + out.slice(0, 160);
  const full = await run(env, 'output_read', { handle, length: 4000 }), stored = await OS.get(handle);
  const body = (stored.startsWith(head + '\n') ? stored.slice(head.length + 1) : stored);
  let parsed = null; try { parsed = JSON.parse(body); } catch {}
  return head === J(direct.header) && header?.ok === true && out.length <= head.length + OS.VIEW_MAX + 400 && parsed?.data?.turns?.length === direct.data.turns.length && full.length > 0 && lastTrail().out === handle || J({ head: head.slice(0, 80), len: out.length, handle, n: parsed?.data?.turns?.length });
});
await check('QI16 tool: query_ref get is bounded by the declared max (12000) plus a header, and a cut ends with the clip marker', async () => {
  const env = await mkEnv();
  env.session.messages.push({ role: 'user', content: 'big' }, { role: 'assistant', content: 'B'.repeat(20000) });
  const i = env.session.messages.length - 1;
  const q = await run(env, 'query', { q: `{ turns(session: "sq1", role: "assistant", first: 100) { i role } }` });
  const ref = split(q).header?.refs?.find(r => r.op === 'get');
  if (!ref) return 'the header declares no get: ' + split(q).head.slice(0, 200);
  const out = await run(env, 'query_ref', { ref: `q1/t${i}`, op: 'get' }), { header } = split(out), data = bodyOf(out)?.data;
  return header?.ok === true && typeof data === 'string' && data.length <= 12000 + 40 && /\.\.\.\[\+\d+\]$/.test(data) && out.length <= 12000 + 600 || J({ head: split(out).head.slice(0, 120), len: out.length });
});
await check('QI17 tool: refused refs give the exact refusal messages of QUERY.md 4.5, as the error message after a header with ok false', async () => {
  const env = await mkEnv();
  await run(env, 'query', { q: Q_REF });
  const got = {
    format: errMsg(await run(env, 'query_ref', { ref: 'nope', op: 'get' })),
    unknown: errMsg(await run(env, 'query_ref', { ref: 'q9/t0', op: 'get' })),
    label: errMsg(await run(env, 'query_ref', { ref: 'q1/t9999', op: 'get' })),
    setOp: errMsg(await run(env, 'query_ref', { ref: 'q1/t0', op: 'set', name: 'ok', value: true })),
    name: errMsg(await run(env, 'query_ref', { ref: 'q1/t0', op: 'property', name: 'foo' })),
  };
  const head = split(await run(env, 'query_ref', { ref: 'q9/t0', op: 'get' })).header;
  return got.format === 'ref must be <query>/<label>, for example q1/t0' && got.unknown === 'unknown query q9' && got.label === 'q1 has no label t9999'
    && got.setOp === 'q1/t0: op "set" is not declared by this query (declared: get, property[calls,tool,ok])' && got.name === 'q1/t0: property "foo" is not declared (declared: calls, tool, ok)'
    && same(head, { v: 1, q: 'q9', label: 't0', op: 'get', ok: false }) || J({ got, head });
});
await check('QI18 tool: a refused ref calls nothing of the adapter (no kind fn, no resolve) and leaves the audit row with the code', async () => {
  const env = await mkEnv({ spy: true });
  await run(env, 'query', { q: Q_REF });
  const before = { ...env.calls };
  for (const a of [{ ref: 'q9/t0', op: 'get' }, { ref: 'bad', op: 'get' }, { ref: 'q1/t9999', op: 'get' }, { ref: 'q1/t0', op: 'set', name: 'ok', value: 1 }, { ref: 'q1/t0', op: 'property', name: 'zzz' }]) await run(env, 'query_ref', a);
  const codes = env.surface.audit().filter(r => r.ok === false).map(r => r.code);
  return same(env.calls, before) && same(codes, ['REF_UNKNOWN_QUERY', 'REF_FORMAT', 'REF_UNKNOWN_LABEL', 'REF_NOT_DECLARED', 'REF_BAD_NAME']) || J({ before, after: env.calls, codes });
});
await check('QI19 tool: a label ref alone ({ref} or {ref, name}) is read by the surface, never as a stored call of exec', async () => {
  const env = await mkEnv();
  await run(env, 'query', { q: Q_SMALL });
  const a = await run(env, 'query_ref', { ref: 'q1/t0' }), b = await run(env, 'query_ref', { ref: 'q1/t0', name: 'calls' });
  return [a, b].every(o => !/^No stored call/.test(o) && split(o).header?.ok === false && /^REF_/.test(bodyOf(o)?.errors?.[0]?.extensions?.code || '')) || J({ a: a.slice(0, 100), b: b.slice(0, 100) });
});
await check('QI20 tool: the default scope expires a query after the 8 most recent: its ref gives the exact REF_EXPIRED message, a recent one still resolves', async () => {
  const env = await mkEnv();
  for (let i = 0; i < 12; i++) await run(env, 'query', { q: Q_SMALL });
  const old = await run(env, 'query_ref', { ref: 'q1/t0', op: 'get' }), recent = await run(env, 'query_ref', { ref: 'q12/t0', op: 'get' });
  return errMsg(old) === 'query q1 expired (scope: 8 queries); run the query again' && split(recent).header?.ok === true || J({ old: old.slice(0, 160), recent: recent.slice(0, 100) });
});
await check('QI21 tool: with no surface in the context the tools answer a plain failed line and do not throw', async () => {
  const out = await run({ ctx: { by: () => ({ session: SID }) } }, 'query', { q: Q_SMALL }), out2 = await run({ ctx: {} }, 'query_ref', { ref: 'q1/t0', op: 'get' });
  return /^No /.test(out) && /^No /.test(out2) && lastTrail().ok === false || J({ out, out2 });
});
await check('QI22 trail: a query_ref call leaves a trail row with the ref, the why (cut to 200) and the outcome; the row is the harness\'s own record, not the model\'s', async () => {
  const env = await mkEnv();
  await run(env, 'query', { q: Q_REF });
  const why = 'looking for the failing tool call. '.repeat(10);
  await run(env, 'query_ref', { ref: 'q1/t0', op: 'property', name: 'calls', why });
  const row = lastTrail();
  return row?.tool === 'query_ref' && row.ref === 'q1/t0' && row.why === why.slice(0, 200) && row.ok === true && row.session === SID && row.chars > 0 || J(row);
});

// ================================================================ failure in the trail (seam: tools.js trail ok; QUERY.md 6.3 tool join)
// The wire text of a failed query as the tool join defines it (line 1 the header, then the JSON body); built from the surface
// so that QI37 does not depend on the tool existing.
const BAD_Q = '{ turns( }';
const wire = r => J(r.header) + '\n' + J(r.data === undefined ? { errors: r.errors } : { data: r.data, ...(r.errors ? { errors: r.errors } : {}) });
await check('QI23 failure: a query_ref the surface refuses is a failed row in the trail, and one it answers is not', async () => {
  const env = await mkEnv();
  await run(env, 'query', { q: Q_REF });
  const bad = await run(env, 'query_ref', { ref: 'q9/t0', op: 'get' }), badRow = lastTrail();
  const good = await run(env, 'query_ref', { ref: 'q1/t0', op: 'property', name: 'calls' }), goodRow = lastTrail();
  return split(bad).header?.ok === false && badRow?.tool === 'query_ref' && badRow.ok === false && split(good).header?.ok === true && goodRow.ok === true || J({ bad: bad.slice(0, 100), badRow, goodRow });
});

// ================================================================ the adapter over the harness's real shapes (seam: query-harness.js, kept as is)
await check('QI27 adapter (guard): turns, tool calls and results come from a session as built: calls names on an assistant turn, tool and ok on its result', async () => {
  const env = await mkEnv(), r = await env.surface.run('{ turns(session: "sq1", first: 6) { i role calls tool ok chars } }'), t = r.data.turns;
  return r.header.ok && t[1].role === 'assistant' && same(t[1].calls, ['run_js']) && t[2].role === 'tool' && t[2].tool === 'run_js' && t[2].ok === true && t[2].chars === LONG.length && t[3].calls.includes('output_read') || J(t.slice(0, 4));
});
await check('QI28 adapter (guard): a tool result that starts with Tool error is a failed turn (ok false); the one before it is not', async () => {
  const env = await mkEnv(), i = 2 * 5 + 4 - 0, r = await env.surface.run('{ turns(session: "sq1", role: "tool", first: 100) { i ok tool } }'), t = r.data.turns;
  const bad = t.filter(x => x.ok === false).map(x => x.i);
  return bad.includes(2 + 2 * 6) && !bad.includes(2) && t.length === 31 || J({ bad, n: t.length, i });
});
await check('QI29 adapter (guard): trail rows written by execTool are served as trail-row with tool, ok, chars, ref, why', async () => {
  const env = await mkEnv();
  await run(env, 'output_read', { handle: 'os:abcdef12', why: 'probe' });
  const r = await env.surface.run('{ trail(tool: "output_read", first: 50) { n tool ok chars why ref } }'), last = r.data.trail.at(-1);
  return r.header.ok && last.tool === 'output_read' && last.ok === false && last.why === 'probe' && last.chars > 0 || J(last);
});
await check('QI30 adapter (guard): a handle is served as kind, owner, readers; its payload resolves through resolve(id, reader) and adds one audit row', async () => {
  const env = await mkEnv(), before = H.audit().filter(r => r.id === env.hid).length;
  const r = await env.surface.run(`{ handle(id: "${env.hid}") { id kind owner readers payload } audit(id: "${env.hid}") { n id reader h } }`);
  const a = r.data.audit, h = r.data.handle;
  return r.header.ok && h.kind === 'stem' && h.owner === SID && h.payload === 'stem 3 of 5 folded' && a.length === before + 1 && a.at(-1).h === H.contentHash('stem 3 of 5 folded') || J({ h, a, err: r.errors });
});
await check('QI31 adapter (guard): ledger rows from measure and report are served with their usage fields and the strategy that ran', async () => {
  const env = await mkEnv(), r = await env.surface.run('{ ledger(session: "sq1") { n model strat prompt cached completion cost chars kept } }'), l = r.data.ledger;
  return r.header.ok && l.length === 3 && l.every(x => x.strat === 'strat-query-1.0' && x.prompt === 900 && x.cached === 640 && x.model === 'mock-1') && l[0].kept === null && l[1].kept > 0 && l[2].kept > 0 || J(l);
});

// ================================================================ the header (QUERY.md 2.1) over the harness adapter
const ORDER = ['v', 'q', 'op', 'ok', 'count', 'pages', 'attrs', 'src', 'kinds', 'reducers', 'refs', 'dropped', 'policy'];
await check('QI34 header (guard): v is 1, keys appear in the fixed order, a harness kind block has no materialized or desc key (OQ13)', async () => {
  const env = await mkEnv(), r = await env.surface.run(Q_BIG), keys = Object.keys(r.header), idx = keys.map(k => ORDER.indexOf(k));
  const blocks = r.header.kinds;
  return r.header.v === 1 && r.header.q === 'q1' && idx.every((x, i) => x >= 0 && (i === 0 || x > idx[i - 1])) && keys.slice(0, 4).join() === 'v,q,op,ok' && blocks.length >= 4 && blocks.every(b => !('materialized' in b) && !('desc' in b)) || J({ keys, blocks: blocks.map(b => Object.keys(b)) });
});
await check('QI35 header (guard): a query without a scope decorator has the default scope {queries: 8} and the policy id and revision', async () => {
  const env = await mkEnv(), r = await env.surface.run(Q_SMALL);
  return same(r.header.attrs.scope, { queries: 8 }) && r.header.policy?.id === 'default' && r.header.policy?.rev === 1 || J({ attrs: r.header.attrs, policy: r.header.policy });
});
await check('QI36 header (guard): a ref result header is {v, q, label, op, ok} in that order, and the same query run twice gives byte-identical headers', async () => {
  const env = await mkEnv(), a = await env.surface.run(Q_SMALL), b = await env.twin().run(Q_SMALL), r = await env.surface.ref('q1/t0', { op: 'property', name: 'calls' });
  return J(a.header) === J(b.header) && Object.keys(r.header).join() === 'v,q,label,op,ok' || J({ ref: r.header });
});
// RED TODAY for a reason in dev, not only for the missing tools: the header key `pages` (QUERY.md 2.1, one row per
// paginated entry field) matches the neutral.js term /\bpages?\b/. A1.3 must pick: rename the key (a QUERY.md and
// test-query.mjs spec change, its own commit) or narrow the neutral rule. This check does not choose.
await check('QI37 neutral: nothing a model reads from the surface (headers, results, refusals, the synopsis) holds an identifying term of app/neutral.js', async () => {
  need(NEUT, 'app/neutral.js');
  const env = await mkEnv(), outs = [await run(env, 'query', { q: Q_BIG }), await run(env, 'query', { q: '{ __synopsis }' }), await run(env, 'query', { q: BAD_Q }), await run(env, 'query_ref', { ref: 'q9/t0', op: 'get' }), await run(env, 'query_ref', { ref: 'q2/t0', op: 'get' }), env.surface.synopsis()];
  // the surface's own text, independent of the tool: results, refusals, ref results
  const direct = [wire(await env.surface.run(Q_BIG)), wire(await env.surface.run(BAD_Q)), J(await env.surface.ref('q9/t0', { op: 'get' })), J(await env.surface.ref('q1/t0', { op: 'set', name: 'x', value: 1 }))];
  const hits = [...outs, ...direct].map(o => NEUT.found(o));
  return hits.every(h => h.length === 0) && !outs.slice(0, 5).some(o => /^(Unknown tool|No )/.test(o)) || J(hits.map((h, i) => [i, h]).filter(x => x[1].length)) + ' tool outputs: ' + outs.slice(0, 5).map(o => o.slice(0, 30)).join('|');
});
await check('QI38 policy (guard): the surface policy shape is its own (QUERY.md OQ8): no module of the surface reads app/policy.js and app/policy.js reads none of them', () => {
  const files = fs.readdirSync(path.join(ROOT, 'app')).filter(f => /^query.*\.js$/.test(f));
  const readsPolicy = files.filter(f => /from '\.\/policy\.js'/.test(rd('app/' + f)));
  const policyReads = /from '\.\/query/.test(rd('app/policy.js'));
  return files.length >= 8 && !readsPolicy.length && !policyReads || J({ files: files.length, readsPolicy, policyReads });
});

// ================================================================ the reducer hook with stripe-1.0 (TENET 13: nothing lost, nothing re-run)
const Q_LONG = `{ turns(session: "sq1", role: "tool", first: 1) @reduce(with: "stripe-1.0", maxChars: 400) { i payload } }`;
const Q_PLAIN = `{ turns(session: "sq1", role: "tool", first: 1) @payload(mode: "full") { i payload } }`;
const stripeReducer = (text, args) => ST.stripe(text, args).text;
await check('QI39 stripe (hook, guard): stripe-1.0 registered by name at the hook gives a skeleton in the result that parses and verifies against the source text', async () => {
  need(ST, 'app/stripe.js');
  const env = await mkEnv({ reducers: { [ST.ID]: stripeReducer } }), r = await env.surface.run(Q_LONG), p = r.data?.turns?.[0]?.payload;
  if (!r.header.ok) return J(r.errors?.map(e => e.message));
  const parsed = ST.parse(p);
  return r.header.reducers?.some(x => x.with === 'stripe-1.0' && x.hit === 1) && p.length < LONG.length / 2 && ST.verify(LONG, parsed) && parsed.header.ref === 'fp:' + ST.fingerprint(LONG) || J({ rows: r.header.reducers, len: p?.length });
});
await check('QI40 stripe (hook, guard): a stripe never changes what a ref resolves to: the source text, its audit hash and an unreduced get are the same with and without it', async () => {
  const withS = await mkEnv({ reducers: { [ST.ID]: stripeReducer } }), plain = await mkEnv();
  await withS.surface.run(Q_LONG);
  const g = await withS.surface.run(Q_PLAIN), p = await plain.surface.run(Q_PLAIN);
  const ref = await withS.surface.ref('q2/t2', { op: 'property', name: 'chars' }), ref0 = await plain.surface.ref('q1/t2', { op: 'property', name: 'chars' });
  return g.data.turns[0].payload === LONG && p.data.turns[0].payload === LONG && same(ref.data, ref0.data) && J(g.header.refs) === J(p.header.refs) || J({ g: g.data?.turns?.[0]?.payload?.length, ref: ref.data, ref0: ref0.data, errs: g.errors });
});
await check('QI41 stripe (hook, guard): a get ref on a label whose query striped it is declared (I2), and the get returns the same skeleton as the result carried', async () => {
  const env = await mkEnv({ reducers: { [ST.ID]: stripeReducer } }), r = await env.surface.run(Q_LONG), p = r.data.turns[0].payload;
  const decl = r.header.refs?.find(x => x.op === 'get'), g = await env.surface.ref('q1/t2', { op: 'get' });
  return decl?.via === 'I2' && g.header.ok && g.data === p && g.header.reducer?.with === 'stripe-1.0' || J({ decl, ok: g.header, same: g.data === p });
});
// stripe-1.0 as a registered reducer (named by @reduce, resolved by name) is the separate suite scripts/test-query-stripe.mjs (ci key `querystripe`, A1.4).

console.log(fails ? `\n${fails} check(s) failed (red by design until A1.3: see the header of this file)` : '\nall checks passed');
process.exitCode = fails ? 1 : 0;
