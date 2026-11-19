// Run the smoke suites and write a record of every check (docs/STEMS.md §4).
// Usage: node scripts/ci.mjs [main] [git] [vm] [--url URL] [--out ci-record.json]
// Exit status 1 when a check fails or a suite stops early.
//
// record: {sha, t, suites: [{suite, ok, ms, checks: [{name, ok}], failed: [names], stopped, tail}]}
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const url = flag('url', 'http://localhost:8787/'), out = flag('out', 'ci-record.json');
const FILES = { main: 'scripts/smoke.mjs', git: 'scripts/smoke-git.mjs', vm: 'scripts/smoke-vm.mjs', keys: 'scripts/test-paste-keys.mjs' };
const want = args.length ? args : ['main', 'git', 'keys'];

const run = suite => new Promise(ok => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [FILES[suite], url], { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  p.stdout.on('data', d => { text += d; process.stdout.write(d); });
  p.stderr.on('data', d => { text += d; process.stderr.write(d); });
  p.on('close', code => {
    const checks = [...text.matchAll(/^(PASS|FAIL) (.+?)(?: [\[{"].*)?$/gm)].map(m => ({ name: m[2].trim(), ok: m[1] === 'PASS' }));
    const failed = checks.filter(c => !c.ok).map(c => c.name);
    const stopped = code !== 0 && !failed.length; // ended early (an exception), not a failed check
    ok({ suite, ok: code === 0 && !failed.length, ms: Date.now() - t0, checks, failed, stopped, tail: text.split('\n').slice(-40).join('\n') });
  });
});

const record = { sha: process.env.GITHUB_SHA || '', t: new Date().toISOString(), suites: [] };
for (const s of want) if (FILES[s]) record.suites.push(await run(s));
fs.writeFileSync(out, JSON.stringify(record, null, 1));
const bad = record.suites.filter(s => !s.ok);
console.log(`\nci: ${record.suites.map(s => `${s.suite} ${s.ok ? 'ok' : 'FAILED'} (${s.checks.filter(c => c.ok).length}/${s.checks.length})`).join(', ')} -> ${out}`);
process.exitCode = bad.length ? 1 : 0;
