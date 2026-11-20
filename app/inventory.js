// Inventory, captures and the has/has-not view (docs/concepts/INVENTORY.md).
//
// An inventory is harness data beside the turns: {entries, features, checks}, plain records,
// append only. No label and no record id is ever written into turn content (invariant 1).
//
//   entry    {id, label, kind, domain, metadata{size, mtime, path, hash}, captures[{feature_id, payload_handle}], source, captured_at}
//            id names the blob (it is derived from the label); each capture pass that finds a new
//            hash appends a record, and the last record of an id is the current one.
//            source says what made the record: provider:<id>, tool:<name>; model:<id> would mark a
//            model-made capture (invariant 4; none is made here).
//   feature  {id, applies_to, extracts, how (ast|regex|parser|metadata|iac|lsp), cost}
//   check    {id, session, entry_id, read (whole|slice|capture only), range, at_turn, t, source_hash}
//   view     derived, never stored: per entry {entry_id, held, checked, stale}
//
// The capture provider seam: a provider is {id, language, feature, run(params, env)}, one per
// language. params = {language, scope (paths or labels), op (capture|edit|generate), edit};
// env = {read(label) -> Promise<string>}. For capture it returns
// {symbol_entries[], reference_edges[], annotations[]}. Anything meeting that can be registered;
// the built-in ones are loaded on first use.
import { contentHash } from './handles.js';

export const READS = ['whole', 'slice', 'capture only'];
export const create = () => ({ entries: [], features: [], checks: [] });
export const entryId = label => 'ie:' + contentHash(String(label));
const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
const current = (inv, id) => (inv.entries || []).findLast(e => e.id === id);
const domainOf = path => { const x = (/\.(\w+)$/.exec(String(path)) || [])[1]?.toLowerCase(); return { mjs: 'js', cjs: 'js', py: 'python' }[x] || x || 'unknown'; };

// A store for capture payloads where there is no page (node, tests): the same put/get as outstore.js.
export function memStore() {
  const m = new Map();
  return { put: async text => { const h = 'os:' + contentHash(text); m.set(h, text); return h; }, get: async h => m.get(h) ?? null };
}

// ---- capture providers ----
const BUILT_IN = { js: () => import('./capture-js.js') };
const reg = new Map(); // language -> provider
export function register(p) {
  if (!p?.id || !p.language || !p.feature?.id || typeof p.run !== 'function') throw new Error('a capture provider is {id, language, feature, run(params, env)}');
  reg.set(p.language, p);
  return p;
}
export async function providerFor(language) {
  if (!reg.has(language) && BUILT_IN[language]) register((await BUILT_IN[language]()).provider);
  const p = reg.get(language);
  if (!p) throw new Error(`no capture provider for "${language}"`);
  return p;
}
const textOf = src => typeof src === 'string' ? src : String(src?.text ?? '');
// the seam: capture({language, scope, op: 'capture'}, {read}) -> {symbol_entries, reference_edges, annotations}
export async function capture(params, env = {}) {
  const p = await providerFor(params?.language);
  const r = await p.run({ op: 'capture', ...params }, { ...env, read: async label => textOf(await env.read(label)) });
  if ((params.op || 'capture') !== 'capture') return r;
  return { symbol_entries: r?.symbol_entries || [], reference_edges: r?.reference_edges || [], annotations: r?.annotations || [] };
}

// ---- building ----
// Capture every label in scope and append an entry for each one that is new or whose source
// changed. env = {read(label) -> text | {text, mtime}, put(text) -> handle}. A label that cannot
// be captured stays as it was and is reported in `failed`.
export async function build(inv, { language, scope = [] }, env) {
  const p = await providerFor(language), fid = p.feature.id;
  if (JSON.stringify(inv.features.findLast(f => f.id === fid)) !== JSON.stringify(p.feature)) inv.features.push(freeze({ ...p.feature }));
  const out = { added: 0, unchanged: 0, failed: [], symbols: 0 };
  for (const label of scope) {
    try {
      const src = await env.read(label), text = textOf(src), hash = contentHash(text);
      const id = entryId(label), cur = current(inv, id), same = cur?.metadata.hash === hash;
      if (same && cur.captures.some(c => c.feature_id === fid)) { out.unchanged++; continue; }
      const r = await capture({ language, scope: [label], op: 'capture' }, { read: async () => text });
      const payload_handle = await env.put(JSON.stringify(r.symbol_entries));
      inv.entries.push(freeze({
        id, label, kind: 'file', domain: language,
        metadata: { size: text.length, mtime: src?.mtime ?? null, path: label, hash },
        captures: [...(same ? cur.captures : []), { feature_id: fid, payload_handle }],
        source: 'provider:' + p.id, captured_at: Date.now(),
      }));
      out.added++; out.symbols += r.symbol_entries.length;
    } catch (e) { out.failed.push({ label, error: String(e?.message || e) }); }
  }
  return out;
}

// ---- check records ----
let seq = 0;
export function check(inv, { session, entry_id, read, range = null, at_turn = null, t = Date.now(), source_hash }) {
  if (!READS.includes(read)) throw new Error('read is one of: ' + READS.join(', '));
  const rec = freeze({ id: 'ck:' + t.toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6), session, entry_id, read, range: range ?? null, at_turn, t, source_hash });
  inv.checks.push(rec);
  return rec;
}
// A file read through a tool (repo_read's file op). `text` is the whole file as it was, `lines` the
// slice asked for, `fits` whether what came back sits whole in the turn (a long result enters the
// log as a view with a handle, outstore.js): only a whole file held whole is recorded as `whole`.
// A file not yet in the inventory becomes an entry with metadata and no captures.
export function noteRead(inv, { session, at_turn, repo, path, ref, text, lines, fits = true, tool = 'repo_read', t = Date.now() }) {
  const label = `${repo}${ref ? '@' + ref : ''}:${path}`, id = entryId(label), hash = contentHash(String(text));
  if (!current(inv, id)) inv.entries.push(freeze({ id, label, kind: 'file', domain: domainOf(path), metadata: { size: String(text).length, mtime: null, path, hash }, captures: [], source: 'tool:' + tool, captured_at: t }));
  const whole = !lines && fits;
  return check(inv, { session, entry_id: id, read: whole ? 'whole' : 'slice', range: whole ? null : [lines, fits ? '' : 'view'].filter(Boolean).join(' '), at_turn, t, source_hash: hash });
}

// ---- the has/has-not view ----
// From the records alone: per entry what is held (the capture features of its current record),
// what was checked (the read kinds in its check records, for one session when given), and whether
// the last check saw another hash than the entry holds.
export function view(inv, { session } = {}) {
  const cur = new Map(), by = new Map();
  for (const e of inv.entries || []) cur.set(e.id, e);
  for (const c of inv.checks || []) if (!session || c.session === session) { if (!by.has(c.entry_id)) by.set(c.entry_id, []); by.get(c.entry_id).push(c); }
  return [...new Set([...cur.keys(), ...by.keys()])].map(id => {
    const e = cur.get(id), cs = by.get(id) || [];
    return { entry_id: id, held: e ? e.captures.map(c => c.feature_id) : [], checked: [...new Set(cs.map(c => c.read))], stale: !!(e && cs.length && cs.at(-1).source_hash !== e.metadata.hash) };
  });
}
