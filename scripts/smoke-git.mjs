// Repository tools, the network sandbox and the debug bridge, against a fake
// api.github.com served from Playwright routes (offline, mock model provider).
// Usage: python3 -m http.server 8787 (repo root), then: node scripts/smoke-git.mjs [url]
import { createRequire } from 'node:module';
import { createHash, randomBytes, webcrypto, generateKeyPairSync, createVerify } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:8787/';
// live values are slots (styles.js): read them with their data-v values
const slotOf = sel => page.evaluate(async s => (await import('./app/styles.js')).slotText(document.querySelector(s)), sel);
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) process.exitCode = 1; };
const TOKEN = 'github_pat_TESTTOKEN_' + 'x'.repeat(20);

// ---- fake GitHub: one repo o/r, branches as {sha, files} ----
const sha = () => randomBytes(20).toString('hex');
const repos = { 'o/r': { main: { sha: sha(), files: { 'a.txt': 'hello world\n', 'src/x.js': 'x' } } } };
const branches = repos['o/r'];
const trees = {}, commits = {}, blobsMade = [];
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
  // any repo: paths are normalized to /repos/o/r and B is that repo's branches
  const repoName = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1] || body?.variables?.i?.branch?.repositoryNameWithOwner;
  let B = repos[repoName];
  if (repoName && !B && !/\/installation$/.test(path)) return [404, { message: 'Not Found' }];
  path = path.replace(/^\/repos\/[^/]+\/[^/]+/, '/repos/o/r');
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
    if (!(has === 'write' || has === lvl) || !minted[tok].repositories.includes((repoName || 'o/r').split('/')[1])) return [403, { message: 'Resource not accessible by integration' }];
  } else if (tok !== TOKEN) return [401, { message: 'Bad credentials' }];
  let m;
  if (path === '/user') return [200, { login: 'tester' }];
  if (path === '/user/repos') return [200, [...Object.keys(repos), 'x/other'].map(full_name => ({ full_name, permissions: { pull: true, push: true, admin: false } }))];
  if (path === '/repos/o/r/git/blobs' && method === 'POST') { blobsMade.push(repoName); return [201, { sha: sha() }]; }
  if (path === '/repos/o/r') return [200, { default_branch: 'main' }];
  if ((m = /^\/repos\/o\/r\/git\/ref\/heads\/(.+)$/.exec(path))) { const b = B[decodeURIComponent(m[1])]; return b ? [200, { object: { sha: b.sha } }] : [404, { message: 'Not Found' }]; }
  if (path === '/repos/o/r/git/trees' && method === 'POST') { const t = sha(); trees[t] = Object.fromEntries(body.tree.map(e => [e.path, e.content])); return [201, { sha: t }]; }
  if (path === '/repos/o/r/git/commits' && method === 'POST') { const c = sha(); commits[c] = { files: { ...trees[body.tree] } }; return [201, { sha: c }]; }
  if (path === '/repos/o/r/git/refs' && method === 'POST' && commits[body.sha]) { B[body.ref.replace('refs/heads/', '')] = { sha: body.sha, files: { ...commits[body.sha].files } }; return [201, {}]; }
  if (path === '/repos/o/r/git/refs' && method === 'POST') {
    const from = Object.values(B).find(b => b.sha === body.sha);
    B[body.ref.replace('refs/heads/', '')] = { sha: body.sha, files: { ...from.files } };
    return [201, {}];
  }
  if ((m = /^\/repos\/o\/r\/contents\/(.*)$/.exec(path))) {
    const p = m[1].split('/').map(decodeURIComponent).join('/').replace(/\/$/, '');
    const br = B[q.get('ref') || body?.branch || 'main'];
    if (!br) return [404, { message: 'No commit found for the ref' }];
    if (method === 'PUT') { br.files[p] = Buffer.from(body.content, 'base64').toString(); br.sha = sha(); return [201, { content: { path: p } }]; }
    if (br.files[p] != null) return [200, { type: 'file', path: p, sha: 'blob', encoding: 'base64', content: Buffer.isBuffer(br.files[p]) ? br.files[p].toString('base64') : b64(br.files[p]) }];
    // like GitHub: direct children only, folders as type dir
    const seenNames = new Set(), list = [];
    if (p === '' && !Object.keys(br.files).length) return [404, { message: 'This repository is empty.' }];
    for (const f of Object.keys(br.files).filter(f => p === '' || f.startsWith(p + '/'))) {
      const rest = p === '' ? f : f.slice(p.length + 1), name = rest.split('/')[0], dir = rest.includes('/');
      if (seenNames.has(name)) continue; seenNames.add(name);
      list.push({ name, path: (p ? p + '/' : '') + name, type: dir ? 'dir' : 'file' });
    }
    return list.length ? [200, list, { etag: etagOf(list) }] : [404, { message: 'Not Found' }];
  }
  if (path === '/graphql') {
    const i = body.variables.i, br = B[i.branch.branchName];
    if (br.sha !== i.expectedHeadOid) return [200, { errors: [{ message: 'Expected branch to point to ' + i.expectedHeadOid }] }];
    for (const a of i.fileChanges.additions) { const buf = Buffer.from(a.contents, 'base64'); br.files[a.path] = /\.(png|jpg|gif|webp|mp3|wav|ogg|mp4|webm)$/.test(a.path) ? buf : buf.toString(); }
    for (const d of i.fileChanges.deletions) delete br.files[d.path];
    br.sha = sha();
    return [200, { data: { createCommitOnBranch: { commit: { oid: br.sha, url: 'https://github.com/o/r/commit/' + br.sha } } } }];
  }
  if ((m = /^\/orgs\/([\w.-]+)\/repos$/.exec(path)) && method === 'POST') {
    const full = m[1] + '/' + body.name;
    repos[full] = { main: { sha: sha(), files: body.auto_init ? { 'README.md': '# ' + body.name } : {} } };
    return [201, { full_name: full, private: body.private, default_branch: 'main', html_url: 'https://github.com/' + full }];
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
await page.fill('#ghlabel', 'test token: o/r contents + PRs'); await page.dispatchEvent('#ghlabel', 'change');
await page.click('[data-act=ghcheck]');
await until(async () => /signed in as tester/.test(await slotOf('#ghwho')));
await page.click('[data-act=new]');
const say = async text => {
  await page.fill('#input', text);
  await page.click('#send');
  await page.waitForSelector('#app[data-busy]', { state: 'attached' });
};
const idle = () => page.waitForSelector('#app:not([data-busy])', { state: 'attached', timeout: 20000 });
const thread = () => page.locator('.thread:visible');

await say('repo read please'); await idle();
check('the model is told the GitHub access label and account', /github access: test token: o\/r contents \+ PRs · signed in as tester/.test(await thread().locator('.msg[data-role=user]').first().textContent()));
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

await page.uncheck('#repotools');
await say('hello'); await idle();
const toolNames = async () => (JSON.parse(await page.textContent('#req')).tools || []).map(t => t.function.name);
check('repository tools switch: off removes them from the next request', !(await toolNames()).includes('repo_commit'));
await page.check('#repotools');
await say('hello'); await idle();
check('repository tools switch: on adds them back, with the access line once in the log', (await toolNames()).includes('repo_commit') && /^github access: /m.test(await thread().locator('.msg[data-role=user] .txt').nth(-2).textContent()));

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
// the paired agent acts as the model: a turn goes up, the answer comes down as tool calls
await page.evaluate(() => { const k = JSON.parse(localStorage['wh:keys']); }); // keys unchanged
await page.selectOption('#provider', 'agent');
await page.fill('#model', 'agent'); await page.dispatchEvent('#model', 'change');
await page.click('[data-act=new]');
await page.fill('#input', 'create the repo'); await page.click('#send');
const turn = await until(async () => (await upEvents()).find(e => e.type === 'turn' && !e.seen)?.data);
check('agent provider: the request goes up as a turn with the tool list', turn?.tools?.includes('repo_create'));
const ans = await directive('answer', { turn: turn.turn, content: 'Creating it.', tool_calls: [{ name: 'repo_create', args: { owner: 'neworg', name: 'lab', description: 'made by the paired agent' } }] });
await page.waitForSelector('.thread:visible .msg[data-role=approve]:not([data-done]) button');
check('agent provider: answer accepted; approval card for the repository', ans?.ok && /neworg\/lab \(private\)/.test(await thread().locator('.msg[data-role=approve]').last().textContent()));
await thread().locator('.msg[data-role=approve]:not([data-done]) button', { hasText: 'allow' }).click();
const turn2 = await until(async () => (await upEvents()).filter(e => e.type === 'turn').at(-1)?.data?.turn !== turn.turn && (await upEvents()).filter(e => e.type === 'turn').at(-1).data);
check('repo_create: result goes back to the agent as the next turn', /neworg\/lab \(private, default branch main\)/.test(JSON.stringify(turn2?.tail)));
await directive('answer', { turn: turn2.turn, content: 'Done.' });
await page.waitForSelector('#app:not([data-busy])', { state: 'attached' });
await page.selectOption('#provider', 'mock');
const unknown = await directive('eval', { code: '1' });
check('bridge: unknown directives are refused', unknown && !unknown.ok && /unknown directive/.test(unknown.error));

// ---- log repo: cold start (create, layout), sync at session start, read-only for agents ----
await page.evaluate(() => { const i = document.querySelector('#logrepo'); i.value = 'o/logs'; i.dispatchEvent(new Event('change')); });
await page.evaluate(() => document.querySelector('[data-act=logsetup]').click());
await page.waitForSelector('.modal .primary');
check('log repo: creating it is asked in an in-page modal', /Create the log repo/.test(await page.textContent('.modal h3')));
await page.click('.modal .primary');
const ready = await until(async () => /ready \(schema 1\)|sync|failed|Not/.test(await slotOf('#logstat')) && /sync [^(]|nothing new|failed/.test(await slotOf('#logstat')) && await slotOf('#logstat'), 20000);
const L = repos['o/logs']?.main?.files || {};
check('log repo: created private and laid out on a cold start', !!repos['o/logs'] && JSON.parse(L['.harness/manifest.json'] || '{}').schema === 1 && /only writer/.test(L['README.md'] || ''), ready);
const smellFiles = Object.keys(L).filter(f => f.startsWith('smells/'));
const sessFiles = Object.keys(L).filter(f => /^sessions\/.+\.jsonl$/.test(f));
check('log repo: first sync wrote smells, session metrics and steering', Object.keys(L).some(f => /^steering\/\w+\.json$/.test(f)) && sessFiles.length === 1, Object.keys(L).join(' '));
const sessRows = (L[sessFiles[0]] || '').trim().split('\n').map(l => JSON.parse(l));
check('log repo: session rows are metrics only, no message text or keys', sessRows.length > 0 && sessRows.every(r => !('messages' in r) && !('title' in r)) && !Object.values(L).join('').includes(TOKEN));
await page.click('[data-act=new]');
await until(async () => /nothing new|sync /.test(await slotOf('#logstat')) && !/syncing/.test(await slotOf('#logstat')), 15000);
const L2 = repos['o/logs'].main.files;
check('log repo: a new session syncs again, append-only (no file rewritten)', Object.keys(L2).filter(f => /^sessions\//.test(f)).length >= 1 && L2[sessFiles[0]] === L[sessFiles[0]]);
const tools2 = await page.evaluate(async () => {
  const { client } = await import('./app/git.js');
  const c = client({ token: async () => 'github_pat_TESTTOKEN_' + 'x'.repeat(20), readOnly: () => ['o/logs'], confirm: async () => true });
  const read = await c.read({ repo: 'o/logs', op: 'file', path: 'README.md' }).then(t => t.slice(0, 20), e => 'ERR ' + e.message);
  const write = await c.commit({ repo: 'o/logs', branch: 'main', message: 'x', changes: [{ path: 'evil.txt', content: 'x' }] }).then(() => 'WROTE', e => e.message);
  return { read, write };
});
check('log repo: agents can read it but not write to it', /^# o\/logs/.test(tools2.read) && /read-only for this session/.test(tools2.write) && !/log repo/.test(tools2.write) && !repos['o/logs'].main.files['evil.txt'], JSON.stringify(tools2));

// ---- transcripts and artifacts on the wh-sessions branch ----
await page.click('[data-act=new]');
await say('my token is ' + TOKEN + ' please remember'); await idle();
await say('show an image please'); await idle();
await say('make it big'); await idle();
const bigOut = await thread().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent();
const bigHandle = /os:[a-z0-9]+/.exec(bigOut)?.[0];
await page.evaluate(() => document.querySelector('[data-act=logsync]').click());
await until(async () => !/syncing/.test(await slotOf('#logstat')) && /transcripts|messages/.test(await slotOf('#logstat')), 20000);
const T = repos['o/logs']['wh-sessions']?.files || {};
const sid = await page.evaluate(() => JSON.parse(localStorage['wh:meta']).active);
const chunkPath = Object.keys(T).find(f => f.startsWith(`sessions/${sid}/`) && f.endsWith('.jsonl'));
const chunkText = chunkPath ? T[chunkPath] : '';
const allChunks = Object.keys(T).filter(f => f.startsWith(`sessions/${sid}/`) && f.endsWith('.jsonl')).sort().map(f => T[f]).join('');
check('transcripts: an orphan branch holds the session as chunks, with meta', !!repos['o/logs']['wh-sessions'] && !!T[`sessions/${sid}/meta.json`] && !!chunkPath && !('README.md' in repos['o/logs'].main.files && T['.harness/manifest.json']), Object.keys(T).slice(0, 8).join(' '));
check('transcripts: credentials are masked', allChunks.includes('[key]') && !allChunks.includes(TOKEN));
const media = Object.keys(T).find(f => /^artifacts\/media\/\w+\.png$/.test(f));
check('transcripts: media leaves the line as a file (binary), the chunk keeps a reference', !!media && Buffer.isBuffer(T[media]) && T[media].slice(1, 4).toString() === 'PNG' && allChunks.includes('artifact:' + media.replace('artifacts/', '')) && !allChunks.includes('iVBORw0KGgo'));
check('transcripts: cited outputs are stored as artifacts', !!bigHandle && !!T[`artifacts/${bigHandle.replace(':', '_')}.txt`]);
await page.evaluate(() => new Promise(ok => { const r = indexedDB.open('webharness', 1); r.onsuccess = () => { const t = r.result.transaction('out', 'readwrite'); t.objectStore('out').clear(); t.oncomplete = ok; }; }));
await say('read ' + bigHandle); await idle();
check('artifacts: an output the browser lost comes back from the log repo', /line 399/.test(await thread().locator('.msg[data-role=tool] > details:not(.policy) pre').last().textContent()));
const before2 = Object.keys(repos['o/logs']['wh-sessions'].files).filter(f => f.startsWith(`sessions/${sid}/`)).length;
await page.evaluate(() => document.querySelector('[data-act=logsync]').click());
await until(async () => !/syncing/.test(await slotOf('#logstat')), 20000);
const after2 = Object.keys(repos['o/logs']['wh-sessions'].files).filter(f => f.startsWith(`sessions/${sid}/`));
check('transcripts: later syncs (after a turn, or by hand) append chunks; earlier ones untouched', after2.filter(f => f.endsWith('.jsonl')).length >= 2 && repos['o/logs']['wh-sessions'].files[chunkPath] === chunkText, after2.join(' '));
await page.evaluate(() => document.querySelector('[data-act=logbrowse]').click());
await page.waitForSelector('.modal .trec');
await until(async () => /messages/.test(await page.evaluate(id => [...document.querySelectorAll('.modal .trec')].map(b => b.textContent).join('|'), sid)), 10000);
await page.evaluate(id => [...document.querySelectorAll('.modal .trec')].find(b => /my token|messages/.test(b.textContent) && b.textContent.length)?.click(), sid);
await until(async () => await page.locator('.modal .trow').count() > 0, 10000);
check('transcripts: the viewer reads a session a chunk at a time', await page.locator('.modal .trow').count() > 0 && /load more/.test(await page.textContent('.modal .tmore')));
await page.click('.modal .primary');
await page.evaluate(() => { const c = document.querySelector('#sprivate'); c.checked = true; c.dispatchEvent(new Event('change')); });
await say('a private thought'); await idle();
await page.evaluate(() => document.querySelector('[data-act=logsync]').click());
await until(async () => !/syncing/.test(await slotOf('#logstat')), 20000);
check('transcripts: a session kept out of the log repo is not written', !Object.values(repos['o/logs']['wh-sessions'].files).some(t => typeof t === 'string' && t.includes('a private thought')));

// ---- log repo as a harness property of a profile ----
repos['o/logs-b'] = { main: { sha: sha(), files: {} } };
await page.evaluate(() => document.querySelector('[data-act=cfgpaste]').click());
await page.fill('.modal textarea', JSON.stringify({ profiles: [{ name: 'team-b', settings: { logRepo: 'o/logs-b' } }, { name: 'team-c', settings: { logRepo: 'o/nowhere' } }] }));
await page.click('.modal .primary');
const pickProfile = name => page.evaluate(name => { const sel = document.querySelector('#newprofile'); sel.value = [...sel.options].find(o => o.textContent === name).value; sel.dispatchEvent(new Event('change')); }, name);
await pickProfile('team-b');
await page.click('[data-act=new]');
await say('hello from team b'); await idle();
const sidB = await page.evaluate(() => JSON.parse(localStorage['wh:meta']).active);
await pickProfile('team-c');
await page.click('[data-act=new]');
await say('hello from team c'); await idle();
await page.evaluate(() => document.querySelector('[data-act=logsync]').click());
await until(async () => !/syncing/.test(await slotOf('#logstat')), 20000);
const LB = repos['o/logs-b'].main.files, TB = repos['o/logs-b']['wh-sessions']?.files || {};
check('log repo per profile: an empty repo gets the layout on first use', JSON.parse(LB['.harness/manifest.json'] || '{}').schema === 1);
check('log repo per profile: the profile\'s sessions go there, not to the defaults\' repo', !!TB[`sessions/${sidB}/meta.json`] && !Object.keys(repos['o/logs']['wh-sessions'].files).some(f => f.startsWith(`sessions/${sidB}/`)));
check('log repo per profile: a missing repo is not created silently (a smell, skipped)', !repos['o/nowhere'] && await page.evaluate(() => JSON.parse(localStorage['wh:smells']).some(r => r.kind === 'log-repo-unavailable' && /o\/nowhere/.test(r.detail))));
await pickProfile('(no profile)');

// ---- the queue: an unchecked credential queues a no-token check ----
await page.reload();
await page.waitForSelector('#queue', { state: 'attached' });
const sq = await page.evaluate(() => (JSON.parse(localStorage['wh:meta']).queue || []).find(x => x.type === 'scope-check' && x.status === 'queued'));
check('queue: a credential never checked queues a scope check (no model, no tokens)', !!sq && sq.estimate.in === 0 && sq.estimate.model === null && /never checked|stale/.test(sq.reason.kind), JSON.stringify(sq?.reason));
await page.evaluate(id => document.querySelector(`#queue [data-q="${id}"] [data-act="q-run"]`).click(), sq.id);
await page.waitForSelector('.modal .tcheck');
await page.click('.modal .actions button');
check('queue: running it performs the check and marks it done', await until(async () => await page.evaluate(id => JSON.parse(localStorage['wh:meta']).queue.find(x => x.id === id).status, sq.id) === 'done', 5000));
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1'); await page.dispatchEvent('#model', 'change');

// ---- credential scope check: intended use vs what the token can do (no model) ----
await page.click('[data-pane=insp]');
await page.evaluate(() => { document.querySelector('#ghintentbox').open = true; document.querySelector('#ghintentbox').closest('details:not(#ghintentbox)').open = true; document.querySelector('[data-act=ghderive]').click(); });
const intentLines = await page.inputValue('#ghintent');
check('scopes: the intent is filled from the configuration (log repos need write)', /^o\/logs write$/m.test(intentLines) && /^o\/logs-b write$/m.test(intentLines) && /^o\/nowhere write$/m.test(intentLines), intentLines);
await page.evaluate(() => { const c = document.querySelector('#ghprobe'); c.checked = true; });
await page.evaluate(() => document.querySelector('[data-act=ghscopes]').click());
await page.waitForSelector('.modal .tcheck');
const tc = await page.evaluate(() => [...document.querySelectorAll('.modal .tcheck tr[data-st]')].map(tr => [tr.children[0].textContent, tr.dataset.st, tr.children[2].textContent]));
const tst = name => tc.find(r => r[0] === name)?.[1];
check('scopes: token type and identity', tst('token type') === 'ok' && tst('token works') === 'ok');
check('scopes: intended repos read and (probed) write are confirmed', tst('o/logs contents read') === 'ok' && tst('o/logs contents write') === 'ok' && tst('o/logs-b contents write') === 'ok' && blobsMade.includes('o/logs'), JSON.stringify(tc));
check('scopes: an intended repo the token cannot reach is missing', tst('o/nowhere metadata') === 'missing');
check('scopes: repos the token reaches beyond the intent are excess', /x\/other/.test(tc.find(r => r[0] === 'repos beyond the intent')?.[2] || '') && tst('repos beyond the intent') === 'excess');
check('scopes: what cannot be proven without writing is said so', !tc.some(r => r[0] === 'open pull requests') || tst('open pull requests') === 'unverifiable');
check('scopes: the summary is kept beside the credential, and mismatches are smells', /missing/.test(await slotOf('#ghscopes')) && await page.evaluate(() => JSON.parse(localStorage['wh:smells']).some(r => r.kind === 'token-scope')));
await page.click('.modal .actions button');

// ---- GitHub App mode: no pasted token, tokens minted per repository and permission ----
await page.evaluate(pem => { localStorage.setItem('wh:keys', JSON.stringify({ ghapp: { appId: '123', pem } })); }, PEM);
await page.reload();
await page.selectOption('#provider', 'mock');
await page.fill('#model', 'mock-1');
await page.dispatchEvent('#model', 'change');
await page.click('[data-pane=insp]');
await page.evaluate(() => { document.querySelector('[data-act=ghcheck]').closest('details').open = true; });
await page.click('[data-act=ghcheck]');
check('app: check signs a JWT from the PKCS#1 key', await until(async () => /app wh-test/.test(await slotOf('#ghwho'))));
await page.click('[data-act=new]');
branches.feat.files['a.txt'] = 'hello again\n';
await say('repo read please'); await idle();
await say('repo commit please');
await page.waitForSelector('.thread:visible .msg[data-role=approve]:not([data-done]) button');
await thread().locator('.msg[data-role=approve]:not([data-done]) button', { hasText: 'allow' }).click();
await idle();
check('app: commit landed using minted tokens', branches.feat.files['a.txt'] === 'goodbye again\n', await thread().locator('.msg[data-role=tool] pre').last().textContent());
check('app: each token is for exactly one repo, at the level asked', mints.length >= 2 && mints.every(m => m.repositories.length === 1) && mints.some(m => m.permissions.contents === 'read' && Object.keys(m.permissions).length === 1) && mints.some(m => m.permissions.contents === 'write'));
check('app: reads used a read-only token, the commit a write token', used.filter(([p]) => p.startsWith('GET /repos/o/r/contents/a.txt')).some(([, pm]) => pm.contents === 'read') && used.some(([p, pm]) => p === 'POST /graphql' && pm.contents === 'write'));
const allUp = JSON.stringify(await upEvents());
check('app: neither the key nor a minted token leaves the page', !allUp.includes('BEGIN RSA') && !Object.keys(minted).some(t => allUp.includes(t)));

check('no page errors', errors.filter(e => !/Failed to load resource|ERR_/.test(e)).length === 0, errors.join(' | '));
await browser.close();
