#!/usr/bin/env node
// Agent side of the debug bridge (app/bridge.js). The channel is a git branch:
// the page commits up/*.txt through the GitHub API, this script pushes down/*.txt
// with plain git. Payloads are AES-GCM ciphertext; the key is only in the
// pairing link's fragment and in DIR/pair.json.
//
//   node scripts/bridge.mjs pair --repo OWNER/NAME --page URL [--dir D]
//        creates branch bridge/<id> (orphan, one README) and prints the link to open
//   node scripts/bridge.mjs listen [--dir D]          fetch every 3 s; new events go to D/inbox.jsonl, one summary line each
//   node scripts/bridge.mjs do NAME [JSON] [--dir D] [--wait S] [--out F]
//        push a directive and print the reply (needs listen running)
//   node scripts/bridge.mjs show N [--dir D]          last N inbox entries in full
//   node scripts/bridge.mjs close [--dir D]           delete the remote branch
//
// D defaults to ~/.webharness-bridge. Keep pair.json out of git.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, webcrypto } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args.splice(i, 2)[1] : d; };
const dir = flag('dir', join(homedir(), '.webharness-bridge'));
const page = flag('page', '');
const repoArg = flag('repo', '');
const remoteArg = flag('remote', ''); // tests: a local bare repo instead of github.com
const wait = Number(flag('wait', 90));
const outFile = flag('out', '');
const [cmd, ...rest] = args;
mkdirSync(dir, { recursive: true });
const pairFile = join(dir, 'pair.json'), inbox = join(dir, 'inbox.jsonl');
const pair = () => JSON.parse(readFileSync(pairFile, 'utf8'));
const b64u = { enc: b => Buffer.from(b).toString('base64url'), dec: s => Buffer.from(s.trim(), 'base64url') };
const key = async () => webcrypto.subtle.importKey('raw', b64u.dec(pair().key), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(obj) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(obj))));
  return b64u.enc(Buffer.concat([iv, ct]));
}
async function open(text) {
  const b = b64u.dec(text);
  return JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, await key(), b.subarray(12))));
}
const git = (cwd, ...a) => execFileSync('git', a, { cwd, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const remoteUrl = p => p.remote || `https://github.com/${p.repo}.git`;

function init(d) {
  mkdirSync(d, { recursive: true });
  if (existsSync(join(d, '.git'))) return d;
  git(d, 'init', '-q');
  git(d, 'remote', 'add', 'origin', remoteUrl(pair()));
  git(d, 'config', 'user.name', 'webharness-bridge');
  git(d, 'config', 'user.email', 'bridge@users.noreply.github.com');
  return d;
}
// two clones: rx is only fetched (listen), tx is committed to (do), so they never share an index
const fetchTo = d => git(d, 'fetch', '-q', 'origin', `+refs/heads/${pair().branch}:refs/remotes/origin/bridge`);

function summary(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'hello': return `hello build ${d.build} ${d.ref ? 'ref ' + d.ref : ''} ${d.provider}/${d.model} sessions ${d.sessions}`;
    case 'trace': return `trace ${d.status} ${d.request?.model || d.request?.method || ''} ${String(d.url || '').replace(/^https:\/\/[^/]+/, '')} ${d.ms}ms${d.error ? ' ERROR ' + d.error.slice(0, 160) : ''}`;
    case 'reply': return `reply ${d.re} ${d.ok ? 'ok ' + JSON.stringify(d.data).slice(0, 160) : 'FAIL ' + d.error}`;
    case 'error': return `ERROR ${d.message} ${d.at}`;
    case 'console': return `console.${d.lvl} ${d.text.slice(0, 200)}`;
    case 'notice': return `notice ${d.session}: ${d.text.slice(0, 200)}`;
    case 'approve': return `approve? ${d.what?.what} ${d.what?.repo} ${d.what?.branch || d.what?.head}`;
    default: return e.type + ' ' + JSON.stringify(d).slice(0, 160);
  }
}

if (cmd === 'pair') {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoArg) || !/^https?:\/\//.test(page)) { console.error('pair needs --repo OWNER/NAME and --page URL (the page to open)'); process.exit(1); }
  const id = randomBytes(6).toString('hex');
  writeFileSync(pairFile, JSON.stringify({ repo: repoArg, remote: remoteArg || undefined, branch: 'bridge/' + id, key: b64u.enc(randomBytes(32)), created: new Date().toISOString() }), { mode: 0o600 });
  for (const f of ['seen', 'inbox.jsonl']) if (existsSync(join(dir, f))) writeFileSync(join(dir, f), '');
  const { repo, branch, key: k } = pair();
  const d = join(dir, 'tx-' + id);
  init(d);
  git(d, 'checkout', '-q', '--orphan', branch);
  mkdirSync(join(d, 'down'), { recursive: true });
  writeFileSync(join(d, 'README.md'), 'Debug bridge channel for WebHarness. Encrypted; safe to delete.\n');
  writeFileSync(join(d, 'down', '.keep'), '');
  git(d, 'add', '-A');
  git(d, 'commit', '-qm', 'open bridge');
  git(d, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  console.log(`${page}#bridge=${repo}~${branch}~${k}`);
} else if (cmd === 'listen') {
  const id = pair().branch.split('/').pop();
  const d = init(join(dir, 'rx-' + id));
  const seenFile = join(dir, 'seen');
  const seen = new Set(existsSync(seenFile) ? readFileSync(seenFile, 'utf8').split('\n') : []);
  console.log(`listening on ${pair().repo} ${pair().branch}`);
  for (;;) {
    try {
      fetchTo(d);
      const names = git(d, 'ls-tree', '--name-only', 'refs/remotes/origin/bridge', 'up/').split('\n').filter(n => n.endsWith('.txt') && !seen.has(n)).sort();
      for (const n of names) {
        seen.add(n); appendFileSync(seenFile, n + '\n');
        try {
          for (const e of await open(git(d, 'show', 'refs/remotes/origin/bridge:' + n))) { appendFileSync(inbox, JSON.stringify(e) + '\n'); console.log(summary(e)); }
        } catch (err) { console.log(`dropped ${n}: ${err.message}`); }
      }
    } catch (err) { console.log('fetch failed: ' + String(err.stderr || err.message).trim().slice(0, 200)); }
    await sleep(3000);
  }
} else if (cmd === 'do') {
  const [name, json] = rest;
  const id = 'd' + randomBytes(5).toString('hex');
  const d = init(join(dir, 'tx-' + pair().branch.split('/').pop()));
  const text = await seal({ id, t: Date.now(), do: name, args: json ? JSON.parse(json) : {} });
  for (let i = 0; ; i++) { // the page commits to the same branch, so retry when the head moved
    try {
      fetchTo(d);
      git(d, 'checkout', '-q', '-B', 'work', 'refs/remotes/origin/bridge');
      mkdirSync(join(d, 'down'), { recursive: true });
      writeFileSync(join(d, 'down', `${Date.now()}-${id}.txt`), text);
      git(d, 'add', 'down');
      git(d, 'commit', '-qm', 'bridge down');
      git(d, 'push', '-q', 'origin', `HEAD:refs/heads/${pair().branch}`);
      break;
    } catch (err) {
      if (i >= 5) { console.error('push failed: ' + String(err.stderr || err.message).trim()); process.exit(1); }
      await sleep(1500 * (i + 1));
    }
  }
  const find = () => existsSync(inbox) && readFileSync(inbox, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.type === 'reply' && e.data?.re === id);
  const t0 = Date.now();
  for (;;) {
    const r = find();
    if (r) {
      const s = JSON.stringify(r.data, null, 1);
      if (outFile) { writeFileSync(outFile, s); console.log(`reply ${r.data.ok ? 'ok' : 'FAIL'} -> ${outFile} (${s.length} chars)`); } else console.log(s);
      break;
    }
    if (Date.now() - t0 > wait * 1000) { console.log(`no reply to ${id} within ${wait}s (listen running? page open with the bridge on and a GitHub token set?)`); process.exitCode = 2; break; }
    await sleep(500);
  }
} else if (cmd === 'show') {
  const lines = existsSync(inbox) ? readFileSync(inbox, 'utf8').split('\n').filter(Boolean) : [];
  for (const l of lines.slice(-Number(rest[0] || 5))) console.log(JSON.stringify(JSON.parse(l), null, 1));
} else if (cmd === 'close') {
  git(init(join(dir, 'tx-' + pair().branch.split('/').pop())), 'push', '-q', 'origin', '--delete', pair().branch);
  console.log('deleted ' + pair().branch);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 16).join('\n'));
}
