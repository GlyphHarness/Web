// Text striping reducer stripe-1.0 (docs/STRIPE.md): a blob becomes a skeleton of kept spans and omission markers.
// Pure: no imports, no page, no storage, no clock, no randomness; integer and plain arithmetic only (byte-identical on any engine).
// Offsets and lengths are UTF-16 code units. Sections: notation (parse, verify, locate), class, fingerprint, analysis, closure, render, stripe.
export const ID = 'stripe-1.0';
export const DEFAULTS = Object.freeze({
  mode: 'auto', fraction: 0.3, minKeep: 2, minGap: 16, gram: 2, localWeight: 0.5, window: 25, segment: 120,
  keepFirst: 1, keepLast: 0, lineCap: 80, protect: Object.freeze(['os:[a-z0-9]{6,12}']), detailFrom: 48,
  known: Object.freeze([]), seen: Object.freeze({}), cpt: 4,
});
const KEYS = new Set([...Object.keys(DEFAULTS), 'maxChars', 'maxTokens', 'class', 'handle', 'maxInput']);
const MODES = ['auto', 'words', 'lines', 'chars'];
const STUB_AT = 24, STUB_LEN = 12; // auto mode: a unit longer than STUB_AT is an atom of its first STUB_LEN chars
const UNIT = /[\p{L}\p{N}_]+(?:[./:\\@#-][\p{L}\p{N}_]+)*/gu;
const HEADER = /^\[([^\s\]]+) (\d+)L (stripe-\d+\.\d+) ([\x21-\x5c\x5e-\x7e]+) (\d+)%(?: (seen)(?: (\d+)%)?)?\]$/;
const SKEL = /^\[[^\s\]]+ \d+L stripe-\d+\.\d+ [\x21-\x5c\x5e-\x7e]+ \d+%(?: seen(?: \d+%)?)?\](?:\n|$)/;
const MARKER = /\[~(\d+)(?:,w(\d+))?(?:,l(\d+))?(?:,k([adpsm]))?\]/y;

// ---------------------------------------------------------------- notation: sketch, markers, parse, verify, locate
const isSpace = c => c === 32 || (c >= 9 && c <= 13);
function sketch(run) { // kind of an omitted run: a letters, d digits, p punctuation (share of non-space chars >= 60%), s space only, m mixed
  let a = 0, d = 0, p = 0, t = 0;
  for (const ch of run) {
    const c = ch.codePointAt(0);
    if (c < 128) {
      if (isSpace(c)) continue;
      t++; if ((c | 32) >= 97 && (c | 32) <= 122) a++; else if (c >= 48 && c <= 57) d++; else p++;
    } else if (/\s/.test(ch)) continue;
    else { t++; if (/\p{L}/u.test(ch)) a++; else if (/\p{N}/u.test(ch)) d++; else p++; }
  }
  if (!t) return 's';
  return a * 100 >= 60 * t ? 'a' : d * 100 >= 60 * t ? 'd' : p * 100 >= 60 * t ? 'p' : 'm';
}
function omitOf(text, a, b, detailFrom) { // the marker record of text[a, b)
  const o = { n: b - a };
  if (o.n < detailFrom) return o;
  const run = text.slice(a, b), w = (run.match(/\S+/g) || []).length;
  let l = 0; for (let i = run.indexOf('\n'); i >= 0; i = run.indexOf('\n', i + 1)) l++;
  if (w) o.w = w;
  if (l) o.l = l;
  o.k = sketch(run);
  return o;
}
const markerText = o => `[~${o.n}${o.w != null ? ',w' + o.w : ''}${o.l != null ? ',l' + o.l : ''}${o.k ? ',k' + o.k : ''}]`;
const escapeKept = s => s.replace(/\[~/g, '[~~');

function decodeBody(t, i) {
  const parts = []; let cur = '';
  while (i < t.length) {
    if (t.charCodeAt(i) !== 91 || t.charCodeAt(i + 1) !== 126) { // not "[~": copy up to the next "["
      let j = t.indexOf('[', i + 1); if (j < 0) j = t.length;
      cur += t.slice(i, j); i = j; continue;
    }
    if (t.charCodeAt(i + 2) === 126) { cur += '[~'; i += 3; continue; } // "[~~" is the two chars "[~"
    MARKER.lastIndex = i;
    const m = MARKER.exec(t);
    if (!m || +m[1] < 1) throw new Error('stripe: malformed marker at body offset ' + i);
    if (cur) { parts.push({ kept: cur }); cur = ''; }
    const o = { n: +m[1] };
    if (m[2] != null) o.w = +m[2];
    if (m[3] != null) o.l = +m[3];
    if (m[4] != null) o.k = m[4];
    parts.push({ omit: o }); i = MARKER.lastIndex;
  }
  if (cur) parts.push({ kept: cur });
  return parts;
}
export function parse(text) {
  text = String(text);
  const nl = text.indexOf('\n'), m = HEADER.exec(nl < 0 ? text : text.slice(0, nl));
  if (!m) throw new Error('stripe: not a skeleton (header does not match)');
  const header = { ref: m[1], lines: +m[2], rid: m[3], class: m[4], pct: +m[5], seen: m[6] ? (m[7] != null ? +m[7] : true) : false };
  return { header, parts: nl < 0 ? [] : decodeBody(text, nl + 1) };
}
export function verify(original, parsed) {
  original = String(original);
  let pos = 0, kept = 0;
  for (const p of parsed.parts) {
    if (p.kept != null) {
      if (original.slice(pos, pos + p.kept.length) !== p.kept) return false;
      pos += p.kept.length; kept += p.kept.length; continue;
    }
    const o = p.omit;
    if (pos + o.n > original.length) return false;
    if (o.w != null || o.l != null || o.k != null) { const e = omitOf(original, pos, pos + o.n, 0); if (e.w !== o.w || e.l !== o.l || e.k !== o.k) return false; }
    pos += o.n;
  }
  const h = parsed.header;
  if (pos !== original.length) return false;
  return !h || (h.lines === original.split('\n').length && (!pos || h.pct === Math.round(100 * kept / pos)));
}
export function locate(parsed, i) { // offset and 1-based line of the i-th kept span
  let pos = 0, line = 1, idx = 0;
  for (const p of parsed.parts) {
    if (p.kept != null) {
      if (idx++ === i) return { offset: pos, line };
      pos += p.kept.length; for (let k = p.kept.indexOf('\n'); k >= 0; k = p.kept.indexOf('\n', k + 1)) line++;
    } else { pos += p.omit.n; line += p.omit.l || 0; }
  }
  return null;
}

// ---------------------------------------------------------------- fingerprint and class
export function fingerprint(text) { // 10 chars, base36 of a 53-bit two-lane multiplicative hash (cyrb53 family), UTF-16 units
  text = String(text);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const v = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return (v % 3656158440062976).toString(36).padStart(10, '0'); // 36^10: ten base36 chars
}
const UNDERLINE = /^(?:={3,}|-{3,})\s*$/;
const FEATURES = [['headed', 0.08], ['list', 0.3], ['tabular', 0.3], ['code', 0.3], ['log', 0.3], ['json', 0.3]];
const CODE_END = /[;{}]\s*$|=>\s*$|^\s*(?:import|export|const|let|var|function|class|return|async|await|def|elif|else|try|catch|throw|switch|case|for|while|if)\b[\s({]|^\s*\/\//;
const LOG_LINE = /^\s*\[?\d{4}-\d\d-\d\d[T ]\d\d:\d\d|^\s*\d\d:\d\d:\d\d|\b(?:INFO|WARN|WARNING|ERROR|DEBUG|FATAL|TRACE)\b|^\s*(?:PASS|FAIL)\b|^\s*(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/;
const JSON_LINE = /^\s*(?:\{|\[\s*[[{"\]\d-])|"[^"\n]+"\s*:/;
export function classify(text) { // {label, features}: features are line shares over the non-blank lines
  const ls = String(text).split('\n'), f = { headed: 0, list: 0, tabular: 0, code: 0, log: 0, json: 0 };
  let n = 0, len = 0;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]; if (!l.trim()) continue;
    n++; len += l.length;
    if (/^\s*#{1,6}\s/.test(l) || (i + 1 < ls.length && UNDERLINE.test(ls[i + 1]) && !UNDERLINE.test(l))) f.headed++;
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) f.list++;
    if ((l.match(/[|\t]/g) || []).length >= 2) f.tabular++;
    if (LOG_LINE.test(l)) f.log++;
    if (JSON_LINE.test(l)) f.json++; else if (CODE_END.test(l)) f.code++;
  }
  if (!n) return { label: 'mixed', features: f };
  for (const [k] of FEATURES) f[k] = f[k] / n;
  const top = FEATURES.map(([k, t]) => [k, f[k] / t]).filter(x => x[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  return { label: top.length ? top.join('+') : len / n >= 40 ? 'prose' : 'mixed', features: f };
}

// ---------------------------------------------------------------- policy
const num = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const canon = v => Array.isArray(v) ? '[' + v.map(x => canon(x) ?? 'null').join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
function resolve(p) {
  const g = {}; for (const k of Object.keys(DEFAULTS)) g[k] = p[k] != null ? p[k] : DEFAULTS[k];
  const mode = MODES.includes(g.mode) ? g.mode : 'auto';
  return {
    mode, fraction: num(g.fraction, 0.3), maxChars: num(p.maxChars, Infinity), maxTokens: num(p.maxTokens, Infinity), cpt: num(g.cpt, 4),
    minKeep: num(g.minKeep, 2), minGap: num(p.minGap, mode === 'chars' ? 5 : 16), gram: Math.max(1, Math.floor(num(g.gram, 2))),
    localWeight: num(g.localWeight, 0.5), window: Math.max(1, Math.floor(num(g.window, 25))), segment: Math.max(1, Math.floor(num(g.segment, 120))),
    keepFirst: num(g.keepFirst, 1), keepLast: num(g.keepLast, 0), lineCap: Math.max(1, num(g.lineCap, 80)), detailFrom: num(g.detailFrom, 48),
    protect: Array.isArray(g.protect) ? g.protect : DEFAULTS.protect, known: Array.isArray(g.known) ? g.known : [],
    seen: g.seen && typeof g.seen === 'object' ? g.seen : {}, klass: p.class != null ? String(p.class) : null, handle: p.handle != null ? String(p.handle) : null,
    maxInput: p.maxInput != null ? num(p.maxInput, Infinity) : Infinity,
  };
}
const budgetOf = (cfg, n) => Math.min(cfg.maxChars, cfg.fraction * n, cfg.maxTokens * cfg.cpt);
function profileOf(label) { const ls = label.split('+'); return { lead: ls.includes('log') || ls.includes('tabular'), key: ls.includes('json') ? 0.8 : 0.6 }; }

// ---------------------------------------------------------------- analysis: lines, segments, units, rarity, cues
function lineTable(text) {
  const out = []; let s = 0;
  for (;;) { const i = text.indexOf('\n', s); if (i < 0) { out.push([s, text.length]); return out; } out.push([s, i]); s = i + 1; }
}
function segmentStarts(lines, text, width) { // a segment is a line, cut at the last space at or before width chars (hard cut if none)
  const starts = [];
  for (const [s, e] of lines) {
    let a = s; starts.push(a);
    while (e - a > width) { const sp = text.lastIndexOf(' ', a + width); a = sp > a ? sp + 1 : a + width; starts.push(a); }
  }
  return starts;
}
const SIGNAL = new Set(['error', 'fail', 'failed', 'failure', 'exception', 'fatal', 'warn', 'warning', 'todo', 'fixme', 'panic', 'denied', 'timeout']);
const mixedAlnum = t => /\p{L}/u.test(t) && /\p{N}/u.test(t);
const isIdent = t => /[_./:\\@#]/.test(t) || /\p{Ll}\p{Lu}/u.test(t) || mixedAlnum(t);
function headingLine(l, next) {
  const s = l.trim();
  if (!s) return false;
  if (/^#{1,6}\s/.test(s) || (s.length <= 60 && /\p{Lu}{3}/u.test(s) && !/\p{Ll}/u.test(s))) return true;
  return next !== undefined && UNDERLINE.test(next) && !UNDERLINE.test(s);
}
function cueOf(text, u, isLead, heading, prof) { // [cue, exempt from the later-occurrence fade]
  if (heading) return [1, false];
  if (SIGNAL.has(u.k)) return [0.9, false];
  if (isIdent(u.t)) return [0.8, false];
  if (/^\d[\d.,:]*$/.test(u.t)) return [0.7, false];
  if (/^["']?:/.test(text.slice(u.e, u.e + 2))) return [prof.key, false];
  if (isLead && prof.lead) return [0.9, true];
  if (isLead) return [0.5, false];
  return [/^\p{Lu}/u.test(u.t) ? 0.3 : 0, false];
}
function unitsOf(text, lines, segs, cfg) {
  const units = []; let li = 0, si = 0;
  for (const m of text.matchAll(UNIT)) {
    const s = m.index;
    while (li + 1 < lines.length && lines[li + 1][0] <= s) li++;
    while (si + 1 < segs.length && segs[si + 1] <= s) si++;
    units.push({ s, e: s + m[0].length, t: m[0], k: m[0].toLowerCase(), li, si, wi: Math.floor(si / cfg.window), score: 0 });
  }
  return units;
}
function scoreUnits(text, units, lines, segs, cfg, prof) { // fills u.score with the section 2.2 formula (arithmetic only)
  const df = new Map(), dfw = new Map(), lastS = new Map(), lastW = new Map();
  for (const u of units) {
    if (lastS.get(u.k) !== u.si) { lastS.set(u.k, u.si); df.set(u.k, (df.get(u.k) || 0) + 1); }
    u.kw = u.wi + '\u0000' + u.k;
    if (lastW.get(u.kw) !== u.si) { lastW.set(u.kw, u.si); dfw.set(u.kw, (dfw.get(u.kw) || 0) + 1); }
  }
  const tau = Math.max(1, Math.floor(segs.length / 32)), heads = lines.map(([s, e], i) => headingLine(text.slice(s, e), lines[i + 1] ? text.slice(lines[i + 1][0], lines[i + 1][1]) : undefined));
  const known = new Set(cfg.known.map(x => String(x).toLowerCase())), seenK = new Set(), lead = new Map();
  for (const u of units) {
    if (!lead.has(u.li) && !(/^\d+$/.test(u.t) && /^[.)]\s/.test(text.slice(u.e, u.e + 2)))) lead.set(u.li, u);
    u.lead = lead.get(u.li) === u;
    const g = tau / (tau + df.get(u.k) - 1), loc = 1 / dfw.get(u.kw), R = (1 - cfg.localWeight) * g + cfg.localWeight * loc;
    const [c, exempt] = cueOf(text, u, u.lead, heads[u.li], prof), first = !seenK.has(u.k);
    seenK.add(u.k);
    let sc = (0.6 * R * Math.min(1, (u.t.length + 1) / 9) + 0.4 * c) * (first || exempt ? 1 : 0.5);
    if (known.has(u.k)) sc *= 0.5;
    u.score = sc;
  }
  return lead;
}
const rev20 = i => { let r = 0, x = i & 0xFFFFF; for (let b = 0; b < 20; b++) { r = (r << 1) | (x & 1); x >>= 1; } return r; };
function grams(u, width) { // cut a unit into grams of `width`, the remainder merged into the last; factors first 1, last 0.8, interior 0.5
  const L = u.e - u.s, k = Math.max(1, Math.floor(L / width)), out = [];
  for (let i = 0; i < k; i++) { const s = u.s + i * width, e = i === k - 1 ? u.e : s + width; out.push({ s, e, sc: u.score * (k === 1 || i === 0 ? 1 : i === k - 1 ? 0.8 : 0.5) }); }
  return out;
}
function atomsOf(units, lines, cfg) { // scored atoms in text order: {s, e, sc}
  const out = [];
  if (cfg.mode === 'lines') {
    const best = new Map();
    for (const u of units) if (u.score > (best.get(u.li) || 0)) best.set(u.li, u.score);
    lines.forEach(([s, e], li) => { if (e > s) out.push({ s, e, sc: (best.get(li) || 0) * Math.min(1, cfg.lineCap / (e - s)) }); }); // long lines sink: a whole line that cannot fit would stop the prefix
    return out;
  }
  for (const u of units) {
    if (cfg.mode === 'chars') out.push(...grams(u, cfg.gram));
    else out.push({ s: u.s, e: cfg.mode === 'auto' && u.t.length > STUB_AT ? u.s + STUB_LEN : u.e, sc: u.score });
  }
  return out;
}
function orderOf(atoms) { // band descending, then van der Corput of the atom index, then index
  atoms.forEach((a, i) => { a.band = Math.round(a.sc * 20); a.v = rev20(i); a.i = i; });
  return atoms.slice().sort((a, b) => b.band - a.band || a.v - b.v || a.i - b.i).map(a => [a.s, a.e]);
}
function softOf(text, units, lines, cfg, prof, lead, budget) { // soft must-keeps, entering the order ahead of every scored atom
  const out = [], nl = lines.length;
  for (let i = 0; i < Math.min(cfg.keepFirst, nl); i++) { const [s, e] = lines[i]; if (e > s) out.push([s, Math.min(e, s + cfg.lineCap)]); }
  for (let i = nl - 1, taken = 0; i >= 0 && taken < cfg.keepLast; i--) { const [s, e] = lines[i]; if (i === nl - 1 && e === s && nl > 1) continue; if (e > s) out.push([s, e]); taken++; }
  for (const u of units) if (u.t.length >= 40 && /\p{N}/u.test(u.t)) out.push([u.s, u.s + 6]);
  if (prof.lead) { // the lead token of each line in van der Corput line order, until 40% of the budget is spent
    let spent = 0;
    for (const li of [...lead.keys()].sort((a, b) => rev20(a) - rev20(b) || a - b)) {
      const u = lead.get(li), len = Math.min(12, u.e - u.s); spent += len + 8;
      if (spent > 0.4 * budget) break;
      out.push([u.s, u.s + len]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- closure and render
function runs(mask, v, fn) { for (let i = 0, n = mask.length; i < n;) { let j = i; while (j < n && mask[j] === v) j++; if (j > i) fn(i, j); i = j > i ? j : i + 1; } }
function closure(mask, ctx) { // 1 delimiters next to kept runs, 2 fill short gaps, 3 drop short unprotected runs, 4 never split a pair or CRLF
  const { n, delim, prot, text } = ctx, { minGap, minKeep } = ctx.cfg, add = [];
  runs(mask, 1, (a, b) => { if (a > 0 && delim[a - 1]) add.push(a - 1); if (b < n && delim[b]) add.push(b); });
  for (const i of add) mask[i] = 1;
  runs(mask, 0, (a, b) => { if (a > 0 && b < n && b - a < minGap) mask.fill(1, a, b); });
  runs(mask, 1, (a, b) => { if (b - a < minKeep && !prot.subarray(a, b).includes(1)) mask.fill(0, a, b); });
  for (let i = 0; i + 1 < n; i++) {
    if (mask[i] === mask[i + 1]) continue;
    const c = text.charCodeAt(i), d = text.charCodeAt(i + 1);
    if ((c >= 0xD800 && c <= 0xDBFF && d >= 0xDC00 && d <= 0xDFFF) || (c === 13 && d === 10)) { mask[i] = 1; mask[i + 1] = 1; }
  }
}
function render(text, mask, detailFrom) {
  const parts = []; let body = '', kept = 0;
  for (let i = 0, n = text.length; i < n;) {
    const v = mask[i]; let j = i; while (j < n && mask[j] === v) j++;
    if (v) { const s = text.slice(i, j); parts.push({ kept: s }); body += escapeKept(s); kept += j - i; }
    else { const o = omitOf(text, i, j, detailFrom); parts.push({ omit: o }); body += markerText(o); }
    i = j;
  }
  return { parts, body, kept };
}

// ---------------------------------------------------------------- stripe
function unreduced(text, cls, ignored) {
  return { text, reduced: false, parts: text ? [{ kept: text }] : [], class: cls, kept: text.length, n: text.length, rid: ID, ignored };
}
function hardOf(text, protect) { // protected spans: a mask of positions never cut
  const m = new Uint8Array(text.length);
  for (const src of protect) {
    let re; try { re = new RegExp(src, 'g'); } catch { continue; }
    for (const x of text.matchAll(re)) if (x[0].length) m.fill(1, x.index, x.index + x[0].length);
  }
  return m;
}
function search(ctx, order, budget) { // largest k with cost(k) <= budget (binary search); k 0 is the floor and is returned even over budget
  const ev = k => {
    const mask = ctx.hard.slice();
    for (let i = 0; i < k; i++) mask.fill(1, order[i][0], order[i][1]);
    closure(mask, ctx);
    const r = render(ctx.text, mask, ctx.cfg.detailFrom);
    r.cost = ctx.head(r.kept).length + 1 + r.body.length;
    return r;
  };
  let best = ev(0), lo = 0, hi = order.length + 1;
  if (best.cost > budget) return best;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1, r = ev(mid); if (r.cost <= budget) { lo = mid; best = r; } else hi = mid; }
  return best;
}
export function stripe(text, policy) {
  text = text == null ? '' : String(text);
  const p = policy && typeof policy === 'object' ? policy : {}, ignored = Object.keys(p).filter(k => !KEYS.has(k)).sort(), cfg = resolve(p), n = text.length;
  if (n > cfg.maxInput) throw new RangeError(`stripe: input of ${n} chars is over maxInput ${cfg.maxInput}`);
  const budget = budgetOf(cfg, n), sk = SKEL.exec(text), label = cfg.klass ?? (sk ? text.slice(0, text.indexOf(']')).split(' ')[3] : classify(text).label);
  if (sk || n <= budget) return unreduced(text, label, ignored);
  const lines = lineTable(text), segs = segmentStarts(lines, text, cfg.segment), prof = profileOf(label), units = unitsOf(text, lines, segs, cfg);
  const lead = scoreUnits(text, units, lines, segs, cfg, prof);
  const order = softOf(text, units, lines, cfg, prof, lead, budget).concat(orderOf(atomsOf(units, lines, cfg)));
  const ref = cfg.handle != null ? cfg.handle.replace(/[\s\]]/g, '_') : 'fp:' + fingerprint(text), cls = label.replace(/[^\x21-\x5c\x5e-\x7e]/g, '_');
  const dg = canon(Object.fromEntries(Object.keys(p).filter(k => k !== 'handle' && k !== 'seen').map(k => [k, p[k]])));
  const prev = Object.prototype.hasOwnProperty.call(cfg.seen, ref) ? cfg.seen[ref] : null, digest = fingerprint(dg);
  const same = prev && prev.rid === ID && prev.policyDigest === digest, suffix = prev && !same ? (Number.isFinite(Number(prev.pct)) ? ` seen ${Number(prev.pct)}%` : ' seen') : '';
  const delim = new Uint8Array(n).fill(1); for (const u of units) delim.fill(0, u.s, u.e);
  const head = kept => `[${ref} ${lines.length}L ${ID} ${cls} ${Math.round(100 * kept / n)}%${suffix}]`;
  const prot = hardOf(text, cfg.protect), r = search({ text, n, cfg, delim, prot, hard: prot, head }, order, budget);
  const out = { text: head(r.kept) + '\n' + r.body, reduced: true, parts: r.parts, class: label, kept: r.kept, n, rid: ID, ignored };
  if (same) return { ...out, text: head(r.kept).slice(0, -1) + ' seen]', parts: [] };
  return out;
}
