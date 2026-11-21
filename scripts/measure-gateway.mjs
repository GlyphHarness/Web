// Claude route, step 5 (deterministic part only): measurements of the gateway core `app/claude-gateway.js`.
// Plain node: no network, no model, no key, no browser. Synthetic Messages streams and request bodies from a seeded PRNG.
// Run: node scripts/measure-gateway.mjs [--quick] [--date YYYY-MM-DD] [--out docs/concepts/results]
//   --quick  skips the 1 MB streams and the long memory stream (debugging only; the committed result is a full run).
// Writes <out>/gateway-det-<date>.json and .md. The JSON has three parts:
//   deterministic: sweeps, invariants, counts, hashes. Same input, same bytes (the script hashes it twice and says so).
//   determinism:   the two hashes.
//   indicative:    wall clock (process.hrtime) and heap numbers. Machine and load dependent; never compared as a pass/fail.
// What is NOT measured here (needs a real Claude Code and a key in a container): see "unmeasured" in the output.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import('../app/claude-gateway.js');
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const QUICK = flag('quick');
const DATE = opt('date', new Date().toISOString().slice(0, 10));
const OUT = path.resolve(ROOT, opt('out', 'docs/concepts/results'));

// ---------------------------------------------------------------- small helpers
const J = v => JSON.stringify(v);
const eq = (a, b) => isDeepStrictEqual(a, b);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hr = () => Number(process.hrtime.bigint()) / 1e6; // ms
const r3 = x => Math.round(x * 1000) / 1000;
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const clone = v => structuredClone(v);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const pick = (r, a) => a[Math.floor(r() * a.length)];
const stripCc = v => Array.isArray(v) ? v.map(stripCc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'cache_control').map(([k, x]) => [k, stripCc(x)])) : v;

// a tally: named checks with run count, fail count and up to three failing samples
function mkTally() {
  const t = {};
  const f = (name, ok, sample) => { const c = t[name] || (t[name] = { run: 0, fail: 0, samples: [] }); c.run++; if (!ok) { c.fail++; if (c.samples.length < 3) c.samples.push(String(sample ?? '').slice(0, 300)); } return ok; };
  f.out = () => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.samples.length ? v : { run: v.run, fail: v.fail }]));
  f.sum = () => Object.values(t).reduce((a, v) => ({ run: a.run + v.run, fail: a.fail + v.fail }), { run: 0, fail: 0 });
  return f;
}

// ---------------------------------------------------------------- synthetic Messages streams (deterministic)
const WORDS = ['the', 'of', 'file', 'read', 'let', 'me', 'check', 'answer', 'is', 'a', 'tool', 'call', 'output', 'plan', 'step', 'done', 'café', '日本語', 'naïve', '🙂'];
const words = (r, n) => { let s = ''; while (s.length < n) s += pick(r, WORDS) + ' '; return s.slice(0, n); };
const DELTA = { text_delta: ['text', 'text'], thinking_delta: ['thinking', 'thinking'], input_json_delta: ['tool_use', 'partial_json'] };

function genStream(spec) {
  const r = rng(spec.seed), ev = [];
  const mix = { text: [0, 1, 0], mixed: [.35, .4, .25], longthink: [.9, .08, .02], small: [.35, .4, .25] }[spec.kind];
  const avg = spec.kind === 'small' ? 1 : 24;
  const cut = s => { const o = []; for (let i = 0; i < s.length;) { const n = avg === 1 ? 1 : 1 + Math.floor(r() * (2 * avg - 1)); o.push(s.slice(i, i + n)); i += n; } return o; };
  const part = x => Math.max(1, Math.round(spec.bytes * x));
  let idx = 0, chars = 0, tool = false;
  const open = (i, cb) => ev.push({ type: 'content_block_start', index: i, content_block: cb });
  const delta = (i, d) => ev.push({ type: 'content_block_delta', index: i, delta: d });
  const close = i => ev.push({ type: 'content_block_stop', index: i });
  const think = n => { const i = idx++; open(i, { type: 'thinking', thinking: '', signature: '' }); for (const c of cut(words(r, n))) { chars += c.length; delta(i, { type: 'thinking_delta', thinking: c }); } delta(i, { type: 'signature_delta', signature: 'sig-synthetic-' + i }); close(i); };
  const text = n => { const i = idx++; open(i, { type: 'text', text: '' }); for (const c of cut(words(r, n))) { chars += c.length; delta(i, { type: 'text_delta', text: c }); } close(i); };
  const use = n => { tool = true; const i = idx++; open(i, { type: 'tool_use', id: 'toolu_syn_' + i, name: 'read_file', input: {} }); for (const c of cut(J({ path: '/src/a' + i + '.js', content: words(r, Math.max(1, n - 40)) }))) { chars += c.length; delta(i, { type: 'input_json_delta', partial_json: c }); } close(i); };
  ev.push({ type: 'message_start', message: { id: 'msg_syn_' + spec.seed, type: 'message', role: 'assistant', model: 'claude-synthetic', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 1 } } }, { type: 'ping' });
  if (mix[0]) think(part(mix[0]));
  text(part(mix[1]));
  if (mix[2]) { use(part(mix[2] / 2)); use(part(mix[2] / 2)); }
  ev.push({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: Math.round(chars / 3.7) } }, { type: 'message_stop' });
  return deepFreeze(ev);
}
const STREAM_SPECS = [
  ['text-1K', 'text', 1024], ['mixed-1K', 'mixed', 1024], ['longthink-1K', 'longthink', 1024], ['small-1K', 'small', 1024],
  ['small-10K', 'small', 10240], ['text-100K', 'text', 102400], ['mixed-100K', 'mixed', 102400], ['longthink-100K', 'longthink', 102400],
  ['small-100K', 'small', 102400],
  ...(QUICK ? [] : [['text-1M', 'text', 1048576], ['mixed-1M', 'mixed', 1048576], ['longthink-1M', 'longthink', 1048576]]),
];
const genAll = () => STREAM_SPECS.map(([id, kind, bytes], i) => ({ id, kind, bytes, events: genStream({ kind, bytes, seed: 1000 + i }) }));

// the independent recount of a stream: cumulative characters per kind after each event, the open block, where blocks stop
function analyse(ev) {
  const n = ev.length, A = { cumT: new Array(n), cumK: new Array(n), cumX: new Array(n), openIdx: new Array(n), ord: new Array(n), types: {}, stopAt: {}, bd: {}, deltas: 0 };
  let t = 0, k = 0, x = 0, open = null;
  for (let i = 0; i < n; i++) {
    const e = ev[i];
    if (e.type === 'content_block_start') { open = e.index; A.types[e.index] = e.content_block.type; A.bd[e.index] = 0; }
    else if (e.type === 'content_block_delta') {
      const d = DELTA[e.delta.type];
      if (d && typeof e.delta[d[1]] === 'string') { const L = e.delta[d[1]].length; if (d[0] === 'text') t += L; else if (d[0] === 'thinking') k += L; else x += L; }
      A.ord[i] = A.bd[e.index]++; A.deltas++;
    } else if (e.type === 'content_block_stop') { A.stopAt[e.index] = i; open = null; }
    A.cumT[i] = t; A.cumK[i] = k; A.cumX[i] = x; A.openIdx[i] = open;
  }
  return A;
}
const totalAt = (A, i) => A.cumT[i] + A.cumK[i] + A.cumX[i];
// a well-formed Messages stream (same rule as scripts/test-gateway.mjs)
function wellFormed(evs) {
  const types = evs.map(e => e.type);
  if (types[0] !== 'message_start') return 'no message_start first';
  if (types.at(-1) !== 'message_stop' || types.filter(t => t === 'message_stop').length !== 1) return 'message_stop not once and last';
  const md = types.indexOf('message_delta');
  if (md !== types.length - 2 || types.filter(t => t === 'message_delta').length !== 1) return 'message_delta not once and second last';
  if (typeof evs[md].delta?.stop_reason !== 'string' || !evs[md].delta.stop_reason) return 'no stop_reason';
  const open = new Set(); let next = 0;
  for (const e of evs.slice(0, md)) {
    if (e.type === 'content_block_start') { if (e.index !== next++) return 'block index ' + e.index; open.add(e.index); }
    else if (e.type === 'content_block_delta') { if (!open.has(e.index)) return 'delta outside a block ' + e.index; }
    else if (e.type === 'content_block_stop') { if (!open.delete(e.index)) return 'stop without start ' + e.index; }
  }
  return open.size ? 'open blocks ' + [...open] : true;
}
// the oracle for a halt: where the budget is first reached, where the stream is cut, and why (independent of the state machine)
function oracle(A, ev, listener, b) {
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].type !== 'content_block_delta') continue;
    const reason = isNum(b.text) && A.cumT[i] >= b.text ? 'budget-text' : isNum(b.thinking) && A.cumK[i] >= b.thinking ? 'budget-thinking' : isNum(b.total) && totalAt(A, i) >= b.total ? 'budget-total' : null;
    if (!reason) continue;
    const oi = A.openIdx[i], kind = A.types[oi], cuttable = kind === 'text' || (kind === 'thinking' && listener === 'harness');
    return { i, j: cuttable ? i : A.stopAt[oi], reason, kind };
  }
  return null;
}

// one trial: step from a start state and index until the stream ends (full) or the abort plus three swallowed events (snapshot)
function trial(st, from, ev, full, freeze) {
  const out = []; let abortAt = -1, aborts = 0, swallow = true, after = 0;
  for (let k = from; k < ev.length; k++) {
    const r = G.streamStep(st, ev[k]);
    if (abortAt >= 0) { if (r.out.length || r.verdict.verdict !== 'reject' || r.abort || (r.state !== st && !eq(r.state, st))) swallow = false; if (++after >= 3 && !full) break; continue; }
    st = freeze ? deepFreeze(r.state) : r.state; out.push(...r.out);
    if (r.abort) { abortAt = k; aborts++; st = r.state; }
  }
  return { out, abortAt, aborts, swallow, st };
}

// every property of one halt, against the oracle; returns nothing, tallies into t
function verifyHalt(t, S, A, listener, b, from, res, hash, policyStop) {
  const ev = S.events, o = oracle(A, ev, listener, b);
  if (!o) {
    t('no-halt-when-unreached', res.abortAt === -1 && res.st.halt === null && eq(res.out, ev.slice(from)), S.id);
    hash.update('none|');
    return;
  }
  const { j, reason } = o, st = res.st;
  t('one-abort', res.aborts === 1, S.id + ' ' + res.aborts);
  t('abort-at-oracle', res.abortAt === j, `${S.id} ${listener} ${J(b)} got ${res.abortAt} want ${j}`);
  t('reason', st.halt?.reason === reason, `${S.id} ${J(b)} ${st.halt?.reason} vs ${reason}`);
  t('state-done', st.done === true && st.halt !== null && st.pending === null, S.id);
  const head = j - from + 1;
  t('head-is-original-prefix', head >= 1 && res.out.length >= head && ev.slice(from, j + 1).every((e, m) => res.out[m] === e), `${S.id} ${J(b)}`);
  const open = A.openIdx[j] === null ? [] : [A.openIdx[j]], tail = res.out.slice(head);
  const md = tail[open.length], stop = tail[open.length + 1], want = policyStop || 'end_turn';
  const tokens = Math.ceil(totalAt(A, j) / 4);
  t('tail-shape', tail.length === open.length + 2 && open.every((x, m) => eq(tail[m], { type: 'content_block_stop', index: x })) && md?.type === 'message_delta' && md.delta.stop_reason === want && md.delta.stop_sequence === null && eq(stop, { type: 'message_stop' }), `${S.id} ${J(b)} ${J(tail.map(e => e.type))}`);
  t('token-estimate', md?.usage?.output_tokens === tokens && st.usage.output_tokens === tokens && st.halt.chars === totalAt(A, j), `${S.id} ${J(b)}`);
  t('counters-equal-recount', eq(st.chars, { text: A.cumT[j], thinking: A.cumK[j], tool_use: A.cumX[j] }), `${S.id} ${J(b)} ${J(st.chars)}`);
  t('no-tool-use-cut', open.every(x => A.types[x] !== 'tool_use'), S.id);
  if (listener === 'claude-code') t('no-thinking-cut-claude-code', open.every(x => A.types[x] !== 'thinking') && ev.slice(from, j + 1).every((e, m) => res.out[m] === e), S.id);
  t('swallow-after-halt', res.swallow, S.id);
  hash.update(`${listener}|${J(b)}|${j}|${reason}|${res.out.length}|${tokens}|`);
}

// ---------------------------------------------------------------- 1. the halt sweep
function sweepStream(t, S, hash, wait) {
  const ev = S.events, A = analyse(ev), n = ev.length;
  t('stream-well-formed', wellFormed(ev) === true, S.id);
  t('stream-one-open-block', Object.keys(A.types).every(i => A.stopAt[i] !== undefined), S.id);
  const D = Math.max(...Object.values(A.bd)), stride = Math.max(1, Math.ceil(2 * D * D / 15e6));
  const exhaustive = stride === 1, scratchAll = n <= 200;
  const rows = {};
  for (const listener of ['claude-code', 'harness']) {
    let base = G.streamInit(listener, {}, {}), points = 0, equiv = 0, nextSample = 0, maxWait = 0, sumWait = 0, waits = 0;
    const baseOut = [];
    for (let i = 0; i < n; i++) {
      const e = ev[i];
      if (e.type === 'content_block_delta') {
        const near = A.ord[i] <= 2 || A.ord[i] >= A.bd[e.index] - 3;
        if (stride === 1 || near || A.ord[i] % stride === 0) {
          for (const kind of ['text', 'thinking', 'total']) {
            const cur = kind === 'text' ? A.cumT : kind === 'thinking' ? A.cumK : null;
            const val = kind === 'total' ? totalAt(A, i) : cur[i], prev = kind === 'total' ? (i ? totalAt(A, i - 1) : 0) : (i ? cur[i - 1] : 0);
            if (val === prev) continue;
            for (const b of val - 1 > prev ? [val, val - 1] : [val]) {
              const bud = { [kind]: b };
              const st0 = { ...base, policy: { ...base.policy, budget: bud } };
              const res = trial(st0, i, ev, false, false);
              verifyHalt(t, S, A, listener, bud, i, res, hash);
              points++;
              const o = oracle(A, ev, listener, bud);
              if (o && o.j > o.i) { const w = o.j - o.i; maxWait = Math.max(maxWait, w); sumWait += w; waits++; }
              t('delivered-well-formed-sample', (points % 400 !== 0) || wellFormed([...baseOut, ...res.out]) === true, S.id);
              if (scratchAll || points >= nextSample) {
                nextSample = points + 100;
                const sc = trial(deepFreeze(G.streamInit(listener, { budget: bud }, {})), 0, ev, true, true);
                const same = J(sc.out) === J([...baseOut, ...res.out]) && J(sc.st) === J(res.st);
                t('snapshot-equals-from-scratch', same, `${S.id} ${listener} ${J(bud)}`);
                if (scratchAll) verifyHalt(t, S, A, listener, bud, 0, sc, hash);
                equiv++;
              }
            }
          }
        }
      }
      const r = G.streamStep(base, e); base = r.state; baseOut.push(...r.out);
    }
    t('no-policy-is-identity', eq(baseOut, ev) && base.done === true && base.halt === null, S.id + ' ' + listener);
    rows[listener] = { points, scratchChecked: equiv, maxWaitEvents: maxWait, meanWaitEvents: waits ? r3(sumWait / waits) : 0 };
  }
  wait.push({ stream: S.id, events: n, blockDeltasMax: D, stride, exhaustive, ...rows });
  return { id: S.id, events: n, stride, exhaustive, ...rows };
}

// random combined budgets (the reason priority), from scratch
function tripleSweep(t, S, hash) {
  const ev = S.events, A = analyse(ev), r = rng(77 + ev.length), N = ev.length <= 4000 ? 200 : 40, fin = A.cumT.at(-1) + A.cumK.at(-1) + A.cumX.at(-1);
  let k = 0;
  for (const listener of ['claude-code', 'harness']) for (let q = 0; q < N; q++) {
    const b = {};
    if (r() < .6) b.text = 1 + Math.floor(r() * (A.cumT.at(-1) * 1.1 + 1));
    if (r() < .6) b.thinking = 1 + Math.floor(r() * (A.cumK.at(-1) * 1.1 + 1));
    if (r() < .6 || !Object.keys(b).length) b.total = 1 + Math.floor(r() * (fin * 1.1 + 1));
    const res = trial(G.streamInit(listener, { budget: b }, {}), 0, ev, true, false);
    verifyHalt(t, S, A, listener, b, 0, res, hash);
    k++;
  }
  return k;
}

// corner budgets and stop reasons
function cornerSweep(t, hash) {
  const S = { id: 'mixed-1K', events: genStream({ kind: 'mixed', bytes: 1024, seed: 1001 }) }, A = analyse(S.events), out = [];
  const vals = [0, -1, 0.5, 1.5, NaN, Infinity, -Infinity, '5', null, undefined, 1e12, Number.MAX_SAFE_INTEGER];
  for (const listener of ['claude-code', 'harness']) for (const kind of ['text', 'thinking', 'total']) for (const v of vals) {
    const bud = { [kind]: v }, res = trial(G.streamInit(listener, { budget: bud }, {}), 0, S.events, true, false);
    verifyHalt(t, S, A, listener, bud, 0, res, hash);
    const o = oracle(A, S.events, listener, bud);
    out.push([listener, kind, String(v), o ? o.j : -1].join(':'));
  }
  for (const stop of ['end_turn', 'max_tokens', 'stop_sequence']) for (const listener of ['claude-code', 'harness']) {
    const bud = { text: 20 }, res = trial(G.streamInit(listener, { budget: bud, haltStopReason: stop }, {}), 0, S.events, true, false);
    verifyHalt(t, S, A, listener, bud, 0, res, hash, stop);
  }
  // an upstream error injected at every position passes untouched, is not counted and is not masked
  const ev = S.events; let injected = 0;
  for (let p = 2; p < ev.length - 2; p++) {
    const err = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
    let st = G.streamInit('claude-code', { budget: { total: 1e9 } }, {}), last;
    for (let i = 0; i < p; i++) st = G.streamStep(st, ev[i]).state;
    last = G.streamStep(st, err);
    t('error-passes-untouched', last.out.length === 1 && last.out[0] === err && last.verdict.verdict === 'allow' && !last.abort && last.state.done === true && eq(last.state.chars, st.chars), 'p=' + p);
    injected++;
  }
  return { vals: vals.length, injected, signature: sha(out.join('|')).slice(0, 16) };
}

// ---------------------------------------------------------------- 2. request side: bodies, normalisation, thinking policy
function genBody({ turns, markers, tools, sysN = 3, seed }) {
  const r = rng(seed), messages = []; let pend = null;
  for (let t = 0; t < turns; t++) {
    messages.push({ role: 'user', content: [...(pend ? [{ type: 'tool_result', tool_use_id: pend, content: words(r, 200) }] : []), { type: 'text', text: words(r, 120 + Math.floor(r() * 120)) }] }); pend = null;
    if (t < turns - 1) {
      const c = [{ type: 'text', text: words(r, 100 + Math.floor(r() * 100)) }];
      if (t % 4 === 3) { pend = 'toolu_' + t; c.push({ type: 'tool_use', id: pend, name: 'tool_1', input: { a: 'x' } }); }
      messages.push({ role: 'assistant', content: c });
    }
  }
  if (pend) messages.pop();
  const system = [{ type: 'text', text: 'attribution-block-synthetic cc_version=0.0.0' }, ...Array.from({ length: sysN - 1 }, () => ({ type: 'text', text: words(r, 1500) }))];
  const body = { model: 'claude-synthetic', max_tokens: 16000, stream: true, thinking: { type: 'enabled', budget_tokens: 8000 }, output_config: { effort: 'high' }, metadata: { user_id: 'synthetic-user' }, system, ...(tools ? { tools: Array.from({ length: tools }, (_, i) => ({ name: 'tool_' + i, description: words(r, 160), input_schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] } })) } : {}), messages };
  placeMarkers(body, markers, !!tools);
  return body;
}
function placeMarkers(b, m, hasTools) {
  const M = b.messages, last = i => M[i].content.at(-1);
  const slots = [() => last(M.length - 1), hasTools && (() => b.tools[0]), () => b.system[1], () => last(M.length - 3), () => b.system[2], () => last(M.length - 5), () => last(M.length - 7), () => last(M.length - 9), () => last(M.length - 11)].filter(Boolean);
  slots.slice(0, m).forEach((f, i) => { f().cache_control = i === 2 ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; });
}
// marker positions as strings, in body order
const markerPos = b => {
  const o = [];
  (b.tools || []).forEach((x, i) => x.cache_control && o.push('tools.' + i));
  if (Array.isArray(b.system)) b.system.forEach((x, i) => x.cache_control && o.push('system.' + i));
  b.messages.forEach((m, i) => Array.isArray(m.content) && m.content.forEach((c, j) => c.cache_control && o.push(`messages.${i}.${j}`)));
  return o;
};
const area = p => p.split('.')[0], msgIdx = p => Number(p.split('.')[1]);

function checkNormalise(t, orig, label) {
  const frozen = deepFreeze(clone(orig)), a = G.onRequest({}, frozen, { cache: { normalise: true } }), n = a.body;
  const before = markerPos(orig), after = markerPos(n), lastTool = orig.tools ? 'tools.' + (orig.tools.length - 1) : null;
  const origSet = new Set(before.map(p => area(p) === 'tools' && lastTool ? lastTool : p));
  t('req-input-untouched', J(frozen) === J(orig), label);
  t('req-count', after.length === Math.min(origSet.size, 4), `${label} ${before.length}->${after.length}`);
  t('req-survivors-were-markers', after.every(p => origSet.has(p)), label);
  t('req-system0-byte-equal', !orig.system || J(n.system[0]) === J(orig.system[0]), label);
  t('req-content-unchanged', J(stripCc(n)) === J(stripCc(orig)), label);
  t('req-idempotent', J(G.normaliseCache(clone(n))) === J(n), label);
  const gone = [...origSet].filter(p => !after.includes(p)), kept = after;
  const gm = gone.filter(p => area(p) === 'messages').map(msgIdx), km = kept.filter(p => area(p) === 'messages').map(msgIdx);
  t('req-lattice-messages-oldest-first', !gm.length || !km.length || Math.max(...gm) < Math.min(...km), label);
  t('req-lattice-system-after-messages', !gone.some(p => area(p) === 'system') || !kept.some(p => area(p) === 'messages'), label);
  t('req-lattice-tool-last', !gone.some(p => area(p) === 'tools') || (!kept.some(p => area(p) === 'messages') && !kept.some(p => area(p) === 'system' && p !== 'system.0')), label);
  t('req-system0-marker-kept', !orig.system?.[0]?.cache_control || !!n.system[0].cache_control, label);
  t('req-applied-named', before.length <= 4 && !(orig.tools && before.some(p => area(p) === 'tools' && p !== lastTool)) ? a.applied.length === 0 && J(n) === J(orig) : a.applied.length === 1, `${label} ${J(a.applied)}`);
  const th = G.onRequest({ class: 'main' }, deepFreeze(clone(orig)), { thinking: { maxBudget: 2000, maxEffort: 'medium' } }).body;
  t('req-thinking-clamped', th.thinking.budget_tokens === 2000 && th.output_config.effort === 'medium' && J({ ...th, thinking: 0, output_config: 0 }) === J({ ...orig, thinking: 0, output_config: 0 }), label);
  t('req-no-policy-same-object', G.onRequest({}, frozen, undefined).body === frozen && G.onRequest({}, frozen, {}).body === frozen, label);
  return after.length;
}

function requestBattery(t) {
  let cells = 0;
  const hist = QUICK ? [10, 100] : [10, 100, 1000];
  for (const turns of hist) for (const tools of [0, 50]) for (let m = 0; m <= 8; m++) { checkNormalise(t, genBody({ turns, markers: m, tools, seed: 5000 + turns + m }), `turns=${turns} tools=${tools} markers=${m}`); cells++; }
  // string system, no system, no tools, string content: nothing is placed, nothing converted
  const plain = { model: 'm', max_tokens: 10, system: 'a plain string system', messages: [{ role: 'user', content: 'plain string content' }] };
  const a = G.normaliseCache(deepFreeze(clone(plain)));
  t('req-string-forms-kept', J(a) === J(plain), 'string system/content');
  return cells;
}

// ---------------------------------------------------------------- 3. prefix stability over a growing history (R15, deterministic part)
function prefixBattery(t) {
  const T = QUICK ? 120 : 400, full = genBody({ turns: T, markers: 0, tools: 0, seed: 9001 }), fullTools = genBody({ turns: T, markers: 0, tools: 50, seed: 9002 });
  const view = (src, tt) => { const b = clone({ ...src, messages: undefined }); b.messages = clone(src.messages.slice(0, 2 * tt - 1)); return b; };
  const scen = {
    'claude-code-like (system 1 + newest and third-newest message, 3 markers)': (b, tt) => { const M = b.messages; b.system[1].cache_control = { type: 'ephemeral', ttl: '1h' }; M.at(-1).content.at(-1).cache_control = { type: 'ephemeral' }; if (M.length >= 3) M.at(-3).content.at(-1).cache_control = { type: 'ephemeral' }; },
    'accumulating (old markers never removed, one more per turn)': (b, tt) => { b.system[1].cache_control = { type: 'ephemeral', ttl: '1h' }; for (let k = 1; k <= tt; k++) b.messages[2 * k - 2].content.at(-1).cache_control = { type: 'ephemeral' }; },
    'early tool marker (tool 0 + newest message)': (b, tt) => { b.tools[0].cache_control = { type: 'ephemeral' }; b.messages.at(-1).content.at(-1).cache_control = { type: 'ephemeral' }; },
  };
  const out = {};
  for (const [name, mark] of Object.entries(scen)) {
    const src = name.startsWith('early') ? fullTools : full;
    let prev = null, steps = 0, contentFail = 0, idemFail = 0, identity = 0, changed = 0, markerPrefixIntact = 0, lcps = [], p3 = 0, p3n = 0, maxMarkers = 0, rawMax = 0;
    for (let tt = 2; tt <= T; tt++) {
      const raw = view(src, tt); mark(raw, tt);
      rawMax = Math.max(rawMax, markerPos(raw).length);
      const n = G.onRequest({}, deepFreeze(clone(raw)), { cache: { normalise: true } }).body;
      maxMarkers = Math.max(maxMarkers, markerPos(n).length);
      if (J(n) === J(raw)) identity++; else changed++;
      if (J(G.normaliseCache(clone(n))) !== J(n)) idemFail++;
      if (prev) {
        steps++;
        const pm = stripCc(prev.messages), nm = stripCc(n.messages).slice(0, pm.length);
        if (J(pm) !== J(nm) || J(stripCc(prev.system)) !== J(stripCc(n.system)) || J(stripCc(prev.tools)) !== J(stripCc(n.tools))) contentFail++;
        const a = J(prev.messages).slice(0, -1), b = J(n.messages);
        if (b.startsWith(a)) markerPrefixIntact++; else { let k = 0; while (k < a.length && a[k] === b[k]) k++; lcps.push(k / a.length); }
        // P3: the newest message marker of the previous request is still a marker position, now three messages from the end
        const lastMsg = prev.messages.length - 1, pj = markerPos(prev).filter(p => area(p) === 'messages' && msgIdx(p) === lastMsg);
        if (pj.length && !name.startsWith("early")) { p3n++; if (n.messages[lastMsg].content.some(c => c.cache_control)) p3++; }
      }
      prev = n;
    }
    out[name] = { turns: T, steps, rawMaxMarkers: rawMax, normalisedMaxMarkers: maxMarkers, normalisedEqualsRaw: identity, normalisedChangedRaw: changed, contentPrefixByteIdenticalFailures: contentFail, idempotenceFailures: idemFail, markerInclusivePrefixIntact: markerPrefixIntact, markerInclusivePrefixBroken: lcps.length, markerBrokenLcpMedian: lcps.length ? r3(med(lcps)) : null, prevNewestMarkerSurvives: `${p3}/${p3n}` };
    t('prefix-content-byte-identical', contentFail === 0, name);
    t('prefix-idempotent', idemFail === 0, name);
    t('prefix-prev-newest-marker-survives', p3 === p3n, name);
    t('prefix-at-most-four-markers', maxMarkers <= 4, name);
  }
  return out;
}

// ---------------------------------------------------------------- 4. credential blindness (R3, R18) over the whole battery
const CAN = ['sk-ant-test-CANARYA-not-a-key', 'Bearer sk-ant-oat01-test-CANARYB-not-a-token', 'oauth-2025-04-20-CANARYC', 'sess=CANARYD-not-a-cookie', 'CANARYE-not-a-session', 'CANARYF-own-key-not-a-key'];
const HEADER_NAMES = ['authorization', 'Authorization', 'x-api-key', 'X-API-KEY', 'anthropic-beta', 'proxy-authorization', 'cookie', 'x-claude-code-session-id', 'x-foo-token', 'anthropic-version'];
const guarded = name => { const boom = k => { throw new Error('header value read: ' + name + ' ' + String(k)); }; return new Proxy({}, { get: (_, k) => boom(k), has: (_, k) => boom(k), ownKeys: () => boom('keys'), getOwnPropertyDescriptor: (_, k) => boom(k), getPrototypeOf: () => boom('proto') }); };
function canaryBattery(t) {
  const leaks = [], echoes = []; let probes = 0;
  const scan = (where, obj) => {
    probes++;
    let s; try { s = J(obj); } catch (e) { s = String(e.message); }
    CAN.forEach((c, i) => { if (s.includes(c)) leaks.push({ where, canary: i }); });
    if (/sk-ant-|Bearer\s|oauth-20/.test(s) && !CAN.some(c => s.includes(c))) leaks.push({ where, pattern: true });
    t('canary-clean', !leaks.some(l => l.where === where), where);
  };
  const rest = r => { const { headers, ...x } = r; return x; };
  const caught = (where, fn) => { try { fn(); } catch (e) { const m = String(e.message); probes++; if (CAN.some(c => m.includes(c))) echoes.push({ where, echoedChars: CAN.reduce((a, c) => a || (m.includes(c.slice(0, 20)) ? 20 : 0), 0) }); } };
  // headers: every credential-like name with every canary
  for (const ci of [0, 1, 2, 3, 4]) {
    const pairs = HEADER_NAMES.map((n, i) => [n, CAN[ci] + '-h' + i]);
    scan('passHeaders.result-minus-headers', rest(G.passHeaders(pairs)));
    scan('passHeaders.trace', G.passHeaders(pairs).trace);
    const h = G.harnessHeaders(pairs, { apiKey: CAN[5] });
    scan('harnessHeaders.result-minus-headers', rest(h));
    const clientCanaries = pairs.filter(([n]) => ['authorization', 'x-api-key'].includes(n.toLowerCase())).map(p => p[1]);
    t('harness-client-credential-not-forwarded', h.verdict === 'allow' && !h.headers.some(([n, v]) => clientCanaries.includes(v) && ['authorization', 'x-api-key'].includes(n.toLowerCase())) && h.headers.filter(([n]) => n.toLowerCase() === 'x-api-key').length === 1 && h.headers.find(([n]) => n.toLowerCase() === 'x-api-key')[1] === CAN[5], 'ci=' + ci);
    t('harness-own-key-only-in-x-api-key', h.headers.filter(([n, v]) => v === CAN[5] && n.toLowerCase() !== 'x-api-key').length === 0 && !J(rest(h)).includes(CAN[5]), 'ci=' + ci);
    for (const key of [undefined, '', null, 0, {}, [], CAN[0].slice(0, 0)]) { const r = G.harnessHeaders(pairs, { apiKey: key }); scan('harnessHeaders.no-key', r); t('harness-no-key-fails-closed', r.verdict === 'reject' && r.status === 401 && !('headers' in r), String(key)); }
    scan('harnessHeaders.no-opts', G.harnessHeaders(pairs));
    for (const l of ['claude-code', 'harness']) {
      scan('admit.' + l + '.headers', G.admit(l, { method: 'POST', path: '/v1/messages?beta=true', headers: pairs }));
      scan('admit.' + l + '.chat', G.admit(l, { method: 'POST', path: '/v1/chat/completions', headers: pairs }));
      scan('admit.' + l + '.canary-in-path', G.admit(l, { method: 'POST', path: '/v1/messages?key=' + CAN[ci], headers: pairs }));
      scan('admit.' + l + '.canary-in-method', G.admit(l, { method: CAN[ci], path: '/v1/messages', headers: pairs }));
      scan('admit.' + l + '.canary-in-path-nonroute', G.admit(l, { method: 'POST', path: '/' + CAN[ci], headers: pairs }));
    }
  }
  // R18: values that throw on any access are carried (identity) or not touched; the names are all that is read
  const gp = HEADER_NAMES.map(n => [n, guarded(n)]);
  let blind = 0;
  try { const r = G.passHeaders(gp); blind += r.headers.every(([n, v], i) => v === gp[i][1]) ? 1 : 0; scan('passHeaders.guarded.trace', r.trace); } catch { /* counted below */ }
  try { const r = G.harnessHeaders(gp, { apiKey: CAN[5] }); blind += r.headers.filter(([n]) => n.toLowerCase() !== 'x-api-key').every(([n, v]) => gp.find(p => p[1] === v)) ? 1 : 0; scan('harnessHeaders.guarded.trace', r.trace); } catch { /* counted below */ }
  for (const l of ['claude-code', 'harness']) try { G.admit(l, { method: 'POST', path: '/v1/messages', headers: gp }); blind += 1; } catch { /* counted below */ }
  t('r18-guarded-values-never-read', blind === 4, 'blind=' + blind);
  // request bodies: the policy result besides the body (applied) never echoes anything; ctx values are not kept
  for (const ci of CAN.keys()) {
    const b = genBody({ turns: 12, markers: 6, tools: 3, seed: 100 + ci });
    b.metadata.user_id = CAN[ci]; b.system[1].text += CAN[ci]; b.messages[0].content[0].text += CAN[ci];
    const r = G.onRequest({ sessionId: CAN[ci], promptId: CAN[(ci + 1) % 6], class: 'main' }, deepFreeze(b), { cache: { normalise: true }, thinking: { maxBudget: 2000, maxEffort: 'low' } });
    scan('onRequest.applied', r.applied); scan('onRequest.result-minus-body', rest({ ...r, headers: 0 }).applied);
    t('request-body-text-carried-not-moved', J(r.body).includes(CAN[ci]), 'ci=' + ci);
  }
  // the stream: canaries inside upstream content are forwarded as content and never enter state, verdict or abort
  for (const ci of CAN.keys()) for (const l of ['claude-code', 'harness']) {
    const ev = genStream({ kind: 'mixed', bytes: 300, seed: 31 + ci }).map(e => clone(e));
    ev[0].message.id = CAN[ci]; ev.find(e => e.delta?.type === 'text_delta').delta.text = CAN[ci];
    ev.find(e => e.delta?.type === 'thinking_delta').delta.thinking = CAN[ci];
    ev.find(e => e.delta?.type === 'signature_delta').delta.signature = CAN[ci];
    ev.find(e => e.delta?.type === 'input_json_delta').delta.partial_json = CAN[ci];
    ev.splice(3, 0, { type: 'error', error: { type: 'x', message: CAN[ci] } });
    let st = G.streamInit(l, { budget: { total: 150 } }, { class: 'main' });
    for (const e of ev) { const r = G.streamStep(st, e); st = r.state; scan('streamStep.verdict', r.verdict); scan('streamStep.state', st); }
  }
  // the codec and chain: payload by design (events, rest, bad); the verdict a handler gives is returned as given
  scan('sseSplit.counts-only', (({ events, rest: r2, bad }) => [events.length, r2.length, bad.length])(G.sseSplit(G.sseFormat({ type: 'ping', x: CAN[0] }))));
  // errors thrown by the core echo caller-supplied identifiers (not header values); recorded apart
  caught('admit.unknown-listener', () => G.admit(CAN[0], { method: 'POST', path: '/v1/messages', headers: [] }));
  caught('streamInit.unknown-listener', () => G.streamInit(CAN[1], {}, {}));
  caught('registerReducer.name', () => { G.registerReducer(CAN[2], 'not a function'); });
  caught('streamInit.unknown-reducer', () => G.streamInit('harness', { reduce: [{ on: 'text', name: CAN[3] }] }, {}));
  // static: module-level mutable state in the core
  const src = fs.readFileSync(path.join(ROOT, 'app', 'claude-gateway.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const top = [...src.matchAll(/^(?:let|var)\s+(\w+)/gm)].map(m => m[1]), maps = [...src.matchAll(/^const\s+(\w+)\s*=\s*new\s+(?:Map|WeakMap)\b/gm)].map(m => m[1]), mutatedSets = [...src.matchAll(/\b(HOP|CREDENTIAL|CC_ROUTES|LISTENERS)\.(?:add|delete|clear)\(/g)].length;
  t('static-module-state', top.length === 0 && eq(maps, ['reducers']) && mutatedSets === 0, J({ top, maps, mutatedSets }));
  return { probes, leaks: leaks.length, leakSamples: leaks.slice(0, 5), echoes, moduleLevelMutableState: { let: top, containers: maps } };
}

// ---------------------------------------------------------------- 5. reducer-hook round trip
let RUN = 0;
function reducerBattery(t) {
  const run = RUN++, nm = s => `mm${run}-${s}`;
  const calls = { think: 0, text: [] }, kinds = [];
  G.registerReducer(nm('strip'), x => x.replace(/[aeiou]/g, ''));
  G.registerReducer(nm('upper'), x => x.toUpperCase());
  G.registerReducer(nm('half'), x => x.slice(0, Math.ceil(x.length / 2)));
  G.registerReducer(nm('think-spy'), x => { calls.think++; return x.slice(0, Math.ceil(x.length / 2)); });
  G.registerReducer(nm('ident'), x => x);
  G.registerReducer(nm('nonstring'), () => 42);
  G.registerReducer(nm('kinds'), (x, i) => { kinds.push(i.kind + ':' + i.index); return x; });
  G.registerReducer(nm('throws'), () => { throw new Error('mock reducer failure'); });
  const S = { id: 'mixed-1K', events: genStream({ kind: 'mixed', bytes: 1024, seed: 1001 }) }, ev = S.events, A = analyse(ev);
  const stepAll = (listener, policy, events = ev) => { let st = G.streamInit(listener, policy, {}); const out = [], verdicts = []; for (const e of events) { const r = G.streamStep(st, e); st = r.state; out.push(...r.out); verdicts.push(r.verdict.verdict); } return { out, st, verdicts }; };
  const map = (events, f) => events.map(e => { const x = f(e); return x || e; });
  const onText = f => e => e.delta?.type === 'text_delta' ? { ...e, delta: { ...e.delta, text: f(e.delta.text) } } : null;
  const onThink = f => e => e.delta?.type === 'thinking_delta' ? { ...e, delta: { ...e.delta, thinking: f(e.delta.thinking) } } : null;
  const strip = x => x.replace(/[aeiou]/g, ''), half = x => x.slice(0, Math.ceil(x.length / 2));
  const nText = ev.filter(e => e.delta?.type === 'text_delta').length, nThink = ev.filter(e => e.delta?.type === 'thinking_delta').length;
  const pol = { reduce: [{ on: 'text', name: nm('strip') }, { on: 'thinking', name: nm('half') }] };
  // harness: both altered; claude-code: text only
  const h = stepAll('harness', pol), c = stepAll('claude-code', pol);
  t('rd-harness-text-and-thinking', eq(h.out, map(map(ev, onText(strip)), onThink(half))) && h.out.length === ev.length, 'harness');
  t('rd-claude-code-text-only', eq(c.out, map(ev, onText(strip))), 'claude-code');
  t('rd-claude-code-thinking-objects-identical', c.out.every((e, i) => e.delta?.type === 'thinking_delta' || e.delta?.type === 'signature_delta' ? e === ev[i] : true), 'claude-code identity');
  t('rd-signature-and-tool-untouched', [h, c].every(r => r.out.every((e, i) => ev[i].delta?.type === 'signature_delta' || ev[i].delta?.type === 'input_json_delta' ? e === ev[i] : true)), 'sig/tool');
  t('rd-counters-count-upstream', eq(h.st.chars, { text: A.cumT.at(-1), thinking: A.cumK.at(-1), tool_use: A.cumX.at(-1) }) && eq(c.st.chars, h.st.chars), 'counters');
  const changed = (events, f) => events.filter(e => e.delta?.type === 'text_delta' && f(e.delta.text) !== e.delta.text).length;
  t('rd-alter-verdict-only-when-changed', h.verdicts.filter(v => v === 'alter').length === changed(ev, strip) + ev.filter(e => e.delta?.type === 'thinking_delta' && half(e.delta.thinking) !== e.delta.thinking).length && c.verdicts.filter(v => v === 'alter').length === changed(ev, strip), 'verdicts');
  t('rd-well-formed', wellFormed(h.out) === true && wellFormed(c.out) === true, 'well-formed');
  // a thinking reducer is called for thinking deltas on the harness listener and never on the Claude Code listener
  calls.think = 0; stepAll('claude-code', { reduce: [{ on: 'thinking', name: nm('think-spy') }] });
  const ccCalls = calls.think; calls.think = 0; stepAll('harness', { reduce: [{ on: 'thinking', name: nm('think-spy') }] });
  t('rd-thinking-reducer-never-called-on-claude-code', ccCalls === 0 && calls.think === nThink, `cc=${ccCalls} harness=${calls.think}/${nThink}`);
  // kind and index arguments, in stream order
  kinds.length = 0; stepAll('harness', { reduce: [{ on: 'text', name: nm('kinds') }, { on: 'thinking', name: nm('kinds') }] });
  const wantKinds = ev.filter(e => e.delta?.type === 'text_delta' || e.delta?.type === 'thinking_delta').map(e => (e.delta.type === 'text_delta' ? 'text:' : 'thinking:') + e.index);
  t('rd-kind-index-args', eq(kinds, wantKinds), kinds.slice(0, 4).join());
  // reducers compose in order; identity changes nothing and allocates nothing; a non-string is ignored
  const comp = stepAll('claude-code', { reduce: [{ on: 'text', name: nm('strip') }, { on: 'text', name: nm('upper') }] });
  t('rd-compose-in-order', eq(comp.out, map(ev, onText(x => strip(x).toUpperCase()))), 'compose');
  const id = stepAll('harness', { reduce: [{ on: 'text', name: nm('ident') }, { on: 'thinking', name: nm('ident') }] });
  t('rd-identity-no-alter-no-new-objects', id.verdicts.every(v => v === 'allow') && id.out.every((e, i) => e === ev[i]), 'identity');
  const ns = stepAll('harness', { reduce: [{ on: 'text', name: nm('nonstring') }] });
  t('rd-nonstring-ignored', eq(ns.out, ev) && ns.verdicts.every(v => v === 'allow'), 'nonstring');
  // halting is on upstream counts, whatever the reducer shrinks
  const bud = { text: 20 }, a1 = stepAll('harness', { budget: bud }), a2 = stepAll('harness', { budget: bud, reduce: [{ on: 'text', name: nm('half') }] });
  t('rd-budget-on-upstream-counts', a1.st.halt?.chars === a2.st.halt?.chars && a1.out.length === a2.out.length, 'budget');
  // reduce, format, split: the bytes round trip to the events
  const wire = h.out.map(G.sseFormat).join(''), back = G.sseSplit(wire);
  t('rd-sse-round-trip', eq(back.events, h.out) && back.rest === '' && back.bad.length === 0, 'sse');
  // the registry and its refusals
  t('rd-registry-refusals', [() => G.registerReducer(nm('strip'), x => x), () => G.registerReducer(nm('bad'), 'no'), () => G.streamInit('harness', { reduce: [{ on: 'text', name: nm('missing') }] }, {}), () => G.streamInit('harness', { reduce: [{ on: 'tool_use', name: nm('strip') }] }, {})].every(f => { try { f(); return false; } catch { return true; } }), 'refusals');
  // a reducer that throws: the error propagates out of streamStep and the state given is unchanged (observation, no contract)
  let propagated = false; const st0 = deepFreeze(G.streamInit('harness', { reduce: [{ on: 'text', name: nm('throws') }] }, {}));
  try { G.streamStep(G.streamStep(st0, ev[0]).state, ev.find(e => e.delta?.type === 'text_delta')); } catch (e) { propagated = /mock reducer failure/.test(e.message); }
  return { calls: { textDeltas: nText, thinkingDeltas: nThink, alteredHarness: h.verdicts.filter(v => v === 'alter').length, alteredClaudeCode: c.verdicts.filter(v => v === 'alter').length }, reducerThrowPropagates: propagated };
}

// ---------------------------------------------------------------- 6. the SSE codec
function codecBattery(t, streams) {
  const r = rng(4242); let frames = 0, cuts = 0;
  for (const S of streams.filter(s => s.events.length <= 40000)) {
    const text = S.events.map(G.sseFormat).join(''), back = G.sseSplit(text);
    t('codec-round-trip', J(back.events) === J(S.events) && back.rest === '' && !back.bad.length && S.events.map(G.sseFormat).join('') === text, S.id);
    frames += S.events.length;
    // random multi-chunk cuts, LF and CRLF
    for (const [label, wire] of [['lf', text], ['crlf', text.replace(/\n/g, '\r\n')]]) {
      let rest = '', evs = [], pos = 0, ok = true;
      while (pos < wire.length) { const n = 1 + Math.floor(r() * 2000); const x = G.sseSplit(rest + wire.slice(pos, pos + n)); evs.push(...x.events); rest = x.rest; pos += n; cuts++; if (x.bad.length) ok = false; }
      t('codec-random-chunks-' + label, ok && rest.trim() === '' && J(evs) === J(S.events), S.id);
    }
  }
  // every two-chunk cut and byte at a time, LF and CRLF, on the 1K mixed stream
  const S = streams.find(s => s.id === 'mixed-1K'), text = S.events.map(G.sseFormat).join('');
  for (const [label, wire] of [['lf', text], ['crlf', text.replace(/\n/g, '\r\n')]]) {
    let bad = 0, first = null;
    for (let i = 1; i < wire.length; i++) { const a = G.sseSplit(wire.slice(0, i)), b = G.sseSplit(a.rest + wire.slice(i)); if (J([...a.events, ...b.events]) !== J(S.events) || b.rest !== '' || a.bad.length || b.bad.length) { bad++; first ??= i; } cuts++; }
    t('codec-every-two-chunk-cut-' + label, bad === 0, `bad=${bad} first=${first}`);
    let rest = '', evs = [];
    for (const ch of wire) { const x = G.sseSplit(rest + ch); evs.push(...x.events); rest = x.rest; cuts++; }
    t('codec-byte-at-a-time-' + label, J(evs) === J(S.events) && rest === '', label);
  }
  // frame forms
  const f = e => `event: ${e.type}\ndata: ${J(e)}\n\n`, p = { type: 'ping' }, m = { type: 'message_stop' };
  t('codec-comments-skipped', eq(G.sseSplit(': keep-alive\n\n' + f(p) + ':\n\n' + f(m)).events, [p, m]), 'comments');
  t('codec-data-without-space', eq(G.sseSplit('data:{"type":"ping"}\n\n').events, [p]), 'nospace');
  t('codec-multiline-data-joined', eq(G.sseSplit('data: {"type":\ndata: "ping"}\n\n').events, [p]), 'multiline');
  t('codec-bad-json-reported', (x => x.events.length === 0 && x.bad.length === 1)(G.sseSplit('data: {oops\n\n')), 'bad');
  t('codec-event-only-frame-skipped', G.sseSplit('event: ping\n\n').events.length === 0, 'event-only');
  const nullFrame = G.sseSplit('data: null\n\n');
  const order = G.sseSplit(f(p) + 'data: {oops\n\n' + f(m));
  return { frames, cutsTried: cuts, jsonNullFrameYieldsEvents: J(nullFrame.events), badFrameOrderRecoverable: !(order.events.length === 2 && order.bad.length === 1 && false) && 'events and bad are returned in separate lists; their relative order is not' };
}

// ---------------------------------------------------------------- 7. robustness fuzz (seeded), every thrown error classed
function fuzz(t) {
  const throws = {}, note = (kind, e, input) => { const k = kind + ': ' + String(e.message).split('\n')[0].replace(/'[^']*'/g, "'_'").slice(0, 90); (throws[k] ||= { count: 0, minimal: String(input).slice(0, 200) }).count++; };
  const r = rng(2024), WEIRD = [null, undefined, 0, 1.5, -1, NaN, '', 'x', true, [], {}, [1], { type: 1 }, { text: 5 }];
  const fuzzEvent = () => {
    if (r() < .06) return pick(r, [null, 42, 'str', [], true]);
    const o = { type: pick(r, ['message_start', 'message_delta', 'message_stop', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'ping', 'error', 'x', '__proto__', 'constructor', 'toString', 1, null, undefined, {}]) };
    if (r() < .7) o.index = pick(r, [0, 1, 2, '0', -1, null, 1.5, undefined]);
    if (r() < .7) o.delta = r() < .2 ? pick(r, WEIRD) : { type: pick(r, ['text_delta', 'thinking_delta', 'input_json_delta', 'signature_delta', 'x', 'constructor', '__proto__', 'toString', 1, null]), text: pick(r, ['abc', '', 5, null, {}, '🙂']), thinking: pick(r, ['abc', '', 5, null]), partial_json: pick(r, ['{', '', 5, null]) };
    if (r() < .5) o.content_block = r() < .2 ? pick(r, WEIRD) : { type: pick(r, ['text', 'thinking', 'tool_use', 'x', null, 5, 'constructor']) };
    if (r() < .4) o.message = r() < .3 ? pick(r, WEIRD) : { usage: pick(r, [null, { input_tokens: 1 }, { input_tokens: 'x' }, { output_tokens: NaN }, {}, 5]) };
    if (r() < .3) o.usage = pick(r, [null, { output_tokens: 5 }, { output_tokens: 'x' }, {}, 5]);
    return o;
  };
  G.registerReducer(`fz${RUN}-ident`, x => x); G.registerReducer(`fz${RUN}-up`, x => x.toUpperCase());
  let streamsTried = 0;
  for (let q = 0; q < 4000; q++) {
    const listener = pick(r, ['claude-code', 'harness']);
    const policy = { budget: pick(r, [{}, { text: 3 }, { thinking: 1 }, { total: 10 }, { text: 0, thinking: 0, total: 0 }]), reduce: r() < .4 ? [{ on: pick(r, ['text', 'thinking']), name: `fz${RUN}-ident` }] : [] };
    let st = G.streamInit(listener, policy, {}); const evs = [];
    for (let k = 0, n = 1 + Math.floor(r() * 10); k < n; k++) evs.push(fuzzEvent());
    streamsTried++;
    for (const e of evs) { try { const x = G.streamStep(st, e); st = x.state; if (!x || !Array.isArray(x.out)) t('fz-stream-result-shape', false, J(e)); } catch (err) { note('streamStep', err, J(e)); break; } }
  }
  t('fz-stream-throws-classed', true, '');
  // request bodies: valid JSON of the wrong shape, every policy on
  const wb = () => pick(r, [null, undefined, 0, 'x', [], {}, [1, null], { type: 'text' }, { cache_control: { type: 'ephemeral' } }, [{ cache_control: { type: 'ephemeral' } }, null, 'x'], { content: 'x' }, { content: [null, { cache_control: {} }] }]);
  let bodies = 0;
  for (let q = 0; q < 4000; q++) {
    const b = r() < .05 ? pick(r, [null, [], 'x', 0]) : { ...(r() < .8 ? { model: 'm' } : {}), ...(r() < .6 ? { tools: wb() } : {}), ...(r() < .6 ? { system: wb() } : {}), ...(r() < .7 ? { messages: r() < .6 ? [wb(), wb(), { role: 'user', content: wb() }] : wb() } : {}), ...(r() < .5 ? { thinking: wb() } : {}), ...(r() < .4 ? { output_config: wb() } : {}) };
    bodies++;
    try { G.onRequest({ class: pick(r, ['main', 'subagent', undefined]) }, b, { cache: { normalise: true }, thinking: { maxBudget: 2000, maxEffort: 'low' } }); } catch (err) { note('onRequest', err, J(b)); }
  }
  // admit: only the exact routes with the right method and shape are ever allowed
  const ROUTES = ['/v1/messages', '/v1/messages/count_tokens', '/v1/chat/completions', '/v1/models', '/', '/v1/messages/', '/V1/MESSAGES', '/v1/messages/../models', '__proto__', '/v1/chat/completions;x', '//v1/messages', '/v1/messages#x', 'constructor', ''];
  let admits = 0, wrong = 0, nulls = 0;
  const NAMES = ['x-claude-code-session-id', 'X-Claude-Code-Session-Id', ' x-claude-code-session-id', 'x-claude-code-agent-id', 'x-claude-code-', 'authorization', 'content-type', 'x-claude-code'];
  for (let q = 0; q < 6000; q++) {
    const path_ = pick(r, ROUTES) + pick(r, ['', '?beta=true', '?x=1&y=2']), method = pick(r, ['POST', 'GET', 'post', 'PUT', undefined, '']), headers = Array.from({ length: Math.floor(r() * 4) }, () => [pick(r, NAMES), 'v']);
    for (const l of ['claude-code', 'harness']) {
      let v; try { v = G.admit(l, { method, path: path_, headers }); } catch (e) { note('admit', e, J({ method, path: path_ })); continue; }
      admits++;
      const base = path_.split('?')[0], m = String(method).toUpperCase(), names = headers.map(h => h[0].toLowerCase());
      const allowCC = l === 'claude-code' && ['/v1/messages', '/v1/messages/count_tokens'].includes(base) && m === 'POST' && names.includes('x-claude-code-session-id');
      const allowH = l === 'harness' && !names.some(n => n.startsWith('x-claude-code-')) && ((base === '/v1/chat/completions' && m === 'POST') || (base === '/v1/models' && m === 'GET'));
      const want = allowCC || allowH;
      const ok = (v.verdict === 'allow') === want && (v.verdict === 'allow' || (Number.isInteger(v.status) && v.status >= 400 && v.status < 500 && typeof v.reason === 'string'));
      if (!ok) { wrong++; t('fz-admit-matches-model', false, J({ l, method, path: path_, headers, v })); }
    }
  }
  t('fz-admit-matches-model', wrong === 0, 'wrong=' + wrong);
  for (const bad of [null, undefined]) { try { G.admit('harness', bad); } catch (e) { nulls++; note('admit', e, String(bad)); } }
  // header lists of the wrong shape
  for (const [fn, name] of [[() => G.passHeaders(null), 'passHeaders(null)'], [() => G.harnessHeaders(null, { apiKey: 'k' }), 'harnessHeaders(null)']]) { try { fn(); } catch (e) { note('headers', e, name); } }
  return { streamsTried, bodies, admits, throwClasses: Object.entries(throws).map(([k, v]) => ({ class: k, count: v.count, minimalInput: v.minimal })) };
}

// ---------------------------------------------------------------- 8. observations that are defects or spec gaps, each with its minimal input (recorded, not asserted)
function defects() {
  const probe = f => { try { const r = f(); return { threw: false, result: J(r)?.slice(0, 160) }; } catch (e) { return { threw: true, error: String(e.message).slice(0, 100) }; } };
  const cc = { cache_control: { type: 'ephemeral' } }, P = { cache: { normalise: true } };
  const fwd = ['authorization', 'x-api-key', 'proxy-authorization', 'cookie', 'transfer-encoding', 'content-length', 'host', 'connection', 'x-other'];
  const sent = fwd.map(n => [n, 'v-' + n]);
  return {
    streamStepNullEvent: { input: "streamStep(streamInit('harness', {}, {}), null)", ...probe(() => G.streamStep(G.streamInit('harness', {}, {}), null)), reachableFrom: "sseSplit('data: null\\n\\n').events -> " + J(G.sseSplit('data: null\n\n').events) },
    onRequestNullBody: { input: 'onRequest({}, null, {cache:{normalise:true}})', ...probe(() => G.onRequest({}, null, P)), noPolicy: probe(() => G.onRequest({}, null, {})) },
    onRequestMessagesNotArray: { input: 'onRequest({}, {messages: {}}, {cache:{normalise:true}})', ...probe(() => G.onRequest({}, { messages: {} }, P)) },
    onRequestStringToolAfterMarkedTool: { input: "onRequest({}, {tools:[{name:'a',cache_control:{type:'ephemeral'}},'x'],messages:[]}, {cache:{normalise:true}})", ...probe(() => G.onRequest({}, { tools: [{ name: 'a', ...cc }, 'x'], messages: [] }, P)) },
    onRequestNullToolAfterMarkedTool: { input: 'onRequest({}, {tools:[{name:"a",cache_control:{type:"ephemeral"}},null],messages:[]}, {cache:{normalise:true}})', ...probe(() => G.onRequest({}, { tools: [{ name: 'a', ...cc }, null], messages: [] }, P)) },
    admitNullRequest: { input: "admit('harness', null)", ...probe(() => G.admit('harness', null)) },
    harnessHeadersForwarded: { input: 'harnessHeaders(' + J(fwd) + ' with values, {apiKey:"OWN"})', forwardedNames: G.harnessHeaders(sent, { apiKey: 'OWN' }).headers.map(h => h[0]), droppedNames: fwd.filter(n => !G.harnessHeaders(sent, { apiKey: 'OWN' }).headers.some(h => h[0] === n)) },
    passHeadersForwarded: { forwardedNames: G.passHeaders(sent).headers.map(h => h[0]), droppedNames: fwd.filter(n => !G.passHeaders(sent).headers.some(h => h[0] === n)) },
    unitNotes: { budgetUnit: 'UTF-16 code units of the delta string, tokens estimated as ceil(chars/4)', zeroBudgetHaltsAtFirstDelta: 'verified in corner sweep' },
  };
}

// ---------------------------------------------------------------- the deterministic part, one run
function deterministic() {
  const hash = crypto.createHash('sha256'), t = mkTally(), D = {};
  const streams = genAll();
  D.streams = streams.map(S => ({ id: S.id, kind: S.kind, bytes: S.bytes, events: S.events.length, sha256: sha(S.events.map(G.sseFormat).join('')).slice(0, 16) }));
  const waits = [], sweepRows = [];
  for (const S of streams) { const q0 = hr(); sweepRows.push(sweepStream(t, S, hash, waits)); if (process.env.MG_PROGRESS) console.error("sweep", S.id, S.events.length, Math.round(hr() - q0) + "ms"); }
  D.sweep = { rows: sweepRows, pointsTotal: sweepRows.reduce((a, r) => a + r['claude-code'].points + r.harness.points, 0), note: 'each point: one (stream, listener, budget kind, budget value); stride 1 is exhaustive over deltas, a larger stride keeps every Nth delta and the first and last three of every block' };
  D.triple = { trials: streams.reduce((a, S) => a + tripleSweep(t, S, hash), 0) };
  D.corner = cornerSweep(t, hash);
  D.requests = { cells: requestBattery(t) };
  D.prefix = prefixBattery(t);
  D.canary = canaryBattery(t);
  D.reducers = reducerBattery(t);
  D.codec = codecBattery(t, streams);
  D.fuzz = fuzz(t);
  D.defects = defects();
  D.checks = t.out(); D.checkTotals = t.sum();
  D.sweepOutputHash = hash.digest('hex').slice(0, 32);
  return D;
}

// ---------------------------------------------------------------- the indicative part (wall clock and heap)
const timerOverhead = () => { const n = 200000, a = hr(); for (let i = 0; i < n; i++) hr(); return (hr() - a) / n; };
function timeRun(events, listener, policy, minEvents) {
  const run = () => { let st = G.streamInit(listener, policy, {}), sink = 0; const a = hr(); for (const e of events) { const r = G.streamStep(st, e); st = r.state; sink += r.out.length; } return [hr() - a, sink]; };
  run();
  const reps = Math.max(3, Math.min(60, Math.ceil(minEvents / events.length))), ts = [];
  for (let i = 0; i < reps; i++) ts.push(run()[0]);
  const m = med(ts);
  return { reps, medianMs: r3(m), usPerEvent: r3(m * 1000 / events.length), eventsPerSecond: Math.round(events.length / (m / 1000)) };
}
function indicative(streams) {
  const I = { timerOverheadUsPerCall: r3(timerOverhead() * 1000) };
  const ensure = (id) => streams.find(s => s.id === id);
  const G_ = Math.round;
  G.registerReducer(`tm${RUN}-up`, x => x.toUpperCase()); G.registerReducer(`tm${RUN}-half`, x => x.slice(0, Math.ceil(x.length / 2)));
  const variants = [['pass-through (no policy)', {}], ['budget set, never reached', { budget: { text: 1e12, thinking: 1e12, total: 1e12 } }], ['text reducer', { reduce: [{ on: 'text', name: `tm${RUN}-up` }] }], ['text and thinking reducers + budget', { budget: { total: 1e12 }, reduce: [{ on: 'text', name: `tm${RUN}-up` }, { on: 'thinking', name: `tm${RUN}-half` }] }]];
  I.perEvent = [];
  for (const S of streams) for (const listener of ['claude-code', 'harness']) for (const [vn, pol] of variants) {
    if (S.events.length > 40000 && vn !== variants[0][0] && vn !== variants[3][0]) continue;
    I.perEvent.push({ stream: S.id, events: S.events.length, listener, policy: vn, ...timeRun(S.events, listener, pol, 150000) });
  }
  // per-step latency distribution on the 100K mixed stream, with the heaviest policy
  const lat = {};
  for (const listener of ['claude-code', 'harness']) {
    const ev = ensure('mixed-100K').events, ts = new Array(ev.length);
    let st = G.streamInit(listener, variants[3][1], {});
    for (let rep = 0; rep < 3; rep++) { st = G.streamInit(listener, variants[3][1], {}); for (let i = 0; i < ev.length; i++) { const a = hr(); const r = G.streamStep(st, ev[i]); const b = hr(); st = r.state; if (rep === 2) ts[i] = (b - a) * 1000; } }
    lat[listener] = { events: ev.length, p50Us: r3(pct(ts, .5)), p95Us: r3(pct(ts, .95)), p99Us: r3(pct(ts, .99)), maxUs: r3(Math.max(...ts)), r14BoundMs: 5, p95VsBound: `${r3(pct(ts, .95) / 5000 * 100)}% of 5 ms` };
  }
  I.perStepLatency = lat;
  // codec
  const S = ensure('mixed-100K'), text = S.events.map(G.sseFormat).join('');
  const tf = [], ts2 = []; for (let i = 0; i < 7; i++) { const a = hr(); S.events.map(G.sseFormat).join(''); tf.push(hr() - a); const b = hr(); G.sseSplit(text); ts2.push(hr() - b); }
  I.codec = { stream: S.id, events: S.events.length, bytes: text.length, formatUsPerEvent: r3(med(tf) * 1000 / S.events.length), splitUsPerEvent: r3(med(ts2) * 1000 / S.events.length), splitMBps: r3(text.length / 1e6 / (med(ts2) / 1000)) };
  // requests
  I.perRequest = [];
  const grid = QUICK ? [10, 100] : [10, 100, 1000];
  for (const turns of grid) for (const tools of [0, 50]) for (const m of [0, 4, 8]) {
    const body = genBody({ turns, markers: m, tools, seed: 5000 + turns + m }), bytes = J(body).length, row = { turns, tools, markers: m, bodyKB: G_(bytes / 1024) };
    for (const [pn, pol] of [['none', undefined], ['normalise', { cache: { normalise: true } }], ['normalise+thinking', { cache: { normalise: true }, thinking: { maxBudget: 2000, maxEffort: 'medium' } }]]) {
      const f = () => G.onRequest({ class: 'main' }, body, pol); f();
      const ts = []; const reps = pn === 'none' ? 2000 : Math.max(5, Math.min(200, Math.ceil(60000 / bytes)));
      for (let i = 0; i < reps; i++) { const a = hr(); f(); ts.push(hr() - a); }
      row[pn + 'Ms'] = r3(med(ts));
    }
    I.perRequest.push(row);
  }
  return I;
}
function memory() {
  const gc = (() => { try { v8.setFlagsFromString('--expose-gc'); return vm.runInNewContext('gc'); } catch { return null; } })();
  const total = QUICK ? 300000 : 2000000, every = total / 10, samples = [];
  const sink = { n: 0 };
  function* long() {
    yield { type: 'message_start', message: { id: 'm', content: [], usage: { input_tokens: 1, output_tokens: 1 } } };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
    for (let i = 0; i < total; i++) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } };
    yield { type: 'content_block_stop', index: 0 };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: total } };
    yield { type: 'message_stop' };
  }
  const rows = [];
  for (const listener of ['harness', 'claude-code']) {
    G.registerReducer(`mem${RUN}-${listener}`, x => x);
    let st = G.streamInit(listener, { budget: { total: 1e12 }, reduce: [{ on: 'text', name: `mem${RUN}-${listener}` }] }, {}), n = 0;
    if (gc) gc(); const h0 = process.memoryUsage().heapUsed, pts = [[0, h0]];
    for (const e of long()) { const r = G.streamStep(st, e); st = r.state; sink.n += r.out.length; if (++n % every === 0) { if (gc) gc(); pts.push([n, process.memoryUsage().heapUsed]); } }
    const slope = (pts.at(-1)[1] - pts[1][1]) / (pts.at(-1)[0] - pts[1][0]);
    rows.push({ listener, events: n, gcAvailable: !!gc, heapMBSamples: pts.map(p => r3(p[1] / 1048576)), growthBytesPerEventAfterFirstSample: r3(slope), stateJsonBytes: J(st).length, finalChars: st.chars.text });
  }
  return rows;
}

// ---------------------------------------------------------------- run, hash twice, write
const t0 = hr();
const A = deterministic();
const hashA = sha(J(A));
const B = deterministic();
const hashB = sha(J(B));
const detMs = hr() - t0;
const streams = genAll().filter(s => s.events.length <= 120000);
const IND = indicative(streams);
IND.memory = memory();
const gitRev = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } })();
const result = {
  meta: { date: DATE, script: 'scripts/measure-gateway.mjs', quick: QUICK, node: process.version, platform: `${process.platform} ${process.arch}`, cpus: os.cpus().length, gitHead: gitRev, gatewaySha256: sha(fs.readFileSync(path.join(ROOT, 'app', 'claude-gateway.js'))).slice(0, 16), deterministicRunMs: Math.round(detMs / 2), note: 'deterministic part is compared by hash; indicative part is wall clock and heap on this machine, not a pass or fail' },
  deterministic: A,
  determinism: { runs: 2, hashA, hashB, equal: hashA === hashB },
  indicative: IND,
  unmeasured: 'see docs/concepts/results/gateway-det-' + DATE + '.md',
};
fs.mkdirSync(OUT, { recursive: true });
const base = path.join(OUT, `gateway-det-${DATE}`);
fs.writeFileSync(base + '.json', J(result, null, 1) + '\n');

// the table
const row = (...c) => '| ' + c.join(' | ') + ' |';
const tab = (head, rows) => [row(...head), row(...head.map(() => '---')), ...rows.map(r => row(...r))].join('\n');
const sum = A.checkTotals, sw = A.sweep.rows;
const md = [];
md.push(`# Gateway core, deterministic measurements (${DATE})`, '',
  `Script \`scripts/measure-gateway.mjs\`, core \`app/claude-gateway.js\` (sha256 ${result.meta.gatewaySha256}, repo head ${gitRev}). Synthetic streams and bodies from a seeded PRNG; no network, no model, no key. Full JSON: \`${path.relative(ROOT, base).replace(/\\/g, '/')}.json\`. Hypotheses: \`docs/platform/claude-route-survey.md\` (R-numbers). Timing is wall clock on one machine (${result.meta.platform}, node ${process.version}), indicative only; counts, sweeps and hashes are deterministic.`, '',
  `**Checks run: ${sum.run}, failed: ${sum.fail}.** Determinism: two full runs, hash ${hashA === hashB ? 'equal' : 'DIFFERENT'} (${hashA.slice(0, 16)}). Halt sweep points: ${A.sweep.pointsTotal} single-budget plus ${A.triple.trials} combined-budget trials plus ${A.corner.vals * 6} corner budgets. Credential canary: ${A.canary.probes} probes, ${A.canary.leaks} leaks.`, '',
  '## Streams', '', tab(['stream', 'kind', 'payload chars', 'events', 'sha256 (SSE bytes)'], A.streams.map(s => [s.id, s.kind, s.bytes, s.events, s.sha256])), '',
  '## Halt-and-alter sweep (R4, R5 counters, R14 shape, R17)', '',
  'Per point: abort at the oracle index (budget first reached; the cut waits for an open tool_use block on both listeners and for an open thinking block on the Claude Code listener), reason code, delivered head is the original prefix by object identity, tail is exactly the closer of the open block, one `message_delta` with the policy stop reason, `message_stop`, token estimate = ceil(chars/4), counters equal the recount, swallow after halt, no tool_use cut, no thinking cut on the Claude Code listener, snapshot trial equals from-scratch run on sampled points. Wait events = events between the delta that reaches the budget and the abort (0 when the block may be cut).', '',
  tab(['stream', 'events', 'stride', 'cc points', 'cc max wait', 'harness points', 'harness max wait'], sw.map(r => [r.id, r.events, r.stride + (r.exhaustive ? ' (exhaustive)' : ''), r['claude-code'].points, r['claude-code'].maxWaitEvents, r.harness.points, r.harness.maxWaitEvents])), '',
  tab(['check', 'run', 'fail'], Object.entries(A.checks).map(([k, v]) => [k, v.run, v.fail])), '',
  '## Per-event overhead (indicative)', '', `Timer overhead per call ${IND.timerOverheadUsPerCall} us (not subtracted).`, '',
  tab(['stream', 'events', 'listener', 'policy', 'us/event', 'events/s'], IND.perEvent.map(r => [r.stream, r.events, r.listener, r.policy, r.usPerEvent, r.eventsPerSecond])), '',
  '### Per-step latency on mixed-100K, heaviest policy (R14 bound 5 ms at p95)', '', tab(['listener', 'events', 'p50 us', 'p95 us', 'p99 us', 'max us', 'p95 vs 5 ms'], Object.entries(IND.perStepLatency).map(([l, v]) => [l, v.events, v.p50Us, v.p95Us, v.p99Us, v.maxUs, v.p95VsBound])), '',
  `Codec on ${IND.codec.stream} (${IND.codec.events} events, ${IND.codec.bytes} bytes): format ${IND.codec.formatUsPerEvent} us/event, split ${IND.codec.splitUsPerEvent} us/event (${IND.codec.splitMBps} MB/s).`, '',
  '## Memory across a long stream (indicative)', '', tab(['listener', 'events', 'heap MB samples (after gc)', 'growth bytes/event', 'final state JSON bytes'], IND.memory.map(m => [m.listener, m.events, m.heapMBSamples.join(' '), m.growthBytesPerEventAfterFirstSample, m.stateJsonBytes])), '',
  '## Per-request overhead (indicative), median ms per onRequest call', '', tab(['turns', 'tools', 'markers', 'body KB', 'no policy', 'normalise', 'normalise+thinking'], IND.perRequest.map(r => [r.turns, r.tools, r.markers, r.bodyKB, r.noneMs, r.normaliseMs, r['normalise+thinkingMs']])), '',
  `Request invariants (${A.requests.cells} bodies: 10/100${QUICK ? '' : '/1000'} turns, 0..8 markers, 0 and 50 tools): see the \`req-*\` checks above.`, '',
  '## Prefix stability over a growing history (R15, deterministic part)', '', tab(['scenario', 'turns', 'raw max markers', 'normalised max', 'normalised = raw', 'content prefix byte-identical failures', 'marker-inclusive prefix intact / broken', 'previous newest marker survives'], Object.entries(A.prefix).map(([k, v]) => [k, v.turns, v.rawMaxMarkers, v.normalisedMaxMarkers, v.normalisedEqualsRaw, v.contentPrefixByteIdenticalFailures, `${v.markerInclusivePrefixIntact} / ${v.markerInclusivePrefixBroken}`, v.prevNewestMarkerSurvives])), '',
  'Reading: content prefix = messages, system and tools with cache_control stripped. It is byte-identical across every turn in every scenario. The marker-inclusive prefix (cache_control fields kept) breaks wherever a marker moves, which is expected and not a cache-key claim; whether the provider keys on content only is a live question (R15). Normalisation is the identity on a body with at most 4 markers (claude-code-like, early tool marker moves to the last tool), and changes only the accumulating case (more than 4 markers).', '',
  'Halt wait, reading: on the Claude Code listener a thinking or tool_use block is never cut, so the abort waits for the block to stop (max wait column, in events); on the harness listener only a tool_use block waits. Within a cuttable block the abort is at the delta that reaches the budget (wait 0).', '',
  '## Credential blindness (R3, R18)', '', `${A.canary.probes} probes over every public function and every input position that takes a string (header values on both listeners, harness key, request paths and methods, request bodies, stream events, thrown errors). Leaks in any returned trace, verdict, state or applied list: ${A.canary.leaks}. Echoes of a caller-supplied identifier in a thrown error message (listener or reducer name, not a header value): ${A.canary.echoes.length} (${A.canary.echoes.map(e => e.where).join(', ')}). Module-level mutable state: ${J(A.canary.moduleLevelMutableState)}.`, '',
  '## Reducer hook round trip', '', J(A.reducers), '',
  '## SSE codec', '', J(A.codec), '',
  '## Robustness fuzz (seeded)', '', `streams ${A.fuzz.streamsTried}, bodies ${A.fuzz.bodies}, admits ${A.fuzz.admits}. Thrown error classes (input minimal as found):`, '', tab(['class', 'count', 'minimal input'], A.fuzz.throwClasses.map(c => [c.class, c.count, '`' + c.minimalInput.replace(/\|/g, '/') + '`'])), '',
  '## Defects and spec gaps, minimal inputs (recorded in the catalog inbox as faults)', '', '```json', J(A.defects, null, 1), '```', '',
  '## Unmeasured (need a real Claude Code and an API key in a container)', '',
  tab(['R', 'what is still open', 'needs'], [
    ['R1', 'event to OpenAI-style chunk mapping on recorded streams (the mapping is the harness listener, not built)', 'the listener, plus recorded real Messages streams'],
    ['R5', 'token estimate within 25 percent of final usage output tokens', 'recorded real turns (usage from message_delta) with text, thinking, tool_use'],
    ['R6', 'thinking tokens per turn with request parameters; reducer vs task outcome', 'live sessions, a key, an unreduced arm; PROGRAMME.md run count'],
    ['R7', 'what Claude Code keeps after an altered E text delta', 'real Claude Code behind the gateway and its next request body'],
    ['R8', 'terse flow: tokens per turn, completion', 'live sessions on real work, blue arm, key'],
    ['R11', 'auth-mode invariance end to end', 'a container with the key variable and one with a signed-in binary'],
    ['R12', 'no double retry: the page retry plus the Claude Code retry', 'a real Claude Code in the container and a flaky upstream'],
    ['R13', 'cache-hit ratio through the gateway within 2 points of direct', 'a scripted 30-turn session, key, real upstream, direct arm'],
    ['R14', 'acceptance of a synthetic stop sequence without retry or continue prompt', 'real Claude Code, key, each haltStopReason (end_turn, max_tokens)'],
    ['R15', 'cache-hit not lower, higher in a churn case, attribution block stays stripped', 'real upstream, key, scripted churn session, recorded requests'],
    ['R16', 'unpublished listener isolation and no forwarded credential', 'the node listeners (not built) and a container network; core shape checks measured'],
    ['R17', 'thinking alteration signature rejection and recovery cost', 'real upstream, key, a tool loop with an altered thinking block'],
    ['R9, R10', 'later: mirror and tool execution once', 'routes A, B or E running'],
  ]), '');
fs.writeFileSync(base + '.md', md.join('\n') + '\n');
console.log(`checks ${sum.run}, failed ${sum.fail}; determinism ${hashA === hashB ? 'equal' : 'DIFFERENT'}; canary probes ${A.canary.probes} leaks ${A.canary.leaks}; wrote ${path.relative(ROOT, base)}.json/.md`);
process.exitCode = sum.fail || hashA !== hashB || A.canary.leaks ? 1 : 0;
