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
await page.waitForFunction(() => [...document.querySelectorAll('#vmdiag .vrow')].every(r => r.dataset.ok === 'true'), null, { timeout: 300000 });
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
// ---- the package shelf: packages fetched from the page's own site, installed offline ----
const shelf = await run('wh-install tmux && tmux -V; wh-install nope; echo rc=$?');
check('shelf: tmux installs from the page\'s own site and runs', /tmux 3\.4/.test(shelf), JSON.stringify(shelf.slice(0, 300)));
check('shelf: an unknown package says what the shelf has', /nope is not on the shelf; it has: tmux/.test(shelf) && /rc=1/.test(shelf));

// ---- sessions as unix users: own home (700), quota, isolation, jobs at once, a second tab ----
const who = await run('id -un; echo HOME=$HOME; ls -ld ~ | cut -c1-10; touch ~/mine && echo touched');
const userA = /^(u[a-z0-9]+)$/m.exec(who)?.[1];
check('users: a session runs as its own user in its own home (700)', !!userA && new RegExp(`HOME=/home/${userA}`).test(who) && /drwx--[-sS]---/.test(who) && /touched/.test(who), JSON.stringify(who.slice(0, 300)));
await page.click('[data-act=new]');
const other = await run(`id -un; ls /home/${userA} 2>&1 | head -1; cat /home/${userA}/mine 2>&1 | head -1`);
check('users: another session is another user and cannot read the first one\'s home', !new RegExp(`^${userA}$`, 'm').test(other) && /Permission denied/.test(other), JSON.stringify(other.slice(0, 300)));
const par = await page.evaluate(async () => { const v = whDebug.vm(), t0 = Date.now(); const slow = v.run('sleep 6; echo slow-done', 60, { user: 'upar1', quiet: true }).then(r => ({ r, ms: Date.now() - t0 })); const fast = await v.run('echo fast-done', 60, { user: 'upar2', quiet: true }); const fms = Date.now() - t0; const s = await slow; return { fast: fast.out, fms, slow: s.r.out, sms: s.ms }; });
check('jobs: two commands run at once (a short one is not held behind a long one)', /fast-done/.test(par.fast) && /slow-done/.test(par.slow) && par.fms < par.sms - 2000, JSON.stringify(par));
const quota = await page.evaluate(async () => { const v = whDebug.vm(); const a = await v.run('dd if=/dev/zero of=~/big bs=1M count=3 2>&1 | tail -1; ls -l ~/big | cut -d" " -f5-6', 60, { user: 'uquota', quotaMB: 1, quiet: true }); await v.run('head -c 2000000 /dev/zero > /home/uquota/fill', 60, { quiet: true }); const b = await v.run('echo should-not-run', 60, { user: 'uquota', quotaMB: 1, quiet: true }); return { a: a.out, b: b.out, code: b.code }; });
check('quota: a file over the quota is cut off, and an over-quota home refuses new commands', /File size limit exceeded|1048576/.test(quota.a) && /quota: \/home\/uquota is over 1 MB/.test(quota.b) && quota.code === 122 && !/should-not-run/.test(quota.b), JSON.stringify(quota));
const page2 = await ctx.newPage();
await page2.goto(url);
await page2.waitForFunction(() => window.whDebug, null, { timeout: 30000 });
const t2 = await page2.evaluate(async () => { const v = whDebug.vm(); await v.connect(); const r = await v.run('echo from-the-second-tab; id -un', 60, { user: 'utab2' }); return { role: v.role(), out: r.out, host: v.host()?.tab }; });
check('tabs: a second tab uses the first tab\'s machine (no second boot)', t2.role === 'client' && /from-the-second-tab/.test(t2.out) && /utab2/.test(t2.out), JSON.stringify(t2));
await page.waitForFunction(() => /from-the-second-tab/.test(document.querySelector('#machine .vmout').textContent), null, { timeout: 30000 });
check('tabs: the second tab\'s command shows in the machine\'s terminal', true);
await page2.close();
// ---- the person's commands: hooks in, history, send again, scratch helper; secrets masked out ----
await page.click('[data-pane=machine]');
await page.fill('#machine .vmin', 'Echo “typed-$((2+3))”');
await page.press('#machine .vmin', 'Enter');
await page.waitForFunction(() => /^typed-5$/m.test(document.querySelector('#machine .vmout').innerText), null, { timeout: 60000 });
check('input hooks: a phone keyboard\'s capital and curly quote are undone before it is sent', /\$ echo "typed-\$\(\(2\+3\)\)"/.test(await page.textContent('#machine .vmout')) && /your input changed by: (smartquotes, autocap|autocap, smartquotes)/.test(await page.textContent('#machine .vmacts')));
check('send again: the bar offers the last command you typed', /↻ echo "typed-/.test(await slotOf('#machine .vmlast')));
await page.click('#machine .vmlast');
await page.waitForFunction(() => (document.querySelector('#machine .vmout').innerText.match(/^typed-5$/gm) || []).length >= 2, null, { timeout: 60000 });
check('send again: it runs the typed command once more', true);
await page.fill('#machine .vmin', "echo 'left-open");
await page.press('#machine .vmin', 'Enter');
await page.waitForFunction(() => /unexpected EOF|unterminated|matching/.test(document.querySelector('#machine .vmout').innerText), null, { timeout: 60000 });
const after = await page.evaluate(async () => (await whDebug.vm().run('echo console-still-free', 60, { quiet: true })).out);
check('terminal: what you type runs as its own job, so an open quote cannot stall the console', /console-still-free/.test(after), JSON.stringify(after));
await page.click('#machine [data-cmd=hist]');
check('history: what you typed is listed, with send / pin / forget', await page.locator('#machine .vmhist .hrow').count() >= 1 && /echo "typed-/.test(await page.textContent('#machine .vmhist')));
await page.click('#machine .vmhist .hrow [data-cmd=load]');
check('history: a row loads into the input for editing', /echo "typed-/.test(await page.inputValue('#machine .vmin')));
await page.fill('#machine .vmin', '');
check('input: no auto-capitalise or auto-correct on phones', await page.getAttribute('#machine .vmin', 'autocapitalize') === 'off' && await page.getAttribute('#machine .vmin', 'autocorrect') === 'off');
await page.click('#machine [data-cmd=scratch]');
await page.fill('#machine .vmscratch textarea', 'list my home');
await page.click('#machine .vmscratch button.primary');
await page.waitForSelector('#machine .scratchcmd', { timeout: 120000 });
const tried = await page.textContent('#machine .scratchtry pre');
check('scratch: the helper tests in the scratch account first, then gives commands with a why', /scratch-test-42/.test(tried) && /uscratch/.test(tried) && await page.locator('#machine .scratchcmd').count() === 2 && /list the home folder/.test(await page.textContent('#machine .scratchcmd')), JSON.stringify(tried));
await page.click('#machine .scratchcmd:nth-of-type(2) [data-cmd=send]');
await page.waitForFunction(() => /drafted-42/.test(document.querySelector('#machine .vmout').textContent), null, { timeout: 60000 });
check('scratch: a drafted command is sent to the terminal in view', true);
await page.click('[data-pane=insp]');
const masked = await run('echo github_pat_VMTEST_$(printf "y%.0s" $(seq 24))');
check('down hooks: a known secret printed by a command reaches the model masked', /\[key\]/.test(masked) && !masked.includes(TOKEN), JSON.stringify(masked.slice(0, 200)));
// machineGh env: the conventional way, GH_TOKEN for the session's user
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ settings: { machineGh: 'env' } }));
await page.click('.modal .primary');
seen.length = 0;
const envRun = await run('[ "$GH_TOKEN" != wh-placeholder-token ] && [ -n "$GH_TOKEN" ] && echo real-token-set; ls -l ~/.wh/gh | cut -c1-10; gh api /repos/o/r --jq .full_name');
check('machineGh env: the session\'s user has the real GH_TOKEN (600 file) and gh uses it', /real-token-set/.test(envRun) && /-rw-------/.test(envRun) && /^o\/r$/m.test(envRun) && seen.some(x => x.auth.includes(TOKEN)), JSON.stringify(envRun.slice(0, 300)));
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ settings: { machineGh: 'inject' } }));
await page.click('.modal .primary');
const back = await run('ls ~/.wh/gh 2>&1; echo GH=$GH_TOKEN');
check('machineGh inject: switching back takes the token out of the machine', /No such file/.test(back) && /GH=wh-placeholder-token/.test(back), JSON.stringify(back.slice(0, 200)));

// the rest of this suite checks paths under /root: run as root from here on
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ settings: { machineUser: 'root' } }));
await page.click('.modal .primary');

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

// ---- agent pty: the model's commands in a tmux session the person can watch and type into ----
await page.click('[data-pane=machine]');
await page.click('#machine .vmtab:has-text("agent pty")');
await page.check('#vmtmux');
await page.click('[data-pane=insp]');
const inTmux = await run('echo in-tmux-$((6*7)); tty; [ -n "$TMUX" ] && echo has-tmux-env');
check('agent pty: the model\'s command runs in tmux on a pty, its output comes back', /in-tmux-42/.test(inTmux) && /\/dev\/pts\//.test(inTmux) && /has-tmux-env/.test(inTmux) && /\[exit 0\]/.test(inTmux), JSON.stringify(inTmux.slice(0, 300)));
await page.click('[data-pane=machine]');
await page.click('#machine .vmtab:has-text("agent pty")');
await page.waitForFunction(() => /in-tmux-42/.test(document.querySelector('#machine .vmpty').textContent), null, { timeout: 60000 });
check('agent pty: the tab mirrors the pane', true);
await page.fill('#machine .vmpty + .vmin', 'echo typed-into-pty');
await page.press('#machine .vmpty + .vmin', 'Enter');
await page.waitForFunction(() => /typed-into-pty\n.*typed-into-pty|typed-into-pty[^]*typed-into-pty/.test(document.querySelector('#machine .vmpty').textContent), null, { timeout: 60000 });
check('agent pty: typing into it reaches the same session', true);
await page.click('[data-pane=insp]');

const code = await run('false');
check('shell: exit status is reported', /\[exit 1\]/.test(code));
check('machine pane shows the guest output', /gh version/.test(await page.textContent('#machine .vmout')));
const termText = await page.evaluate(() => document.querySelector('#machine .vmout').innerText);
const actText = await page.evaluate(() => document.querySelector('#machine .vmacts').innerText);
if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, termText);
check('terminal: only input and output, in order; the model\'s commands shown as input', /\$ s=sleep; \$s 30; echo after=\$\?/.test(termText) && /sleep: refused: a fixed wait of 30s/.test(termText) && /after=1/.test(termText) && termText.indexOf('$ s=sleep') < termText.indexOf('after=1'), termText.slice(-500));
check('terminal: no harness events, markers, base64 reads or listings in it', !/harness|__WH_|size=\d+|regular file\t/.test(termText));
check('harness activity: its own list, with each harness command and the policy refusal', /machine ready/.test(actText) && /read \/root\/proj\/a\.txt\s*\d+ ms · \d+ chars/.test(actText) && /policy bounded-waits: refused sleep 30/.test(actText), actText.slice(-400));
check('terminal: commands typed by you are shown as input', /\$ echo old > \/root\/old\.txt/.test(termText));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
