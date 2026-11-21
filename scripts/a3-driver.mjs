// A3.1 stage-0 driver: one fresh harness session per (model, run); the one message is the extraction prompt of scripts/a3-lib.mjs (prompt()),
// no tools, strategy strat-serial-1.0 (blue). Own static page server and playwright browser, a fresh context per session (see scripts/a1-baseline.mjs, same selectors and settle rule).
// The OpenRouter key is read from a secrets file in this process, written to the context's key store, never printed or stored (replies are masked). A live run: only started by hand; tests use the mock.
//   node scripts/a3-driver.mjs --secrets C:\wh\secrets.env --models qwen/qwen3.7-flash,tencent/hy4-flash --runs 3 --cap 0.50 [--tag main] [--first-run 1] [--strategy strat-serial-1.0] [--out file.jsonl] [--page-port 8851] [--timeout 300000] [--headed]
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prompt, parseReply } from './a3-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const models = opt('models', 'qwen/qwen3.7-flash,tencent/hy4-flash').split(','), runs = Number(opt('runs', 3)), first = Number(opt('first-run', 1)), cap = Number(opt('cap', 0.5)), tag = opt('tag', 'main');
const strategy = opt('strategy', 'strat-serial-1.0'), PAGE = Number(opt('page-port', 8851)), TIMEOUT = Number(opt('timeout', 300000)), HEADED = argv.includes('--headed');
const OUT = path.resolve(opt('out', path.join(ROOT, 'docs/concepts/results/a3-validators-2026-11-21.jsonl')));

const secrets = Object.fromEntries(fs.readFileSync(opt('secrets', process.env.WH_SECRETS_FILE || 'C:\\wh\\secrets.env'), 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const KEY = secrets.OPENROUTER_API_KEY; if (!KEY) throw new Error('no OPENROUTER_API_KEY in the secrets file');
const mask = t => String(t ?? '').split(KEY).join('(masked)').replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-...(masked)');
if (/anthropic|claude/i.test(models.join())) throw new Error('no Anthropic model via OpenRouter');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(PAGE, '127.0.0.1');
const PAGE_URL = `http://localhost:${PAGE}/`;

const PROMPT = prompt(), PROMPT_HASH = createHash('sha256').update(PROMPT).digest('hex').slice(0, 16);
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
let ctx = null;
const rowsOut = () => fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.tag === tag) : [];
const done = new Set(rowsOut().map(r => `${r.model}|${r.run}`));
let spent = rowsOut().reduce((a, r) => a + (r.cost || 0), 0);

try {
  for (let run = first; run < first + runs; run++) for (const mi of run % 2 ? models : [...models].reverse()) {
    if (done.has(`${mi}|${run}`)) continue;
    if (spent >= cap) { console.log(`cap ${cap} reached (spent ${spent.toFixed(4)}); stopping`); throw Object.assign(new Error('cap'), { cap: true }); }
    ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    const ready = () => p.waitForSelector('#app #composer', { state: 'attached', timeout: 30000 });
    const sess = id => p.evaluate(id => JSON.parse(localStorage['wh:s:' + id] || 'null'), id);
    await p.goto(PAGE_URL); await ready();
    await p.evaluate(key => { localStorage['wh:keys'] = JSON.stringify({ openrouter: key }); }, KEY);
    await p.reload(); await ready();
    await p.selectOption('#provider', 'openrouter');
    await p.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
    await p.fill('.modal textarea', JSON.stringify({ settings: { model: mi, strategy } }));
    const txt = await p.textContent('.modal'); await p.click('.modal .primary');
    if (/refused/.test(txt)) throw new Error('settings refused: ' + txt.replace(/\s+/g, ' ').slice(0, 200));
    await p.click('[data-act=new]'); await p.waitForTimeout(200);
    const id = await p.evaluate(() => sessionStorage.getItem('wh:tab-active'));
    const t0 = Date.now(); let state = 'done';
    const w0 = Date.now(), stops0 = ((await sess(id)).stops || []).length;
    await p.fill('#input', PROMPT); await p.click('#send');
    await p.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 3000 }).catch(() => {});
    for (;;) {
      const busy = await p.evaluate(() => document.querySelector('#app').hasAttribute('data-busy'));
      if (!busy && ((await sess(id)).stops || []).length > stops0) break;
      if (Date.now() - w0 > TIMEOUT) { state = 'timeout'; break; }
      await new Promise(s => setTimeout(s, 300));
    }
    const s = await sess(id), notes = await p.evaluate(() => [...document.querySelectorAll('.msg[data-role=error] .txt')].map(e => e.textContent.trim()));
    const L = s.ledger.filter(e => !e.helper), reply = mask([...s.messages].reverse().find(m => m.role === 'assistant' && m.content)?.content || '');
    const sum = f => L.reduce((a, e) => a + (Number(e[f]) || 0), 0);
    const parsed = parseReply(reply);
    const rec = { tag, arm: strategy, model: mi, run, session: id, prompt_hash: PROMPT_HASH, state, stop: (s.stops || []).at(-1)?.why ?? null, requests: L.length, prompt: sum('prompt'), cached: sum('cached'), completion: sum('completion'), reasoning: sum('reasoning'), cost: +sum('cost').toFixed(6),
      parsed: !!parsed, items: parsed ? parsed.length : 0, notices: notes.map(mask).slice(-3), reply, seconds: Math.round((Date.now() - t0) / 1000) };
    fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    spent += rec.cost; await ctx.close().catch(() => {}); ctx = null;
    console.log(`${tag} r${run} ${mi.padEnd(22)} ${state}${rec.stop ? '/' + rec.stop : ''} parsed ${rec.parsed} items ${rec.items} req ${rec.requests} $${rec.cost.toFixed(5)} spent $${spent.toFixed(4)}`);
  }
} catch (e) { if (!e.cap) { console.error('driver error:', mask(e.stack || e)); process.exitCode = 2; } }
finally {
  if (ctx) await ctx.close().catch(() => {}); await browser.close().catch(() => {}); server.close();
  console.log(`spent $${spent.toFixed(4)} (tag ${tag})`);
  process.exit(process.exitCode || 0);
}
