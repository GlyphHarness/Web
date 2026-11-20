// Local bridge: localbridge/wh-local.mjs (the server the person runs) and app/localbridge.js (the page's client).
// Node only; no browser. Starts the real bridge on a free port with a throwaway web service and folder.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, parseArgs } from '../localbridge/wh-local.mjs';
import { client, check as bridgeCheck, explain, normalizeUrl, urlOk, run as lbRun, KEY_ID, BridgeError } from '../app/localbridge.js';
import * as config from '../app/config.js';
import { defsFor, execTool } from '../app/tools.js';
import * as prof from '../app/profiles.js';
// exec targets, the host shell and the identifying terms: read as namespaces so a missing export is a failed check, not a crash
import * as bridgeMod from '../localbridge/wh-local.mjs';
import * as lbMod from '../app/localbridge.js';
import { buildRequest } from '../app/context.js';
const neutralMod = await import('../app/neutral.js').catch(() => null);

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) fails++; };

// ---- the things on "this computer": a web service and a folder
const seen = [];
const svc = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, body, ctype: req.headers['content-type'], auth: req.headers.authorization, cookie: req.headers.cookie });
    if (req.url.startsWith('/missing')) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('nope'); }
    if (req.url.startsWith('/bin')) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from([0, 1, 2, 255])); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ echo: req.url, method: req.method, body }));
  });
});
await new Promise(ok => svc.listen(0, '127.0.0.1', ok));
const svcUrl = `http://127.0.0.1:${svc.address().port}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-local-'));
const notes = path.join(tmp, 'notes'), secret = path.join(tmp, 'secret');
fs.mkdirSync(path.join(notes, 'sub'), { recursive: true }); fs.mkdirSync(secret);
fs.writeFileSync(path.join(notes, 'todo.md'), '# todo\n- one\n');
fs.writeFileSync(path.join(notes, 'sub', 'a.txt'), 'inside');
fs.writeFileSync(path.join(notes, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
fs.writeFileSync(path.join(notes, 'big.txt'), 'x'.repeat(2e6 + 10));
fs.writeFileSync(path.join(secret, 'key.txt'), 'TOP-SECRET');
let linked = false;
try { fs.symlinkSync(secret, path.join(notes, 'escape'), 'junction'); linked = true; } catch {}

const TOKEN = 'test-token-' + 'abcd1234'.repeat(3);
const b = await start({ port: 0, token: TOKEN, http: { app: svcUrl }, dir: { notes } });
const PAGE = 'https://glyphharness.github.io';

// raw request, so Origin and Host can be set freely
const raw = (p, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, no) => {
  const r = http.request({ host: '127.0.0.1', port: b.port, path: p, method, headers }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  r.on('error', no); if (body) r.write(body); r.end();
});
const auth = { authorization: 'Bearer ' + TOKEN };

try {
  // ---- server: entry points and protection
  check('starts on loopback with the given token', b.url === `http://127.0.0.1:${b.port}` && b.token === TOKEN);
  let r = await raw('/health', { headers: { origin: PAGE } });
  check('/health answers without a token', r.status === 200 && JSON.parse(r.body).name === 'wh-local');
  check('health: CORS allows the page origin only', r.headers['access-control-allow-origin'] === PAGE);
  r = await raw('/health', { headers: { origin: 'http://localhost:8787' } });
  check('a localhost dev page is an allowed origin', r.headers['access-control-allow-origin'] === 'http://localhost:8787');

  r = await raw('/info', { method: 'OPTIONS', headers: { origin: PAGE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization', 'access-control-request-private-network': 'true' } });
  check('preflight: 204 with Private Network Access allowed', r.status === 204 && r.headers['access-control-allow-private-network'] === 'true' && /authorization/.test(r.headers['access-control-allow-headers']), JSON.stringify(r.headers));
  r = await raw('/info', { method: 'OPTIONS', headers: { origin: PAGE } });
  check('preflight without the PNA request does not claim it', r.status === 204 && !r.headers['access-control-allow-private-network']);

  r = await raw('/health', { headers: { origin: 'https://evil.example' } });
  check('another origin is refused (403, no CORS grant)', r.status === 403 && !r.headers['access-control-allow-origin']);
  r = await raw('/info', { headers: { ...auth, origin: 'https://evil.example' } });
  check('another origin is refused even with the token', r.status === 403);
  r = await raw('/info', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-private-network': 'true' } });
  check('preflight from another origin is refused', r.status === 403 && !r.headers['access-control-allow-private-network']);
  r = await raw('/health', { headers: { host: 'rebind.attacker.example:' + b.port } });
  check('a non-loopback Host (DNS rebinding) is refused', r.status === 403);

  r = await raw('/info', { headers: { origin: PAGE } });
  check('no token: 401', r.status === 401);
  r = await raw('/info', { headers: { origin: PAGE, authorization: 'Bearer wrong' } });
  check('wrong token: 401', r.status === 401);
  r = await raw('/info', { headers: { origin: PAGE, authorization: 'Bearer ' + TOKEN + 'x' } });
  check('a longer token: 401', r.status === 401);
  r = await raw('/info', { headers: { origin: PAGE, ...auth } });
  const info = JSON.parse(r.body);
  check('info lists targets as origins and folders by name, not paths', r.status === 200 && info.http.app === svcUrl && info.dirs[0] === 'notes' && !r.body.includes(tmp.replace(/\\/g, '\\\\')) && !r.body.includes(notes));
  r = await raw('/nothing', { headers: auth });
  check('unknown path: 404', r.status === 404);

  // ---- proxy
  r = await raw('/http/app/hello?x=1&y=two', { headers: { ...auth, origin: PAGE, cookie: 'sid=1' } });
  check('proxy GET: path and query reach the service', r.status === 200 && JSON.parse(r.body).echo === '/hello?x=1&y=two' && r.headers['x-wh-status'] === '200');
  check('proxy: the page\'s cookie and token are not forwarded', seen.at(-1).cookie === undefined && seen.at(-1).auth === undefined, JSON.stringify(seen.at(-1)));
  check('proxy: status headers are readable cross-origin', /x-wh-status/.test(r.headers['access-control-expose-headers']) && /x-wh-size/.test(r.headers['access-control-expose-headers']));
  r = await raw('/http/app/api/items', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"a":1}' });
  check('proxy POST: body and content-type reach the service', r.status === 200 && seen.at(-1).method === 'POST' && seen.at(-1).body === '{"a":1}' && seen.at(-1).ctype === 'application/json');
  r = await raw('/http/app/missing/thing', { headers: auth });
  check('the service\'s own 404 is passed through in x-wh-status, the call itself is 200', r.status === 200 && r.headers['x-wh-status'] === '404' && r.body === 'nope');
  r = await raw('/http/nope/x', { headers: auth });
  check('unknown service name: 404 listing the known ones', r.status === 404 && JSON.parse(r.body).targets[0] === 'app');
  r = await raw('/http/app//evil.example/x', { headers: auth });
  check('a path cannot leave the target origin', r.status === 200 && seen.at(-1).url === '//evil.example/x' || r.status === 400);
  const dead = await start({ port: 0, token: TOKEN, http: { gone: 'http://127.0.0.1:9' } });
  r = await new Promise(ok => http.get({ host: '127.0.0.1', port: dead.port, path: '/http/gone/x', headers: auth }, res => { let t = ''; res.on('data', d => t += d); res.on('end', () => ok({ status: res.statusCode, body: t })); }));
  await dead.close();
  check('service not running: 502 saying so', r.status === 502 && /not reachable/.test(r.body), r.body);

  // ---- files
  r = await raw('/file/notes/todo.md', { headers: auth });
  check('file read', r.status === 200 && r.body === '# todo\n- one\n' && r.headers['x-wh-size'] === '13');
  r = await raw('/file/notes/sub/a.txt', { headers: auth });
  check('file read in a subfolder', r.body === 'inside');
  r = await raw('/file/notes/', { headers: auth });
  const list = JSON.parse(r.body);
  check('folder listing', r.status === 200 && list.entries.some(e => e.name === 'sub' && e.type === 'dir') && list.entries.some(e => e.name === 'todo.md' && e.type === 'file'));
  for (const bad of ['/file/notes/../secret/key.txt', '/file/notes/%2e%2e/secret/key.txt', '/file/notes/..%2fsecret%2fkey.txt', '/file/notes/sub/../../secret/key.txt', '/file/notes/%2e%2e%5csecret%5ckey.txt']) {
    r = await raw(bad, { headers: auth });
    check('traversal refused: ' + bad, !r.body.includes('TOP-SECRET') && r.status >= 400, r.status + ' ' + r.body.slice(0, 60));
  }
  r = await raw('/file/notes/todo.md%00.txt', { headers: auth });
  check('NUL in a path refused', r.status >= 400 && !r.body.includes('# todo'));
  if (linked) {
    r = await raw('/file/notes/escape/key.txt', { headers: auth });
    check('a link that leaves the folder is refused', r.status === 403 && !r.body.includes('TOP-SECRET'), r.status + '');
  } else console.log('SKIP symlink escape (links not permitted here)');
  r = await raw('/file/notes/big.txt', { headers: auth });
  check('a file over the cap: 413', r.status === 413);
  r = await raw('/file/notes/todo.md', { method: 'POST', headers: auth, body: 'x' });
  check('files are read-only', r.status === 405 && fs.readFileSync(path.join(notes, 'todo.md'), 'utf8') === '# todo\n- one\n');
  r = await raw('/file/other/x', { headers: auth });
  check('unknown folder name: 404', r.status === 404);
  r = await raw('/file/notes/nothere.txt', { headers: auth });
  check('missing file: 404', r.status === 404);

  // ---- the page's client
  const c = client({ url: b.url, token: TOKEN });
  check('client: health and info', (await c.health()).ok && (await c.info()).dirs.includes('notes'));
  let o = await c.http('app', { path: '/a/b?q=1' });
  check('client: http returns the service status and text', o.status === 200 && JSON.parse(o.text).echo === '/a/b?q=1' && /json/.test(o.type));
  o = await c.http('app', { path: '/missing' });
  check('client: the service\'s 404 is a result, not an error', o.status === 404 && o.text === 'nope');
  o = await c.http('app', { path: '/bin' });
  check('client: binary comes back as bytes, not text', o.status === 200 && o.bytes === 4 && o.text === null);
  o = await c.read('notes', '/todo.md');
  check('client: read a file', o.text === '# todo\n- one\n' && !o.list);
  o = await c.read('notes', '/sub');
  check('client: read on a folder lists it', o.list?.entries?.[0]?.name === 'a.txt');
  o = await c.read('notes', '/blob.bin');
  check('client: a binary file is not shown as text', o.text === null && o.bytes === 4);
  check('client: a path with spaces and a hash is encoded', await c.read('notes', '/a b#c').then(() => false, e => e instanceof BridgeError && /not found/.test(e.message)));
  check('client: wrong token says so', await client({ url: b.url, token: 'nope' }).info().then(() => false, e => e.kind === 'token' && /token/.test(e.message)));
  check('client: unknown folder is a refused result', await c.read('zzz', '/x').then(() => false, e => e.kind === 'refused' && /no such folder/.test(e.message)));

  // model-facing formatters and the tools
  check('run.http formats status and body', /^\[200 application\/json, \d+ bytes\]\n/.test(await lbRun.http(c, { service: 'app', path: '/z' })));
  check('run.http sends an object body as JSON', (await lbRun.http(c, { service: 'app', method: 'post', path: '/j', body: { k: 1 } }), seen.at(-1).ctype === 'application/json' && seen.at(-1).body === '{"k":1}'));
  check('run.read lists folders with a slash on directories', (await lbRun.read(c, { folder: 'notes' })).split('\n').includes('sub/'));
  check('run.info names services and folders', /"app"/.test(await lbRun.info(c)) && /"notes"/.test(await lbRun.info(c)));
  const call = (name, args, local) => execTool({ function: { name, arguments: JSON.stringify(args) } }, { local, pads: [], by: () => ({}) });
  check('tools: local_read through execTool', (await call('local_read', { folder: 'notes', path: '/todo.md' }, c)).includes('- one'));
  // spec change (host-shell work): this check pinned the words "No local bridge is configured", which name the bridge to the model;
  // the goal is now that no model-visible text does. What stays checked: the call is answered as not available ("No ..." is a failed call in the trail).
  check('tools: local_* with nothing configured says so', /^No /.test(await call('local_info', {}, null)));
  check('tools: local_http bridge errors come back as Tool error', /^Tool error: /.test(await call('local_http', { service: 'nope', path: '/' }, c)));
  check('tools: offered only when the session has the local tool group', !defsFor({ tools: [] }).some(d => /^local_/.test(d.function.name)) && defsFor({ tools: ['local'] }).filter(d => /^local_/.test(d.function.name)).length === 3);
  check('profile caps: local can be narrowed away', prof.allowedTool('local_http', { local: true }) === true && !prof.allowedTool('local_http', { local: false }));

  // status line
  let s = await bridgeCheck({ url: b.url, token: TOKEN });
  check('status: connected, lists services and folders', s.ok && /Connected/.test(s.text) && /app/.test(s.text) && /notes/.test(s.text), s.text);
  s = await bridgeCheck({ url: b.url, token: '' });
  check('status: running but no token', !s.ok && /no token/.test(s.text));
  s = await bridgeCheck({ url: b.url, token: 'bad' });
  check('status: bad token explained', !s.ok && /token/.test(s.text));
  s = await bridgeCheck({ url: '', token: '' });
  check('status: off with no URL', !s.ok && /Off/.test(s.text));
  s = await bridgeCheck({ url: 'http://example.com:8791', token: TOKEN });
  check('status: a non-loopback URL is refused before any request', !s.ok && /loopback|this computer|localhost/i.test(s.text));
} finally {
  // a bridge that is not running: the page sees only "Failed to fetch"; the message must name both causes
  await b.close(); await new Promise(ok => svc.close(ok));
}
const down = await bridgeCheck({ url: b.url, token: TOKEN, fetch: async () => { throw new TypeError('Failed to fetch'); } });
check('not running or blocked: one message names both', !down.ok && /Is it running/.test(down.text) && /blocked/.test(down.text) && /Local network access/.test(down.text));
const refused = await bridgeCheck({ url: b.url, token: TOKEN });
check('real connection refused gives the same message', !refused.ok && /Is it running/.test(refused.text));
check('explain() of a bridge error is its own message', explain(new BridgeError('token', 'custom')) === 'custom');

// ---- URL rules
check('url: loopback http only', ['http://127.0.0.1:8791', 'http://localhost:3000', 'localhost:8791', '', 'http://[::1]:9'].every(urlOk));
check('url: others refused', ['https://127.0.0.1:8791', 'http://192.168.1.5:8791', 'http://example.com', 'http://127.0.0.1:8791/x', 'http://user@127.0.0.1:1', 'file:///etc', 'http://localhost.evil.example'].every(u => !urlOk(u)));
check('url: normalised', normalizeUrl('localhost:8791/') === 'http://localhost:8791' && normalizeUrl(' http://127.0.0.1:8791/ ') === 'http://127.0.0.1:8791');

// ---- command line
check('cli: options parse', (o => o.port === 9000 && o.http.app === 'http://localhost:3000' && o.dir.n === '/tmp/x' && o.origins[0] === 'https://p.example')(parseArgs(['--port', '9000', '--http', 'app=http://localhost:3000', '--dir', 'n=/tmp/x', '--origin', 'https://p.example/'])));
for (const bad of [['--http', 'app=https://localhost'], ['--http', 'app=http://example.com'], ['--http', 'x'], ['--dir', 'bad name=/x'], ['--port', '70000'], ['--nope']]) {
  let msg = ''; try { parseArgs(bad); } catch (e) { msg = e.message; }
  check('cli: refuses ' + bad.join(' '), !!msg, msg);
}

// ---- credentials: one door (the keys block); never settings, never shown whole
const KEY = 'wh-local-' + 'Qq7Zz1Xx'.repeat(3);
const cur = { settings: { provider: 'openrouter' }, policies: [], profiles: [], providers: ['openrouter'], machine: false, values: [], keys: {} };
let p = config.plan(JSON.stringify({ keys: { [KEY_ID]: KEY }, settings: { localBridge: 'http://127.0.0.1:8791' } }), cur);
check('config: the keys block accepts the bridge token, masked in the plan', p.next.keys?.[KEY_ID] === KEY && !JSON.stringify(p.changes).includes(KEY) && p.changes.some(c => c.secret) && p.refused.length === 0, JSON.stringify(p));
check('config: the bridge URL is an ordinary setting', p.next.settings.localBridge === 'http://127.0.0.1:8791');
p = config.plan(JSON.stringify({ settings: { localBridge: 'http://example.com' } }), cur);
check('config: a non-loopback bridge URL is refused', p.refused.length === 1 && !p.next.settings.localBridge);
p = config.plan(JSON.stringify({ settings: { localBridgeToken: KEY } }), cur);
check('config: the token as a setting is refused', p.refused.length === 1 && !p.next.keys && !JSON.stringify(p.next.settings).includes(KEY));
const rows = config.planImport(`local bridge token: ${KEY}\nlocal bridge url: http://localhost:8791`, { settings: {}, keys: {}, current: () => '', values: [], providers: ['openrouter'] });
check('import lines: "local bridge token" is a key, the URL a setting; the token is not echoed whole', rows.some(x => x.target?.kind === 'key' && x.target.id === KEY_ID) && rows.some(x => x.target?.kind === 'setting' && x.target.key === 'localBridge') && !JSON.stringify(rows.map(x => ({ ...x, secret: undefined }))).includes(KEY), JSON.stringify(rows.map(x => ({ ...x, secret: '…' }))));
const snap = JSON.stringify(config.snapshot({ ...cur, keys: { [KEY_ID]: KEY }, settings: { ...cur.settings, localBridge: 'http://127.0.0.1:8791' } }));
check('copy config: carries the bridge URL, never the token', !snap.includes(KEY) && snap.includes('127.0.0.1:8791'));

// ---- exec targets: commands on a host of the person's, off unless --exec is given (README "Host shell")
// A check that throws is a failed check (the exports it needs may not exist yet).
const attempt = async (name, fn) => { let ok = false, d = ''; try { const r = await fn(); if (Array.isArray(r)) { ok = !!r[0]; d = String(r[1] ?? ''); } else ok = !!r; } catch (e) { d = 'threw: ' + (e?.message || e); } check(name, ok, d); };
const rawTo = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, no) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
  r.on('error', no); if (body) r.write(body); r.end();
});
const post = (br, name, body, headers = auth) => rawTo(br.port, '/exec/' + name, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const J = r => { try { return JSON.parse(r.body); } catch { return {}; } };
const sleepMs = ms => new Promise(ok => setTimeout(ok, ms));

{
  const off = await start({ port: 0, token: TOKEN });
  await attempt('exec: off unless asked for: a bridge started without --exec runs nothing', async () => { const r = await post(off, 'dev', { cmd: 'echo hi' }); const i = J(await rawTo(off.port, '/info', { headers: auth })); return [r.status === 404 && Array.isArray(i.exec) && i.exec.length === 0, r.status + ' ' + JSON.stringify(i.exec)]; });
  await off.close();
}

await attempt('cli: --exec NAME=wsl:DISTRO:USER:DIR (a WSL user, from a bridge on Windows)', () => { const t = parseArgs(['--exec', 'dev=wsl:UbuntuBase:wh:/home/wh/work/Web']).exec.dev; return [t.kind === 'wsl' && t.distro === 'UbuntuBase' && t.user === 'wh' && t.dir === '/home/wh/work/Web', JSON.stringify(t)]; });
await attempt('cli: --exec NAME=podman:CONTAINER:USER:DIR (a container; docker is the same shape)', () => { const o = parseArgs(['--exec', 'box=podman:wh-dev:dev:/work/Web', '--exec', 'd=docker:c1:u1:/srv']).exec; return [o.box.kind === 'podman' && o.box.container === 'wh-dev' && o.box.user === 'dev' && o.box.dir === '/work/Web' && o.d.kind === 'docker' && o.d.container === 'c1', JSON.stringify(o)]; });
await attempt('cli: --exec NAME=wsl-podman:DISTRO:CONTAINER:USER:DIR (a container inside a WSL distro, from a bridge on Windows)', () => { const t = parseArgs(['--exec', 'box=wsl-podman:UbuntuBase:wh-dev:dev:/work/Web']).exec.box; return [t.kind === 'wsl-podman' && t.distro === 'UbuntuBase' && t.container === 'wh-dev' && t.user === 'dev' && t.dir === '/work/Web', JSON.stringify(t)]; });
await attempt('cli: --exec NAME=local:DIR (bash on the computer the bridge runs on)', () => { const t = parseArgs(['--exec', 'here=local:/srv/work']).exec.here; return [t.kind === 'local' && t.dir === '/srv/work', JSON.stringify(t)]; });
await attempt('cli: --exec-max N caps the commands running at once', () => parseArgs(['--exec-max', '2']).execMax === 2);
for (const bad of [['--exec', 'dev'], ['--exec', 'dev=nope:x'], ['--exec', 'dev=wsl:UbuntuBase:wh'], ['--exec', 'dev=wsl:UbuntuBase:wh:relative/dir'], ['--exec', 'bad name=local:/tmp'], ['--exec', 'dev=podman:box:dev'], ['--exec', 'dev=wsl::wh:/x'], ['--exec-max', '0']])
  await attempt('cli: refuses ' + bad.join(' '), () => { try { parseArgs(bad); return false; } catch (e) { return [!/unknown option/.test(e.message), e.message]; } });

await attempt('launchers: one small entry each; the command line comes from the flag alone', () => {
  const L = bridgeMod.LAUNCHERS, a = (k, t) => JSON.stringify(L[k].argv(t, t.dir)), is = (got, want) => got === JSON.stringify(want);
  const t = { distro: 'U', user: 'wh', container: 'box', dir: '/w' };
  const got = { wsl: a('wsl', t), podman: a('podman', t), docker: a('docker', t), wp: a('wsl-podman', t), wd: a('wsl-docker', t), local: a('local', { dir: '/w' }) };
  return [is(got.wsl, ['wsl.exe', '-d', 'U', '-u', 'wh', '--cd', '/w', '-e'])
    && is(got.podman, ['podman', 'exec', '-i', '-u', 'wh', '-w', '/w', 'box'])
    && is(got.docker, ['docker', 'exec', '-i', '-u', 'wh', '-w', '/w', 'box'])
    && is(got.wp, ['wsl.exe', '-d', 'U', '-u', 'root', '-e', 'podman', 'exec', '-i', '-u', 'wh', '-w', '/w', 'box'])
    && is(got.wd, ['wsl.exe', '-d', 'U', '-u', 'root', '-e', 'docker', 'exec', '-i', '-u', 'wh', '-w', '/w', 'box'])
    && is(got.local, []), JSON.stringify(got)];
});

// protection and request shape: a target whose launcher cannot work here, so nothing can actually run
{
  const x = await start({ port: 0, token: TOKEN, exec: { t: 'podman:no-such-box-zz:nobody:/' } });
  await attempt('exec: needs the token', async () => (await post(x, 't', { cmd: 'echo hi' }, {})).status === 401);
  await attempt('exec: another origin is refused even with the token', async () => (await post(x, 't', { cmd: 'echo hi' }, { ...auth, origin: 'https://evil.example' })).status === 403);
  await attempt('exec: only POST runs a command', async () => { const r = await rawTo(x.port, '/exec/t', { headers: auth }); return [r.status === 405, r.status]; });
  await attempt('exec: unknown target: 404 naming the known ones', async () => { const r = await post(x, 'nope', { cmd: 'echo hi' }); return [r.status === 404 && J(r).targets?.[0] === 't', r.status + ' ' + r.body]; });
  await attempt('exec: the request names only the target, the command, a relative folder and a timeout', async () => {
    const st = [];
    for (const body of ['{not json', {}, { cmd: '' }, { cmd: 'pwd', cwd: '/etc' }, { cmd: 'pwd', cwd: 'a/../../b' }, { cmd: 'echo \u0000' }, { cmd: 'id', user: 'root' }, { cmd: 'id', launcher: 'bash' }, { cmd: 'id', timeout: 'soon' }]) st.push((await post(x, 't', body)).status);
    return [st.every(s => s === 400), st.join(',')];
  });
  await attempt('exec: a body over the cap is refused', async () => (await post(x, 't', { cmd: 'x'.repeat(5e6 + 10) })).status === 413);
  await attempt('exec: info lists targets by name only (no user, folder or container)', async () => { const r = await rawTo(x.port, '/info', { headers: auth }); return [JSON.stringify(J(r).exec) === '["t"]' && !/no-such-box-zz|nobody/.test(r.body), r.body]; });
  await attempt('exec: a launcher that cannot start the command is a 502, not a result', async () => { const r = await post(x, 't', { cmd: 'echo hi' }); return [r.status === 502 && !!J(r).error && J(r).code === undefined, r.status + ' ' + r.body.slice(0, 200)]; });
  await attempt('status: the Settings check learns the shell targets', async () => { const s = await bridgeCheck({ url: x.url, token: TOKEN }); return [s.ok && s.info?.exec?.[0] === 't', JSON.stringify(s)]; });

  // what the model is told when the host cannot run a command: nothing about how it is reached; the reason is kept for the person
  const found = t => neutralMod ? neutralMod.found(String(t)) : ['(app/neutral.js is missing)'];
  const shellVia = (cl, name, args = { cmd: 'echo hi' }) => execTool({ function: { name: 'shell', arguments: JSON.stringify(args) } }, { vm: lbMod.hostShell(cl, name), pads: [], by: () => ({}) });
  for (const [what, cl, name] of [['the bridge is not running', client({ url: 'http://127.0.0.1:9', token: TOKEN }), 't'], ['the token is wrong', client({ url: x.url, token: 'nope' }), 't'], ['the target is not one of the bridge\'s', client({ url: x.url, token: TOKEN }), 'zzz'], ['the launcher fails', client({ url: x.url, token: TOKEN }), 't']]) {
    await attempt(`host shell: when ${what}, the model reads a plain failure with no identifying term`, async () => { const out = await shellVia(cl, name); return [/^Tool error: /.test(out) && found(out).length === 0, out]; });
    await attempt(`host shell: when ${what}, the reason is kept for the person`, async () => { const e = await lbMod.hostShell(cl, name).run('echo hi', 10).then(() => null, e => e); return [!!e && typeof e.detail === 'string' && e.detail.length > 10, String(e?.detail)]; });
  }
  await x.close();
}

// running for real needs a bash target: the bridge's own computer on Linux/macOS (CI), or the one named in WH_TEST_EXEC
const work = path.join(tmp, 'work'); fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
const EXEC_SPEC = process.env.WH_TEST_EXEC || (process.platform === 'win32' ? '' : 'local:' + work);
if (!EXEC_SPEC) console.log('SKIP exec run checks (no bash target on this computer; set WH_TEST_EXEC, e.g. wsl:DISTRO:USER:DIR)');
else {
  const x = await start({ port: 0, token: TOKEN, exec: { t: EXEC_SPEC }, execMax: 2, execOut: 10000 });
  const dir = process.env.WH_TEST_EXEC ? EXEC_SPEC.split(':').at(-1) : fs.realpathSync(work);
  const run = async body => { const r = await post(x, 't', body); return { status: r.status, ...J(r) }; };
  const n = () => 3000 + Math.floor(Math.random() * 6000);
  const left = async k => (await run({ cmd: `pgrep -f "[s]leep ${k}" | wc -l` })).output?.trim();
  await attempt('exec: runs the command; both streams come back as one, in order, with the exit status', async () => { const r = await run({ cmd: 'echo out; echo err >&2; echo end' }); return [r.status === 200 && r.code === 0 && r.output === 'out\nerr\nend\n' && r.timed_out === false && r.truncated === false && typeof r.ms === 'number', JSON.stringify(r)]; });
  await attempt('exec: a non-zero exit is a result', async () => { const r = await run({ cmd: 'echo nope; exit 7' }); return [r.status === 200 && r.code === 7 && r.output === 'nope\n' && r.timed_out === false, JSON.stringify(r)]; });
  await attempt('exec: the command has no stdin', async () => { const r = await run({ cmd: 'cat; echo after', timeout: 8 }); return [r.code === 0 && r.output === 'after\n' && r.timed_out === false, JSON.stringify(r)]; });
  await attempt('exec: quotes, dollars, backslashes and several lines arrive as written', async () => { const r = await run({ cmd: 'cat <<\'EOF\'\na "b" \'c\' $HOME \\ `d`\nEOF\necho $((6*7))' }); return [r.output === 'a "b" \'c\' $HOME \\ `d`\n42\n', JSON.stringify(r)]; });
  await attempt('exec: every call starts in the target\'s folder with nothing carried over', async () => { await run({ cmd: 'cd /tmp; export CARRIED=1; pwd' }); const r = await run({ cmd: 'pwd; echo ${CARRIED:-unset}' }); return [r.output === dir + '\nunset\n', JSON.stringify(r) + ' want ' + dir]; });
  if (!process.env.WH_TEST_EXEC) await attempt('exec: a relative folder inside the target', async () => { const r = await run({ cmd: 'pwd', cwd: 'sub' }); return [r.output === dir + '/sub\n', JSON.stringify(r)]; });
  await attempt('exec: a command over its time is stopped with everything it started', async () => { const k = n(), r = await run({ cmd: `sleep ${k} & sleep ${k}`, timeout: 2 }); const l = await left(k); return [r.status === 200 && r.timed_out === true && r.ms < 15000 && l === '0', JSON.stringify(r) + ' left ' + l]; });
  await attempt('exec: output over the cap is cut and marked', async () => { const r = await run({ cmd: 'head -c 50000 /dev/zero | tr \'\\0\' x; echo; echo done' }); return [r.truncated === true && r.output.length === 10000 && r.code === 0, JSON.stringify({ ...r, output: r.output?.length })]; });
  await attempt('exec: no more commands at once than the cap; the rest are refused, not queued', async () => { const st = (await Promise.all([1, 2, 3].map(() => run({ cmd: 'sleep 3' })))).map(r => r.status).sort().join(','); const after = await run({ cmd: 'echo free' }); return [st === '200,200,429' && after.output === 'free\n', st + ' ' + JSON.stringify(after)]; });
  await attempt('exec: a call the page gives up on is stopped too', async () => {
    const k = n();
    await new Promise(ok => { const q = http.request({ host: '127.0.0.1', port: x.port, path: '/exec/t', method: 'POST', headers: { ...auth, 'content-type': 'application/json' } }, () => {}); q.on('error', () => {}); q.end(JSON.stringify({ cmd: `sleep ${k}` })); setTimeout(() => { q.destroy(); ok(); }, 4000); });
    await sleepMs(5000);
    const l = await left(k); return [l === '0', 'left ' + l];
  });

  // the page's client, and the shell tool on this runner
  const c2 = client({ url: x.url, token: TOKEN });
  await attempt('client: exec returns the exit status and the output', async () => { const o = await c2.exec('t', { cmd: 'echo hi; exit 2' }); return [o.code === 2 && o.out === 'hi\n' && o.timedOut === false && o.truncated === false, JSON.stringify(o)]; });
  const sh = (args, vm) => execTool({ function: { name: 'shell', arguments: JSON.stringify(args) } }, { vm, pads: [], by: () => ({}) });
  // labelled stand-in for the in-browser machine's runner (app/vm.js through main.js): the shape the shell tool is handed there
  const machineLike = r => ({ run: async () => r });
  await attempt('shell tool: the same call reads the same on the host as on the machine', async () => { const a = await sh({ cmd: 'echo hi; exit 4' }, lbMod.hostShell(c2, 't')), b2 = await sh({ cmd: 'echo hi; exit 4' }, machineLike({ out: 'hi', code: 4 })); return [a === b2 && a === 'hi\n[exit 4]', JSON.stringify([a, b2])]; });
  await attempt('shell tool: no output reads the same', async () => { const a = await sh({ cmd: 'true' }, lbMod.hostShell(c2, 't')), b2 = await sh({ cmd: 'true' }, machineLike({ out: '', code: 0 })); return [a === b2 && a === '(no output)\n[exit 0]', JSON.stringify([a, b2])]; });
  await attempt('shell tool: a timeout reads the same', async () => { const a = await sh({ cmd: 'echo partial; sleep 300', timeout: 5 }, lbMod.hostShell(c2, 't')), b2 = await sh({ cmd: 'x', timeout: 5 }, machineLike({ out: 'partial', code: null, timedOut: true })); return [a === b2 && a === 'partial\n[timed out after 5s; interrupted]', JSON.stringify([a, b2])]; });
  await attempt('host shell: output cut at the cap is said in the output itself', async () => { const r = await lbMod.hostShell(c2, 't').run('head -c 50000 /dev/zero | tr \'\\0\' x', 30); return [r.code === 0 && r.out.length > 10000 && r.out.length < 10100 && r.out.slice(0, 10000) === 'x'.repeat(10000), JSON.stringify({ code: r.code, n: r.out.length, tail: r.out.slice(-60) })]; });
  await x.close();
}

// ---- where the shell runs is harness data: a setting (defaults, a profile, a session), never part of what the model is sent
await attempt('shell runs on: a setting resolved from the defaults, then a profile, then the session', () => {
  const ps = [{ id: 'p', name: 'p', settings: { shellOn: 'host:dev' } }];
  return prof.SETTING_KEYS.includes('shellOn') && prof.AUDIENCE.shellOn === 'harness' && prof.effective(ps, 'p', { shellOn: 'machine' }).settings.shellOn === 'host:dev'
    && prof.effective(ps, 'p', {}, { shellOn: 'machine' }).settings.shellOn === 'machine' && prof.effective([], undefined, { shellOn: 'host:box' }).settings.shellOn === 'host:box';
});
await attempt('config: shellOn takes machine or host:NAME and nothing else', () => {
  const p = v => config.plan(JSON.stringify({ settings: { shellOn: v } }), cur);
  return [p('host:dev').next.settings.shellOn === 'host:dev' && p('host:dev').refused.length === 0 && p('machine').refused.length === 0 && p('host:bad name').refused.length === 1 && p('elsewhere').refused.length === 1 && p('host:').refused.length === 1, JSON.stringify(p('host:dev'))];
});
// the tmux option's switch sits in the in-page machine's panel; a session on a host must not need that panel to use it
await attempt('config: the tmux option (vmTmux) is true or false in Paste config', () => {
  const p = v => config.plan(JSON.stringify({ settings: { vmTmux: v } }), cur);
  return [p(true).next.settings.vmTmux === true && p(true).refused.length === 0 && p(false).refused.length === 0 && p('yes').refused.length === 1, JSON.stringify(p(true))];
});

// ---- nothing the harness gives a model says what runs it (app/neutral.js: the identifying terms)
{
  const found = t => neutralMod ? neutralMod.found(String(t)) : ['(app/neutral.js is missing)'];
  await attempt('neutral: the documented terms are found, and ordinary words that contain them are not', () => [
    ['WebHarness', 'GlyphHarness', 'the harness', 'glyphharness.github.io', 'a browser', 'this page', 'another tab', 'the tabs', 'this app', 'the bridge', 'in-browser', 'cross-origin', 'service worker', 'wh-local'].every(t => neutralMod.found(t).length)
      && neutralMod.found('a table in a side pane, with pagination, on a stable machine; the application').length === 0, neutralMod.TERMS.join(' | ')]);
  // every request shape a session can have: both log forms, every core prompt level, every tool group
  // spec change (strategy wording): the neutral wording is strategy data (strat-serial-3.0); these checks now read the
  // definitions as that strategy sends them, since the strategies registered before it keep their original bytes
  const S3 = await import('../app/strategies.js').then(m => m.spec('strat-serial-3.0')), { defsAs: asSent } = await import('../app/tools.js');
  const variants = ['calls', 'notes'].flatMap(wire => [0, 1, 2, 3].flatMap(core => ['off', 'marks'].map(edge => ({ wire, core, edge, keep: true, system: '', tools: ['ask', 'values', 'repo', 'vm', 'local'], messages: [] }))));
  const hits = variants.flatMap(s => found(JSON.stringify(buildRequest(s, 'm', asSent(defsFor(s), S3.reads, S3.wording)))));
  check('neutral: no request the harness builds under strat-serial-3.0 (core prompt, every tool definition) holds an identifying term', S3.id === 'strat-serial-3.0' && hits.length === 0, S3.id + ' ' + [...new Set(hits)].join(', '));
  // the helper prompts and fixed lines kept as module data (the watcher's and the filter's prompts are checked on the page, suite main)
  const fixed = [];
  for (const [file, key] of [['../app/policy.js', 'FIX_SYSTEM'], ['../app/smells.js', 'REVIEW_SYSTEM'], ['../app/term.js', 'SCRATCH_SYSTEM'], ['../app/context.js', 'KEEP_NOTE'], ['../app/context.js', 'HANDOFF_LINE'], ['../app/values.js', 'INDEX_HEAD']])
    fixed.push(key + ': ' + String((await import(file).catch(e => ({ [key]: 'import failed: ' + e.message })))[key] ?? ''));
  const badFixed = fixed.filter(p => p.length < 40 || /import failed/.test(p) || found(p).length);
  check('neutral: helper prompts and fixed lines kept as module data hold no identifying term', badFixed.length === 0, badFixed.map(p => p.slice(0, 120) + ' [' + found(p).join(',') + ']').join(' | '));
  // what each tool answers when what it needs is not there
  const bare = { pads: [], savePads() {}, by: () => ({}), depth: 1, wording: S3.wording };
  const answers = [];
  for (const d of defsFor({ tools: ['ask', 'values', 'repo', 'vm', 'local'] }).filter(d => /^(shell|local_|repo_|concern_file|ask|value_|fan_out)/.test(d.function.name)))
    answers.push(d.function.name + ': ' + await execTool({ function: { name: d.function.name, arguments: '{}' } }, bare).catch(e => String(e)));
  const bad = answers.filter(a => found(a).length);
  check('neutral: what a tool answers when it is not set up holds no identifying term', answers.length >= 12 && bad.length === 0, bad.join(' | '));
  // local tools against a real bridge, when things go wrong
  const nb = await start({ port: 0, token: TOKEN, http: { app: 'http://127.0.0.1:9' }, dir: { notes } });
  const good = client({ url: nb.url, token: TOKEN }), viaTool = (name, args, local) => execTool({ function: { name, arguments: JSON.stringify(args) } }, { local, pads: [], by: () => ({}) });
  const outs = [
    await viaTool('local_http', { service: 'nope', path: '/' }, good), await viaTool('local_http', { service: 'app', path: '/' }, good), await viaTool('local_read', { folder: 'zzz', path: '/x' }, good),
    await viaTool('local_read', { folder: 'notes', path: '/nothere' }, good), await viaTool('local_info', {}, client({ url: nb.url, token: 'nope' })), await viaTool('local_info', {}, client({ url: 'http://127.0.0.1:9', token: TOKEN })),
  ];
  await nb.close();
  const badOuts = outs.filter(o => !/^Tool error: /.test(o) || found(o).length);
  check('neutral: local tool failures come back as tool errors with no identifying term', badOuts.length === 0, badOuts.join(' | '));
}

// ---- the neutral wording is strategy data: a registered strategy keeps the bytes it was registered with (seams: strategies.js
// register / spec, tools.js defsAs, the helper lines). strat-serial-1.0 (and every strategy registered before the wording
// changed) is sent what it was sent before aa62df3; strat-serial-2.0 is that plus ranged reads only; strat-serial-3.0 is 2.0
// plus the neutral wording. The old bytes are scripts/fixtures/model-view-pre-aa62df3.json (from git show aa62df3^:...).
{
  const OLD = JSON.parse(fs.readFileSync(new URL('./fixtures/model-view-pre-aa62df3.json', import.meta.url), 'utf8'));
  const found = t => neutralMod ? neutralMod.found(String(t)) : ['(app/neutral.js is missing)'];
  const strategies = await import('../app/strategies.js'), toolsMod = await import('../app/tools.js');
  const smellsMod = await import('../app/smells.js'), termMod = await import('../app/term.js');
  const ALL = { tools: ['ask', 'values', 'repo', 'vm', 'local'] };
  const view = id => { const sp = strategies.spec(id); return toolsMod.defsAs(defsFor(ALL), sp.reads, sp.wording); };
  const differs = (a, b) => a.filter((d, i) => JSON.stringify(d) !== JSON.stringify(b[i])).map(d => d.function.name).sort().join();
  const answer = async (name, wording) => execTool({ function: { name, arguments: '{}' } }, { pads: [], by: () => ({}), depth: 1, wording });
  for (const id of ['strat-serial-1.0', 'strat-checkpoint-1.0', 'strat-stem-1.0', 'strat-stem-2.0'])
    await attempt(`strategy wording: ${id} is sent the tool definitions it was registered with, byte for byte`, () => { const v = view(id); return [JSON.stringify(v) === JSON.stringify(OLD.defs), differs(v, OLD.defs)]; });
  await attempt('strategy wording: strat-serial-2.0 is strat-serial-1.0 plus ranged reads only (output_read, repo_read)', () => {
    const two = view('strat-serial-2.0'); return [differs(two, OLD.defs) === 'output_read,repo_read' && JSON.stringify(two) === JSON.stringify(toolsMod.defsAs(OLD.defs, 'ranged')), differs(two, OLD.defs)];
  });
  await attempt('strategy wording: strat-serial-3.0 is registered as strat-serial-2.0 plus the neutral wording', () => {
    const sp = strategies.known('strat-serial-3.0') && strategies.spec('strat-serial-3.0'), two = strategies.spec('strat-serial-2.0');
    return [!!sp && sp.reads === 'ranged' && sp.wording === 'neutral' && !two.wording && sp.stems === two.stems && JSON.stringify(sp.checkpoints) === JSON.stringify(two.checkpoints) && sp.handles === two.handles, JSON.stringify(sp)];
  });
  await attempt('strategy wording: under strat-serial-3.0 only shell, concern_file and local_* differ from 2.0, and no definition holds an identifying term', () => {
    const three = view('strat-serial-3.0'), two = view('strat-serial-2.0'); return [differs(three, two) === 'concern_file,local_http,local_info,local_read,shell' && found(JSON.stringify(three)).length === 0, differs(three, two) + ' ' + found(JSON.stringify(three))];
  });
  await attempt('strategy wording: the local tools answer as before when nothing is set up, and plainly under 3.0', async () => {
    const before = await answer('local_info'), after = await answer('local_info', strategies.spec('strat-serial-3.0').wording);
    return [before === OLD.answers.local_info && /^No /.test(after) && found(after).length === 0, JSON.stringify([before, after])];
  });
  await attempt('strategy wording: the watcher line and the scratch-helper line are the registered ones, and plain under 3.0', () => {
    const w = strategies.spec('strat-serial-3.0').wording, old = strategies.spec('strat-serial-1.0').wording;
    return [smellsMod.watchLine?.(old) === OLD.watch && termMod.scratchLine?.(old) === OLD.scratch && found(smellsMod.watchLine?.(w)).length === 0 && found(termMod.scratchLine?.(w)).length === 0 && /^WATCH\./.test(smellsMod.watchLine?.(w)) && /^TERMINAL SCRATCH\./.test(termMod.scratchLine?.(w)), String(smellsMod.watchLine?.(old)).slice(0, 80)];
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
