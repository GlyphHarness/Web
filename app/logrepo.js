// The log repo: a private GitHub repository the user picks, where this frontend
// keeps its tracking over time (smells, steering versions, per-session metrics,
// review proposals). The frontend is its only writer; agents may read it
// (repo_read) but model-facing tools refuse to write to it, so changes to
// steering go through review proposals and the user.
//
// Layout (schema 1), created on a cold start:
//   README.md                      what this is and the rules
//   .harness/manifest.json         {schema, created, layout}
//   smells/<date>/<device>-<t>.jsonl     one row per smell (append-only batches)
//   sessions/<date>/<device>-<t>.jsonl   per-session metrics, never message text
//   steering/<fingerprint>.json          the texts a steering version consists of (written once)
//   proposals/<date>/<device>-<t>.jsonl  review proposals and their decisions
// Batch files are never edited, so several devices can sync without conflicts.

export const SCHEMA = 1;
const KEY = 'wh:logsync';
const today = () => new Date().toISOString().slice(0, 10);
const state = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
export function device() {
  let d = state().device;
  if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); save({ ...state(), device: d }); }
  return d;
}

const README = repo => `# ${repo}

Private tracking for one WebHarness user, written by the WebHarness frontend.

- The frontend is the only writer. Agents may read this repository; model-facing
  tools refuse to write to it. Changes to steering (conventions, system prompts,
  policies, tool wording) go through review proposals and the user.
- Files are append-only batches named \`<device>-<time>\`; none is ever edited.
- No message text is written here: session rows are metrics, smell rows hold the
  tool call involved (with stored keys redacted).

| Path | Rows |
| --- | --- |
| \`smells/<date>/\` | policy rewrites and refusals, imitated call notes, tool errors, timeouts; each with its steering fingerprint |
| \`sessions/<date>/\` | per session: model, requests, tokens, cache hits, cost, smell count, steering fingerprint |
| \`steering/<fp>.json\` | the texts behind a steering fingerprint |
| \`proposals/<date>/\` | review proposals and the user's decisions |
| \`.harness/manifest.json\` | schema version |
`;

// git = client from git.js with confirm() returning true (system writes, not model calls)
export function logRepo({ git, repo, redact = s => s }) {
  const jsonl = rows => rows.map(r => redact(JSON.stringify(r))).join('\n') + '\n';

  async function status() {
    try { await git.call('GET', `/repos/${repo}`); }
    catch (e) { if (e.status === 404) return { state: 'missing' }; throw e; }
    try { const m = JSON.parse(await git.read({ repo, op: 'file', path: '.harness/manifest.json' })); return { state: 'ready', manifest: m }; }
    catch (e) { if (/404/.test(e.message)) return { state: 'empty' }; throw e; }
  }

  // cold start: create the private repo (the caller asks the user first)
  async function create() {
    const [owner, name] = repo.split('/');
    return git.create({ owner, name, private: true, description: 'WebHarness tracking (written by the frontend)', readme: true });
  }

  async function init() {
    return git.commit({ repo, branch: await defaultBranch(), message: 'Initialize WebHarness log repo (schema ' + SCHEMA + ')', changes: [
      { path: 'README.md', content: README(repo) },
      { path: '.harness/manifest.json', content: JSON.stringify({ schema: SCHEMA, created: new Date().toISOString(), layout: ['smells', 'sessions', 'steering', 'proposals'] }, null, 2) + '\n' },
      ...['smells', 'sessions', 'steering', 'proposals'].map(d => ({ path: d + '/.keep', content: '' })),
    ] });
  }
  const defaultBranch = async () => (await git.call('GET', `/repos/${repo}`)).default_branch;

  // one commit with everything new since the last sync
  async function sync({ smells, sessions, steering, proposals }) {
    const st = state(), cur = st[repo] || {};
    const since = cur.t || 0, t = Date.now(), stamp = `${device()}-${new Date(t).toISOString().replace(/[:.]/g, '-')}`;
    const newSmells = smells.filter(r => r.t > since);
    const newProps = proposals.filter(p => (p.decided || p.t) > since);
    const sent = new Set(cur.steering || []);
    const newSteer = steering.filter(x => !sent.has(x.fp));
    const changes = [];
    if (newSmells.length) changes.push({ path: `smells/${today()}/${stamp}.jsonl`, content: jsonl(newSmells) });
    if (sessions.length) changes.push({ path: `sessions/${today()}/${stamp}.jsonl`, content: jsonl(sessions.map(x => ({ t, ...x }))) });
    if (newProps.length) changes.push({ path: `proposals/${today()}/${stamp}.jsonl`, content: jsonl(newProps) });
    for (const x of newSteer) changes.push({ path: `steering/${x.fp}.json`, content: redact(JSON.stringify(x, null, 2)) + '\n' });
    if (!changes.length) return 'nothing new';
    const out = await git.commit({ repo, branch: await defaultBranch(), message: `sync ${stamp}: ${newSmells.length} smells, ${sessions.length} sessions, ${newSteer.length} steering, ${newProps.length} proposals`, changes });
    save({ ...state(), [repo]: { t, steering: [...sent, ...newSteer.map(x => x.fp)] } });
    return out.split('\n')[0];
  }

  return { repo, status, create, init, sync };
}
