// Repository tools, the network sandbox and the debug bridge, against a fake
// api.github.com served from Playwright routes (offline, mock model provider).
// Usage: python3 -m http.server 8787 (repo root), then: node scripts/smoke-git.mjs [url]
import { createRequire } from 'node:module';
import { createHash, randomBytes, webcrypto, generateKeyPairSync, createVerify } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:8787/';
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const TOKEN = 'github_pat_TESTTOKEN_' + 'x'.repeat(20);

// ---- fake GitHub: one repo o/r, branches as {sha, files} ----
const sha = () => randomBytes(20).toString('hex');
const branches = { main: { sha: sha(), files: { 'a.txt': 'hello world\n', 'src/x.js': 'x' } } };
const seen = []; // [method, path, body]
const b64 = s => Buffer.from(s).toString('base64');
const etagOf = v => '"' + createHash('sha1').update(JSON.stringify(v)).digest('hex') + '"';
// GitHub App: a PKCS#1 key as GitHub issues it; minted tokens carry permissions
const { privateKey: PEM, publicKey: PUB } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const mints = [], minted = {}, used = []; // used: [path, perms of the token]
function jwtOk(h) {
  const [a, b, c] = (h || '').replace('Bearer ', '').split('.');
  if (!c) return false;
  const v = createVerify('RSA-SHA256'); v.update(a + '.' + b);
  const claims = JSON.parse(Buffer.from(b, 'base64url'));
  return v.verify(PUB, Buffer.from(c, 'base64url')) && claims.iss === '123' && claims.exp > Date.now() / 1000;
}
const need = (method, path) => method === 'GET' ? ['contents', 'read'] : /\/pulls$/.test(path) ? ['pull_requests', 'write'] : ['contents', 'write'];
function api(method, path, q, body, headers) {
  if (path === '/app') return jwtOk(headers.authorization) ? [200, { slug: 'wh-test', installations_count: 1 }] : [401, { message: 'bad jwt' }];
  if (path === '/repos/o/r/installation') return jwtOk(headers.authorization) ? [200, { id: 99 }] : [401, { message: 'bad jwt' }];
  if (path === '/app/installations/99/access_tokens') {
    if (!jwtOk(headers.authorization)) return [401, { message: 'bad jwt' }];
    const t = 'ghs_' + randomBytes(12).toString('hex');
    minted[t] = body; mints.push(body);
    return [201, { token: t, expires_at: new Date(Date.now() + 3600e3).toISOString() }];
  }
  const tok = (headers.authorization || '').replace('Bearer ', '');
  if (minted[tok]) {
    const [perm, lvl] = need(method, path), has = minted[tok].permissions[perm];
    used.push([method + ' ' + path, minted[tok].permissions]);
    if (!(has === 'write' || has === lvl) || !minted[tok].repositories.includes('r')) return [403, { message: 'Resource not accessible by integration' }];
  } else if (tok !== TOKEN) return [401, { message: 'Bad credentials' }];
  let m;
  if (path === '/user') return [200, { login: 'tester' }];
  if (path === '/repos/o/r') return [200, { default_branch: 'main' }];
  if ((m = /^\/repos\/o\/r\/git\/ref\/heads\/(.+)$/.exec(path))) { const b = branches[decodeURIComponent(m[1])]; return b ? [200, { object: { sha: b.sha } }] : [404, { message: 'Not Found' }]; }
  if (path === '/repos/o/r/git/refs' && method === 'POST') {
    const from = Object.values(branches).find(b => b.sha === body.sha);
    branches[body.ref.replace('refs/heads/', '')] = { sha: body.sha, files: { ...from.files } };
    return [201, {}];
  }
  if ((m = /^\/repos\/o\/r\/contents\/(.*)$/.exec(path))) {
    const p = m[1].split('/').map(decodeURIComponent).join('/');
    const br = branches[q.get('ref') || body?.branch || 'main'];
    if (!br) return [404, { message: 'No commit found for the ref' }];
    if (method === 'PUT') { br.files[p] = Buffer.from(body.content, 'base64').toString(); br.sha = sha(); return [201, { content: { path: p } }]; }
    if (br.files[p] != null) return [200, { type: 'file', path: p, sha: 'blob', encoding: 'base64', content: b64(br.files[p]) }];
    const list = Object.keys(br.files).filter(f => f.startsWith(p + '/')).map(f => ({ name: f.slice(p.length + 1), path: f, type: 'file' }));
    return list.length ? [200, list, { etag: etagOf(list) }] : [404, { message: 'Not Found' }];
  }
  if (path === '/graphql') {
    const i = body.variables.i, br = branches[i.branch.branchName];
    if (br.sha !== i.expectedHeadOid) return [200, { errors: [{ message: 'Expected branch to point to ' + i.expectedHeadOid }] }];
    for (const a of i.fileChanges.additions) br.files[a.path] = Buffer.from(a.contents, 'base64').toString();
    for (const d of i.fileChanges.deletions) delete br.files[d.path];
    br.sha = sha();
    return [200, { data: { createCommitOnBranch: { commit: { oid: br.sha, url: 'https://github.com/o/r/commit/' + br.sha } } } }];
  }
  if (path === '/repos/o/r/pulls' && method === 'POST') return [201, { number: 7, head: { ref: body.head }, base: { ref: body.base }, html_url: 'https://github.com/o/r/pull/7' }];
  return [404, { message: 'no fake for ' + method + ' ' + path }];
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('https://api.github.com/**', async route => {
  const r = route.request(), u = new URL(r.url());
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, if-none-match', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-expose-headers': 'ETag' };
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const body = r.postData() ? JSON.parse(r.postData()) : null;
  seen.push([r.method(), u.pathname, body]);
  const [status, json, extra = {}] = api(r.method(), u.pathname, u.searchParams, body, r.headers());
  if (extra.etag && r.headers()['if-none-match'] === extra.etag) return route.fulfill({ status: 304, headers: { ...cors, etag: extra.etag } });
  return route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', ...extra }, body: JSON.stringify(json) });
});

// ---- bridge pairing (the page side reads it from the fragment) ----
const KEY = randomBytes(32);
const b64u = { enc: b => Buffer.from(b).toString('base64url'), dec: s => Buffer.from(s.trim(), 'base64url') };
const ck = await webcrypto.subtle.importKey('raw', KEY, 'AES-GCM', false, ['encrypt', 'decrypt']);
const seal = async o => { const iv = webcrypto.getRandomValues(new Uint8Array(12)); return b64u.enc(Buffer.concat([iv, new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, ck, Buffer.from(JSON.stringify(o))))])); };
const open = async t => { const b = b64u.dec(t); return JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, ck, b.subarray(12))).toString()); };
branches['bridge/t1'] = { sha: sha(), files: { 'README.md': 'x', 'down/.keep': '' } };
const upEvents = async () => { const out = []; for (const [f, t] of Object.entries(branches['bridge/t1'].files).sort()) if (f.startsWith('up/')) out.push(...await open(t)); return out; };
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 250)); } };

await page.goto(url);
await page.evaluate(t => { localStorage.setItem('wh:keys', JSON.stringify({ github: t })); }, TOKEN);
await page.goto(url + '#bridge=o/r~bridge/t1~' + b64u.enc(KEY));
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1');
await page.dispatchEvent('#model', 'change');

check('bridge: fragment removed from the address bar', !page.url().includes('#'));
const hello = await until(async () => (await upEvents()).find(e => e.type === 'hello'));
check('bridge: hello arrives encrypted on the branch', hello?.data?.build && !JSON.stringify(branches['bridge/t1'].files).includes('"build"'));

// the session list: new sessions get repo tools while a token is set
await page.click('[data-act=new]');
const say = async text => {
  await page.fill('#input', text);
  await page.press('#input', 'Enter');
  await page.waitForSelector('#app[data-busy]', { state: 'attached' });
};
const idle = () => page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
const thread = () => page.locator('.thread:visible');

await say('repo read please'); await idle();
check('repo_read: returns the file text', /hello world/.test(await thread().locator('.msg[data-role=tool] pre').last().textContent()));
const sent = await page.evaluate(() => document.querySelector('#req').textContent);
check('repo tools are in this session\'s request', /"repo_commit"/.test(sent));

await say('repo commit please');
await page.waitForSelector('.thread:visible .msg[data-role=approve] button');
const card = await thread().locator('.msg[data-role=approve]').last().textContent();
check('approval card shows the resolved change, not the model\'s words', /o\/r feat \(new, from main\)/.test(card) && /edit a.txt \(\d+ chars, 1 edits\)/.test(card) && /write b.txt/.test(card));
check('approve: nothing was written before the click', !seen.some(([m, p]) => p === '/graphql'));
await thread().locator('.msg[data-role=approve] button', { hasText: 'allow' }).click();
await idle();
check('repo_commit: edits applied at the branch head, one commit', branches.feat?.files['a.txt'] === 'goodbye world\n' && branches.feat.files['b.txt'] === 'new file' && branches.main.files['a.txt'] === 'hello world\n');
check('repo_commit: result names the commit', /^[0-9a-f]{7} on feat \(new branch from main\): 2 files/.test(await thread().locator('.msg[data-role=tool] pre').last().textContent()));

await say('repo pr please');
await page.waitForSelector('.thread:visible .msg[data-role=approve]:not([data-done]) button');
await thread().locator('.msg[data-role=approve]:not([data-done]) button', { hasText: 'deny' }).click();
await idle();
check('repo_pr: declined means nothing is opened', /Not opened: the user declined/.test(await thread().locator('.msg[data-role=tool] pre').last().textContent()) && !seen.some(([m, p]) => p === '/repos/o/r/pulls'));

// ---- sandbox ----
const run = code => page.evaluate(async c => (await import('./app/tools.js')).runJs({ code: c }), code);
check('sandbox: code runs', await run('return 6*7') === '42');
check('sandbox: no network', /^net blocked/.test(await run('try { await fetch("http://localhost:8787/"); return "OPEN" } catch (e) { return "net blocked" }')));
check('sandbox: no page storage', /^Error: .*(SecurityError|localStorage|not defined|denied)/i.test(await run('return localStorage.getItem("wh:keys")')) || await run('return typeof localStorage') === 'undefined');
check('sandbox: infinite loop is killed', /Timed out/.test(await page.evaluate(async () => (await import('./app/tools.js')).runJs({ code: 'for(;;){}' }, null, 800))));

// ---- bridge directives ----
const directive = async (name, args = {}) => {
  const id = 'd' + randomBytes(4).toString('hex');
  const b = branches['bridge/t1'];
  b.files[`down/${Date.now()}-${id}.txt`] = await seal({ id, t: Date.now(), do: name, args });
  b.sha = sha();
  return until(async () => (await upEvents()).find(e => e.type === 'reply' && e.data.re === id)?.data, 20000);
};
const st = await directive('state');
check('bridge: state directive answered', st?.ok && st.data.sessions.length >= 2);
check('bridge: replies never carry the token', !(await upEvents()).some(e => JSON.stringify(e).includes(TOKEN)) && JSON.stringify(await directive('dom', { sel: '#ghkey', html: true })).includes('ghkey'));
const tr = await directive('trace');
check('bridge: trace has the GitHub calls without the Authorization header', tr?.ok && tr.data.some(r => /graphql/.test(r.url)) && !JSON.stringify(tr.data).includes(TOKEN));
const ev = await upEvents();
check('bridge: trace records and approvals were pushed on their own', ev.some(e => e.type === 'trace') && ev.some(e => e.type === 'approve'));
const pend = directive('send', { text: 'hello' });
await page.waitForSelector('#bridgebar [data-bask] button');
await page.click('#bridgebar [data-bask] button:has-text("deny")');
check('bridge: send waits for a click; deny is reported', /declined by the user/.test((await pend)?.error || ''));
const unknown = await directive('eval', { code: '1' });
check('bridge: unknown directives are refused', unknown && !unknown.ok && /unknown directive/.test(unknown.error));

// ---- GitHub App mode: no pasted token, tokens minted per repository and permission ----
await page.evaluate(pem => { localStorage.setItem('wh:keys', JSON.stringify({ ghapp: { appId: '123', pem } })); }, PEM);
await page.reload();
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1');
await page.dispatchEvent('#model', 'change');
await page.click('[data-act=ghcheck]');
check('app: check signs a JWT from the PKCS#1 key', await until(async () => /app wh-test/.test(await page.textContent('#ghwho'))));
await page.click('[data-act=new]');
branches.feat.files['a.txt'] = 'hello again\n';
await say('repo read please'); await idle();
await say('repo commit please');
await page.waitForSelector('.thread:visible .msg[data-role=approve]:not([data-done]) button');
await thread().locator('.msg[data-role=approve]:not([data-done]) button', { hasText: 'allow' }).click();
await idle();
check('app: commit landed using minted tokens', branches.feat.files['a.txt'] === 'goodbye again\n', await thread().locator('.msg[data-role=tool] pre').last().textContent());
check('app: each token is for repo r only, at the level asked', mints.length >= 2 && mints.every(m => m.repositories.join() === 'r') && mints.some(m => m.permissions.contents === 'read' && Object.keys(m.permissions).length === 1) && mints.some(m => m.permissions.contents === 'write'));
check('app: reads used a read-only token, the commit a write token', used.filter(([p]) => p.startsWith('GET /repos/o/r/contents/a.txt')).some(([, pm]) => pm.contents === 'read') && used.some(([p, pm]) => p === 'POST /graphql' && pm.contents === 'write'));
const allUp = JSON.stringify(await upEvents());
check('app: neither the key nor a minted token leaves the page', !allUp.includes('BEGIN RSA') && !Object.keys(minted).some(t => allUp.includes(t)));

check('no page errors', errors.filter(e => !/Failed to load resource|ERR_/.test(e)).length === 0, errors.join(' | '));
await browser.close();
