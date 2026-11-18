// Replay server: serves the app and answers the chat API from a .trace file,
// so the real provider code path runs without reaching the upstream host.
//
//   node scripts/replay.mjs FILE.trace [port] [--fast]
//   open http://localhost:PORT/ and set "API base URL" to http://localhost:PORT/api/v1
//
// Each POST /api/v1/chat/completions gets the next recorded exchange: same
// status, same raw chunks, same timing (--fast drops the delays). The console
// reports whether the incoming body matches the recorded one, which is how a
// change to request assembly is checked against a real session.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const fast = process.argv.includes('--fast');
const file = args[0], port = Number(args[1] || 8788);
if (!file) { console.error('usage: node scripts/replay.mjs FILE.trace [port] [--fast]'); process.exit(1); }
const exchanges = JSON.parse(fs.readFileSync(file, 'utf8')).exchanges.filter(x => x.status);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let next = 0;

function diff(a, b) {
  if (a === b) return 'request matches recording';
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `request DIFFERS at char ${i}\n    recorded: ${a.slice(Math.max(0, i - 30), i + 50)}\n    received: ${b.slice(Math.max(0, i - 30), i + 50)}`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (url.pathname === '/api/v1/models') {
    const ids = [...new Set(exchanges.map(x => x.request.model))];
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: ids.map(id => ({ id, name: id })) }));
  }
  if (url.pathname === '/api/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    const n = next, x = exchanges[next++ % exchanges.length];
    let note;
    try { note = diff(JSON.stringify(x.request), JSON.stringify(JSON.parse(body))); } catch { note = 'request is not JSON'; }
    console.log(`#${n + 1} -> exchange ${n % exchanges.length + 1}/${exchanges.length} (${x.status}, ${x.chunks.length} chunks): ${note}`);
    res.writeHead(x.status, { 'Content-Type': x.status === 200 ? 'text/event-stream' : 'application/json', 'Cache-Control': 'no-cache' });
    let at = 0;
    for (const [ms, text] of x.chunks) {
      if (!fast) await sleep(Math.max(0, ms - at));
      at = ms;
      if (res.destroyed) return;
      res.write(text);
    }
    return res.end();
  }
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
  const f = path.join(root, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f));
}).listen(port, () => console.log(`replaying ${exchanges.length} exchanges from ${file} on http://localhost:${port}/ (API base: http://localhost:${port}/api/v1)`));
