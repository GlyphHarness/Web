// Debug bridge: an opt-in, end-to-end encrypted channel between this page and a
// paired agent (scripts/bridge.mjs), so the person using the page and an agent
// working on its code can look at the same live state.
//
// - Off unless the page is opened with #bridge=<owner/repo>~<branch>~<key>. The
//   fragment is never sent to a server; it moves to sessionStorage (this tab
//   only) and is removed from the address bar.
// - Transport: a git branch on GitHub, through the API with the GitHub token
//   from Settings. The page commits up/<n>.txt; the agent pushes down/<n>.txt
//   with plain git. Only AES-GCM ciphertext is written; the key stays in the
//   fragment. Polling uses ETags, and GitHub does not count 304 responses.
// - Up: hello, errors, console warnings/errors, notices, approvals, finished
//   trace records, replies. Every payload has the stored keys replaced with
//   [key] before it is encrypted.
// - Down: a fixed list of directives. Anything that spends credit, changes which
//   code runs or changes settings waits for a click.

import { slot } from './styles.js';

const API = 'https://api.github.com';
const POLL_MS = 3000;
const MAX_AGE = 10 * 60e3; // directives older than this are dropped (replay guard)
export const b64u = {
  enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};
const PAIR = /([\w.-]+\/[\w.-]+)~([\w\/.-]+)~([\w-]+)/;

export function pairing() {
  const m = new RegExp('(?:^#|&)bridge=' + PAIR.source).exec(location.hash);
  if (m) {
    try { sessionStorage.setItem('wh:bridge', m.slice(1).join('~')); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
    return { repo: m[1], branch: m[2], key: m[3] };
  }
  let v = '';
  try { v = sessionStorage.getItem('wh:bridge') || ''; } catch {}
  const p = PAIR.exec(v);
  return p ? { repo: p[1], branch: p[2], key: p[3] } : null;
}

async function cryptoKey(k) { return crypto.subtle.importKey('raw', b64u.dec(k), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return b64u.enc(out);
}
async function open(key, text) {
  const b = b64u.dec(text.trim());
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

// host = { token(), trace, hello(), secrets() -> [string], directives: {name: fn(args)}, gated: Set, ask(text) -> Promise<bool>, banner() }
export async function start(pair, host) {
  const key = await cryptoKey(pair.key);
  const queue = [], seen = new Set(), sentTrace = new WeakSet(), files = new Set();
  let n = 0, flushing = null, stopped = false, etag = '', poll = null;
  const redact = s => host.secrets().filter(k => k && k.length > 8).reduce((t, k) => t.split(k).join('[key]'), s);
  const stats = { up: 0, down: 0, err: 0 };
  const tag = Date.now().toString(36);

  // GitHub calls made here stay out of the trace: they would be sent up again.
  async function gh(method, path, body, extra = {}) {
    const tok = await host.token();
    if (!tok) throw new Error('no GitHub token');
    return fetch(API + path, { method, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  }
  const at = p => `/repos/${pair.repo}/contents/${p}`;

  async function post(batch) {
    const text = await seal(key, JSON.parse(redact(JSON.stringify(batch))));
    const name = `up/${tag}-${String(++stats.seq || (stats.seq = 1)).padStart(5, '0')}.txt`;
    const r = await gh('PUT', at(name), { message: 'bridge up', content: btoa(text), branch: pair.branch });
    if (r.status === 403 || r.status === 429 || r.status === 409) { const e = new Error('GitHub ' + r.status); e.retry = true; throw e; }
    if (!r.ok) throw new Error('GitHub ' + r.status + ' ' + (await r.text()).slice(0, 200));
    stats.up += batch.length;
  }
  function flush() {
    if (flushing || !queue.length || stopped) return flushing;
    const batch = queue.splice(0, 100);
    let wait = 2000;
    flushing = post(batch)
      .catch(e => { if (e.retry) { queue.unshift(...batch); stats.limited = (stats.limited || 0) + 1; wait = 10000; } else { stats.err++; stats.last = e.message; } })
      .finally(() => { flushing = null; status(); if (queue.length) setTimeout(flush, wait); });
    return flushing;
  }
  const emit = (type, data) => { if (stopped) return; queue.push({ type, n: ++n, t: Date.now(), data }); setTimeout(flush, 1500); };

  async function handle(d) {
    if (!d?.id || seen.has(d.id) || Date.now() - (d.t || 0) > MAX_AGE) return;
    seen.add(d.id);
    stats.down++;
    const fn = host.directives[d.do];
    if (!fn) return emit('reply', { re: d.id, ok: false, error: 'unknown directive: ' + d.do + '; known: ' + Object.keys(host.directives).join(' ') });
    if (host.gated.has(d.do) && !(await host.ask(`The paired agent asks to ${d.do}: ${JSON.stringify(d.args || {}).slice(0, 300)}`)))
      return emit('reply', { re: d.id, ok: false, error: 'declined by the user' });
    try { emit('reply', { re: d.id, ok: true, data: await fn(d.args || {}) }); }
    catch (e) { emit('reply', { re: d.id, ok: false, error: String(e?.message || e) }); }
  }

  async function check() {
    if (stopped) return;
    try {
      const r = await gh('GET', at('down') + '?ref=' + encodeURIComponent(pair.branch), null, etag ? { 'If-None-Match': etag } : {});
      if (r.status === 200) {
        etag = r.headers.get('ETag') || '';
        const list = (await r.json()).filter(f => f.type === 'file' && f.name.endsWith('.txt') && !files.has(f.name)).sort((x, y) => x.name < y.name ? -1 : 1);
        for (const f of list) {
          files.add(f.name);
          const c = await (await gh('GET', at('down/' + f.name) + '?ref=' + encodeURIComponent(pair.branch))).json();
          try { await handle(await open(key, atob(c.content.replace(/\s/g, '')))); } catch { stats.err++; }
        }
        status();
      } else if (r.status !== 304 && r.status !== 404) { stats.err++; stats.last = 'poll ' + r.status; status(); }
    } catch (e) { stats.err++; stats.last = e.message; status(); }
    poll = setTimeout(check, POLL_MS);
  }
  // directives already on the branch when the page opens are skipped
  async function prime() {
    try {
      const r = await gh('GET', at('down') + '?ref=' + encodeURIComponent(pair.branch));
      if (r.ok) { etag = r.headers.get('ETag') || ''; for (const f of await r.json()) files.add(f.name); }
    } catch {}
  }

  // finished trace records, errors and console problems go up on their own
  const tick = setInterval(() => {
    for (const r of host.trace) if (r.ms != null && !sentTrace.has(r)) { sentTrace.add(r); emit('trace', r); }
  }, 1000);
  const onErr = e => emit('error', { message: String(e.message || e.reason?.message || e.reason || e), stack: String(e.error?.stack || e.reason?.stack || '').slice(0, 2000), at: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '' });
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onErr);
  const orig = { warn: console.warn, error: console.error };
  for (const lvl of ['warn', 'error']) console[lvl] = (...a) => { orig[lvl](...a); emit('console', { lvl, text: a.map(x => x instanceof Error ? x.stack : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ').slice(0, 4000) }); };

  const bar = host.banner();
  function status() { slot(bar.querySelector('[data-bstat]'), `${pair.repo} ${pair.branch} · up ${stats.up} · down ${stats.down}${stats.limited ? ' · limited ' + stats.limited : ''}${stats.err ? ' · errors ' + stats.err + (stats.last ? ' (' + stats.last + ')' : '') : ''}`); }
  bar.querySelector('[data-bend]').addEventListener('click', stop);
  function stop() {
    stopped = true; clearTimeout(poll); clearInterval(tick);
    removeEventListener('error', onErr); removeEventListener('unhandledrejection', onErr);
    Object.assign(console, orig);
    try { sessionStorage.removeItem('wh:bridge'); } catch {}
    bar.remove();
  }

  if (!(await host.token().catch(() => ''))) slot(bar.querySelector('[data-bstat]'), 'Set a GitHub token in Settings, then reload: the bridge runs over a git branch.');
  else { await prime(); check(); }
  emit('hello', host.hello());
  status();
  return { emit, stop };
}
