// Deterministic measurement of the striping reducer (stripe-1.0, docs/STRIPE.md section 7 items 1 to 5). No model, no network.
// Corpus: repo files only (docs, catalog, a few app sources, fixtures and trace fixtures, plus generated repo logs pinned to a commit).
// Usage: node scripts/measure-stripe.mjs [--date YYYY-MM-DD] [--out docs/concepts/results]
// Writes <out>/stripe-det-<date>.json and a short .md table. Baseline: head and tail of outstore.present ('ends'), at equal output chars.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripe, parse, verify, classify, fingerprint, ID } from '../app/stripe.js';
import { squeeze } from '../app/outstore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DATE = arg('date', new Date().toISOString().slice(0, 10)), OUT = join(ROOT, arg('out', 'docs/concepts/results'));
const PIN = 'fbdd865'; // generated repo logs are pinned to this commit so the corpus does not drift when the branch grows
const MAXN = 120000;
const FRACTIONS = [0.1, 0.25, 0.5], MODES = ['auto', 'words', 'lines', 'chars'];

// ---------------------------------------------------------------- corpus
const blobs = [];
const add = (id, kind, raw) => { const text = squeeze(String(raw)); if (text.length >= 300 && text.length <= MAXN) blobs.push({ id, kind, text }); };
const rd = p => readFileSync(join(ROOT, p), 'utf8');
const ls = d => readdirSync(join(ROOT, d)).filter(f => !f.startsWith('.')).sort().map(f => d + '/' + f);
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }); } catch { return ''; } };
const run = (...a) => { try { return execFileSync('node', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120000 }); } catch (e) { return String(e.stdout || ''); } };

for (const f of [...ls('docs'), ...ls('docs/concepts')].filter(f => f.endsWith('.md'))) add(f, 'docs', rd(f));
for (const f of ls('catalog').filter(f => f.endsWith('.jsonl'))) {
  add(f, 'catalog', rd(f));
  const lines = rd(f).split('\n').filter(Boolean);
  add(f + '#tail10', 'catalog-excerpt', lines.slice(-10).join('\n'));
}
for (const f of ['app/outstore.js', 'app/handles.js', 'app/strategies.js', 'app/checkpoints.js', 'app/context.js', 'app/providers.js', 'app/tools.js', 'app/validators.js', 'app/stripe.js']) if (existsSync(join(ROOT, f))) add(f, 'code', rd(f));
for (const f of ls('scripts/fixtures').filter(f => f.endsWith('.json'))) add(f, 'fixture-json', rd(f));
const seenStr = new Set();
const walk = (v, f, p) => {
  // streamed chunks are near-duplicates of one reply: left out
  if (typeof v === 'string') { if (v.length >= 800 && !seenStr.has(v) && !/\.chunks\[/.test(p)) { seenStr.add(v); add(`${f}#${p}`, 'trace-string', v); } }
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, f, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], f, `${p}.${k}`);
};
for (const f of [...ls('docs/live-evidence'), 'scripts/sample.trace'].filter(f => f.endsWith('.trace'))) { try { walk(JSON.parse(rd(f)), f, ''); } catch { /* not json: skipped */ } }
add('gen:git-log-oneline', 'log', git('log', '--oneline', '-n', '120', PIN));
add('gen:git-log-table', 'table', git('log', '--date=short', '--format=%h | %ad | %an | %s', '-n', '80', PIN));
add('gen:git-ls-tree', 'table', git('ls-tree', '-r', '-l', PIN, '--', 'app', 'scripts', 'docs'));
add('gen:git-log-stat', 'log', git('log', '--stat', '-n', '10', PIN));
add('gen:test-validators', 'log', run('scripts/test-validators.mjs'));
add('gen:test-stripe', 'log', run('scripts/test-stripe.mjs'));

// ---------------------------------------------------------------- baseline: head and tail (outstore.present 'ends': 900 head, 400 tail), sized to equal output chars
function ends(text, outLen, ref) {
  const lines = text.split('\n').length, tag = `[${ref} ${lines}L ends]`, room = Math.max(2, outLen - tag.length - 8); // 8 = "\n" + "\n[...]\n"
  const h = Math.max(1, Math.round(room * 900 / 1300)), t = Math.max(1, room - h);
  const hh = Math.min(h, text.length), tt = Math.min(t, text.length - hh);
  return { text: `${tag}\n${text.slice(0, hh)}\n[...]\n${text.slice(text.length - tt)}`, ranges: [[0, hh], [text.length - tt, text.length]], kept: hh + tt };
}

// ---------------------------------------------------------------- metrics
const UNIT = /[\p{L}\p{N}_]+(?:[./:\\@#-][\p{L}\p{N}_]+)*/gu;
const isIdent = t => /[_./:\\@#]/.test(t) || /\p{Ll}\p{Lu}/u.test(t) || (/\p{L}/u.test(t) && /\p{N}/u.test(t));
const isNum = t => /^\d[\d.,:]*$/.test(t);
function typesOf(text) { // lowercased unit types with their line df, occurrences and the class flags
  const lines = text.split('\n'), types = new Map(); let off = 0;
  const lineStart = [0]; for (const l of lines) lineStart.push(lineStart[lineStart.length - 1] + l.length + 1);
  let li = 0;
  for (const m of text.matchAll(UNIT)) {
    while (li + 1 < lines.length && lineStart[li + 1] <= m.index) li++;
    const k = m[0].toLowerCase();
    let ty = types.get(k); if (!ty) types.set(k, ty = { k, t: m[0], dfLines: new Set(), occ: [] });
    ty.dfLines.add(li); ty.occ.push([m.index, m.index + m[0].length]);
  }
  const all = [...types.values()].sort((a, b) => b.dfLines.size - a.dfLines.size || (a.k < b.k ? -1 : 1));
  const decile = new Set(all.slice(0, Math.max(1, Math.ceil(all.length / 10))).filter(x => x.dfLines.size >= 2).map(x => x.k));
  for (const ty of all) { ty.rare = ty.dfLines.size === 1; ty.common = decile.has(ty.k); ty.ident = isIdent(ty.t); ty.num = isNum(ty.t); }
  return all;
}
const recog = (mask, s, e) => { let c = 0; for (let i = s; i < e; i++) c += mask[i]; return c >= Math.min(e - s, 6); }; // >= 6 chars of the unit (or all of a shorter one) survive
const whole = (mask, s, e) => { for (let i = s; i < e; i++) if (!mask[i]) return false; return true; };
function retention(types, mask) { // per category: [retained types (recognizable), retained types (whole), total types]
  const cat = { rare: [0, 0, 0], common: [0, 0, 0], ident: [0, 0, 0], num: [0, 0, 0], all: [0, 0, 0] };
  for (const ty of types) {
    const r = ty.occ.some(([s, e]) => recog(mask, s, e)), w = ty.occ.some(([s, e]) => whole(mask, s, e));
    for (const c of ['all', 'rare', 'common', 'ident', 'num']) if (c === 'all' || ty[c]) { cat[c][2]++; if (r) cat[c][0]++; if (w) cat[c][1]++; }
  }
  return cat;
}
const maskOfParts = (parts, n) => { const m = new Uint8Array(n); let pos = 0; for (const p of parts) { if (p.kept != null) { m.fill(1, pos, pos + p.kept.length); pos += p.kept.length; } else pos += p.omit.n; } return m; };
const maskOfRanges = (rs, n) => { const m = new Uint8Array(n); for (const [a, b] of rs) m.fill(1, a, b); return m; };
const markerChars = parts => parts.reduce((s, p) => s + (p.omit ? `[~${p.omit.n}${p.omit.w != null ? ',w' + p.omit.w : ''}${p.omit.l != null ? ',l' + p.omit.l : ''}${p.omit.k ? ',k' + p.omit.k : ''}]`.length : 0), 0);
const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = x => x == null ? null : Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- run
const rows = [], failures = [], labels = {};
const typeCache = new Map();
for (const b of blobs) {
  const cls = classify(b.text).label; b.label = cls; labels[cls] = (labels[cls] || 0) + 1;
  b.types = typesOf(b.text); b.fp = fingerprint(b.text);
}
for (const b of blobs) {
  const n = b.text.length, ref = 'os:' + b.fp;
  for (const mode of MODES) for (const fraction of FRACTIONS) {
    const pol = { mode, fraction, handle: ref }, budget = fraction * n;
    const t0 = performance.now(); const a = stripe(b.text, pol); const ms = performance.now() - t0;
    const row = { blob: b.id, kind: b.kind, n, mode, fraction, label: b.label, reduced: a.reduced };
    if (!a.reduced) { rows.push(row); continue; }
    const b2 = stripe(b.text, { handle: ref, fraction, mode }); // key order permuted
    const det = a.text === b2.text && fingerprint(a.text) === fingerprint(b2.text);
    let pb = false, parsed = null;
    try { parsed = parse(a.text); pb = verify(b.text, parsed); } catch (e) { failures.push({ blob: b.id, mode, fraction, what: 'parse', err: String(e.message) }); }
    const idem = stripe(a.text, pol).text === a.text;
    if (!pb) failures.push({ blob: b.id, mode, fraction, what: 'parse-back' });
    if (!det) failures.push({ blob: b.id, mode, fraction, what: 'determinism' });
    if (!idem) failures.push({ blob: b.id, mode, fraction, what: 'idempotence' });
    const out = a.text.length, mk = parsed ? markerChars(parsed.parts) : 0, hdr = a.text.indexOf('\n') + 1;
    const smask = parsed ? maskOfParts(parsed.parts, n) : new Uint8Array(n);
    const base = ends(b.text, out, ref), bmask = maskOfRanges(base.ranges, n);
    Object.assign(row, {
      out, budget: Math.round(budget), outOverBudget: r4(out / budget), kept: a.kept, retained: r4(a.kept / n), outFrac: r4(out / n),
      markerOverhead: r4(mk / out), markers: parsed ? parsed.parts.filter(p => p.omit).length : 0, headerLen: hdr - 1,
      parseBack: pb, determinism: det, idempotent: idem, ms: r4(ms), headerClass: parsed ? parsed.header.class : null,
      baseKept: base.kept, baseRetained: r4(base.kept / n), baseOut: base.text.length,
      s: retention(b.types, smask), h: retention(b.types, bmask),
    });
    rows.push(row);
  }
}

// ---------------------------------------------------------------- aggregate
function pooled(rs, side, cat) { let r = 0, w = 0, t = 0; for (const x of rs) { const c = x[side][cat]; r += c[0]; w += c[1]; t += c[2]; } return { retained: r, whole: w, total: t, share: t ? r4(r / t) : null, wholeShare: t ? r4(w / t) : null }; }
function aggregate(rs) {
  const red = rs.filter(r => r.reduced), o = { blobs: rs.length, reduced: red.length };
  if (!red.length) return o;
  o.retainedMedian = r4(median(red.map(r => r.retained))); o.baseRetainedMedian = r4(median(red.map(r => r.baseRetained)));
  o.outOverBudgetMedian = r4(median(red.map(r => r.outOverBudget)));
  o.markerOverheadMedian = r4(median(red.map(r => r.markerOverhead)));
  o.parseBack = red.filter(r => r.parseBack).length + '/' + red.length;
  o.determinism = red.filter(r => r.determinism).length + '/' + red.length;
  o.idempotent = red.filter(r => r.idempotent).length + '/' + red.length;
  const tot = red.reduce((s, r) => s + r.n, 0); o.msPer100KB = r4(red.reduce((s, r) => s + r.ms, 0) / tot * 100000);
  for (const c of ['rare', 'common', 'ident', 'num', 'all']) {
    const s = pooled(red, 's', c), h = pooled(red, 'h', c);
    o[c] = { stripe: s.share, ends: h.share, ratio: h.share ? r4(s.share / h.share) : null, stripeWhole: s.wholeShare, endsWhole: h.wholeShare, types: s.total };
  }
  return o;
}
const groups = {}, groups2k = {}, byClass = {};
for (const mode of MODES) for (const f of FRACTIONS) {
  const rs = rows.filter(r => r.mode === mode && r.fraction === f);
  groups[`${mode}@${f}`] = aggregate(rs); groups2k[`${mode}@${f}`] = aggregate(rs.filter(r => r.n >= 2000));
  if (mode === 'auto') for (const lab of Object.keys(labels).sort()) { const x = rs.filter(r => r.label === lab); if (x.length) (byClass[lab] ??= {})[f] = { ...aggregate(x), n: x.length }; }
}
const red2k = rows.filter(r => r.reduced && r.n >= 2000);
const thresholds = {
  note: 'provisional, docs/STRIPE.md section 7; n >= 2000 and reduced',
  budgetWithin10pct: { auto: red2k.filter(r => r.mode === 'auto').filter(r => Math.abs(r.outOverBudget - 1) <= 0.1).length + '/' + red2k.filter(r => r.mode === 'auto').length },
  markerOverheadUnder30pct: { auto: red2k.filter(r => r.mode === 'auto').filter(r => r.markerOverhead < 0.3).length + '/' + red2k.filter(r => r.mode === 'auto').length },
  overBudgetRows: red2k.filter(r => r.outOverBudget > 1).length,
};
const headerClassMismatch = rows.filter(r => r.reduced && r.headerClass !== r.label).length;

// ---------------------------------------------------------------- class profile ablation (concept axkihp): the labelled profile against a class-neutral one (class override 'neutral' = default profile), same budget
function leadsKeys(text, mask) { // share of line-lead units retained, and of JSON-key units (followed by ": ) retained
  const l = [0, 0], k = [0, 0]; let off = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) { UNIT.lastIndex = 0; const m = UNIT.exec(line); if (m) { l[1]++; if (recog(mask, off + m.index, off + m.index + m[0].length)) l[0]++; } }
    off += line.length + 1;
  }
  for (const m of text.matchAll(UNIT)) if (text.slice(m.index + m[0].length, m.index + m[0].length + 2) === '":') { k[1]++; if (recog(mask, m.index, m.index + m[0].length)) k[0]++; }
  return { lead: l, key: k };
}
const ablation = [];
for (const b of blobs) {
  if (!/log|tabular|json/.test(b.label)) continue;
  for (const fraction of [0.1, 0.25]) {
    const ref = 'os:' + b.fp, a = stripe(b.text, { fraction, handle: ref }), z = stripe(b.text, { fraction, handle: ref, class: 'neutral' });
    if (!a.reduced || !z.reduced) continue;
    const ma = maskOfParts(parse(a.text).parts, b.text.length), mz = maskOfParts(parse(z.text).parts, b.text.length);
    ablation.push({ blob: b.id, label: b.label, n: b.text.length, fraction, out: [a.text.length, z.text.length], profile: { ...leadsKeys(b.text, ma), r: retention(b.types, ma) }, neutral: { ...leadsKeys(b.text, mz), r: retention(b.types, mz) } });
  }
}
const ablGroup = (pred, fraction) => {
  const rs = ablation.filter(r => pred(r.label) && r.fraction === fraction), o = { runs: rs.length };
  const sum = (side, f, i) => rs.reduce((s, r) => s + r[side][f][i], 0), rsum = (side, c, i) => rs.reduce((s, r) => s + r[side].r[c][i], 0);
  for (const side of ['profile', 'neutral']) o[side] = { lead: sum(side, 'lead', 1) ? r4(sum(side, 'lead', 0) / sum(side, 'lead', 1)) : null, key: sum(side, 'key', 1) ? r4(sum(side, 'key', 0) / sum(side, 'key', 1)) : null,
    rare: r4(rsum(side, 'rare', 0) / (rsum(side, 'rare', 2) || 1)), ident: r4(rsum(side, 'ident', 0) / (rsum(side, 'ident', 2) || 1)), num: r4(rsum(side, 'num', 0) / (rsum(side, 'num', 2) || 1)) };
  return o;
};
const ablationSummary = {};
for (const f of [0.1, 0.25]) { ablationSummary[`json@${f}`] = ablGroup(l => l.includes('json'), f); ablationSummary[`log-or-tabular@${f}`] = ablGroup(l => /log|tabular/.test(l) && !l.includes('json'), f); }
const meta = { rid: ID, date: DATE, script: 'scripts/measure-stripe.mjs', pinnedCommit: PIN, node: process.version, baseline: "head and tail 'ends' (outstore.present: 900 head : 400 tail) sized to the same output chars as the skeleton, tag line counted",
  definitions: { retained: 'kept source chars / n', rare: 'lowercased unit types in exactly one line', common: 'types in the top decile by line df (df >= 2)', ident: 'unit contains _ . / : \\ @ # or a lower-upper step or letters and digits', num: 'unit matches ^\\d[\\d.,:]*$',
    retention: 'type counts as retained when any occurrence has >= min(len, 6) chars inside kept spans; whole = any occurrence fully kept; pooled over blobs (sum retained / sum types)', ms: 'wall time of the first stripe call per row, warm process, not part of determinism' } };
const result = { meta, corpus: blobs.map(b => ({ id: b.id, kind: b.kind, n: b.text.length, label: b.label, fp: b.fp })), labelDistribution: labels, failures, headerClassMismatch, thresholds, groupsAll: groups, groupsN2000: groups2k, autoByClass: byClass, classAblation: { summary: ablationSummary, rows: ablation }, rows };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `stripe-det-${DATE}.json`), JSON.stringify(result));

// ---------------------------------------------------------------- short table
const pc = x => x == null ? '-' : (100 * x).toFixed(0) + '%', rt = x => x == null ? '-' : x.toFixed(2) + 'x';
let md = `# stripe-1.0 deterministic measurement, ${DATE}\n\nScript \`scripts/measure-stripe.mjs\` (node ${process.version}); ${blobs.length} blobs, ${rows.length} runs; no model. Baseline: head and tail (\`ends\`) at equal output chars. Retention is pooled over blobs with n >= 2000 (type level; see JSON \`meta.definitions\`). Raw rows in \`stripe-det-${DATE}.json\`.\n\n`;
md += `| mode | frac | blobs | retained (median) | out/budget | marker overhead | rare s/e (ratio) | common s/e | ident s/e (ratio) | num s/e (ratio) | parse-back | determinism | idempotent | ms/100KB |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
for (const [k, g] of Object.entries(groups2k)) {
  if (!g.reduced) continue; const [m, f] = k.split('@'), a = groupsAllParse(groups[k]);
  md += `| ${m} | ${f} | ${g.reduced} | ${pc(g.retainedMedian)} vs ${pc(g.baseRetainedMedian)} | ${g.outOverBudgetMedian} | ${pc(g.markerOverheadMedian)} | ${pc(g.rare.stripe)}/${pc(g.rare.ends)} (${rt(g.rare.ratio)}) | ${pc(g.common.stripe)}/${pc(g.common.ends)} | ${pc(g.ident.stripe)}/${pc(g.ident.ends)} (${rt(g.ident.ratio)}) | ${pc(g.num.stripe)}/${pc(g.num.ends)} (${rt(g.num.ratio)}) | ${a.parseBack} | ${a.determinism} | ${a.idempotent} | ${g.msPer100KB} |\n`;
}
function groupsAllParse(g) { return g; }
md += `\nParse-back, determinism and idempotence columns are over all blobs of the group (any n). Retained (median) is stripe kept chars over n against the baseline's at equal output chars.\n\n## Class labels (blob level)\n\n| label | blobs |\n| --- | --- |\n`;
for (const [k, v] of Object.entries(labels).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;
md += `\n## auto at 0.25 by class (all sizes, pooled)\n\n| class | runs | rare s/e | ident s/e | num s/e |\n| --- | --- | --- | --- | --- |\n`;
for (const [lab, o] of Object.entries(byClass)) { const g = o[0.25]; if (g && g.reduced) md += `| ${lab} | ${g.reduced} | ${pc(g.rare.stripe)}/${pc(g.rare.ends)} | ${pc(g.ident.stripe)}/${pc(g.ident.ends)} | ${pc(g.num.stripe)}/${pc(g.num.ends)} |\n`; }
md += `\nProvisional thresholds (auto, n >= 2000): budget within 10%: ${thresholds.budgetWithin10pct.auto}; marker overhead under 30%: ${thresholds.markerOverheadUnder30pct.auto}; rows over budget (all modes): ${thresholds.overBudgetRows}. Failures (parse-back, determinism, idempotence): ${failures.length}. Header class equal to classify() on all reduced rows: ${headerClassMismatch === 0}.\n`;
md += `
## Class profile against class-neutral (concept axkihp; same budget, pooled; lead = first unit of each line, key = JSON key units)

| group | frac | runs | lead profile/neutral | key profile/neutral | rare | ident | num |
| --- | --- | --- | --- | --- | --- | --- | --- |
`;
for (const [k, g] of Object.entries(ablationSummary)) { const [grp, f] = k.split('@'); if (!g.runs) continue; md += `| ${grp} | ${f} | ${g.runs} | ${pc(g.profile.lead)}/${pc(g.neutral.lead)} | ${pc(g.profile.key)}/${pc(g.neutral.key)} | ${pc(g.profile.rare)}/${pc(g.neutral.rare)} | ${pc(g.profile.ident)}/${pc(g.neutral.ident)} | ${pc(g.profile.num)}/${pc(g.neutral.num)} |
`; }
writeFileSync(join(OUT, `stripe-det-${DATE}.md`), md);
console.log(`blobs ${blobs.length}, rows ${rows.length}, failures ${failures.length}, headerClassMismatch ${headerClassMismatch}`);
console.log(md.split('\n').slice(4, 20).join('\n'));
