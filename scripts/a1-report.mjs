// A1.1 baseline report: aggregates the baseline jsonl (descriptive, no model involved).
//   node scripts/a1-report.mjs [file.jsonl] [--tags canary,full]
import fs from 'node:fs';
const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--tags') || 'docs/concepts/results/a1-baseline-2026-11-21.jsonl';
const ti = argv.indexOf('--tags'); const tags = ti >= 0 ? argv[ti + 1].split(',') : null;
const R = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !tags || tags.includes(r.tag));
const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const sum = (a, f) => a.reduce((x, r) => x + (f(r) || 0), 0);
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
const models = [...new Set(R.map(r => r.model))], shapes = ['lookup', 'aggregation', 'locate-then-act'], runs = [...new Set(R.map(r => r.run))].sort();
console.log(`rows ${R.length}, runs ${runs.join(',')}, cost $${sum(R, r => r.cost).toFixed(4)}`);
for (const m of models) {
  const M = R.filter(r => r.model === m);
  console.log(`\n== ${m}: solved ${M.filter(r => r.ok).length}/${M.length} (${pct(M.filter(r => r.ok).length, M.length)})`);
  for (const sh of ['all', ...shapes]) {
    const S = sh === 'all' ? M : M.filter(r => r.shape === sh);
    const per = runs.map(run => { const x = S.filter(r => r.run === run); return x.length ? Math.round(100 * x.filter(r => r.ok).length / x.length) : null; }).filter(v => v != null);
    const ok = S.filter(r => r.ok);
    console.log(`${sh.padEnd(16)} solved ${String(S.filter(r => r.ok).length).padStart(2)}/${String(S.length).padEnd(2)} ${pct(ok.length, S.length).padStart(4)}  per-run % min/med/max ${Math.min(...per)}/${med(per)}/${Math.max(...per)}  ` +
      `limit-stops ${S.filter(r => r.stop === 'limit').length}  nudges med ${med(S.map(r => r.nudges))}  ` +
      `prompt/solved ${ok.length ? Math.round(sum(ok, r => r.prompt) / ok.length) : '-'}  cost/solved $${ok.length ? (sum(ok, r => r.cost) / ok.length).toFixed(5) : '-'}  cost/all $${(sum(S, r => r.cost) / (S.length || 1)).toFixed(5)}`);
  }
}
console.log('\nper question (solved/rows, per model):');
for (const id of [...new Set(R.map(r => r.id))].sort()) console.log(id, models.map(m => { const x = R.filter(r => r.id === id && r.model === m); return `${m.split('/')[1]} ${x.filter(r => r.ok).length}/${x.length}`; }).join('  '));
const bad = R.filter(r => !r.ok);
console.log('\nunsolved:'); for (const r of bad) console.log(`${r.tag} r${r.run} ${r.id} ${r.model.split('/')[1]} stop=${r.stop} state=${r.state} nud=${r.nudges} got=${JSON.stringify(r.got)} exp=${JSON.stringify(r.expected)}`);
