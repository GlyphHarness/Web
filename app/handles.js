// Handles: opaque short ids whose meaning is re-pointed under a fixed context
// (docs/STEMS.md §1). An id's bytes never change in a session's turns; what it
// resolves to does: a stem's progress, its fold, a reader's own view.
//
// - Ids: 6 characters, lowercase letters and digits without look-alikes, a letter
//   first. No prefix, no order, no revision: nothing tells the model what came before.
// - Views: one shared view ('*') and optional views per reader (a session id, a role).
// - Audit: every resolution is logged here (id, reader, a hash of what was returned),
//   outside anything the model reads.
// Kept in IndexedDB (database "wh-handles"), so ids survive reloads and other tabs see them.

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789', LETTERS = 'abcdefghjkmnpqrstuvwxyz';
export const ID = /^[a-z][a-z0-9]{5}$/;
const pick = s => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
const newId = () => pick(LETTERS) + Array.from({ length: 5 }, () => pick(ALPHA)).join('');
const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 10); };

let dbp;
const db = () => dbp ??= new Promise((ok, no) => {
  const r = indexedDB.open('wh-handles', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('h');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const r = fn(d.transaction('h', mode).objectStore('h')); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); };
const load = id => tx('readonly', s => s.get(id));
const store = rec => tx('readwrite', s => s.put(rec, rec.id));

// view = {text} (the content itself) or {ref} (an os: handle or another id to follow)
export async function mint({ kind = '', owner = '', ...view } = {}) {
  let id;
  do id = newId(); while (await load(id));
  await store({ id, kind, owner, t: Date.now(), views: { '*': view } });
  return id;
}
export async function point(id, view, reader = '*') {
  const rec = await load(id);
  if (!rec) throw new Error('no handle ' + id);
  rec.views[reader] = view;
  rec.t = Date.now();
  await store(rec);
}
export const info = async id => { const r = await load(id); return r ? { id: r.id, kind: r.kind, owner: r.owner, t: r.t, readers: Object.keys(r.views) } : null; };

const log = []; // {t, id, reader, h}
export const audit = () => log.slice();
// what id means for this reader now (its own view, else the shared one); refs are followed
// through `deref` (for os: handles) or to another id, at most 4 hops
export async function resolve(id, reader = '*', deref = null) {
  if (!ID.test(String(id))) return null;
  let rec = await load(id), view = rec && (rec.views[reader] || rec.views['*']), text = null;
  for (let hops = 0; view && hops < 4; hops++) {
    if (view.text != null) { text = String(view.text); break; }
    if (ID.test(view.ref || '')) { const next = await load(view.ref); view = next && (next.views[reader] || next.views['*']); continue; }
    text = deref ? await deref(view.ref) : null;
    break;
  }
  if (rec) log.push({ t: Date.now(), id, reader, h: hash(text ?? '') });
  if (log.length > 2000) log.splice(0, log.length - 2000);
  return text;
}
export const contentHash = hash;
