// One machine for every tab of this site. The tab holding the Web Lock
// "wh-machine" runs it (the host); the others reach it over a BroadcastChannel
// with the same interface as vm.js machine(): run, status, onView, onEvent, typed.
//
// - The lock is released by the browser when the host tab closes or crashes; a
//   client then sees the host gone (its own queued lock request is granted),
//   fails what it had in flight, and the next command makes some tab the host.
// - A dedicated machine tab (?machine) only hosts: it never reloads for a site
//   update, so a running machine is untouched by a deploy. Tabs check the
//   machine protocol (MPROTO) in the handshake and refuse a host they cannot speak to.
// - Chrome does not freeze a background tab that holds a Web Lock (it can still
//   discard it under memory pressure: keep the machine tab active or exempt).
// - Handover: a tab asks the host to save the homes, stop and release; it then
//   boots and restores them.

export const MPROTO = 1;
const rid = () => Math.random().toString(36).slice(2, 10);

// local(cb) makes this tab's machine (vm.js); cb = {onStatus}. info() = what this tab says about itself.
export function sharedMachine({ tab, local, info = () => ({}), dedicated = false }) {
  const ch = new BroadcastChannel('wh-machine');
  const views = new Set(), events = new Set(), statusers = new Set(), roles = new Set();
  const pending = new Map();
  let starting = null, role = 'idle', m = null, host = null, status = 'off', release = null, watching = false;
  const post = x => ch.postMessage({ ...x, from: tab });
  const setStatus = t => { status = t; for (const f of statusers) f(t); };
  const setRole = r => { role = r; for (const f of roles) f(r, host); };
  const me = () => ({ tab, proto: MPROTO, status, dedicated, jobs: m?.jobs?.().length || 0, ...info() });

  function hostGone(why) {
    host = null;
    for (const [id, p] of pending) { pending.delete(id); p.no(new Error(why)); }
    if (role === 'client') setRole('idle');
  }
  // a client learns the host is gone when its own (queued) request for the lock is granted
  function watch() {
    if (watching || !navigator.locks) return;
    watching = true;
    navigator.locks.request('wh-machine', () => { watching = false; if (role !== 'host') hostGone('the machine tab closed; the machine stopped with it'); });
  }
  function becomeHost() {
    if (m) return m;
    m = local({ onStatus: t => { setStatus(t); post({ t: 'status', status: t }); } });
    m.onView(seg => { for (const f of views) f(seg); post({ t: 'view', seg }); });
    m.onEvent(e => { for (const f of events) f(e); post({ t: 'event', e }); });
    return m;
  }
  // take the lock if nobody holds it; held until released (handover) or the tab goes
  function claim() {
    if (role === 'host') return Promise.resolve(true);
    if (!navigator.locks) { setRole('host'); becomeHost(); return Promise.resolve(true); }
    return new Promise(res => navigator.locks.request('wh-machine', { ifAvailable: true }, lock => {
      if (!lock) { res(false); return; }
      host = null; setRole('host'); becomeHost(); post({ t: 'host', ...me() }); res(true);
      return new Promise(r => { release = r; });
    }));
  }
  function who(ms = 600) {
    return new Promise(res => {
      const f = e => { if (e.data?.t === 'host') { ch.removeEventListener('message', f); clearTimeout(t); res(e.data); } };
      const t = setTimeout(() => { ch.removeEventListener('message', f); res(null); }, ms);
      ch.addEventListener('message', f);
      post({ t: 'who' });
    });
  }
  async function connect() {
    if (role === 'host') return 'host';
    if (host) return 'client';
    for (let i = 0; i < 20; i++) {
      const h = await who();
      if (h) { host = h; setRole('client'); setStatus(h.status); watch(); return 'client'; }
      if (await claim()) return 'host';
      await new Promise(r => setTimeout(r, 500)); // a tab holds the lock but has not answered yet
    }
    throw new Error('no tab answers for the machine');
  }
  function rpc(op, args) {
    if (host.proto !== MPROTO) return Promise.reject(new Error(`the machine tab speaks machine protocol ${host.proto}, this page ${MPROTO}: update both (top bar → update), or restart the machine here`));
    return new Promise((ok, no) => { const id = rid(); pending.set(id, { ok, no }); post({ t: 'call', id, to: host.tab, op, args }); });
  }

  ch.addEventListener('message', async e => {
    const x = e.data || {};
    if (x.from === tab) return;
    if (role === 'host') {
      if (x.t === 'who') post({ t: 'host', ...me() });
      else if (x.t === 'call' && x.to === tab) {
        const reply = (ok, v) => post({ t: 'reply', id: x.id, to: x.from, ok, v });
        try {
          const mm = becomeHost(), a = x.args || [];
          const v = x.op === 'run' ? await api.run(a[0], a[1], a[2]) : x.op === 'jobs' ? mm.jobs() : x.op === 'raw' ? mm.raw(a[0]) : x.op === 'cancel' ? await mm.cancel(a[0]) : x.op === 'send' ? mm.send(a[0]) : x.op === 'typed' ? mm.typed(a[0]) : x.op === 'handover' ? await handover() : null;
          reply(true, v ?? null);
        } catch (err) { reply(false, String(err.message || err)); }
      }
      return;
    }
    if (x.t === 'host') { host = x; if (role !== 'client') setRole('client'); setStatus(x.status); watch(); }
    else if (x.t === 'status' && host?.tab === x.from) { host.status = x.status; setStatus(x.status); }
    else if (x.t === 'view' && host?.tab === x.from) for (const f of views) f(x.seg);
    else if (x.t === 'event' && host?.tab === x.from) for (const f of events) f(x.e);
    else if (x.t === 'reply' && x.to === tab) { const p = pending.get(x.id); if (p) { pending.delete(x.id); x.ok ? p.ok(x.v) : p.no(new Error(x.v)); } }
    else if (x.t === 'bye' && host?.tab === x.from) hostGone('the machine tab closed; the machine stopped with it');
  });
  addEventListener('pagehide', () => { if (role === 'host') post({ t: 'bye' }); });

  // save the homes (kept in the Cache API for the next host), stop, let go of the lock
  async function handover() {
    if (role !== 'host') return null;
    let saved = null;
    if (m && /ready/.test(m.status())) { saved = await m.save(); if (saved.data) await stash(saved.data); m.stop(); }
    m = null; setRole('idle'); setStatus('off');
    release?.(); release = null;
    return saved?.tooBig ? { tooBig: saved.tooBig } : { saved: saved?.bytes || 0 };
  }

  const api = {
    role: () => role, host: () => host, me,
    status: () => status,
    async run(cmd, t, opt) {
      if ((await connect()) === 'host') {
        const mm = becomeHost();
        // first command after a boot: start, then put back homes saved by a restart or handover
        if (!/ready/.test(mm.status())) await (starting ??= mm.run('true', 600, { quiet: true, label: 'start' }).then(() => restoreStash(mm)).finally(() => { starting = null; }));
        return mm.run(cmd, t, opt);
      }
      return rpc('run', [cmd, t, opt]);
    },
    async raw(n) { return role === 'host' ? m?.raw?.(n) ?? '' : host ? rpc('raw', [n]) : ''; },
    async jobs() { return role === 'host' ? m?.jobs() || [] : host ? rpc('jobs', []) : []; },
    async cancel(id) { return role === 'host' ? m?.cancel(id) : host && rpc('cancel', [id]); },
    send(d) { role === 'host' ? m?.send(d) : host && rpc('send', [d]).catch(() => {}); },
    typed(text) { role === 'host' ? m?.typed(text) : host && rpc('typed', [text]).catch(() => {}); },
    onView: f => { views.add(f); return () => views.delete(f); },
    onEvent: f => { events.add(f); return () => events.delete(f); },
    onStatus: f => { statusers.add(f); return () => statusers.delete(f); },
    onRole: f => { roles.add(f); return () => roles.delete(f); },
    connect, claim, who,
    // move the machine to this tab: the host saves and stops, this tab boots and restores
    async takeOver() {
      if (role === 'host') return { already: true };
      await connect().catch(() => {});
      let r = null;
      if (role === 'client') r = await rpc('handover', []);
      for (let i = 0; i < 20 && !(await claim()); i++) await new Promise(res => setTimeout(res, 250));
      return r;
    },
    // for an update or a restart: save, stop, and keep the lock (the next boot restores)
    async restart() {
      if (role !== 'host' || !m) return null;
      const saved = /ready/.test(m.status()) ? await m.save() : null;
      if (saved?.data) await stash(saved.data);
      m.stop();
      return saved?.tooBig ? { tooBig: saved.tooBig } : { saved: saved?.bytes || 0 };
    },
    async saveNow() { if (role !== 'host' || !m || !/ready/.test(m.status())) return null; const s = await m.save(); if (s.data) await stash(s.data); return s.tooBig ? { tooBig: s.tooBig } : { saved: s.bytes }; },
    stashed,
  };
  return api;
}

// The saved homes: one entry in the Cache API (same origin, survives reloads),
// restored by whichever tab boots the machine next, then removed.
const STASH = 'wh-machine-state', STASH_URL = 'https://wh.invalid/homes';
async function stash(data) {
  try { const c = await caches.open(STASH); await c.put(STASH_URL, new Response(data, { headers: { 'x-saved': new Date().toISOString() } })); } catch {}
}
export async function stashed() {
  try { const r = await (await caches.open(STASH)).match(STASH_URL); return r ? { saved: r.headers.get('x-saved'), bytes: Number(r.headers.get('content-length')) || null } : null; } catch { return null; }
}
async function restoreStash(m) {
  try {
    const c = await caches.open(STASH), r = await c.match(STASH_URL);
    if (!r) return;
    const data = await r.text();
    await c.delete(STASH_URL);
    const out = await m.restore(data);
    m.event?.({ label: /restored/.test(out.out) ? `restored the saved homes (${Math.round(data.length * 3 / 4 / 1024)} KB)` : 'could not restore the saved homes', kind: 'restore' });
  } catch {}
}
