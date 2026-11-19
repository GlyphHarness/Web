#!/usr/bin/env node
// Local bridge: lets the WebHarness page (https://glyphharness.github.io/Web/ or a dev
// server on localhost) reach things on THIS computer, and only the things you list.
// No dependencies. Not the debug bridge (scripts/bridge.mjs): that one pairs an agent
// with the page through GitHub; this one is a loopback server the page calls directly.
//
//   node localbridge/wh-local.mjs [--port 8791]
//        [--http NAME=http://127.0.0.1:3000]...   a local web service the page may call
//        [--dir  NAME=/path/to/folder]...         a folder the page may read (not write)
//        [--origin https://other.example]...      one more page origin (default: the github.io page and localhost)
//        [--token TOKEN]                          fixed token (also WH_BRIDGE_TOKEN); default: random per run
//
// The token is printed at start. In the page: Settings, "Local bridge": the URL printed
// here, and the token (or a keys block: {"keys": {"localbridge": "..."}}).
//
// What protects it: it listens on 127.0.0.1 only; every call but /health needs the
// bearer token; the Origin must be an allowed page; the Host must be loopback (DNS
// rebinding); an --http target must itself be loopback; files are read-only, inside the
// listed folders (symlinks that leave them are refused), size-capped.
// Chrome asks the person once before an https page may reach localhost ("local network
// access"); the preflight answer below is what lets that request through.
import http from 'node:http';
import { createReadStream, promises as fsp } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PAGE_ORIGINS = ['https://glyphharness.github.io'];
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 5e6, MAX_FILE = 2e6, TIMEOUT = 30e3;
const PASS_HEADERS = ['content-type', 'accept', 'if-none-match'];

export function parseArgs(argv) {
  const o = { port: 8791, http: {}, dir: {}, origins: [], token: process.env.WH_BRIDGE_TOKEN || '' };
  const kv = (flag, v) => { const i = String(v ?? '').indexOf('='); if (i < 1) throw new Error(`${flag} NAME=VALUE expected, got "${v ?? ''}"`); return [v.slice(0, i), v.slice(i + 1)]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--port') o.port = Number(next());
    else if (a === '--http') { const [n, v] = kv(a, next()); o.http[n] = v; }
    else if (a === '--dir') { const [n, v] = kv(a, next()); o.dir[n] = v; }
    else if (a === '--origin') o.origins.push(next().replace(/\/+$/, ''));
    else if (a === '--token') o.token = next();
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('--port is a port number');
  for (const [n, v] of Object.entries(o.http)) {
    if (!/^[\w-]{1,32}$/.test(n)) throw new Error(`target name "${n}": letters, digits, - and _ only`);
    let u; try { u = new URL(v); } catch { throw new Error(`--http ${n}: not a URL`); }
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw new Error(`--http ${n}: only http on this computer (localhost, 127.0.0.1, [::1])`);
  }
  for (const n of Object.keys(o.dir)) if (!/^[\w-]{1,32}$/.test(n)) throw new Error(`folder name "${n}": letters, digits, - and _ only`);
  return o;
}

// start({port, http, dir, origins, token}) -> {server, port, token, url}; port 0 picks a free one (tests).
export async function start(opts = {}) {
  const o = { port: 8791, http: {}, dir: {}, origins: [], ...opts };
  const token = o.token || randomBytes(24).toString('base64url');
  const tokenBuf = Buffer.from(token);
  const origins = new Set([...PAGE_ORIGINS, ...o.origins]);
  const roots = {};
  for (const [n, d] of Object.entries(o.dir)) roots[n] = await fsp.realpath(path.resolve(d));
  const originOk = x => !x || origins.has(x) || LOOPBACK_ORIGIN.test(x);
  let port = o.port;

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const send = (status, body, extra = {}) => {
      const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
      res.writeHead(status, { 'content-type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors(), ...extra });
      res.end(b);
    };
    const cors = () => origin && originOk(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-expose-headers': 'x-wh-status, x-wh-content-type, x-wh-size, content-type' } : {};
    try {
      // DNS rebinding: a name that resolves to 127.0.0.1 is not the loopback address the page was told
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'host not allowed' });
      if (!originOk(origin)) return send(403, { error: 'origin not allowed', origin });
      const url = new URL(req.url, 'http://x');

      if (req.method === 'OPTIONS') {
        const h = { ...cors(), 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, accept, if-none-match', 'access-control-max-age': '600' };
        if (req.headers['access-control-request-private-network'] === 'true') h['access-control-allow-private-network'] = 'true';
        res.writeHead(204, h); return res.end();
      }
      if (url.pathname === '/health') return send(200, { ok: true, name: 'wh-local', v: 1 });

      const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) return send(401, { error: 'token missing or wrong' });

      if (url.pathname === '/info') return send(200, { name: 'wh-local', v: 1, http: Object.fromEntries(Object.entries(o.http).map(([n, v]) => [n, new URL(v).origin])), dirs: Object.keys(roots), limits: { body: MAX_BODY, file: MAX_FILE, timeoutMs: TIMEOUT } });

      let m;
      if ((m = /^\/http\/([\w-]+)(\/.*)?$/.exec(url.pathname))) {
        const base = o.http[m[1]];
        if (!base) return send(404, { error: `no such target "${m[1]}"`, targets: Object.keys(o.http) });
        const target = new URL((m[2] || '/') + url.search, base);
        if (target.origin !== new URL(base).origin) return send(400, { error: 'target escaped its origin' });
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > MAX_BODY) return send(413, { error: 'request body too large' }); chunks.push(c); }
        const headers = {}; for (const h of PASS_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT);
        let r;
        try { r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks), signal: ctl.signal, redirect: 'manual' }); }
        catch (e) { clearTimeout(timer); return send(502, { error: ctl.signal.aborted ? 'the local service did not answer in time' : `the local service is not reachable: ${e.cause?.code || e.message}`, target: m[1] }); }
        const buf = Buffer.from(await r.arrayBuffer()); clearTimeout(timer);
        if (buf.length > MAX_BODY) return send(502, { error: 'response too large' });
        // the target's status travels in a header and the call itself is 200, so a 404 from the service is not mistaken for a bridge error
        return send(200, buf, { 'x-wh-status': String(r.status), 'x-wh-content-type': r.headers.get('content-type') || '', 'content-type': r.headers.get('content-type') || 'application/octet-stream' });
      }

      if ((m = /^\/file\/([\w-]+)(\/.*)?$/.exec(url.pathname))) {
        const root = roots[m[1]];
        if (!root) return send(404, { error: `no such folder "${m[1]}"`, dirs: Object.keys(roots) });
        let rel; try { rel = decodeURIComponent(m[2] || '/'); } catch { return send(400, { error: 'bad path' }); }
        if (rel.includes('\0')) return send(400, { error: 'bad path' });
        const want = path.resolve(root, '.' + rel);
        let real; try { real = await fsp.realpath(want); } catch { return send(404, { error: 'not found' }); }
        if (real !== root && !real.startsWith(root + path.sep)) return send(403, { error: 'outside the listed folder' });
        const st = await fsp.stat(real);
        if (st.isDirectory()) {
          const names = await fsp.readdir(real, { withFileTypes: true });
          return send(200, { path: rel, entries: names.slice(0, 500).map(d => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })), truncated: names.length > 500 });
        }
        if (req.method !== 'GET') return send(405, { error: 'files are read-only' });
        if (st.size > MAX_FILE) return send(413, { error: `file is ${st.size} bytes; the limit is ${MAX_FILE}` });
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'x-wh-size': String(st.size), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors() });
        return createReadStream(real).pipe(res);
      }
      return send(404, { error: 'unknown path', paths: ['/health', '/info', '/http/NAME/...', '/file/NAME/...'] });
    } catch (e) { try { send(500, { error: String(e.message || e) }); } catch { res.destroy(); } }
  });

  await new Promise((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok); });
  port = server.address().port;
  return { server, port, token, url: `http://127.0.0.1:${port}`, close: () => new Promise(ok => { server.closeAllConnections?.(); server.close(ok); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error('wh-local: ' + e.message); process.exit(2); }
  start(o).then(b => {
    console.log(`wh-local listening on ${b.url}  (127.0.0.1 only)`);
    console.log(`token: ${b.token}`);
    console.log(`pages allowed: ${[...PAGE_ORIGINS, ...o.origins].join(', ')}, and http://localhost`);
    for (const [n, v] of Object.entries(o.http)) console.log(`http ${n} -> ${v}`);
    for (const [n, v] of Object.entries(o.dir)) console.log(`dir  ${n} -> ${path.resolve(v)} (read-only)`);
    if (!Object.keys(o.http).length && !Object.keys(o.dir).length) console.log('nothing is exposed yet: add --http NAME=URL and/or --dir NAME=PATH');
    console.log('In the page: Settings > Local bridge: this URL and token. Stop with Ctrl+C.');
  }).catch(e => { console.error('wh-local: ' + (e.code === 'EADDRINUSE' ? `port ${o.port} is in use (another bridge running? try --port)` : e.message)); process.exit(1); });
}
