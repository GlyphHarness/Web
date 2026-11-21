// Shared fixtures for scripts/measure-query.mjs and scripts/probe-query.mjs: repo fixtures, live catalog, synthetic long session, trail, handles, a scratch adapter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSurface } from '../app/query.js';
import { createHarnessAdapter } from '../app/query-harness.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const J = JSON.stringify, tok = s => Math.ceil(String(s).length / 4);
export const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return a.toString(36) + b.toString(36); };
export const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const clock = () => { let t = 1700000000000; return () => (t += 10); };

// ------------------------------------------------------------------ sources
export const readJ = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
export const jsonl = f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
export const MET = readJ('scripts/fixtures/metrics-sessions.json'), RND = readJ('scripts/fixtures/render-sessions.json');
export const CAT = { concepts: jsonl('catalog/concepts.jsonl'), faults: jsonl('catalog/faults.jsonl'), terms: jsonl('catalog/nomenclature.jsonl') };
export const RAW = { concepts: fs.readFileSync(path.join(ROOT, 'catalog/concepts.jsonl'), 'utf8'), faults: fs.readFileSync(path.join(ROOT, 'catalog/faults.jsonl'), 'utf8') };

// a long synthetic session: 40 turns, deterministic text, one 30000-char tool result (exercises get caps), a failed and a held call
export const WORDS = 'read file path commit branch diff stem handle store check card policy session ledger cache write token turn model call result error line'.split(' ');
export const prose = (n, seed) => { let s = '', x = seed * 7919 + 13; while (s.length < n) { x = (x * 1103515245 + 12345) & 0x7fffffff; s += WORDS[x % WORDS.length] + (x % 11 === 0 ? '.\n' : ' '); } return s.slice(0, n); };
export const LEN = [420, 260, 1800, 380, 120, 90, 2400, 520, 800, 140, 1500, 300, 60, 640, 30000, 240];
export const slong = (() => {
  const messages = [];
  for (let i = 0; i < 40; i++) {
    const k = i % 4, L = LEN[(i * 3 + 1) % LEN.length];
    if (k === 0) messages.push({ role: 'user', content: prose(200 + (i * 37) % 600, i) });
    else if (k === 1) messages.push({ role: 'assistant', content: prose(100 + (i * 29) % 300, i), tool_calls: [{ id: 'c' + i, type: 'function', function: { name: ['repo_read', 'shell', 'file_edit'][(i >> 2) % 3], arguments: '{}' } }] });
    else if (k === 2) messages.push({ role: 'tool', tool_call_id: 'c' + (i - 1), content: i === 14 ? prose(30000, i) : i === 18 ? 'Tool error: ' + prose(200, i) : i === 22 ? 'Not run: policy ' + prose(120, i) : 'ok ' + prose(Math.min(L, 2500), i) });
    else messages.push({ role: 'assistant', content: prose(100 + (i * 53) % 500, i) });
  }
  const ledger = Array.from({ length: 12 }, (_, n) => ({ t: 1700000000000 + n * 1000, kept: 0, chars: 1000 + n * 90, model: 'qwen/qwen3.7-flash', strat: 'strat-serial-1.0', prompt: 4000 + n * 700, cached: n ? 3000 + n * 600 : 0, cacheWrite: n ? 0 : 3800, completion: 200 + (n * 97) % 400, reasoning: (n * 131) % 500, cost: Number((0.0008 + n * 0.0001).toFixed(5)) }));
  return { id: 'slong', title: 'Synthetic long session', created: 1700000000000, system: prose(1400, 99), messages, ledger };
})();
export const SESSIONS = [...MET.sessions, ...RND.sessions, slong];
export const TRAIL = Array.from({ length: 25 }, (_, i) => ({ t: 1700000100000 + i * 500, tool: ['shell', 'repo_read', 'file_edit', 'output_read', 'repo_commit'][i % 5], via: 'model', ok: i % 7 !== 3, chars: 20 + i * 41, ...(i % 6 === 0 ? { why: 'checking the state before the edit' } : {}), ms: 4 + (i * 13) % 90 }));

// synthetic handles (the real ones live in IndexedDB); the log is the audit the surface reads back, resolve appends to it
export const mkHandles = () => {
  const log = [{ t: 1700000000100, id: 'km7q2x', reader: 'sfixA', h: 'iok4xwb14t' }, { t: 1700000000200, id: 'km7q2x', reader: 'sfixA', h: '1i0va4l66g' }, { t: 1700000000250, id: 'ab3dd9', reader: 'slong', h: 'zq81k2m0aa' }];
  const info = { km7q2x: { id: 'km7q2x', kind: 'stem', owner: 'sfixA', t: 1700000000150, readers: ['*', 'sfixA'] }, ab3dd9: { id: 'ab3dd9', kind: 'checkpoint', owner: 'slong', t: 1700000000240, readers: ['*'] } };
  const text = { km7q2x: 'stem 3 of 5 folded: the side goal needed three turns of bulky reads; result kept as a fold of 6 lines.', ab3dd9: prose(900, 5) };
  return { info: async id => info[id] || null, resolve: async (id, reader) => { log.push({ t: 1700000000300 + log.length, id, reader, h: hash(text[id] || '') }); return text[id] ?? null; }, audit: () => log.slice() };
};

// a second adapter: a settable kind (the harness ships none, OQ6), a failing one, and a materialized kind (OQ13)
export const NOTES = [{ id: 'n1', title: 'first note', status: 'open', body: prose(700, 1) }, { id: 'n2', title: 'second note', status: 'closed', body: prose(300, 2) }, { id: 'boom', title: 'a failing source', status: 'open', body: '' }];
export const DESC = 'turn-text: one line per turn, "<role>#<i>: <text>"; an assistant turn with calls ends with [call <name>]; a tool result is "<tool> -> <ok|failed>: <text>".';
export const mkScratch = calls => ({
  name: 'scratch',
  schema: {
    types: { Note: { fields: { id: 'ID', title: 'String', status: 'String' }, kind: 'note' }, TurnText: { fields: { id: 'ID', i: 'Int' }, kind: 'turn-text' } },
    roots: { notes: { type: '[Note]', args: { first: 'Int', after: 'String' } }, rendered: { type: '[TurnText]', args: { session: 'ID!', first: 'Int', after: 'String' } } },
  },
  kinds: {
    note: { name: 'note', type: 'Note', label: e => e.id, key: e => e.id, props: ['id', 'title', 'status'], gettable: true, settable: ['status'],
      fn(e, what) { calls.fn++; if (what.payload) { if (e.id === 'boom') throw new Error('source offline'); return e.body; } return Object.fromEntries(what.props.map(p => [p, e[p] ?? null])); },
      set(e, name, value) { calls.set++; return { value }; } },
    'turn-text': { name: 'turn-text', type: 'TurnText', label: e => 'x' + e.i, key: e => 'x' + e.i, props: ['id', 'i'], gettable: true, settable: [], materialized: { descriptor: DESC },
      fn(e, what) { calls.fn++; return what.payload ? `${e.role}#${e.i}: ${e.text}` : Object.fromEntries(what.props.map(p => [p, e[p] ?? null])); } },
  },
  resolve: async (root, a) => {
    if (root === 'notes') return { entries: NOTES.slice(0, a.first ?? 20), total: NOTES.length, next: null };
    const s = SESSIONS.find(x => x.id === a.session); if (!s) throw new Error('unknown session ' + a.session);
    const all = s.messages.map((m, i) => ({ id: s.id + ':' + i, i, role: m.role, text: typeof m.content === 'string' ? m.content : J(m.content) }));
    const first = a.first ?? 20, off = Number(a.after || 0);
    return { entries: all.slice(off, off + first), total: all.length, next: off + first < all.length ? String(off + first) : null };
  },
});

// a fresh surface over fresh state; calls counts every adapter fn / set / resolve the surface made
export function mk(opts = {}) {
  const calls = { fn: 0, set: 0, resolve: 0 }, handles = mkHandles();
  const harness = createHarnessAdapter({ sessions: () => SESSIONS, ckpt: () => MET.ckpt, trail: () => TRAIL, handles, catalog: () => CAT });
  const scratch = mkScratch(calls);
  for (const a of [harness, scratch]) {
    const r = a.resolve; a.resolve = (...x) => { calls.resolve++; return r(...x); };
    for (const k of Object.values(a.kinds)) { const f = k.fn, s = k.set; k.fn = (...x) => { calls.fn++; return f(...x); }; if (s) k.set = (...x) => { calls.set++; return s(...x); }; }
  }
  // scratch kinds already count inside their own fn; the wrapper above counts harness kinds only once more, so reset the double count
  scratch.kinds.note.fn = ((f) => (...x) => f(...x))(scratch.kinds.note.fn);
  const policy = opts.policy || {};
  return { S: createSurface({ adapters: [harness, scratch], now: clock(), reader: 'sfixA', policy, prefaced: opts.prefaced }), calls, policy, handles };
}

