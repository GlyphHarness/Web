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
//   wh step [-i id] [--all] | wh skip     release (or skip) the held step(s)
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
//   wh down                               stop the daemon
// Options: --url (default http://localhost:8787/), --port (daemon, default 8790), --json
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.wh'), STATE = path.join(DIR, 'state.json');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const PORT = Number(opt('port', process.env.WH_PORT || 8790)), URL0 = opt('url', process.env.WH_URL || 'http://localhost:8787/');
const JSONOUT = argv.includes('--json') && argv.splice(argv.indexOf('--json'), 1);
fs.mkdirSync(DIR, { recursive: true });
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { current: '', assessed: {} }; } };
const writeState = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 1));

// ---------------- client ----------------
if (argv[0] !== 'daemon') {
  const [cmd = 'help', ...rest] = argv;
  if (cmd === 'help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 25).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  const call = () => new Promise((ok, no) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => ok(JSON.parse(b))); });
    req.on('error', no); req.end(JSON.stringify({ cmd, args: rest, json: !!JSONOUT }));
  });
  let r;
  try { r = await call(); }
  catch {
    if (cmd === 'down') { console.log('not running'); process.exit(0); }
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon', '--port', String(PORT), '--url', URL0], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
    for (let i = 0; i < 60 && !r; i++) { await new Promise(s => setTimeout(s, 500)); try { r = await call(); } catch {} }
    if (!r) { console.error('wh: the daemon did not start'); process.exit(2); }
  }
  console.log(JSONOUT ? JSON.stringify(r.data ?? r.text, null, 1) : r.text);
  process.exit(r.ok ? 0 : 1);
}

// ---------------- daemon ----------------
const { chromium } = createRequire(import.meta.url)('playwright');
const up = async () => { try { return (await fetch(URL0)).ok; } catch { return false; } };
if (!(await up())) { spawn('python3', ['-m', 'http.server', new globalThis.URL(URL0).port || '8787'], { cwd: ROOT, detached: true, stdio: 'ignore' }).unref(); for (let i = 0; i < 40 && !(await up()); i++) await new Promise(s => setTimeout(s, 250)); }
const ctx = await chromium.launchPersistentContext(path.join(DIR, 'profile'), { headless: true, viewport: { width: 1400, height: 900 } });
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
const pasteSettings = async (p, settings) => { await p.evaluate(() => document.querySelector('[data-act=cfgpaste]').click()); await p.fill('.modal textarea', JSON.stringify({ settings })); const txt = await p.textContent('.modal'); await p.click('.modal .primary'); return txt; };

// a turn: wait until it ends, or a step is held (pacing), or it asks something
async function settle(p, ms = 900000) {
  const t0 = Date.now();
  await p.waitForSelector('#app[data-busy]', { state: 'attached', timeout: 3000 }).catch(() => {});
  for (;;) {
    const st = await p.evaluate(() => ({ busy: document.querySelector('#app').hasAttribute('data-busy'), held: [...document.querySelectorAll('.msg[data-role=held]:not([data-done])')].map(c => c.querySelector('pre')?.textContent.slice(0, 200)), ask: !!document.querySelector('.msg[data-role=ask]:not([data-done])') }));
    if (st.held.length) return { held: st.held };
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
  ...(st.held ? st.held.map(h => 'HELD ' + h + '  (wh step | wh skip)') : st.ask ? ['ASKS a question (answer it in the page)'] : st.timeout ? ['still running (wh show / wh say later)'] : []),
  ...(r.flags.length ? r.flags.map(f => 'FLAG ' + f) : []), r.reply ? '> ' + r.reply.replace(/\n+/g, ' ⏎ ').slice(0, 400) : ''].filter(Boolean).join('\n');

const CMDS = {
  async init(a) {
    const p = await main();
    await p.evaluate(() => { const k = JSON.parse(localStorage['wh:keys'] || '{}'); k.openrouter = 'sk-or-v1-proxy-injected'; localStorage['wh:keys'] = JSON.stringify(k); }); // the proxy replaces it
    await p.reload(); await ready(p);
    await p.selectOption('#provider', 'openrouter');
    const settings = {};
    for (const [f, key] of [['m', 'model'], ['s', 'strategy'], ['w', 'watchModel'], ['p', 'pace'], ['h', 'helper']]) { const v = flagOf(a, f); if (v != null) settings[key] = v; }
    const txt = Object.keys(settings).length ? await pasteSettings(p, settings) : 'no settings given';
    const cur = (await meta(p)).settings;
    return { text: `provider openrouter (key: proxy) · model ${cur.model || '-'} · strategy ${cur.strategy || 'strat-stem-1.0 (default)'} · watch ${cur.watchModel || 'off'} · pace ${cur.pace || 'run'}${/refused/.test(txt) ? '\n' + txt.replace(/\s+/g, ' ').slice(0, 300) : ''}`, data: cur };
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
    const p = await tab(id), s0 = await sess(p, id), before = { n: s0.messages.length, l: s0.ledger.length };
    await p.fill('#input', a.join(' ')); await p.click('#send');
    const st = await settle(p);
    const r = await turnReport(p, id, before);
    return { text: fmtTurn(r, st), data: { ...r, state: st } };
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
const locks = new Map(), DRIVE = new Set(['say', 'step', 'skip', 'stem', 'fold', 'new', 'init', 'pace']);
http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d);
  req.on('end', () => {
    const { cmd, args } = JSON.parse(b || '{}');
    const ai = (args || []).indexOf('-i'), key = DRIVE.has(cmd) ? (['new', 'init', 'pace'].includes(cmd) ? '(main)' : ai >= 0 ? args[ai + 1] : readState().current) : null;
    const prev = key ? locks.get(key) || Promise.resolve() : Promise.resolve();
    const run = prev.then(async () => {
      let out;
      try { out = CMDS[cmd] ? await CMDS[cmd]([...(args || [])]) : { ok: false, text: `unknown command ${cmd} (wh help)` }; }
      catch (e) { out = { ok: false, text: 'wh: ' + String(e.message || e).split('\n')[0] }; }
      res.end(JSON.stringify({ ok: out.ok !== false, text: out.text, data: out.data }));
    });
    if (key) locks.set(key, run.catch(() => {}));
  });
}).listen(PORT, '127.0.0.1');
