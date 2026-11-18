// Pattern store: what has been solved, what bit, and reusable recipes, kept in
// this browser and offered to the model progressively.
//
//   L0  index line: id, kind, title, labels, slots     (pattern_find, session start)
//   L1  the record body                                (pattern_get)
//   run a recipe with slot values                      (pattern_run)
//
// A record's id is a fingerprint of its content, so the same pattern stored twice
// is one record. Attribution (`by`: session, message, model, time) is written by
// the harness, never by the model. Artifacts are linked by handle in `refs`
// (stored outputs, branch ids); nothing is embedded.
//
// The trail is separate and automatic: one row per tool call, whatever the model
// says about it.

const KEY = 'wh:patterns', TRAIL = 'wh:trail', TRAIL_MAX = 500;
export const KINDS = ['solution', 'gotcha', 'pattern', 'philosophy', 'recipe'];
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 9); };
const clip = (v, n) => String(v ?? '').slice(0, n);

export const all = () => read(KEY, []);
const save = list => localStorage.setItem(KEY, JSON.stringify(list));
export const live = () => all().filter(p => !p.superseded_by);

export function put(input, by, knownRefs = () => true) {
  if (!KINDS.includes(input.kind)) return { error: `kind must be one of: ${KINDS.join(', ')}` };
  const rec = {
    kind: input.kind, title: clip(input.title, 80), body: clip(input.body, 1200),
    labels: (Array.isArray(input.labels) ? input.labels : []).slice(0, 8).map(l => clip(l, 24).toLowerCase()),
    slots: (Array.isArray(input.slots) ? input.slots : []).slice(0, 12).map(s => clip(s, 32)),
  };
  if (!rec.title) return { error: 'title is required' };
  if (input.kind === 'recipe') {
    if (!input.recipe?.tool || typeof input.recipe.args !== 'object') return { error: 'a recipe needs recipe: {tool, args}' };
    rec.recipe = { tool: String(input.recipe.tool), args: input.recipe.args };
    if (JSON.stringify(rec.recipe).length > 4000) return { error: 'recipe too large (4,000 chars)' };
  }
  const id = 'pt:' + hash(JSON.stringify(rec));
  const list = all(), old = list.find(p => p.id === id);
  if (old) return { id, existed: true };
  // only handles that really exist in the authoring session are kept
  rec.refs = (Array.isArray(input.refs) ? input.refs : []).map(String).filter(knownRefs).slice(0, 12);
  Object.assign(rec, { id, by, uses: 0 });
  const prev = input.supersedes && list.find(p => p.id === input.supersedes);
  if (prev) prev.superseded_by = id;
  list.push(rec);
  save(list);
  return { id };
}

export const line = p => `${p.id} [${p.kind}] ${p.title}${p.labels.length ? ' ' + p.labels.map(l => '#' + l).join(' ') : ''}${p.slots.length ? ` (slots: ${p.slots.join(', ')})` : ''}`;

export function find({ query, labels, kind } = {}) {
  const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean), want = (labels || []).map(l => String(l).toLowerCase());
  return live()
    .filter(p => (!kind || p.kind === kind) && want.every(l => p.labels.includes(l)) && q.every(w => (p.title + ' ' + p.body + ' ' + p.labels.join(' ')).toLowerCase().includes(w)))
    .sort((a, b) => b.uses - a.uses || b.by.t - a.by.t).slice(0, 30);
}

export const get = id => all().find(p => p.id === id);
export function used(id) { const list = all(), p = list.find(p => p.id === id); if (p) { p.uses++; save(list); } }
export function drop(id) { save(all().filter(p => p.id !== id)); }
export function merge(list) { const have = all(); for (const p of list || []) if (p?.id && !have.some(x => x.id === p.id)) have.push(p); save(have); }

// {{slot}} in any string of the recipe args. A string that is exactly one
// placeholder takes the value as given (number, object); otherwise it is spliced in as text.
export function fill(args, slots, values = {}) {
  const missing = slots.filter(s => !(s in values));
  if (missing.length) return { error: `missing slot values: ${missing.join(', ')}` };
  const walk = v => {
    if (typeof v === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(v);
      if (whole && whole[1] in values) return values[whole[1]];
      return v.replace(/\{\{(\w+)\}\}/g, (m, k) => k in values ? (typeof values[k] === 'string' ? values[k] : JSON.stringify(values[k])) : m);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { args: walk(args) };
}

// Index attached to the first message of a new session, so later bytes never move.
export function index(max = 20) {
  const top = find().slice(0, max);
  return top.length ? `\n\npatterns (pattern_get id, pattern_run id values):\n${top.map(line).join('\n')}` : '';
}

export const trail = () => read(TRAIL, []);
export function trailAdd(row) {
  const t = trail();
  t.push(row);
  try { localStorage.setItem(TRAIL, JSON.stringify(t.slice(-TRAIL_MAX))); } catch {}
}
// Same tool with the same argument names = same fingerprint, whatever the values.
export const shape = (tool, args) => hash(tool + ':' + Object.keys(args || {}).sort().join(','));
