// Local bridge client: the page's way to reach things on this computer through
// localbridge/wh-local.mjs, which the person runs and which exposes only what they
// listed. Off unless a bridge URL is set in Settings and its token is in the key
// store (id "localbridge"); the token is never part of settings, exports or the trace.
//
//   const b = client({ url, token });  await b.health();  await b.info();
//   await b.http('app', { method: 'POST', path: '/api/x?y=1', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
//   await b.read('notes', '/todo.md');   await b.list('notes', '/');
//   await b.exec('dev', { cmd: 'git status --short', timeout: 120 });   an exec target (--exec dev=...): commands on a host
//   hostShell(b, 'dev').run(cmd, seconds)   the shell tool's runner on that target (same result shape as the machine's)
import { neutral } from './neutral.js';

export const KEY_ID = 'localbridge';
export const DEFAULT_URL = 'http://127.0.0.1:8791';

// Loopback only: this connector must never be pointed at another machine.
export function normalizeUrl(v) {
  v = String(v ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  let u; try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'http://' + v); } catch { return null; }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.pathname !== '/' || u.search || u.hash || u.username) return null;
  return u.origin;
}
export const urlOk = v => v === '' || normalizeUrl(v) !== null;

export class BridgeError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

// What went wrong, in words for the person. A refused connection and a browser block look the
// same to a page ("Failed to fetch"), so the message names both.
export function explain(e, url = DEFAULT_URL) {
  if (e instanceof BridgeError) return e.message;
  return `The local bridge at ${url} did not answer. Is it running (node localbridge/wh-local.mjs)? If it is, the browser may have blocked the request: allow "Local network access" for this site (the lock icon in the address bar > Site settings), and check that no extension or shield is blocking requests to localhost.`;
}

export function client({ url, token, fetch: f = globalThis.fetch } = {}) {
  const base = normalizeUrl(url);
  if (!base) throw new BridgeError('config', 'The bridge URL must be http://localhost:PORT or http://127.0.0.1:PORT.');
  const call = async (path, init = {}) => {
    let r;
    try { r = await f(base + path, { ...init, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) }, cache: 'no-store', credentials: 'omit' }); }
    catch (e) { throw new BridgeError('unreachable', explain(e, base), { cause: e }); }
    if (r.status === 401) throw new BridgeError('token', 'The bridge refused the token. Copy the one printed when wh-local started (it is new every run unless you set --token).');
    if (r.status === 403) throw new BridgeError('origin', 'The bridge does not allow this page\'s origin. Start it with --origin <this page\'s origin>.', { detail: await r.text().catch(() => '') });
    return r;
  };
  const json = async (r, what) => { if (!r.ok) { let d = ''; try { d = (await r.json()).error || ''; } catch {} throw new BridgeError('refused', `${what}: ${d || r.status}`, { status: r.status }); } return r.json(); };
  const enc = p => String(p || '/').split('/').map(encodeURIComponent).join('/').replace(/^(?!\/)/, '/');
  return {
    url: base,
    health: async () => json(await call('/health'), 'health'),
    info: async () => json(await call('/info'), 'info'),
    // {status, type, text|bytes}: the service's own status, not the bridge's
    async http(name, { method = 'GET', path = '/', body, headers } = {}) {
      const r = await call(`/http/${encodeURIComponent(name)}${enc(path.split('?')[0])}${path.includes('?') ? '?' + path.split('?').slice(1).join('?') : ''}`, { method, body, headers });
      if (!r.headers.has('x-wh-status')) await json(r, 'call');
      const type = r.headers.get('x-wh-content-type') || '';
      const buf = new Uint8Array(await r.arrayBuffer());
      return { status: Number(r.headers.get('x-wh-status')), type, bytes: buf.length, text: textLike(type, buf) ? new TextDecoder().decode(buf) : null };
    },
    async read(dir, path) {
      const r = await call(`/file/${encodeURIComponent(dir)}${enc(path)}`);
      if (!r.ok) await json(r, `read ${dir}${path}`);
      if ((r.headers.get('content-type') || '').startsWith('application/json') && !r.headers.has('x-wh-size')) return { list: await r.json() };
      const buf = new Uint8Array(await r.arrayBuffer());
      return { bytes: buf.length, text: textLike('', buf) ? new TextDecoder().decode(buf) : null };
    },
    list: async (dir, path = '/') => { const o = await (await call(`/file/${encodeURIComponent(dir)}${enc(path)}`)).json(); return o; },
    // {code, out, timedOut, truncated, ms}: a command run in an exec target; the command's own status, not the bridge's.
    // Only the target's name, the command, a folder inside the target's and a time are sent: who runs it and where is the person's flag.
    async exec(name, { cmd, cwd, timeout } = {}) {
      const r = await call(`/exec/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd, ...(cwd ? { cwd } : {}), ...(timeout ? { timeout } : {}) }) });
      if (!r.ok) {
        let j = {}; try { j = await r.json(); } catch {}
        throw new BridgeError(r.status === 429 ? 'busy' : r.status === 502 ? 'launcher' : 'refused', `exec ${name}: ${j.error || r.status}${j.detail ? ' (' + j.detail + ')' : ''}${j.targets ? '. The bridge has: ' + (j.targets.join(', ') || 'no exec targets (start it with --exec NAME=...)') : ''}`, { status: r.status });
      }
      const j = await r.json();
      return { code: j.code, out: String(j.output ?? ''), timedOut: !!j.timed_out, truncated: !!j.truncated, ms: j.ms, ...(j.note ? { note: j.note } : {}) };
    },
  };
}

// The shell tool's runner on an exec target: run(cmd, seconds) -> {out, code, timedOut}, the shape the in-browser
// machine's runner gives the tool, so the model reads the same text whichever runs its command.
// A failure to reach the host reads plainly to the model and names nothing; the reason, in words for the
// person, is on error.detail.
export function hostShell(b, name) {
  return {
    async run(cmd, timeoutS = 120) {
      let r;
      try { r = await b.exec(name, { cmd: String(cmd ?? '') || ':', timeout: timeoutS }); }
      catch (e) {
        const said = e?.kind === 'busy' ? 'the machine is busy with other commands; try again shortly' : e?.kind === 'launcher' ? 'the machine could not start the command' : 'the machine is not available';
        throw Object.assign(new Error(said), { detail: `Shell on host "${name}": ${explain(e, b.url)}`, kind: e?.kind || 'unreachable' });
      }
      const out = r.out + (r.truncated ? `\n[output cut at ${r.out.length} characters]` : '');
      return { out, code: r.timedOut ? null : r.code, ...(r.timedOut ? { timedOut: true } : {}) };
    },
  };
}

function textLike(type, buf) {
  if (/^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded))|\+(json|xml)\b/i.test(type)) return true;
  if (type && !/octet-stream/i.test(type)) return false;
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, n)); return true; } catch { return false; }
}

// Status for the Settings line.
export async function check({ url, token, fetch: f } = {}) {
  const base = normalizeUrl(url);
  if (!base) return { ok: false, text: url ? 'Not a loopback URL: use http://localhost:PORT or http://127.0.0.1:PORT.' : 'Off (no URL set).' };
  try {
    const b = client({ url: base, token, fetch: f });
    await b.health();
    if (!token) return { ok: false, text: `Bridge is running at ${base}, but no token is set.` };
    const i = await b.info();
    const t = Object.keys(i.http || {}), d = i.dirs || [], x = i.exec || [];
    return { ok: true, info: i, text: `Connected to ${base}. ${t.length ? 'Services: ' + t.join(', ') + '. ' : ''}${d.length ? 'Folders: ' + d.join(', ') + '. ' : ''}${x.length ? 'Shell targets (commands run there): ' + x.join(', ') + '. ' : ''}${!t.length && !d.length && !x.length ? 'Nothing is exposed yet (start it with --http / --dir / --exec).' : ''}`.trim() };
  } catch (e) { return { ok: false, text: explain(e, base) }; }
}

// For the model: what the tools return. A failure says what did not work, never how the computer is reached
// (those words are for the person: explain(), the Settings status line).
const clip = (s, n = 200000) => s.length > n ? s.slice(0, n) + `\n[cut at ${n} characters of ${s.length}]` : s;
const plainly = f => async (b, a) => {
  try { return await f(b, a); }
  catch (e) { if (!(e instanceof BridgeError)) throw e; throw new Error(e.kind === 'refused' ? neutral(e.message, 'the request was refused') : 'the local connection is not available'); }
};
export const run = Object.fromEntries(Object.entries({
  async info(b) { const i = await b.info(); return JSON.stringify({ services: i.http, folders: i.dirs, limits: i.limits }); },
  async http(b, a) {
    if (!a.service) throw new Error('service is required (see local_info)');
    const r = await b.http(String(a.service), { method: String(a.method || 'GET').toUpperCase(), path: String(a.path || '/'), body: a.body == null ? undefined : typeof a.body === 'string' ? a.body : JSON.stringify(a.body), headers: a.body != null && typeof a.body !== 'string' ? { 'content-type': 'application/json' } : undefined });
    return `[${r.status}${r.type ? ' ' + r.type : ''}, ${r.bytes} bytes]\n` + (r.text == null ? '(binary; not shown)' : clip(r.text));
  },
  async read(b, a) {
    if (!a.folder) throw new Error('folder is required (see local_info)');
    const r = await b.read(String(a.folder), String(a.path || '/'));
    if (r.list) return r.list.entries.map(e => (e.type === 'dir' ? e.name + '/' : e.name)).join('\n') + (r.list.truncated ? '\n[list cut at 500]' : '');
    return r.text == null ? `(binary file, ${r.bytes} bytes; not shown)` : clip(r.text);
  },
}).map(([k, f]) => [k, plainly(f)]));
