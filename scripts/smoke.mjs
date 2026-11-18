// Smoke test against the offline mock provider.
// Usage: python3 -m http.server 8787 (repo root), then: node scripts/smoke.mjs [url] [screenshot.png]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:8787/';
const shot = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const say = async text => {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await page.waitForSelector('#app[data-busy]', { state: 'attached' });
  await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
};
const visible = () => page.locator('.thread:visible');

await page.goto(url);
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1');
await page.dispatchEvent('#model', 'change');
await page.fill('#system', 'You are a test assistant. '.repeat(40));
await page.dispatchEvent('#system', 'change');

await say('hello there');
check('plain reply streams and renders a code block', await visible().locator('.msg[data-role=assistant] figure.code').count() === 1);

await say('please use a tool');
const result = await visible().locator('.msg[data-role=tool] pre').first().textContent();
check('run_js executes in the worker', /"result":42/.test(result) && /"logs":\["hi"\]/.test(result), result);

await say('show me a widget');
check('widget renders in a sandboxed iframe', await visible().locator('.widget iframe[sandbox="allow-scripts"]').count() === 1);

const kept = await page.locator('#ledger td[data-hit]').evaluateAll(n => n.map(x => x.dataset.hit + ':' + x.textContent));
check('ledger: every follow-up request keeps the full prefix', kept.length >= 5 && kept.slice(1).every(k => k === 'full:100%'), kept.join(' '));
const cached = await page.locator('#ledger tbody tr td:nth-child(4)').allTextContents();
check('ledger: provider-reported cached tokens grow', Number(cached.at(-1)) > Number(cached[1]) && Number(cached[1]) > 0, cached.join(' '));

await page.fill('#system', 'Changed system prompt.');
await page.dispatchEvent('#system', 'change');
await say('after the edit');
check('ledger: system prompt edit shows as a broken prefix', (await page.locator('#ledger td[data-hit]').last().getAttribute('data-hit')) === 'broken');

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
check('export: bundle has schema and messages, no key', file.kind === 'webharness.session' && file.schema === 1 && file.sessions[0].messages.length >= 8 && !JSON.stringify(file).includes('wh:keys'));

const before = await visible().locator('.msg').count();
await page.click('[data-act=new]');
check('new session: old thread hidden by style rule, node kept', await visible().locator('.msg').count() === 0 && await page.locator('.thread').count() === 2);
await page.setInputFiles('#file', await dl.path());
await page.waitForFunction(n => document.querySelectorAll('#sessions [data-id]').length === n, 3);
check('import: restored session shows the same messages', await visible().locator('.msg').count() === before, `${before}`);

await page.reload();
check('reload: state restored from localStorage', await page.locator('#sessions [data-id]').count() === 3 && await visible().locator('.msg').count() === before);

await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 99; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();
check('newer-schema data: build refuses to start', /schema 99/.test(await page.locator('#app pre').textContent()));
await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 1; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();

if (shot) await page.screenshot({ path: shot });
check('no page errors', errors.filter(e => !/schema 99|ERR_TUNNEL|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
await browser.close();
