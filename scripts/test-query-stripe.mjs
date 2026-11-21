// Query surface and stripe-1.0 (Epic A1, A1.4): the striping reducer named at the query surface's reducer hook
// (QUERY.md 5, OQ15) and TENET 13: a stripe never changes what a ref resolves to. Contract only: this suite does not say
// where the registry of reducers lives (which module, which export). It looks for a registry wherever the app
// modules export one, then builds a surface with it exactly as a host would (createSurface({reducers})).
// Plain node, mock data only, no network, no browser.
// Run: node scripts/test-query-stripe.mjs   (ci key `querystripe`)
// RED BY DESIGN until A1.4 registers stripe-1.0 by name. Not in the default CI list and not in test.yml:
// A1.4 adds it to both in the commit that turns it green. (The hook itself, with a reducer registered inline in
// the test, is already pinned green in scripts/test-query-integration.mjs QI39-QI41 and in scripts/test-query.mjs Q9.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async p => import(p).catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
const Q = await load('../app/query.js'), QH = await load('../app/query-harness.js'), ST = await load('../app/stripe.js');

let fails = 0;
const check = async (name, fn) => {
  let ok = false, got = '';
  try { const r = await fn(); ok = r === true; if (!ok) got = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + String(got).replace(/\n/g, ' ').slice(0, 220)));
  if (!ok) fails++;
};
const J = v => JSON.stringify(v);
const need = (m, name) => { if (m.missing) throw new Error(name + ': ' + m.missing); return m; };

// ---------------------------------------------------------------- find the registry, wherever it lives
// A registry is an exported plain object or Map with a function under the name stripe-1.0. main.js is not loaded
// (it needs the page); a module that does not load in node is skipped.
async function findRegistry() {
  need(ST, 'app/stripe.js');
  const files = fs.readdirSync(path.join(ROOT, 'app')).filter(f => f.endsWith('.js') && f !== 'main.js' && !f.startsWith('vendor'));
  for (const f of files) {
    let m; try { m = await import('../app/' + f); } catch { continue; }
    for (const [k, v] of Object.entries(m)) {
      if (v instanceof Map && typeof v.get(ST.ID) === 'function') return { fn: v.get(ST.ID), where: f + ':' + k };
      if (v && typeof v === 'object' && !(v instanceof Map) && typeof v[ST.ID] === 'function' && v !== ST) return { fn: v[ST.ID], where: f + ':' + k };
    }
  }
  return null;
}

// ---------------------------------------------------------------- fixture: one session, one long tool result, a harness adapter over it
const LONG = Array.from({ length: 60 }, (_, i) => `row ${i}: the quick brown fox jumps over the lazy dog near the river bank number ${i}`).join('\n');
const session = { id: 'ss1', title: 'Stripe fixture', created: 1700000000000, system: 'You help.', core: 3, ledger: [], messages: [
  { role: 'user', content: 'read it' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_js', arguments: '{"code":"return log()"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: LONG },
  { role: 'assistant', content: 'done' }] };
const src = { sessions: () => [session], ckpt: () => ({}), trail: () => [], handles: { info: () => null, resolve: async () => '', audit: () => [] }, catalog: () => ({ concepts: [], faults: [], terms: [] }) };
const clock = () => { let t = 1700000000000; return () => (t += 10); };
const surface = reg => Q.createSurface({ adapters: [QH.createHarnessAdapter(src)], now: clock(), ...(reg ? { reducers: { [ST.ID]: reg.fn } } : {}) });
const Q_STRIPE = '{ turns(session: "ss1", role: "tool", first: 1) @reduce(with: "stripe-1.0", maxChars: 400) { i payload } }';
const Q_FULL = '{ turns(session: "ss1", role: "tool", first: 1) @payload(mode: "full") { i payload } }';
const Q_PLAIN = '{ turns(session: "ss1", role: "tool", first: 1) { i payload } }';
const reg = await findRegistry();
const noReg = 'no module of app/ exports a registry with a function under "stripe-1.0"';

await check('QS1 registry: a reducer named stripe-1.0 is registered by name where a surface can be given it', () => reg ? true : noReg);
await check('QS2 hook: a query naming @reduce(with: "stripe-1.0") is resolved by that name; the skeleton parses, verifies against the source text and carries its fingerprint', async () => {
  if (!reg) return noReg;
  const r = await surface(reg).run(Q_STRIPE), p = r.data?.turns?.[0]?.payload;
  if (!r.header.ok) return J(r.errors?.map(e => e.message));
  const parsed = ST.parse(p);
  return r.header.reducers?.some(x => x.with === 'stripe-1.0' && x.hit === 1) && p.length < LONG.length / 2 && ST.verify(LONG, parsed) && parsed.header.ref === 'fp:' + ST.fingerprint(LONG) || J({ rows: r.header.reducers, len: p?.length });
});
await check('QS3 TENET 13: a stripe never changes what a ref resolves to: an unreduced payload is the source text, and ref values and declared refs are the same with and without the registry', async () => {
  if (!reg) return noReg;
  const withR = surface(reg), plain = surface(null);
  await withR.run(Q_STRIPE);
  const g = await withR.run(Q_FULL), p = await plain.run(Q_FULL);
  const a = await withR.ref('q2/t2', { op: 'property', name: 'chars' }), b = await plain.ref('q1/t2', { op: 'property', name: 'chars' });
  return g.data.turns[0].payload === LONG && p.data.turns[0].payload === LONG && J(a.data) === J(b.data) && J(g.header.refs) === J(p.header.refs) || J({ g: g.data?.turns?.[0]?.payload?.length, a: a.data, b: b.data });
});
await check('QS4 hook: a get on a label whose query striped it is declared, and returns the skeleton the result carried', async () => {
  if (!reg) return noReg;
  const s = surface(reg), r = await s.run(Q_STRIPE), p = r.data.turns[0].payload, g = await s.ref('q1/t2', { op: 'get' });
  return r.header.refs?.some(x => x.op === 'get') && g.header.ok && g.data === p && g.header.reducer?.with === 'stripe-1.0' || J({ refs: r.header.refs, ref: g.header });
});
await check('QS5 hook: a registered stripe is applied only where a query or policy names it: a plain query has no stripe row and no skeleton', async () => {
  if (!reg) return noReg;
  const r = await surface(reg).run(Q_PLAIN);
  return r.header.ok && !(r.header.reducers || []).some(x => x.with === 'stripe-1.0') && !/^\[/.test(r.data.turns[0].payload) || J({ rows: r.header.reducers });
});

console.log(fails ? `\n${fails} check(s) failed (red by design until A1.4: see the header of this file)` : '\nall checks passed');
process.exit(fails ? 1 : 0);
