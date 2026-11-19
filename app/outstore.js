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
// A handle missing here (cleared storage, another device) can come from elsewhere:
// the log repo keeps cited outputs as artifacts. What is fetched is cached again.
let fallback = null;
export const setFallback = f => { fallback = f; };
export async function get(handle) {
  const v = await tx('readonly', s => s.get(handle));
  if (v != null || !fallback || !/^os:[a-z0-9]+$/.test(handle)) return v;
  const r = await fallback(handle).catch(() => null);
  if (typeof r === 'string') await tx('readwrite', s => s.put(r, handle));
  return r ?? v;
}

// Deterministic noise removal, applied to every tool result before anything else:
// colour codes, trailing spaces, runs of blank lines, and runs of identical lines.
export function squeeze(text) {
  const out = [];
  let prev = null, run = 0;
  const flush = () => { if (run > 1) out.push(`  (previous line x${run})`); };
  for (const raw of text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n')) {
    const l = raw.replace(/\s+$/, '');
    if (l === prev) { run++; continue; }
    flush();
    if (l === '' && out.at(-1) === '') { prev = l; run = 1; continue; }
    out.push(l); prev = l; run = 1;
  }
  flush();
  return out.join('\n').trim();
}

// Lines that mention any word of what the caller said it wants. No model involved.
export function shortlist(text, want, max = 20) {
  const words = String(want).toLowerCase().split(/[^a-z0-9_.-]+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const hits = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => { const x = l.toLowerCase(); return words.some(w => x.includes(w)); });
  if (!hits.length) return null;
  return { total: hits.length, text: hits.slice(0, max).map(([n, l]) => `${n}: ${l.slice(0, 240)}`).join('\n') };
}

// What goes into the log in place of a long result. In order of preference:
//   1. want + helper model: the helper's extract        [os:.. 305L helper]
//   2. want: the matching lines                         [os:.. 305L keywords 1/1]
//   3. head and tail                                    [os:.. 305L ends]
// The whole text is stored first, so every view carries a handle to the rest.
export async function present(raw, { want, helper } = {}) {
  const text = squeeze(raw);
  if (text.length <= VIEW_MAX) return text;
  const handle = await put(text), lines = text.split('\n').length;
  // One short tag: handle, size, which filter ran. The want itself is already on the call.
  const tag = extra => `[${handle} ${lines}L ${extra}]`;
  if (want) {
    const extract = helper ? await helper(String(want), text).catch(() => null) : null; // a failed helper falls through
    if (extract) return `${tag('helper')}\n${extract.slice(0, 1200)}`;
    const hits = shortlist(text, want);
    if (hits) return `${tag(`keywords ${Math.min(20, hits.total)}/${hits.total}`)}\n${hits.text}`;
  }
  return `${tag('ends')}\n${text.slice(0, 900)}\n[...]\n${text.slice(-400)}`;
}

export async function read({ handle, find, offset = 0, length = 3000 }) {
  const text = await get(String(handle || ''));
  if (text == null) return `No stored output "${handle}".`;
  return slice(text, { find, offset, length });
}
// find: matching lines; else a slice from offset
export function slice(text, { find, offset = 0, length = 3000 } = {}) {
  if (find) {
    const hits = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(String(find)));
    return hits.length ? hits.slice(0, 60).map(([n, l]) => `${n}: ${l.slice(0, 300)}`).join('\n') + (hits.length > 60 ? `\n[${hits.length - 60} more matches]` : '') : 'No matching lines.';
  }
  const o = Math.max(0, Number(offset) || 0), n = Math.min(4000, Math.max(1, Number(length) || 3000));
  return text.slice(o, o + n) + (o + n < text.length ? `\n[${text.length - o - n} chars remain; continue at offset ${o + n}]` : '');
}

export const handlesIn = text => String(text || '').match(/os:[a-z0-9]{6,12}/g) || [];
