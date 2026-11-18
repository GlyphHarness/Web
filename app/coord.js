// Every tab of this site moving together: halt, step, resume, and updating the
// site without breaking a running machine.
//
// Gates: a session's turn stops at a gate while a halt is on. The gate before
// each model request is the good state: every tool result is recorded, nothing
// is in flight, and the turn can be continued after a reload from storage alone.
// Tool gates hold only for a pause (for an update the tool batch finishes first).
//
// A tab is at rest when none of its turns is between gates. The update procedure
// halts every tab, waits until all are at rest, saves the machine's homes when it
// has to restart, reloads the tabs onto the new build, and resumes the sessions
// that were stopped at a gate once every tab is on the new version.
//
// Shared state: localStorage wh:coord {halt: {id, reason, mode, since, by, to}}.
// Messages: BroadcastChannel "wh-coord" (state, poll, halt, resume, step, reload).

const KEY = 'wh:coord';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

export function coordinator({ tab, version, describe = () => ({}), onChange = () => {}, onReload = () => location.reload() }) {
  const ch = new BroadcastChannel('wh-coord');
  const waiting = new Map(); // key -> {kind, session, release}
  const tabs = new Map(); // tab -> last state
  let active = 0, cur = read();
  const post = x => ch.postMessage({ ...x, from: tab });
  const mine = () => ({ tab, version, active, waiting: [...waiting.values()].map(w => ({ session: w.session, kind: w.kind })), t: Date.now(), ...describe() });
  const announce = () => { post({ t: 'state', s: mine() }); onChange(); };
  const halted = () => cur.halt || null;
  const releaseAll = () => { for (const [k, w] of [...waiting]) { waiting.delete(k); w.release('go'); } };

  function sync(next) {
    const was = !!cur.halt;
    cur = next;
    if (was && !cur.halt) releaseAll();
    if (cur.halt?.mode === 'update') for (const [k, w] of [...waiting]) if (w.kind === 'tool') { waiting.delete(k); w.release('go'); }
    announce();
  }
  ch.addEventListener('message', e => {
    const x = e.data || {};
    if (x.from === tab) return;
    if (x.t === 'state') { tabs.set(x.s.tab, x.s); onChange(); }
    else if (x.t === 'poll') post({ t: 'state', s: mine() });
    else if (x.t === 'halt' || x.t === 'resume') sync(read());
    else if (x.t === 'step') api.step(false);
    else if (x.t === 'bye') { tabs.delete(x.from); onChange(); }
    else if (x.t === 'reload' && (!x.except || !x.except.includes(tab))) onReload(x);
  });
  addEventListener('storage', e => { if (e.key === KEY) sync(read()); });
  addEventListener('pagehide', () => post({ t: 'bye' }));

  const api = {
    tab, version, halted, tabs: () => [mine(), ...[...tabs.values()].filter(t => Date.now() - t.t < 60e3)],
    // a turn is between gates: enter() when it starts or passes a gate, leave() when it waits or ends
    enter() { active++; announce(); },
    leave() { active = Math.max(0, active - 1); announce(); },
    // resolves 'go' when the session may proceed; waits while halted
    async gate(session, kind) {
      const h = halted();
      if (!h || (h.mode === 'update' && kind === 'tool')) return 'go';
      const key = session + ':' + kind + ':' + Math.random().toString(36).slice(2, 6);
      api.leave();
      try { return await new Promise(release => { waiting.set(key, { kind, session, release }); announce(); }); }
      finally { api.enter(); }
    },
    halt(reason, mode = 'pause', extra = {}) {
      const next = { ...read(), halt: { id: Math.random().toString(36).slice(2, 8), reason, mode, since: new Date().toISOString(), by: tab, ...extra } };
      write(next); post({ t: 'halt' }); sync(next);
    },
    resume() { const next = { ...read() }; delete next.halt; write(next); post({ t: 'resume' }); sync(next); },
    // lockstep: every gate in every tab lets one step through, then holds again
    step(all = true) { if (all) post({ t: 'step' }); for (const [k, w] of [...waiting]) { waiting.delete(k); w.release('go'); } announce(); },
    // the current state of every tab, fresh
    async poll(ms = 500) { post({ t: 'poll' }); await new Promise(r => setTimeout(r, ms)); return api.tabs(); },
    reload(extra = {}) { post({ t: 'reload', ...extra }); },
    waiting: () => [...waiting.values()].map(w => ({ session: w.session, kind: w.kind })),
    announce,
  };
  // say hello and ask the others; a heartbeat keeps the tab list fresh (rows older than 60 s drop out)
  setTimeout(() => { post({ t: 'poll' }); announce(); }, 0);
  setInterval(() => post({ t: 'state', s: mine() }), 20e3);
  return api;
}

// The published build, read past every cache: {version, build, machine}.
export async function published(base = location.href) {
  try { const r = await fetch(new URL('./version.json', base), { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
}
