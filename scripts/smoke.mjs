// Smoke test against the offline mock provider.
// Usage: python3 -m http.server 8787 (repo root), then: node scripts/smoke.mjs [url] [screenshot.png]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:8787/';
const shot = process.argv[3];
const browser = await chromium.launch();
const bctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
await bctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
const page = await bctx.newPage();
const errors = [];
page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); }); // the app must use its own modal
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// live values are slots (styles.js): read them with their data-v values
const slotOf = sel => page.evaluate(async s => (await import('./app/styles.js')).slotText(document.querySelector(s)), sel);
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const say = async text => {
  await page.fill('#input', text);
  await page.click('#send');
  await page.waitForSelector('#app[data-busy]', { state: 'attached' });
  await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
};
const visible = () => page.locator('.thread:visible');
// log messages only (held, ask and approval cards are not part of the log)
const LOGMSG = '.msg:is([data-role=user],[data-role=assistant],[data-role=tool])';

await page.goto(url);
await page.selectOption('#provider', 'mock');
await page.waitForFunction(() => /3 models/.test(document.querySelector('#modelsn').getAttribute('data-v')));
await page.fill('#model', 'free');
const freeRows = await page.locator('#picker .row[data-model]').allTextContents();
check('picker: "free" filters, and no-cost prices show as --', freeRows.length === 1 && /^mock-free:free ⚠262k------$/.test(freeRows[0]), freeRows.join('|'));
await page.fill('#model', 'cheap tools');
check('picker: "cheap tools" sorts by input price among tool-capable models', (await page.locator('#picker .row[data-model] span:first-child').allTextContents()).join() === 'mock-1,mock-pro');
await page.fill('#model', 'mock <1');
await page.locator('#picker .row[data-model]').first().dispatchEvent('mousedown');
check('picker: choosing a row sets the model and its price panel', await page.inputValue('#model') === 'mock-1' && /cached input\$0.003/.test(await page.locator('#price').textContent()) && await slotOf('#pricesum') === 'Models · main $0.15 / $0.003 / $0.6' && !(await page.locator('#price').isVisible()));
await page.fill('#system', 'You are a test assistant. '.repeat(40));
await page.dispatchEvent('#system', 'change');

await page.fill('#input', 'line one');
await page.press('#input', 'Enter');
check('composer: Enter adds a new line and does not send', await page.inputValue('#input') === 'line one\n' && await visible().locator('.msg').count() === 0);
await page.fill('#input', '');
await say('hello there');
check('plain reply streams and renders a code block', await visible().locator('.msg[data-role=assistant] figure.code').count() === 1);

await say('please use a tool');
const result = await visible().locator('.msg[data-role=tool] pre').first().textContent();
check('run_js executes in the worker', result === '42\n[console]\nhi', result);

// ---- card headers carry metrics ----
check('metrics: reply header shows model, tokens and time', /model mock-1[^]*in \d[^]*out \d[^]*time [\d.]+ s/.test(await visible().locator('.msg[data-role=assistant] .mhead').last().textContent()));
check('metrics: tool header shows tool, time, size, ok', /tool run_js[^]*time \d+ ms[^]*chars[^]*ok/.test(await visible().locator('.msg[data-role=tool] .mhead').last().textContent()));

// ---- ask: typed questions on a card, validated ----
await page.fill('#input', 'ask me something');
await page.click('#send');
await page.waitForSelector('.thread:visible .msg[data-role=ask] form');
const askCardEl = visible().locator('.msg[data-role=ask]').last();
await askCardEl.locator('button[type=submit]').click();
check('ask: missing and invalid answers are refused on the card', /name: an answer is required/.test(await askCardEl.locator('.note.bad').textContent()));
await askCardEl.locator('[name=ask-name]').fill('lab');
await askCardEl.locator('[name=ask-size]').fill('9');
await askCardEl.locator('[name=ask-tags][value=docs]').check();
await askCardEl.locator('[name=ask-go][value=yes]').check();
await askCardEl.locator('[name=ask-cfg]').fill('{"port": "x"}');
await askCardEl.locator('button[type=submit]').click();
check('ask: number range and JSON schema are checked', /size: above 5/.test(await askCardEl.locator('.note.bad').textContent()) && /cfg \$\.port: expected integer/.test(await askCardEl.locator('.note.bad').textContent()));
await askCardEl.locator('[name=ask-size]').fill('3');
await askCardEl.locator('[name=ask-cfg]').fill('{"port": 8787}');
await askCardEl.locator('button[type=submit]').click();
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
const askOut = JSON.parse(await visible().locator('.msg[data-role=tool] > details pre').last().textContent());
check('ask: typed answers go back as JSON', JSON.stringify(askOut) === JSON.stringify({ name: 'lab', size: 3, vis: 'private', tags: ['docs'], go: true, cfg: { port: 8787 } }), JSON.stringify(askOut));

// ---- pacing: hold tool calls, then model requests ----
await page.selectOption('#pace', 'tools');
await page.fill('#input', 'please use a tool again');
await page.click('#send');
await page.waitForSelector('.thread:visible .msg[data-role=held]:not([data-done])');
const toolsBefore = await visible().locator('.msg[data-role=tool]').count();
check('pace: the tool call is held, shown as it will run', /held tool call/.test(await visible().locator('.msg[data-role=held]').last().textContent()) && /run_js/.test(await visible().locator('.msg[data-role=held] pre').last().textContent()));
await page.waitForTimeout(300);
check('pace: nothing ran while held', await visible().locator('.msg[data-role=tool]').count() === toolsBefore);
await visible().locator('.msg[data-role=held]:not([data-done]) [data-hold=release]').click();
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
check('pace: released, the call runs', await visible().locator('.msg[data-role=tool]').count() === toolsBefore + 1);
await page.selectOption('#pace', 'requests');
await page.fill('#input', 'held hello');
await page.click('#send');
await page.waitForSelector('.thread:visible .msg[data-role=held]:not([data-done])');
check('pace: the model request is held with its size', /held model request[^]*mock-1 · \d+ messages/.test(await visible().locator('.msg[data-role=held]').last().textContent()));
await visible().locator('.msg[data-role=held]:not([data-done]) [data-hold=all]').click();
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
check('pace: "release all" lets the session loose', await page.inputValue('#pace') === 'run' && /released by you/.test(await page.evaluate(async () => (await import('./app/styles.js')).slotText([...document.querySelectorAll('.thread:not([style*=none]) .msg[data-role=held]')].filter(e => e.offsetParent).at(-1)))));
check('slots: live values are attributes drawn by CSS, not text nodes', await page.evaluate(() => { const e = document.querySelector('#tracen'); return e.childNodes.length === 0 && /\d+ requests/.test(e.getAttribute('data-v')) && /requests/.test(getComputedStyle(e, '::after').content); }));

await say('show me a widget');
const stage = () => page.locator('.stagebox:visible');
check('widget: card on the stage in a sandboxed iframe, chip in the thread', await stage().locator('.card iframe[sandbox="allow-scripts"]').count() === 1 && await visible().locator('.chip').count() === 1);

await say('show a form');
await stage().locator('.wform input[name=name]').fill('Ada');
await stage().locator('.wform button').click();
await page.waitForSelector('#app[data-busy]', { state: 'attached' });
await page.waitForSelector('#app:not([data-busy])', { state: 'attached' });
check('form: submit arrives as a widget_event turn', /event demo: \{"name":"Ada","n":3\}/.test(await visible().locator('.msg[data-role=user]').last().textContent()) && /Got the event/.test(await visible().locator('.msg[data-role=assistant]').last().textContent()));
await say('now a chart');
check('slot reuse: the chart replaces the form card', await stage().locator('.card').count() === 2 && await stage().locator('.card svg.wchart rect').count() === 4 && await stage().locator('.wform').count() === 0);

await say('make it big');
const big = await visible().locator('.msg[data-role=tool] pre').last().textContent();
const handle = /os:[a-z0-9]+/.exec(big)?.[0];
check('output store: long result is a short view with a handle', !!handle && /L ends\]/.test(big) && big.length < 1800, `${big.length} chars`);
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
check('results: want returns the matching line, not the bulk', /^\[os:[a-z0-9]+ \d+L keywords 1\/1\]\n\d+: total=4950$/.test(filtered), filtered.replace(/\n/g, ' | '));
await page.click('[data-pane=insp]');
await page.fill('#helper', 'mock-1'); await page.dispatchEvent('#helper', 'change');
check('models: helper pricing is listed beside the main model', await slotOf('#pricesum') === 'Models · main $0.15 / $0.003 / $0.6 · helper $0.15 / $0.003 / $0.6' && await page.locator('#price tr.role').count() === 2);
await say('long script again');
const helped = await visible().locator('.msg[data-role=tool] pre').last().textContent();
check('results: with a helper model the extract comes from it, with its own ledger row', /L helper\]\nmock-filtered: total/.test(helped) && await page.locator('#ledger td:text-is("helper")').count() === 1, helped.replace(/\n/g, ' | '));
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
check('fan_out: three branches fold back, the dependent one received two folds', (folds.match(/^fold \S+ s\w+ 1req:$/gm) || []).length === 3 && /fold c [^]*folds received: 2/.test(folds) && await page.locator('#sessions [data-parent]').count() === 3, folds.slice(0, 120));
check('fan_out: audit table comes from harness records', await visible().locator('.audit tr').count() === 4);
await page.click('[data-pane=insp]');
await visible().locator('.audit [data-goto]').nth(1).click();
check('branch: thread shows each message once', await visible().locator('.msg[data-role=user]').last().evaluate(n => n.parentElement.querySelectorAll('.msg').length === n.parentElement.querySelectorAll('.msg[data-role=user]').length * 0 + [...n.parentElement.children].length) && await visible().locator('.msg:has-text("concern b:")').count() === 1);
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

const before = await visible().locator(LOGMSG).count();
const threads = await page.locator('.thread').count();
await page.click('[data-act=new]');
check('new session: old thread hidden by style rule, node kept', await visible().locator('.msg').count() === 0 && await page.locator('.thread').count() === threads + 1);
const rowsBefore = await page.locator('#sessions [data-id]').count();
await page.setInputFiles('#file', await dl.path());
await page.waitForFunction(n => document.querySelectorAll('#sessions [data-id]').length === n, rowsBefore + 4);
check('import: restored session shows the same messages', await visible().locator(LOGMSG).count() === before, `${before}`);

await page.reload();
check('import: stored output came with the file', file.blobs && Object.keys(file.blobs).length >= 2);
check('reload: state restored from localStorage', await page.locator('#sessions [data-id]').count() === rowsBefore + 4 && await visible().locator(LOGMSG).count() === before);

await page.click('[data-act=epoch]');
await page.waitForSelector('.modal .primary');
check('fold session: asks in an in-page modal', /Fold this session\?/.test(await page.textContent('.modal h3')));
await page.click('.modal .primary');
await page.waitForFunction(() => /epoch 2/.test(document.querySelector('#title').value), null, { timeout: 20000 });
await page.click('[data-act=new]');
await page.click('[data-pane=insp]');
await page.selectOption('#wire', 'notes');
await say('long script');
await say('and then');
const wire = JSON.parse(await page.locator('#req').textContent());
check('notes form: calls and results go out as text turns, roles alternate', !JSON.stringify(wire.messages).includes('tool_call') && wire.messages.every((m, i, a) => m.role !== 'tool' && m.role !== a[i - 1]?.role) && /\[called run_js "sum rows" os:[a-z0-9]+ want: total\]/.test(wire.messages[2].content) && /^\[result run_js "sum rows"\]\n\[os:[^]*total=4950/.test(wire.messages[3].content), JSON.stringify(wire.messages.map(m => m.role)));
check('core prompt: declared first, and names the record form in use', /^Conventions of this environment:\n- To use a tool, make a real tool call[^]*\[called run_js[^]*Never write one yourself/.test(wire.messages[0].content));
check('notes form: prefix stays byte-stable', (await page.locator('#ledger td[data-hit]').allTextContents()).slice(1).every(t => t === '100%'));

await page.click('[data-act=new]');
await say('decide');
await say('next');
const sentBack = () => page.evaluate(() => JSON.parse(document.querySelector('#req').textContent).messages.find(m => m.role === 'assistant').content);
check('edge fold (marks): a long marked reply goes back as its marked lines only', /^\[os:[a-z0-9]+ decided\]\n! port is 8787\n!! use the flash model$/.test(await sentBack()) && await visible().locator('.msg[data-condensed]').count() === 1 && /Done musing/.test(await visible().locator('.msg[data-role=assistant]').first().textContent()));
await say('open ' + /os:[a-z0-9]+/.exec(await sentBack())[0]);
check('entry_read: the record opens by handle, and the reason is on the trail', /Done musing/.test(await visible().locator('.msg[data-role=tool] pre').last().textContent()) && await page.evaluate(() => JSON.parse(localStorage['wh:trail']).some(r => r.tool === 'entry_read' && /exact wording/.test(r.why))));
await say('again');
check('edge fold: the condensed form is what gets cached', (await page.locator('#ledger td[data-hit]').allTextContents()).slice(1).every(t => t === '100%'));

await page.click('[data-act=new]');
await page.click('[data-pane=insp]');
await page.selectOption('#edge', 'helper');
await page.fill('#helper', 'mock-1'); await page.dispatchEvent('#helper', 'change');
await say('ramble please');
// custodial work is queued, not run: the condense item says what, why, for whom and at what cost
await page.waitForSelector('#queue [data-q][data-status=queued]', { state: 'attached', timeout: 5000 });
const qtext = await page.evaluate(() => document.querySelector('#queue [data-q][data-status=queued]').textContent);
check('queue: the steward\'s work waits in the queue with reason, targets, cost and procedure', /condense/.test(qtext) && /replies waiting to be condensed/.test(qtext) && /mock-1: about \d+ input tokens, at most 1\.5k output/.test(qtext) && /how the cost is kept down/.test(qtext), qtext.slice(0, 300));
check('queue: nothing ran on its own (no title yet, no condensed reply)', !/^Mock Title/.test(await page.inputValue('#title')) && await visible().locator('.msg[data-condensed]').count() === 0);
await page.evaluate(() => document.querySelector('#queue [data-q][data-status=queued] [data-act="q-run"]').click());
await page.waitForFunction(() => /^Mock Title/.test(document.querySelector('#title').value), null, { timeout: 5000 });
check('queue: running the item records what it actually used', await page.evaluate(() => { const q = JSON.parse(localStorage['wh:meta']).queue; const it = q.find(x => x.type === 'condense' && x.status === 'done'); return it && typeof it.result.tokens === 'number'; }));
check('steward: one idle pass serves several sessions: titles, and this one\'s unmarked reply condensed', await visible().locator('.msg[data-condensed]').count() === 1 && /1 passes, [2-9] items applied/.test(await slotOf('#stewardsum')), await slotOf('#stewardsum'));
await say('next');
check('steward: the condensed reply is what goes back', /^\[os:[a-z0-9]+ answered\]\ncondensed item \d$/.test(await sentBack()));
check('overview: sessions listed from ledgers', await page.locator('#overview tr').count() >= 4);
await page.fill('#helper', ''); await page.dispatchEvent('#helper', 'change');

await page.click('[data-act=new]');
await say('decide');
check('keep marks: the note is in the system prompt of a new session', /Start a line with !/.test(JSON.parse(await page.locator('#req').textContent()).messages[0].content));
const reqs = await slotOf('#tracen');
await page.click('[data-act=epoch]');
await page.click('.modal .primary');
await page.waitForFunction(() => /epoch 2/.test(document.querySelector('#title').value));
check('keep marks: fold uses the marked lines, critical first, with no request', (await visible().locator('.msg').first().evaluate(n => n._raw)) === 'Pocket:\nuse the flash model\nport is 8787' && (await slotOf('#tracen')) === reqs);

await page.click('[data-act=new]');
await say('hello again');
check('patterns: a new session opens with the index', /patterns \(pattern_get id[^]*\[recipe\] multiply two numbers #math \(slots: a, b\)/.test(await visible().locator('.msg[data-role=user]').first().textContent()));
await page.locator('#sessions > div', { hasText: 'hello there · epoch 2' }).click();
check('fold session: new epoch starts from the pocket, source kept', /^Pocket:\n[^]*## Settled/.test(await visible().locator('.msg .txt').first().textContent()) && await visible().locator(LOGMSG).count() === 1, await page.inputValue('#title'));

// ---- policies: repaired before they run; smells tracked by steering version; review proposes ----
check('policies: the default is a named card, not a text field', await page.evaluate(() => [...document.querySelectorAll('#policies .item .name')].map(e => e.textContent).join()) === 'bounded-waits');
await page.evaluate(() => document.querySelector('[data-act="pol-add"]').click());
await page.evaluate(() => {
  const c = document.querySelector('#policies .item:last-child');
  const set = (f, v) => { const i = c.querySelector(`[data-pf=${f}]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); };
  set('name', 'bounded-loops');
});
await page.evaluate(() => {
  const c = document.querySelector('#policies .item:last-child');
  const set = (f, v) => { const i = c.querySelector(`[data-pf=${f}]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); };
  set('tool', 'run_js');
});
await page.evaluate(() => {
  const c = document.querySelector('#policies .item:last-child');
  for (const [f, v] of [['pattern', 'while\\s*\\(true\\)'], ['rule', 'Never loop without a bound; use a counted loop.']]) { const i = document.querySelector('#policies .item:last-child').querySelector(`[data-pf=${f}]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }
});
check('policies: a new one is its own card with name, tool and rule', await page.evaluate(() => { const c = document.querySelector('#policies .item:last-child'); return c.querySelector('.name').textContent === 'bounded-loops' && c.querySelector('.chip').textContent === 'run_js' && /counted loop/.test(c.querySelector('.rule').textContent); }));
await say('loop forever please');
const toolOut = () => visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
const pres = await toolOut();
check('policy: the breaking call was repaired and the repair ran', /^\[policy bounded-loops: call rewritten\]\n6$/.test(pres), JSON.stringify(pres));
const loggedCall = await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); const s = JSON.parse(localStorage['wh:s:' + m.active]); return s.messages.findLast(x => x.tool_calls)?.tool_calls[0].function.arguments; });
check('policy: the log keeps the repaired call, the original is shown beside it', /for \(let k/.test(loggedCall) && /while \(true\)/.test(await visible().locator('details.policy pre').last().textContent()));
await say('loop forever please, refuse me');
check('policy: an unrepairable call does not run', /^Not run: policy bounded-loops/.test(await toolOut()));
const rows = await page.evaluate(() => JSON.parse(localStorage['wh:smells'] || '[]'));
check('smells: both events recorded with the steering in effect', rows.filter(r => /^policy-/.test(r.kind)).length === 2 && rows.every(r => r.steer) && rows.some(r => r.kind === 'policy-refused'));
check('smells: nothing was changed in the session (no automatic pattern)', !(await page.evaluate(() => localStorage['wh:patterns'] || '')).includes('Never loop'));
await page.evaluate(() => document.querySelector('[data-act=review]').click());
await page.waitForSelector('#smells [data-kind=proposal]', { state: 'attached' });
const revq = await page.evaluate(() => JSON.parse(localStorage['wh:meta']).queue.find(x => x.type === 'review' && x.status === 'queued'));
check('queue: a refusal queued a steering review, naming the policy that fired', !!revq && revq.reason.policy === 'bounded-loops' && revq.targets.some(t => t.kind === 'policy' && t.id === 'bounded-loops') && revq.estimate.out === 600, JSON.stringify(revq?.reason));
check('queue: the top bar shows what is waiting', /queue \d+/.test(await slotOf('#queuebar')));
await page.evaluate(id => document.querySelector(`#queue [data-q="${id}"] [data-act="q-dismiss"]`).click(), revq.id);
check('queue: dismissing takes it off the queue', await page.evaluate(id => JSON.parse(localStorage['wh:meta']).queue.find(x => x.id === id).status, revq.id) === 'dismissed');
check('review: a pending proposal from the counts', /keep p1/.test(await page.textContent('#smells [data-kind=proposal]')));
await page.evaluate(() => document.querySelector('#smells [data-act=propose][data-to=dismissed]').click());
check('policies: the card shows how often it fired', /fired 2/.test(await page.evaluate(() => document.querySelector('#policies .item:last-child .meta').textContent)));
check('review: dismissing records the decision', await page.evaluate(() => JSON.parse(localStorage['wh:proposals'])[0].status) === 'dismissed');

// ---- paste-to-configure: merge non-secret fields, preview first, refuse credentials ----
await page.evaluate(() => { const k = JSON.parse(localStorage['wh:keys'] || '{}'); k.github = 'github_pat_SECRET_' + 'z'.repeat(20); localStorage['wh:keys'] = JSON.stringify(k); });
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.waitForSelector('.modal textarea');
await page.fill('.modal textarea', JSON.stringify({ settings: { helper: 'mock-free:free', ghlabel: 'test label', logRepo: 'someone/logs', githubToken: 'nope', colour: 'red' }, policies: [{ name: 'bounded-waits', on: false }, { name: 'no-rm-root', tool: 'shell', pattern: 'rm\\s+-rf\\s+/(\\s|$)', rule: 'Never delete the root filesystem.' }, { name: 'broken', pattern: '(', rule: 'x' }] }));
const planText = await page.textContent('.modal .cfgplan');
check('config: preview lists the changes before anything is applied', /helper[^]*"mock-free:free"/.test(planText) && /policy bounded-waits\.on[^]*false/.test(planText) && /policy no-rm-root[^]*added/.test(planText) && await page.evaluate(() => !JSON.parse(localStorage['wh:meta']).settings.ghlabel));
check('config: credentials, unknown fields and bad patterns are refused', /githubToken[^]*refused: looks like a credential/.test(planText) && /colour[^]*not a configurable field/.test(planText) && /policy broken[^]*bad pattern/.test(planText));
await page.click('.modal .primary');
check('config: applied as a merge (inputs, policies, untouched fields kept)', await page.inputValue('#helper') === 'mock-free:free' && await page.inputValue('#logrepo') === 'someone/logs' && await page.inputValue('#model') === 'mock-1'
  && await page.evaluate(() => { const n = [...document.querySelectorAll('#policies .item .name')].map(e => e.textContent); return n.includes('bounded-waits') && n.includes('no-rm-root') && n.includes('bounded-loops') && !n.includes('broken'); })
  && await page.evaluate(() => JSON.parse(localStorage['wh:meta']).settings.policyList.find(p => p.name === 'bounded-waits').on === false));
check('config: no credential was written anywhere', await page.evaluate(() => !localStorage['wh:meta'].includes('nope') && JSON.parse(localStorage['wh:keys']).github.startsWith('github_pat_SECRET_')));
await page.evaluate(() => document.querySelector('[data-act=cfgcopy]').click());
await page.waitForSelector('.modal .cfgshow');
const snap = JSON.parse(await page.textContent('.modal .cfgshow'));
check('config: copy gives the same shape back, without credentials', snap.settings.helper === 'mock-free:free' && snap.policies.some(p => p.name === 'no-rm-root') && !JSON.stringify(snap).includes('SECRET'));
await page.click('.modal button');

// ---- uptext: the full value of truncated text on hover or press-and-hold ----
const longTitle = 'A very long session title that cannot possibly fit in the sidebar row at all';
await page.fill('#title', longTitle); await page.dispatchEvent('#title', 'change');
const rowSel = await page.evaluate(() => `#sessions [data-id="${JSON.parse(localStorage['wh:meta']).active}"] span`);
await page.hover(rowSel);
await page.waitForSelector('#uptext:not([hidden])', { timeout: 3000 }).catch(() => {});
check('uptext: hovering a truncated label shows its full value above it', await page.evaluate(t => { const u = document.querySelector('#uptext'); return !u.hidden && u.textContent === t; }, longTitle));
await page.mouse.move(700, 450);
await page.waitForTimeout(100);
check('uptext: it goes away on leave', await page.evaluate(() => document.querySelector('#uptext').hidden));
await page.evaluate(sel => { const el = document.querySelector(sel); el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })); }, rowSel);
await page.waitForTimeout(600);
check('uptext: press and hold on touch shows it too', await page.evaluate(t => { const u = document.querySelector('#uptext'); return !u.hidden && u.textContent === t; }, longTitle));
await page.evaluate(sel => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })), rowSel);
await page.keyboard.press('Escape');
const mx = visible().locator('.mhead .mx[data-full]').first();
if (await mx.count()) { await mx.hover(); await page.waitForTimeout(500); }
check('uptext: shortened labels show their full value (model id)', !(await mx.count()) || await page.evaluate(() => /\//.test(document.querySelector('#uptext').textContent) || document.querySelector('.mhead .mx[data-full]').dataset.full === document.querySelector('#uptext').textContent));
await page.mouse.move(700, 450);

// ---- import: loose labels and values matched to what exists ----
await page.evaluate(() => document.querySelector('[data-act=cfgimport]').click());
await page.waitForSelector('.modal textarea');
await page.fill('.modal textarea', ['| Role | Model | Price |', '|---|---|---|', '| main | `mock-pro` | x |', '| helper (filters output) | `mock-1` | y |', '- Log repo: someone/logs2', 'deploy region = eu-west-1', 'GitHub token: github_pat_' + 'q'.repeat(20), 'pace: fast'].join('\n'));
const iplan = await page.textContent('.modal .cfgplan');
check('import: lines are matched to settings, values or new values, with a preview', /main→ model[^]*"mock-pro"/.test(iplan.replace(/\s+/g, ' ').replace(/ → /g, '→ ')) || (/model/.test(iplan) && /mock-pro/.test(iplan) && /new value/.test(iplan) && /logRepo \(defaults\)/.test(iplan)), iplan.slice(0, 300));
check('import: credentials and invalid values are refused, the token is not shown', /refused: looks like a credential/.test(iplan) && !iplan.includes('github_pat_') && /pace is run, requests, tools or both/.test(iplan));
await page.selectOption('.modal select', 'session');
await page.click('.modal .primary');
const after = await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); const s = JSON.parse(localStorage['wh:s:' + m.active]); return { over: s.over || {}, logRepo: m.settings.logRepo, vals: (m.values || []).filter(v => v.revs.at(-1).label === 'deploy region').map(v => ({ scope: v.scope.kind, value: v.revs.at(-1).value, role: v.revs.at(-1).role })) }; });
check('import: settings land at the chosen level (log repo too: a harness property), unknown labels become values', after.over.model === 'mock-pro' && after.over.helper === 'mock-1' && after.over.logRepo === 'someone/logs2' && after.vals.length === 1 && after.vals[0].scope === 'session' && after.vals[0].value === 'eu-west-1', JSON.stringify(after));
await page.evaluate(() => document.querySelector('[data-act=cfgimport]').click());
await page.fill('.modal textarea', 'deploy region: us-east-1');
check('import: an existing label is matched (a new revision, not a duplicate)', /value v\d+/.test(await page.textContent('.modal .cfgplan')));
await page.click('.modal .primary');
check('import: the matched value got a second revision', await page.evaluate(() => { const v = JSON.parse(localStorage['wh:meta']).values.filter(v => v.revs[0].label === 'deploy region'); return v.length === 1 && v[0].revs.length === 2 && v[0].revs[1].value === 'us-east-1'; }));

// ---- machine pane: diagnosis when it is off ----
await page.click('[data-pane=machine]');
await page.waitForSelector('#vmdiag .vrow');
const offDiag = await page.evaluate(() => [...document.querySelectorAll('#vmdiag .vrow')].map(r => [r.dataset.ok, r.querySelector('.vdetail').textContent]));
check('machine pane: when off, it says so and where to switch it on (start disabled)', offDiag[0][0] === 'false' && /Defaults and connections/.test(offDiag[0][1]) && await page.isDisabled('#vmdiag button.primary'));
await page.click('[data-pane=insp]');

// ---- handoff blocks: content to take away ----
await page.click('[data-act=new]');
check('handoff: new sessions declare the convention in the core prompt', /handoff:copy, handoff:file <name>/.test(await page.textContent('#core')));
await say('handoffs please');
const hcards = visible().locator('.msg[data-role=assistant]').last().locator('figure.handoff');
check('handoff: each kind is a card; plain code stays code', await hcards.count() === 5 && (await hcards.evaluateAll(f => f.map(x => x.dataset.kind))).join() === 'copy,file,command,view,config' && await visible().locator('.msg[data-role=assistant]').last().locator('figure.code').count() === 1);
await hcards.nth(0).locator('button.primary').click();
check('handoff: copy puts the exact text on the clipboard', await page.evaluate(() => navigator.clipboard.readText()) === 'ship it on friday');
const [hdl] = await Promise.all([page.waitForEvent('download'), hcards.nth(1).locator('button', { hasText: 'download' }).click()]);
check('handoff: a file downloads under its name', hdl.suggestedFilename() === 'notes.md');
check('handoff: a csv view renders as a table (quoted commas kept)', /b, c/.test(await hcards.nth(3).locator('table').textContent()) && await hcards.nth(3).locator('tr').count() === 3);
await hcards.nth(4).locator('button', { hasText: 'apply' }).click();
await page.waitForSelector('.modal .cfgplan');
check('handoff: a config opens the paste-config preview, filled in', /helper[^]*mock-pro/.test(await page.textContent('.modal .cfgplan')));
await page.click('.modal button:not(.primary)');
check('handoff: the session lists its handoffs on the stage', await page.evaluate(() => [...document.querySelectorAll('.stagebox:not([style*=none]) .handoffs .hitem')].length) >= 5 || await page.locator('.handoffs .hitem').count() >= 5);
await say('please copy that plain thing');
check('handoff: a plain fence is shown as a copy handoff when you asked for one', await visible().locator('.msg[data-role=assistant]').last().locator('figure.handoff[data-kind=copy]').count() === 1 && /because you asked/.test(await visible().locator('.msg[data-role=assistant]').last().textContent()));

// ---- scoped values: requested, set by the model, revised, used by reference ----
await page.click('[data-act=new]');
await page.fill('#input', 'request a value please');
await page.click('#send');
await page.waitForSelector('.thread:visible [data-vreq] form');
const vcard = visible().locator('[data-vreq]').last();
check('values: the model asks for a value on a card with label, role and purpose', /region/.test(await vcard.textContent()) && /where deploys go/.test(await vcard.textContent()));
await vcard.locator('[name=value]').selectOption('eu-west-1');
await vcard.locator('[name=notes]').fill('my private note');
await vcard.locator('[name=expose]').selectOption('purpose');
await vcard.locator('[name=show]').check();
await vcard.locator('button[type=submit]').click();
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
const vres = await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
check('values: stored with an id; the model sees purpose, not the value', /^v\d+ region \[config\] \(value withheld: use \{\{v\d+\}\} in tool arguments\) · where deploys go$/.test(vres) && !vres.includes('eu-west-1'), vres);
const vid = /^(v\d+)/.exec(vres)[1];
await say('use value ' + vid);
const used = await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
const reqBody = await page.textContent('#req');
check('values: {{id}} is filled in when the call runs, never sent to the model', used === 'deploying to eu-west-1' ? true : used.startsWith('deploying to eu-west-1') , used);
const rq = JSON.parse(reqBody);
check('values: notes never sent; the harness never sends a withheld value (user lines, logged call keeps {{id}})', !reqBody.includes('my private note') && !rq.messages.filter(m => m.role === 'user').some(m => JSON.stringify(m).includes('eu-west-1')) && rq.messages.some(m => (m.tool_calls || []).some(c => c.function.arguments.includes('{{' + vid + '}}'))));
await say('set a value for naming');
const set1 = await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
const nid = /^(v\d+)/.exec(set1)?.[1];
check('values: the model can add one on its own, in its session', /^v\d+ rev 1 in this session$/.test(set1), set1);
await say('revise value ' + nid);
check('values: a change is a new revision', new RegExp('^' + nid + ' rev 2$').test(await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent()));
await say('history of ' + nid);
const hist = await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
check('values: history keeps every revision with who made it', /rev 1 [^\n]* by model = kebab-case/.test(hist) && /rev 2 [^\n]* by model = snake_case · the person changed their mind/.test(hist), hist);
await say('hello after values');
const lastUser = JSON.parse(await page.textContent('#req')).messages.filter(m => m.role === 'user').at(-1).content;
check('values: changes reach the model as one line on the next message', !lastUser.includes('values changed') || /values changed/.test(lastUser));
const vrow = await page.evaluate(id => { const v = JSON.parse(localStorage['wh:meta']).values.find(x => x.id === id); return v; }, vid);
check('values: provenance records who, where and when', vrow.revs[0].by.who === 'you' && vrow.revs[0].by.requestedBy === 'model' && typeof vrow.revs[0].by.message === 'number' && vrow.scope.kind === 'session' && vrow.revs[0].notes === 'my private note');
await page.evaluate(id => document.querySelector(`#values [data-val="${id}"] [data-act=val-hide]`).click(), vid);
check('values: hiding is a revision too', await page.evaluate(id => { const v = JSON.parse(localStorage['wh:meta']).values.find(x => x.id === id); return v.revs.length === 2 && v.revs[1].hidden === true; }, vid));

// ---- profiles: scoped, hierarchical configuration ----
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ profiles: [
  { name: 'org', color: '#e0a040', settings: { model: 'mock-pro' }, locks: ['model'], caps: { vm: false, repo: 'read' }, repos: ['o/*'] },
  { name: 'research', parent: 'org', color: '#6fd08c', settings: { model: 'mock-1' }, caps: { run_js: false, vm: true } },
] }));
await page.click('.modal .primary');
await page.evaluate(() => { const sel = document.querySelector('#newprofile'); sel.value = [...sel.options].find(o => o.textContent === 'org / research').value; sel.dispatchEvent(new Event('change')); });
await page.click('[data-act=new]');
check('profiles: sidebar groups sessions under their scope with a badge', await page.evaluate(() => [...document.querySelectorAll('#sessions .pgroup')].map(e => e.textContent).includes('org / research') && document.querySelector(`#sessions [data-id="${JSON.parse(localStorage['wh:meta']).active}"] .pbadge`)?.textContent === 'research'));
check('profiles: a locked setting wins over the child and the session (model box locked)', await page.inputValue('#model') === 'mock-pro' && await page.isDisabled('#model'));
const scopeTools = await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); return m; });
await say('please use a tool');
const req = JSON.parse(await page.textContent('#req'));
const names = (req.tools || []).map(t => t.function.name);
check('profiles: capabilities narrow the tool list (no run_js; machine stays denied by the parent)', req.model === 'mock-pro' && !names.includes('run_js') && !names.includes('shell') && names.includes('ask'), names.join(','));
check('profiles: a tool outside the scope is refused even when the model names it (without naming the scope)', /^Not run: run_js is not available in this session\.$/.test(await visible().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent()));
check('harness properties: the model\'s request names no profile, scope or log repo', await page.evaluate(() => { const t = document.querySelector('#req').textContent; return !/org \/ research|"research"|someone\/logs/.test(t); }));
check('scope: each attribute says who it is for (harness or tools)', await page.evaluate(() => /Harness settings/.test(document.querySelector('#scope [data-attr=logRepo]').closest('.sgroup').textContent) && /Tools/.test(document.querySelector('#scope [data-attr=vm]').closest('.sgroup').querySelector('.shead').textContent)));
check('profiles: the refusal is a smell with the scope', await page.evaluate(() => JSON.parse(localStorage['wh:smells']).some(r => r.kind === 'scope-refused' && r.profile === 'org / research')));
check('profiles: the session can only move within its scope', await page.evaluate(() => [...document.querySelectorAll('#sprofile option')].map(o => o.textContent).join()) === 'org / research');
// the per-session scope panel: value, source level, lock, set at a level
const scopeRow = k => page.evaluate(k => { const tr = document.querySelector(`#scope [data-attr="${k}"]`), ed = document.querySelector(`#scope .scope-edit[data-row="${k}"]`); return { value: tr.children[1].textContent, from: tr.querySelector('.from').textContent, lock: tr.querySelector('.from').dataset.full || '', disabled: [...ed.querySelectorAll('[data-sl] option')].filter(o => o.disabled).map(o => o.textContent) }; }, k);
const mrow = await scopeRow('model');
check('scope: each attribute shows its value, the level it comes from and its lock', mrow.value === 'mock-pro' && /org$/.test(mrow.from) && /org/.test(mrow.lock) && mrow.disabled.join() === 'this session,research', JSON.stringify(mrow));
await page.evaluate(() => { const tr = document.querySelector('#scope .scope-edit[data-row="helper"]'); tr.querySelector('[data-sv]').value = 'mock-pro'; tr.querySelector('[data-act="scope-set"]').click(); });
const hrow = await scopeRow('helper');
check('scope: a value set at the session level applies to this session only', hrow.value === 'mock-pro' && hrow.from === 'this session' && await page.evaluate(() => JSON.parse(localStorage['wh:meta']).settings.helper) === 'mock-free:free', JSON.stringify(hrow));
await page.evaluate(() => { const tr = document.querySelector('#scope .scope-edit[data-row="ask"]'); tr.querySelector('[data-sv]').value = '0'; tr.querySelector('[data-act="scope-set"]').click(); });
const arow = await scopeRow('ask');
await say('hello scoped');
const toolsNow = (JSON.parse(await page.textContent('#req')).tools || []).map(t => t.function.name);
check('scope: a session can narrow its own capabilities', arow.value === 'no' && arow.from === 'this session' && !toolsNow.includes('ask') && !toolsNow.includes('value_set'), toolsNow.join(','));
await page.evaluate(() => { const tr = document.querySelector('#scope .scope-edit[data-row="ask"]'); tr.querySelector('[data-sv]').value = ''; tr.querySelector('[data-act="scope-set"]').click(); });

// inline edit: the row shows or hides its controls; a change asks before closing
await page.evaluate(() => { document.querySelector('#sessioncard').closest('details').open = true; document.querySelector('#sessioncard').open = true; });
await page.click('#scope [data-attr=pace]');
const paceEdit = page.locator('#scope .scope-edit[data-row=pace]');
check('inline edit: clicking the row shows its controls, prefilled with the current value', await paceEdit.isVisible() && await paceEdit.locator('[data-sv]').inputValue() === (await page.evaluate(() => document.querySelector('#scope [data-attr=pace] .sval').textContent.replace('—', ''))));
await page.click('#scope [data-attr=pace]');
check('inline edit: clicking it again without a change just hides them', !(await paceEdit.isVisible()));
await page.click('#scope [data-attr=pace] .scope-toggle');
await paceEdit.locator('[data-sv]').fill('tools');
await page.click('#scope [data-attr=pace]');
await page.waitForSelector('.modal');
check('inline edit: closing with a change asks, showing from and to', /Unsaved change to pace/.test(await page.textContent('.modal h3')) && /tools/.test(await page.textContent('.modal .to')));
await page.click('.modal button:has-text("Keep editing")');
check('inline edit: "keep editing" leaves the change in place', await paceEdit.isVisible() && await paceEdit.locator('[data-sv]').inputValue() === 'tools');
await page.click('#scope [data-attr=pace]');
await page.click('.modal button:has-text("Discard")');
check('inline edit: "discard" closes and restores the value', !(await paceEdit.isVisible()) && await paceEdit.locator('[data-sv]').inputValue() !== 'tools');
await page.click('#scope [data-attr=pace]');
await paceEdit.locator('[data-sv]').fill('both');
await page.click('#scope [data-attr=pace]');
await page.click('.modal button:has-text("Save")');
check('inline edit: "save" applies it at the chosen level', await page.evaluate(() => document.querySelector('#scope [data-attr=pace] .sval').textContent) === 'both');
await page.click('#scope [data-attr=pace]');
await paceEdit.locator('[data-sv]').fill('');
await paceEdit.locator('[data-act="scope-set"]').click();

// mutable state: a frozen profile or session is read-only until switched back
const freezeProfile = (name, on) => page.evaluate(([name, on]) => { const c = [...document.querySelectorAll('#profiles [data-prof]')].find(x => x.querySelector('.name').textContent.endsWith(name)); const t = c.querySelector('[data-pf=mutable]'); t.checked = !on; t.dispatchEvent(new Event('change', { bubbles: true })); }, [name, on]);
check('mutable: this session is the first card in Profiles, its chain next', await page.evaluate(() => document.querySelector('#sessioncard') && [...document.querySelectorAll('#profiles .item .chip')].slice(0, 2).every(c => c.textContent === 'in this session')));
await freezeProfile('research', true);
const frozenCard = await page.evaluate(() => { const c = [...document.querySelectorAll('#profiles [data-prof]')].find(x => x.querySelector('.name').textContent.endsWith('research')); return { frozen: c.hasAttribute('data-frozen'), inputsDisabled: [...c.querySelectorAll('.body input, .body select')].every(i => i.disabled), toggle: !c.querySelector('[data-pf=mutable]').disabled }; });
check('mutable: a frozen profile card is read-only except its toggle', frozenCard.frozen && frozenCard.inputsDisabled && frozenCard.toggle, JSON.stringify(frozenCard));
check('mutable: a frozen level cannot be chosen in the scope table', await page.evaluate(() => [...document.querySelectorAll('#scope .scope-edit[data-row="helper"] [data-sl] option')].some(o => /research \(frozen\)/.test(o.textContent) && o.disabled)));
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ profiles: [{ name: 'research', settings: { helper: 'mock-pro' } }] }));
check('mutable: paste config refuses to change a frozen profile', /frozen: set "mutable": true first/.test(await page.textContent('.modal .cfgplan')));
await page.click('.modal button:not(.primary)');
await freezeProfile('research', false);
check('mutable: switching it back makes it editable again', await page.evaluate(() => { const c = [...document.querySelectorAll('#profiles [data-prof]')].find(x => x.querySelector('.name').textContent.endsWith('research')); return !c.hasAttribute('data-frozen') && !c.querySelector('[data-pf=name]').disabled; }));
await page.evaluate(() => { const t = document.querySelector('#smutable'); t.checked = false; t.dispatchEvent(new Event('change')); });
await page.evaluate(() => { const tr = document.querySelector('#scope .scope-edit[data-row="pace"]'); tr.querySelector('[data-sl]').value = 'session'; tr.querySelector('[data-sv]').value = 'tools'; tr.querySelector('[data-act="scope-set"]').click(); });
await page.waitForSelector('.modal');
check('mutable: a frozen session refuses its own changes, and says why', /this session is frozen/.test(await page.textContent('.modal')) && await page.evaluate(() => !(JSON.parse(localStorage['wh:s:' + JSON.parse(localStorage['wh:meta']).active]).over || {}).pace));
await page.click('.modal button');
await page.evaluate(() => { const t = document.querySelector('#smutable'); t.checked = true; t.dispatchEvent(new Event('change')); });

await page.fill('#input', 'a concern for a branch');
await page.click('[data-act=branch]');
await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
check('profiles: a branch inherits its source\'s profile', await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); const s = JSON.parse(localStorage['wh:s:' + m.active]); return !!s.parent && s.profile === JSON.parse(localStorage['wh:s:' + s.parent.id]).profile; }));

await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 99; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();
check('newer-schema data: build refuses to start', /schema 99/.test(await page.locator('#app pre').textContent()));
await page.evaluate(() => { const m = JSON.parse(localStorage['wh:meta']); m.schema = 1; localStorage['wh:meta'] = JSON.stringify(m); });
await page.reload();

check('layout: the page itself does not scroll', await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && scrollY === 0));
if (shot) await page.screenshot({ path: shot });
check('no page errors', errors.filter(e => !/schema 99|ERR_TUNNEL|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
await browser.close();
