// Step validators (docs/concepts/FLOWS.md F1): the bullets of a skill or agent md file extract, by code and
// with no model, into step validator records, and those resolve against recorded sessions into validation
// result records. Seam: validate (app/validators.js). Node only; no browser, no provider.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { profile } from '../app/profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = await import('../app/validators.js').catch(e => ({ missing: String(e.message || e).split('\n')[0] }));
let fails = 0;
// a check is a function: a throw (the module or a function is not there yet) is a failed check, not a stopped suite
const check = (name, fn) => {
  let ok = false, got = '';
  try { const r = fn(); ok = r === true; if (!ok) got = JSON.stringify(r); } catch (e) { got = String(e.message || e).split('\n')[0]; }
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + String(got).slice(0, 300)));
  if (!ok) fails++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- a small skill file: one bullet per kind of step
const MD = [
  '---', 'name: sample', 'description: a sample skill', '---', '',
  '## Steps',
  '1. Write the goal as sentences, one behaviour each.',
  '2. Pick the seam (`docs/seams.md` list).',
  '3. Serve and run: `python3 -m http.server 8787` (background),',
  '   then `node scripts/smoke.mjs`.',
  '4. Commit the red state: `git commit -m "Spec: <behaviour> (<why>)"`.',
  '',
  '## Rules',
  '- Records go to `catalog/inbox/seams-<shortid>.jsonl`, never to `catalog/*.jsonl`.',
  '- Keep a run under $0.05.',
  '',
].join('\n');
const SRC = 'skills/sample/SKILL.md';
const vs = () => V.extract(MD, SRC);
const by = n => vs()[n];
const FIELDS = ['id', 'source_path', 'source_line_range', 'step_text_hash', 'check', 'purpose', 'applies_to'];
const RFIELDS = ['id', 'validator_id', 'flow_id', 'session', 'at_turn', 'outcome', 'carried_to', 'evidence_handle', 'tokens', 'cost'];

// ---- extraction
check('extract: every bullet becomes one step validator record, in file order', () => vs().length === 6 || vs().length);
check('extract: a record has the data model fields', () => vs().every(v => FIELDS.every(f => f in v)) || vs().map(v => Object.keys(v)));
check('extract: a record cites its source path and the lines of its bullet', () => {
  const v = by(2);
  return (v.source_path === SRC && same(v.source_line_range, [9, 10])) || v.source_line_range;
});
check('extract: the same text gives the same records (no model, no clock, no random ids)', () => same(vs(), vs()) && new Set(vs().map(v => v.id)).size === 6);
check('extract: a bullet with nothing to look for is kept, with no check and no shape', () => (by(0).check === null && by(0).shape === null) || by(0));
check('extract: a checkable record states the step, the expected evidence and the result', () => {
  const s = by(1).shape;
  return (typeof s.step === 'string' && s.step.includes('Pick the seam') && Array.isArray(s.expected) && s.expected.length === 1 && typeof s.result === 'string') || s;
});
check('extract: a named file or command gives a presence check', () => by(1).check === 'presence' || by(1).check);
check('extract: two commands joined by "then" give an order check', () => (by(2).check === 'order' && by(2).shape.expected.length === 2) || by(2));
check('extract: a message with placeholders gives a shape check', () => by(3).check === 'shape' || by(3).check);
check('extract: what a bullet says never to touch is forbidden evidence, not expected evidence', () => {
  const s = by(4).shape;
  return (s.expected.length === 1 && s.forbidden.length === 1 && s.forbidden[0].text === 'catalog/*.jsonl') || s;
});
check('extract: an amount of money gives a cost check', () => by(5).check === 'cost' || by(5).check);
check('extract: the check of a record is one of shape, presence, order, cost, or none', () => vs().every(v => v.check === null || ['shape', 'presence', 'order', 'cost'].includes(v.check)));

// the real skill file: structure only (what its bullets yield is the measurement, not a check)
const REAL = '.claude/skills/spec-first/SKILL.md';
const realText = fs.readFileSync(path.join(ROOT, REAL), 'utf8');
check('extract: the spec-first skill gives one record per list bullet, each citing lines that hash back to it', () => {
  const lines = realText.replace(/\r\n/g, '\n').split('\n');
  const bullets = lines.filter(l => /^\s*(\d+\.|[-*])\s+\S/.test(l)).length;
  const out = V.extract(realText, REAL);
  const cited = out.every(v => { const [a, b] = v.source_line_range; return /^\s*(\d+\.|[-*])\s/.test(lines[a - 1]) && V.hashLines(realText, [a, b]) === v.step_text_hash; });
  return (out.length === bullets && cited) || { bullets, records: out.length, cited };
});

// ---- sessions as the harness stores them (wh:s:<id>): one that shows every step, one that shows none
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const tool = id => ({ role: 'tool', tool_call_id: id, content: 'ok SECRET-RESULT' });
const good = {
  id: 's_good', title: 'steps followed', system: 'SECRET-SYSTEM', ledger: [{ prompt: 100, completion: 10, cost: 0.01 }, { prompt: 120, completion: 10, cost: 0.02 }],
  messages: [
    { role: 'user', content: 'SECRET-USER do the work' },
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('c1', 'repo_read', { path: 'docs/seams.md' }), call('c2', 'shell', { cmd: 'python3 -m http.server 8787 &' })] },
    tool('c1'), tool('c2'),
    { role: 'user', content: 'SECRET-USER go on' },
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('c3', 'shell', { cmd: 'node scripts/smoke.mjs' })] },
    tool('c3'),
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('c4', 'repo_commit', { message: 'Spec: validators cite their lines (invariant 6)', changes: [{ path: 'catalog/inbox/seams-abcdef.jsonl', content: 'SECRET-ARG' }] })] },
    tool('c4'),
    { role: 'assistant', content: 'SECRET-REPLY done' },
  ],
};
const bad = {
  id: 's_bad', title: 'steps not followed', system: 'SECRET-SYSTEM', ledger: [{ prompt: 100, completion: 10, cost: 0.2 }],
  messages: [
    { role: 'user', content: 'SECRET-USER do the work' },
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('d1', 'shell', { cmd: 'node scripts/smoke.mjs' }), call('d2', 'shell', { cmd: 'python3 -m http.server 8787 &' })] },
    tool('d1'), tool('d2'),
    { role: 'user', content: 'SECRET-USER go on' },
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('d3', 'repo_commit', { message: 'fix stuff', changes: [{ path: 'catalog/concepts.jsonl', content: 'SECRET-ARG' }] })] },
    tool('d3'),
  ],
};
const opts = { sources: { [SRC]: MD } };
const res = (record, o = opts) => V.resolveAll(vs(), record, o);
const outcomes = rs => rs.map(r => r.outcome);

// ---- resolution
check('resolve: one validation result per validator, with the data model fields', () => {
  const rs = res(good);
  return (rs.length === 6 && rs.every(r => RFIELDS.every(f => f in r)) && rs.every((r, i) => r.validator_id === vs()[i].id && r.session === 's_good')) || rs.map(r => Object.keys(r));
});
check('resolve: a session whose tool calls show the evidence passes every checkable validator', () => same(outcomes(res(good)), ['unresolved', 'pass', 'pass', 'pass', 'pass', 'pass']) || outcomes(res(good)));
check('resolve: a pass points at the turn and the tool call that showed it', () => {
  const r = res(good)[3];
  return (r.at_turn === 1 && typeof r.evidence_handle === 'string' && r.evidence_handle.includes('s_good')) || r;
});
check('resolve: a session that does not show the evidence fails, and every validator still gets its record', () => same(outcomes(res(bad)), ['unresolved', 'fail', 'fail', 'fail', 'fail', 'fail']) || outcomes(res(bad)));
check('resolve: forbidden evidence fails at the call that touched it', () => {
  const r = res(bad)[4];
  return (r.outcome === 'fail' && r.at_turn === 1 && String(r.evidence_handle).includes('s_bad')) || r;
});
check('resolve: a validator with no shape is unresolved, never passed', () => res(good)[0].outcome === 'unresolved' && res(bad)[0].outcome === 'unresolved');
check('resolve: a stale source marks the validator unresolved, not passed, even when the evidence is there', () => {
  const edited = MD.replace('Pick the seam', 'Choose the seam');
  const rs = res(good, { sources: { [SRC]: edited } });
  return (rs[1].outcome === 'unresolved' && rs[2].outcome === 'pass') || outcomes(rs);
});
check('resolve: a source that was not read leaves the validator unresolved', () => res(good, {}).every(r => r.outcome === 'unresolved') || outcomes(res(good, {})));
// ---- a profile carrying an argument summary per call: kept fields are evidence, so path and command steps resolve
const withArgs = profile(good);
check('resolve: a profile with argument summaries resolves a path step and a command step', () => {
  const rs = res(withArgs);
  return (rs[1].outcome === 'pass' && rs[1].at_turn === 0 && rs[2].outcome === 'pass') || outcomes(rs);
});
check('resolve: an old profile without argument summaries stays exactly as unresolved as before', () => {
  const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/concepts/profile-2026-11-19.json'), 'utf8')).sessions[0];
  const rs = res(old);
  return same(outcomes(rs), ['unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'pass']) || outcomes(rs);
});
check('resolve: a record with no tool arguments (a turn profile) leaves what needs them unresolved; cost still resolves', () => {
  // profile() now writes an argument summary per call; strip them so this stays a record with no tool arguments
  const bare = p => ({ ...p, perTurn: p.perTurn.map(({ args, ...t }) => t) });
  const rs = res(bare(profile(good)));
  return same(outcomes(rs), ['unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved', 'pass']) || outcomes(rs);
});
check('resolve: a failed validation stops nothing (it is a returned record; nothing throws)', () => {
  const rs = res(bad);
  return rs.filter(r => r.outcome === 'fail').length === 5 && rs.every(r => Array.isArray(r.carried_to));
});
check('resolve: validation by code spends no tokens and no cost', () => res(good).every(r => r.tokens === 0 && r.cost === 0));
check('resolve: the session record is read, never written', () => {
  const before = JSON.stringify(good); res(good); res(bad);
  return JSON.stringify(good) === before;
});
check('resolve: records hold no turn content (no user, assistant, system, result or argument text)', () => !/SECRET-/.test(JSON.stringify([res(good), res(bad), vs()])));
check('resolve: the same record and validators give the same results', () => same(res(bad), res(bad)));

// ---- pluggable: a check kind is a registered function
check('seam: a registered check kind resolves through its function; a taken name is refused', () => {
  V.register('always', () => ({ outcome: 'pass' }));
  const r = V.resolve({ ...by(1), check: 'always' }, good, opts);
  let refused = false; try { V.register('always', () => ({ outcome: 'fail' })); } catch { refused = true; }
  return (r.outcome === 'pass' && refused) || { outcome: r.outcome, refused };
});

// ---- real records: a live .trace export reads as a session record with its tool calls
check('records: a .trace export reads as session records whose tool call arguments can be checked', () => {
  const trace = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/live-evidence/issue4-live-evidence.trace'), 'utf8'));
  const recs = V.fromTrace(trace, 'issue4-live-evidence');
  const rs = recs.flatMap(r => res(r));
  return (recs.length === 1 && recs[0].messages.flatMap(m => m.tool_calls || []).length === 6 && rs.slice(1, 5).every(r => r.outcome === 'fail')) || { sessions: recs.length, outcomes: outcomes(rs) };
});

// ---- evidence inside a command line: the message arguments of `git commit` in a command line are evidence strings
// of their own, so a template anchored at the start of an argument (^Spec: ...) can match them. By code only.
const cm = s => V.commitMessages(s);
const bt = String.fromCharCode(96);
const table = [
  [String.raw`git commit -m 'Spec: a (b)'`, ['Spec: a (b)']],
  [String.raw`git commit -m "Spec: say \"hi\" and \$HOME (why)"`, ['Spec: say "hi" and $HOME (why)']],
  [String.raw`git commit -m "keep \n and \\ and \x"`, [String.raw`keep \n and \ and \x`]],
  [String.raw`git commit -m 'Spec: don'\''t (why)'`, ["Spec: don't (why)"]],
  [String.raw`git commit -m "it's (x)"`, ["it's (x)"]],
  [String.raw`git commit -m fix`, ['fix']],
  [String.raw`git commit -m Spec:\ a\ \(b\)`, ['Spec: a (b)']],
  [String.raw`git commit --message 'a b'`, ['a b']],
  [String.raw`git commit --message='a b'`, ['a b']],
  [String.raw`git commit --message=ab`, ['ab']],
  [String.raw`git commit -m'a b'`, ['a b']],
  [String.raw`git commit -mab`, ['ab']],
  [String.raw`git commit -am 'a b'`, ['a b']],
  [String.raw`git commit -a -m 'a'`, ['a']],
  [String.raw`git commit -m 'a' -m 'b'`, ['a', 'b']],
  [String.raw`git commit -m "a" --message=b`, ['a', 'b']],
  [String.raw`git add x && git commit -m 'Spec: a (b)' && git log -1`, ['Spec: a (b)']],
  [String.raw`cd r; git commit -m 'a' || echo no`, ['a']],
  [String.raw`git status | cat; git commit -m 'a' | tee log`, ['a']],
  ["git add x\ngit commit -m 'a'\ngit log -1", ['a']],
  [String.raw`(cd r && git commit -m 'a')`, ['a']],
  [String.raw`git -C r -c user.name=x commit -m 'a'`, ['a']],
  [String.raw`FOO=1 git commit -m 'a'`, ['a']],
  [String.raw`git commit -m 'a && b; c | d || e'`, ['a && b; c | d || e']],
  [String.raw`git commit -m "$(date) (x)"`, ['$(date) (x)']],
  ['git commit -m "x ' + bt + 'date' + bt + ' (y)"', ['x ' + bt + 'date' + bt + ' (y)']],
  [String.raw`git commit -m 'a' && git commit -m 'b`, ['a']],
  [String.raw`git log --grep 'Spec: a'`, []],
  [String.raw`echo "git commit -m 'Spec: a (b)'"`, []],
  [String.raw`git commit`, []],
  [String.raw`git commit -m`, []],
  [String.raw`git commit-tree -m 'a'`, []],
  [String.raw`git commit -m 'Spec: a (b`, []],
  [String.raw`git commit -m "Spec: a (b`, []],
];
check('command line: git commit messages are extracted in every quoting and option form, in any chain', () => {
  const bad = table.filter(([line, want]) => !same(cm(line), want)).map(([line]) => line);
  return bad.length === 0 || bad;
});
check('command line: not a git commit, or cut off inside its quote, gives no message (nothing is guessed)', () =>
  same(cm('ls'), []) && same(cm(null), []) && same(cm(42), []) && same(cm(String.raw`git commit -m 'Spec: a`), []));
const SH = String.raw`git add x && git commit -m 'Spec: validators read command lines (messages are evidence)' && git log -1`;
const viaShell = {
  id: 's_cmd', title: 'commit through a shell', system: 'SECRET-SYSTEM', ledger: [{ prompt: 1, completion: 1, cost: 0.01 }],
  messages: [
    { role: 'user', content: 'SECRET-USER do the work' },
    { role: 'assistant', content: 'SECRET-REPLY', tool_calls: [call('e1', 'shell', { cmd: 'node scripts/smoke.mjs' }), call('e2', 'shell', { cmd: SH })] },
    tool('e1'), tool('e2'),
  ],
};
const shapeV = by(3), fileV = by(1);
const bare = V.extract('- Start the message with `Spec:`.\n', 'skills/other/SKILL.md')[0];
check('command line: the anchored Spec: shape passes on the message inside a shell command, at the call', () => {
  const r = V.resolve(shapeV, viaShell, opts);
  return (r.outcome === 'pass' && r.at_turn === 0 && r.evidence_handle === 's_cmd#m1.c1') || r;
});
check('command line: a pass found inside a command line says so (in_command), and a plain pass does not', () => {
  const a = V.resolve(shapeV, viaShell, opts), b = V.resolve(shapeV, good, opts);
  return (a.in_command === true && b.outcome === 'pass' && !('in_command' in b)) || { a: a.in_command, b };
});
check('command line: the bare Spec: label passes on a message inside a command line', () => {
  const r = V.resolve(bare, viaShell, { sources: { 'skills/other/SKILL.md': '- Start the message with `Spec:`.\n' } });
  return (r.outcome === 'pass' && r.in_command === true) || r;
});
check('command line: a message without the parenthesised part still fails the Spec: <behaviour> (<why>) shape', () => {
  const rec = { ...viaShell, id: 's_cmd2', messages: [viaShell.messages[0], { role: 'assistant', content: '', tool_calls: [call('f1', 'shell', { cmd: String.raw`git commit -m 'Spec: no why given'` })] }] };
  const a = V.resolve(shapeV, rec, opts), b = V.resolve(bare, rec, { sources: { 'skills/other/SKILL.md': '- Start the message with `Spec:`.\n' } });
  return (a.outcome === 'fail' && a.reason === 'absent' && b.outcome === 'pass') || { a, b };
});
check('command line: a command that only mentions the message (echo, git log --grep) is not evidence', () => {
  const rec = { ...viaShell, id: 's_cmd3', messages: [viaShell.messages[0], { role: 'assistant', content: '', tool_calls: [
    call('g1', 'shell', { cmd: String.raw`echo "git commit -m 'Spec: a (b)'"` }), call('g2', 'shell', { cmd: String.raw`git log --grep 'Spec: a (b)'` })] }] };
  const r = V.resolve(shapeV, rec, opts);
  return (r.outcome === 'fail' && r.reason === 'absent') || r;
});
check('command line: text in a file write that contains a git commit line is not a command line', () => {
  const rec = { ...viaShell, id: 's_cmd4', messages: [viaShell.messages[0], { role: 'assistant', content: '', tool_calls: [
    call('h1', 'repo_commit', { message: 'docs', changes: [{ path: 'docs/x.md', content: SH }] })] }] };
  const r = V.resolve(shapeV, rec, opts);
  return (r.outcome === 'fail' && r.reason === 'absent') || r;
});
check('command line: a template that is not anchored, and a path, resolve exactly as before (no in_command)', () => {
  const rec = { ...viaShell, id: 's_cmd5', messages: [viaShell.messages[0], { role: 'assistant', content: '', tool_calls: [call('i1', 'shell', { cmd: 'cat docs/seams.md' })] }] };
  const a = V.resolve(fileV, rec, opts), un = { ...shapeV, shape: { ...shapeV.shape, expected: [{ kind: 'template', text: 'x', pattern: 'Spec: .+? \\(.+?\\)' }] } };
  const b = V.resolve(un, viaShell, opts);
  return (a.outcome === 'pass' && !('in_command' in a) && b.outcome === 'pass' && !('in_command' in b)) || { a, b };
});
check('command line: the trace reader and the turn profile reader find the message in the same way', () => {
  const trace = { kind: 'webharness.trace', exchanges: [{ t: 1, request: { messages: viaShell.messages.map(({ ...m }) => m), tools: [{}] } }] };
  const [fromT] = V.fromTrace(trace, 'x');
  const a = V.resolve(shapeV, fromT, opts), b = V.resolve(shapeV, profile(viaShell), opts);
  return (a.outcome === 'pass' && a.in_command === true && b.outcome === 'pass' && b.in_command === true && /#t\d+\.c\d+$/.test(b.evidence_handle)) || { a, b };
});
check('command line: a profile keeps one line; a message inside that line counts, one cut off by it does not', () => {
  const prof = cmd => ({ id: 'p1', perTurn: [{ n: 1, tools: 'shell', args: [{ name: 'shell', args: { cmd, cmd_more: { length: 80, hash: 'abcd1234' } } }] }], cost: { total: 0 } });
  const whole = V.resolve(shapeV, prof(String.raw`git commit -m 'Spec: a (b)' && git log -1 ` + '\\'), opts);
  const cut = V.resolve(shapeV, prof(String.raw`git commit -m 'Spec: a (b)`), opts);
  const doc = V.resolve(shapeV, prof(String.raw`git commit -m "$(cat <<'EOF'`), opts);
  return (whole.outcome === 'pass' && whole.in_command === true && cut.outcome === 'fail' && doc.outcome === 'fail') || { whole, cut, doc };
});
check('command line: an order check whose second step is an anchored template finds it inside a command line', () => {
  const ord = { ...by(2), shape: { step: 's', expected: [{ kind: 'command', text: 'node scripts/smoke.mjs', pattern: 'node scripts/smoke\\.mjs' }, { kind: 'template', text: 'Spec:', pattern: '^Spec:' }], forbidden: [], result: 'r' } };
  const r = V.resolve(ord, viaShell, opts);
  return (r.outcome === 'pass' && r.evidence_handle === 's_cmd#m1.c1' && r.in_command === true) || r;
});
check('command line: results hold no message text, and the record is still only read', () => {
  const before = JSON.stringify(viaShell), r = V.resolve(shapeV, viaShell, opts);
  return (JSON.stringify(viaShell) === before && !/validators read command lines/.test(JSON.stringify(r))) || r;
});

// ---- the node entry: records are appended beside the sessions, never rewritten, and a fail is not an error
check('entry: scripts/validators.mjs appends records as lines, keeps what was there, exits 0 on fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-validators-'));
  const sk = path.join(dir, 'SKILL.md'), rec = path.join(dir, 'bad.session'), out = path.join(dir, 'out.jsonl');
  fs.writeFileSync(sk, MD); fs.writeFileSync(rec, JSON.stringify({ kind: 'webharness.session', schema: 1, sessions: [bad] }));
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/validators.mjs'), sk, '--records', rec, '--out', out], { encoding: 'utf8' });
  const a = run(), first = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const b = run(), second = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const lines = first.split('\n').filter(Boolean).map(l => JSON.parse(l));
  const ok = a.status === 0 && b.status === 0 && lines.filter(l => l.record === 'step validator').length === 6 && lines.filter(l => l.record === 'validation result' && l.outcome === 'fail').length === 5
    && second.startsWith(first) && second.length === 2 * first.length && !/SECRET-/.test(second);
  fs.rmSync(dir, { recursive: true, force: true });
  return ok || { status: [a.status, b.status], lines: lines.length, err: String(a.stderr).split('\n')[0] };
});

if (V.missing) console.log('app/validators.js: ' + V.missing);
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
