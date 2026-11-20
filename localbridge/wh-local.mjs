#!/usr/bin/env node
// Local bridge: lets the WebHarness page (https://glyphharness.github.io/Web/ or a dev
// server on localhost) reach things on THIS computer, and only the things you list.
// No dependencies. Not the debug bridge (scripts/bridge.mjs): that one pairs an agent
// with the page through GitHub; this one is a loopback server the page calls directly.
//
//   node localbridge/wh-local.mjs [--port 8791]
//        [--http NAME=http://127.0.0.1:3000]...   a local web service the page may call
//        [--dir  NAME=/path/to/folder]...         a folder the page may read (not write)
//        [--exec NAME=KIND:...]...                a place commands may be run in (the shell tool's "host"); see below
//        [--exec-max N]                           commands running at once, over all targets (default 4)
//        [--origin https://other.example]...      one more page origin (default: the github.io page and localhost)
//        [--token TOKEN]                          fixed token (also WH_BRIDGE_TOKEN); default: random per run
//
// --exec is off unless given. It RUNS COMMANDS as the user you name, in the folder you name: anyone holding
// the token and an allowed page origin can run anything that user can. KIND picks the launcher:
//   local:DIR                               bash on this computer, as the user running the bridge (Linux, macOS)
//   wsl:DISTRO:USER:DIR                     a WSL user, from a bridge on Windows (wsl.exe -d DISTRO -u USER --cd DIR -e ...)
//   podman:CONTAINER:USER:DIR               a running container (podman exec -i -u USER -w DIR CONTAINER ...); docker: the same
//   wsl-podman:DISTRO:CONTAINER:USER:DIR    a container inside a WSL distro, from a bridge on Windows
//                                           (wsl.exe -d DISTRO -u root -e podman exec ...); wsl-docker: the same
// A request names only NAME, the command, optionally a folder inside DIR and a timeout. The command gets no
// stdin; it is stopped, with everything it started, when its time is up or the page gives up on the call.
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
import { spawn } from 'node:child_process';

export const PAGE_ORIGINS = ['https://glyphharness.github.io'];
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 5e6, MAX_FILE = 2e6, TIMEOUT = 30e3;
const PASS_HEADERS = ['content-type', 'accept', 'if-none-match'];

// ---- exec targets (--exec): commands run in a place the person named, never one the request names
const EXEC_SECONDS = { default: 120, max: 900 }, EXEC_OUT = 4e6, EXEC_AT_ONCE = 4, EXEC_GRACE = 4000;
// A launcher is how the bridge reaches bash in a target: the flag's fields (the folder last) and the argv
// that goes in front of "bash". here: the target is this computer, so the folder is a real path on it.
const engine = (bin, viaWsl) => ({
  fields: [...(viaWsl ? ['distro'] : []), 'container', 'user', 'dir'],
  argv: (t, cwd) => [...(viaWsl ? ['wsl.exe', '-d', t.distro, '-u', 'root', '-e'] : []), bin, 'exec', '-i', '-u', t.user, '-w', cwd, t.container],
});
export const LAUNCHERS = {
  local: { fields: ['dir'], here: true, argv: () => [] },
  wsl: { fields: ['distro', 'user', 'dir'], argv: (t, cwd) => ['wsl.exe', '-d', t.distro, '-u', t.user, '--cd', cwd, '-e'] },
  podman: engine('podman', false), docker: engine('docker', false),
  'wsl-podman': engine('podman', true), 'wsl-docker': engine('docker', true),
};
// "KIND:FIELD:...:DIR" (or the same as an object) -> {kind, ...fields}; the folder takes the rest, so it may hold colons
export function parseExec(spec) {
  if (spec && typeof spec === 'object') spec = [spec.kind, ...(LAUNCHERS[spec.kind]?.fields || []).map(f => spec[f] ?? '')].join(':');
  const s = String(spec ?? ''), i = s.indexOf(':'), kind = i < 0 ? s : s.slice(0, i), L = Object.hasOwn(LAUNCHERS, kind) ? LAUNCHERS[kind] : null;
  if (!L) throw new Error(`unknown launcher "${kind}" (one of ${Object.keys(LAUNCHERS).join(', ')})`);
  const shape = `${kind}:${L.fields.map(f => f.toUpperCase()).join(':')}`, parts = i < 0 ? [] : s.slice(i + 1).split(':'), n = L.fields.length;
  if (parts.length < n) throw new Error(`${shape} expected, got "${s}"`);
  const t = { kind };
  [...parts.slice(0, n - 1), parts.slice(n - 1).join(':')].forEach((v, k) => { t[L.fields[k]] = v; });
  for (const f of L.fields) {
    if (!t[f]) throw new Error(`${shape}: ${f} is empty`);
    if (f !== 'dir' && !/^\w[\w.-]{0,63}$/.test(t[f])) throw new Error(`${shape}: ${f} "${t[f]}": letters, digits, . - and _ only`);
  }
  if (t.dir.includes('\0') || (!L.here && !t.dir.startsWith('/'))) throw new Error(`${shape}: the folder is an absolute path inside the target`);
  return t;
}
// What bash in the target is fed on stdin. Its first line reads the rest (the command, byte for byte: nothing is
// quoted on a command line, so nothing is mangled), puts it in a file and runs that with no stdin, both streams as
// one, as a job of its own (set -m: its own process group), and says the group's id on stderr after a one-time
// mark, so the bridge can stop the whole group inside the target; stopping the launcher's client would not.
const BOOT = mark => `IFS= read -r -d '' c; f=$(mktemp) || exit 125; printf %s "$c" > "$f"; set -m; bash "$f" </dev/null 2>&1 & p=$!; echo "${mark} $p" >&2; wait $p; s=$?; rm -f "$f"; exit $s\n`;
const STOP = pg => `kill -TERM -- -${pg} 2>/dev/null; sleep 1; kill -KILL -- -${pg} 2>/dev/null; exit 0\n`;
// The command's environment. On this computer (local:) only what a login shell needs to start, never the bridge's own
// variables (its token, a cloud key the person happened to export). Through wsl.exe or a container client the
// launcher needs its Windows or engine environment to start, and the target does not inherit it (WSL passes only
// WSLENV's list; podman/docker exec only what -e names); the token is dropped there too.
const KEEP_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'TZ', 'USERPROFILE'];
export function commandEnv(t, env = process.env) {
  if (LAUNCHERS[t.kind]?.here) return Object.fromEntries(KEEP_ENV.filter(k => env[k] != null).map(k => [k, env[k]]));
  const e = { ...env, WSL_UTF8: '1' }; delete e.WH_BRIDGE_TOKEN; return e;
}
const text = b => (b.includes(0) ? b.toString('utf16le') : b.toString('utf8')); // wsl.exe's own messages can be UTF-16
const killTree = p => {
  if (p.exitCode != null || p.signalCode != null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  else { try { process.kill(-p.pid, 'SIGKILL'); } catch { try { p.kill('SIGKILL'); } catch {} } }
};
// -> {code, output, timed_out, truncated, ms, note?} or {failed: why} when the launcher never got the command started
function execRun(t, cwd, cmd, seconds, outCap, signal) {
  return new Promise(resolve => {
    const L = LAUNCHERS[t.kind], pre = L.argv(t, cwd), t0 = Date.now(), mark = randomBytes(9).toString('hex');
    // the bridge's own token never rides along in the command's environment
    const env = commandEnv(t);
    const opts = { cwd: L.here ? cwd : undefined, windowsHide: true, detached: process.platform !== 'win32', env };
    const launch = last => { const a = [...pre, 'bash', ...last]; return spawn(a[0], a.slice(1), { ...opts, stdio: ['pipe', 'pipe', 'pipe'] }); };
    let child, group = 0, n = 0, truncated = false, timedOut = false, stopped = false, settled = false, err = Buffer.alloc(0), hard = null;
    const out = [];
    const finish = r => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(hard); signal?.removeEventListener('abort', stop); resolve(r); };
    // inside the target first (the launcher's client is not the command); the client itself if that does not end it
    const stop = () => {
      if (stopped || settled) return; stopped = true;
      if (group) { try { const k = launch(['-s']); k.on('error', () => {}); k.stdin.on('error', () => {}); k.stdout.resume(); k.stderr.resume(); k.stdin.end(STOP(group)); } catch {} }
      hard = setTimeout(() => killTree(child), group ? EXEC_GRACE : 0);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, seconds * 1000);
    try { child = launch(['-l', '-s']); } catch (e) { return finish({ failed: String(e.message || e) }); }
    child.on('error', e => finish({ failed: e.code === 'ENOENT' ? `${pre[0] || 'bash'} was not found on this computer` : String(e.message || e) }));
    child.stdin.on('error', () => {});
    child.stdout.on('data', d => { if (n >= outCap) { truncated = true; return; } if (n + d.length > outCap) { d = d.subarray(0, outCap - n); truncated = true; } out.push(d); n += d.length; });
    child.stderr.on('data', d => { if (err.length < 65536) err = Buffer.concat([err, d]); if (!group) { const m = new RegExp(mark + ' (\\d+)').exec(text(err)); if (m) group = Number(m[1]); } });
    child.on('close', code => {
      const said = text(err).replace(new RegExp('^.*' + mark + ' \\d+\\r?\\n?', 'm'), '').trim().slice(0, 2000);
      if (!group && !stopped) return finish({ failed: said || `the launcher ended with status ${code} before the command started` });
      finish({ code, output: Buffer.concat(out).toString('utf8'), timed_out: timedOut, truncated, ms: Date.now() - t0, ...(said ? { note: said } : {}) });
    });
    signal?.addEventListener('abort', stop);
    child.stdin.end(BOOT(mark) + cmd);
  });
}

export function parseArgs(argv) {
  const o = { port: 8791, http: {}, dir: {}, exec: {}, origins: [], token: process.env.WH_BRIDGE_TOKEN || '' };
  const kv = (flag, v) => { const i = String(v ?? '').indexOf('='); if (i < 1) throw new Error(`${flag} NAME=VALUE expected, got "${v ?? ''}"`); return [v.slice(0, i), v.slice(i + 1)]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--port') o.port = Number(next());
    else if (a === '--http') { const [n, v] = kv(a, next()); o.http[n] = v; }
    else if (a === '--dir') { const [n, v] = kv(a, next()); o.dir[n] = v; }
    else if (a === '--exec') { const [n, v] = kv(a, next()); if (!/^[\w-]{1,32}$/.test(n)) throw new Error(`exec target name "${n}": letters, digits, - and _ only`); try { o.exec[n] = parseExec(v); } catch (e) { throw new Error(`--exec ${n}: ${e.message}`); } }
    else if (a === '--exec-max') { o.execMax = Number(next()); if (!Number.isInteger(o.execMax) || o.execMax < 1 || o.execMax > 64) throw new Error('--exec-max is a whole number from 1 to 64'); }
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

// start({port, http, dir, exec, execMax, execOut, origins, token}) -> {server, port, token, url}; port 0 picks a free one (tests).
export async function start(opts = {}) {
  const o = { port: 8791, http: {}, dir: {}, exec: {}, origins: [], ...opts };
  // exec targets as the person gave them; a local one must be a folder that exists on this computer
  const targets = {}, atOnce = o.execMax || EXEC_AT_ONCE, outCap = o.execOut || EXEC_OUT;
  let running = 0;
  for (const [n, v] of Object.entries(o.exec)) {
    if (!/^[\w-]{1,32}$/.test(n)) throw new Error(`exec target name "${n}": letters, digits, - and _ only`);
    const t = targets[n] = parseExec(v);
    if (LAUNCHERS[t.kind].here) {
      if (process.platform === 'win32') throw new Error(`--exec ${n}: local runs bash on the bridge's own computer (Linux, macOS); on Windows use wsl:DISTRO:USER:DIR or wsl-podman:DISTRO:CONTAINER:USER:DIR`);
      t.dir = await fsp.realpath(path.resolve(t.dir));
    }
  }
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

      if (url.pathname === '/info') return send(200, { name: 'wh-local', v: 1, http: Object.fromEntries(Object.entries(o.http).map(([n, v]) => [n, new URL(v).origin])), dirs: Object.keys(roots), limits: { body: MAX_BODY, file: MAX_FILE, timeoutMs: TIMEOUT }, exec: Object.keys(targets), execLimits: { seconds: EXEC_SECONDS.max, output: outCap, atOnce } });

      let m;
      if ((m = /^\/exec\/([\w-]+)$/.exec(url.pathname))) {
        const t = Object.hasOwn(targets, m[1]) ? targets[m[1]] : null;
        if (!t) return send(404, { error: `no such target "${m[1]}"`, targets: Object.keys(targets) });
        if (req.method !== 'POST') return send(405, { error: 'a command is run with POST' });
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n <= MAX_BODY) chunks.push(c); } // read to the end, keep no more than the cap
        if (n > MAX_BODY) return send(413, { error: 'request body too large' });
        let a; try { a = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'the body is JSON: {cmd, cwd?, timeout?}' }); }
        // the request names the command, a folder inside the target's and a time; who runs it and where is the person's flag
        if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => !['cmd', 'cwd', 'timeout'].includes(k))) return send(400, { error: 'only cmd, cwd and timeout are accepted' });
        if (typeof a.cmd !== 'string' || !a.cmd || a.cmd.includes('\0')) return send(400, { error: 'cmd is the command text' });
        if (a.timeout != null && !(typeof a.timeout === 'number' && Number.isFinite(a.timeout))) return send(400, { error: 'timeout is a number of seconds' });
        const rel = a.cwd == null ? '' : a.cwd;
        // it reaches the launcher's command line (wsl.exe --cd, podman -w): plain characters only, never a leading -
        if (typeof rel !== 'string' || rel.length > 1024 || (rel && !/^[\w.][\w./-]*$/.test(rel)) || rel.split('/').includes('..')) return send(400, { error: 'cwd is a path inside the target\'s folder (relative; letters, digits, . _ - and /; no ..)' });
        let cwd = t.dir;
        if (rel) {
          if (!LAUNCHERS[t.kind].here) cwd = path.posix.join(t.dir, rel);
          else { try { cwd = await fsp.realpath(path.resolve(t.dir, rel)); } catch { return send(400, { error: 'cwd does not exist in the target\'s folder' }); } if (cwd !== t.dir && !cwd.startsWith(t.dir + path.sep)) return send(400, { error: 'cwd is outside the target\'s folder' }); }
        }
        if (running >= atOnce) return send(429, { error: `${running} commands are already running; the limit is ${atOnce}` });
        const seconds = Math.min(Math.max(a.timeout || EXEC_SECONDS.default, 1), EXEC_SECONDS.max);
        const gone = new AbortController();
        res.on('close', () => { if (!res.writableEnded) gone.abort(); }); // the page gave up: stop the command too
        running++;
        let r; try { r = await execRun(t, cwd, a.cmd, seconds, outCap, gone.signal); } finally { running--; }
        if (r.failed) return send(502, { error: 'the launcher could not start the command', detail: r.failed, target: m[1] });
        return send(200, r);
      }
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
      return send(404, { error: 'unknown path', paths: ['/health', '/info', '/http/NAME/...', '/file/NAME/...', '/exec/NAME'] });
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
    for (const [n, t] of Object.entries(o.exec)) console.log(`exec ${n} -> ${t.kind}: commands run as ${t.user || 'the user running this bridge'} in ${t.dir}${t.container ? ' of container ' + t.container : ''}${t.distro ? ' (WSL ' + t.distro + ')' : ''}`);
    if (Object.keys(o.exec).length) console.log('exec is on: a page holding the token can run any command as the users above.');
    if (!Object.keys(o.http).length && !Object.keys(o.dir).length && !Object.keys(o.exec).length) console.log('nothing is exposed yet: add --http NAME=URL, --dir NAME=PATH and/or --exec NAME=KIND:...');
    console.log('In the page: Settings > Local bridge: this URL and token. Stop with Ctrl+C.');
  }).catch(e => { console.error('wh-local: ' + (e.code === 'EADDRINUSE' ? `port ${o.port} is in use (another bridge running? try --port)` : e.message)); process.exit(1); });
}
