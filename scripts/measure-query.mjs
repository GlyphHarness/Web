// Query surface, deterministic measurement (rigid order step 5, no model). docs/QUERY.md OQ1, OQ5, OQ7, OQ9, OQ14, Q15-Q17, Q20.
// Builds a surface over the harness adapter fed with repo fixtures (scripts/fixtures sessions, the live catalog/*.jsonl read at run
// time, in-script synthetic handles, trail and a long session), runs a fixed battery and writes docs/concepts/results/query-det-<date>.json
// and .md. Plain node, no browser, no network, no model. Run: node scripts/measure-query.mjs [--date YYYY-MM-DD] [--tag <short sha>] (headSha = git rev-parse HEAD or env GIT_SHA)
// Token estimate everywhere: ceil(chars / 4). Timings are wall clock (median of 5) and are not part of the determinism hash.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createSurface } from '../app/query.js';
import { slice, range } from '../app/outstore.js'; // the real pure read helpers of output_read (the db part is not touched)
import { ROOT, J, tok, hash, median, MET, RND, CAT, RAW, slong, SESSIONS, TRAIL, DESC, mk } from './measure-query-fixtures.mjs';

const arg = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
let SHA = process.env.GIT_SHA || null; try { SHA = SHA || execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
const TAG = arg('--tag') ? '-' + arg('--tag') : ''; // output name suffix, so a later run does not overwrite an earlier result (--tag <short sha>)
const DATE = (process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10));

// ------------------------------------------------------------------ the battery
const EX1 = 'query Opening($s: ID!, $n: Int = 2) {\n  head: turns(session: $s, first: $n) { ...T }\n}\nfragment T on FlowTurn { i role chars payload }';
const B = []; const add = (id, group, text, variables, extra = {}) => B.push({ id, group, text, variables, ...extra });
add('flow-example1', 'flow', EX1, { s: 'sfixA' });
add('flow-all-noPayload', 'flow', '{ turns(session: "sfixA", first: 20) { i role chars calls tool ok } }');
add('flow-render-fixture-full', 'flow', '{ turns(session: "s_fix_a", first: 10) @payload(mode: "full") { i role payload } }');
add('flow-tool-turns', 'flow', '{ turns(session: "sfixA", role: "tool") { i tool ok } }');
add('flow-long-summary', 'flow', '{ turns(session: "slong", first: 20) { i role chars payload } }');
add('flow-long-ids', 'flow', '{ turns(session: "slong", first: 40) { i role chars } }');
add('flow-long-page1', 'flow', '{ turns(session: "slong", first: 10) { i role chars } }');
add('flow-long-full-bounded', 'flow', '{ turns(session: "slong", first: 6) @payload(mode: "full", max: 2000) { i role payload } }');
add('flow-aliases', 'flow', '{ a: turns(session: "sfixA", first: 2) { i role } b: turns(session: "sfixB", first: 2) { i role } }');
add('flow-fragment-vars', 'flow', 'query R($s: ID!, $r: String = "assistant") { turns(session: $s, role: $r, first: 5) { ...F } } fragment F on FlowTurn { i chars calls }', { s: 'slong' });
add('flow-skip-include', 'flow', 'query K($p: Boolean!) { turns(session: "sfixA", first: 3) { i role payload @include(if: $p) chars @skip(if: $p) } }', { p: false });
add('flow-reduce-lines', 'flow', '{ turns(session: "slong", first: 4) @payload(mode: "full") @reduce(with: "lines", head: 2, tail: 1) { i payload } }');
add('session-one', 'flow', '{ session(id: "slong") { id title msgs requests payload } }');
add('sessions-list', 'flow', '{ sessions { id title msgs requests } }');
add('ledger-sfixA', 'harness', '{ ledger(session: "sfixA") { n model strat prompt cached cacheWrite completion cost } }');
add('ledger-long', 'harness', '{ ledger(session: "slong", first: 12) { n prompt cached completion reasoning cost } }');
add('checkpoints', 'harness', '{ checkpoints(session: "sfixA") { id kind len writes writeTokens reads readTokens } }');
add('trail-shell', 'harness', '{ trail(tool: "shell") { n tool ok chars why } }');
add('trail-all', 'harness', '{ trail(first: 25) { n tool via ok chars why ms } }');
add('concepts-hyp-idname', 'catalog', '{ concepts(status: "hypothesis", first: 10) { id name since } }');
add('concepts-hyp-payload', 'catalog', '{ concepts(status: "hypothesis", first: 10) { id name payload } }');
add('concepts-full-5', 'catalog', '{ concepts(first: 5) @payload(mode: "full") { id status payload } }');
add('concepts-by-model', 'catalog', '{ concepts(model: "qwen/qwen3.7-flash", first: 10) { id name status } }');
add('concepts-first100', 'catalog', '{ concepts(first: 100) { id } }');
add('concepts-range-labels', 'catalog', '{ concepts(first: 20) @labels(as: "range") { id } }');
add('concepts-inline-labels', 'catalog', '{ concepts(first: 8) @labels(as: "inline") { id name } }');
add('concepts-reduce-clip', 'catalog', '{ concepts(first: 10) @reduce(with: "clip", max: 60) { id payload } }');
add('concepts-norefs', 'catalog', '{ concepts(first: 10) @refs(ops: []) { id name status since supersedes nmodels } }');
add('faults-common', 'catalog', '{ faults(class: "common", first: 10) { id model class payload } }');
add('faults-by-model', 'catalog', '{ faults(model: "qwen/qwen3.7-flash") { id class seen payload } }');
add('terms-handle', 'catalog', '{ terms(match: "handle") { id term since payload } }');
add('multi-root', 'catalog', '{ c: concepts(status: "measured", first: 3) { id name } f: faults(first: 3) { id model } t: terms(first: 3) { id term } s: turns(session: "sfixB") { i role } }');
add('handle-audit', 'handle', 'query H($h: ID!) { handle(id: $h) { id kind owner t readers payload } audit(id: $h, first: 2) { t reader h } }', { h: 'km7q2x' });
add('handle-meta-only', 'handle', '{ handle(id: "ab3dd9") { id kind owner t } }');
add('audit-page', 'handle', '{ audit(id: "km7q2x", first: 1) { n t reader h } }');
add('note-settable', 'scratch', '{ notes { id title status } }');
add('synopsis', 'meta', '{ __synopsis }');
add('mat-turn-text-first', 'materialized', '{ rendered(session: "sfixA", first: 3) { i payload } }');
add('mat-turn-text-always', 'materialized', '{ rendered(session: "sfixA", first: 3) @descriptor(mode: "always") { i payload } }');
add('mat-turn-text-off', 'materialized', '{ rendered(session: "sfixA", first: 3) @descriptor(mode: "off") { i payload } }');
add('mat-turn-text-prefaced', 'materialized', '{ rendered(session: "sfixA", first: 3) { i payload } }', undefined, { opts: { prefaced: ['turn-text'] } });
add('policy-verbose-false', 'policy', '{ turns(session: "slong", first: 4) @payload(mode: "full") { i payload } }', undefined, { opts: { policy: { id: 'lean', rev: 1, verbose: false } } });
add('policy-headerAttrs-changed', 'policy', '{ concepts(status: "hypothesis", first: 10) { id name since } }', undefined, { opts: { policy: { id: 'terse', rev: 1, headerAttrs: 'changed' } } });
add('policy-deny-set', 'policy', '{ notes { id title status } }', undefined, { opts: { policy: { id: 'ro', rev: 1, deny: ['set'] } } });
// deliberate errors (OQ1: parse and validate shapes)
add('err-parse-brace', 'error', '{ turns(session: "sfixA", first: 2) { i role }');
add('err-parse-mutation', 'error', 'mutation { turns { i } }');
add('err-parse-inline-fragment', 'error', '{ turns(session: "sfixA") { ... on FlowTurn { i } } }');
add('err-parse-empty-selection', 'error', '{ turns(session: "sfixA") { } }');
add('err-unknown-field', 'error', '{ turns(session: "sfixA", first: 2) { i rol } }');
add('err-three-faults', 'error', '{ turns(session: "sfixA", frist: 2) { i rol } nope { id } }');
add('err-missing-variable', 'error', 'query V($s: ID!) { turns(session: $s) { i } }');
add('err-limit-first', 'error', '{ concepts(first: 500) { id } }');
add('err-payload-denied', 'error', '{ concepts(first: 1) @payload(mode: "none") { id payload } }');
add('err-unknown-reducer', 'error', '{ concepts(first: 1) @reduce(with: "stripe") { id payload } }');
add('err-type-mismatch', 'error', '{ turns(session: 7, first: "two") { i } }');
add('err-unknown-session', 'error', '{ turns(session: "nope") { i } }');
add('err-payload-not-gettable', 'error', '{ ledger(session: "sfixA") { n payload } }');
add('err-multiple-operations', 'error', 'query A { sessions { id } } query B { sessions { id } }');
add('err-introspection', 'error', '{ __schema { types { name } } }');

// header parts and sizes of a result
const partsOf = h => { const sz = k => (k in h ? J(k).length + 1 + J(h[k]).length + 1 : 0), p = {}; p.attrs = sz('attrs') + sz('src') + sz('policy'); p.kinds = sz('kinds'); p.refs = sz('refs'); p.pages = sz('pages'); p.reducers = sz('reducers'); p.dropped = sz('dropped'); p.base = J(h).length - Object.values(p).reduce((a, b) => a + b, 0); return p; };
const sizes = r => {
  const h = J(r.header), d = r.data === undefined ? '' : J(r.data), e = r.errors ? J(r.errors) : '';
  return { header: h.length, data: d.length, errChars: e.length, total: h.length + d.length + e.length, hTok: tok(h), dTok: tok(d), eTok: tok(e), tTok: tok(h + d + e) };
};
const refsOf = h => { const rows = h.refs || [], labels = rows.reduce((a, r) => a + (r.labels ? r.labels.length : 0), 0); return { rows: rows.length, ops: rows.map(r => r.op + (r.names ? '[' + r.names.length + ']' : r.labels ? '(' + r.labels.length + ')' : '(all)')).join(' '), explicitLabels: labels, chars: h.refs ? J(h.refs).length : 0 }; };
const norm = r => J({ ...r, header: { ...r.header, q: 'qN' } });

async function runOne(b, rep = 1) {
  const times = []; let first;
  for (let k = 0; k < rep; k++) {
    const { S } = mk(b.opts || {});
    const t0 = performance.now(), r = await S.run(b.text, { variables: b.variables });
    times.push(performance.now() - t0); first ??= r;
  }
  return { r: first, ms: median(times) };
}

const rows = [];
let detOk = 0, detTotal = 0;
for (const b of B) {
  const { r, ms } = await runOne(b, 5);
  const again = (await runOne(b, 1)).r;                // fresh surface, same input
  const sameSurface = mk(b.opts || {}).S; const a1 = await sameSurface.run(b.text, { variables: b.variables }), a2 = await sameSurface.run(b.text, { variables: b.variables });
  const detFresh = J(r) === J(again), detRerun = norm(a1) === norm(a2) && a2.header.q === 'q2';
  detTotal += 2; detOk += detFresh + detRerun;
  const s = sizes(r), codes = (r.errors || []).map(e => e.extensions.code + '/' + e.extensions.stage);
  rows.push({ id: b.id, group: b.group, queryChars: b.text.length, ok: r.header.ok, errors: codes, count: r.header.count ?? null, ...s, share: s.header / s.total, ...(r.header.ok ? { parts: partsOf(r.header), refs: refsOf(r.header) } : {}), ms: Number(ms.toFixed(3)), hash: hash(J(r)), detFresh, detRerun });
}

// ------------------------------------------------------------------ summaries
const okRows = rows.filter(r => r.ok), flat = a => a.reduce((x, r) => x + r.total, 0);
const dataRows = okRows.filter(r => r.data > 0 && r.group !== 'materialized');
const share = a => a.reduce((x, r) => x + r.header, 0) / a.reduce((x, r) => x + r.total, 0);
const byGroup = Object.fromEntries([...new Set(rows.map(r => r.group))].map(g => { const a = rows.filter(r => r.group === g); return [g, { n: a.length, headerTok: a.reduce((x, r) => x + r.hTok, 0), resultTok: a.reduce((x, r) => x + r.tTok, 0), share: Number(share(a).toFixed(3)), under25: a.filter(r => r.share < 0.25).length }]; }));
const partTotals = {}; for (const r of okRows) for (const [k, v] of Object.entries(r.parts)) partTotals[k] = (partTotals[k] || 0) + v;
const headerAll = okRows.reduce((x, r) => x + r.header, 0);
const summary = {
  queries: rows.length, ok: okRows.length, failed: rows.length - okRows.length,
  headerShareOkAll: Number(share(okRows).toFixed(3)), headerShareWithData: Number(share(dataRows).toFixed(3)),
  queriesUnder25pct: okRows.filter(r => r.share < 0.25).length, okQueries: okRows.length,
  headerTokensOk: okRows.reduce((x, r) => x + r.hTok, 0), resultTokensOk: okRows.reduce((x, r) => x + r.tTok, 0),
  headerPartShares: Object.fromEntries(Object.entries(partTotals).map(([k, v]) => [k, Number((v / headerAll).toFixed(3))])),
  medianMs: median(rows.map(r => r.ms)), maxMs: Math.max(...rows.map(r => r.ms)),
  determinism: { checks: detTotal, identical: detOk, freshSurfaceIdentical: rows.filter(r => r.detFresh).length + '/' + rows.length, rerunDiffers: rows.filter(r => !r.detRerun).map(r => r.id), rerunReason: 'expected state: a second run on one surface sees changed state (the once-only kind descriptor is not resent; the first handle payload read appended an audit row, so the audit total grows); a fresh surface is byte-identical' },
};

// headerAttrs "changed" (H7) over the same battery, for the OQ14 alternative
{
  let h = 0, t = 0;
  for (const b of B.filter(x => !x.opts && x.group !== 'error')) { const { S } = mk({ policy: { id: 'terse', rev: 1, headerAttrs: 'changed' } }); const r = await S.run(b.text, { variables: b.variables }); if (!r.header.ok) continue; const s = sizes(r); h += s.header; t += s.total; }
  summary.headerShareHeaderAttrsChanged = Number((h / t).toFixed(3));
}

// the three worked examples of QUERY.md 2.4 (OQ14 names them)
const examples = {};
for (const [id, text, v] of [['ex1-flow-turns', EX1, { s: 'sfixA' }], ['ex2-concepts', '{ concepts(status: "hypothesis", first: 2) { id name since } }'], ['ex3-handles', 'query H($h: ID!) { handle(id: $h) { id kind owner t readers payload } audit(id: $h, first: 2) { t reader h } }', { h: 'km7q2x' }]]) {
  const { S } = mk(); const r = await S.run(text, { variables: v }), s = sizes(r); examples[id] = { headerTok: s.hTok, dataTok: s.dTok, share: Number((s.header / s.total).toFixed(3)) };
}

// ------------------------------------------------------------------ OQ7: descriptor cost, first vs later, and the preface synopsis
const desc = {};
{
  const { S } = mk(); const syn = S.synopsis();
  desc.synopsis = { chars: syn.length, tokens: tok(syn), note: 'the preface bytes (surface.synopsis()), sent once per session, not part of any header' };
  desc.descriptorText = { chars: DESC.length, tokens: tok(DESC) };
  const Q = '{ rendered(session: "sfixA", first: 3) { i payload } }', N = 10;
  for (const mode of ['first', 'always', 'off', 'prefaced']) {
    const { S: s } = mk({ prefaced: mode === 'prefaced' ? ['turn-text'] : undefined });
    const q = mode === 'always' || mode === 'off' ? Q.replace('{ i payload }', `@descriptor(mode: "${mode}") { i payload }`).replace('first: 3)', 'first: 3)') : Q;
    const q2 = mode === 'always' || mode === 'off' ? `{ rendered(session: "sfixA", first: 3) @descriptor(mode: "${mode}") { i payload } }` : Q;
    const t = []; for (let i = 0; i < N; i++) t.push(sizes(await s.run(q2, {})).hTok);
    desc[mode] = { perQueryHeaderTokens: t, total: t.reduce((a, b) => a + b, 0), first: t[0], later: t[1] };
  }
  desc.forkReSends = 'a new surface instance re-sends the descriptor (OQ7 decision); measured: the first run of a fresh surface carries it again (see "first" row of each mk())';
  desc.savingFirstVsAlways = desc.always.total - desc.first.total;
  desc.laterVsFirstDelta = desc.first.first - desc.first.later;
}

// ------------------------------------------------------------------ Q15-Q17 ref ops, every refusal path, expiry
const refBattery = [];
async function step(name, surf, fn) {
  const before = { ...surf.calls }, r = await fn(surf.S);
  const adapterCalls = { fn: surf.calls.fn - before.fn, set: surf.calls.set - before.set };
  const e = r.errors?.[0];
  refBattery.push({ step: name, ok: r.header.ok, code: e?.extensions.code ?? null, stage: e?.extensions.stage ?? null, message: e?.message ?? null, dataChars: r.data === undefined ? 0 : J(r.data).length, reducer: r.header.reducer ? true : false, adapterFnCalls: adapterCalls.fn, adapterSetCalls: adapterCalls.set, headerTok: tok(J(r.header)), resultTok: tok(J(r)) });
  return r;
}
{
  const m = mk();
  await m.S.run('{ turns(session: "slong", first: 20) { i role chars payload } }');                          // q1: t14 is the 30000-char result; payload clipped for t14 only
  await step('get declared (I2 clipped label t14)', m, S => S.ref('q1/t14', { op: 'get' }));
  await step('get on a clipped label t3 (declared)', m, S => S.ref('q1/t3', { op: 'get' }));
  await step('get on a fit label t0 (not declared, REF_NOT_DECLARED)', m, S => S.ref('q1/t0', { op: 'get' }));
  await step('property not selected -> declared (I3) calls', m, S => S.ref('q1/t1', { op: 'property', name: 'calls' }));
  await step('property selected (not declared)', m, S => S.ref('q1/t1', { op: 'property', name: 'role' }));
  await step('property bad name', m, S => S.ref('q1/t1', { op: 'property', name: 'foo' }));
  await step('property no name', m, S => S.ref('q1/t1', { op: 'property' }));
  await step('set on a non-settable kind', m, S => S.ref('q1/t1', { op: 'set', name: 'tool', value: 'x' }));
  await step('unknown op', m, S => S.ref('q1/t1', { op: 'delete' }));
  await step('format: no slash', m, S => S.ref('t1', { op: 'get' }));
  await step('format: empty', m, S => S.ref('', { op: 'get' }));
  await step('unknown query', m, S => S.ref('q9/t1', { op: 'get' }));
  await step('unknown label', m, S => S.ref('q1/t99', { op: 'get' }));
  const m2 = mk();
  await m2.S.run('{ notes { id title status } }');                                                              // q1: settable status selected -> I4 set[status]; payload unselected -> I1 get
  await step('set declared (I4) ok', m2, S => S.ref('q1/n1', { op: 'set', name: 'status', value: 'closed', why: 'closing the note' }));
  await step('set without value', m2, S => S.ref('q1/n1', { op: 'set', name: 'status' }));
  await step('set a prop not declared', m2, S => S.ref('q1/n1', { op: 'set', name: 'title', value: 'x' }));
  await step('get on a failing source (REF_SOURCE)', m2, S => S.ref('q1/boom', { op: 'get' }));
  await step('get declared (I1) note body', m2, S => S.ref('q1/n1', { op: 'get' }));
  m2.policy.deny = ['set'];                                                                                    // live policy read at ref time (R7)
  await step('set after policy deny (REF_POLICY)', m2, S => S.ref('q1/n1', { op: 'set', name: 'status', value: 'open' }));
  const m3 = mk({ policy: { id: 'why', rev: 1, requireWhy: ['get', 'set'] } });
  await m3.S.run('{ notes { id title status } }');
  await step('requireWhy: get without why', m3, S => S.ref('q1/n1', { op: 'get' }));
  await step('requireWhy: get with why', m3, S => S.ref('q1/n1', { op: 'get', why: 'reading the note to answer the question' }));
  // get cap: the 30000-char payload through a policy-free get is cut at getMax with the clip marker, no continuation op exists
  const m4 = mk();
  await m4.S.run('{ turns(session: "slong", first: 20) { i payload } }');
  const big = await step('get 30000-char turn (cap getMax 12000)', m4, S => S.ref('q1/t14', { op: 'get' }));
  refBattery[refBattery.length - 1].dataChars = J(big.data).length;
  const m5 = mk({ policy: { id: 'lean', rev: 1, verbose: false } });
  await m5.S.run('{ turns(session: "slong", first: 20) { i payload } }');
  await step('get under verbose:false (cap = summary max 200)', m5, S => S.ref('q1/t14', { op: 'get' }));
  // handle payload get goes through resolve(id, reader) and is audited (Q22)
  const m6 = mk();
  await m6.S.run('{ handle(id: "km7q2x") { id kind } }');
  const a0 = m6.handles.audit().length;
  await step('get handle payload (audited)', m6, S => S.ref('q1/km7q2x', { op: 'get' }));
  refBattery[refBattery.length - 1].handleAuditRowsAdded = m6.handles.audit().length - a0;
  // expiry: queries scope
  const m7 = mk();
  await m7.S.run('{ turns(session: "sfixA", first: 2) { i role } }');                                         // q1 scope queries 8
  for (let i = 0; i < 8; i++) await m7.S.run('{ sessions { id } }');                                          // q2..q9: q1 is 8 behind
  await step('queries scope: q1 after 8 later queries still valid', m7, S => S.ref('q1/t0', { op: 'property', name: 'chars' }));
  await m7.S.run('{ sessions { id } }');                                                                       // q10: 9 later
  await step('queries scope: q1 after 9 later queries expired', m7, S => S.ref('q1/t0', { op: 'property', name: 'chars' }));
  await step('queries scope: q10 still valid', m7, S => S.ref('q10/sfixA', { op: 'property', name: 'msgs' }));
  const m8 = mk();
  await m8.S.run('{ turns(session: "sfixA", first: 2) @scope(ticks: 2) { i role } }');
  m8.S.tick(); m8.S.tick();
  await step('ticks scope: 2 ticks valid', m8, S => S.ref('q1/t0', { op: 'property', name: 'chars' }));
  m8.S.tick();
  await step('ticks scope: 3 ticks expired', m8, S => S.ref('q1/t0', { op: 'property', name: 'chars' }));
  const m9 = mk({ policy: { id: 'sf', rev: 1, defaults: { scope: 'surface' } } });
  await m9.S.run('{ turns(session: "sfixA", first: 2) { i role } }');
  for (let i = 0; i < 30; i++) { await m9.S.run('{ sessions { id } }'); m9.S.tick(); }
  await step('surface scope: valid after 30 queries and ticks', m9, S => S.ref('q1/t0', { op: 'property', name: 'chars' }));
  const other = mk(); await step('another surface instance: unknown query', other, S => S.ref('q1/t0', { op: 'get' }));
  // audit: one row per run and per ref, hash and no text
  const au = m2.S.audit();
  refBattery.audit = { rows: au.length, hasText: au.some(r => Object.values(r).some(v => typeof v === 'string' && v.length > 40)), keys: [...new Set(au.flatMap(r => Object.keys(r)))] };
}
const refSummary = {
  steps: refBattery.length,
  codes: Object.fromEntries([...new Set(refBattery.map(s => s.code).filter(Boolean))].sort().map(c => [c, refBattery.filter(s => s.code === c).length])),
  allCodesOfSpec: ['REF_FORMAT', 'REF_UNKNOWN_QUERY', 'REF_EXPIRED', 'REF_UNKNOWN_LABEL', 'REF_NOT_DECLARED', 'REF_BAD_NAME', 'REF_BAD_VALUE', 'REF_POLICY', 'REF_SOURCE'],
  refusalsCalledAdapter: refBattery.filter(s => !s.ok && (s.adapterFnCalls || s.adapterSetCalls) && s.code !== 'REF_SOURCE').length,
  oks: refBattery.filter(s => s.ok).length,
};
refSummary.exercised = refSummary.allCodesOfSpec.filter(c => c in refSummary.codes);
refSummary.notExercised = refSummary.allCodesOfSpec.filter(c => !(c in refSummary.codes));

// ------------------------------------------------------------------ versus the existing read route (output_read / entry_read)
// Same need, same data. Old route: the data stored as an output and read with the real `slice` of app/outstore.js (output_read default
// route, 3000-char slices, find: matching lines cut at 300 chars, 60 hits) and entry_read transcript (4000 chars). Oracle offsets are given to the
// old route (best case: it knows where to look). New route: the query plus the ref it needs, header included.
const cmp = [];
const lineText = a => a.map(x => J(x)).join('\n');
const argOf = o => J(o).length;
async function newRoute(steps) {
  const { S } = mk(); let bytes = 0, calls = 0, argChars = 0, results = [];
  for (const st of steps) { const r = st.q ? await S.run(st.q, { variables: st.v }) : await S.ref(typeof st.ref === 'function' ? st.ref(results) : st.ref, st.o); calls++; argChars += st.q ? st.q.length : J(st.o).length + 8; bytes += J(r).length; results.push(r); }
  return { bytes, tokens: tok('x'.repeat(bytes)), calls, argChars, last: results[results.length - 1] };
}
const old = (calls, ...outs) => ({ bytes: outs.join('').length, tokens: tok(outs.join('')), calls, argChars: calls * 60 });
{
  const conc = RAW.concepts, find = s => slice(conc, { find: s });
  // C1 hypothesis concept ids and names, 10 wanted
  const o1 = find('"status": "hypothesis"'), n1 = await newRoute([{ q: '{ concepts(status: "hypothesis", first: 10) { id name since } }' }]);
  const stale = CAT.concepts.filter(c => c.status === 'hypothesis').length, current = 80;
  cmp.push({ need: 'C1 ids and names of 10 hypothesis concepts', old: { ...old(1, o1), via: 'output_read find "status": "hypothesis" on concepts.jsonl (all matching lines, up to 60, cut at 300 chars; includes superseded records)' }, new: { bytes: n1.bytes, tokens: n1.tokens, calls: n1.calls, argChars: n1.argChars, via: 'query first:10 {id name since}' }, note: 'old returns ' + (o1.split('\n').length) + ' hits of ' + stale + ' matching lines (some superseded); new returns the 10 asked, current view only' });
  // C2 claim of one concept: the first listed
  const id2 = CAT.concepts.find(c => c.status === 'hypothesis').id, o2 = find('"id": "' + id2 + '"');
  const n2 = await newRoute([{ q: '{ concepts(status: "hypothesis", first: 3) { id name } }' }, { ref: 'q1/' + id2, o: { ref: 'q1/' + id2, op: 'get' } }]);
  const full = RAW.concepts.split('\n').find(l => l.includes('"id": "' + id2 + '"'));
  cmp.push({ need: 'C2 the claim of one concept (id ' + id2 + ')', old: { ...old(1, o2), via: 'output_read find "id":"<id>" (one line cut at 300 chars)' }, new: { bytes: n2.bytes, tokens: n2.tokens, calls: n2.calls, argChars: n2.argChars, via: 'query listing then ref get' }, note: 'old line is ' + full.length + ' chars in the file, returned ' + o2.length + (full.length > 300 ? ' (cut: claim may be truncated)' : ''), oldCutsClaim: full.length > 300 });
  // C3 text of one turn of slong (turn 6: a tool result of some 2400 chars), oracle offsets for the old route
  const lines = slong.messages.map(m => J(m)), whole = lines.join('\n'), tn = 6, off = lines.slice(0, tn).reduce((a, l) => a + l.length + 1, 0), tl = lines[tn].length;
  const o3d = slice(whole, { offset: off }), o3e = slice(whole, { offset: off, length: Math.min(4000, tl) });
  const n3 = await newRoute([{ q: '{ turns(session: "slong", first: 8) { i role chars } }' }, { ref: 'q1/t' + tn, o: { ref: 'q1/t' + tn, op: 'get' } }]);
  cmp.push({ need: 'C3 the text of turn ' + tn + ' of slong (' + tl + ' chars as a stored line)', old: { ...old(1, o3d), via: 'output_read slice, default length 3000, oracle offset' }, oldTight: { ...old(1, o3e), via: 'output_read slice with exact length (needs the model to know it)' }, new: { bytes: n3.bytes, tokens: n3.tokens, calls: n3.calls, argChars: n3.argChars, via: 'turns listing (i role chars, 8 turns) then ref get' }, note: 'the old route needs a character offset it does not have; new route finds the turn by label' });
  // C4 held / failed calls in sfixA
  const sA = MET.sessions[0], aLines = sA.messages.map(m => J(m)).join('\n'), o4 = slice(aLines, { find: 'Not run' }), o4b = slice(aLines, { find: 'Tool error' });
  const n4 = await newRoute([{ q: '{ turns(session: "sfixA", role: "tool") { i tool ok } }' }]);
  cmp.push({ need: 'C4 which tool calls in sfixA failed or were held', old: { ...old(2, o4, o4b), via: 'two output_read finds ("Not run", "Tool error") on the stored transcript' }, new: { bytes: n4.bytes, tokens: n4.tokens, calls: n4.calls, argChars: n4.argChars, via: 'one query turns(role: "tool") {i tool ok}' }, note: 'old returns whole turn lines (cut at 300), new returns the ok flag per tool turn, which carries both cases' });
  // C5 trail rows of tool shell that failed
  const tText = TRAIL.map((r, i) => J({ n: i + 1, ...r })).join('\n'), o5 = slice(tText, { find: '"tool":"shell"' });
  const n5 = await newRoute([{ q: '{ trail(tool: "shell") { n ok chars why } }' }]);
  cmp.push({ need: 'C5 shell trail rows with ok and why', old: { ...old(1, o5), via: 'output_read find "tool":"shell" on the trail text' }, new: { bytes: n5.bytes, tokens: n5.tokens, calls: n5.calls, argChars: n5.argChars, via: 'query trail(tool) {n ok chars why}' } });
  // C6 ledger cost columns
  const lText = slong.ledger.map((r, i) => J({ n: i + 1, ...r })).join('\n'), o6 = slice(lText, { find: '"model"' });
  const n6 = await newRoute([{ q: '{ ledger(session: "slong", first: 12) { n prompt cached completion cost } }' }]);
  cmp.push({ need: 'C6 prompt, cached, completion, cost for 12 ledger rows', old: { ...old(1, o6), via: 'output_read find "model" on the ledger text (whole rows)' }, new: { bytes: n6.bytes, tokens: n6.tokens, calls: n6.calls, argChars: n6.argChars, via: 'query ledger {n prompt cached completion cost}' } });
  // C7 faults of one model with text
  const o7 = slice(RAW.faults, { find: '"model": "qwen/qwen3.7-flash"' });
  const n7 = await newRoute([{ q: '{ faults(model: "qwen/qwen3.7-flash") { id class seen payload } }' }]);
  cmp.push({ need: 'C7 faults of qwen/qwen3.7-flash with the fault text', old: { ...old(1, o7), via: 'output_read find on faults.jsonl' }, new: { bytes: n7.bytes, tokens: n7.tokens, calls: n7.calls, argChars: n7.argChars, via: 'query faults(model) {id class seen payload} (summary clip 200)' } });
  // C8 the full text of the 30000-char turn
  const big = slong.messages[14].content, entry = { v: 1, text: big };
  const oE = entry.text.length > 4000 ? entry.text.slice(0, 4000) + `\n[${entry.text.length - 4000} chars more]` : entry.text;
  let slices = '', n = 0; for (let o = 0; o < big.length; o += 4000) { slices += slice(big, { offset: o }); n++; }
  const n8 = await newRoute([{ q: '{ turns(session: "slong", first: 20) { i } }' }, { ref: 'q1/t14', o: { ref: 'q1/t14', op: 'get' } }]);
  cmp.push({ need: 'C8 the whole of one ' + big.length + '-char turn', old: { ...old(n, slices), via: 'output_read slices of 4000 chars until the end (' + n + ' calls)' }, oldEntryRead: { bytes: oE.length, tokens: tok(oE), calls: 1, via: 'entry_read part transcript (4000 chars then a remainder note)' }, new: { bytes: n8.bytes, tokens: n8.tokens, calls: n8.calls, argChars: n8.argChars, via: 'listing then ref get (cap getMax 12000, no continuation op)' }, note: 'new route cannot reach chars past getMax: returned ' + J(n8.last.data).length + ' of ' + big.length + ' (reaches the whole: no; old route reaches the whole: yes)', newReachesWhole: false });
}
for (const c of cmp) { c.ratioNewToOld = Number((c.new.bytes / c.old.bytes).toFixed(2)); c.newTokensSaved = c.old.tokens - c.new.tokens; }
const cmpTotal = { oldTok: cmp.reduce((a, c) => a + c.old.tokens, 0), newTok: cmp.reduce((a, c) => a + c.new.tokens, 0) };

// ------------------------------------------------------------------ reducers: same query, same data, one reducer each (cejwzy)
const reducerRows = [];
for (const [name, dec] of [['none', '@reduce(with: "none")'], ['clip 200', '@reduce(with: "clip", max: 200)'], ['clip 60', '@reduce(with: "clip", max: 60)'], ['lines 2+1', '@reduce(with: "lines", head: 2, tail: 1)'], ['omit', '@reduce(with: "omit")']]) {
  const { S } = mk({ harnessOnly: true }); const r = await S.run('{ turns(session: "slong", first: 12) @payload(mode: "full") ' + dec + ' { i payload } }'), z = sizes(r);
  reducerRows.push({ reducer: name, ok: r.header.ok, dataTok: z.dTok, headerTok: z.hTok, namedInHeader: !!(r.header.reducers && r.header.reducers.length) || /reduc/.test(J(r.header.attrs || {})), reducerRowsChars: r.header.reducers ? J(r.header.reducers).length : 0, errors: (r.errors || []).map(e => e.extensions.code) });
}
// ------------------------------------------------------------------ error shapes (OQ1: what a model sees on a bad query)
const errorShapes = rows.filter(r => r.group === 'error').map(r => ({ id: r.id, codes: r.errors, headerChars: r.header, resultTok: r.tTok }));
const errMsgs = {};
for (const b of B.filter(x => x.group === 'error')) { const { S } = mk(); const r = await S.run(b.text, { variables: b.variables }); errMsgs[b.id] = (r.errors || []).map(e => ({ message: e.message, code: e.extensions.code, stage: e.extensions.stage, loc: e.locations?.[0] ?? null })); }

// ------------------------------------------------------------------ write
const out = {
  date: DATE, script: 'scripts/measure-query.mjs', node: process.version, tokenEstimate: 'ceil(chars/4)', headSha: SHA,
  sources: { sessions: SESSIONS.map(s => ({ id: s.id, turns: s.messages.length, from: s.id === 'slong' ? 'synthetic (in-script, deterministic)' : s.id.startsWith('sfix') ? 'scripts/fixtures/metrics-sessions.json' : 'scripts/fixtures/render-sessions.json' })), catalog: { concepts: CAT.concepts.length, faults: CAT.faults.length, terms: CAT.terms.length, read: 'catalog/*.jsonl at run time' }, trailRows: TRAIL.length, handles: 'synthetic (km7q2x stem, ab3dd9 checkpoint)', extraAdapter: 'scratch: settable note, failing note, materialized turn-text (in-script)' },
  summary, byGroup, examples, descriptor: desc, refBattery, refSummary, reducerRows, comparison: { items: cmp, total: cmpTotal }, errorMessages: errMsgs, battery: rows,
};
const dir = path.join(ROOT, 'docs/concepts/results'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `query-det-${DATE}${TAG}.json`), J(out, null, 1) + '\n');

const f = (x, d = 2) => (typeof x === 'number' ? x.toFixed(d) : x);
const md = [
  `# Query surface: deterministic measurement (${DATE})`, '',
  `Script \`scripts/measure-query.mjs\` (no model, no network). Tokens = ceil(chars/4). Data: sessions ${SESSIONS.map(s => s.id).join(', ')} (fixtures and one synthetic long session), live \`catalog/*.jsonl\` (${CAT.concepts.length} concept lines, ${CAT.faults.length} faults, ${CAT.terms.length} terms), synthetic handles, trail, one scratch adapter (settable note, materialized turn-text). Raw: \`query-det-${DATE}.json\`.`, '',
  `## Headline`, '',
  `- Battery: ${summary.queries} queries (${summary.ok} ok, ${summary.failed} deliberate errors). Determinism: ${summary.determinism.identical}/${summary.determinism.checks} byte-identical (fresh surface ${summary.determinism.freshSurfaceIdentical} identical; re-run on one surface with q normalized differs only for ${summary.determinism.rerunDiffers.join(', ')}: ${summary.determinism.rerunReason}).`,
  `- OQ14 header share of result tokens, over all ok queries: ${f(summary.headerShareOkAll * 100, 1)}%; over ok queries that return data (not the descriptor probes): ${f(summary.headerShareWithData * 100, 1)}%; with headerAttrs "changed": ${f(summary.headerShareHeaderAttrsChanged * 100, 1)}%. Target under 25%. Per query under 25%: ${summary.queriesUnder25pct}/${summary.okQueries}. The three worked examples: ${Object.entries(examples).map(([k, v]) => `${k} ${f(v.share * 100, 0)}% (${v.headerTok}/${v.headerTok + v.dataTok} tok)`).join('; ')}.`,
  `- Header parts (share of header chars, ok queries): ${Object.entries(summary.headerPartShares).map(([k, v]) => `${k} ${f(v * 100, 0)}%`).join(', ')}.`,
  `- OQ7: preface synopsis ${desc.synopsis.tokens} tok once per session; materialized descriptor ${desc.descriptorText.tokens} tok on the first query of a surface, 0 after (first-run header ${desc.first.first} tok, later ${desc.first.later} tok); over 10 queries: first ${desc.first.total}, always ${desc.always.total}, off ${desc.off.total}, prefaced ${desc.prefaced.total} tok.`,
  `- Refs (Q15-Q17): ${refSummary.steps} steps, ${refSummary.oks} ok; codes exercised ${refSummary.exercised.join(', ')}; not exercised: ${refSummary.notExercised.join(', ') || 'none'}; refusals that called the adapter: ${refSummary.refusalsCalledAdapter} (expected 0).`,
  `- Versus output_read/entry_read, same needs (oracle offsets for the old route): old ${cmpTotal.oldTok} tok, new ${cmpTotal.newTok} tok over ${cmp.length} needs.`,
  `- Time per query (median of 5, wall clock): median ${f(summary.medianMs, 2)} ms, max ${f(summary.maxMs, 2)} ms.`, '',
  '## Header share by group', '', '| group | queries | header tok | result tok | header share | queries under 25% |', '| --- | --- | --- | --- | --- | --- |',
  ...Object.entries(byGroup).map(([g, v]) => `| ${g} | ${v.n} | ${v.headerTok} | ${v.resultTok} | ${f(v.share * 100, 1)}% | ${v.under25}/${v.n} |`), '',
  '## Battery', '', '| id | group | ok | codes | header tok | data tok | share | refs rows | refs chars | ms |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.id} | ${r.group} | ${r.ok} | ${r.errors.join(' ') || '-'} | ${r.hTok} | ${r.dTok} | ${f(r.share * 100, 0)}% | ${r.refs ? r.refs.rows : '-'} | ${r.refs ? r.refs.chars : '-'} | ${f(r.ms, 2)} |`), '',
  '## Reducers (same query, slong first 12 turns, payload full)', '', '| reducer | data tok | header tok | named in header |', '| --- | --- | --- | --- |', ...reducerRows.map(r => `| ${r.reducer} | ${r.dataTok} | ${r.headerTok} | ${r.namedInHeader} |`), '', '## Ref steps (Q15-Q17)', '', '| step | ok | code | adapter fn/set calls | result tok |', '| --- | --- | --- | --- | --- |',
  ...refBattery.map(s => `| ${s.step} | ${s.ok} | ${s.code || '-'} | ${s.adapterFnCalls}/${s.adapterSetCalls} | ${s.resultTok} |`), '',
  '## Versus output_read / entry_read', '', '| need | old tok (calls) | new tok (calls) | new/old bytes | note |', '| --- | --- | --- | --- | --- |',
  ...cmp.map(c => `| ${c.need} | ${c.old.tokens} (${c.old.calls}) | ${c.new.tokens} (${c.new.calls}) | ${c.ratioNewToOld} | ${(c.note || '').replace(/\|/g, '/')} |`), '',
];
fs.writeFileSync(path.join(dir, `query-det-${DATE}${TAG}.md`), md.join('\n') + '\n');
console.log(md.slice(0, 14).join('\n'));
