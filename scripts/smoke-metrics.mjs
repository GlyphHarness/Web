// Metrics panel smoke test (Playwright). Spec: docs/METRICS-PANEL.md.
// Usage: python -m http.server <port>   then   node scripts/smoke-metrics.mjs http://localhost:<port>/ [--out DIR] [--headed]
// Seeds two invented sessions (scripts/fixtures/metrics-sessions.json) into localStorage, then checks the panel in a real browser.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const headed = args.includes('--headed') && args.splice(args.indexOf('--headed'), 1);
const out = flag('out', 'metrics-out');
const base = (args[0] || 'http://localhost:8800/').replace(/\/?$/, '/');
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/metrics-sessions.json', import.meta.url), 'utf8'));
fs.mkdirSync(out, { recursive: true });

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const eq = (a, b, msg) => { const same = JSON.stringify(a) === JSON.stringify(b); ok(same, same ? msg : `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };

// WH_CHROME=1 drives the installed Google Chrome instead of Playwright's bundled Chromium (same switch as scripts/wh.mjs)
const browser = await chromium.launch({ headless: !headed, ...(process.env.WH_CHROME ? { channel: 'chrome' } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

// seed once, before the app's own scripts run; reloads must not overwrite what the page has since saved
await ctx.addInitScript(({ fx }) => {
  try {
    if (localStorage.getItem('seeded-by-test')) return;
    localStorage.setItem('seeded-by-test', '1');
    localStorage.setItem('wh:meta', JSON.stringify({ schema: 1, order: fx.sessions.map(s => s.id), active: fx.sessions[0].id, pads: [], settings: { provider: 'mock', model: 'mock-1' } }));
    for (const s of fx.sessions) localStorage.setItem('wh:s:' + s.id, JSON.stringify(s));
    localStorage.setItem('wh:ckpt', JSON.stringify(fx.ckpt));
  } catch {}
}, { fx });

const text = sel => page.evaluate(s => document.querySelector(s)?.textContent || '', sel);
const count = sel => page.locator(sel).count();
const widgets = slot => page.evaluate(s => [...document.querySelectorAll(`[data-slot="${s}"] > [data-w]`)].map(e => e.dataset.w), slot);
const openDash = async () => { if (await page.locator('#wmp-dash[hidden]').count()) await page.click('#wmp-open'); await page.waitForSelector('#wmp-dash:not([hidden])'); };
const openEditor = async () => { await openDash(); if (await page.locator('.wmp-edit[hidden]').count()) await page.click('#wmp-layout'); await page.waitForSelector('.wmp-edit:not([hidden]) fieldset[data-slot]'); };
const boot = async () => { await page.goto(base); await page.waitForSelector('#app #composer', { state: 'attached' }); await page.waitForSelector('#wmp-open'); };

await boot();
ok((await count('#wmp-open')) === 1, 'metrics button is in the top bar');
eq(await widgets('header-right'), ['cost-chip', 'cache-chip'], 'default header chips');
ok(/\$0\.04/.test(await text('#wmp-header')), 'header chip shows session A cost ($0.04): ' + (await text('#wmp-header')));
await page.screenshot({ path: path.join(out, '1-header.png') });

// dashboard, session A
await openDash();
const BUILT_IN = ['cost', 'tokens', 'cache-curve', 'prompt-curve', 'tool-calls', 'repeats-flags', 'checkpoints', 'requests', 'strategy-model', 'sessions'];
eq(await widgets('dashboard-grid'), BUILT_IN, 'default dashboard widgets, in order');
for (const w of BUILT_IN) ok((await page.locator(`#wmp-dash [data-w="${w}"]`).innerText()).trim().length > 10, `widget ${w} has content`);
eq(await count('#wmp-dash [data-w="requests"] tbody tr'), 7, 'session A: request list has 7 rows (5 main, 2 helper)');
ok(/squeeze/.test(await text('#wmp-dash [data-w="requests"]')), 'request list names the helper kind');
const sm = await text('#wmp-dash [data-w="strategy-model"]');
ok(/strat-stem-2\.0/.test(sm) && /strat-serial-1\.0/.test(sm), 'strategy summary lists both strategies');
ok(/repo_read/.test(await text('#wmp-dash [data-w="tool-calls"]')), 'tool calls list tool names');
ok(/system|tail|stem/.test(await text('#wmp-dash [data-w="checkpoints"]')), 'checkpoints widget lists kinds');
ok((await count('#wmp-dash [data-w="cache-curve"] svg polyline, #wmp-dash [data-w="cache-curve"] svg path')) > 0, 'cache curve is drawn as SVG');
await page.screenshot({ path: path.join(out, '2-dashboard-A.png') });

// content never reaches a widget (the transcript itself may show message text; only the panel and its slots are checked)
const panelHtml = await page.evaluate(() => [...document.querySelectorAll('#wmp-dash, #wmp-header, .wmp-side')].map(e => e.innerHTML).join('\n'));
ok(panelHtml.length > 500 && !panelHtml.includes(fx.sentinel), 'no message content in the panel DOM');

// session B
await page.click('#wmp-close');
await page.click('#sessions [data-id="sfixB"]');
await page.waitForFunction(() => /\$0\.0668/.test(document.querySelector('#wmp-header')?.textContent || ''));
ok(true, 'header follows the active session (B: $0.0668)');
await openDash();
await page.waitForFunction(() => document.querySelectorAll('#wmp-dash [data-w="requests"] tbody tr').length === 3);
eq(await count('#wmp-dash [data-w="requests"] tbody tr'), 3, 'session B: request list has 3 rows');
ok(/serial/.test(await text('#wmp-dash [data-w="requests"]')), 'session B request list names its strategy');
await page.screenshot({ path: path.join(out, '3-dashboard-B.png') });

// layout editor: add tokens to the left column, hide a chip, move a widget
await openEditor();
await page.selectOption('select[data-wmp-pick="side-bottom"]', 'tokens');
await page.waitForSelector('.wmp-edit fieldset[data-slot="side-bottom"] [data-id="tokens"]');
await page.click('.wmp-edit fieldset[data-slot="header-right"] [data-id="cache-chip"] [data-wmp="hide"]');
await page.waitForFunction(() => !document.querySelector('#wmp-header [data-w="cache-chip"]'));
await page.click('.wmp-edit fieldset[data-slot="dashboard-grid"] [data-id="tokens"] [data-wmp="down"]');
await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="dashboard-grid"] > [data-w]')].map(e => e.dataset.w).slice(0, 3).join() === 'cost,cache-curve,tokens');
eq(await widgets('side-bottom'), ['tokens'], 'tokens now draws in the left column');
eq(await widgets('header-right'), ['cost-chip'], 'hidden chip is gone from the top bar');
eq((await widgets('dashboard-grid')).slice(0, 3), ['cost', 'cache-curve', 'tokens'], 'down moved tokens one place in the dashboard');
const stored = await page.evaluate(() => localStorage.getItem('wh:metrics-layout'));
ok(!!stored && JSON.parse(stored).slots['side-bottom'][0].id === 'tokens', 'layout saved under wh:metrics-layout');
await page.screenshot({ path: path.join(out, '4-edited.png') });

// survives a reload
await boot();
eq(await widgets('side-bottom'), ['tokens'], 'after reload: side-bottom kept');
eq(await widgets('header-right'), ['cost-chip'], 'after reload: hidden chip still hidden');
await page.screenshot({ path: path.join(out, '5-reloaded.png') });

// custom widget, registered from the page (the same module the app uses)
await page.evaluate(async () => {
  const p = await import('./app/panels.js');
  p.register({ id: 'helper-requests', title: 'Helper requests', size: 's', render(s, all, { h }) { return h('span', { text: s ? `helper ${s.requests.helper}/${s.requests.main + s.requests.helper}` : 'no session' }); } });
  p.add('header-right', 'helper-requests');
});
await page.waitForFunction(() => /helper 0\/3/.test(document.querySelector('#wmp-header')?.textContent || ''));
ok(true, 'custom widget renders in the top bar for session B (helper 0/3)');
await page.evaluate(() => { whPanels.register({ id: 'boom', title: 'Boom', size: 's', render() { throw new Error('nope'); } }); whPanels.add('header-right', 'boom'); });
await page.waitForFunction(() => document.querySelector('#wmp-header [data-w="boom"]'));
ok(/\$0\.0668/.test(await text('#wmp-header')), 'a widget that throws does not stop the others');

// import: refused, then accepted
await openEditor();
await page.fill('.wmp-edit textarea', '{"slots":{"nowhere":[{"id":"cost"}]}}');
await page.click('[data-wmp="import"]');
ok(/Refused/.test(await text('.wmp-edit .st')), 'import of an unknown slot is refused with a reason: ' + (await text('.wmp-edit .st')));
await page.fill('.wmp-edit textarea', JSON.stringify({ webharness: 'metrics-layout', v: 1, slots: { 'dashboard-grid': [{ id: 'requests' }, { id: 'cost' }], 'side-top': [{ id: 'cost-chip' }] } }));
await page.click('[data-wmp="import"]');
await page.waitForFunction(() => document.querySelector('[data-slot="side-top"] [data-w="cost-chip"]'));
eq(await widgets('dashboard-grid'), ['requests', 'cost'], 'imported layout applies to the dashboard');

// paste config carries the layout
await page.click('#wmp-close');
const cfg = { settings: { metricsLayout: { webharness: 'metrics-layout', v: 1, slots: { 'header-right': [{ id: 'cache-chip' }], 'dashboard-grid': [{ id: 'sessions' }] } } } };
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify(cfg));
await page.waitForTimeout(200);
ok(/metricsLayout/.test(await page.evaluate(() => document.querySelector('.modal')?.innerText || '')), 'paste config lists the layout change');
await page.click('.modal .primary');
await page.waitForFunction(() => document.querySelector('#wmp-header [data-w="cache-chip"]') && !document.querySelector('#wmp-header [data-w="cost-chip"]'));
ok(true, 'paste config applied the layout');

// reset
await openEditor();
await page.click('[data-wmp="reset"]');
await page.waitForFunction(() => document.querySelector('#wmp-header [data-w="cost-chip"]'));
eq(await widgets('header-right'), ['cost-chip', 'cache-chip'], 'reset restores the default header');
eq(await widgets('dashboard-grid'), BUILT_IN, 'reset restores the default dashboard');
ok(!(await page.evaluate(() => localStorage.getItem('wh:metrics-layout'))), 'reset clears the stored layout');

// damaged stored layout falls back to the default
await page.evaluate(() => localStorage.setItem('wh:metrics-layout', '{not json'));
await boot();
eq(await widgets('header-right'), ['cost-chip', 'cache-chip'], 'a damaged stored layout means the default');

// panels.js with no app: custom widget on a bare test page
const t = await ctx.newPage();
t.on('pageerror', e => errors.push('test page: ' + e));
await t.goto(base + 'scripts/fixtures/metrics-test.html');
await t.waitForFunction(() => globalThis.__done);
const bare = await t.evaluate(() => ({ err: document.getElementById('err').textContent, out: document.getElementById('out').innerText, ids: [...document.querySelectorAll('#out [data-w]')].map(e => e.dataset.w) }));
ok(!bare.err, 'bare test page: no error ' + bare.err);
ok(/helper 2\/7/.test(bare.out), 'bare test page: custom widget renders (helper 2/7)');
ok(bare.ids.includes('cost-chip') && bare.ids.includes('helper-requests'), 'bare test page: built-in and custom render together');
await t.screenshot({ path: path.join(out, '6-bare-page.png') });

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
