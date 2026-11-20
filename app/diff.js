// Line diff for showing a change to a person (the approval card): which lines go and which come, with
// their line numbers and a few lines around them. Pure functions, no DOM, no Node API.
//   hunks(oldText, newText, { context }) -> { added, removed, hunks: [{ oldStart, newStart, oldLines, newLines, rows }] }
//   row = { op: 'ctx' | 'del' | 'add', old: line number or null, new: line number or null, text, pair: the row it replaces or is replaced by }
// oldText null means there was no file: every line is added.

// a text ending in a line break has no extra empty last line
export const linesOf = t => { const a = String(t ?? '').split('\n'); if (a.length && a[a.length - 1] === '') a.pop(); return a; };

// Myers' O(ND) shortest edit script over two arrays; null when it would take more than `max` edits.
function myers(a, b, max) {
  const n = a.length, m = b.length, lim = Math.min(n + m, max), off = lim + 1, trace = [];
  const v = new Int32Array(2 * lim + 3);
  for (let d = 0; d <= lim; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1, y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) {
        const out = [];
        for (let e = d; e > 0; e--) {
          const w = trace[e], kk = x - y, pk = kk === -e || (kk !== e && w[off + kk - 1] < w[off + kk + 1]) ? kk + 1 : kk - 1, px = w[off + pk], py = px - pk;
          while (x > px && y > py) out.push([0, --x, --y]);
          if (x === px) out.push([1, x, --y]); else out.push([-1, --x, y]);
        }
        while (x > 0 && y > 0) out.push([0, --x, --y]);
        return out.reverse();
      }
    }
  }
  return null;
}

// [op, i, j] in order: 0 = the same line (a[i], b[j]), -1 = a[i] removed, 1 = b[j] added
function ops(a, b, max = 1500) {
  let s = 0, ea = a.length, eb = b.length;
  while (s < ea && s < eb && a[s] === b[s]) s++;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  // too far apart to align line by line: the middle goes and the new middle comes
  const mid = myers(A, B, max) || [...A.map((_, i) => [-1, i, 0]), ...B.map((_, j) => [1, 0, j])];
  const out = [];
  for (let i = 0; i < s; i++) out.push([0, i, i]);
  for (const [op, i, j] of mid) out.push([op, i + s, j + s]);
  for (let i = ea, j = eb; i < a.length; i++, j++) out.push([0, i, j]);
  return out;
}

export function hunks(oldText, newText, { context = 3 } = {}) {
  const a = oldText == null ? [] : linesOf(oldText), b = linesOf(newText);
  let rows = ops(a, b).map(([op, i, j]) => op === 0 ? { op: 'ctx', old: i + 1, new: j + 1, text: a[i] } : op < 0 ? { op: 'del', old: i + 1, new: null, text: a[i] } : { op: 'add', old: null, new: j + 1, text: b[j] });
  // within a changed run: removed lines first, then added ones; a run of n removed and n added lines pairs them up
  const sorted = [];
  for (let n = 0; n < rows.length;) {
    if (rows[n].op === 'ctx') { sorted.push(rows[n++]); continue; }
    let e = n; while (e < rows.length && rows[e].op !== 'ctx') e++;
    const del = rows.slice(n, e).filter(r => r.op === 'del'), add = rows.slice(n, e).filter(r => r.op === 'add');
    if (del.length === add.length) del.forEach((r, k) => { r.pair = add[k]; add[k].pair = r; });
    sorted.push(...del, ...add); n = e;
  }
  rows = sorted;
  const keep = new Uint8Array(rows.length);
  rows.forEach((r, n) => { if (r.op !== 'ctx') for (let k = Math.max(0, n - context); k <= Math.min(rows.length - 1, n + context); k++) keep[k] = 1; });
  const out = []; let cur = null;
  rows.forEach((r, n) => { if (!keep[n]) { cur = null; return; } if (!cur) out.push(cur = { rows: [] }); cur.rows.push(r); });
  for (const h of out) {
    h.oldLines = h.rows.filter(r => r.op !== 'add').length; h.newLines = h.rows.filter(r => r.op !== 'del').length;
    h.oldStart = h.rows.find(r => r.old != null)?.old ?? 0; h.newStart = h.rows.find(r => r.new != null)?.new ?? 0;
  }
  return { added: rows.filter(r => r.op === 'add').length, removed: rows.filter(r => r.op === 'del').length, hunks: out };
}

// the part of a line that differs from the line it replaces: { pre, mid, post } with pre and post shared by both
export function changed(text, other) {
  const a = String(text), b = String(other);
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return { pre: a.slice(0, s), mid: a.slice(s, a.length - e), post: a.slice(a.length - e) };
}
