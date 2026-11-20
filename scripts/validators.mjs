#!/usr/bin/env node
// Step validators from a skill or agent md file, resolved against recorded sessions (docs/concepts/FLOWS.md F1).
// The logic is app/validators.js; this reads files and prints counts. By code only: no model, no request.
//
//   node scripts/validators.mjs <file.md> [--records <file>]... [--out <file.jsonl>] [--json]
//
// --records  a .session export, a .trace export, a turn profile JSON (wh profile -o), or one stored session
// --out      append the records as lines ({"record": "step validator" | "validation result", ...}); never rewritten
// The exit status is 0 whatever the outcomes: a failed validation is a record, not an error.
import fs from 'node:fs';
import path from 'node:path';
import * as V from '../app/validators.js';

const argv = process.argv.slice(2), records = [];
const take = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
for (let f; (f = take('records')) !== undefined;) records.push(f);
const out = take('out'), asJson = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
const src = argv[0];
if (!src) { console.error('usage: node scripts/validators.mjs <file.md> [--records <file>]... [--out <file.jsonl>] [--json]'); process.exit(2); }

const text = fs.readFileSync(src, 'utf8'), rel = src.replace(/\\/g, '/');
const validators = V.extract(text, rel), sources = { [rel]: text };

// a records file -> [{from, record}]
function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), from = path.basename(file);
  if (j.kind === 'webharness.trace') return V.fromTrace(j, from.replace(/\.trace$/, '')).map(record => ({ from, record }));
  if (Array.isArray(j.sessions)) return j.sessions.map(record => ({ from, record }));
  return [{ from, record: j }];
}
const runs = records.flatMap(load).map(({ from, record }) => { const ev = V.read(record); return { from, session: ev?.session ?? record.id ?? null, kind: ev?.kind ?? null, calls: ev?.calls.length ?? null, results: V.resolveAll(validators, record, { sources }) }; });

if (out) fs.appendFileSync(out, [...validators.map(v => ({ record: 'step validator', ...v })), ...runs.flatMap(r => r.results.map(x => ({ record: 'validation result', ...x })))].map(o => JSON.stringify(o)).join('\n') + '\n');

const checkable = validators.filter(v => v.check), byCheck = {};
for (const v of validators) byCheck[v.check || 'none'] = (byCheck[v.check || 'none'] || 0) + 1;
const all = V.tally(runs.flatMap(r => r.results)), shaped = V.tally(runs.flatMap(r => r.results.filter((x, i) => validators[i].check)));
const summary = { source: rel, bullets: validators.length, checkable: checkable.length, byCheck, records: runs.length, results: all, checkableResults: shaped, runs: runs.map(r => ({ from: r.from, session: r.session, kind: r.kind, calls: r.calls, ...V.tally(r.results) })) };
if (asJson) console.log(JSON.stringify(summary, null, 1));
else {
  const reasons = t => Object.entries(t.reasons).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`${rel}: ${validators.length} bullets, ${checkable.length} with a checkable shape (${Object.entries(byCheck).map(([k, n]) => `${k} ${n}`).join(', ')})`);
  for (const v of validators) console.log(`  ${v.id} lines ${v.source_line_range.join('-')} ${String(v.applies_to.section).slice(0, 10).padEnd(10)} ${(v.check || 'none').padEnd(8)} ${v.shape ? [...v.shape.expected.map(e => e.text), ...v.shape.forbidden.map(e => 'not ' + e.text)].join(' | ') : ''}`);
  for (const r of runs) { const t = V.tally(r.results); console.log(`${r.from} ${r.session} (${r.kind || 'unread'}, ${r.calls ?? '-'} calls): pass ${t.pass}, fail ${t.fail}, unresolved ${t.unresolved}${reasons(t) ? ' (' + reasons(t) + ')' : ''}`); }
  if (runs.length) console.log(`${runs.length} records x ${validators.length} validators: pass ${all.pass}, fail ${all.fail}, unresolved ${all.unresolved} (${reasons(all)}); of the ${checkable.length} checkable: pass ${shaped.pass}, fail ${shaped.fail}, unresolved ${shaped.unresolved}`);
  if (out) console.log(`appended to ${out}`);
}
