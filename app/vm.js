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
# not root (a session's own user): ask the root install service (package names only)
if [ "$(id -u)" != 0 ]; then
  for p in "$@"; do case "$p" in *[!a-zA-Z0-9._+-]*|'') echo "wh-install: package names only" >&2; exit 2;; esac; done
  id=$$-$(date +%s%N); q=/run/wh-install
  [ -p $q/q ] || { echo "wh-install: the install service is not running" >&2; exit 1; }
  echo "$id $*" > $q/q
  n=0; until [ -f $q/$id.rc ] || [ $n -gt 1200 ]; do n=$((n+1)); /bin/sleep 0.25; done
  cat $q/$id.out 2>/dev/null; rc=$(cat $q/$id.rc 2>/dev/null || echo 1); exit $rc
fi
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
// root install service: reads "id package..." lines from a FIFO anyone may write to,
// installs from the shelf, leaves the output and status for the asker
const INSTALLD = `#!/bin/sh
q=/run/wh-install; mkdir -p $q; chmod 755 $q; [ -p $q/q ] || mkfifo -m 622 $q/q
while :; do
  while read -r id pkgs; do
    find $q -name '*-*.*' -mmin +10 -delete 2>/dev/null
    case "$id" in *[!a-z0-9-]*|'') continue;; esac
    bad=; for p in $pkgs; do case "$p" in *[!a-zA-Z0-9._+-]*) bad=1;; esac; done
    [ -n "$pkgs" ] && [ -z "$bad" ] || { echo "package names only" > $q/$id.out; echo 2 > $q/$id.rc; chmod 644 $q/$id.out $q/$id.rc; continue; }
    /usr/local/bin/wh-install $pkgs > $q/$id.out 2>&1; echo $? > $q/$id.rc; chmod 644 $q/$id.out $q/$id.rc
  done < $q/q
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
const JOBS = '/var/wh';
const CA = '/usr/local/share/wh-proxy.crt'; // the network proxy's CA, readable by sessions' users // root-only: job scripts and outputs
const USER_RE = /^[a-z][a-z0-9_-]{0,30}$/;
const INSTALL_ONLY = /^\s*wh-install(\s+[\w.+-]+)+\s*$/;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][0-9A-B]|\x1b[=>]|\r/g;

export const vmWanted = () => { try { return localStorage.getItem('wh:vm') === '1'; } catch { return false; } };
export const vmReady = () => typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

const script = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('failed to load ' + src)); document.head.append(s); });

// env = { token(repo, level) -> Promise<string>, trace: [], onStatus(text), mount(el) }
export function machine(env) {
  let booted = null, term = null, input = null, out = '', status = 'off', serial = Promise.resolve(), workers = [], loaded = false, gen = 0;
  const running = new Map(); // job id -> {cmd, user, t0, label}
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
    if (!loaded) { await script(ROOT + 'xterm-pty.js'); await script(ROOT + 'stack.js'); loaded = true; } // classic scripts: once per page
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
    const worker = new Worker(ROOT + 'worker.js?net=browser'), stackWorker = new Worker(ROOT + 'stack-worker.js?net=browser');
    workers = [worker, stackWorker];
    worker.addEventListener('message', e => { if (e.data?.whProgress != null) say(`downloading ${Math.round(e.data.whProgress * 100)}%`); });
    const stack = globalThis.newStack(worker, IMAGE, stackWorker, NET);
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
    // no echo, no prompt, no job notices: the console carries only what jobs print
    // and nothing else is sent until it has run: input queued while the tty's settings
    // change can be lost for good (seen: every later line dropped)
    const set = waitFor(/__WH_SET_ok__/, 60e3);
    input(`stty -echo 2>/dev/null; export PS1= PS2=; set +m; cd /root; mkdir -p ${JOBS}; chmod 700 ${JOBS}; echo __WH_SET_"ok"__\r`);
    await set;
    // runtime policy: a sleep ahead of the real one on PATH refuses long fixed waits
    // however they are spelled (the argument check only sees the literal call)
    // one line per script: the console takes lines of about 2,000 characters at most
    // sessions' own users read the proxy CA (TLS through the page's network) and use the install service
    await feed(['mkdir -p /usr/local/bin', ...put('/usr/local/bin/wh-install', INSTALL, '755'), ...put('/usr/local/bin/wh-installd', INSTALLD, '700'),
      `cp /.wasmenv/proxy.crt ${CA} 2>/dev/null; chmod 644 ${CA}; ( WH_SHELF='${SHELF}' /usr/local/bin/wh-installd </dev/null >/dev/null 2>&1 & )`,
      `export WH_SHELF='${SHELF}'`, ...put('/usr/local/bin/sleep', SLEEP_SHIM, '755'), 'hash -r']);
    // the network stack (a second wasm) can come up after the shell: wait for its
    // proxy port (polled every second, stops as soon as it answers, at most ~60 s)
    // so the first networked command does not race it
    say('waiting for the network');
    const net = waitFor(/__WH_NET_(up|down)__/, 75e3);
    input(`n=0; until timeout 1 bash -c '</dev/tcp/192.168.127.253/80' 2>/dev/null; do n=$((n+1)); [ $n -gt 60 ] && break; sleep 1; done; [ $n -gt 60 ] && echo __WH_NET_"down"__ || echo __WH_NET_"up"__\r`);
    const r = await net.catch(() => null);
    quiet--;
    note(r?.m[1] === 'up' ? 'machine ready' : 'machine ready (no network)');
    say(r?.m[1] === 'up' ? 'ready' : 'ready (no network)');
  }

  // the lines that write a file through the console (each well under its line limit)
  function put(path, text, mode) {
    return [...chunks(btoa(text), path + '.b64'), `cat ${path}.b64.* | base64 -d > ${path} && rm -f ${path}.b64.* && chmod ${mode} ${path}`];
  }
  // base64 in numbered chunk files: each line can be sent again without harm
  const chunks = (b, base) => { const out = [`rm -f ${base}.*`]; for (let i = 0, n = 0; i < b.length; i += 1500, n++) out.push(`printf %s ${b.slice(i, i + 1500)} > ${base}.${String(n).padStart(5, '0')}`); return out; };
  // Flow control: the guest's tty drops input that arrives faster than the shell
  // reads it (a few KB in one burst leaves the shell mid-line). Lines go in batches
  // of about 2.5 KB; each batch ends with an echo the harness waits for.
  async function feed(lines) {
    const tag = Math.random().toString(36).slice(2, 8);
    let batch = [], size = 0, k = 0;
    // a lost batch is sent once more (after Ctrl-C clears a half-read line); every line is safe to repeat
    const flush = async () => {
      if (!batch.length) return;
      for (let attempt = 0; ; attempt++) {
        const n = ++k, ack = waitFor(new RegExp(`__WH_A_${tag}_${n}__`), 180e3); // computed below, so an echoed line does not match
        for (const l of batch) input(l + '\r');
        input(`echo __WH_A_${tag}_$((${n}+0))__\r`);
        try { await ack; break; } catch (e) { if (attempt) throw new Error(`the machine’s console stopped reading input (batch ${k}: ${batch.map(l => l.slice(0, 60)).join(' | ')})`); input('\x03'); note('console input was lost; sent again'); }
      }
      batch = []; size = 0;
    };
    for (const l of lines) { if (size + l.length > 2500) await flush(); batch.push(l); size += l.length + 1; }
    await flush();
  }
  function waitFor(re, ms) {
    return new Promise((ok, no) => {
      let buf = '';
      const f = s => { buf += s; const m = re.exec(buf.replace(ANSI, '')); if (m) { listeners.delete(f); clearTimeout(t); ok({ m, buf }); } };
      const t = setTimeout(() => { listeners.delete(f); no(Object.assign(new Error('timeout'), { buf })); }, ms);
      listeners.add(f);
    });
  }

  // Run a bash script; returns { out, code, timedOut }. Each command is a job: its
  // script goes in as base64 lines (well under the tty's line limit), runs in the
  // background with its output in a file, and is read back when it ends. So jobs
  // from several sessions run at once, and the console only carries short lines.
  //   opt.user     run as this unix user (created on first use, home 700), not root
  //   opt.quotaMB  refuse to start once the user's home is over this size; also the per-file cap
  //   opt.quiet    a harness command: one line in harness activity, not drawn in the terminal
  const one = f => (serial = serial.then(f, f)); // console writes and reads, one at a time
  async function exec(cmd, timeoutS = 120, opt = {}) {
    if (!booted) booted = boot().catch(e => { booted = null; say('failed: ' + e.message); throw e; });
    await booted;
    const user = opt.user && USER_RE.test(opt.user) && !INSTALL_ONLY.test(cmd) ? opt.user : ''; // packages go in as root
    if (!opt.quiet) view({ k: 'in', text: opt.display ?? cmd, by: opt.by || 'model', session: opt.session, user });
    const t0 = Date.now();
    const r = await job(cmd, timeoutS, { ...opt, user });
    if (!opt.quiet) view({ k: 'out', text: r.out ? r.out + '\n' : '', session: opt.session, code: r.code, timedOut: r.timedOut });
    else if (!opt.silent) event({ label: opt.label || 'harness command', ms: Date.now() - t0, bytes: (r.out || '').length, code: r.code, timedOut: r.timedOut });
    return r;
  }
  async function job(cmd, timeoutS, opt) {
    const id = Math.random().toString(36).slice(2, 10), J = `${JOBS}/${id}`, my = gen;
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(cmd)));
    const lines = chunks(b64, J + '.b64');
    const u = opt.user, q = Math.max(0, Math.floor(Number(opt.quotaMB) || 0));
    let pre = '', run = `bash ${J}.sh`;
    if (u) {
      pre = `id ${u} >/dev/null 2>&1 || adduser -D -s /bin/bash ${u} >/dev/null 2>&1; chmod 700 /home/${u}; mkdir -p /home/${u}/.wh; chown ${u}:${u} /home/${u}/.wh; install -o ${u} -g ${u} -m 600 ${J}.sh /home/${u}/.wh/${id}.sh; `
        + (q ? `if [ "$(du -sm /home/${u} | cut -f1)" -gt ${q} ]; then echo "quota: /home/${u} is over ${q} MB; delete files to go on" > ${J}.out; echo "__WH_D_${id}_122__"; exit; fi; ` : '');
      run = `su -s /bin/bash ${u} -c 'cd; export SSL_CERT_FILE=${CA} GIT_SSL_CAINFO=${CA}; ${q ? `ulimit -f ${q * 1024}; ` : ''}bash ~/.wh/${id}.sh; s=$?; rm -f ~/.wh/${id}.sh; exit $s'`;
    }
    lines.push(`[ -e ${J}.go ] || { : > ${J}.go; cat ${J}.b64.* | base64 -d > ${J}.sh; rm -f ${J}.b64.*; ( ( ${pre}timeout -k 5 -s INT ${timeoutS} ${run} </dev/null > ${J}.out 2>&1; echo "__WH_D_${id}_$?__" ) & ); }`);
    running.set(id, { cmd: opt.display ?? cmd, user: u, t0: Date.now(), label: opt.label, session: opt.session });
    let code = null, timedOut = false;
    try {
      const done = waitFor(new RegExp(`__WH_D_${id}_(\\d+)__`), (timeoutS + 20) * 1000);
      await one(() => feed(lines));
      try { code = Number((await done).m[1]); } catch { timedOut = true; await cancel(id); }
      if (my !== gen) return { out: 'the machine restarted while this ran', code: null, timedOut: true };
      if (code === 124 || code === 137) timedOut = true;
      const outText = await read(id, opt.maxOut || 4e6);
      return { out: outText, code: timedOut ? null : code, ...(timedOut ? { timedOut: true } : {}) };
    } finally { running.delete(id); }
  }
  // read a job's output back (between its own start and end markers), then remove its files
  function read(id, max) {
    return one(async () => {
      quiet++;
      try {
        const got = waitFor(new RegExp(`__WH_R_${id}__`), 120e3);
        input(`echo __WH_S_${id}__; head -c ${Math.floor(max)} ${JOBS}/${id}.out 2>/dev/null; echo; echo __WH_R_${id}__; rm -f ${JOBS}/${id}.*\r`);
        const { m, buf } = await got;
        const text = buf.replace(ANSI, '');
        const start = text.indexOf(`__WH_S_${id}__`);
        return text.slice(start < 0 ? 0 : start + `__WH_S_${id}__`.length, text.lastIndexOf(`__WH_R_${id}__`))
          .replace(/__WH_D_[a-z0-9]+_\d+__\n?/g, '').replace(/^\n+|\n+$/g, '');
      } catch (e) { return String(e.buf || '').replace(ANSI, '').trim(); }
      finally { quiet--; }
    });
  }
  // stop a job: GNU timeout passes the signal on to the job's process group
  const cancel = id => one(async () => input(`pkill -TERM -f '${JOBS}/${id}.sh|\\.wh/${id}\\.sh' 2>/dev/null\r`));

  // The homes (and accounts) as a gzipped tar, for a restart: base64 text, or
  // {tooBig: bytes} when it is over maxBytes.
  async function save(maxBytes = 4e6) {
    const r = await exec(`cd / && tar -czf ${JOBS}/state.tgz --exclude='home/*/.cache' --exclude='home/*/.wh' --exclude=root/.cache home root etc/passwd etc/group etc/shadow 2>/dev/null; n=$(wc -c < ${JOBS}/state.tgz); if [ "$n" -gt ${Math.floor(maxBytes)} ]; then echo "TOOBIG $n"; else base64 -w0 ${JOBS}/state.tgz; fi; rm -f ${JOBS}/state.tgz`, 600, { quiet: true, label: 'save the homes for a restart', maxOut: maxBytes * 1.4 + 1000 });
    const big = /^TOOBIG (\d+)/.exec(r.out);
    return big ? { tooBig: Number(big[1]) } : { data: r.out.replace(/\s+/g, ''), bytes: Math.floor(r.out.length * 3 / 4) };
  }
  const restore = data => exec(`base64 -d > /var/wh-restore.tgz <<'WH_STATE'\n${data.replace(/(.{76})/g, '$1\n')}\nWH_STATE\ntar -xzf /var/wh-restore.tgz -C / && echo restored; rm -f /var/wh-restore.tgz`, 900, { quiet: true, label: 'restore the saved homes' });
  // stop the emulator; the next command boots a fresh one
  function stop() {
    gen++;
    for (const w of workers) { try { w.terminate(); } catch {} }
    workers = []; booted = null; input = null; quiet = 0; serial = Promise.resolve();
    for (const f of [...listeners]) listeners.delete(f);
    say('off');
    note('machine stopped');
  }

  return {
    status: () => status,
    run: (cmd, timeoutS, opt) => exec(cmd, timeoutS, opt),
    jobs: () => [...running.entries()].map(([id, j]) => ({ id, ...j, ms: Date.now() - j.t0 })),
    cancel, save, restore, stop,
    send: data => input?.(data),
    raw: (n = 4000) => out.slice(-n).replace(ANSI, ''), // the console's last bytes, for diagnosis
    onOutput: f => { listeners.add(f); return () => listeners.delete(f); },
    onView: f => { viewers.add(f); return () => viewers.delete(f); },
    onEvent: f => { watchers.add(f); return () => watchers.delete(f); },
    event,
    typed: text => view({ k: 'in', text, by: 'you' }),
  };
}
