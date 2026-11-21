// claude-route slice 1 check: distro exists, tmux session `claude` exists, `claude --version` runs.
// Touches no credential file and does not sign in. Plain node on Windows.
//   node scripts/claude-route/check-wsl.mjs [DISTRO]   (default UbuntuBase, or $WH_CLAUDE_DISTRO)
import { spawnSync } from 'node:child_process';

const distro = process.argv[2] || process.env.WH_CLAUDE_DISTRO || 'UbuntuBase';
const user = process.env.WH_CLAUDE_USER || 'wh';
const session = process.env.WH_CLAUDE_SESSION || 'claude';
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`); if (!ok) failed++; };

const list = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'buffer' });
const names = Buffer.from(list.stdout || []).toString('utf16le').replace(/\0/g, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
check('distro exists', names.includes(distro), distro);

const inDistro = (args) => spawnSync('wsl.exe', ['-d', distro, '-u', user, '--', ...args], { encoding: 'utf8' });
if (names.includes(distro)) {
  const t = inDistro(['tmux', 'has-session', '-t', session]);
  check('tmux session exists', t.status === 0, session);
  const v = inDistro(['sh', '-c', 'PATH="$HOME/.npm-global/bin:$PATH" claude --version']);
  check('claude --version runs', v.status === 0, (v.stdout || v.stderr || '').trim());
}
if (!failed) console.log(`attach: wsl -d ${distro} -u ${user} -- tmux attach -t ${session}`);
process.exit(failed ? 1 : 0);
