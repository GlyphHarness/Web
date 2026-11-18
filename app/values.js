// Scoped values: named, arbitrary entries a session can use (a region, an endpoint,
// a naming rule, a choice the person made), kept in the scope they belong to:
// Settings-wide, a profile, or one session. A session sees its own, its profile
// chain's and the Settings-wide ones.
//
// value = {id: 'v7', scope: {kind: 'global'|'profile'|'session', id}, revs: [rev...]}
// rev   = {rev, t, label, role, value, purpose, notes, expose, show, hidden, why,
//          by: {who: 'you'|'model'|'agent'|'config', session, title, message, model}}
// Nothing is overwritten: every change appends a revision (like commits to one
// file), hiding is a revision, restoring appends a copy of an older one.
// expose: 'value' (the model reads it), 'purpose' (the model sees label and purpose
// and uses {{v7}} in tool arguments, filled in when the call runs), 'hidden'.
// notes are for the person only and are never sent.

export const EXPOSE = ['value', 'purpose', 'hidden'];
const clip = (v, n) => String(v ?? '').slice(0, n);

export const current = v => v.revs.at(-1);

// values visible to a session: Settings-wide, then each profile in its chain, then its own
export function visible(all, chain, sessionId) {
  const ids = new Set(chain.map(p => p.id));
  return all.filter(v => v.scope.kind === 'global' || (v.scope.kind === 'profile' && ids.has(v.scope.id)) || (v.scope.kind === 'session' && v.scope.id === sessionId));
}

// where the model may write on its own: its session, or the profile it is in (not above)
export const modelWritable = (v, leafProfile, sessionId) => (v.scope.kind === 'session' && v.scope.id === sessionId) || (v.scope.kind === 'profile' && v.scope.id === leafProfile);

export function create(meta, scope, fields, by) {
  const id = 'v' + (meta.valSeq = (meta.valSeq || 0) + 1);
  const v = { id, scope, revs: [] };
  revise(v, fields, by);
  (meta.values ??= []).push(v);
  return v;
}

export function revise(v, fields, by) {
  const prev = v.revs.at(-1) || {};
  const r = {
    rev: (prev.rev || 0) + 1, t: Date.now(),
    label: clip(fields.label ?? prev.label, 60), role: clip(fields.role ?? prev.role ?? 'note', 30),
    value: fields.value !== undefined ? fields.value : prev.value, purpose: clip(fields.purpose ?? prev.purpose, 300),
    notes: clip(fields.notes ?? prev.notes, 2000), expose: EXPOSE.includes(fields.expose) ? fields.expose : prev.expose || 'value',
    show: fields.show ?? prev.show ?? false, hidden: fields.hidden ?? false, why: clip(fields.why, 300) || undefined, by,
  };
  v.revs.push(r);
  return r;
}

const shown = x => typeof x === 'string' ? x : JSON.stringify(x);
// one line for the model; hidden values are left out (or announced once as hidden)
export function line(v) {
  const r = current(v);
  if (r.hidden || r.expose === 'hidden') return null;
  const head = `${v.id} ${r.label} [${r.role}]`;
  const body = r.expose === 'value' ? ` = ${clip(shown(r.value), 300)}` : ` (value withheld: use {{${v.id}}} in tool arguments)`;
  return head + body + (r.purpose ? ` · ${r.purpose}` : '');
}

export const INDEX_HEAD = 'values in scope (id label [role]; write {{id}} in tool arguments to use one; value_get id for history):';

// tool arguments (a JSON string): {{v7}} becomes the current value, escaped for JSON
export function fill(args, all) {
  const used = [];
  const out = String(args).replace(/\{\{(v\d+)\}\}/g, (m, id) => {
    const v = all.find(x => x.id === id), r = v && current(v);
    if (!r || r.hidden) return m;
    used.push(id);
    return JSON.stringify(shown(r.value)).slice(1, -1);
  });
  return { args: out, used };
}

export function history(v, withValues) {
  return v.revs.map(r => `rev ${r.rev} ${new Date(r.t).toISOString().slice(0, 16)} by ${r.by?.who || '?'}${r.hidden ? ' (hidden)' : ''}${withValues && r.expose === 'value' && !r.hidden ? ' = ' + clip(shown(r.value), 200) : ''}${r.why ? ' · ' + r.why : ''}`).join('\n');
}
