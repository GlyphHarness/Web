// Token scope check: does the GitHub credential match the slot it fills? Plain,
// deterministic API calls; no model is involved. The intent comes from the
// configuration (and can be edited); what the token can do comes from responses.
//
// intent = {repos: [{pattern: 'owner/name' | 'owner/*', need: 'read' | 'write', why}],
//           pulls: bool (open pull requests), create: bool (create repositories)}
// result rows: {check, expected, observed, status: ok | missing | excess | unverifiable | info}

const API = 'https://api.github.com';
const glob = p => new RegExp('^' + p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$', 'i');
const RISKY_SCOPES = ['delete_repo', 'admin:org', 'admin:repo_hook', 'admin:org_hook', 'admin:public_key', 'admin:gpg_key', 'admin:enterprise', 'site_admin', 'write:packages', 'delete:packages', 'user', 'workflow'];

export function kind(token) {
  if (/^github_pat_/.test(token)) return 'fine-grained token';
  if (/^ghp_/.test(token)) return 'classic token';
  if (/^ghs_/.test(token)) return 'app installation token';
  if (/^gho_/.test(token)) return 'OAuth token';
  return 'unknown token type';
}

// What the configuration says the token is for.
export function derive({ settings, profiles }) {
  const repos = [], add = (pattern, need, why) => { const r = repos.find(x => x.pattern.toLowerCase() === pattern.toLowerCase()); if (r) { if (need === 'write') r.need = 'write'; r.why += '; ' + why; } else repos.push({ pattern, need, why }); };
  if (settings.logRepo) add(settings.logRepo, 'write', 'log repo (defaults)');
  for (const p of profiles || []) {
    if (p.settings?.logRepo) add(p.settings.logRepo, 'write', `log repo of profile ${p.name}`);
    const cap = p.caps?.repo;
    if (cap && cap !== 'none') for (const pat of p.repos || []) add(pat, cap, `profile ${p.name} (${cap})`);
  }
  return { repos, pulls: (profiles || []).some(p => p.caps?.repo === 'write'), create: false };
}

// token: the credential; probeWrite: create an unreferenced blob to prove contents:write
export async function check(token, intent, { probeWrite = false, fetchImpl = fetch } = {}) {
  const rows = [], add = r => rows.push(r);
  const call = async (method, path, body) => {
    const r = await fetchImpl(API + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json, headers: r.headers };
  };
  add({ check: 'token type', expected: 'fine-grained token (least privilege)', observed: kind(token), status: /fine-grained|app/.test(kind(token)) ? 'ok' : 'info' });
  const me = await call('GET', '/user');
  if (me.status !== 200) { add({ check: 'token works', expected: 'accepted', observed: `HTTP ${me.status} ${me.json?.message || ''}`, status: 'missing' }); return rows; }
  add({ check: 'token works', expected: 'accepted', observed: 'account ' + me.json.login, status: 'ok' });
  const scopes = (me.headers.get('x-oauth-scopes') || '').split(',').map(x => x.trim()).filter(Boolean);
  if (kind(token) === 'classic token') {
    add({ check: 'classic scopes', expected: 'repo access only', observed: scopes.join(', ') || '(none)', status: scopes.includes('repo') || scopes.includes('public_repo') ? 'ok' : 'missing' });
    const risky = scopes.filter(sc => RISKY_SCOPES.includes(sc));
    if (risky.length) add({ check: 'extra scopes', expected: 'none', observed: risky.join(', '), status: 'excess' });
    if (scopes.includes('repo')) add({ check: 'repository reach', expected: 'the intended repos', observed: '"repo" scope reaches every repository you can', status: 'excess' });
  }
  // which repositories it reaches
  const reach = [];
  for (let page = 1; page <= 5; page++) {
    const r = await call('GET', `/user/repos?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) break;
    reach.push(...r.json.map(x => ({ name: x.full_name, perms: x.permissions || {} })));
    if (r.json.length < 100) break;
  }
  const pats = intent.repos.map(x => ({ ...x, re: glob(x.pattern) }));
  // each intended repository (or each repo a pattern matches)
  for (const it of pats) {
    const names = it.pattern.includes('*') ? reach.filter(r => it.re.test(r.name)).map(r => r.name) : [it.pattern];
    if (!names.length) { add({ check: `repos ${it.pattern}`, expected: it.need + ' · ' + it.why, observed: 'none reachable', status: 'missing' }); continue; }
    for (const name of names) {
      const meta = await call('GET', `/repos/${name}`);
      if (meta.status !== 200) { add({ check: `${name} metadata`, expected: 'read · ' + it.why, observed: `HTTP ${meta.status}`, status: 'missing' }); continue; }
      const cont = await call('GET', `/repos/${name}/contents/`);
      const readOk = cont.status === 200 || (cont.status === 404 && /empty/i.test(cont.json?.message || ''));
      add({ check: `${name} contents read`, expected: 'yes · ' + it.why, observed: readOk ? 'yes' : `HTTP ${cont.status}`, status: readOk ? 'ok' : 'missing' });
      if (meta.json?.permissions?.admin && kind(token) === 'classic token') add({ check: `${name} admin`, expected: 'not needed', observed: 'admin', status: 'excess' });
      if (it.need === 'write') {
        if (!probeWrite) add({ check: `${name} contents write`, expected: 'yes · ' + it.why, observed: 'not probed (switch on "probe write")', status: 'unverifiable' });
        else {
          const b = await call('POST', `/repos/${name}/git/blobs`, { content: '', encoding: 'utf-8' });
          add({ check: `${name} contents write`, expected: 'yes · ' + it.why, observed: b.status === 201 ? 'yes (an unreferenced blob was created; no commit)' : `HTTP ${b.status}`, status: b.status === 201 ? 'ok' : 'missing' });
        }
      }
    }
  }
  // repositories it reaches that nothing intends
  const extra = reach.filter(r => !pats.some(p => p.re.test(r.name)));
  if (pats.length && extra.length) add({ check: 'repos beyond the intent', expected: 'none', observed: `${extra.length}: ${extra.slice(0, 8).map(r => r.name).join(', ')}${extra.length > 8 ? '…' : ''}`, status: 'excess' });
  if (intent.pulls) add({ check: 'open pull requests', expected: 'yes', observed: 'cannot be proven without opening one', status: 'unverifiable' });
  if (intent.create) add({ check: 'create repositories', expected: 'yes', observed: 'cannot be proven without creating one', status: 'unverifiable' });
  return rows;
}

// GitHub App: what each installation was granted, from GET /app/installations (JWT)
export async function checkApp(jwt, intent, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(API + '/app/installations', { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + jwt } });
  const list = await r.json().catch(() => null);
  if (r.status !== 200 || !Array.isArray(list)) return [{ check: 'app', expected: 'installations listed', observed: `HTTP ${r.status}`, status: 'missing' }];
  const rows = [{ check: 'credential', expected: 'GitHub App', observed: `${list.length} installations`, status: list.length ? 'ok' : 'missing' }];
  const needWrite = intent.repos.some(x => x.need === 'write');
  for (const inst of list) {
    const p = inst.permissions || {}, who = inst.account?.login || inst.id;
    rows.push({ check: `${who} contents`, expected: needWrite ? 'write' : 'read', observed: p.contents || 'none', status: p.contents === 'write' || (!needWrite && p.contents === 'read') ? 'ok' : 'missing' });
    if (intent.pulls) rows.push({ check: `${who} pull requests`, expected: 'write', observed: p.pull_requests || 'none', status: p.pull_requests === 'write' ? 'ok' : 'missing' });
    if (p.administration === 'write' && !intent.create) rows.push({ check: `${who} administration`, expected: 'not needed', observed: 'write', status: 'excess' });
    rows.push({ check: `${who} repositories`, expected: 'the intended ones', observed: inst.repository_selection === 'all' ? 'all repositories' : 'selected repositories', status: inst.repository_selection === 'all' ? 'excess' : 'ok' });
  }
  return rows;
}

export const summary = rows => ['ok', 'missing', 'excess', 'unverifiable'].map(k => [k, rows.filter(r => r.status === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
