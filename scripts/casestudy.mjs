// Case studies: the same scenario under each strategy, compared on tokens and cost,
// with a coherence check so a cheaper strategy that loses track counts as a failure
// (docs/STEMS.md §7). Offline on the mock's breakpoint model by default.
// Usage: node scripts/casestudy.mjs [--url URL] [--out DIR] [--strategies a,b,c]
//
// Scenario "side goal": the core works 3 turns; a side goal needs bulky work (3 turns, each
// with a large tool result); the core goes on 2 turns; then it needs the side goal's result.
//   serial / checkpoint: the side goal is done inline in the core
//   stem: the side goal runs in a stem from the turn it came up; the core pulls the fold by handle
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const url = flag('url', 'http://localhost:8787/'), outDir = flag('out', 'docs/case-studies');
const STRATS = flag('strategies', 'strat-serial-1.0,strat-checkpoint-1.0,strat-stem-1.0').split(',');
const MODELS = flag('models', 'mock-bp,mock-1').split(','), TAILS = flag('tails', '2,8').split(',').map(Number);
// $/token from the mock's model list (providers.js): input, output, cache read, cache write
//   mock-bp: breakpoint caching (nothing cached without a mark), writes cost more than input
//   mock-1:  automatic prefix caching (no marks), cheap reads, no write charge
const PRICES = { 'mock-bp': { in: 3e-6, out: 15e-6, read: 0.3e-6, write: 3.75e-6 }, 'mock-1': { in: 0.15e-6, out: 0.6e-6, read: 0.003e-6, write: 0.15e-6 } };

const browser = await chromium.launch();
async function runOne(strategy, MODEL, tail) {
  const PRICE = PRICES[MODEL];
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('#app #composer', { state: 'attached' });
  await page.selectOption('#provider', 'mock');
  await page.fill('#model', MODEL); await page.dispatchEvent('#model', 'change');
  await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
  await page.fill('.modal textarea', JSON.stringify({ settings: { strategy } }));
  await page.click('.modal .primary');
  const active = () => page.evaluate(() => sessionStorage.getItem('wh:tab-active'));
  const say = async text => { await page.fill('#input', text); await page.click('#send'); await page.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 5000 }).catch(() => {}); await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 60000 }); };
  const sess = id => page.evaluate(id => JSON.parse(localStorage['wh:s:' + id]), id);

  await page.click('[data-act=new]');
  const core = await active();
  for (const t of ['core: plan the work', 'core: settle the interface', 'core: we also need the slow-path numbers']) await say(t);
  const sideTurns = ['side: measure it big', 'side: again with more data big', 'side: and the worst case big'];
  const tailTurns = Array.from({ length: tail }, (_, i) => `core: next step ${i + 1}`);
  let handle = null;
  if (strategy.includes('stem')) {
    const s0 = await sess(core), at = s0.messages.findIndex(m => m.role === 'user' && /slow-path numbers/.test(m.content));
    await page.fill('#input', 'find the slow-path numbers');
    await page.click('[data-act=stem]');
    await page.waitForSelector('.modal select');
    await page.selectOption('.modal select', String(at));
    await page.click('.modal .primary');
    await page.waitForFunction(c => sessionStorage.getItem('wh:tab-active') !== c, core, { timeout: 10000 });
    await page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 60000 });
    const stem = await active();
    handle = (await sess(stem)).stem.handle;
    for (const t of sideTurns) await say(t);
    await say('wrap up: the fold for the core');
    await page.click(`#sessions [data-id="${core}"]`);
    for (const t of tailTurns) await say(t);
    await page.click(`#sessions [data-id="${stem}"]`);
    await page.click('[data-act=foldback]');
    await page.waitForFunction(c => sessionStorage.getItem('wh:tab-active') === c, core, { timeout: 10000 });
    await say('pull ' + handle); // the core needs the side goal's result now
  } else {
    for (const t of sideTurns) await say(t);
    await say('wrap up: the side goal');
    for (const t of tailTurns) await say(t);
    await say('core: what were the slow-path numbers?');
  }
  // all sessions this run made (the core and any stems)
  const all = await page.evaluate(() => JSON.parse(localStorage['wh:meta']).order.map(id => JSON.parse(localStorage['wh:s:' + id])));
  const rows = all.flatMap(s => s.ledger.map(e => ({ ...e, session: s.id === core ? 'core' : 'stem' })));
  const sum = (k, f = () => true) => rows.filter(f).reduce((n, e) => n + (Number(e[k]) || 0), 0);
  const prompt = sum('prompt'), cached = sum('cached'), write = sum('cacheWrite'), completion = sum('completion');
  const uncached = prompt - cached - write;
  const cost = uncached * PRICE.in + cached * PRICE.read + write * PRICE.write + completion * PRICE.out;
  const coreS = all.find(s => s.id === core);
  const coreChars = JSON.stringify(coreS.messages).length;
  // coherence: the core can answer with the side goal's result at the end
  const lastTool = [...coreS.messages].reverse().find(m => m.role === 'tool' || m.role === 'assistant');
  // the side goal's result (from its wrap-up) is in what the core holds at the end
  const coherent = /line 399 is the worst case/.test(JSON.stringify(coreS.messages));
  await page.context().close();
  return { strategy, model: MODEL, tail, requests: rows.filter(e => !e.helper).length, coreRequests: rows.filter(e => !e.helper && e.session === 'core').length, prompt, uncached, cached, write, completion, cost, coreChars, coherent, errors: errors.length };
}

const results = [];
for (const m of MODELS) for (const t of TAILS) for (const st of STRATS) {
  process.stdout.write(`running ${m} tail ${t} ${st} ... `);
  const r = await runOne(st, m, t); results.push(r);
  console.log(`${r.requests} requests, $${r.cost.toFixed(5)}, coherent ${r.coherent}`);
}
await browser.close();
const baseOf = r => results.find(x => x.strategy === 'strat-serial-1.0' && x.model === r.model && x.tail === r.tail);
const pct = (v, b) => b ? `${v <= b ? '−' : '+'}${Math.abs(Math.round(100 * (v - b) / b))}%` : '-';
const k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
const table = [
  '| model | core tail | strategy | requests | input (uncached) | cache read | cache write | output | cost | vs serial | core context | coherent |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.model} | ${r.tail} | ${r.strategy} | ${r.requests} | ${k(r.uncached)} | ${k(r.cached)} | ${k(r.write)} | ${k(r.completion)} | $${r.cost.toFixed(5)} | ${r.strategy === 'strat-serial-1.0' ? '-' : pct(r.cost, baseOf(r)?.cost)} | ${k(r.coreChars)} chars | ${r.coherent ? 'yes' : '**no**'} |`),
].join('\n');
const date = new Date().toISOString().slice(0, 10);
fs.mkdirSync(outDir, { recursive: true });
const rec = { scenario: 'side goal', prices: PRICES, date, url, results };
fs.writeFileSync(path.join(outDir, `side-goal-${date}.json`), JSON.stringify(rec, null, 1));
fs.writeFileSync(path.join(outDir, `side-goal-${date}.md`), `# Case study: side goal (${date})\n\nMock models: \`mock-bp\` caches only at explicit breakpoints (writes 1.25x input, reads 0.1x); \`mock-1\` caches prefixes automatically (reads 0.02x input). Prices per token: ${JSON.stringify(PRICES)}.\n\nThe core works 3 turns; a side goal needs 3 turns of bulky work and a wrap-up; the core goes on (the tail: ${TAILS.join(' or ')} turns); then it needs the side goal's result. Serial and checkpoint do the side goal inline; stem works it in a stem from the turn it came up, and the core pulls the fold by handle.\n\n${table}\n\nCoherent: the side goal's result is in what the core holds at the end.\n`);
console.log('\n' + table);
process.exitCode = results.every(r => r.coherent && !r.errors) ? 0 : 1;
