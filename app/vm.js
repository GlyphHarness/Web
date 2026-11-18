// A Linux machine in the page: an x86 emulator (container2wasm, WASI build) running
// an Alpine image with bash, coreutils, git, python3, gh, curl and jq.
//
// - Needs cross-origin isolation (SharedArrayBuffer). index.html turns it on with
//   a service worker while localStorage wh:vm is "1" (Settings switch).
// - Network: the guest's HTTP(S) goes through a network stack in a Worker and
//   leaves as the page's own fetch, so only hosts that allow cross-origin
//   requests answer (api.github.com does; git's smart HTTP does not).
// - The guest's GH_TOKEN is a placeholder. Requests to api.github.com get the
//   real credential added here, minted per repository in app mode, so no token
//   ever exists inside the machine or in what the model reads.
// - run(cmd) types a script into the guest's shell and reads back what it
//   printed up to an end marker with the exit status. The terminal card shows
//   the same bytes to the user.

const ROOT = new URL('./vm/', new URL('./app/', location.href)).href; // the page's own copy: Workers must be same-origin
const IMAGE = ROOT + 'image/out.parts.json';
const NET = ROOT + 'image/c2w-net-proxy.wasm';
const PLACEHOLDER = 'wh-placeholder-token';
export const RUNTIME_MARK = /__WH_RUNTIME_POLICY (\S+) ([^\n]*?)__\n?/g;
export const SLEEP_LIMIT = 20; // seconds; matches the bounded-waits policy
// The package shelf: Alpine packages kept next to the image on the page's own site
// (same origin, so the machine can fetch them; Alpine's mirrors do not allow
// cross-origin requests). wh-install <name> installs one, offline, from there.
export const SHELF = ROOT + 'image/pkgs';
const INSTALL = `#!/bin/sh
# Installed by the harness: installs packages from the page's own shelf (no mirror needed).
[ -n "$1" ] || { echo "usage: wh-install <package>..." >&2; exit 2; }
d=$(mktemp -d); trap 'rm -rf "$d"' EXIT
curl -fsS "$WH_SHELF/index.txt" -o "$d/index.txt" || { echo "wh-install: the shelf is not reachable at $WH_SHELF" >&2; exit 1; }
for p in "$@"; do
  files=$(grep "^$p:" "$d/index.txt" | cut -d: -f2-)
  [ -n "$files" ] || { echo "wh-install: $p is not on the shelf; it has: $(cut -d: -f1 "$d/index.txt" | tr '\\n' ' ')" >&2; exit 1; }
  set --
  for f in $files; do curl -fsS "$WH_SHELF/$f" -o "$d/$f" || { echo "wh-install: could not fetch $f" >&2; exit 1; }; set -- "$@" "$d/$f"; done
  apk add --allow-untrusted --no-network --quiet "$@" || exit 1
done
`;
const SLEEP_SHIM = `#!/bin/sh
# Installed by the harness (policy bounded-waits): fixed waits of ${SLEEP_LIMIT}s or more are refused.
t=0
for a in "$@"; do
  case "$a" in *[!0-9.smhd]*|'') continue;; esac
  u=\${a##*[0-9.]}; v=\${a%"$u"}; v=\${v%%.*}; [ -z "$v" ] && v=0
  case "$u" in m) v=$((v*60));; h) v=$((v*3600));; d) v=$((v*86400));; esac
  t=$((t+v))
done
if [ "$t" -ge ${SLEEP_LIMIT} ]; then
  echo "sleep: refused: a fixed wait of \${t}s. Wait on the condition instead: until <check> || [ \\$SECONDS -gt 300 ]; do sleep 3; done" >&2
  echo "__WH_RUNTIME_POLICY bounded-waits sleep $*__" >&2
  exit 1
fi
exec /bin/sleep "$@"
`;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][0-9A-B]|\x1b[=>]|\r/g;

export const vmWanted = () => { try { return localStorage.getItem('wh:vm') === '1'; } catch { return false; } };
export const vmReady = () => typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

const script = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('failed to load ' + src)); document.head.append(s); });

// env = { token(repo, level) -> Promise<string>, trace: [], onStatus(text), mount(el) }
export function machine(env) {
  let booted = null, term = null, input = null, out = '', status = 'off', queue = Promise.resolve();
  const listeners = new Set();
  // What the person sees is separate from what the harness reads. Harness commands
  // (start-up, the sleep shim, the network wait, explorer listings and reads) run
  // quiet: captured for the harness, shown as one note line unless showHarness().
  // Two channels for the person: the terminal (what went in and came out, in order)
  // and harness events (what the harness ran for itself), never mixed.
  const viewers = new Set(), watchers = new Set();
  let quiet = 0;
  const view = seg => { for (const v of viewers) v(seg); };
  const event = e => { const x = { t: Date.now(), ...e }; for (const w of watchers) w(x); return x; };
  const note = label => event({ label });
  const say = t => { status = t; env.onStatus?.(t); };

  // GitHub credential for the guest's API requests; nothing for other hosts.
  globalThis.whVmAuth = async (url, req) => {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.hostname !== 'api.github.com' && u.hostname !== 'uploads.github.com') return null;
    const sent = Object.entries(req.headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || '';
    if (!sent.includes(PLACEHOLDER)) return null;
    const repo = /^\/repos\/([^/]+\/[^/]+)/.exec(u.pathname)?.[1];
    const level = (req.method || 'GET') === 'GET' ? 'read' : /\/pulls$/.test(u.pathname) ? 'pr' : 'write';
    const tok = await env.token(repo, level).catch(() => '');
    return tok ? 'Bearer ' + tok : null;
  };
  // the guest's requests, as seen by the page, go in the trace (no headers, no bodies)
  globalThis.whVmNet = r => env.trace?.push({ t: new Date().toISOString(), url: r.url, request: { method: r.method, from: 'machine' }, status: r.status, chunks: [], ms: 0, ...(r.error ? { error: r.error } : {}) });

  async function boot() {
    if (!vmReady()) throw new Error('The machine needs cross-origin isolation: switch it on in Settings (the page reloads once).');
    say('loading');
    await script(ROOT + 'xterm-pty.js');
    await script(ROOT + 'stack.js');
    const { openpty, TtyServer, Termios } = globalThis;
    const { master, slave } = openpty();
    const t = slave.ioctl('TCGETS');
    // raw on the page side; the guest's own tty does line editing (as in the c2w example)
    const I = 0x20 | 0x40 | 0x80 | 0x100 | 0x400, O = 0x1, L = 0x8 | 0x40 | 0x2 | 0x1 | 0x8000;
    slave.ioctl('TCSETS', new Termios(t.iflag & ~I, t.oflag & ~O, t.cflag, t.lflag & ~L, t.cc));
    const dec = new TextDecoder();
    // a stand-in terminal: what the guest writes is kept for run() and copied to the card
    master.activate({
      write(d, cb) { const s = typeof d === 'string' ? d : dec.decode(d, { stream: true }); out += s; for (const f of listeners) f(s); if (!quiet || env.showHarness?.()) view({ k: quiet ? 'raw' : 'out', text: s }); cb?.(); },
      onData(f) { input = f; return { dispose() {} }; },
      onBinary() { return { dispose() {} }; },
      onResize() { return { dispose() {} }; },
    });
    term = env.mount?.(data => input?.(data)); // the card can type too
    const worker = new Worker(ROOT + 'worker.js?net=browser');
    worker.addEventListener('message', e => { if (e.data?.whProgress != null) say(`downloading ${Math.round(e.data.whProgress * 100)}%`); });
    const stack = globalThis.newStack(worker, IMAGE, new Worker(ROOT + 'stack-worker.js?net=browser'), NET);
    new TtyServer(slave).start(worker, stack);
    say('booting');
    quiet++; // the start-up handshake and setup are the harness's business
    note('starting the machine');
    // the guest is up when a marker echoed through its shell comes back
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 600e3) throw new Error('the machine did not start within 10 minutes');
      const mark = '__WH_UP_' + Math.random().toString(36).slice(2, 8);
      const seen = waitFor(new RegExp(mark + '_42'), 8000); // computed, so the echoed command line does not match
      input?.(`echo ${mark}_$((40+2))\r`);
      if (await seen.catch(() => false)) break;
    }
    input('stty -echo 2>/dev/null; export PS1= PS2=; cd /root\r');
    await new Promise(r => setTimeout(r, 500));
    // runtime policy: a sleep ahead of the real one on PATH refuses long fixed waits
    // however they are spelled (the argument check only sees the literal call)
    // one line per script: the console takes lines of about 2,000 characters at most
    input(`mkdir -p /usr/local/bin && echo ${btoa(SLEEP_SHIM)} | base64 -d > /usr/local/bin/sleep && chmod +x /usr/local/bin/sleep\r`);
    input(`echo ${btoa(INSTALL)} | base64 -d > /usr/local/bin/wh-install && chmod +x /usr/local/bin/wh-install\r`);
    input(`export WH_SHELF='${SHELF}'; hash -r\r`);
    // the network stack (a second wasm) can come up after the shell: wait for its
    // proxy port (polled every second, stops as soon as it answers, at most ~60 s)
    // so the first networked command does not race it
    say('waiting for the network');
    const net = waitFor(/__WH_NET_(up|down)__/, 75e3);
    input(`n=0; until timeout 1 bash -c '</dev/tcp/192.168.127.253/80' 2>/dev/null; do n=$((n+1)); [ $n -gt 60 ] && break; sleep 1; done; [ $n -gt 60 ] && echo __WH_NET_down__ || echo __WH_NET_up__\r`);
    const r = await net.catch(() => null);
    quiet--;
    note(r?.m[1] === 'up' ? 'machine ready' : 'machine ready (no network)');
    say(r?.m[1] === 'up' ? 'ready' : 'ready (no network)');
  }

  function waitFor(re, ms) {
    return new Promise((ok, no) => {
      let buf = '';
      const f = s => { buf += s; const m = re.exec(buf.replace(ANSI, '')); if (m) { listeners.delete(f); clearTimeout(t); ok({ m, buf }); } };
      const t = setTimeout(() => { listeners.delete(f); no(Object.assign(new Error('timeout'), { buf })); }, ms);
      listeners.add(f);
    });
  }

  // Run a bash script; returns { out, code }. The script goes in as base64 lines
  // (well under the tty's line limit), so quoting and newlines survive.
  async function exec(cmd, timeoutS = 120, opt = {}) {
    if (!booted) booted = boot().catch(e => { booted = null; say('failed: ' + e.message); throw e; });
    await booted;
    if (!opt.quiet) view({ k: 'in', text: cmd, by: opt.by || 'model' });
    const t0 = Date.now();
    if (opt.quiet) quiet++;
    let r;
    try { return r = await execInner(cmd, timeoutS); }
    finally { if (opt.quiet) { quiet--; event({ label: opt.label || 'harness command', ms: Date.now() - t0, bytes: (r?.out || '').length, code: r?.code, timedOut: r?.timedOut }); } }
  }
  async function execInner(cmd, timeoutS) {
    await booted;
    const id = Math.random().toString(36).slice(2, 10);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(cmd)));
    const lines = [': > /tmp/.wh.b64'];
    for (let i = 0; i < b64.length; i += 2000) lines.push(`printf %s ${b64.slice(i, i + 2000)} >> /tmp/.wh.b64`);
    lines.push(`base64 -d /tmp/.wh.b64 > /tmp/.wh.sh; bash /tmp/.wh.sh 2>&1 </dev/null; echo "__WH_${id}_$?__"`);
    const done = waitFor(new RegExp(`__WH_${id}_(\\d+)__`), timeoutS * 1000);
    for (const l of lines) input(l + '\r');
    try {
      const { m, buf } = await done;
      const text = buf.replace(ANSI, '');
      const body = text.slice(0, m.index).split('\n').filter(l => !l.includes('/tmp/.wh.b64') && !l.includes('__WH_' + id)).join('\n').replace(/^\n+|\n+$/g, '');
      return { out: body, code: Number(m[1]) };
    } catch (e) {
      input('\x03'); // interrupt what is still running
      return { out: String(e.buf || '').replace(ANSI, '').trim(), code: null, timedOut: true };
    }
  }

  return {
    status: () => status,
    run: (cmd, timeoutS, opt) => (queue = queue.then(() => exec(cmd, timeoutS, opt), () => exec(cmd, timeoutS, opt))),
    onOutput: f => { listeners.add(f); return () => listeners.delete(f); },
    onView: f => { viewers.add(f); return () => viewers.delete(f); },
    onEvent: f => { watchers.add(f); return () => watchers.delete(f); },
    event,
    typed: text => view({ k: 'in', text, by: 'you' }),
  };
}
