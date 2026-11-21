// Claude route, step one: the pure GATEWAY CORE and the provider-registry entry (docs/platform/claude-route-survey.md,
// hypotheses R1..R18; the design of record). Node only: no browser, no network, no timers, no model, no key.
// Run: node scripts/test-gateway.mjs
//
// Seams. (1) NEW module `app/claude-gateway.js`: a pure policy core, no node or DOM import, no socket, no clock,
// no timer: plain functions over request objects, header pair lists and Messages SSE events. The thin node listener
// (`scripts/gateway/` or similar) is a later piece and is not specified here. (2) Providers: one registry entry
// `providers.claude` in `app/providers.js` (the shape of `openaiCompatible` behind `retrying`, as for the other entries).
//
// Exports the spec fixes (names are the contract; the survey leaves them open):
//   VERDICTS                        ['allow','reject','alter','hold']  (agent-tap vocabulary)
//   chain(handlers) -> fn(x)        the first non-allow verdict wins; a hold verdict is returned as given (no timer)
//   passHeaders(pairs) -> {headers, trace}                 Claude Code listener: blind copy; trace {names}
//   harnessHeaders(pairs, {apiKey}) -> {verdict:'allow',headers,trace} | {verdict:'reject',status,reason}
//   admit(listener, {method,path,headers}) -> {verdict:'allow'} | {verdict:'reject',status,reason};
//                                   listener is 'claude-code' or 'harness'; any other name throws
//   onRequest(ctx, body, policy) -> {body, applied}        policy {cache:{normalise}, thinking:{maxBudget,maxEffort}}
//   normaliseCache(body) -> body                           the pure function behind policy.cache.normalise
//   registerReducer(name, fn)                              fn(text, {kind,index}) -> text; a taken name throws
//   streamInit(listener, policy, ctx) -> state             policy {budget:{text,thinking,total}, haltStopReason,
//                                                          reduce:[{on:'text'|'thinking', name}]}; unknown reducer throws
//   streamStep(state, event) -> {state, out, verdict, abort}   out is the list of events to send on
//   sseSplit(buffer) -> {events, rest}   sseFormat(event) -> string   (canonical frame `event: T\ndata: JSON\n\n`)
// Headers are lists of [name, value] pairs (the shape of Node's raw headers): the core reads names, never values.
// Stream state is plain JSON: {done, halt:null|{reason,chars}, chars:{text,thinking,tool_use}, usage:{...}}.
//
// Readings taken where the survey is open (the narrowest each; each is listed in the report):
//  a. Pairs, not a Headers object. Blindness (R18) is checked with values that throw on any property access, a
//     proxy; the core must carry the very same value (identity) and may not touch it. Hop-by-hop `host` and
//     `connection` are the only headers not forwarded by passHeaders. Trace names are lower case, in order.
//  b. R16: on the Claude Code listener the shape is: method POST, path `/v1/messages` or `/v1/messages/count_tokens`
//     (a query string is allowed), and a header named `x-claude-code-session-id`. On the harness listener the shape is
//     the page's: POST `/v1/chat/completions`, GET `/v1/models`; any `x-claude-code-*` header is refused (no
//     non-Claude-Code client presents itself as Claude Code) and so is the Messages route. Refusals are any 4xx.
//     The harness listener drops client authorization and x-api-key and sends its own x-api-key from `apiKey`, given
//     per call; with no apiKey it fails closed (any status >= 400) and nothing is remembered between calls.
//  c. Normalisation (R15, invariants only): content outside `cache_control` fields never changes; `system` keeps
//     length, order and element 0 byte for byte (attribution block; a string `system` is never converted); markers are
//     only removed or moved, never added, and a marker's own fields (ttl) survive; a marker on a tool that is not the
//     last tool moves to the last tool; markers on system elements 1.. stay; when more than 4 markers remain the oldest
//     message markers go first. Idempotent. Off unless policy.cache.normalise. Placing markers on a request that has
//     none (route C) is not specified here.
//  d. Thinking policy: maxBudget clamps `thinking.budget_tokens` (floor 1024, the API minimum); maxEffort caps
//     `output_config.effort` on the order low < medium < high < max; never adds a field; applies when ctx.class is absent
//     or 'main', not to other classes.
//  e. Budgets count characters of the upstream stream (text, thinking, tool_use input; total = the three), 4 characters
//     per token estimate, rounded up (Q9). The delta that reaches the budget (>=) is delivered, then the stream is
//     closed: within one delta. A tool_use block is never cut (the halt waits for its content_block_stop). On the
//     Claude Code listener a thinking block is never cut either (R17: signature), the halt waits for its stop; on the
//     harness listener (the harness's own copy) it is cut at once. The synthetic stop_reason is policy.haltStopReason,
//     default 'end_turn' (Q12, first candidate). Halt is verdict 'reject' with abort:true on the one step that ends the
//     stream; later upstream events yield out [], verdict reject, abort false, the state unchanged. Elapsed-time budgets and the lexical margin check (R8) are not specified here.
//  f. Reducers: per delta, by name, from a registry; the Claude Code listener alters text only and ignores a thinking
//     reducer (R17, Q6); the harness listener may alter both. Counters stay upstream counts.
//  g. ping and error events pass untouched and uncounted; an upstream error is not masked with a synthetic stop.
//  h. The OpenAI-style mapping of events for the page (R1, finish_reason 'length', x_halt) is the harness listener's,
//     a later piece, not specified here.
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import('../app/claude-gateway.js').catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
const P = await import('../app/providers.js');

let fails = 0;
// a check is a function: a throw (the module or a function is not there yet) is a failed check, not a stopped suite
const check = (id, name, fn) => {
  let ok = false, got = '';
  try { const r = fn(); ok = r === true; if (!ok) got = JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + `${id} ${name}` + (ok ? '' : ' ' + String(got).slice(0, 300)));
  if (!ok) fails++;
};
const checkAsync = async (id, name, fn) => {
  let ok = false, got = '';
  try { const r = await fn(); ok = r === true; if (!ok) got = JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + `${id} ${name}` + (ok ? '' : ' ' + String(got).slice(0, 300)));
  if (!ok) fails++;
};
const eq = (a, b) => isDeepStrictEqual(a, b);
const J = v => JSON.stringify(v);
const clone = v => JSON.parse(JSON.stringify(v));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const throws = fn => { try { fn(); return false; } catch { return true; } };
// the core reads no clock and sets no timer: while fn runs, each of these throws
const sealed = fn => {
  const keep = { now: Date.now, rnd: Math.random, st: globalThis.setTimeout, si: globalThis.setInterval, qm: globalThis.queueMicrotask };
  const boom = () => { throw new Error('clock or timer used'); };
  Date.now = boom; Math.random = boom; globalThis.setTimeout = boom; globalThis.setInterval = boom; globalThis.queueMicrotask = boom;
  try { return fn(); } finally { Date.now = keep.now; Math.random = keep.rnd; globalThis.setTimeout = keep.st; globalThis.setInterval = keep.si; globalThis.queueMicrotask = keep.qm; }
};
// a header value that throws on any access: copying the reference is allowed, reading it is not
const guarded = name => { const boom = k => { throw new Error('header value read: ' + name + ' ' + String(k)); }; return new Proxy({}, { get: (_, k) => boom(k), has: (_, k) => boom(k), ownKeys: () => boom('keys'), getOwnPropertyDescriptor: (_, k) => boom(k), getPrototypeOf: () => boom('proto') }); };

// ---------------------------------------------------------------- the module and its seam
check('G0.1', 'module app/claude-gateway.js exports the core', () => {
  if (G.missing) return G.missing;
  const want = ['VERDICTS', 'chain', 'passHeaders', 'harnessHeaders', 'admit', 'onRequest', 'normaliseCache', 'registerReducer', 'streamInit', 'streamStep', 'sseSplit', 'sseFormat'];
  const absent = want.filter(n => !(n in G));
  return absent.length ? 'missing: ' + absent.join(',') : true;
});
check('G0.2', 'the core is pure: no import, no socket, no DOM, no clock, no timer in its source', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'claude-gateway.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const bad = [/^\s*import\s[^;]*from\s*['"](?:node:|[^./])/m, /\brequire\s*\(/, /\bprocess\b/, /\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/, /\bperformance\b/];
  const hit = bad.filter(r => r.test(src)).map(String);
  return hit.length ? hit : true;
});

// ---------------------------------------------------------------- G1 header pass-through, credential blindness (R3, R18)
const CANARY = 'Bearer test-not-a-token-CANARY-1', CANARY2 = 'test-not-a-key-CANARY-2', CANARY3 = 'oauth-2025-04-20-CANARY-3';
check('G1.1', 'every Claude Code header is forwarded in order with the very same value, none read (credential headers included)', () => {
  const names = ['Authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'anthropic-beta', 'x-claude-code-session-id', 'x-claude-code-agent-id', 'anthropic-future-header', 'content-type'];
  const pairs = names.map(n => [n, guarded(n)]);
  const r = G.passHeaders(pairs);
  return r.headers.length === pairs.length && r.headers.every(([n, v], i) => n === pairs[i][0] && v === pairs[i][1]) || J(r.headers.map(h => h[0]));
});
check('G1.2', 'hop-by-hop host and connection are not forwarded, nothing else is dropped', () => {
  const pairs = [['Host', 'h'], ['connection', 'keep-alive'], ['anthropic-version', '2023-06-01'], ['x-some-future-header', 'x']];
  const r = G.passHeaders(pairs);
  return eq(r.headers.map(h => h[0]), ['anthropic-version', 'x-some-future-header']) || J(r.headers.map(h => h[0]));
});
check('G1.3', 'the trace holds header names only, lower case, in order; no value is in it', () => {
  const pairs = [['Authorization', CANARY], ['X-Api-Key', CANARY2], ['anthropic-beta', CANARY3], ['x-claude-code-session-id', 'sess-1']];
  const r = G.passHeaders(pairs);
  const t = J(r.trace);
  return eq(r.trace.names, ['authorization', 'x-api-key', 'anthropic-beta', 'x-claude-code-session-id']) && ![CANARY, CANARY2, CANARY3, 'sess-1'].some(c => t.includes(c)) || t;
});
check('G1.4', 'the pairs given are not changed', () => {
  const pairs = deepFreeze([['Authorization', CANARY], ['Host', 'h']]);
  G.passHeaders(pairs);
  return true;
});
check('G1.5', 'harness listener: client authorization and x-api-key are dropped, its own x-api-key comes from the call, other headers stay', () => {
  const pairs = [['Authorization', CANARY], ['x-api-key', CANARY2], ['content-type', 'application/json'], ['accept', 'text/event-stream']];
  const r = G.harnessHeaders(pairs, { apiKey: 'test-not-a-key-OWN' });
  const keys = r.headers.map(h => h[0].toLowerCase());
  const own = r.headers.filter(h => h[0].toLowerCase() === 'x-api-key');
  return r.verdict === 'allow' && !keys.includes('authorization') && own.length === 1 && own[0][1] === 'test-not-a-key-OWN' && keys.includes('content-type') && keys.includes('accept') && !J(r.headers).includes('CANARY') || J(r);
});
check('G1.6', 'harness listener: no apiKey fails closed, with a reason code and no client credential in the answer', () => {
  const r = G.harnessHeaders([['Authorization', CANARY], ['x-api-key', CANARY2]], {});
  return r.verdict === 'reject' && r.status >= 400 && typeof r.reason === 'string' && r.reason.length > 0 && !('headers' in r) && !J(r).includes('CANARY') || J(r);
});
check('G1.7', 'harness listener: the key is read per call and kept nowhere (a call after one with a key has none)', () => {
  const a = G.harnessHeaders([['content-type', 'x']], { apiKey: 'test-not-a-key-A' });
  const b = G.harnessHeaders([['content-type', 'x']], { apiKey: 'test-not-a-key-B' });
  const c = G.harnessHeaders([['content-type', 'x']], {});
  const own = r => r.headers.find(h => h[0].toLowerCase() === 'x-api-key')?.[1];
  return own(a) === 'test-not-a-key-A' && own(b) === 'test-not-a-key-B' && c.verdict === 'reject' || J([a, b, c]);
});
check('G1.8', 'harness listener: the trace has names only, the container key is not in it', () => {
  const r = G.harnessHeaders([['Authorization', CANARY], ['content-type', 'x']], { apiKey: 'test-not-a-key-OWN' });
  const t = J(r.trace);
  return Array.isArray(r.trace?.names) && !t.includes('CANARY') && !t.includes('OWN') || t;
});

// ---------------------------------------------------------------- G2 origin boundary (R16)
const hdr = (...names) => names.map(n => [n, 'v']);
const cc = { method: 'POST', path: '/v1/messages?beta=true', headers: [['X-Claude-Code-Session-Id', 'sess-1'], ['anthropic-version', '2023-06-01'], ['Authorization', CANARY]] };
const is4xx = r => r.verdict === 'reject' && r.status >= 400 && r.status < 500;
check('G2.1', 'Claude Code listener: a Claude Code shaped request is admitted (header name in any case, query string allowed)', () => G.admit('claude-code', cc).verdict === 'allow');
check('G2.2', 'Claude Code listener: count_tokens is admitted', () => G.admit('claude-code', { ...cc, path: '/v1/messages/count_tokens' }).verdict === 'allow');
check('G2.3', 'Claude Code listener: no session header is a 4xx, credentials or not', () => {
  const r = G.admit('claude-code', { ...cc, headers: [['Authorization', CANARY], ['x-api-key', CANARY2], ['anthropic-version', '2023-06-01']] });
  return is4xx(r) && !J(r).includes('CANARY') || J(r);
});
check('G2.4', 'Claude Code listener: other routes and methods are a 4xx', () => {
  const rs = [{ ...cc, method: 'GET' }, { ...cc, path: '/v1/chat/completions' }, { ...cc, path: '/v1/models' }, { ...cc, path: '/v1/messages/batches' }, { ...cc, path: '/' }].map(q => G.admit('claude-code', q));
  return rs.every(is4xx) || J(rs);
});
check('G2.5', 'harness listener: the page shape is admitted (chat completions, models)', () => {
  const h = [['content-type', 'application/json'], ['Authorization', 'Bearer test-not-a-token']];
  return G.admit('harness', { method: 'POST', path: '/v1/chat/completions', headers: h }).verdict === 'allow' && G.admit('harness', { method: 'GET', path: '/v1/models', headers: h }).verdict === 'allow';
});
check('G2.6', 'harness listener: any x-claude-code-* header is a 4xx, and no credential is in the answer', () => {
  const base = { method: 'POST', path: '/v1/chat/completions' };
  const rs = [['x-claude-code-session-id'], ['X-Claude-Code-Agent-Id'], ['x-claude-code-request-class']].map(h => G.admit('harness', { ...base, headers: [['Authorization', CANARY], [h[0], 'v']] }));
  return rs.every(is4xx) && !J(rs).includes('CANARY') || J(rs);
});
check('G2.7', 'harness listener: the Messages route is a 4xx', () => is4xx(G.admit('harness', { method: 'POST', path: '/v1/messages', headers: [['content-type', 'x']] })));
check('G2.8', 'an unknown listener name throws (no default route)', () => typeof G.admit === 'function' && throws(() => G.admit('both', cc)));

// ---------------------------------------------------------------- G3 request pass-through is the default (R15 off, R17)
const ATTR = 'attribution-block-test';
const body0 = () => ({
  model: 'claude-test', max_tokens: 16000, stream: true, future_top_level: { nested: [1, { x: null }], 'z-first': true },
  thinking: { type: 'enabled', budget_tokens: 8000 }, output_config: { effort: 'high' }, metadata: { user_id: 'synthetic' },
  tools: [{ name: 'a', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } }, { name: 'b', input_schema: { type: 'object' } }],
  system: [{ type: 'text', text: ATTR }, { type: 'text', text: 'You are a test.', cache_control: { type: 'ephemeral', ttl: '1h' } }, { type: 'text', text: 'Rules.', cache_control: { type: 'ephemeral' } }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'q1', cache_control: { type: 'ephemeral' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
    { role: 'user', content: [{ type: 'text', text: 'q2', cache_control: { type: 'ephemeral' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r' }, { type: 'text', text: 'q3', cache_control: { type: 'ephemeral' } }] },
  ],
});
check('G3.1', 'no policy, or an empty one: the body comes back byte for byte (field order too), nothing applied, the input untouched', () => {
  const b = deepFreeze(body0());
  const a = G.onRequest({}, b, undefined), c = G.onRequest({}, b, {});
  return J(a.body) === J(body0()) && J(c.body) === J(body0()) && eq(a.applied, []) && eq(c.applied, []) || J(a);
});
check('G3.2', 'a policy that names a class of request it does not apply to changes nothing (ctx.class subagent: thinking policy)', () => {
  const r = G.onRequest({ class: 'subagent' }, deepFreeze(body0()), { thinking: { maxBudget: 2000, maxEffort: 'low' } });
  return J(r.body) === J(body0()) && eq(r.applied, []) || J(r.applied);
});
check('G3.3', 'with every policy on, system keeps length, order and element 0 byte for byte; messages keep their text and order', () => {
  const r = G.onRequest({ class: 'main' }, deepFreeze(body0()), { cache: { normalise: true }, thinking: { maxBudget: 2000, maxEffort: 'medium' } });
  const a = body0();
  const strip = m => m.map(x => ({ role: x.role, content: x.content.map(c => { const { cache_control, ...rest } = c; return rest; }) }));
  return J(r.body.system[0]) === J(a.system[0]) && r.body.system.length === 3 && eq(r.body.system.map(s => s.text), a.system.map(s => s.text)) && eq(strip(r.body.messages), strip(a.messages)) && eq(r.body.future_top_level, a.future_top_level) && r.body.max_tokens === 16000 || J(r.body.system);
});

// ---------------------------------------------------------------- G4 cache_control normalisation (R15, hypothesis-level invariants)
const mk = (text, cc) => ({ type: 'text', text, ...(cc ? { cache_control: cc } : {}) });
const E = { type: 'ephemeral' };
const F2 = { model: 'm', max_tokens: 10, messages: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ role: i % 2 ? 'assistant' : 'user', content: [mk('m' + i, i % 2 ? null : E)] })) };
const F3 = { model: 'm', max_tokens: 10, system: 'a plain string system', tools: [{ name: 'a', input_schema: {} }], messages: [{ role: 'user', content: 'plain string content' }, { role: 'assistant', content: [mk('a1')] }, { role: 'user', content: [mk('q2')] }] };
const F4 = { model: 'm', max_tokens: 10, system: [mk(ATTR), mk('s1', E)], messages: [{ role: 'user', content: [mk('q1', { type: 'ephemeral', ttl: '1h' })] }] };
const FIXTURES = [body0(), F2, F3, F4];
const markers = b => {
  const out = [];
  (b.tools || []).forEach((t, i) => t.cache_control && out.push('tools.' + i));
  if (Array.isArray(b.system)) b.system.forEach((s, i) => s.cache_control && out.push('system.' + i));
  b.messages.forEach((m, i) => Array.isArray(m.content) && m.content.forEach((c, j) => c.cache_control && out.push(`messages.${i}.${j}`)));
  return out;
};
const stripCc = v => Array.isArray(v) ? v.map(stripCc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'cache_control').map(([k, x]) => [k, stripCc(x)])) : v;
check('G4.1', 'golden: six markers over the limit become four: the tool marker moves to the last tool, system markers stay, the oldest message markers go', () => {
  const r = G.normaliseCache(deepFreeze(body0()));
  return eq(markers(r), ['tools.1', 'system.1', 'system.2', 'messages.4.1']) || J(markers(r));
});
check('G4.2', 'golden: a kept marker keeps its own fields (ttl 1h on system 1), and the moved marker is the same marker', () => {
  const r = G.normaliseCache(deepFreeze(body0()));
  return eq(r.system[1].cache_control, { type: 'ephemeral', ttl: '1h' }) && eq(r.tools[1].cache_control, { type: 'ephemeral' }) && !('cache_control' in r.tools[0]) || J(r.tools);
});
check('G4.3', 'golden: only messages: nine messages, five markers: the newest four stay', () => {
  const r = G.normaliseCache(deepFreeze(clone(F2)));
  return eq(markers(r), ['messages.2.0', 'messages.4.0', 'messages.6.0', 'messages.8.0']) || J(markers(r));
});
check('G4.4', 'idempotent: normalising twice is normalising once, on every fixture', () => FIXTURES.every(f => { const once = G.normaliseCache(clone(f)); return J(G.normaliseCache(clone(once))) === J(once); }));
check('G4.5', 'content outside cache_control fields never changes, on every fixture', () => FIXTURES.every(f => eq(stripCc(G.normaliseCache(deepFreeze(clone(f)))), stripCc(f))));
check('G4.6', 'system keeps length, order and element 0 byte for byte; a string system stays a string', () => FIXTURES.every(f => {
  const r = G.normaliseCache(deepFreeze(clone(f)));
  if (typeof f.system === 'string') return r.system === f.system;
  return !f.system ? r.system === undefined : r.system.length === f.system.length && J(r.system[0]) === J(f.system[0]) && eq(r.system.map(s => s.text), f.system.map(s => s.text));
}));
check('G4.7', 'at most four markers remain, and never more than there were', () => FIXTURES.every(f => { const n = markers(G.normaliseCache(clone(f))).length; return n <= 4 && n <= markers(f).length; }));
check('G4.8', 'a request with no marker stays without (nothing is placed), a string content stays a string', () => {
  const f = { ...F3, tools: undefined, system: undefined };
  delete f.tools; delete f.system;
  const r = G.normaliseCache(deepFreeze(clone(f)));
  return markers(r).length === 0 && J(r) === J(f) || J(r);
});
check('G4.9', 'the policy is an option: onRequest applies it only when policy.cache.normalise is set, and says so in applied', () => {
  const off = G.onRequest({}, deepFreeze(body0()), { cache: {} });
  const on = G.onRequest({}, deepFreeze(body0()), { cache: { normalise: true } });
  return markers(off.body).length === 6 && eq(off.applied, []) && eq(markers(on.body), ['tools.1', 'system.1', 'system.2', 'messages.4.1']) && on.applied.length === 1 && typeof on.applied[0] === 'string' || J([off.applied, on.applied]);
});

// ---------------------------------------------------------------- G5 thinking parameter policy
const think = (t, effort) => ({ model: 'm', max_tokens: 16000, ...(t ? { thinking: t } : {}), ...(effort ? { output_config: { effort } } : {}), messages: [{ role: 'user', content: 'x' }] });
const TP = (b, p, ctx = {}) => G.onRequest(ctx, deepFreeze(clone(b)), { thinking: p }).body;
check('G5.1', 'no thinking policy: thinking and effort are left as sent', () => J(G.onRequest({}, deepFreeze(think({ type: 'enabled', budget_tokens: 8000 }, 'high')), {}).body) === J(think({ type: 'enabled', budget_tokens: 8000 }, 'high')));
check('G5.2', 'maxBudget clamps a larger budget_tokens, leaves a smaller or equal one, and changes nothing else', () => {
  const big = TP(think({ type: 'enabled', budget_tokens: 8000 }), { maxBudget: 2000 });
  const small = TP(think({ type: 'enabled', budget_tokens: 1500 }), { maxBudget: 2000 });
  const same = TP(think({ type: 'enabled', budget_tokens: 2000 }), { maxBudget: 2000 });
  return big.thinking.budget_tokens === 2000 && big.thinking.type === 'enabled' && big.max_tokens === 16000 && small.thinking.budget_tokens === 1500 && same.thinking.budget_tokens === 2000 || J([big, small, same]);
});
check('G5.3', 'the clamp never goes under the API minimum of 1024', () => TP(think({ type: 'enabled', budget_tokens: 8000 }), { maxBudget: 100 }).thinking.budget_tokens === 1024);
check('G5.4', 'nothing is added: no thinking field stays none, disabled and adaptive have no budget to clamp', () => {
  const none = TP(think(null), { maxBudget: 2000 });
  const off = TP(think({ type: 'disabled' }), { maxBudget: 2000 });
  const ad = TP(think({ type: 'adaptive' }), { maxBudget: 2000 });
  return !('thinking' in none) && !('output_config' in none) && eq(off.thinking, { type: 'disabled' }) && eq(ad.thinking, { type: 'adaptive' }) || J([none, off, ad]);
});
check('G5.5', 'maxEffort caps output_config.effort on low < medium < high < max, and never raises it', () => {
  const eff = (e, cap) => TP(think({ type: 'adaptive' }, e), { maxEffort: cap }).output_config.effort;
  return eff('max', 'medium') === 'medium' && eff('high', 'medium') === 'medium' && eff('medium', 'medium') === 'medium' && eff('low', 'medium') === 'low' && eff('high', 'max') === 'high' || J(['max', 'high', 'medium', 'low'].map(e => eff(e, 'medium')));
});
check('G5.6', 'the policy applies to main and to an unknown class, not to subagent, compaction or auxiliary', () => {
  const b = think({ type: 'enabled', budget_tokens: 8000 }, 'high');
  const ran = c => TP(b, { maxBudget: 2000, maxEffort: 'low' }, c).thinking.budget_tokens === 2000;
  return ran({}) && ran({ class: 'main' }) && !ran({ class: 'subagent' }) && !ran({ class: 'compaction' }) && !ran({ class: 'auxiliary' });
});
check('G5.7', 'applied names the policies that changed something and is empty when none did', () => {
  const a = G.onRequest({}, think({ type: 'enabled', budget_tokens: 8000 }), { thinking: { maxBudget: 2000 } });
  const b = G.onRequest({}, think({ type: 'enabled', budget_tokens: 1500 }), { thinking: { maxBudget: 2000 } });
  return a.applied.length === 1 && b.applied.length === 0 || J([a.applied, b.applied]);
});

// ---------------------------------------------------------------- the golden stream: text, a thinking block, a tool_use
const T1 = 'Let me think about ', T2 = 'the greeting.', X1 = 'Hello, ', X2 = 'world.', U1 = '{"path":', U2 = ' "a.txt"}';
const GOLD = [
  { type: 'message_start', message: { id: 'msg_test_1', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: 1 } } },
  { type: 'ping' },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: T1 } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: T2 } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-test-not-real' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: X1 } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: X2 } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_test_1', name: 'read_file', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: U1 } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: U2 } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } },
  { type: 'message_stop' },
];
const N_THINK = (T1 + T2).length, N_TEXT = (X1 + X2).length, N_TOOL = (U1 + U2).length; // 32, 13, 17
// a well-formed Messages stream: starts, every block opened is closed once in order, one message_delta with a stop_reason, one message_stop, last
const wellFormed = evs => {
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
};
const run = (listener, policy, events = GOLD, ctx = {}) => {
  let st = deepFreeze(G.streamInit(listener, policy, ctx));
  const out = [], steps = [];
  for (const e of events) { const r = G.streamStep(st, deepFreeze(clone(e))); st = deepFreeze(r.state); steps.push(r); out.push(...r.out); }
  return { out, state: st, steps };
};
const LISTENERS = ['claude-code', 'harness'];
const sliceEq = (out, k) => eq(out.slice(0, k), GOLD.slice(0, k));

// ---------------------------------------------------------------- G6 stream state machine: pass-through, counters, purity
check('G6.1', 'no policy: every event comes out as it went in, verdict allow, on both listeners; the stream ends done', () => LISTENERS.every(l => {
  const r = run(l, {});
  return eq(r.out, GOLD) && r.steps.every(s => s.verdict.verdict === 'allow' && !s.abort) && r.state.done === true && r.state.halt === null;
}));
check('G6.2', 'counters: characters per block kind, counted from deltas (signature and ping are not text)', () => {
  const r = run('claude-code', {});
  return eq(r.state.chars, { text: N_TEXT, thinking: N_THINK, tool_use: N_TOOL }) || J(r.state.chars);
});
check('G6.3', 'usage is read from the stream: input, cache read and creation from message_start, output from the last message_delta', () => {
  const r = run('claude-code', {});
  return eq(r.state.usage, { input_tokens: 25, output_tokens: 42, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }) || J(r.state.usage);
});
check('G6.4', 'ping and an upstream error pass untouched and uncounted; an error is not masked with a synthetic stop', () => {
  const err = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } };
  const r = run('claude-code', { budget: { total: 1 } }, [GOLD[0], GOLD[1], err]);
  return eq(r.out, [GOLD[0], GOLD[1], err]) && eq(r.state.chars, { text: 0, thinking: 0, tool_use: 0 }) && !r.steps.some(s => s.abort) || J(r.out);
});
check('G6.5', 'pure and deterministic: a frozen state in, no throw; the same input twice gives the same output; a JSON copy of the state gives the same next step', () => {
  const pol = { budget: { text: 10 } };
  const a = run('claude-code', pol), b = run('claude-code', pol);
  const mid = (() => { let st = G.streamInit('claude-code', pol, {}); for (const e of GOLD.slice(0, 5)) st = G.streamStep(st, e).state; return st; })();
  const x = G.streamStep(clone(mid), clone(GOLD[5])), y = G.streamStep(mid, clone(GOLD[5]));
  return eq(a, b) && eq(x, y) || 'differs';
});
check('G6.6', 'no clock, no timer, no randomness: the stream and request functions run with all of them removed', () => {
  const via = sealed(() => [run('harness', { budget: { thinking: 20 } }).out.length, G.onRequest({}, clone(body0()), { cache: { normalise: true }, thinking: { maxBudget: 2000 } }).applied.length, G.admit('claude-code', cc).verdict, G.passHeaders([['x', 'y']]).headers.length]);
  return eq(via, [8, 2, 'allow', 1]) || J(via);
});
check('G6.7', 'the state is plain JSON: it survives a JSON round trip unchanged', () => { const s = run('harness', { budget: { total: 20 } }).state; return eq(JSON.parse(JSON.stringify(s)), s); });

// ---------------------------------------------------------------- G7 halt: always a complete stream (R4, R5, R14 invariant, R17)
check('G7.1', 'harness listener: a thinking budget cuts the thinking block at the delta that reaches it, closes it, and ends the message', () => {
  const r = run('harness', { budget: { thinking: 20 } });
  const k = 5; // GOLD[0..4] delivered, the delta GOLD[4] crossed 20 (19, then 32)
  const [stop, md, ms] = r.out.slice(k);
  return sliceEq(r.out, k) && r.out.length === k + 3 && eq(stop, { type: 'content_block_stop', index: 0 }) && md.type === 'message_delta' && md.delta.stop_reason === 'end_turn' && md.delta.stop_sequence === null && md.usage.output_tokens === Math.ceil(N_THINK / 4) && eq(ms, { type: 'message_stop' }) && wellFormed(r.out) === true || J(r.out.slice(k));
});
check('G7.2', 'Claude Code listener: the same thinking budget waits for the thinking block to end (signature delivered, block untouched), then ends the message', () => {
  const r = run('claude-code', { budget: { thinking: 20 } });
  const k = 7; // GOLD[0..6]: the whole thinking block, its stop included
  return sliceEq(r.out, k) && r.out.length === k + 2 && r.out[k].type === 'message_delta' && r.out[k + 1].type === 'message_stop' && wellFormed(r.out) === true && r.out.some(e => e.delta?.type === 'signature_delta') || J(r.out.map(e => e.type));
});
check('G7.3', 'Claude Code listener: a text budget cuts the text block at the delta that reaches it; thinking before it is whole', () => {
  const r = run('claude-code', { budget: { text: N_TEXT } });
  const k = 10; // GOLD[0..9]: the second text delta reaches the budget exactly
  const [stop, md, ms] = r.out.slice(k);
  return sliceEq(r.out, k) && r.out.length === k + 3 && eq(stop, { type: 'content_block_stop', index: 1 }) && md.usage.output_tokens === Math.ceil((N_THINK + N_TEXT) / 4) && ms.type === 'message_stop' && wellFormed(r.out) === true || J(r.out.slice(k));
});
check('G7.4', 'the budget is reached, not exceeded: one character more and the stream goes through whole', () => LISTENERS.every(l => eq(run(l, { budget: { text: N_TEXT + 1 } }).out, GOLD) && run(l, { budget: { text: N_TEXT } }).state.halt !== null));
check('G7.5', 'a tool_use block is never cut: a total budget reached inside it waits for its stop, and its input parses', () => LISTENERS.every(l => {
  const r = run(l, { budget: { total: N_THINK + N_TEXT + 5 } });
  const k = 15; // GOLD[0..14]: the whole tool_use block, its stop included
  const input = r.out.filter(e => e.delta?.type === 'input_json_delta').map(e => e.delta.partial_json).join('');
  let parsed = null; try { parsed = JSON.parse(input); } catch {}
  return sliceEq(r.out, k) && r.out.length === k + 2 && eq(parsed, { path: 'a.txt' }) && wellFormed(r.out) === true && r.state.halt?.chars === N_THINK + N_TEXT + N_TOOL || J(r.out.map(e => e.type));
}));
check('G7.6', 'halt is the verdict reject with a reason code and abort, on the step that ends the stream; the state records it', () => {
  const r = run('harness', { budget: { thinking: 20 } });
  const last = r.steps.find(s => s.abort);
  return last && last.verdict.verdict === 'reject' && typeof last.verdict.reason === 'string' && last.verdict.reason.length > 0 && r.state.halt?.reason === last.verdict.reason && r.state.halt.chars === N_THINK && r.state.done === true && r.steps.filter(s => s.abort).length === 1 || J(r.steps.map(s => [s.verdict, s.abort]));
});
check('G7.7', 'after a halt the rest of the upstream stream is swallowed: out [], the verdict stays reject, abort is not asked again, the state does not change', () => {
  const r = run('harness', { budget: { thinking: 20 } });
  const at = r.steps.findIndex(s => s.abort);
  const rest = r.steps.slice(at + 1);
  return at === 4 && rest.length === GOLD.length - 5 && rest.every(s => eq(s.out, []) && s.verdict.verdict === 'reject' && !s.abort && eq(s.state, r.steps[at].state)) || J(rest.map(s => [s.out.length, s.verdict, s.abort]));
});
check('G7.8', 'the stop_reason of the synthetic end is policy.haltStopReason, end_turn when none is given', () => {
  const a = run('claude-code', { budget: { text: 5 } }).out.find(e => e.type === 'message_delta');
  const b = run('claude-code', { budget: { text: 5 }, haltStopReason: 'max_tokens' }).out.find(e => e.type === 'message_delta');
  return a.delta.stop_reason === 'end_turn' && b.delta.stop_reason === 'max_tokens' || J([a, b]);
});
check('G7.9', 'the token estimate in the synthetic message_delta is the characters counted so far over four, rounded up, and is what the state reports', () => {
  const r = run('harness', { budget: { total: 40 } }); // reached at the second text delta: 32 + 13
  const md = r.out.find(e => e.type === 'message_delta');
  return md.usage.output_tokens === Math.ceil((N_THINK + N_TEXT) / 4) && r.state.usage.output_tokens === md.usage.output_tokens || J([md.usage, r.state.usage]);
});
check('G7.10', 'the invariant: for every budget kind and size 1..70 and both listeners the whole output is a well-formed stream, and a halted one ends in message_stop with abort set', () => {
  const bad = [];
  for (const l of LISTENERS) for (const kind of ['text', 'thinking', 'total']) for (let n = 1; n <= 70; n++) {
    const r = run(l, { budget: { [kind]: n } });
    const w = wellFormed(r.out);
    const halted = r.state.halt !== null;
    if (w !== true || (halted && (!r.steps.some(s => s.abort) || r.out.at(-1).type !== 'message_stop')) || (!halted && !eq(r.out, GOLD))) bad.push([l, kind, n, w]);
  }
  return bad.length ? J(bad.slice(0, 3)) : true;
});
check('G7.11', 'the thinking blocks of the Claude Code listener are never altered or dropped by any budget: every thinking event of the input is in the output as sent', () => {
  const think = GOLD.slice(2, 7);
  for (const kind of ['text', 'thinking', 'total']) for (let n = 1; n <= 70; n++) {
    const r = run('claude-code', { budget: { [kind]: n } });
    if (!think.every(e => r.out.some(o => eq(o, e)))) return [kind, n];
  }
  return true;
});

// ---------------------------------------------------------------- G8 alter, the reducer hook (R6b, R7, R17)
let reducerCalls = [];
check('G8.1', 'the registry: a reducer is registered by name; a taken name and a non-function throw', () => {
  G.registerReducer('mock-upper', (t, info) => { reducerCalls.push([t, info]); return t.toUpperCase(); });
  G.registerReducer('mock-drop-thinking', () => '');
  return throws(() => G.registerReducer('mock-upper', t => t)) && throws(() => G.registerReducer('mock-bad', 'not a function'));
});
check('G8.2', 'an unknown reducer name throws when the stream is set up, not mid-stream', () => typeof G.streamInit === 'function' && throws(() => G.streamInit('harness', { reduce: [{ on: 'text', name: 'no-such-reducer' }] }, {})));
check('G8.3', 'Claude Code listener: a text reducer alters the text deltas (verdict alter), and only the text of them', () => {
  reducerCalls = [];
  const r = run('claude-code', { reduce: [{ on: 'text', name: 'mock-upper' }] });
  const want = GOLD.map(e => e.delta?.type === 'text_delta' ? { ...e, delta: { ...e.delta, text: e.delta.text.toUpperCase() } } : e);
  const alt = r.steps.filter(s => s.verdict.verdict === 'alter').length;
  return eq(r.out, want) && alt === 2 && r.steps.every(s => ['allow', 'alter'].includes(s.verdict.verdict)) && wellFormed(r.out) === true || J(r.out.filter(e => e.delta?.type === 'text_delta'));
});
check('G8.4', 'the reducer is called per delta with the text and its kind and block index, in stream order', () => eq(reducerCalls.map(c => [c[0], c[1].kind, c[1].index]), [[X1, 'text', 1], [X2, 'text', 1]]) || J(reducerCalls));
check('G8.5', 'Claude Code listener: a thinking reducer is ignored (thinking blocks are never altered there, R17): the stream is as it came', () => {
  const r = run('claude-code', { reduce: [{ on: 'thinking', name: 'mock-drop-thinking' }] });
  return eq(r.out, GOLD) && r.steps.every(s => s.verdict.verdict === 'allow') || J(r.steps.map(s => s.verdict));
});
check('G8.6', 'harness listener: a thinking reducer alters thinking text on the harness copy; the signature and other events stay', () => {
  const r = run('harness', { reduce: [{ on: 'thinking', name: 'mock-upper' }] });
  const want = GOLD.map(e => e.delta?.type === 'thinking_delta' ? { ...e, delta: { ...e.delta, thinking: e.delta.thinking.toUpperCase() } } : e);
  return eq(r.out, want) || J(r.out.slice(3, 6));
});
check('G8.7', 'alteration does not touch the counters or the budget: they count what the upstream sent', () => {
  const r = run('harness', { reduce: [{ on: 'text', name: 'mock-drop-thinking' }], budget: { text: N_TEXT } });
  return r.state.chars.text === N_TEXT && r.state.halt?.reason !== undefined && wellFormed(r.out) === true || J(r.state);
});
check('G8.8', 'an event altered is a new object: the event given is not changed', () => {
  const ev = deepFreeze(clone(GOLD[8]));
  const st = G.streamInit('claude-code', { reduce: [{ on: 'text', name: 'mock-upper' }] }, {});
  const r = G.streamStep(G.streamStep(st, deepFreeze(clone(GOLD[0]))).state, ev);
  return r.out[0] !== ev && r.out[0].delta.text === X1.toUpperCase() && ev.delta.text === X1;
});

// ---------------------------------------------------------------- G9 verdict vocabulary (agent-tap)
check('G9.1', 'the verdict words are allow, reject, alter, hold', () => eq([...G.VERDICTS].sort(), ['allow', 'alter', 'hold', 'reject']));
check('G9.2', 'chain: the first handler that does not allow wins; none left means allow', () => {
  const allow = () => ({ verdict: 'allow' }), rej = () => ({ verdict: 'reject', status: 403, reason: 'r' }), alt = () => ({ verdict: 'alter', event: { type: 'ping' } });
  return G.chain([allow, alt, rej])({}).verdict === 'alter' && G.chain([allow, rej, alt])({}).verdict === 'reject' && G.chain([allow])({}).verdict === 'allow' && G.chain([])({}).verdict === 'allow';
});
check('G9.3', 'chain: a hold comes back as given, with its own timeout data, and nothing is waited for (no timer exists in the core)', () => {
  const hold = { verdict: 'hold', timeoutMs: 120000, then: 'allow' };
  const r = sealed(() => G.chain([() => ({ verdict: 'allow' }), () => hold, () => ({ verdict: 'reject', status: 403, reason: 'r' })])({ any: 1 }));
  return eq(r, hold) || J(r);
});
check('G9.4', 'chain: each handler gets the input given, and a handler after the winner is not called', () => {
  const seen = []; const input = { path: '/v1/messages' };
  G.chain([x => (seen.push(['a', x]), { verdict: 'allow' }), x => (seen.push(['b', x]), { verdict: 'reject', status: 400, reason: 'r' }), x => (seen.push(['c', x]), { verdict: 'allow' })])(input);
  return seen.length === 2 && seen[0][1] === input && seen[1][1] === input || J(seen.map(s => s[0]));
});

// ---------------------------------------------------------------- G10 SSE codec (the golden stream as bytes)
const FRAME = e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const GOLD_TEXT = GOLD.map(FRAME).join('');
check('G10.1', 'a frame is `event: <type>`, `data: <json>` and a blank line', () => G.sseFormat({ type: 'ping' }) === 'event: ping\ndata: {"type":"ping"}\n\n');
check('G10.2', 'the golden stream parses to its events and formats back to the same bytes', () => {
  const r = G.sseSplit(GOLD_TEXT);
  return eq(r.events, GOLD) && r.rest === '' && GOLD.map(G.sseFormat).join('') === GOLD_TEXT;
});
check('G10.3', 'cut anywhere (every split point, and one character at a time) the events come out the same and the cut frame waits in rest', () => {
  for (let i = 1; i < GOLD_TEXT.length; i += 7) {
    const a = G.sseSplit(GOLD_TEXT.slice(0, i));
    const b = G.sseSplit(a.rest + GOLD_TEXT.slice(i));
    if (!eq([...a.events, ...b.events], GOLD) || b.rest !== '') return i;
  }
  let rest = '', evs = [];
  for (const ch of GOLD_TEXT) { const r = G.sseSplit(rest + ch); evs.push(...r.events); rest = r.rest; }
  return eq(evs, GOLD) && rest === '';
});
check('G10.4', 'comment lines (keep-alives) between frames are skipped and frames split with CRLF parse alike', () => {
  const t = ': keep-alive\n\n' + FRAME(GOLD[1]) + ':\n\n' + FRAME(GOLD[2]);
  const u = (FRAME(GOLD[1]) + FRAME(GOLD[2])).replace(/\n/g, '\r\n');
  return eq(G.sseSplit(t).events, [GOLD[1], GOLD[2]]) && eq(G.sseSplit(u).events, [GOLD[1], GOLD[2]]) || J([G.sseSplit(t), G.sseSplit(u)]);
});

// ---------------------------------------------------------------- G11 the provider entry (seam: providers; R2)
const entry = P.providers.claude;
check('G11.1', 'the registry has a claude entry in the provider shape, no key needed, aimed at a loopback listener', () => entry && typeof entry.label === 'string' && entry.label.length > 0 && entry.needsKey === false && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(entry.base) && typeof entry.models === 'function' && typeof entry.stream === 'function' || J(entry));
check('G11.2', 'the other entries are as they were (openrouter needs a key, mock none)', () => P.providers.openrouter.needsKey === true && P.providers.mock.needsKey === false);
check('G11.3', 'the entry holds no key, token or secret field, and serialising it shows none', () => {
  const bad = Object.keys(entry).filter(k => /key|token|secret|auth|bearer/i.test(k) && k !== 'needsKey');
  return bad.length === 0 && !/sk-ant|bearer|CANARY/i.test(JSON.stringify(entry)) || J(bad);
});

const realFetch = globalThis.fetch;
const sseBody = chunks => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const CHUNKS = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'];
const standIn = queue => { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); const next = queue.shift(); return typeof next === 'function' ? next() : next; }; return calls; };
const drain = async gen => { const out = []; try { for await (const e of gen) out.push(e); } catch (err) { return { out, err }; } return { out }; };
try {
  await checkAsync('G11.4', 'a request goes to the entry base with the body as given; the chunks come back; the trace records no key', async () => {
    const calls = standIn([() => sseBody(CHUNKS)]);
    const trace = [], body = { model: 'claude-test', stream: true, messages: [{ role: 'user', content: 'x' }] };
    const r = await drain(entry.stream(body, 'test-not-a-key-RUN1', undefined, { trace }));
    return !r.err && calls[0].url === entry.base + '/chat/completions' && J(JSON.parse(calls[0].init.body)) === J(body) && r.out[0].choices[0].delta.content === 'hi' && trace.length === 1 && !J(trace).includes('RUN1') && !J(entry).includes('RUN1') || J([r.err?.message, calls[0]?.url, trace]);
  });
  await checkAsync('G11.5', 'the key is the caller’s, per call: two calls carry their own, and the entry is the same after both', async () => {
    const calls = standIn([() => sseBody(CHUNKS), () => sseBody(CHUNKS)]);
    const before = J(entry);
    await drain(entry.stream({ model: 'm', stream: true, messages: [] }, 'test-not-a-key-A1', undefined, {}));
    await drain(entry.stream({ model: 'm', stream: true, messages: [] }, 'test-not-a-key-B2', undefined, {}));
    const auth = c => Object.entries(c.init.headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
    return auth(calls[0]).includes('A1') && !auth(calls[0]).includes('B2') && auth(calls[1]).includes('B2') && !auth(calls[1]).includes('A1') && J(entry) === before && !J(entry).includes('A1') && !J(entry).includes('B2') || J(calls.map(auth));
  });
  await checkAsync('G11.6', 'it sits behind the retry of the seam: a 502 before the first chunk is asked again, no other change (R12)', async () => {
    const calls = standIn([() => new Response('{"error":{"message":"bad gateway"}}', { status: 502 }), () => sseBody(CHUNKS)]);
    const opt = { retryDelays: [0, 0] };
    const r = await drain(entry.stream({ model: 'm', stream: true, messages: [] }, '', undefined, opt));
    return !r.err && calls.length === 2 && opt.retries === 1 && r.out.length === 2 || J([r.err?.message, calls.length, opt.retries]);
  });
  await checkAsync('G11.7', 'opt.base moves the entry to another loopback port (the existing base-URL setting)', async () => {
    const calls = standIn([() => sseBody(CHUNKS)]);
    await drain(entry.stream({ model: 'm', stream: true, messages: [] }, '', undefined, { base: 'http://127.0.0.1:9/v1' }));
    return calls[0].url === 'http://127.0.0.1:9/v1/chat/completions' || calls[0].url;
  });
} finally { globalThis.fetch = realFetch; }

console.log(fails ? `\ngateway: ${fails} failed` : '\ngateway: all passed');
process.exitCode = fails ? 1 : 0;
