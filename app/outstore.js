// Output store: the full text of a bulky tool result, kept out of the session
// log under a content handle (os:<hash>). The log gets a short view plus the
// handle; output_read fetches the rest. Nothing is dropped, nothing is re-run.
// Kept in IndexedDB (localStorage is too small); .session exports carry the
// blobs their messages cite.

const hash = s => { let a = 5381, b = 52711; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = (a * 33 ^ c) >>> 0; b = (b * 31 + c) >>> 0; } return (a.toString(36) + b.toString(36)).slice(0, 10); };

let dbp;
const db = () => dbp ??= new Promise((ok, no) => {
  const r = indexedDB.open('webharness', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('out');
  r.onsuccess = () => ok(r.result);
  r.onerror = () => no(r.error);
});
const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const r = fn(d.transaction('out', mode).objectStore('out')); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); };

export const VIEW_MAX = 1500; // chars of a tool result kept in the log before it is stored by handle

export async function put(text) {
  const handle = 'os:' + hash(text);
  await tx('readwrite', s => s.put(text, handle));
  return handle;
}
export const get = handle => tx('readonly', s => s.get(handle));

// The view that goes into the log in place of a long result.
export async function view(text) {
  if (text.length <= VIEW_MAX) return text;
  const handle = await put(text), lines = text.split('\n').length;
  return `${text.slice(0, 900)}\n[${handle}: ${text.length} chars, ${lines} lines; first 900 and last 400 chars shown; the rest is available by handle]\n${text.slice(-400)}`;
}

export async function read({ handle, find, offset = 0, length = 3000 }) {
  const text = await get(String(handle || ''));
  if (text == null) return `No stored output "${handle}".`;
  if (find) {
    const hits = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(String(find)));
    return hits.length ? hits.slice(0, 60).map(([n, l]) => `${n}: ${l.slice(0, 300)}`).join('\n') + (hits.length > 60 ? `\n[${hits.length - 60} more matches]` : '') : 'No matching lines.';
  }
  const o = Math.max(0, Number(offset) || 0), n = Math.min(4000, Math.max(1, Number(length) || 3000));
  return text.slice(o, o + n) + (o + n < text.length ? `\n[${text.length - o - n} chars remain; continue at offset ${o + n}]` : '');
}

export const handlesIn = text => String(text || '').match(/os:[a-z0-9]{6,12}/g) || [];
