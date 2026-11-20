// Turn profile: the argument summary of each tool call (what it was aimed at, without what it carried).
// From the F1 result (docs/concepts/HYPOTHESES.md): a profile held tool names and no arguments, so no step
// validator resolved from it. Node only, no browser: node scripts/test-profile.mjs
import fs from 'node:fs';
import * as P from '../app/profile.js';
import * as V from '../app/validators.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) fails++; };
const sum = (name, args) => { try { return P.argSummary(name, typeof args === 'string' ? args : JSON.stringify(args)); } catch (e) { return { threw: String(e.message || e) }; } };
const isSum = v => !!v && typeof v === 'object' && typeof v.length === 'number' && typeof v.hash === 'string' && Object.keys(v).length === 2;
const J = v => JSON.stringify(v) ?? 'undefined';
const KEY = 'sk-or-v1-' + 'a1b2c3d4'.repeat(4);

// ---- fields that name a place or a command are kept as written ----
const read = sum('repo_read', { repo: 'o/r', op: 'file', path: 'app/main.js', ref: 'exp/h1-blue', lines: '2550-2590', want: 'the tmux block marker-want' });
check('summary: repo_read keeps repo, op, path, ref and the line range as written', read?.repo === 'o/r' && read.op === 'file' && read.path === 'app/main.js' && read.ref === 'exp/h1-blue' && read.lines === '2550-2590', J(read));
check('summary: free text on a read (want) is size and hash only', isSum(read?.want) && read.want.length === 26 && !J(read).includes('marker-want'), J(read));

const commitArgs = { repo: 'o/r', branch: 'exp/h1-green', from: 'main', message: 'Spec: pass the session marker-msg\n\nbody of the message', changes: [
  { path: 'app/main.js', edits: [{ find: 'agentRun(cmd, t, o) marker-find', replace: 'agentRun(cmd, t, { ...o }) marker-replace' }] },
  { path: 'docs/b.md', content: 'file body marker-body\n'.repeat(40) },
  { path: 'c.txt', from: 'os:abc123' },
  { path: 'old.txt', delete: true },
] };
const commit = sum('repo_commit', commitArgs);
check('summary: repo_commit keeps repo, branch, base and every changed path', commit?.repo === 'o/r' && commit.branch === 'exp/h1-green' && commit.from === 'main' && commit.changes?.map(c => c.path).join() === 'app/main.js,docs/b.md,c.txt,old.txt', J(commit));
check('summary: a file body, find and replace text and the commit message are size and hash only', isSum(commit?.message) && commit.message.length === commitArgs.message.length && isSum(commit.changes?.[1]?.content) && commit.changes[1].content.length === commitArgs.changes[1].content.length && isSum(commit.changes[0].edits?.[0]?.find) && isSum(commit.changes[0].edits[0].replace), J(commit));
check('summary: a stored-output handle and a delete flag stay as written', commit?.changes?.[2]?.from === 'os:abc123' && commit.changes[3].delete === true, J(commit?.changes));
check('summary: no content text is in it', !!commit && !/marker-(msg|find|replace|body)|agentRun|pass the session/.test(J(commit)), J(commit));

const sh1 = sum('shell', { cmd: 'node scripts/ci.mjs main git', timeout: 300 });
const SCRIPT = 'cat > notes.txt <<EOF\nheredoc marker-heredoc\nEOF\nnode --check app/main.js';
const sh2 = sum('shell', { cmd: SCRIPT });
check('summary: a one-line command is kept as written, with its timeout', sh1?.cmd === 'node scripts/ci.mjs main git' && sh1.timeout === 300, J(sh1));
check('summary: of a script only the first line is kept; the whole is size and hash', sh2?.cmd === 'cat > notes.txt <<EOF' && isSum(sh2.cmd_more) && sh2.cmd_more.length === SCRIPT.length && !J(sh2).includes('marker-heredoc'), J(sh2));

const out = sum('output_read', { handle: 'os:abc123', offset: 1200, length: 800, lines: '10-40', find: 'needle marker-needle' });
check('summary: output_read keeps the handle and the range; the search text is size and hash', out?.handle === 'os:abc123' && out.offset === 1200 && out.length === 800 && out.lines === '10-40' && isSum(out.find) && !J(out).includes('marker-needle'), J(out));

const js = sum('run_js', { code: 'return "marker-code".length', name: 'count marker-name', want: 'a number' });
check('summary: code and labels of a run are size and hash only', isSum(js?.code) && isSum(js.name) && isSum(js.want) && !/marker-/.test(J(js)), J(js));

// ---- never a key ----
const leaky = sum('shell', { cmd: `curl -H "Authorization: Bearer ${KEY}" https://example.test/x` });
const leaky2 = sum('repo_read', { repo: 'o/r', op: 'file', path: 'x', ref: KEY });
check('summary: a key inside a kept field is masked', typeof leaky?.cmd === 'string' && /curl/.test(leaky.cmd) && !J(leaky).includes(KEY) && !J(leaky).includes(KEY.slice(9, 30)) && !J(leaky2).includes(KEY.slice(9, 30)), J([leaky, leaky2]));

// ---- odd input ----
const bad = sum('run_js', '{"code": "return 1"');
check('summary: arguments that do not parse are size and hash only', isSum(bad?.unparsed) && bad.unparsed.length === 19, J(bad));
const same = [sum('run_js', { code: 'return 1' }), sum('run_js', { code: 'return 1' }), sum('run_js', { code: 'return 2' })];
check('summary: the same content gives the same hash, other content another', isSum(same[0]?.code) && same[0].code.hash === same[1].code.hash && same[0].code.hash !== same[2].code.hash, J(same));
const longPath = sum('repo_read', { repo: 'o/r', path: 'p'.repeat(900) });
check('summary: a kept field far too long to be a path is size and hash too', isSum(longPath?.path), J(longPath).slice(0, 120));

// ---- the profile carries it per call, beside the fields it had ----
const tc = (id, name, args) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const session = { id: 's1', title: 'profiled', ledger: [{ model: 'm', strat: 'strat-serial-1.0', prompt: 100, cached: 0, completion: 10, cost: 0.001 }], messages: [
  { role: 'user', content: 'please fix it marker-user' },
  { role: 'assistant', content: 'reading marker-assistant', tool_calls: [tc('c1', 'repo_read', { repo: 'o/r', op: 'file', path: 'scripts/smoke.mjs', lines: '1-40' }), tc('c2', 'shell', { cmd: 'node scripts/ci.mjs main git' })] },
  { role: 'tool', tool_call_id: 'c1', content: 'file text marker-result' },
  { role: 'tool', tool_call_id: 'c2', content: 'ok' },
  { role: 'user', content: 'now commit' },
  // long arguments leave the log when the call is stored ({ref, name}); the harness keeps their summary beside the message
  { role: 'assistant', content: null, tool_calls: [tc('c3', 'repo_commit', { ref: 'os:zzz999', name: 'the commit' })], x: { args: { 0: { repo: 'o/r', branch: 'spec/red', message: { length: 40, hash: '0badf00d' }, changes: [{ path: 'scripts/smoke-git.mjs', content: { length: 9000, hash: 'feedc0de' } }] } } } },
  { role: 'tool', tool_call_id: 'c3', content: 'abc1234 on spec/red: 1 files' },
] };
const prof = P.profile(session), t0 = prof.perTurn?.[0], t1 = prof.perTurn?.[1];
check('profile: each turn lists one summary per call, in call order, named like its tools', Array.isArray(t0?.args) && t0.args.length === t0.calls && t0.args.map(a => a.name).join(' ') === t0.tools && t0.args[0].args?.path === 'scripts/smoke.mjs' && t0.args[1].args?.cmd === 'node scripts/ci.mjs main git', J(t0));
check('profile: a call whose arguments were stored by handle shows the summary the harness kept', t1?.args?.[0]?.name === 'repo_commit' && t1.args[0].args?.branch === 'spec/red' && t1.args[0].args?.changes?.[0]?.path === 'scripts/smoke-git.mjs', J(t1));
check('profile: it still holds no message text, result text or argument content', !!t0?.args && !/marker-/.test(J(prof)), (J(prof).match(/marker-\w+/) || [''])[0]);
const old = JSON.parse(fs.readFileSync(new URL('../docs/concepts/profile-2026-11-19.json', import.meta.url), 'utf8')).sessions[0];
const missing = Object.keys(old).filter(k => !(k in prof)), missingTurn = Object.keys(old.perTurn[0]).filter(k => !(k in (t0 || {})));
check('profile: every field a profile had before is still there, turn fields too', missing.length === 0 && missingTurn.length === 0 && t0?.tools === 'repo_read shell' && prof.calls.total === 3 && prof.calls.byTool.repo_commit === 1, J([missing, missingTurn]));

// ---- what it is for: a step validator can resolve from a profile ----
const asRead = V.read(prof);
check('validators: the reader a profile had still reads it (tool names per turn)', asRead?.kind === 'profile' && asRead.calls.map(c => c.name).join() === 'repo_read,shell,repo_commit', J(asRead?.calls?.map(c => c.name)));
// a reader for the summary, added through the validators' own seam: kept fields are the evidence, summarised ones are not
const leaves = v => typeof v === 'string' ? [v] : v && typeof v === 'object' ? (typeof v.hash === 'string' && typeof v.length === 'number' ? [] : Object.values(v).flatMap(leaves)) : [];
V.reader(r => Array.isArray(r?.perTurn) && r.perTurn.some(t => Array.isArray(t.args)) ? { session: r.id, kind: 'profile-args', cost: r.cost?.total ?? null, calls: r.perTurn.flatMap(t => t.args.map((c, j) => ({ turn: t.n, msg: null, call: j, name: c.name, args: leaves(c.args) }))) } : null);
const md = '## Steps\n- Write the check in `scripts/smoke-git.mjs`.\n- Run `node scripts/ci.mjs main git`.\n- Edit `app/never-touched.js`.\n';
const vs = V.extract(md, '.claude/skills/x/SKILL.md'), res = V.resolveAll(vs, prof, { sources: { '.claude/skills/x/SKILL.md': md } });
check('validators: a step that names a path resolves from the profile alone, pointing at the turn', res[0]?.outcome === 'pass' && res[0].at_turn === 1, J(res[0]));
check('validators: a step that names a command resolves from the profile alone', res[1]?.outcome === 'pass' && res[1].at_turn === 0, J(res[1]));
check('validators: a path no call touched does not pass', res[2]?.outcome !== 'pass', J(res[2]));
const bare = { ...prof, perTurn: prof.perTurn.map(({ args, ...t }) => t) };
check('validators: a profile without summaries stays unresolved, as before', V.resolve(vs[0], bare, { sources: { '.claude/skills/x/SKILL.md': md } }).reason === 'no-arguments');

process.exitCode = fails ? 1 : 0;
