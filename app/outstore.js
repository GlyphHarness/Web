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

export async function read({ handle, find, offset = 0, length = 3000, lines }, ranged = false) {
  const text = await get(String(handle || ''));
  if (text == null) return `No stored output "${handle}".`;
  return ranged ? range(text, { find, lines, offset, length }) : slice(text, { find, offset, length });
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

// Ranged reads (strategies with reads: 'ranged'): a range that was asked for comes back whole, up to READ_MAX.
export const READ_MAX = 12000; // chars of a requested range returned in one result
// Whole lines starting at line `first`, cut at a line end when over READ_MAX; the last line then says what was left out.
export function capLines(text, first = 1) {
  if (text.length <= READ_MAX) return text;
  const ls = text.split('\n'), last = first + ls.length - 1;
  let n = 0, size = 0;
  while (n < ls.length && size + ls[n].length + 1 <= READ_MAX) size += ls[n++].length + 1;
  if (!n) return `${ls[0].slice(0, READ_MAX)}\n[line ${first} is ${ls[0].length} characters: its first ${READ_MAX} are shown${last > first ? `; lines ${first + 1}-${last} not shown: ask for them with lines "${first + 1}-${last}"` : ''}]`;
  return `${ls.slice(0, n).join('\n')}\n[lines ${first}-${first + n - 1} shown; lines ${first + n}-${last} not shown (${text.length - size} characters): ask for them with lines "${first + n}-${last}"]`;
}
// find: matching lines (as slice); lines "a-b": those lines, counted from 1; else offset and length, in characters
export function range(text, { find, lines, offset = 0, length = 3000 } = {}) {
  if (find) return slice(text, { find });
  if (lines != null && lines !== '') {
    const all = text.split('\n'), m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(String(lines)), a = Number(m?.[1]);
    if (!m || a < 1) return `lines must be "a-b", counted from 1; the text has ${all.length} lines.`;
    if (a > all.length) return `No line ${a}: the text has ${all.length} lines.`;
    return capLines(all.slice(a - 1, Math.max(a, Number(m[2] ?? a))).join('\n'), a);
  }
  const o = Math.max(0, Number(offset) || 0), n = Math.min(READ_MAX, Math.max(1, Number(length) || 3000));
  return text.slice(o, o + n) + (o + n < text.length ? `\n[${text.length - o - n} chars remain; continue at offset ${o + n}]` : '');
}

export const handlesIn =text => String(text || '').match(/os:[a-z0-9]{6,12}/g) || [];
