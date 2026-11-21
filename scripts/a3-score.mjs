// A3.1 scoring, plain node, no browser, no key: node scripts/a3-score.mjs [--rows docs/concepts/results/a3-validators-2026-11-21.jsonl] [--tag main] [--json out.json]
//  1. the hand extraction: self-check (own patterns against its witnesses and decoys), then resolve every shape against every recorded session
//  2. the cheap models' replies (raw rows of the driver): yield, agreement with the hand extraction, resolvability, cost, n
// Definitions are fixed in docs/concepts/results/a3-validators-protocol-2026-11-21.md.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCorpus, resolveShape, parseReply, itemFault, hasShape, equivalent } from './a3-lib.mjs';
import { handRows } from './a3-hand.mjs';

const argv = process.argv.slice(2), opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ROWS = path.resolve(opt('rows', path.join(ROOT, 'docs/concepts/results/a3-validators-2026-11-21.jsonl'))), tag = opt('tag', 'main');
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : 'n/a';
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const rng = a => a.length ? `${Math.min(...a)}..${Math.max(...a)}` : 'n/a';

const corpus = loadCorpus(), hand = handRows(), N = hand.length, shaped = hand.filter(h => h.shape);
const out = { corpus: {}, hand: [], models: {} };
for (const c of corpus) out.corpus[c.kind] = (out.corpus[c.kind] || 0) + 1;
console.log(`corpus: ${corpus.length} records ${JSON.stringify(out.corpus)}`);

// resolve one shape over the corpus -> {pass, fail, unresolved, reasons, resolvable (>=1 pass|fail), applicable (>=1 pass)}
const over = shape => {
  const r = { pass: 0, fail: 0, unresolved: 0, reasons: {} };
  for (const c of corpus) { const x = resolveShape(shape, c); r[x.outcome]++; if (x.outcome === 'unresolved') r.reasons[x.reason] = (r.reasons[x.reason] || 0) + 1; }
  r.resolvable = r.pass + r.fail > 0; r.applicable = r.pass > 0; return r;
};

// ---- 1. hand
console.log('\n## hand extraction');
let selfBad = 0;
for (const h of hand) {
  const row = { line: h.line, section: h.section, shaped: !!h.shape, strength: h.shape?.strength ?? null, check: h.shape?.check ?? null, none_reason: h.none_reason ?? null };
  if (h.shape) {
    const eq = equivalent(h.shape, h); row.self = eq.ok ? 'ok' : eq.why; if (!eq.ok) selfBad++;
    const o = over(h.shape); Object.assign(row, { pass: o.pass, fail: o.fail, unresolved: o.unresolved, resolvable: o.resolvable, applicable: o.applicable, reasons: o.reasons });
  }
  out.hand.push(row);
  console.log(`L${h.line} ${h.shape ? `${h.shape.check}/${h.shape.strength} self ${row.self} pass ${row.pass} fail ${row.fail} unres ${row.unresolved} ${JSON.stringify(row.reasons)}` : `none (${h.none_reason})`}`);
}
const hs = out.hand.filter(r => r.shaped), strong = hs.filter(r => r.strength === 'strong');
const sum = {
  bullets: N, shaped: hs.length, strong: strong.length, weak: hs.length - strong.length, self_bad: selfBad,
  resolvable: hs.filter(r => r.resolvable).length, resolvable_strong: strong.filter(r => r.resolvable).length, applicable: hs.filter(r => r.applicable).length,
  records_resolved: out.hand.reduce((a, r) => a + (r.pass || 0) + (r.fail || 0), 0), records_total: hs.length * corpus.length,
};
out.hand_summary = sum;
console.log(`\nyield ${sum.shaped}/${N} (${pct(sum.shaped, N)}); strong ${sum.strong} weak ${sum.weak}; hand self-check bad ${selfBad}`);
console.log(`resolvable (>=1 record pass|fail): ${sum.resolvable}/${sum.shaped} of shaped (${pct(sum.resolvable, sum.shaped)}), ${sum.resolvable}/${N} of all bullets (${pct(sum.resolvable, N)}); strong shapes ${sum.resolvable_strong}/${sum.strong}`);
console.log(`applicable (>=1 record pass): ${sum.applicable}/${sum.shaped}; shape x record pairs resolved ${sum.records_resolved}/${sum.records_total} (${pct(sum.records_resolved, sum.records_total)})`);

// ---- 2. models
const rows = fs.existsSync(ROWS) ? fs.readFileSync(ROWS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.tag === tag) : [];
const byLine = Object.fromEntries(hand.map(h => [h.line, h]));
const per = {};
for (const r of rows) {
  const items = parseReply(r.reply), m = { run: r.run, parsed: !!items, cost: r.cost, hand_shaped: 0, yield: 0, valid: 0, items: items?.length ?? 0, shaped_on_hand_shaped: 0, equivalent: 0, shaped_on_hand_none: 0, resolvable: 0, faults: {}, lines_missing: 0 };
  if (items) {
    const seen = new Map(); for (const o of items) if (o && Number.isInteger(o.line) && !seen.has(o.line)) seen.set(o.line, o);
    m.lines_missing = hand.filter(h => !seen.has(h.line)).length; m.unknown_lines = [...seen.keys()].filter(l => !byLine[l]).length;
    for (const h of hand) {
      const o = seen.get(h.line); if (!o) continue;
      const f = itemFault(o); if (f) m.faults[f] = (m.faults[f] || 0) + 1; else m.valid++;
      const hs_ = hasShape(o);
      if (hs_) { m.yield++; if (over(o).resolvable) m.resolvable++; }
      if (h.shape) { m.hand_shaped++; if (hs_) { m.shaped_on_hand_shaped++; if (equivalent(o, h).ok) m.equivalent++; } }
      else if (hs_) m.shaped_on_hand_none++;
    }
  }
  (per[r.model] ||= []).push(m);
}
const HS = shaped.length;
console.log('\n## models (hand: yield ' + HS + '/' + N + ')');
for (const [model, ms] of Object.entries(per)) {
  const ok = ms, parsedN = ms.filter(m => m.parsed).length, cost = ms.reduce((a, m) => a + (m.cost || 0), 0);
  const s = out.models[model] = { n_runs: ms.length, parsed: parsedN, cost: +cost.toFixed(6), cost_per_run: +(cost / ms.length).toFixed(6),
    yield_median: med(ok.map(m => m.yield)), yield_parsed_median: med(ms.filter(m => m.parsed).map(m => m.yield)), yield_range: rng(ok.map(m => m.yield)), recall_shaped_median: med(ok.map(m => m.shaped_on_hand_shaped)), equivalent_median: med(ok.map(m => m.equivalent)), equivalent_range: rng(ok.map(m => m.equivalent)),
    extra_on_hand_none_median: med(ok.map(m => m.shaped_on_hand_none)), resolvable_median: med(ok.map(m => m.resolvable)), valid_median: med(ok.map(m => m.valid)), runs: ms };
  console.log(`${model}: n ${s.n_runs} parsed ${s.parsed}; yield median ${s.yield_median}/${N} (range ${s.yield_range}; parsed runs only ${s.yield_parsed_median}) vs hand ${HS}; on the ${HS} hand-shaped: shaped ${s.recall_shaped_median}, equivalent ${s.equivalent_median} (range ${s.equivalent_range}); on the ${N - HS} hand-none: shaped ${s.extra_on_hand_none_median}; resolvable ${s.resolvable_median}; valid items ${s.valid_median}; cost $${s.cost.toFixed(5)} ($${s.cost_per_run.toFixed(5)}/run)`);
}
if (!rows.length) console.log('(no model rows at ' + ROWS + ')');
if (opt('json', null)) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(out, null, 1) + '\n');
