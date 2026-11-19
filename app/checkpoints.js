// Checkpoints: explicit cache breakpoints, set only where reuse is expected, and
// accounted one by one so the kinds that never pay can be switched off
// (docs/STEMS.md §3).
//
// Kinds:
//   system  the end of the system prompt (and tools): every request of the session reads it
//   tail    the last message: the next request reads it (the provider looks back from its own tail)
//   stem    a stem's anchor (the turn it branched from): other stems and confers from that turn read it
// At most 4 per request (the provider's limit). Models without explicit breakpoints get none;
// their caching is automatic and is measured the same way from reported usage.
//
// Accounting: a record per checkpoint (by a hash of the prefix it ends), shared by every
// session in this browser, since stems and their core share prefixes. Written tokens go to
// the new checkpoints, each its own segment; read tokens to the deepest known checkpoint
// the request starts with (so a shallow one pays only when the deeper ones miss).

import { flatten } from './context.js';

export const KINDS = ['system', 'tail', 'stem'];
export const supports = model => /claude|anthropic\//i.test(String(model)) || /-bp$/.test(String(model));

// body indices to mark: [{i, kind}], ordered by position
export function choose(session, body, kinds = KINDS) {
  const on = new Set(kinds), msgs = body.messages, out = new Map();
  const off = msgs[0]?.role === 'system' ? 1 : 0;
  const ok = i => i >= 0 && i < msgs.length && msgs[i].role !== 'tool' && typeof msgs[i].content === 'string' && msgs[i].content;
  if (on.has('system') && off) out.set(0, 'system');
  if (on.has('stem') && session.stem && session.parent?.at > 0) {
    let i = off + session.parent.at - 1;
    while (i > 0 && !ok(i)) i--;
    if (ok(i) && !out.has(i)) out.set(i, 'stem');
  }
  if (on.has('tail')) {
    let i = msgs.length - 1;
    while (i > 0 && !ok(i)) i--;
    if (ok(i) && !out.has(i)) out.set(i, 'tail');
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).slice(-4).map(([i, kind]) => ({ i, kind }));
}

// the request as sent: marked messages carry their text as one part with cache_control
export function apply(body, bps) {
  if (!bps.length) return body;
  const at = new Set(bps.map(b => b.i));
  return { ...body, messages: body.messages.map((m, i) => at.has(i) ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : m) };
}
// back to plain strings (for measuring prefixes, and for the mock)
export const strip = body => ({ ...body, messages: body.messages.map(m => Array.isArray(m.content) && m.content.every(p => p.type === 'text') ? { ...m, content: m.content.map(p => p.text).join('') } : m) });

const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 12); };
// chars of the flattened request up to the end of each message, and a key for each prefix
export function bounds(body) {
  const b = strip(body), lines = flatten(b).split('\n'), lens = [], keys = [];
  // flatten: model, tools, then one line per message
  let len = lines[0].length + 1 + lines[1].length;
  for (let i = 0; i < b.messages.length; i++) { len += 1 + lines[i + 2].length; lens.push(len); keys.push(hash(lines.slice(0, i + 3).join('\n'))); }
  return { lens, keys };
}

const KEY = 'wh:ckpt';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = recs => { try { const e = Object.entries(recs); localStorage.setItem(KEY, JSON.stringify(e.length > 600 ? Object.fromEntries(e.sort((x, y) => y[1].t - x[1].t).slice(0, 500)) : recs)); } catch {} };

// usage: {prompt, cached, cacheWrite} in tokens (provider-reported). Chars per token come from
// this request itself (its chars over its prompt tokens), so the estimate fits the model's tokenizer.
export function credit(body, bps, { prompt, cached, cacheWrite }, session) {
  const recs = load(), { lens, keys } = bounds(body), now = Date.now();
  const cpt = prompt > 0 ? lens.at(-1) / prompt : 4, held = cached * cpt, near = held * 0.01 + 16;
  for (const b of bps) recs[keys[b.i]] ??= { kind: b.kind, len: lens[b.i], t: now, session, writes: 0, writeTokens: 0, reads: 0, readTokens: 0 };
  // a read: the deepest known checkpoint this request starts with, within what was reported cached
  if (cached > 0) {
    for (let i = lens.length - 1; i >= 0; i--) {
      const r = recs[keys[i]];
      if (r && lens[i] <= held + near && r.writes > 0) { r.reads++; r.readTokens += cached; r.t = now; break; }
    }
  }
  // writes: each checkpoint past what was cached owns its own segment of the written tokens
  // (from the previous edge to its end); one already cached counts as held by the provider
  const fresh = bps.filter(b => lens[b.i] > held + near);
  const total = fresh.length ? lens[fresh.at(-1).i] - held : 0;
  let edge = held;
  for (const b of fresh) {
    const r = recs[keys[b.i]], seg = lens[b.i] - edge;
    edge = lens[b.i];
    r.writes++; r.t = now;
    if (cacheWrite > 0 && total > 0) r.writeTokens += Math.round(cacheWrite * seg / total);
  }
  for (const b of bps) { const r = recs[keys[b.i]]; if (!r.writes && !fresh.includes(b)) r.writes = 1; }
  save(recs);
}

// by kind: how many were set, written, read, and how many paid (read at least once)
export function stats() {
  const out = {};
  for (const r of Object.values(load())) {
    const o = out[r.kind] ??= { set: 0, writes: 0, writeTokens: 0, reads: 0, readTokens: 0, paid: 0 };
    o.set++; o.writes += r.writes; o.writeTokens += r.writeTokens; o.reads += r.reads; o.readTokens += r.readTokens; if (r.reads) o.paid++;
  }
  return out;
}
export const reset = () => { try { localStorage.removeItem(KEY); } catch {} };
