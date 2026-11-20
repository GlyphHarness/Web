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
    async http(name, { method = 'GET', path = '/', body, headers } = {}, what = 'call') {
      const r = await call(`/http/${encodeURIComponent(name)}${enc(path.split('?')[0])}${path.includes('?') ? '?' + path.split('?').slice(1).join('?') : ''}`, { method, body, headers });
      if (!r.headers.has('x-wh-status')) await json(r, what);
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
      catch (e) { throw unavailable(e, b, name, 'Shell'); }
      const out = r.out + (r.truncated ? `\n[output cut at ${r.out.length} characters]` : '');
      return { out, code: r.timedOut ? null : r.code, ...(r.timedOut ? { timedOut: true } : {}) };
    },
  };
}
// a failure to reach the host: plain words for the model, the reason for the person on .detail
function unavailable(e, b, name, what) {
  const said = e?.kind === 'busy' ? 'the machine is busy with other commands; try again shortly' : e?.kind === 'launcher' ? 'the machine could not start the command' : 'the machine is not available';
  return Object.assign(new Error(said), { detail: `${what} on host "${name}": ${explain(e, b.url)}`, kind: e?.kind || 'unreachable' });
}

// The file tools' runner on an exec target (tools.js fileTools, setting hostFiles):
//   read(path) -> {bytes: Uint8Array}        write(path, bytes, {expect}) -> {size}   (expect: sha256 hex the file must still have)
// Through the same route as the shell (POST /exec/NAME), so the bridge's token, limits and folder rule hold and nothing is
// added to the bridge. bash in the target does the work with coreutils (realpath, stat, base64, sha256sum); the bytes
// travel as base64 both ways, so no terminal or decoder touches them. A path is relative to the target's folder or
// absolute inside it, and must stay inside it once links are resolved. The script's first line names a one-time
// marker; its status line is "<marker> <word> ...", so nothing a login shell prints can be mistaken for it.
export const FILE_MAX = 2e6; // bytes of one file read or written
const FILE_SECONDS = 60;
const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = t => { const s = atob(t), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
const FILE_SAID = {
  bad: p => `${p}: not a usable path`, outside: p => `${p}: outside the folder commands start in`, missing: p => `${p}: no such file`,
  notfile: p => `${p}: not a regular file`, unreadable: p => `${p}: not readable`, changed: p => `${p}: changed since it was read; nothing was written`,
  nodir: p => `${p}: its folder could not be made`, big: (p, n) => `${p}: ${n} bytes; this tool reads and writes files up to ${FILE_MAX} bytes (use the shell for larger ones)`,
};
export function hostFiles(b, name) {
  const mark = () => 'F' + Array.from(crypto.getRandomValues(new Uint8Array(9)), x => x.toString(16).padStart(2, '0')).join('');
  const where = (M, p) => `M=${M}\nP=$(printf %s '${toB64(new TextEncoder().encode(p))}' | base64 -d) || { echo "$M bad"; exit 0; }\nR=$(pwd -P)\ncase "$P" in /*) A=$P;; *) A=$R/$P;; esac\nF=$(realpath -m -- "$A" 2>/dev/null) || { echo "$M bad"; exit 0; }\ncase "$F" in "$R"|"$R"/*) ;; *) echo "$M outside"; exit 0;; esac\n`;
  const call = async (p, script) => {
    p = String(p ?? '');
    if (!p || p.length > 1024 || /[\0\r\n]/.test(p)) throw new Error('path is the file\'s path: one line, relative to the folder commands start in or absolute inside it');
    let r;
    try { r = await b.exec(name, { cmd: script, timeout: FILE_SECONDS }); }
    catch (e) { throw unavailable(e, b, name, 'Files'); }
    return r;
  };
  // -> {word, args, before, after}: the status line and what came before it (an error the target printed) and after it (data)
  const status = (M, out, p) => {
    const ls = String(out).split('\n'), i = ls.findIndex(l => l.startsWith(M + ' '));
    if (i < 0) throw new Error(`${p}: the file operation did not complete${ls.filter(Boolean).length ? ' (' + ls.filter(Boolean).at(-1).slice(0, 200) + ')' : ''}`);
    const [word, ...args] = ls[i].slice(M.length + 1).trim().split(' ');
    if (word !== 'ok') { const f = FILE_SAID[word]; throw new Error(f ? f(p, args[0]) : `${p}: ${word}${ls.slice(0, i).filter(Boolean).length ? ' (' + ls.slice(0, i).filter(Boolean).at(-1).slice(0, 200) + ')' : ''}`); }
    return { args, after: ls.slice(i + 1) };
  };
  return {
    async read(p) {
      const M = mark();
      const r = await call(p, where(M, String(p ?? '')) + `[ -e "$F" ] || { echo "$M missing"; exit 0; }\n[ -f "$F" ] || { echo "$M notfile"; exit 0; }\n[ -r "$F" ] || { echo "$M unreadable"; exit 0; }\nS=$(stat -c %s -- "$F") || { echo "$M unreadable"; exit 0; }\n[ "$S" -le ${FILE_MAX} ] || { echo "$M big $S"; exit 0; }\necho "$M ok $S"\nbase64 -w0 -- "$F"; echo\n`);
      const { args, after } = status(M, r.out, p), size = Number(args[0]);
      const bytes = fromB64((after[0] || '').trim());
      if (bytes.length !== size) throw new Error(`${p}: changed while it was read; read it again`);
      return { bytes };
    },
    async write(p, bytes, { expect } = {}) {
      if (bytes.length > FILE_MAX) throw new Error(FILE_SAID.big(p, bytes.length));
      const M = mark(), x = /^[0-9a-f]{64}$/.test(expect || '') ? expect : '';
      const data = toB64(bytes).replace(/.{76}/g, '$&\n');
      const r = await call(p, where(M, String(p ?? '')) + `[ -d "$F" ] && { echo "$M notfile"; exit 0; }\nX='${x}'\nif [ -n "$X" ]; then H=$(sha256sum -- "$F" 2>/dev/null | cut -c1-64); [ "$H" = "$X" ] || { echo "$M changed"; exit 0; }; fi\nmkdir -p -- "$(dirname -- "$F")" 2>/dev/null || { echo "$M nodir"; exit 0; }\nif base64 -d > "$F" <<'@@B64'\n${data}\n@@B64\nthen echo "$M ok $(stat -c %s -- "$F")"; else echo "$M failed"; fi\n`);
      const { args } = status(M, r.out, p);
      return { size: Number(args[0]) };
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
// (those words are for the person: explain(), the Settings status line). That is the neutral wording
// (strat-serial-3.0); a strategy registered before it reads what these tools said before it: the bridge's own
// words (scripts/fixtures/failures-pre-aa62df3.json), so a failure passes up unchanged and a refused call says "bridge".
const clip = (s, n = 200000) => s.length > n ? s.slice(0, n) + `\n[cut at ${n} characters of ${s.length}]` : s;
const plainly = f => async (b, a, wording) => {
  try { return await f(b, a, wording); }
  catch (e) { if (!(e instanceof BridgeError) || wording !== 'neutral') throw e; throw new Error(e.kind === 'refused' ? neutral(e.message, 'the request was refused') : 'the local connection is not available'); }
};
export const run = Object.fromEntries(Object.entries({
  async info(b) { const i = await b.info(); return JSON.stringify({ services: i.http, folders: i.dirs, limits: i.limits }); },
  async http(b, a, wording) {
    if (!a.service) throw new Error('service is required (see local_info)');
    const r = await b.http(String(a.service), { method: String(a.method || 'GET').toUpperCase(), path: String(a.path || '/'), body: a.body == null ? undefined : typeof a.body === 'string' ? a.body : JSON.stringify(a.body), headers: a.body != null && typeof a.body !== 'string' ? { 'content-type': 'application/json' } : undefined }, wording === 'neutral' ? 'call' : 'bridge');
    return `[${r.status}${r.type ? ' ' + r.type : ''}, ${r.bytes} bytes]\n` + (r.text == null ? '(binary; not shown)' : clip(r.text));
  },
  async read(b, a) {
    if (!a.folder) throw new Error('folder is required (see local_info)');
    const r = await b.read(String(a.folder), String(a.path || '/'));
    if (r.list) return r.list.entries.map(e => (e.type === 'dir' ? e.name + '/' : e.name)).join('\n') + (r.list.truncated ? '\n[list cut at 500]' : '');
    return r.text == null ? `(binary file, ${r.bytes} bytes; not shown)` : clip(r.text);
  },
}).map(([k, f]) => [k, plainly(f)]));
