// A1.1 stage-0 baseline driver: one fresh session per question per model under the page's strategy (default strat-stem-1.0),
// folder data through the local bridge (read-only), scored by scripts/a1-corpus.mjs. Own playwright browser (a fresh context per session), own ports, own salt.
// Why not scripts/wh.mjs: wh has no per-session switch for the local tools (its `new` makes a session with tools ask,values only);
// this driver clicks the page's own #localtools box. Everything else follows wh.mjs (same selectors, same settle rule).
// (secrets file: --secrets, else env WH_SECRETS_FILE, else the local default.) The OpenRouter key is read from a secrets file inside this process, written to the browser profile's key store, and never
// printed or stored in a result. Tests use the mock provider; this is a live run and is only ever started by hand.
//   node scripts/a1-baseline.mjs --secrets C:\wh\secrets.env --models tencent/hy4-flash,qwen/qwen3.7-flash --runs 1 --cap 1.00
//        [--questions q01,q02] [--strategy strat-stem-1.0] [--dir C:\wh\a1-wh-stem1] [--data C:\wh\a1data-stem1] [--out file.jsonl]
//        [--nudges 3] [--page-port 8841] [--bridge-port 8843] [--tag canary] [--first-run 1] [--timeout 300000 (per message, not per session)] [--headed]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, expect, score, extract } from './a1-corpus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const models = opt('models', 'tencent/hy4-flash,qwen/qwen3.7-flash').split(','), runs = Number(opt('runs', 1)), first = Number(opt('first-run', 1)), cap = Number(opt('cap', 1)), tag = opt('tag', 'canary');
const strategy = opt('strategy', 'strat-stem-1.0'), DIR = path.resolve(opt('dir', 'C:\\wh\\a1-wh-stem1')), DATA = path.resolve(opt('data', 'C:\\wh\\a1data-stem1'));
const PAGE = Number(opt('page-port', 8841)), BRIDGE = Number(opt('bridge-port', 8843)), TIMEOUT = Number(opt('timeout', 300000));
const OUT = path.resolve(opt('out', path.join(ROOT, 'docs/concepts/results/a1-baseline-2026-11-21.jsonl')));
const only = opt('questions', '') ? opt('questions').split(',') : null;
const HEADED = argv.includes('--headed'), NUDGES = Number(opt('nudges', 3));

// the key: read here, held in memory only
const secrets = Object.fromEntries(fs.readFileSync(opt('secrets', process.env.WH_SECRETS_FILE || 'C:\\wh\\secrets.env'), 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const KEY = secrets.OPENROUTER_API_KEY; if (!KEY) throw new Error('no OPENROUTER_API_KEY in the secrets file');
const mask = t => String(t ?? '').split(KEY).join('(masked)').replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-...(masked)');

// the arm's own copy of the pinned data (hashes in docs/concepts/results/a1-corpus-2026-11-21.md)
fs.mkdirSync(DIR, { recursive: true });
const files = build(DATA);
const corpus = expect(DATA).filter(c => !only || only.includes(c.id));

// static page server (the repo as it is checked out)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(res);
}).listen(PAGE, '127.0.0.1');
const PAGE_URL = `http://localhost:${PAGE}/`;

// the local bridge: one read-only folder named data, a token that exists only for this run
const TOKEN = randomBytes(12).toString('hex');
const bridge = spawn(process.execPath, [path.join(ROOT, 'localbridge/wh-local.mjs'), '--port', String(BRIDGE), '--dir', `data=${DATA}`], { env: { ...process.env, WH_BRIDGE_TOKEN: TOKEN }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${BRIDGE}/health`)).ok) break; } catch {} await new Promise(s => setTimeout(s, 150)); }

const { chromium } = createRequire(import.meta.url)('playwright');
// one fresh, non-persistent browser context per session: no state, key or stuck run carries from one session to the next, and the key is never written to a profile on disk
const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
let ctx = null;
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.tag === tag).map(r => `${r.model}|${r.run}|${r.id}`) : []);
let spent = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.tag === tag).reduce((a, r) => a + (r.cost || 0), 0) : 0;

try {
  for (let run = first; run < first + runs; run++) for (const q of corpus) for (const mi of (run + Number(q.id.slice(1))) % 2 ? models : [...models].reverse()) {
    const key = `${mi}|${run}|${q.id}`; if (done.has(key)) continue;
    if (spent >= cap) { console.log(`cap ${cap} reached (spent ${spent.toFixed(4)}); stopping`); throw Object.assign(new Error('cap'), { cap: true }); }
    ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    const ready = () => p.waitForSelector('#app #composer', { state: 'attached', timeout: 30000 });
    const paste = async settings => { await p.evaluate(() => document.querySelector('[data-act=cfgpaste]').click()); await p.fill('.modal textarea', JSON.stringify({ settings })); const t = await p.textContent('.modal'); await p.click('.modal .primary'); return t; };
    const sess = id => p.evaluate(id => JSON.parse(localStorage['wh:s:' + id] || 'null'), id);
    await p.goto(PAGE_URL); await ready();
    await p.evaluate(([key, tok]) => { localStorage['wh:keys'] = JSON.stringify({ openrouter: key, localbridge: tok }); }, [KEY, TOKEN]);
    await p.reload(); await ready();
    await p.selectOption('#provider', 'openrouter');
    const txt = await paste({ model: mi, strategy, localBridge: `http://127.0.0.1:${BRIDGE}` });
    if (/refused/.test(txt)) throw new Error('settings refused: ' + txt.replace(/\s+/g, ' ').slice(0, 200));
    await p.click('[data-act=new]'); await p.waitForTimeout(200);
    const id = await p.evaluate(() => sessionStorage.getItem('wh:tab-active'));
    const salt = `a1.1 ${tag} run ${run} ${q.id} ${randomBytes(4).toString('hex')}`;
    await p.evaluate(t => { const el = document.querySelector('#system'); el.value = t; el.dispatchEvent(new Event('change')); }, salt);
    await p.evaluate(() => { const el = document.querySelector('#localtools'); el.checked = true; el.dispatchEvent(new Event('change')); });
    const s0 = await sess(id);
    if (!s0?.tools?.includes('local') || s0.system !== salt) throw new Error('session setup did not hold: ' + JSON.stringify({ tools: s0?.tools, sys: s0?.system === salt }));
    const t0 = Date.now(); let state = 'done', nudges = 0, cut = false;
    const wait = async () => {
      const w0 = Date.now(), stops0 = ((await sess(id)).stops || []).length; // a message ends when the page is idle AND the harness has recorded a stop for it (idle alone can flicker between a reply and its tool round)
      await p.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 3000 }).catch(() => {});
      for (;;) {
        const st = await p.evaluate(() => ({ busy: document.querySelector('#app').hasAttribute('data-busy'), held: !!document.querySelector('.msg[data-role=held]:not([data-done])'), ap: !!document.querySelector('.msg[data-role=approve]:not([data-done])'), ask: !!document.querySelector('.msg[data-role=ask]:not([data-done])') }));
        if (st.held || st.ap || st.ask) return st.held ? 'held' : st.ap ? 'approval' : 'asks';
        if (!st.busy && ((await sess(id)).stops || []).length > stops0) return 'done';
        if (Date.now() - w0 > TIMEOUT) { cut = true; return 'timeout'; }
        await new Promise(s => setTimeout(s, 300));
      }
    };
    await p.fill('#input', q.prompt); await p.click('#send'); state = await wait();
    // the harness stops a run after its tool-round limit; the operator's standing nudge is one fixed word, at most NUDGES times, and counted
    while (state === 'done' && nudges < NUDGES && (await sess(id)).stops?.at(-1)?.why === 'limit') { nudges++; await p.fill('#input', 'Continue.'); await p.click('#send'); state = await wait(); }
    const s = await sess(id), notes = await p.evaluate(() => [...document.querySelectorAll('.msg[data-role=error] .txt')].map(e => e.textContent.trim()));
    const L = s.ledger.filter(e => !e.helper), calls = s.messages.flatMap(m => m.tool_calls || []);
    const reply = [...s.messages].reverse().find(m => m.role === 'assistant' && m.content)?.content || '';
    const sc = score([q], [{ id: q.id, answer: extract(reply) ?? '' }])[0]; if (extract(reply) == null) sc.got = null; // no ANSWER line = not solved
    const sum = f => L.reduce((a, e) => a + (Number(e[f]) || 0), 0);
    const toolMsgs = s.messages.filter(m => m.role === 'tool');
    const rec = { tag, arm: strategy, model: mi, run, id: q.id, shape: q.shape, session: id, salt, expected: q.expected, got: sc.got, ok: sc.ok, state, cut, stop: (s.stops || []).at(-1)?.why ?? null,
      nudges, requests: L.length, prompt: sum('prompt'), cached: sum('cached'), completion: sum('completion'), reasoning: sum('reasoning'), cost: +sum('cost').toFixed(6),
      tools: calls.map(t => t.function.name), toolResultChars: toolMsgs.map(m => String(m.content ?? '').length), notices: notes.map(mask).slice(-3), reply: mask(reply).slice(-300),
      rows: L.map(e => ({ strat: e.strat, model: e.model, prompt: e.prompt, cached: e.cached, write: e.write, out: e.completion, reasoning: e.reasoning, cost: e.cost })), seconds: Math.round((Date.now() - t0) / 1000) };
    fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    spent += rec.cost; await ctx.close().catch(() => {}); ctx = null;
    console.log(`${tag} r${run} ${q.id} ${mi.padEnd(22)} ${rec.ok ? 'ok ' : 'NO '} nud ${nudges} req ${rec.requests} tools ${rec.tools.length} ${rec.state}${rec.stop ? '/' + rec.stop : ''} $${rec.cost.toFixed(5)} spent $${spent.toFixed(4)}`);
  }
} catch (e) { if (!e.cap) { console.error('driver error:', mask(e.stack || e)); process.exitCode = 2; } }
finally {
  // nothing was persisted (fresh contexts); stop everything this run started
  if (ctx) await ctx.close().catch(() => {}); await browser.close().catch(() => {}); bridge.kill(); server.close();
  fs.writeFileSync(path.join(DIR, 'files.json'), JSON.stringify(files, null, 1));
  console.log(`spent $${spent.toFixed(4)} (tag ${tag})`);
  process.exit(process.exitCode || 0);
}
