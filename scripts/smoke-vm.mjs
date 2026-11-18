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
await page.click('[data-pane=machine]');
await page.waitForSelector('#vmdiag .vrow');
const diag = await page.evaluate(() => [...document.querySelectorAll('#vmdiag .vrow')].map(r => [r.querySelector('.slabel').textContent, r.dataset.ok, r.querySelector('.vdetail').textContent]));
check('machine pane: says what is on and what is not yet (before first use)', diag.slice(0, 4).every(r => r[1] === 'true') && diag[4][1] === 'false' && /not yet/.test(diag[4][2]), JSON.stringify(diag));
await page.click('#vmdiag button.primary');
await page.waitForFunction(() => document.querySelectorAll('#vmdiag .vrow[data-ok=true]').length === 5, null, { timeout: 300000 });
check('machine pane: "start now" boots it and every line turns to ready', true);
await page.click('[data-pane=insp]');

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
await page.fill('#input', 'handoffs please');
await page.click('#send');
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 60000 });
const cmdCard = page.locator('.thread:visible figure.handoff[data-kind=command]').last();
await cmdCard.locator('button', { hasText: 'run on the machine' }).click();
await page.waitForFunction(() => /\[exit \d+\]/.test([...document.querySelectorAll('figure.handoff[data-kind=command] .hout')].at(-1)?.textContent || ''), null, { timeout: 120000 });
check('handoff: a command block runs on the machine when you click it', /hello-from-command[^]*\[exit 0\]/.test(await cmdCard.locator('.hout').textContent()));
// ---- file explorer: a fresh session, a file made before it, then its own changes ----
await page.click('[data-act=new]');
await page.click('[data-pane=machine]');
await page.fill('#machine .vmin', 'echo old > /root/old.txt; echo keep > /root/gone.txt; echo typed-done');
await page.press('#machine .vmin', 'Enter');
await page.waitForFunction(() => /typed-done/.test(document.querySelector('#machine .vmout').textContent), null, { timeout: 60000 });
await page.click('#vmdiag [data-act=explore]');
await page.waitForSelector('#explorer .xnode[data-path="/root/old.txt"]', { timeout: 120000 });
check('explorer: the pinned folder is listed lazily, a file made before the session is "existing"', await page.evaluate(() => !document.querySelector('#explorer .xnode[data-path="/root/old.txt"] .xst')));
await page.click('#explorer .xclose');
await run('echo changed >> /root/old.txt; rm /root/gone.txt; mkdir -p /root/proj && echo hi-from-session > /root/proj/a.txt && echo iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg== | base64 -d > /root/proj/dot.png; echo made');
await page.click('[data-pane=machine]');
await page.click('#vmdiag [data-act=explore]');
await page.waitForSelector('#explorer .xnode[data-path="/root/proj"]', { timeout: 120000 });
const marks = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#explorer .xnode[data-path]')].map(n => [n.dataset.path, n.querySelector('.xst')?.dataset.st || 'existing'])));
check('explorer: entries are marked new / modified / existing against the session\'s start', marks['/root/proj'] === 'new' && marks['/root/old.txt'] === 'modified', JSON.stringify(marks));
await page.click('#explorer .xnode[data-path="/root/proj"]');
await page.waitForSelector('#explorer .xnode[data-path="/root/proj/a.txt"]', { timeout: 60000 });
await page.click('#explorer .xnode[data-path="/root/proj/a.txt"]');
await page.waitForSelector('#explorer .xlines li', { timeout: 60000 });
check('explorer: a text file opens in a tab with line numbers, on demand', /hi-from-session/.test(await page.textContent('#explorer .xlines')) && await page.locator('#explorer .xtab').count() === 1);
await page.click('#explorer .xnode[data-path="/root/proj/dot.png"]');
await page.waitForSelector('#explorer img.ximg', { timeout: 60000 });
check('explorer: an image renders; tabs stack', await page.evaluate(() => document.querySelector('#explorer img.ximg').naturalWidth === 1) && await page.locator('#explorer .xtab').count() === 2);
await page.selectOption('#explorer .xfilter', 'changed');
await page.waitForFunction(() => document.querySelector('#explorer .xnode[data-path="/root/proj/a.txt"]'), null, { timeout: 60000 });
check('explorer: "changed since this session started" lists only what the session touched', await page.evaluate(() => { const p = [...document.querySelectorAll('#explorer .xtree .xnode[data-path]')].map(n => n.dataset.path); return p.includes('/root/old.txt') && p.includes('/root/proj/a.txt') && !p.includes('/root/gone.txt'); }));
await page.selectOption('#explorer .xfilter', 'all');
await page.waitForSelector('#explorer .xnode[data-path="/root/proj"]', { timeout: 60000 });
await page.click('#explorer .xnode[data-path="/root/proj"]');
await page.click('#explorer .xtab');
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await page.click('#explorer [data-x=deleted]');
await page.waitForFunction(() => /Deleted since this session started \(1\)/.test(document.querySelector('#explorer .xview').textContent), null, { timeout: 60000 });
check('explorer: deleted files are found against the baseline', /\/root\/gone\.txt/.test(await page.textContent('#explorer .xview')));
await page.keyboard.press('Escape');
check('explorer: Escape closes it', !(await page.$('#explorer')));

const code = await run('false');
check('shell: exit status is reported', /\[exit 1\]/.test(code));
check('machine pane shows the guest output', /gh version/.test(await page.textContent('#machine .vmout')));
const termText = await page.textContent('#machine .vmout');
check('machine pane: harness commands are one note line each; no markers, base64 reads or listings shown', /· harness: read \/root\/proj\/a\.txt/.test(termText) && /· harness: machine ready/.test(termText) && !/__WH_/.test(termText) && !/size=\d+/.test(termText) && !/regular file\t/.test(termText), JSON.stringify({ read: /· harness: read \/root\/proj\/a\.txt/.test(termText), ready: /· harness: machine ready/.test(termText), wh: (termText.match(/.{0,40}__WH_.{0,40}/) || [''])[0], size: (termText.match(/.{0,30}size=\d+.{0,30}/) || [''])[0], stat: /regular file\t/.test(termText) }));
check('machine pane: commands typed by you are shown', /\$ echo old > \/root\/old\.txt/.test(termText));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
