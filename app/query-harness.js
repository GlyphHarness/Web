// Query surface, harness adapter (docs/QUERY.md 6.1, 7): what the harness itself holds, as roots and kinds of one adapter.
// Pure over injected sources: {sessions(), ckpt(), trail(), handles: {info, resolve, audit}, catalog()}. No storage, no page.
const page = (all, a) => {
  const first = a.first ?? 20, off = Number(a.after || 0), end = off + first;
  return { entries: all.slice(off, end), total: all.length, next: end < all.length ? String(end) : null };
};
const at = (rows, f) => rows.map((r, i) => ({ ...r, n: i + 1 })).filter(f || (() => true));

// [kind, type, fields, label, key, payload text (omit: not gettable)]
const SPEC = [
  ['flow-turn', 'FlowTurn', { i: 'Int', role: 'String', chars: 'Int', calls: '[String]', tool: 'String', ok: 'Boolean' }, e => 't' + e.i, e => e.s + ':' + e.i, e => e.text],
  ['ledger-row', 'LedgerRow', { n: 'Int', t: 'Float', model: 'String', strat: 'String', prompt: 'Int', cached: 'Int', cacheWrite: 'Int', completion: 'Int', reasoning: 'Int', cost: 'Float', chars: 'Int', kept: 'Int', helper: 'String', kind: 'String' }, e => 'r' + e.n, e => e.s + ':' + e.n],
  ['trail-row', 'TrailRow', { n: 'Int', t: 'Float', tool: 'String', via: 'String', ok: 'Boolean', chars: 'Int', why: 'String', ref: 'String', out: 'String', ms: 'Float' }, e => 'k' + e.n, e => 'k' + e.n],
  ['checkpoint', 'Checkpoint', { id: 'ID', kind: 'String', len: 'Int', t: 'Float', session: 'ID', writes: 'Int', writeTokens: 'Int', reads: 'Int', readTokens: 'Int' }, e => e.id, e => e.id],
  ['handle', 'Handle', { id: 'ID', kind: 'String', owner: 'ID', t: 'Float', readers: '[String]' }, e => e.id, e => e.id, (e, ctx, src) => src.handles.resolve(e.id, ctx.reader)],
  ['handle-audit', 'HandleAudit', { n: 'Int', t: 'Float', id: 'ID', reader: 'String', h: 'String' }, e => 'a' + e.n, e => e.id + ':' + e.n],
  ['concept', 'Concept', { id: 'ID', name: 'String', status: 'String', since: 'String', supersedes: 'ID', nmodels: 'Int' }, e => e.id, e => e.id, e => e.claim],
  ['fault', 'Fault', { id: 'ID', model: 'String', class: 'String', seen: 'String', evidence: 'String' }, e => e.id, e => e.id, e => e.fault],
  ['term', 'Term', { id: 'ID', term: 'String', since: 'String', see: 'String' }, e => e.id, e => e.id, e => e.means],
  ['session', 'Session', { id: 'ID', title: 'String', created: 'Float', msgs: 'Int', requests: 'Int' }, e => e.id, e => e.id, e => e.system],
];
const LIST = { first: 'Int', after: 'String' };
const ROOTS = {
  turns: ['[FlowTurn]', { session: 'ID!', role: 'String', ...LIST }], ledger: ['[LedgerRow]', { session: 'ID!', ...LIST }],
  sessions: ['[Session]', LIST], session: ['Session', { id: 'ID!' }], trail: ['[TrailRow]', { tool: 'String', ...LIST }],
  checkpoints: ['[Checkpoint]', { session: 'ID' }], handle: ['Handle', { id: 'ID!' }], audit: ['[HandleAudit]', { id: 'ID!', ...LIST }],
  concepts: ['[Concept]', { status: 'String', model: 'String', ...LIST }], faults: ['[Fault]', { model: 'String', class: 'String', ...LIST }],
  terms: ['[Term]', { match: 'String', ...LIST }],
};

const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));
const failed = t => /^(Tool error|Not run)/.test(t);

function flowTurns(s) {
  const names = {};
  for (const m of s.messages) for (const c of m.tool_calls || []) names[c.id] = c.function.name;
  return s.messages.map((m, i) => {
    const text = textOf(m), tool = m.role === 'tool' ? names[m.tool_call_id] ?? null : null;
    return { s: s.id, i, role: m.role, text, chars: text.length, calls: (m.tool_calls || []).map(c => c.function.name), tool, ok: m.role === 'tool' ? !failed(text) : null };
  });
}

// the chain tail of each supersedes chain: a record another names in `supersedes` is not served
function tails(concepts) {
  const named = new Set(concepts.map(c => c.supersedes).filter(Boolean));
  return concepts.filter(c => !named.has(c.id)).map(c => ({ ...c, supersedes: c.supersedes ?? null, nmodels: (c.models || []).length }));
}

export function createHarnessAdapter(src) {
  const kinds = {}, types = {}, roots = {};
  for (const [name, type, fields, label, key, text] of SPEC) {
    types[type] = { fields, kind: name };
    kinds[name] = {
      name, type, label, key, props: Object.keys(fields), gettable: !!text, settable: [],
      fn: (e, what, ctx) => (what.payload ? text(e, ctx, src) : Object.fromEntries(what.props.map(p => [p, e[p] ?? null]))),
    };
  }
  for (const [r, [type, args]] of Object.entries(ROOTS)) roots[r] = { type, args };
  const find = id => { const s = src.sessions().find(x => x.id === id); if (!s) throw new Error('unknown session ' + id); return s; };
  const cat = () => src.catalog() || {};
  const sess = s => ({ id: s.id, title: s.title, created: s.created, msgs: s.messages.length, requests: (s.ledger || []).length, system: s.system });
  const one = e => ({ entries: e ? [e] : [] });
  const R = {
    turns: a => page(flowTurns(find(a.session)).filter(t => !a.role || t.role === a.role), a),
    ledger: a => page(at(find(a.session).ledger || []).map(r => ({ ...r, s: a.session })), a),
    sessions: a => page(src.sessions().map(sess), a),
    session: a => one(src.sessions().map(sess).find(s => s.id === a.id)),
    trail: a => page(at(src.trail(), r => !a.tool || r.tool === a.tool), a),
    checkpoints: a => ({ entries: Object.entries(src.ckpt() || {}).map(([id, v]) => ({ id, ...v })).filter(c => !a.session || c.session === a.session) }),
    handle: async a => one(await src.handles.info(a.id)),
    audit: a => page(at(src.handles.audit().filter(r => r.id === a.id), null).map(r => ({ ...r, n: r.n - 1 })), a),
    concepts: a => page(tails(cat().concepts || []).filter(c => (!a.status || c.status === a.status) && (!a.model || (c.models || []).some(m => m.model === a.model))), a),
    faults: a => page((cat().faults || []).filter(f => (!a.model || f.model === a.model) && (!a.class || f.class === a.class)), a),
    terms: a => page((cat().terms || []).filter(t => !a.match || t.term.toLowerCase().includes(String(a.match).toLowerCase())), a),
  };
  return { name: 'harness', schema: { types, roots }, kinds, resolve: async (root, args, ctx) => R[root](args, ctx) };
}
