// Operator CLI (scripts/wh.mjs) against the mock provider: what an experiment needs from it.
// A session's system prompt, a pasted config, a message sent from a file, what is held, a
// session's records, forgetting stored keys, and a command log that holds no message text and no key.
// Needs a browser and the repo served, like the smoke suites:
//   python3 -m http.server 8787 (repo root), then: node scripts/test-wh.mjs [url]
// Env: WH_CHANNEL=chrome (or WH_CHROME=1) drives the installed Chrome.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || 'http://localhost:8787/';
const WH = fileURLToPath(new URL('./wh.mjs', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-'));
const port = await new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const channel = process.env.WH_CHANNEL || (process.env.WH_CHROME ? 'chrome' : '');
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : extra}`); if (!ok) process.exitCode = 1; };
const outs = [];
console.log(`wh test: daemon port ${port}, state directory ${dir}`);
const wh =(...a) => {
  const r = spawnSync(process.execPath, [WH, '--dir', dir, '--port', String(port), '--url', url, ...(channel ? ['--channel', channel] : []), ...a], { encoding: 'utf8', timeout: 240000 });
  const o = { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  outs.push(o.out);
  return o;
};
const json = (...a) => { const r = wh('--json', ...a); try { return { ...r, data: JSON.parse(r.out) }; } catch { return { ...r, data: null }; } };
const file = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const log = () => { try { return fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const rawLog = () => { try { return fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8'); } catch { return ''; } };

// a key shaped like a real one; it must never be printed or logged
const KEY = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);
const SYS = 'SALT zebra-quartz-17\nYou are a test assistant.\nWork in the repository o/r on the branch exp/t-blue.';
const MSG = 'first line of the brief marker-plum-42\nsecond line with "quotes", a $dollar and a `backtick`\n  indented third line';

try {
  // ---- usage text names every command ----
  const help = wh('help').out;
  check('help: the usage text lists system, paste, sayfile, held, dump, forget and log', ['system', 'paste', 'sayfile', 'held', 'dump', 'forget', 'log'].every(c => new RegExp('^\\s*wh ' + c + '\\b', 'm').test(help)), help.slice(0, 200));
  check('help: the usage text names the browser channel, headed and state directory options', /--channel/.test(help) && /--headed/.test(help) && /--dir/.test(help));

  // ---- paste: a config block from a file goes through the page's own Paste config ----
  const cfg = file('cfg.json', JSON.stringify({ webharness: 'config', keys: { openrouter: KEY }, settings: { provider: 'mock', model: 'mock-1', pace: 'run' } }));
  const pasted = json('paste', cfg);
  check('paste: the settings in the file are applied', pasted.code === 0 && pasted.data?.settings?.provider === 'mock' && pasted.data?.settings?.model === 'mock-1', pasted.out.slice(0, 300));

  // ---- system: a session's system prompt is set from a file, byte for byte ----
  const made = json('new', 'arm', 'one'), id = made.data?.id;
  check('new: a session id comes back', /^[a-z0-9]+$/i.test(id || ''), made.out.slice(0, 200));
  const sys = json('system', file('sys.txt', SYS));
  const d1 = path.join(dir, 'd1.json');
  const dumped = json('dump', '-o', d1);
  const rec1 = fs.existsSync(d1) ? JSON.parse(fs.readFileSync(d1, 'utf8')) : null;
  check('system: the session record holds the file text as its system prompt', sys.code === 0 && rec1?.system === SYS, sys.out.slice(0, 200));
  check('system: the answer gives size and hash, not the text', sys.data?.chars === SYS.length && sys.data?.hash === sha(SYS) && !sys.out.includes('zebra-quartz'), sys.out.slice(0, 200));
  check('dump: writes the session record (messages and ledger) to the named file', dumped.code === 0 && Array.isArray(rec1?.messages) && Array.isArray(rec1?.ledger) && rec1.id === id, dumped.out.slice(0, 200));

  // ---- sayfile: the bytes of a file are the message ----
  const said = json('sayfile', file('msg.txt', MSG));
  const d2 = json('dump').data?.out;
  const rec2 = d2 && fs.existsSync(d2) ? JSON.parse(fs.readFileSync(d2, 'utf8')) : { messages: [], ledger: [] };
  const first = rec2.messages.find(m => m.role === 'user');
  check('sayfile: the user message starts with the file text, line breaks and quoting kept', said.code === 0 && String(first?.content).startsWith(MSG), String(JSON.stringify(first?.content)).slice(0, 200));
  check('sayfile: the turn ran (a request in the ledger, a reply in the log)', rec2.ledger.length >= 1 && rec2.messages.some(m => m.role === 'assistant'));
  check('dump: with no file named, the record goes under the state directory', (d2 || '').startsWith(dir));

  // ---- held: what waits is listed in full ----
  wh('pace', 'tools');
  const heldTurn = wh('say', 'please use a tool');
  const held = json('held');
  check('held: a held tool call is listed with its whole text', /HELD/.test(heldTurn.out) && held.data?.held?.length === 1 && /run_js/.test(held.data.held[0]) && /return 6\*7/.test(held.data.held[0]), held.out.slice(0, 300));
  wh('step');
  const none = json('held');
  check('held: nothing is listed once the step is released', none.code === 0 && none.data?.held?.length === 0 && none.data?.approve?.length === 0, none.out.slice(0, 200));
  wh('pace', 'run');

  // ---- held: a call whose arguments are stored by handle (longer than ARG_MAX) shows what it will do ----
  // spec (red): say and step show the tool and the kept fields of the argument summary, never the handle; held prints the arguments whole.
  // (a file_edit needs a session on a host with the file tools, which wh cannot make; run_js is stored by the same seam: the mock's "long script huge")
  wh('pace', 'tools');
  const bigTurn = wh('say', 'long script huge');
  const big = json('held'), bigText = big.data?.held?.[0] || '';
  const bigLine = bigTurn.out.split('\n').find(l => /^HELD /.test(l)) || '';
  check('held: say shows a stored call as the tool and its kept fields (sizes, no text, no handle)', /^HELD run_js \{"code":\{"length":\d+,"hash":"\w+"\}/.test(bigLine) && !/"ref"|padding/.test(bigLine) && bigLine.length < 400, bigLine.slice(0, 300));
  check('held: wh held prints a stored call whole, resolved from its handle', /^run_js \{"code":"const out/.test(bigText) && bigText.includes('total=4950') && bigText.includes('padding '.repeat(700)) && bigText.endsWith('"want":"total"}') && !/"ref"/.test(bigText), bigText.slice(0, 100) + ' ... ' + bigText.slice(-60) + ` (${bigText.length})`);
  wh('step');
  wh('pace', 'run');

  // ---- forget: stored keys leave this browser profile; names only are reported ----
  const f1 = json('forget'), f2 = json('forget');
  check('forget: the key store is emptied and the answer names what was there, not its value', f1.code === 0 && f1.data?.had?.includes('openrouter') && f2.data?.had?.length === 0, f1.out.slice(0, 200));

  // ---- nudges: a continuation after a round-limit stop is told from a steering message ----
  const id2 = json('new', 'nudge', 'count').data?.id;
  wh('say', 'round after round');
  wh('say', 'continue');
  wh('say', 'now something else');
  const says = log().filter(e => e.id === id2 && e.cmd === 'say');
  check('log: the first message, a continuation after a round-limit stop and a steering message are told apart', says.map(e => e.kind).join() === 'first,limit-continuation,steer' && says[1]?.after === 'limit' && says[2]?.after === 'done', JSON.stringify(says));
  check('log: each message records how its own run stopped', says.map(e => e.stop).join() === 'limit,done,done', JSON.stringify(says.map(e => e.stop)));
  const counts = json('log', '-i', id2 || 'none').data?.counts;
  check('log: wh log counts limit continuations and steering messages separately', counts?.first === 1 && counts?.limitContinuations === 1 && counts?.steering === 1, JSON.stringify(counts));

  // ---- stop line: when say, sayfile or step returns because the run ended other than done, it says how ----
  // The mock fails 3 times with a 502 (the provider seam asks again twice, then the turn fails); the answer must name it.
  json('new', 'stops', 'one');
  const doneTurn = wh('say', 'hello there');
  check('stop: a turn that ends done prints no STOP line', doneTurn.code === 0 && !/STOP/.test(doneTurn.out) && !/ stop /.test(doneTurn.out), doneTurn.out.slice(0, 300));
  const failedTurn = wh('say', 'fail 502 x3 stopline');
  check('stop: a turn that ends failed prints a STOP line with the provider error', /^STOP failed: HTTP 502: Provider returned error$/m.test(failedTurn.out), failedTurn.out.slice(0, 400));
  const failedJson = json('say', 'fail 502 x3 stopline json');
  check('stop: in --json the stop reason and what the page said are fields', failedJson.data?.stop === 'failed' && failedJson.data?.stopDetail === 'HTTP 502: Provider returned error', failedJson.out.slice(0, 400));
  const healed = wh('say', 'fail 502 x2 stopline ok');
  check('stop: a request that succeeded on a retry is a turn that ended done, with no STOP line', healed.code === 0 && !/STOP/.test(healed.out) && /Mock reply/.test(healed.out), healed.out.slice(0, 300));
  const limitTurn = wh('say', 'round after round');
  check('stop: a turn that ends at the round limit prints a STOP line, and still says stop limit', /^STOP limit: .*tool rounds/m.test(limitTurn.out) && /stop limit/.test(limitTurn.out), limitTurn.out.slice(0, 400));
  const limitJson = json('say', 'round after round json');
  check('stop: the round limit is a field in --json too', limitJson.data?.stop === 'limit' && /tool rounds/.test(limitJson.data?.stopDetail || ''), limitJson.out.slice(0, 300));
  const fileTurn = wh('sayfile', file('fail.txt', 'fail 502 x3 stopline file'));
  check('stop: sayfile prints it as say does', /^STOP failed: HTTP 502: Provider returned error$/m.test(fileTurn.out), fileTurn.out.slice(0, 300));
  wh('pace', 'requests');
  const heldReq = wh('say', 'fail 502 x3 stopline step');
  const stepped = wh('step');
  check('stop: step prints it when the released request ends the turn failed', /HELD/.test(heldReq.out) && /^STOP failed: HTTP 502: Provider returned error$/m.test(stepped.out), stepped.out.slice(0, 400));
  wh('say', 'fail 502 x3 stopline step json');
  const steppedJson = json('step');
  check('stop: step has the stop reason and what the page said in --json', steppedJson.data?.stop === 'failed' && steppedJson.data?.stopDetail === 'HTTP 502: Provider returned error', steppedJson.out.slice(0, 300));
  wh('pace', 'run');
  wh('pace', 'tools');
  wh('say', 'round after round step');
  const steppedLimit = wh('step', '--all');
  check('stop: step --all ends at the round limit with the STOP line and stop limit', /^STOP limit: .*tool rounds/m.test(steppedLimit.out) && /stop limit/.test(steppedLimit.out), steppedLimit.out.slice(0, 400));
  wh('pace', 'run');

  // ---- the command log ----
  const L = log(), cmds = L.map(e => e.cmd);
  check('log: one JSON line per command, in order, with time, command and outcome', ['paste', 'new', 'system', 'dump', 'sayfile', 'pace', 'say', 'held', 'step', 'forget'].every(c => cmds.includes(c)) && cmds.indexOf('paste') < cmds.indexOf('system') && cmds.indexOf('system') < cmds.indexOf('sayfile') && L.every(e => e.t && e.cmd && typeof e.ok === 'boolean'), cmds.join(','));
  const eSay = L.find(e => e.cmd === 'sayfile'), eSys = L.find(e => e.cmd === 'system'), ePaste = L.find(e => e.cmd === 'paste');
  check('log: a message is recorded as session id, size and hash', eSay?.id === id && eSay?.chars === MSG.length && eSay?.hash === sha(MSG), JSON.stringify(eSay));
  check('log: a system prompt and a pasted config are recorded as size and hash', eSys?.id === id && eSys?.chars === SYS.length && eSys?.hash === sha(SYS) && ePaste?.chars > 0 && /^[0-9a-f]{12}$/.test(ePaste?.hash || ''), JSON.stringify([eSys, ePaste]));
  const raw = rawLog();
  check('log: no message text, system text or held call text is in it', !!raw && !raw.includes('marker-plum') && !raw.includes('zebra-quartz') && !raw.includes('6*7') && !raw.includes('please use a tool'));
  check('log: no key is in it', !!raw && !raw.includes(KEY) && !raw.includes(KEY.slice(9, 25)));
  check('output: no command printed the key', outs.length > 5 && !outs.some(o => o.includes(KEY) || o.includes(KEY.slice(9, 25))));
} finally {
  wh('down');
  await new Promise(r => setTimeout(r, 1500));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
