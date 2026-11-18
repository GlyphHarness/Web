// Drive a WebHarness page through a scenario and keep the evidence: screenshots
// and a record of every step (what was done, what the page showed, timings).
// Usage: node scripts/drive.mjs SCENARIO.json [--url URL] [--out DIR] [--headed]
//
// Scenario: {"url": "...", "setup": {"provider": "mock", "model": "mock-1"}, "steps": [
//   {"new": true}                                    start a session
//   {"say": "text", "wait": "idle"}                  send a message; wait until the turn ends
//   {"click": "css"} {"fill": "css", "value": "..."} {"press": "css", "key": "Enter"}
//   {"pane": "stage" | "insp" | "machine"}
//   {"wait": "css" | "idle", "timeout": 30000}
//   {"screenshot": "name"}                           saved as DIR/<n>-name.png
//   {"read": "css", "as": "name"}                    text (slot values included) into the record
//   {"eval": "js expression", "as": "name"}          a value from the page into the record
// ]}
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const headed = args.includes('--headed') && args.splice(args.indexOf('--headed'), 1);
const out = flag('out', 'drive-out'), urlFlag = flag('url', '');
const scenario = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const url = urlFlag || scenario.url || 'http://localhost:8787/';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: !headed });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true })).newPage();
const record = { url, started: new Date().toISOString(), steps: [], errors: [] };
page.on('pageerror', e => record.errors.push(String(e)));
const idle = t => page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: t || 120000 });
const slotText = sel => page.evaluate(async s => (await import('./app/styles.js')).slotText(document.querySelector(s)), sel);

await page.goto(url);
await page.waitForSelector('#app #composer', { state: 'attached' });
if (scenario.setup) {
  await page.evaluate(cfg => document.querySelector('[data-act=cfgpaste]').click(), null);
  await page.fill('.modal textarea', JSON.stringify({ settings: scenario.setup }));
  await page.click('.modal .primary');
}
let n = 0;
for (const st of scenario.steps || []) {
  const t0 = Date.now(), row = { n: ++n, step: st };
  try {
    if (st.new) await page.click('[data-act=new]');
    if (st.pane) await page.click(`[data-pane=${st.pane}]`);
    if (st.say != null) { await page.fill('#input', st.say); await page.click('#send'); if (st.wait !== 'none') { await page.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 5000 }).catch(() => {}); await idle(st.timeout); } }
    if (st.click) await page.click(st.click, { timeout: st.timeout || 30000 });
    if (st.fill) await page.fill(st.fill, String(st.value ?? ''));
    if (st.press) await page.press(st.press, st.key || 'Enter');
    if (st.wait && st.say == null) st.wait === 'idle' ? await idle(st.timeout) : await page.waitForSelector(st.wait, { timeout: st.timeout || 30000 });
    if (st.read) row.value = await slotText(st.read);
    if (st.eval) row.value = await page.evaluate(st.eval);
    if (st.screenshot) { const f = path.join(out, `${String(n).padStart(2, '0')}-${st.screenshot}.png`); await page.screenshot({ path: f }); row.file = f; }
    row.ok = true;
  } catch (e) { row.ok = false; row.error = String(e.message || e).split('\n')[0]; }
  row.ms = Date.now() - t0;
  record.steps.push(row);
  console.log(`${row.ok ? 'ok ' : 'ERR'} ${n} ${JSON.stringify(st).slice(0, 80)}${row.value != null ? ' -> ' + JSON.stringify(row.value).slice(0, 80) : ''}${row.error ? ' ' + row.error : ''}`);
  if (!row.ok && !scenario.keepGoing) break;
}
record.finished = new Date().toISOString();
fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 1));
console.log(`record: ${path.join(out, 'record.json')}${record.errors.length ? ` (${record.errors.length} page errors)` : ''}`);
await browser.close();
process.exitCode = record.steps.every(s => s.ok) && !record.errors.length ? 0 : 1;
