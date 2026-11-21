// Claude route gateway core (docs/platform/claude-route-survey.md, hypotheses R1..R18; checks: scripts/test-gateway.mjs).
// A pure policy core: plain functions over request objects, header pair lists and Messages stream events. No import, no
// socket, no DOM, no clock, no timer, no randomness. The listeners (node, later) own bytes, sockets and time.
//
// Sections: verdicts and chain; headers (credential-blind); origin boundary; request policy (cache_control, thinking);
// reducer registry; stream state machine (budget, halt, alter); SSE codec.

// ---- verdicts (the agent-tap vocabulary): allow | reject | alter | hold
export const VERDICTS = Object.freeze(['allow', 'reject', 'alter', 'hold']);
const reject = (status, reason) => ({ verdict: 'reject', status, reason });

// The first verdict that is not allow wins; a hold is returned as given (it carries its own timeout data, nothing here waits).
export function chain(handlers) {
  return x => {
    for (const h of handlers) { const v = h(x); if (v && v.verdict !== 'allow') return v; }
    return { verdict: 'allow' };
  };
}

// ---- headers. Pairs are [name, value]; names are read, values are carried by reference and never touched.
const lower = n => String(n).toLowerCase();
const HOP = new Set(['host', 'connection']);
const carry = (pairs, drop) => pairs.filter(([n]) => !drop.has(lower(n))).map(([n, v]) => [n, v]);
const namesOf = headers => headers.map(([n]) => lower(n));

// Claude Code listener: a blind copy; only the hop-by-hop headers are not forwarded.
export function passHeaders(pairs) {
  const headers = carry(pairs, HOP);
  return { headers, trace: { names: namesOf(headers) } };
}

// Harness listener: an allowlist (R16: nothing else a client sends, cookies and proxy credentials included, goes upstream);
// the gateway's own key is given per call and kept nowhere.
const HARNESS_FORWARD = new Set(['content-type', 'accept', 'anthropic-version']);
export function harnessHeaders(pairs, opts) {
  const apiKey = opts?.apiKey;
  if (typeof apiKey !== 'string' || !apiKey) return reject(401, 'no-api-key');
  const headers = pairs.filter(([n]) => HARNESS_FORWARD.has(lower(n))).map(([n, v]) => [n, v]);
  headers.push(['x-api-key', apiKey]);
  return { verdict: 'allow', headers, trace: { names: namesOf(headers) } };
}

// ---- origin boundary (R16): a shape check per listener; the isolation itself is the unpublished listener.
const pathOf = p => String(p).split('?')[0];
const hasHeader = (headers, test) => (headers || []).some(([n]) => test(lower(n)));
const CC_ROUTES = new Set(['/v1/messages', '/v1/messages/count_tokens']);
const HARNESS_ROUTES = { '/v1/chat/completions': 'POST', '/v1/models': 'GET' };

function admitClaudeCode(r) {
  if (!CC_ROUTES.has(pathOf(r.path))) return reject(404, 'route');
  if (String(r.method).toUpperCase() !== 'POST') return reject(405, 'method');
  if (!hasHeader(r.headers, n => n === 'x-claude-code-session-id')) return reject(403, 'not-claude-code-shape');
  return { verdict: 'allow' };
}
function admitHarness(r) {
  if (hasHeader(r.headers, n => n.startsWith('x-claude-code-'))) return reject(403, 'claude-code-header');
  const want = HARNESS_ROUTES[pathOf(r.path)];
  if (!want || !Object.hasOwn(HARNESS_ROUTES, pathOf(r.path))) return reject(404, 'route');
  if (String(r.method).toUpperCase() !== want) return reject(405, 'method');
  return { verdict: 'allow' };
}
const ADMIT = { 'claude-code': admitClaudeCode, harness: admitHarness };
const LISTENERS = new Set(Object.keys(ADMIT));
const needListener = l => { if (!LISTENERS.has(l)) throw new Error('unknown listener: ' + String(l).slice(0, 40)); };

export function admit(listener, req) {
  needListener(listener);
  return ADMIT[listener](req);
}

// ---- request policy. Each policy is an option, off by default; a body with no policy comes back as given.
const markerHolders = b => {
  const out = [];
  (Array.isArray(b.tools) ? b.tools : []).forEach((o, i) => o?.cache_control && out.push({ o, area: 'tools', i }));
  (Array.isArray(b.system) ? b.system : []).forEach((o, i) => o?.cache_control && out.push({ o, area: 'system', i }));
  (b.messages || []).forEach(m => Array.isArray(m?.content) && m.content.forEach(o => o?.cache_control && out.push({ o, area: 'messages' })));
  return out;
};
// markers on tools other than the last move to the last tool (the last one's own marker wins when it has one)
function moveToolMarkers(b) {
  if (!Array.isArray(b.tools) || !b.tools.length) return;
  const last = b.tools.at(-1), early = b.tools.slice(0, -1).filter(t => t?.cache_control);
  if (!early.length) return;
  const moved = early.at(-1).cache_control;
  for (const t of early) delete t.cache_control;
  if (!last.cache_control) last.cache_control = moved;
}
const MAX_MARKERS = 4;
// over the limit, the oldest message markers go first, then system markers from element 1, then the tool marker; system[0] is never touched
function dropOver(b) {
  const all = markerHolders(b), excess = all.length - MAX_MARKERS;
  if (excess <= 0) return;
  const order = [...all.filter(x => x.area === 'messages'), ...all.filter(x => x.area === 'system' && x.i > 0), ...all.filter(x => x.area === 'tools')];
  for (const x of order.slice(0, excess)) delete x.o.cache_control;
}
// Removes or moves markers only; never places one. A copy is returned; the input is not changed.
export function normaliseCache(body) {
  const b = structuredClone(body);
  moveToolMarkers(b);
  dropOver(b);
  return b;
}

const MIN_BUDGET = 1024; // the API minimum for thinking.budget_tokens
const EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];
function clampBudget(body, maxBudget) {
  const t = body.thinking;
  if (!Number.isFinite(maxBudget) || !t || !Number.isFinite(t.budget_tokens)) return body;
  const cap = Math.max(MIN_BUDGET, Math.floor(maxBudget));
  return t.budget_tokens > cap ? { ...body, thinking: { ...t, budget_tokens: cap } } : body;
}
function capEffort(body, maxEffort) {
  const have = EFFORT.indexOf(body.output_config?.effort), cap = EFFORT.indexOf(maxEffort);
  return have >= 0 && cap >= 0 && have > cap ? { ...body, output_config: { ...body.output_config, effort: maxEffort } } : body;
}
const thinkingPolicy = (body, p) => capEffort(clampBudget(body, p.maxBudget), p.maxEffort);

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isMain = ctx => !ctx?.class || ctx.class === 'main';
const POLICIES = [
  { name: 'cache.normalise', on: (p) => p.cache?.normalise, apply: (b) => normaliseCache(b) },
  { name: 'thinking', on: (p, ctx) => p.thinking && isMain(ctx), apply: (b, p) => thinkingPolicy(b, p.thinking) },
];
// -> { body, applied }: applied names the policies that changed something
export function onRequest(ctx, body, policy) {
  const p = policy || {}, applied = [];
  let out = body;
  for (const pol of POLICIES) {
    if (!pol.on(p, ctx)) continue;
    const next = pol.apply(out, p);
    if (!same(next, out)) { out = next; applied.push(pol.name); }
  }
  return { body: out, applied };
}

// ---- reducers: fn(text, {kind, index}) -> text, by name, from a registry
const reducers = new Map();
export function registerReducer(name, fn) {
  if (typeof fn !== 'function') throw new Error('reducer ' + String(name) + ': not a function');
  if (reducers.has(name)) throw new Error('reducer name taken: ' + String(name));
  reducers.set(name, fn);
}
const checkReduce = r => {
  if (r?.on !== 'text' && r?.on !== 'thinking') throw new Error('reduce: on must be text or thinking');
  if (!reducers.has(r.name)) throw new Error('unknown reducer: ' + String(r.name));
  return { on: r.on, name: r.name };
};

// ---- stream state machine. State is plain JSON; the policy lives in it, reducers are looked up by name per step.
const DELTA = { text_delta: { kind: 'text', field: 'text' }, thinking_delta: { kind: 'thinking', field: 'thinking' }, input_json_delta: { kind: 'tool_use', field: 'partial_json' } };
const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function streamInit(listener, policy, ctx) {
  needListener(listener);
  const p = policy || {};
  return {
    listener, class: ctx?.class ?? null,
    policy: { budget: { ...(p.budget || {}) }, haltStopReason: p.haltStopReason || 'end_turn', reduce: (p.reduce || []).map(checkReduce) },
    done: false, halt: null, pending: null, blocks: {}, chars: { text: 0, thinking: 0, tool_use: 0 }, usage: {},
  };
}

const mergeUsage = (u, src) => { const o = { ...u }; for (const k of USAGE_KEYS) if (isNum(src?.[k])) o[k] = src[k]; return o; };
const total = s => s.chars.text + s.chars.thinking + s.chars.tool_use;
function count(s, delta) {
  const d = DELTA[delta?.type];
  if (!d || typeof delta[d.field] !== 'string') return s;
  return { ...s, chars: { ...s.chars, [d.kind]: s.chars[d.kind] + delta[d.field].length } };
}
const without = (blocks, index) => { const o = { ...blocks }; delete o[index]; return o; };
const OBSERVE = {
  message_start: (s, e) => ({ ...s, usage: mergeUsage(s.usage, e.message?.usage) }),
  message_delta: (s, e) => ({ ...s, usage: mergeUsage(s.usage, e.usage) }),
  message_stop: s => ({ ...s, done: true }),
  content_block_start: (s, e) => ({ ...s, blocks: { ...s.blocks, [e.index]: String(e.content_block?.type) } }),
  content_block_stop: (s, e) => ({ ...s, blocks: without(s.blocks, e.index) }),
  content_block_delta: (s, e) => count(s, e.delta),
};
const observe = (s, e) => (Object.hasOwn(OBSERVE, e.type) ? OBSERVE[e.type](s, e) : s);

// a tool_use block is never cut; a thinking block is cut only on the harness listener (its own copy); a text block always
const cuttable = (listener, kind) => kind === 'text' || (kind === 'thinking' && listener === 'harness');
const ready = s => Object.values(s.blocks).every(k => cuttable(s.listener, k));
function reached(s) {
  const b = s.policy.budget;
  for (const kind of ['text', 'thinking']) if (isNum(b[kind]) && s.chars[kind] >= b[kind]) return 'budget-' + kind;
  return isNum(b.total) && total(s) >= b.total ? 'budget-total' : null;
}

// the reducers of the policy for this delta kind; thinking is altered only on the harness listener (R17: signature)
function reduceDelta(s, event) {
  const d = DELTA[event.delta?.type];
  if (!d || d.kind === 'tool_use' || (d.kind === 'thinking' && s.listener !== 'harness')) return null;
  let text = event.delta[d.field];
  for (const r of s.policy.reduce.filter(x => x.on === d.kind)) {
    const next = reducers.get(r.name)(text, { kind: d.kind, index: event.index });
    if (typeof next === 'string') text = next;
  }
  return text === event.delta[d.field] ? null : { ...event, delta: { ...event.delta, [d.field]: text } };
}

const haltVerdict = reason => ({ verdict: 'reject', reason });

// the complete termination:the blocks still open are closed in order, then one message_delta, then message_stop
function finish(s, out) {
  const n = total(s), tokens = Math.ceil(n / 4), reason = s.pending;
  const closers = Object.keys(s.blocks).map(Number).sort((a, b) => a - b).map(index => ({ type: 'content_block_stop', index }));
  const md = { type: 'message_delta', delta: { stop_reason: s.policy.haltStopReason, stop_sequence: null }, usage: { output_tokens: tokens } };
  const state = { ...s, done: true, pending: null, blocks: {}, halt: { reason, chars: n }, usage: { ...s.usage, output_tokens: tokens } };
  return { state, out: [...out, ...closers, md, { type: 'message_stop' }], verdict: haltVerdict(reason), abort: true };
}

// -> { state, out, verdict, abort }: out is the list of events to send on; abort is true on the one step that ends the stream
export function streamStep(state, event) {
  if (state.halt) return { state, out: [], verdict: haltVerdict(state.halt.reason), abort: false };
  if (!isObj(event)) return { state, out: [event], verdict: { verdict: 'allow' }, abort: false }; // not an event: passed on as given
  const t = event.type;
  if (t === 'ping' || t === 'error') return { state: t === 'error' ? { ...state, done: true } : state, out: [event], verdict: { verdict: 'allow' }, abort: false };
  const altered = t === 'content_block_delta' ? reduceDelta(state, event) : null;
  let s = observe(state, event);
  const out = [altered || event];
  if (t === 'content_block_delta' && !s.pending) s = { ...s, pending: reached(s) };
  if (s.pending && ready(s)) return finish(s, out);
  return { state: s, out, verdict: altered ? { verdict: 'alter', event: altered } : { verdict: 'allow' }, abort: false };
}

// ---- SSE codec: canonical frame `event: T\ndata: JSON\n\n`
export const sseFormat = e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

const dataOf = frame => frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
// -> { events, rest, bad }: rest is the cut frame (wait for more); bad holds frames whose data is not a JSON object, as received
export function sseSplit(buffer) {
  const parts = String(buffer).replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop(), events = [], bad = [];
  for (const frame of parts) {
    const data = dataOf(frame);
    if (!data) continue;
    try { const e = JSON.parse(data); if (isObj(e)) events.push(e); else bad.push(frame); } catch { bad.push(frame); }
  }
  return { events, rest, bad };
}
