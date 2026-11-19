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
  check('tools: local_* without a bridge says so', /No local bridge is configured/.test(await call('local_info', {}, null)));
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
