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
page.on('dialog', d => d.accept());
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
check('run_js executes in the worker', result === '42\n[console]\nhi', result);

await say('show me a widget');
const stage = () => page.locator('.stagebox:visible');
check('widget: card on the stage in a sandboxed iframe, chip in the thread', await stage().locator('.card iframe[sandbox="allow-scripts"]').count() === 1 && await visible().locator('.chip').count() === 1);

await say('show a form');
await stage().locator('.wform input[name=name]').fill('Ada');
await stage().locator('.wform button').click();
await page.waitForSelector('#app[data-busy]', { state: 'attached' });
await page.waitForSelector('#app:not([data-busy])', { state: 'attached' });
check('form: submit arrives as a widget_event turn', /widget_event slot="demo"[^]*"name":"Ada","n":3/.test(await visible().locator('.msg[data-role=user]').last().textContent()) && /Got the event/.test(await visible().locator('.msg[data-role=assistant]').last().textContent()));
await say('now a chart');
check('slot reuse: the chart replaces the form card', await stage().locator('.card').count() === 2 && await stage().locator('.card svg.wchart rect').count() === 4 && await stage().locator('.wform').count() === 0);

await say('make it big');
const big = await visible().locator('.msg[data-role=tool] pre').last().textContent();
const handle = /os:[a-z0-9]+/.exec(big)?.[0];
check('output store: long result is a short view with a handle', !!handle && /filter=ends/.test(big) && big.length < 1800, `${big.length} chars`);
await say('read ' + handle);
check('output store: output_read finds a line by handle', /400: line 399/.test(await visible().locator('.msg[data-role=tool] pre').last().textContent()));

const kept = await page.locator('#ledger td[data-hit]').evaluateAll(n => n.map(x => x.dataset.hit + ':' + x.textContent));
check('ledger: every follow-up request keeps the full prefix', kept.length >= 5 && kept.slice(1).every(k => k === 'full:100%'), kept.join(' '));
const cached = await page.locator('#ledger tbody tr td:nth-child(4)').allTextContents();
check('ledger: provider-reported cached tokens grow', Number(cached.at(-1)) > Number(cached[1]) && Number(cached[1]) > 0, cached.join(' '));

await say('long script');
const logged = await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); return JSON.parse(localStorage['wh:s:' + m.active]).messages.findLast(x => x.tool_calls).tool_calls[0].function.arguments; });
check('arguments: a long call is logged as {ref, name, want}', /^\{"ref":"os:[a-z0-9]+","name":"sum rows","want":"total"\}$/.test(logged), logged);
const filtered = await visible().locator('.msg[data-role=tool] pre').last().textContent();
check('results: want returns the matching line, not the bulk', /filter=keywords want="total"; 1 of 1/.test(filtered) && /total=4950/.test(filtered) && filtered.length < 300, filtered.replace(/\n/g, ' | '));
await page.click('[data-pane=insp]');
await page.fill('#helper', 'mock-1'); await page.dispatchEvent('#helper', 'change');
await say('long script again');
const helped = await visible().locator('.msg[data-role=tool] pre').last().textContent();
check('results: with a helper model the extract comes from it, with its own ledger row', /filter=helper want="total"\]\nmock-filtered: total/.test(helped) && await page.locator('#ledger td:text-is("helper")').count() === 1, helped.replace(/\n/g, ' | '));
await page.fill('#helper', ''); await page.dispatchEvent('#helper', 'change');

await say('store pattern');
const stored = /pt:[a-z0-9]+/.exec(await visible().locator('.msg[data-role=tool] pre').last().textContent())?.[0];
await say('run pattern ' + stored);
check('patterns: recipe stored, then run with slot values', !!stored && (await visible().locator('.msg[data-role=tool] pre').last().textContent()) === '42');
const rec = await page.evaluate(id => JSON.parse(localStorage['wh:patterns']).find(p => p.id === id), stored);
check('patterns: attribution is harness-written, unknown refs dropped, use counted', rec.by.session && rec.by.model === 'mock-1' && rec.refs.length === 0 && rec.uses === 1, JSON.stringify(rec.by));
const trailRows = await page.evaluate(() => JSON.parse(localStorage['wh:trail']));
check('trail: one row per tool call, recipe run attributed to its pattern', trailRows.some(r => r.tool === 'run_js' && r.via === stored) && trailRows.every(r => r.shape && r.session), `${trailRows.length} rows`);

await say('fan out please');
const folds = await visible().locator('.msg[data-role=tool] pre').last().textContent();
check('fan_out: three branches fold back, the dependent one received two folds', (folds.match(/<fold /g) || []).length === 3 && /concern="c"[^]*folds received: 2/.test(folds) && await page.locator('#sessions [data-parent]').count() === 3, folds.slice(0, 120));
check('fan_out: audit table comes from harness records', await visible().locator('.audit tr').count() === 4);
await page.click('[data-pane=insp]');
await visible().locator('.audit [data-goto]').nth(1).click();
check('branch: thread shows each message once', await visible().locator('.msg[data-role=user]').last().evaluate(n => n.parentElement.querySelectorAll('.msg').length === n.parentElement.querySelectorAll('.msg[data-role=user]').length * 0 + [...n.parentElement.children].length) && await visible().locator('.msg:has-text("<concern")').count() === 1);
check('branch: first request keeps the whole source prefix', (await page.locator('#ledger td[data-hit]').first().textContent()) === '100%' && Number(await page.locator('#ledger tbody tr td:nth-child(4)').first().textContent()) > 0);
await page.locator('#sessions > div:not([data-parent])').first().click();

await page.click('[data-pane=insp]');
await page.fill('#system', 'Changed system prompt.');
await page.dispatchEvent('#system', 'change');
await say('after the edit');
check('ledger: system prompt edit shows as a broken prefix', (await page.locator('#ledger td[data-hit]').last().getAttribute('data-hit')) === 'broken');

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
check('export: bundle has schema and messages, no key', file.kind === 'webharness.session' && file.schema === 1 && file.sessions[0].messages.length >= 8 && !JSON.stringify(file).includes('wh:keys'));

const before = await visible().locator('.msg').count();
const threads = await page.locator('.thread').count();
await page.click('[data-act=new]');
check('new session: old thread hidden by style rule, node kept', await visible().locator('.msg').count() === 0 && await page.locator('.thread').count() === threads + 1);
const rowsBefore = await page.locator('#sessions [data-id]').count();
await page.setInputFiles('#file', await dl.path());
await page.waitForFunction(n => document.querySelectorAll('#sessions [data-id]').length === n, rowsBefore + 4);
check('import: restored session shows the same messages', await visible().locator('.msg').count() === before, `${before}`);

await page.reload();
check('import: stored output came with the file', file.blobs && Object.keys(file.blobs).length >= 2);
check('reload: state restored from localStorage', await page.locator('#sessions [data-id]').count() === rowsBefore + 4 && await visible().locator('.msg').count() === before);

await page.click('[data-act=epoch]');
await page.waitForFunction(() => /epoch 2/.test(document.querySelector('#title').value), null, { timeout: 20000 });
await page.click('[data-act=new]');
await page.click('[data-pane=insp]');
await page.selectOption('#wire', 'notes');
await say('long script');
await say('and then');
const wire = JSON.parse(await page.locator('#req').textContent());
check('notes form: calls and results go out as text turns, roles alternate', !JSON.stringify(wire.messages).includes('tool_call') && wire.messages.every((m, i, a) => m.role !== 'tool' && m.role !== a[i - 1]?.role) && /\[called run_js "sum rows" os:[a-z0-9]+ want: total\]/.test(wire.messages[1].content) && /^\[result run_js "sum rows"\]\n\[os:[^]*total=4950/.test(wire.messages[2].content), JSON.stringify(wire.messages.map(m => m.role)));
check('notes form: prefix stays byte-stable', (await page.locator('#ledger td[data-hit]').allTextContents()).slice(1).every(t => t === '100%'));

await page.click('[data-act=new]');
await say('hello again');
check('patterns: a new session opens with the index', /<patterns [^]*\[recipe\] multiply two numbers #math \(slots: a, b\)/.test(await visible().locator('.msg[data-role=user]').first().textContent()));
await page.locator('#sessions > div', { hasText: 'epoch 2' }).click();
check('fold session: new epoch starts from the pocket, source kept', /<pocket from=[^]*## Settled/.test(await visible().locator('.msg').first().textContent()) && await visible().locator('.msg').count() === 1, await page.inputValue('#title'));

await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 99; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();
check('newer-schema data: build refuses to start', /schema 99/.test(await page.locator('#app pre').textContent()));
await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 1; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();

check('layout: the page itself does not scroll', await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && scrollY === 0));
if (shot) await page.screenshot({ path: shot });
check('no page errors', errors.filter(e => !/schema 99|ERR_TUNNEL|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
await browser.close();
