#!/usr/bin/env node
// wh: a terse CLI for operators (agents or people) driving WebHarness sessions.
// A daemon keeps one browser running (one tab per session), so held turns survive
// between commands; every command is a short request to it. Output is terse text,
// or JSON with --json.
//
//   wh init [-m model] [-s strategy] [-w watchModel] [-p pace]   provider OpenRouter (key added by the network proxy)
//   wh models [-q text] [-n 12]           cheap tool-capable models (live price list)
//   wh new [title]                        a new session; becomes current
//   wh use <id>                           make a session current
//   wh say [-i id] <text…>                send; returns at the end of the turn or at a hold
//   wh sayfile [-i id] <file>             send the text of a file as the message (line ends as LF)
//   wh system [-i id] <file>              set the session's system prompt from a file (line ends as LF); answers size and hash
//   wh paste <file>                       paste a config block (settings, profiles, keys) through the page's Paste config
//   wh step [-i id] [--all] | wh skip     release (or skip) the held step(s)
//   wh held [-i id]                       what is held or waiting for approval, in full
//   wh pace run|requests|tools|both       hold model requests and/or tool calls
//   wh stem [-i id] [-a turn] <goal…>     work a goal in a stem from a turn (default: the last)
//   wh fold [-i stemId]                   fold a stem back
//   wh ls                                 sessions: id, title, strategy, turns, cost, open flags
//   wh show [-i id] [-n 6]                the last turns, one line each
//   wh assess [-i id] [--all]             what is new since the last assess (then checked off)
//   wh flags [-i id] | wh ok <n…>         open watcher flags; check flags off as handled
//   wh review [-i id]                     assess (what is new) then every open flag, in one call
//   wh watch [-i id]                      assess the calls not checked yet
//   wh cost                               by strategy and model; checkpoints by kind
//   wh raw [-i id] [-n 40]                the last request's raw stream (tool-call and finish chunks)
//   wh allow [-i id] | wh deny            answer the approval card for a write (commit, PR, repo, concern); say/step show it as APPROVE?
//   wh trace [-i id] [-o file]            save the page's .trace (live evidence)
//   wh dump [-i id] [-o file]             save the session's record (messages, ledger; holds message text, keys masked)
//   wh log [-i id] [-n 20]                the command log: what the operator sent, in order (sizes and hashes, no text)
//   wh forget                             remove the stored keys from this browser profile (names what was there, never a value)
//   wh concerns <owner/name>              set the concerns repository
//   wh down                               stop the daemon
// Options: --url (default http://localhost:8787/), --port (daemon, default 8790), --json,
//   --dir <path> (state: browser profile, current session, log; default .wh), and, read when the daemon starts
//   (wh down first to change them): --channel chrome (the installed Chrome instead of the bundled browser), --headed (show the window)
// Env: WH_CHANNEL=chrome (or WH_CHROME=1), WH_HEADED=1, WH_DIR, WH_PORT, WH_URL; OPENROUTER_API_KEY and WH_GITHUB_PAT stored by `init`
// Every command is appended to <dir>/log.jsonl: time, command, session id, outcome, sizes and hashes. Never message text, never a key.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const PORT = Number(opt('port', process.env.WH_PORT || 8790)), URL0 = opt('url', process.env.WH_URL || 'http://localhost:8787/');
const DIR = path.resolve(opt('dir', process.env.WH_DIR || path.join(ROOT, '.wh'))), STATE = path.join(DIR, 'state.json'), LOG = path.join(DIR, 'log.jsonl');
// read when the daemon starts: which browser, and whether its window shows
const CHANNEL = opt('channel', process.env.WH_CHANNEL || (process.env.WH_CHROME ? 'chrome' : ''));
const HEADED = (argv.includes('--headed') && !!argv.splice(argv.indexOf('--headed'), 1)) || !!process.env.WH_HEADED;
const JSONOUT = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
fs.mkdirSync(DIR, { recursive: true });
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { current: '', assessed: {} }; } };
const writeState = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));

// ---------------- client ----------------
if (argv[0] !== 'daemon') {
  const [cmd = 'help', ...rest] = argv;
  if (cmd === 'help') { const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1); console.log(src.slice(0, src.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  const call = () => new Promise((ok, no) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => ok(JSON.parse(b))); });
    req.on('error', no); req.end(JSON.stringify({ cmd, args: rest, json: !!JSONOUT }));
  });
  let r;
  try { r = await call(); }
  catch {
    if (cmd === 'down') { console.log('not running'); process.exit(0); }
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon', '--port', String(PORT), '--url', URL0, '--dir', DIR, ...(CHANNEL ? ['--channel', CHANNEL] : []), ...(HEADED ? ['--headed'] : [])], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
    for (let i = 0; i < 60 && !r; i++) { await new Promise(s => setTimeout(s, 500)); try { r = await call(); } catch {} }
    if (!r) { console.error('wh: the daemon did not start'); process.exit(2); }
  }
  console.log(JSONOUT ? JSON.stringify(r.data ?? r.text, null, 1) : r.text);
  process.exit(r.ok ? 0 : 1);
}

// ---------------- daemon ----------------
const { chromium } = createRequire(import.meta.url)('playwright');
const up = async () => { try { return (await fetch(URL0)).ok; } catch { return false; } };
if (!(await up())) { spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', new globalThis.URL(URL0).port || '8787'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref(); for (let i = 0; i < 40 && !(await up()); i++) await new Promise(s => setTimeout(s, 250)); }
// --channel chrome (WH_CHANNEL, WH_CHROME=1) drives the installed Google Chrome instead of bundled Chromium; --headed (WH_HEADED=1) shows it.
const ctx = await chromium.launchPersistentContext(path.join(DIR, 'profile'), { headless: !HEADED, ...(HEADED ? { viewport: null, args: ['--start-maximized'] } : { viewport: { width: 1400, height: 900 } }), ...(CHANNEL ? { channel: CHANNEL } : {}) });
const tabs = new Map(); // session id -> page
const ready = async p => { await p.waitForSelector('#app #composer', { state: 'attached', timeout: 30000 }); return p; };
async function main() { const p = ctx.pages()[0] || await ctx.newPage(); if (!p.url().startsWith(URL0)) { await p.goto(URL0); await ready(p); } return p; }
async function tab(id) {
  if (!id) return main();
  if (tabs.has(id) && !tabs.get(id).isClosed()) return tabs.get(id);
  // the tab that already has it open holds its lock (another tab would only get a read-only view)
  for (const p of ctx.pages()) if (!p.isClosed() && await p.evaluate(() => sessionStorage.getItem('wh:tab-active')).catch(() => '') === id) { tabs.set(id, p); return p; }
  const p = await ctx.newPage(); await p.goto(URL0 + '?s=' + encodeURIComponent(id)); await ready(p);
  tabs.set(id, p); return p;
}
const meta = p => p.evaluate(() => JSON.parse(localStorage['wh:meta'] || '{}'));
const sess = (p, id) => p.evaluate(id => JSON.parse(localStorage['wh:s:' + id] || 'null'), id);
const flagOf = (a, n) => { const i = a.indexOf('-' + n); return i >= 0 ? a.splice(i, 2)[1] : undefined; };
const has = (a, f) => { const i = a.indexOf(f); return i >= 0 ? (a.splice(i, 1), true) : false; };
const k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0);
const money = n => '$' + (Number(n) || 0).toFixed(5);
const line = (m, i) => `#${i} ${m.role}${m.tool_calls?.length ? ' [' + m.tool_calls.map(t => t.function.name).join(',') + ']' : ''}: ${String(m.content ?? '').replace(/\s+/g, ' ').slice(0, 110)}`;
const costOf = s => s.ledger.reduce((n, e) => n + (Number(e.cost) || 0), 0);
const openFlags = s => (s.flags || []).filter(f => !f.handled);
// What is kept of a text in the log and in answers: its size and a short hash, never the text.
const sha = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const readText = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
// Keys never leave: anything shaped like one, and the keys this process was given, are masked in every answer, dump and log line.
const SECRET = /\b(sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,})/g;
const mask = t => { let s = String(t ?? '').replace(SECRET, m => m.slice(0, 5) + '...(masked)'); for (const v of [process.env.OPENROUTER_API_KEY, process.env.WH_GITHUB_PAT]) if (v && v.length > 8) s = s.split(v).join('(masked)'); return s; };
const pasteSettings = async (p, settings) => { await p.evaluate(() => document.querySelector('[data-act=cfgpaste]').click()); await p.fill('.modal textarea', JSON.stringify({ settings })); const txt = await p.textContent('.modal'); await p.click('.modal .primary'); return txt; };

// a turn: wait until it ends, or a step is held (pacing), or it asks something
async function settle(p, ms = 900000) {
  const t0 = Date.now();
  await p.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 3000 }).catch(() => {});
  for (;;) {
    const st = await p.evaluate(() => ({ busy: document.querySelector('#app').hasAttribute('data-busy'), held: [...document.querySelectorAll('.msg[data-role=held]:not([data-done])')].map(c => c.querySelector('pre')?.textContent.slice(0, 200)), approve: [...document.querySelectorAll('.msg[data-role=approve]:not([data-done])')].map(c => c.textContent.replace(/\s+/g, ' ').slice(0, 1200)), ask: !!document.querySelector('.msg[data-role=ask]:not([data-done])') }));
    if (st.held.length) return { held: st.held };
    if (st.approve.length) return { approve: st.approve };
    if (st.ask) return { ask: true };
    if (!st.busy) return { done: true };
    if (Date.now() - t0 > ms) return { timeout: true };
    await new Promise(s => setTimeout(s, 300));
  }
}
async function turnReport(p, id, before) {
  const s = await sess(p, id), msgs = s.messages.slice(before.n), ledger = s.ledger.slice(before.l);
  const calls = msgs.flatMap(m => m.tool_calls || []).map(t => t.function.name);
  const reply = [...msgs].reverse().find(m => m.role === 'assistant' && m.content)?.content || '';
  const tok = ledger.reduce((o, e) => ({ p: o.p + (e.prompt || 0), c: o.c + (e.cached || 0), o: o.o + (e.completion || 0), $: o.$ + (Number(e.cost) || 0) }), { p: 0, c: 0, o: 0, $: 0 });
  return { id, requests: ledger.filter(e => !e.helper).length, tools: calls, tokens: { prompt: tok.p, cached: tok.c, out: tok.o }, cost: tok.$, reply: reply.slice(0, 600), flags: openFlags(s).filter(f => f.at > before.n).map(f => `${f.tool}: ${f.why}`) };
}
const fmtTurn = (r, st) => [`${r.id} · ${r.requests} req · ${k(r.tokens.prompt)} in (${k(r.tokens.cached)} cached) · ${k(r.tokens.out)} out · ${money(r.cost)}${r.tools.length ? ' · tools ' + r.tools.join(',') : ''}`,
  ...(st.approve ? st.approve.map(a => 'APPROVE? ' + a + '  (wh allow | wh deny)') : []),
  ...(st.held ? st.held.map(h => 'HELD ' + h + '  (wh step | wh skip)') : st.ask ? ['ASKS a question (answer it in the page)'] : st.timeout ? ['still running (wh show / wh say later)'] : []),
  ...(r.flags.length ? r.flags.map(f => 'FLAG ' + f) : []), r.reply ? '> ' + r.reply.replace(/\n+/g, ' ⏎ ').slice(0, 400) : ''].filter(Boolean).join('\n');

async function decide(a, verb) {
  const id = flagOf(a, 'i') || readState().current, p = await tab(id), s0 = await sess(p, id), before = { n: s0.messages.length, l: s0.ledger.length };
  const card = p.locator('.msg[data-role=approve]:not([data-done])').first();
  if (!await card.count()) return { ok: false, text: 'nothing is waiting for approval' };
  const what = (await card.textContent()).replace(/\s+/g, ' ').slice(0, 300);
  await card.locator('button', { hasText: verb }).click();
  const st = await settle(p);
  return { text: `${verb}ed: ${what}\n` + fmtTurn(await turnReport(p, id, before), st) };
}
const CMDS = {
  async init(a) {
    const p = await main();
    // In the cloud a network proxy swaps this placeholder for the real key; locally OPENROUTER_API_KEY (daemon env) is used as is.
    await p.evaluate(([key, gh]) => { const k = JSON.parse(localStorage['wh:keys'] || '{}'); k.openrouter = key; if (gh) k.github = gh; localStorage['wh:keys'] = JSON.stringify(k); }, [process.env.OPENROUTER_API_KEY || 'sk-or-v1-proxy-injected', process.env.WH_GITHUB_PAT || '']);
    await p.reload(); await ready(p);
    await p.selectOption('#provider', 'openrouter');
    const settings = {};
    for (const [f, key] of [['m', 'model'], ['s', 'strategy'], ['w', 'watchModel'], ['p', 'pace'], ['h', 'helper']]) { const v = flagOf(a, f); if (v != null) settings[key] = v; }
    const txt = Object.keys(settings).length ? await pasteSettings(p, settings) : 'no settings given';
    const cur = (await meta(p)).settings;
    return { text: `provider openrouter (key: ${process.env.OPENROUTER_API_KEY ? 'env' : 'proxy'}) · model ${cur.model || '-'} · strategy ${cur.strategy || 'strat-stem-1.0 (default)'} · watch ${cur.watchModel || 'off'} · pace ${cur.pace || 'run'}${/refused/.test(txt) ? '\n' + txt.replace(/\s+/g, ' ').slice(0, 300) : ''}`, data: cur };
  },
  async models(a) {
    const q = (flagOf(a, 'q') || '').toLowerCase(), n = Number(flagOf(a, 'n') || 12);
    const j = await (await fetch('https://openrouter.ai/api/v1/models')).json();
    const pr = (x, f) => Number(x.pricing?.[f] || 0) * 1e6;
    const rows = j.data.filter(x => (x.supported_parameters || []).includes('tools') && (!q || x.id.toLowerCase().includes(q))).sort((x, y) => (pr(x, 'prompt') + pr(x, 'completion')) - (pr(y, 'prompt') + pr(y, 'completion'))).slice(0, n);
    return { text: rows.map(x => `${x.id}  in ${pr(x, 'prompt').toFixed(3)} out ${pr(x, 'completion').toFixed(3)} $/M  ctx ${k(x.context_length)}`).join('\n'), data: rows.map(x => x.id) };
  },
  async new(a) {
    const p = await main();
    await p.click('[data-act=new]'); await p.waitForTimeout(150);
    const id = await p.evaluate(() => sessionStorage.getItem('wh:tab-active'));
    if (a.length) { await p.fill('#title', a.join(' ')); await p.dispatchEvent('#title', 'change'); }
    const st = readState(); st.current = id; writeState(st);
    return { text: id, data: { id } };
  },
  async use([id]) { const st = readState(); st.current = id; writeState(st); return { text: 'current ' + id }; },
  async say(a) {
    const id = flagOf(a, 'i') || readState().current;
    if (!id) return { ok: false, text: 'no session: wh new' };
    const p = await tab(id), s0 = await sess(p, id), before = { n: s0.messages.length, l: s0.ledger.length }, text = a.join(' ');
    await p.fill('#input', text); await p.click('#send');
    const st = await settle(p);
    const r = await turnReport(p, id, before);
    return { text: fmtTurn(r, st), data: { ...r, state: st }, log: { id, chars: text.length, hash: sha(text) } };
  },
  // The text of a file as the message: the same bytes every run (line ends as LF), nothing lost to a shell.
  async sayfile(a) {
    const id = flagOf(a, 'i') || readState().current;
    if (!a[0]) return { ok: false, text: 'wh sayfile [-i id] <file>' };
    return CMDS.say([...(id ? ['-i', id] : []), readText(a[0])]);
  },
  // Set the session's system prompt (the page's own field) from a file. The answer and the log carry size and hash, not the text.
  async system(a) {
    const id = flagOf(a, 'i') || readState().current;
    if (!id || !a[0]) return { ok: false, text: 'wh system [-i id] <file>' };
    const text = readText(a[0]), p = await tab(id);
    if (await p.evaluate(() => sessionStorage.getItem('wh:tab-active')) !== id) return { ok: false, text: `the tab does not show ${id}` };
    await p.evaluate(t => { const el = document.querySelector('#system'); el.value = t; el.dispatchEvent(new Event('change')); }, text);
    const s = await sess(p, id), stored = s?.system === text, d = { id, chars: text.length, lines: text.split('\n').length, hash: sha(text), stored };
    return { ok: stored, text: `system of ${id}: ${d.chars} chars · ${d.lines} lines · hash ${d.hash}${stored ? '' : ' · NOT stored as given'}`, data: d, log: { id, chars: d.chars, hash: d.hash } };
  },
  // Paste a whole config block (settings, profiles, keys) from a file through the page's own Paste config, which shows keys masked.
  async paste([file]) {
    if (!file) return { ok: false, text: 'wh paste <file>' };
    const text = fs.readFileSync(file, 'utf8'), p = await main();
    await p.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
    await p.fill('.modal textarea', text);
    await p.waitForTimeout(300);
    const plan = (await p.textContent('.modal')).replace(/\s+/g, ' ').slice(0, 1500);
    await p.click('.modal .primary');
    await p.waitForTimeout(300);
    const m = await meta(p), profiles = (m.profiles || []).map(x => ({ name: x.name, repos: x.repos || [] }));
    return { text: `${plan}\nprofiles now: ${profiles.map(x => `${x.name}[${x.repos.join('|')}]`).join(', ') || '-'} · new sessions use ${(m.profiles || []).find(x => x.id === m.settings.newProfile)?.name || '-'}`, data: { settings: m.settings, profiles }, log: { chars: text.length, hash: sha(text) } };
  },
  // What is held (pacing) or waiting for approval, whole: say and step show only the first characters.
  async held(a) {
    const id = flagOf(a, 'i') || readState().current, p = await tab(id);
    const st = await p.evaluate(() => ({
      held: [...document.querySelectorAll('.msg[data-role=held]:not([data-done])')].map(c => c.querySelector('pre')?.textContent || ''),
      approve: [...document.querySelectorAll('.msg[data-role=approve]:not([data-done])')].map(c => ({ what: c.querySelector('pre')?.textContent || '', files: [...c.querySelectorAll('details')].map(d => ({ path: d.querySelector('summary')?.textContent || '', chars: (d.querySelector('pre')?.textContent || '').length })) })),
    }));
    return { text: [...st.held.map(h => 'HELD ' + h), ...st.approve.map(c => 'APPROVE? ' + c.what + (c.files.length ? '\nshown: ' + c.files.map(f => `${f.path} (${f.chars} chars)`).join(', ') : ''))].join('\n') || 'nothing is held', data: st, log: { id, held: st.held.length, approve: st.approve.length } };
  },
  // The session's record as stored (messages with their text, ledger, flags): for validators and write-ups. Keys are masked.
  async dump(a) {
    const id = flagOf(a, 'i') || readState().current, o = flagOf(a, 'o'), p = await main(), s = await sess(p, id);
    if (!s) return { ok: false, text: 'no session ' + id };
    const out = path.resolve(o || path.join(DIR, 'dumps', id + '.json')), text = mask(JSON.stringify(s, null, 1));
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, text);
    return { text: `${out}\n${s.messages.length} messages · ${s.ledger.length} ledger rows · ${text.length} chars (holds message text; keys masked)`, data: { out, id, messages: s.messages.length, ledger: s.ledger.length }, log: { id, chars: text.length, hash: sha(text) } };
  },
  // Remove the stored keys from this browser profile. Pages are loaded again so none keeps a copy in memory.
  async forget() {
    const p = await main();
    if (await p.evaluate(() => document.querySelector('#app')?.hasAttribute('data-busy'))) return { ok: false, text: 'a turn is running; forget when it has ended' };
    const had = await p.evaluate(() => { let k = {}; try { k = JSON.parse(localStorage['wh:keys'] || '{}'); } catch {} localStorage.removeItem('wh:keys'); return Object.keys(k).filter(n => k[n]); });
    for (const pg of ctx.pages()) if (!pg.isClosed()) { await pg.reload(); await ready(pg); }
    const left = await p.evaluate(() => { try { return Object.values(JSON.parse(localStorage['wh:keys'] || '{}')).some(Boolean); } catch { return true; } });
    return { ok: !left, text: `key store ${left ? 'NOT cleared' : 'cleared'} (was: ${had.join(', ') || 'none'})`, data: { had, cleared: !left }, log: { had: had.length } };
  },
  // The command log: one line per command sent, oldest first. Sizes and hashes stand for text.
  async log(a) {
    const id = flagOf(a, 'i'), n = Number(flagOf(a, 'n') || 20);
    const rows = readLog().filter(e => !id || e.id === id);
    return { text: rows.slice(-n).map(e => `${e.t} ${e.ok ? 'ok ' : 'no '} ${e.cmd}${e.id ? ' ' + e.id : ''}${e.chars != null ? ` ${e.chars}ch` : ''}${e.hash ? ' ' + e.hash : ''}`).join('\n') || 'no commands logged', data: { rows: rows.slice(-n), total: rows.length } };
  },
  async step(a) {
    const id = flagOf(a, 'i') || readState().current, all = has(a, '--all');
    const p = await tab(id), s0 = await sess(p, id), before = { n: s0.messages.length, l: s0.ledger.length };
    const n = await p.locator('.msg[data-role=held]:not([data-done])').count();
    if (!n) return { ok: false, text: 'nothing is held' };
    await p.locator(`.msg[data-role=held]:not([data-done]) [data-hold=${all ? 'all' : 'release'}]`).first().click();
    const st = await settle(p);
    return { text: fmtTurn(await turnReport(p, id, before), st) };
  },
  async skip(a) {
    const id = flagOf(a, 'i') || readState().current, p = await tab(id);
    if (!await p.locator('.msg[data-role=held]:not([data-done])').count()) return { ok: false, text: 'nothing is held' };
    await p.locator('.msg[data-role=held]:not([data-done]) [data-hold=skip]').first().click();
    const st = await settle(p);
    return { text: st.held ? 'skipped; next held: ' + st.held[0] : 'skipped; the turn ' + (st.done ? 'ended' : 'goes on') };
  },
  // A write that leaves the browser (commit, PR, repo, concern) waits on a card: `say`/`step` return with APPROVE? and the card text; the operator reads it, then allows or denies.
  async allow(a) { return decide(a, 'allow'); },
  async deny(a) { return decide(a, 'deny'); },
  // Save the page's .trace (every request of this page load: bodies sent, status, raw response chunks; no keys) -- the evidence format issue #4 asks for.
  async trace(a) {
    const id = flagOf(a, 'i') || readState().current, out = path.resolve(flagOf(a, 'o') || path.join(DIR, 'traces', `trace-${new Date().toISOString().replace(/[:.]/g, '-')}.trace`));
    const p = await tab(id); fs.mkdirSync(path.dirname(out), { recursive: true });
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.evaluate(() => document.querySelector('[data-act=trace]').click())]);
    await dl.saveAs(out);
    const j = JSON.parse(fs.readFileSync(out, 'utf8'));
    const hosts = [...new Set(j.exchanges.map(e => { try { return new globalThis.URL(e.url).host; } catch { return '?'; } }))];
    return { text: `${out}\n${j.exchanges.length} exchanges · hosts ${hosts.join(', ')} · ${j.smells?.length || 0} smells`, data: { out, exchanges: j.exchanges.length, hosts } };
  },
  // Point concern_file / "file a concern" at a repository (Settings -> Concerns repository; not in paste config).
  async concerns([repo = '']) {
    const p = await main();
    await p.evaluate(r => { const el = document.querySelector('#concernrepo'); el.value = r; el.dispatchEvent(new Event('change')); }, repo);
    return { text: 'concerns repository: ' + (repo || '(page repo)') };
  },
  async pace([v]) { const p = await main(); await pasteSettings(p, { pace: v }); return { text: 'pace ' + v }; },
  async stem(a) {
    const id = flagOf(a, 'i') || readState().current, at = flagOf(a, 'a'), p = await tab(id);
    await p.fill('#input', a.join(' ')); await p.click('[data-act=stem]');
    const refused = await p.waitForSelector('.modal select', { timeout: 2000 }).then(() => false, () => true);
    if (refused) return { ok: false, text: (await p.locator('.thread:visible .msg[data-role=error]').last().textContent().catch(() => '')) || 'no stem' };
    if (at != null) await p.selectOption('.modal select', String(at));
    await p.click('.modal .primary');
    await p.waitForFunction(c => sessionStorage.getItem('wh:tab-active') !== c, id, { timeout: 10000 });
    const sid = await p.evaluate(() => sessionStorage.getItem('wh:tab-active'));
    const st = await settle(p), s = await sess(p, sid);
    tabs.set(sid, p); tabs.delete(id); // this tab now shows the stem
    const stt = readState(); stt.core = id; stt.current = sid; writeState(stt); // the stem is the work now (wh fold goes back)
    return { text: `stem ${sid} handle ${s.stem.handle} (now current; wh fold returns to ${id})\n` + fmtTurn(await turnReport(p, sid, { n: s.parent.at, l: 0 }), st), data: { id: sid, handle: s.stem.handle } };
  },
  async fold(a) {
    const id = flagOf(a, 'i') || readState().current, p = await tab(id);
    await p.click('[data-act=foldback]'); await p.waitForTimeout(300);
    const s = await sess(p, id);
    if (s.stem?.folded) { const stt = readState(); stt.current = s.stem.core; writeState(stt); tabs.delete(id); }
    return s.stem?.folded ? { text: `folded ${s.stem.handle} into ${s.stem.core} (now current)` } : { ok: false, text: 'not folded (is it a stem with a final reply?)' };
  },
  async ls() {
    const p = await main(), m = await meta(p);
    const all = await Promise.all(m.order.map(id => sess(p, id)));
    const rows = all.filter(Boolean).map(s => ({ id: s.id, title: s.title, strat: s.ledger.at(-1)?.strat || '-', turns: s.messages.filter(x => x.role === 'user').length, cost: costOf(s), flags: openFlags(s).length, stem: s.stem ? (s.stem.folded ? 'folded' : 'open') : '' }));
    return { text: rows.map(r => `${r.id}  ${r.title.slice(0, 28).padEnd(28)} ${r.strat.padEnd(20)} ${String(r.turns).padStart(3)}t ${money(r.cost)}${r.flags ? ' ' + r.flags + ' flags' : ''}${r.stem ? ' stem:' + r.stem : ''}`).join('\n') || 'no sessions', data: rows };
  },
  async show(a) {
    const id = flagOf(a, 'i') || readState().current, n = Number(flagOf(a, 'n') || 6), p = await main(), s = await sess(p, id);
    if (!s) return { ok: false, text: 'no session ' + id };
    return { text: s.messages.map(line).slice(-n).join('\n'), data: s.messages.slice(-n) };
  },
  async assess(a) {
    const id = flagOf(a, 'i') || readState().current, all = has(a, '--all'), p = await main(), s = await sess(p, id);
    if (!s) return { ok: false, text: 'no session ' + id };
    const st = readState(), mark = all ? { n: 0, l: 0 } : (st.assessed[id] || { n: 0, l: 0 });
    const msgs = s.messages.slice(mark.n), led = s.ledger.slice(mark.l);
    const calls = msgs.flatMap(m => m.tool_calls || []);
    const verdict = c => s.watched?.[c.id] || 'unchecked';
    const sum = f => led.reduce((n, e) => n + (Number(e[f]) || 0), 0);
    const main_ = led.filter(e => !e.helper);
    const out = {
      id, since: mark.n, turns: msgs.filter(m => m.role === 'user').length, requests: main_.length, helper: led.length - main_.length,
      tokens: { prompt: sum('prompt'), cached: sum('cached'), write: sum('cacheWrite'), out: sum('completion'), reasoning: sum('reasoning') }, cost: sum('cost'),
      perTurn: main_.map(e => ({ out: e.completion || 0, reasoning: e.reasoning || 0 })),
      cache: sum('prompt') ? Math.round(100 * sum('cached') / sum('prompt')) : null,
      calls: calls.map(c => `${c.function.name}:${verdict(c)}`), flags: openFlags(s).filter(f => f.at > mark.n).map(f => `${f.tool}: ${f.why}`),
      errors: msgs.filter(m => m.role === 'tool' && /^(Tool error|Error:|Not run)/.test(String(m.content))).length,
      strategy: main_.at(-1)?.strat || null, model: main_.at(-1)?.model || null, stem: s.stem ? { handle: s.stem.handle, folded: !!s.stem.folded } : null,
    };
    st.assessed[id] = { n: s.messages.length, l: s.ledger.length, t: Date.now() }; writeState(st); // checked off
    const text = [`${id} since #${out.since} · ${out.turns} turns · ${out.requests} req (+${out.helper} helper) · ${k(out.tokens.prompt)} in, ${out.cache ?? '-'}% cached, ${k(out.tokens.write)} written · ${k(out.tokens.out)} out (${k(out.tokens.reasoning)} reasoning) · ${money(out.cost)}`,
      out.perTurn.length ? 'out per request ' + out.perTurn.map(t => `${k(t.out)}${t.reasoning ? '/' + k(t.reasoning) + 'r' : ''}`).join(' ') : '',
      `strategy ${out.strategy || '-'} · model ${out.model || '-'}${out.stem ? ` · stem ${out.stem.handle} ${out.stem.folded ? 'folded' : 'open'}` : ''}`,
      out.calls.length ? 'calls ' + out.calls.join(' ') : 'no tool calls', out.errors ? `${out.errors} failed calls` : '', ...out.flags.map(f => 'FLAG ' + f)].filter(Boolean).join('\n');
    return { text: msgs.length || all ? text : `${id}: nothing new since the last assess`, data: out };
  },
  // turn profile: shape, sizes, repeats and costs of every session's turns, metadata only (no judgement; see docs/concepts/TURN-ANALYSIS.md)
  //   wh profile                    one block per session, then the spread by (strategy | model)
  //   wh profile -i <id>            one session
  //   wh profile -o <file>          also write the profiles as JSON (no message content in it)
  //   wh profile -i <id> -m <n>     DRILL: show message n (content, truncated); -r <n> shows ledger row n
  async profile(a) {
    const T = await import('./turn-profile.mjs');
    const id = flagOf(a, 'i'), out = flagOf(a, 'o'), msg = flagOf(a, 'm'), req = flagOf(a, 'r');
    const p = await main(), m = await meta(p);
    const all = (await Promise.all((id ? [id] : m.order).map(i => sess(p, i)))).filter(Boolean);
    if (msg != null || req != null) { if (!all[0]) return { ok: false, text: 'no session ' + id }; return { text: T.drill(all[0], { msg: msg != null ? Number(msg) : null, req: req != null ? Number(req) : null }) }; }
    const ps = all.map(T.profile), rows = T.across(ps);
    if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), sessions: ps, groups: rows }, null, 1));
    return { text: [...ps.map(T.render), '', 'by strategy | model (helper requests as helper:kind)', T.renderAcross(rows), '', 'per session behaviour', T.renderBehaviour(T.behaviour(ps))].join('\n'), data: { sessions: ps, groups: rows } };
  },
  async flags(a) {
    const id = flagOf(a, 'i') || readState().current, p = await main(), s = await sess(p, id);
    const f = (s?.flags || []).map((x, i) => ({ n: i, ...x })).filter(x => !x.handled);
    return { text: f.map(x => `${x.n} #${x.at} ${x.tool}: ${x.why}`).join('\n') || 'no open flags', data: f };
  },
  async review(a) { // assess what is new, then list every open flag (one call instead of two)
    const r = await CMDS.assess([...a]), f = await CMDS.flags([...a]);
    return { ok: r.ok !== false, text: [r.text, 'open flags:\n' + f.text].join('\n'), data: { assess: r.data, flags: f.data } };
  },
  async ok(a) {
    const id = flagOf(a, 'i') || readState().current, p = await main();
    const n = await p.evaluate(({ id, ns }) => { const s = JSON.parse(localStorage['wh:s:' + id]); for (const i of ns) if (s.flags?.[i]) s.flags[i].handled = Date.now(); localStorage['wh:s:' + id] = JSON.stringify(s); return ns.length; }, { id, ns: a.map(Number) });
    return { text: `checked off ${n} flag${n === 1 ? '' : 's'}` };
  },
  async watch(a) { const id = flagOf(a, 'i') || readState().current, p = await tab(id); const r = await p.evaluate(id => whDebug.rewatch(id), id); return { text: `checked ${r.checked}, already checked ${r.skipped}`, data: r }; },
  async cost() {
    const p = await main(), r = await p.evaluate(() => whDebug.strategyStats()), c = await p.evaluate(() => whDebug.checkpoints());
    return { text: [...r.map(o => `${o.strat.padEnd(22)} ${o.model.padEnd(34)} ${String(o.requests).padStart(4)} req  cache ${o.cache == null ? '-' : Math.round(o.cache * 100) + '%'}  ${money(o.costRate)}/req  smells ${o.smellRate.toFixed(3)}/req`), ...Object.entries(c).map(([kind, o]) => `checkpoint ${kind}: ${o.paid}/${o.set} paid, ${k(o.writeTokens)} written, ${o.reads} reads (${k(o.readTokens)})`)].join('\n') || 'no requests yet', data: { strategies: r, checkpoints: c } };
  },
  // the raw stream of the last model request in a session's tab (provider chunks), for diagnosis
  async raw(a) {
    const id = flagOf(a, 'i') || readState().current, n = Number(flagOf(a, 'n') || 40), p = await tab(id);
    const ev = await p.evaluate(() => document.querySelector('#events')?.textContent || '');
    const lines = ev.split('\n').filter(Boolean);
    return { text: lines.filter(l => /tool_calls|finish_reason|error/.test(l)).slice(0, n).join('\n') || '(no events shown)', data: lines };
  },
  async down() { setTimeout(async () => { await ctx.close(); process.exit(0); }, 100); return { text: 'stopping' }; },
};

// commands that drive a session run in order per session; others (and other sessions) run at once
const locks = new Map(), DRIVE = new Set(['say', 'sayfile', 'system', 'step', 'skip', 'stem', 'fold', 'new', 'init', 'pace', 'paste', 'allow', 'deny', 'forget']);
const MAIN = ['new', 'init', 'pace', 'paste', 'forget'], NOSESSION = new Set([...MAIN, 'models', 'ls', 'cost', 'concerns', 'profile', 'log', 'down', 'use']);
// The command log (wh log). A line holds what was sent as sizes and hashes; arguments are never copied, since a message is one.
function logLine(e) { try { fs.appendFileSync(LOG, mask(JSON.stringify(e)) + '\n'); } catch {} }
function readLog() { try { return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d);
  req.on('end', () => {
    const { cmd, args } = JSON.parse(b || '{}');
    const ai = (args || []).indexOf('-i'), key = DRIVE.has(cmd) ? (MAIN.includes(cmd) ? '(main)' : ai >= 0 ? args[ai + 1] : readState().current) : null;
    const prev = key ? locks.get(key) || Promise.resolve() : Promise.resolve();
    const run = prev.then(async () => {
      let out;
      const t0 = Date.now(), sid = NOSESSION.has(cmd) ? undefined : ai >= 0 ? args[ai + 1] : readState().current || undefined;
      try { out = CMDS[cmd] ? await CMDS[cmd]([...(args || [])]) : { ok: false, text: `unknown command ${cmd} (wh help)` }; }
      catch (e) { out = { ok: false, text: 'wh: ' + String(e.message || e).split('\n')[0] }; }
      const text = mask(out.text), data = out.data === undefined ? undefined : JSON.parse(mask(JSON.stringify(out.data)));
      if (CMDS[cmd] && cmd !== 'log') logLine({ t: new Date(t0).toISOString(), cmd, ...(out.log?.id || out.data?.id || sid ? { id: out.log?.id || out.data?.id || sid } : {}), ok: out.ok !== false, ms: Date.now() - t0, ...out.log });
      res.end(JSON.stringify({ ok: out.ok !== false, text, data }));
    });
    if (key) locks.set(key, run.catch(() => {}));
  });
}).listen(PORT, '127.0.0.1');
