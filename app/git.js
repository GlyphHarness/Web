// Repository tools over the GitHub API. A page can reach api.github.com (it sends
// Access-Control-Allow-Origin: *) but not git's smart-HTTP endpoints or the
// OAuth token exchange, so there is no clone and no sign-in flow: reads, commits,
// branches and pull requests go through REST and GraphQL with a fine-grained
// token from ghauth.js: a pasted personal access token, or an installation token
// minted per repository from a GitHub App.
//
// Writes (commit, pull request) are shown to the user and wait for a click.
// Every request is recorded in the trace without the Authorization header.

const API = 'https://api.github.com';
const b64 = {
  enc: s => { const b = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); },
  dec: s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0))),
};
const REPO = /^[\w.-]+\/[\w.-]+$/;

// env = { token(repo, level) -> Promise<string> (ghauth.js; level read | write | pr), trace: [], confirm(summary) -> Promise<bool>, get(handle) -> Promise<string|null> }
export function client(env) {
  async function call(method, path, body) {
    // the repository and the least permission this request needs decide which token is used
    const repo = /^\/repos\/([^/]+\/[^/]+)/.exec(path)?.[1] || body?.variables?.i?.branch?.repositoryNameWithOwner;
    const level = method === 'GET' ? 'read' : /\/pulls$/.test(path) ? 'pr' : 'write';
    const out = repo && env.scope?.(repo);
    if (out) throw new Error(out);
    if (level !== 'read' && repo && env.readOnly?.().some(r => r.toLowerCase() === repo.toLowerCase())) throw new Error(`${repo} is read-only here: it is the log repo, written only by the harness. Propose changes through a review instead.`);
    const tok = await env.token(repo, level);
    if (!tok) throw new Error('No GitHub token is set.');
    const t0 = performance.now();
    const rec = { t: new Date().toISOString(), url: API + path, request: { method, body }, status: 0, chunks: [] };
    env.trace?.push(rec);
    try {
      const r = await fetch(API + path, {
        method,
        headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      rec.status = r.status;
      const text = await r.text();
      rec.chunks.push([Math.round(performance.now() - t0), text.length > 20000 ? text.slice(0, 20000) + '…' : text]);
      const left = r.headers.get('x-ratelimit-remaining');
      let j = null;
      try { j = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) {
        const e = new Error(`GitHub ${r.status}: ${j?.message || text.slice(0, 300)}${left === '0' ? ' (rate limit reached)' : ''}`);
        e.status = r.status;
        throw e;
      }
      if (j?.errors?.length) throw new Error('GitHub: ' + j.errors.map(x => x.message).join('; '));
      return j;
    } catch (e) { rec.error = String(e.message || e); throw e; }
    finally { rec.ms = Math.round(performance.now() - t0); }
  }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const repoOf = a => { if (!REPO.test(a.repo || '')) throw new Error('repo must be "owner/name"'); return a.repo; };
  const defaultBranch = async repo => (await call('GET', `/repos/${repo}`)).default_branch;
  const headOf = async (repo, branch) => {
    try { return (await call('GET', `/repos/${repo}/git/ref/heads/${enc(branch)}`)).object.sha; }
    catch (e) { if (e.status === 404) return null; throw e; }
  };
  async function fileAt(repo, path, ref) {
    const j = await call('GET', `/repos/${repo}/contents/${enc(path)}${ref ? '?ref=' + encodeURIComponent(ref) : ''}`);
    if (Array.isArray(j)) return { dir: j };
    if (j.content == null || j.encoding !== 'base64') {
      if (!j.sha) throw new Error(`${path} is not a file`);
      const blob = await call('GET', `/repos/${repo}/git/blobs/${j.sha}`); // over 1 MB: contents omits the body
      return { text: b64.dec(blob.content), sha: j.sha };
    }
    return { text: b64.dec(j.content), sha: j.sha };
  }

  async function read(a) {
    const repo = repoOf(a), op = a.op || 'file';
    if (op === 'file') {
      if (!a.path) throw new Error('path is required');
      const f = await fileAt(repo, a.path, a.ref);
      if (f.dir) return f.dir.map(e => (e.type === 'dir' ? e.path + '/' : e.path)).join('\n') || '(empty directory)';
      if (a.lines) {
        const [s, e] = String(a.lines).split('-').map(Number);
        return f.text.split('\n').slice(Math.max(0, s - 1), e || s).join('\n');
      }
      return f.text;
    }
    if (op === 'tree') {
      const ref = a.ref || await defaultBranch(repo);
      const t = await call('GET', `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      const pre = (a.path || '').replace(/^\/+|\/+$/g, '');
      const rows = t.tree.filter(e => e.type === 'blob' && (!pre || e.path.startsWith(pre + '/'))).map(e => e.path);
      return rows.join('\n') + (t.truncated ? '\n[tree truncated by the API]' : '') || '(no files)';
    }
    if (op === 'log') {
      const q = new URLSearchParams({ per_page: String(Math.min(Number(a.n) || 10, 50)) });
      if (a.ref) q.set('sha', a.ref);
      if (a.path) q.set('path', a.path);
      const list = await call('GET', `/repos/${repo}/commits?${q}`);
      return list.map(c => `${c.sha.slice(0, 7)} ${c.commit.author?.date?.slice(0, 10) || ''} ${c.commit.message.split('\n')[0]}`).join('\n') || '(no commits)';
    }
    if (op === 'diff') {
      if (!a.base || !a.head) throw new Error('diff needs base and head');
      const c = await call('GET', `/repos/${repo}/compare/${encodeURIComponent(a.base)}...${encodeURIComponent(a.head)}`);
      const files = (c.files || []).filter(f => !a.path || f.filename.startsWith(a.path));
      return `${c.status}: ${c.ahead_by} ahead, ${c.behind_by} behind, ${c.files?.length || 0} files\n` +
        files.map(f => `--- ${f.status} ${f.filename} +${f.additions} -${f.deletions}\n${f.patch || '(no text patch)'}`).join('\n');
    }
    if (op === 'branches') return (await call('GET', `/repos/${repo}/branches?per_page=100`)).map(b => b.name).join('\n');
    if (op === 'prs') return (await call('GET', `/repos/${repo}/pulls?state=${a.state || 'open'}&per_page=30`)).map(p => `#${p.number} ${p.head.ref} -> ${p.base.ref} ${p.title}`).join('\n') || '(none)';
    throw new Error('op must be file, tree, log, diff, branches or prs');
  }

  // A change is {path, content} | {path, from: "os:..."} | {path, edits: [{find, replace}]} | {path, delete: true}.
  // edits apply to the file at the branch head; each find must occur exactly once.
  async function resolve(repo, branch, ch) {
    if (!ch?.path) throw new Error('every change needs a path');
    if (ch.delete) return { path: ch.path, delete: true };
    if (typeof ch.base64 === 'string') return { path: ch.path, b64: ch.base64, binary: Math.floor(ch.base64.length * 3 / 4) }; // media and other binary files
    if (typeof ch.content === 'string') return { path: ch.path, text: ch.content };
    if (typeof ch.from === 'string') {
      const t = await env.get(ch.from);
      if (t == null) throw new Error(`nothing stored under ${ch.from}`);
      return { path: ch.path, text: t };
    }
    if (Array.isArray(ch.edits)) {
      let text = (await fileAt(repo, ch.path, branch)).text;
      if (text == null) throw new Error(`${ch.path} is not a file`);
      for (const [i, e] of ch.edits.entries()) {
        const n = e.find ? text.split(e.find).length - 1 : 0;
        if (n !== 1) throw new Error(`${ch.path} edit ${i + 1}: find occurs ${n} times (must be once)`);
        text = text.replace(e.find, () => e.replace ?? '');
      }
      return { path: ch.path, text, edited: ch.edits.length };
    }
    throw new Error(`${ch.path}: give content, from, edits or delete`);
  }

  async function commit(a) {
    const repo = repoOf(a);
    if (!a.branch || !a.message || !Array.isArray(a.changes) || !a.changes.length) throw new Error('commit needs branch, message and changes');
    let head = await headOf(repo, a.branch), created = false;
    const base = a.from || (head ? null : await defaultBranch(repo));
    const readAt = head ? a.branch : base;
    const files = [];
    for (const ch of a.changes) files.push(await resolve(repo, readAt, ch));
    const summary = {
      what: 'commit', repo, branch: a.branch, newBranchFrom: head ? null : base, message: a.message,
      files: files.map(f => f.delete ? `delete ${f.path}` : f.b64 ? `write ${f.path} (binary, ${f.binary} bytes)` : `${f.edited ? 'edit' : 'write'} ${f.path} (${f.text.length} chars${f.edited ? ', ' + f.edited + ' edits' : ''})`),
      preview: files.filter(f => !f.delete && !f.b64).map(f => ({ path: f.path, text: f.text })),
    };
    if (!(await env.confirm(summary))) return 'Not committed: the user declined.';
    if (!head) {
      const baseSha = await headOf(repo, base);
      if (!baseSha) throw new Error(`base branch ${base} not found`);
      await call('POST', `/repos/${repo}/git/refs`, { ref: 'refs/heads/' + a.branch, sha: baseSha });
      head = baseSha; created = true;
    }
    const [headline, ...rest] = a.message.split('\n');
    const j = await call('POST', '/graphql', {
      query: 'mutation($i: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $i) { commit { oid url } } }',
      variables: { i: {
        branch: { repositoryNameWithOwner: repo, branchName: a.branch },
        message: { headline, body: rest.join('\n').trim() || undefined },
        expectedHeadOid: head,
        fileChanges: { additions: files.filter(f => !f.delete).map(f => ({ path: f.path, contents: f.b64 ?? b64.enc(f.text) })), deletions: files.filter(f => f.delete).map(f => ({ path: f.path })) },
      } },
    });
    const c = j.data.createCommitOnBranch.commit;
    return `${c.oid.slice(0, 7)} on ${a.branch}${created ? ' (new branch from ' + base + ')' : ''}: ${files.length} files\n${c.url}`;
  }

  async function pr(a) {
    const repo = repoOf(a);
    if (!a.head || !a.title) throw new Error('pull request needs head and title');
    const base = a.base || await defaultBranch(repo);
    if (!(await env.confirm({ what: 'pull request', repo, head: a.head, base, title: a.title, body: a.body || '' }))) return 'Not opened: the user declined.';
    const p = await call('POST', `/repos/${repo}/pulls`, { title: a.title, head: a.head, base, body: a.body || '', draft: !!a.draft });
    return `#${p.number} ${p.head.ref} -> ${p.base.ref}\n${p.html_url}`;
  }

  // New repository under an organization (or the token's own account when owner is omitted).
  async function create(a) {
    if (!/^[\w.-]+$/.test(a.name || '')) throw new Error('name must be a plain repository name');
    if (a.owner && !/^[\w.-]+$/.test(a.owner)) throw new Error('owner must be an account or organization name');
    const out = a.owner && env.scope?.(a.owner + '/' + a.name);
    if (out) throw new Error(out);
    const body = { name: a.name, private: a.private !== false, description: a.description || '', auto_init: a.readme !== false };
    if (!(await env.confirm({ what: 'repository', repo: (a.owner ? a.owner + '/' : '') + a.name, title: body.private ? 'private' : 'PUBLIC', head: '', base: '', body: body.description }))) return 'Not created: the user declined.';
    const r = await call('POST', a.owner ? `/orgs/${a.owner}/repos` : '/user/repos', body);
    return `${r.full_name} (${r.private ? 'private' : 'public'}, default branch ${r.default_branch})\n${r.html_url}`;
  }
  return { read, commit, pr, create, call };
}
