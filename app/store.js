// Browser-side persistence. localStorage layout:
//   wh:meta      { schema, order: [sessionId], active, pads: [...], settings: {...} }
//   wh:s:<id>    one session each, so a turn rewrites one key
//   wh:keys      { providerId: apiKey }  -- never exported
//   wh:ref       pinned code ref (read by index.html)

import { SCHEMA, migrate } from './migrate.js';

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
export const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const state = { meta: null, sessions: {}, keys: {} };

export function load() {
  const meta = read('wh:meta', null) || { schema: SCHEMA, order: [], active: '', pads: [], settings: {} };
  const sessions = meta.order.map(id => read('wh:s:' + id, null)).filter(Boolean);
  // Throws if stored data is newer than this build: nothing is written in that case.
  const b = migrate({ schema: meta.schema, sessions, pads: meta.pads || [] });
  state.meta = { ...meta, schema: b.schema, pads: b.pads, order: b.sessions.map(s => s.id) };
  state.meta.settings = { provider: 'openrouter', model: '', inspector: true, ...meta.settings };
  state.sessions = Object.fromEntries(b.sessions.map(s => [s.id, s]));
  state.keys = read('wh:keys', {});
  if (b.schema !== meta.schema) { saveMeta(); b.sessions.forEach(saveSession); }
}

export const saveMeta = () => write('wh:meta', state.meta);
export const saveSession = s => write('wh:s:' + s.id, s);
export const saveKeys = () => write('wh:keys', state.keys);

export function newSession(init = {}) {
  const s = {
    id: uid('s'), title: 'New session', created: Date.now(),
    system: '', messages: [], ledger: [], padSeen: {}, ...init,
  };
  state.sessions[s.id] = s;
  state.meta.order.unshift(s.id);
  saveSession(s); saveMeta();
  return s;
}

export const children = id => Object.values(state.sessions).filter(s => s.parent?.id === id);
export const family = s => [s, ...children(s.id).flatMap(family)];

// Deleting a session deletes its branches. Returns every id removed.
export function dropSession(id) {
  const ids = family(state.sessions[id]).map(s => s.id);
  for (const x of ids) { delete state.sessions[x]; localStorage.removeItem('wh:s:' + x); }
  state.meta.order = state.meta.order.filter(x => !ids.includes(x));
  saveMeta();
  return ids;
}

// .session file: same bundle shape, one session with its branches, plus the scratchpads. No keys.
export function exportBundle(s) {
  return { kind: 'webharness.session', schema: SCHEMA, exported: new Date().toISOString(), sessions: family(s), pads: state.meta.pads };
}

export function importBundle(obj) {
  const b = migrate(obj);
  const added = [];
  const list = b.sessions || [], remap = {};
  for (const s of list) if (state.sessions[s.id]) remap[s.id] = s.id = uid('s');
  for (const s of list) {
    if (s.parent && remap[s.parent.id]) s.parent.id = remap[s.parent.id];
    state.sessions[s.id] = s;
    state.meta.order.unshift(s.id);
    saveSession(s);
    added.push(s);
  }
  for (const p of b.pads || []) {
    if (!state.meta.pads.some(x => x.label === p.label)) state.meta.pads.push({ ...p, id: uid('p') });
  }
  saveMeta();
  return added;
}
