// Observability for things that went wrong or nearly did: policy rewrites and
// refusals, call notes written as text, tool errors and timeouts. One row per
// event, kept in localStorage (wh:smells, newest 500), shown in the inspector,
// included in .trace exports and sent up the bridge. Rows are written by the
// harness from what happened, never from what a model says happened.

const KEY = 'wh:smells', MAX = 500;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

export const all = () => read();

export function add(row) {
  const list = read();
  const r = { t: Date.now(), ...row };
  list.push(r);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch {}
  return r;
}

export function clear() { try { localStorage.removeItem(KEY); } catch {} }

// counts by kind, and by policy for policy rows
export function summary(list = read()) {
  const by = {};
  for (const r of list) {
    const k = r.policy ? `${r.kind} ${r.policy}` : r.kind;
    by[k] = (by[k] || 0) + 1;
  }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
}

export const count = (pred, list = read()) => list.filter(pred).length;

// A short fingerprint of a string, for naming steering versions.
export const fp = t => { let h = 5381; for (const c of String(t ?? '')) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h.toString(36); };

// Steering versions: per fingerprint, the smells and the requests made under it.
// sessions: [{steer, requests}] from the harness.
export function bySteer(sessions, list = read()) {
  const out = {};
  for (const x of sessions) { const o = out[x.steer] ||= { steer: x.steer, requests: 0, smells: 0, kinds: {} }; o.requests += x.requests; }
  for (const r of list) {
    if (!r.steer) continue;
    const o = out[r.steer] ||= { steer: r.steer, requests: 0, smells: 0, kinds: {} };
    o.smells++; o.kinds[r.kind] = (o.kinds[r.kind] || 0) + 1;
  }
  return Object.values(out).map(o => ({ ...o, rate: o.requests ? o.smells / o.requests : null }));
}

// Proposals from a review: pending until the user adopts or dismisses them.
const PKEY = 'wh:proposals';
export const proposals = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '[]'); } catch { return []; } };
export function saveProposals(list) { try { localStorage.setItem(PKEY, JSON.stringify(list.slice(-100))); } catch {} }

// The watcher's system line (main.js watchCall), by the session's strategy wording: 'neutral' (strat-serial-3.0) names
// nothing of what runs the tools; every strategy registered before it is sent the line it was registered with.
const WATCH_SYSTEM = 'WATCH. You check one tool call made by an agent. Reply exactly "ok", or "FLAG: <one short line>" when the call failed, repeated earlier work, wasted effort, broke a rule, or its result needs a person. Nothing else.';
const WATCH_SYSTEM_1 = 'WATCH. You check one tool call made by an agent, for the harness that runs it. Reply exactly "ok", or "FLAG: <one short line>" when the call failed, repeated earlier work, wasted effort, broke a rule, or its result needs a person. Nothing else.';
export const watchLine = wording => wording === 'neutral' ? WATCH_SYSTEM : WATCH_SYSTEM_1;
export const REVIEW_SYSTEM ='You review how a coding assistant is being steered. You get counts of problems (policy rewrites and refusals, imitated call notes, tool errors, timeouts) grouped by steering version, with per-request rates, and the current steering texts. Propose at most 5 changes to the steering: a line to add to or remove from the conventions or the system prompt, a policy to add, change or drop, or a tool description to reword. One per line: TARGET: change -- evidence (the counts it rests on). Propose nothing the counts do not support.';

