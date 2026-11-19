// After a CI run: passes stay silent; a failing suite opens (or updates) one concern
// issue with its break window; a passing suite closes its open one (docs/STEMS.md §4).
// Runs in GitHub Actions with gh and GH_TOKEN; reads ci-record.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const rec = JSON.parse(fs.readFileSync(process.argv[2] || 'ci-record.json', 'utf8'));
const sha = rec.sha || process.env.GITHUB_SHA || '';
const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' }).trim();
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const FOOT = '\n\n---\n_Posted by the Tests workflow_';
const short = s => (s || '').slice(0, 7);

for (const [name, color, d] of [['ci-failure', 'b60205', 'a test suite fails on main'], ['concern', 'd4c5f9', 'a concern for the harness'], ['kind:ci', 'c5def5', 'from CI']])
  try { gh('label', 'create', name, '--color', color, '--description', d, '--force'); } catch {}

// the last commit this workflow passed on (the green end of a break window)
let green = '';
try { green = gh('run', 'list', '--workflow', process.env.WORKFLOW_FILE || 'test.yml', '--branch', 'main', '--status', 'success', '--limit', '1', '--json', 'headSha', '--jq', '.[0].headSha'); } catch {}

for (const s of rec.suites) {
  const label = 'suite:' + s.suite;
  try { gh('label', 'create', label, '--color', 'ededed', '--force'); } catch {}
  const open = JSON.parse(gh('issue', 'list', '--label', 'ci-failure', '--label', label, '--state', 'open', '--json', 'number', '--limit', '1') || '[]')[0];
  if (s.ok) {
    if (open) { gh('issue', 'comment', String(open.number), '--body', `✓ passing at ${short(sha)} (${s.checks.length} checks): ${runUrl}${FOOT}`); gh('issue', 'close', String(open.number), '--reason', 'completed'); }
    continue; // a pass wakes nobody
  }
  const files = green && green !== sha ? git('diff', '--name-only', green, sha).split('\n').filter(Boolean) : [];
  const body = [
    `### What`, s.stopped ? `The ${s.suite} suite stopped early (an exception) at ${short(sha)}.` : `${s.failed.length} check${s.failed.length === 1 ? '' : 's'} failed in the ${s.suite} suite at ${short(sha)}:`, '',
    ...s.failed.map(f => '- ' + f), '',
    `### Window`, green ? `last green ${short(green)} .. red ${short(sha)}${files.length ? `; ${files.length} file${files.length === 1 ? '' : 's'} changed:` : ''}` : 'no earlier green run on record', '',
    ...files.slice(0, 40).map(f => '- `' + f + '`'), '',
    `### Where`, runUrl, '',
    '<details><summary>log tail</summary>', '', '```', s.tail.slice(-6000), '```', '</details>',
  ].join('\n') + FOOT;
  if (open) gh('issue', 'comment', String(open.number), '--body', body);
  else gh('issue', 'create', '--title', `CI: ${s.suite} suite ${s.stopped ? 'stopped' : 'failing'} at ${short(sha)}`, '--label', `concern,kind:ci,ci-failure,${label}`, '--body', body);
}
