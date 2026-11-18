// The Linux machine, end to end in Chromium: isolation switch, image download,
// boot, the shell tool from a (mock) model turn, and gh api through the page's
// network with the credential added outside the machine.
// Needs app/vm/image/ (scripts/vm-pack.mjs). Usage: python3 -m http.server 8787, then node scripts/smoke-vm.mjs [url]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:8787/';
// live values are slots (styles.js): read them with their data-v values
const slotOf = sel => page.evaluate(async s => (await import('./app/styles.js')).slotText(document.querySelector(s)), sel);
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const TOKEN = 'github_pat_VMTEST_' + 'y'.repeat(24);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [], seen = [];
page.on('pageerror', e => errors.push(String(e)));
await ctx.route('https://api.github.com/**', async route => {
  const r = route.request();
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*, authorization', 'access-control-allow-methods': 'GET, POST' } });
  seen.push({ url: r.url(), auth: r.headers().authorization || '' });
  route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ full_name: 'o/r', private: true, permissions: { push: true } }) });
});

await page.goto(url);
await page.evaluate(t => { localStorage.setItem('wh:keys', JSON.stringify({ github: t })); localStorage.setItem('wh:vm', '1'); }, TOKEN);
await page.reload();
await page.waitForFunction(() => window.crossOriginIsolated === true, null, { timeout: 30000 }).catch(() => {});
check('isolation: the service worker makes the page cross-origin isolated', await page.evaluate(() => crossOriginIsolated));
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1'); await page.dispatchEvent('#model', 'change');
await page.click('[data-act=new]');
check('new sessions get the shell tool while the machine is on', await page.isChecked('#vmtools'));

const t0 = Date.now();
const run = async cmd => {
  await page.fill('#input', 'shell: ' + cmd);
  await page.click('#send');
  await page.waitForSelector('#app[data-busy]', { state: 'attached' });
  await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 900000 });
  return page.locator('.thread:visible .msg[data-role=tool] pre').last().textContent();
};
const first = await run('uname -sm; cat /etc/alpine-release; python3 -c "print(6*7)"; gh --version | head -1; git --version');
console.log(`  boot + first command: ${Math.round((Date.now() - t0) / 1000)} s`);
check('shell: boots and runs bash, python3, gh, git', /Linux/.test(first) && /^42$/m.test(first) && /gh version/.test(first) && /git version/.test(first) && /\[exit 0\]/.test(first), JSON.stringify(first.slice(0, 400)));
const env = await run('env | grep -i -E "token|gh_" | sed "s/=.*/=<set>/"; echo GH=$GH_TOKEN');
check('shell: the guest only has the placeholder token', /GH=wh-placeholder-token/.test(env) && !env.includes(TOKEN));
const t1 = Date.now();
const api = await run('gh api /repos/o/r --jq .full_name');
console.log(`  gh api: ${Math.round((Date.now() - t1) / 1000)} s`);
check('gh api: answered through the page network', /^o\/r$/m.test(api), JSON.stringify(api.slice(0, 400)));
check('gh api: the real credential was added outside the machine', seen.some(s => s.auth === 'Bearer ' + TOKEN), JSON.stringify(seen.map(s => s.auth.slice(0, 20))));
const evade = await run('s=sleep; $s 30; echo after=$?; sleep 1 && echo short-ok');
check('runtime policy: a long sleep is refused inside the machine, however it is spelled', /refused: a fixed wait of 30s/.test(evade) && /after=1/.test(evade) && /short-ok/.test(evade) && !/__WH_RUNTIME/.test(evade), JSON.stringify(evade));
const rt = await page.evaluate(() => JSON.parse(localStorage['wh:smells'] || '[]').filter(r => r.kind === 'policy-runtime'));
check('runtime policy: recorded as a smell under bounded-waits', rt.length === 1 && rt[0].policy === 'bounded-waits' && /sleep 30/.test(rt[0].detail));
const code = await run('false');
check('shell: exit status is reported', /\[exit 1\]/.test(code));
check('machine pane shows the guest output', /gh version/.test(await page.textContent('#machine pre.vmout')));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
