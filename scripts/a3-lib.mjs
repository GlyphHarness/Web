// A3.1 shared pieces (stories: docs/epics/A3-flow-loop.md A3.1; protocol: docs/concepts/results/a3-validators-protocol-2026-11-21.md).
// Plain node, no browser, no key. Measurement code only: it reads app/validators.js and never changes it.
//  - SKILL, bullets(): the source skill and its list bullets (the same bullets app/validators.js finds)
//  - prompt(): the exact text sent to the cheap models (fixed before scoring)
//  - loadCorpus(): the recorded sessions the shapes are resolved against
//  - resolveShape(): one shape against one record -> {outcome: pass|fail|unresolved, reason}
//  - parseReply(), checkModelItem(): what a model answered, validated
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as V from '../app/validators.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL = '.claude/skills/context-experiments/SKILL.md';
export const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
export const bullets = () => V.bullets(read(SKILL));

// ---- the prompt (stage-0 text; the one message each cheap-model session gets)
const EXAMPLE = [
  '10| 1. Write the goal as sentences, one behaviour each.',
  '11| 2. Pick the seam (`.claude/agents/seams.md` list). No seam fits: stop and write a concept record in your inbox.',
].join('\n');
const EXAMPLE_OUT = JSON.stringify([
  { line: 10, check: 'none', expected: [], forbidden: [], result: 'nothing to look for in a record' },
  { line: 11, check: 'presence', expected: [{ kind: 'path', text: '.claude/agents/seams.md', pattern: '\\.claude/agents/seams\\.md' }], forbidden: [], result: 'the file named is found in the arguments of a tool call' },
]);
export const prompt = () => {
  const numbered = read(SKILL).split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
  return [
    'You extract step validators from a skill file. A step validator is a check that can be run later, by code, against the recorded tool calls and ledger rows of a session, to see whether one list bullet of the file was followed. You do not run anything; you only write the validators, from the text below and nothing else.',
    '',
    'The file is given one line per row; each row starts with its line number and a bar. A list bullet is a line that starts with a number and a dot, or with a dash; it may continue on the following indented lines. Write one JSON object per list bullet and reply with one JSON array and nothing else.',
    '',
    'Fields of each object:',
    '- "line": the line number where the bullet starts',
    '- "check": "presence" (one of the expected items is found), "order" (the first expected item is found, then the second one after it), "cost" (the cost of the session is at or under a limit), or "none" when the bullet names nothing that tool calls and ledger rows could show',
    '- "expected": a list of items {"kind", "text", "pattern"}; "text" is the literal, "pattern" is a JavaScript regular expression, as a string, that matches the evidence',
    '- "forbidden": a list of items of the same form that must not be found (empty when none)',
    '- "result": one sentence saying when the step counts as followed',
    '',
    'Item kinds (what the pattern is matched against):',
    '- path: a file path in the arguments of a tool call',
    '- command: a shell command line in the arguments of a tool call',
    '- content: other text inside the arguments of a tool call, for example text written to a file',
    '- strategy: the strategy id carried by the ledger rows of the session; it passes when every row matches',
    '- cache: a predicate over consecutive ledger rows, given as the pattern: terms of the form field,operator,number written like "prompt>1000" and joined by "," ; the first term must hold for a row, the second for the next row, and so on; fields are prompt, cached, write, out, reasoning, cost; operators are > >= < <= ==',
    '- field: a named field of the session record; the pattern is the field name',
    '- cost: an item {"kind":"cost","limit":<number in dollars>} used with check "cost"',
    '',
    'A bullet that names no file, command, text, strategy id, ledger figure, session field or cost limit gets check "none", expected [] and forbidden [].',
    '',
    'Example. Rows:',
    EXAMPLE,
    'Answer:',
    EXAMPLE_OUT,
    '',
    'The file:',
    numbered,
  ].join('\n');
};

// ---- the recorded sessions
// caps: which evidence a record kind holds. profile = app/profile.js turn profile; trace = a .trace export read by V.fromTrace;
// a1row = one row of docs/concepts/results/a1-baseline-2026-11-21.jsonl (tool names and ledger rows, no tool arguments).
export const NEED = { path: 'args.path', command: 'args.command', content: 'args.content', strategy: 'ledger.strat', cache: 'ledger.rows', cost: 'ledger.cost', field: 'record.field' };
V.reader(r => Array.isArray(r?.tools) && Array.isArray(r?.rows) && r.arm
  ? { session: r.session, kind: 'a1row', calls: r.tools.map((name, j) => ({ turn: 0, msg: null, call: j, name, args: null })), cost: Number.isFinite(r.cost) ? r.cost : null }
  : null);
const mainRows = rec => (rec.rows || []).filter(r => !r.helper);
export function loadCorpus() {
  const out = [], dir = p => fs.readdirSync(path.join(ROOT, p)).sort();
  for (const f of dir('docs/concepts').filter(f => /^profile-.*\.json$/.test(f))) {
    for (const s of JSON.parse(read('docs/concepts/' + f)).sessions || []) {
      const args = (s.perTurn || []).some(t => Array.isArray(t.args)), rows = mainRows(s).length > 0;
      out.push({ from: 'docs/concepts/' + f, kind: args ? 'profile+args' : 'profile', record: s, caps: new Set([...(args ? ['args.path', 'args.command'] : []), ...(rows ? ['ledger.strat', 'ledger.rows', 'ledger.cost'] : [])]) });
    }
  }
  for (const f of dir('docs/live-evidence').filter(f => f.endsWith('.trace'))) {
    for (const s of V.fromTrace(JSON.parse(read('docs/live-evidence/' + f)), f.replace(/\.trace$/, ''))) {
      out.push({ from: 'docs/live-evidence/' + f, kind: 'trace', record: s, caps: new Set(['args.path', 'args.command', 'args.content']) });
    }
  }
  const a1 = read('docs/concepts/results/a1-baseline-2026-11-21.jsonl').split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const r of a1) out.push({ from: 'docs/concepts/results/a1-baseline-2026-11-21.jsonl', kind: 'a1row', record: r, caps: new Set(['ledger.strat', 'ledger.rows', 'ledger.cost']) });
  return out;
}

// ---- resolving one shape against one record
const ARGKINDS = new Set(['path', 'command', 'content']), KINDS = new Set([...ARGKINDS, 'strategy', 'cache', 'field', 'cost']), CHECKS = new Set(['presence', 'order', 'cost']);
const compile = p => { try { return new RegExp(p); } catch { return null; } };
const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b };
// "write>0,cached>0" -> [[field, op, n], ...] or null
export function predicate(p) {
  const terms = String(p).split(',').map(t => t.trim().match(/^(prompt|cached|write|out|reasoning|cost)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/));
  return terms.length && terms.every(Boolean) ? terms.map(m => [m[1], m[2], Number(m[3])]) : null;
}
const holds = (row, [f, op, n]) => OPS[op](Number(row[f]) || 0, n);
const runOf = (rows, terms) => { for (let i = 0; i + terms.length <= rows.length; i++) if (terms.every((t, j) => holds(rows[i + j], t))) return i; return -1; };
const SRC = 'a3', SRC_TEXT = 'x';

// shape: {check, expected: [item], forbidden: [item]}; rec: a corpus entry. -> {outcome, reason}
export function resolveShape(shape, rec) {
  const un = reason => ({ outcome: 'unresolved', reason });
  if (!shape || !CHECKS.has(shape.check)) return un(shape?.check === 'none' || !shape ? 'no-shape' : 'bad-check');
  const exp = shape.expected || [], forb = shape.forbidden || [], items = [...exp, ...forb];
  if (!items.length) return un('no-shape');
  for (const it of items) {
    if (!it || !KINDS.has(it.kind)) return un('bad-kind');
    if (it.kind === 'cost') { if (shape.check !== 'cost' || !Number.isFinite(it.limit)) return un('bad-shape'); }
    else if (typeof it.pattern !== 'string' || !compile(it.pattern)) return un('bad-pattern');
  }
  if (shape.check === 'cost' && !(exp.length === 1 && exp[0].kind === 'cost' && !forb.length)) return un('bad-shape');
  if (shape.check === 'order' && exp.length !== 2) return un('bad-shape');
  const kinds = new Set(items.map(i => i.kind)), argy = [...kinds].filter(k => ARGKINDS.has(k)).length, other = [...kinds].filter(k => !ARGKINDS.has(k));
  if (argy && other.length || other.length > 1) return un('mixed-kinds');
  for (const it of items) { const need = it.kind === 'field' ? 'record.field' : NEED[it.kind]; if (need === 'record.field') { if (!(it.pattern in rec.record) || rec.record[it.pattern] == null) return un('field-not-recorded'); } else if (!rec.caps.has(need)) return un('no:' + need); }
  const k = [...kinds][0];
  if (argy) { // the same code as the F1 validators: V.resolve on a validator built from the shape
    const v = { id: 'a3', source_path: SRC, source_line_range: [1, 1], step_text_hash: V.hashLines(SRC_TEXT, [1, 1]), check: shape.check, shape: { step: '', expected: exp, forbidden: forb, result: '' } };
    const r = V.resolve(v, rec.record, { sources: { [SRC]: SRC_TEXT } });
    return { outcome: r.outcome, reason: r.reason, at_turn: r.at_turn };
  }
  if (k === 'cost') {
    const v = { id: 'a3', source_path: SRC, source_line_range: [1, 1], step_text_hash: V.hashLines(SRC_TEXT, [1, 1]), check: 'cost', shape: { step: '', expected: exp, forbidden: [], result: '' } };
    const r = V.resolve(v, rec.record, { sources: { [SRC]: SRC_TEXT } });
    return { outcome: r.outcome, reason: r.reason };
  }
  if (k === 'field') return { outcome: 'pass', reason: null }; // present, checked above (forbidden fields: a present field fails)
  const rows = mainRows(rec.record);
  if (!rows.length) return un('no-ledger');
  if (k === 'strategy') {
    const res = exp.map(i => compile(i.pattern)), fres = forb.map(i => compile(i.pattern));
    if (fres.some(re => rows.some(r => re.test(String(r.strat))))) return { outcome: 'fail', reason: 'forbidden' };
    if (!res.length) return { outcome: 'pass', reason: null };
    return rows.every(r => res.some(re => re.test(String(r.strat)))) ? { outcome: 'pass', reason: null } : { outcome: 'fail', reason: 'absent' };
  }
  // cache
  const want = exp.map(i => predicate(i.pattern)), notw = forb.map(i => predicate(i.pattern));
  if ([...want, ...notw].some(p => !p)) return un('bad-predicate');
  if (notw.some(p => runOf(rows, p) >= 0)) return { outcome: 'fail', reason: 'forbidden' };
  if (!want.length) return { outcome: 'pass', reason: null };
  return want.some(p => runOf(rows, p) >= 0) ? { outcome: 'pass', reason: null } : { outcome: 'fail', reason: 'absent' };
}

// ---- a model's reply
export function parseReply(text) {
  const t = String(text ?? ''), fence = t.match(/```(?:json)?\s*([\s\S]*?)```/), cand = fence ? fence[1] : t.slice(t.indexOf('['), t.lastIndexOf(']') + 1);
  try { const j = JSON.parse(cand); return Array.isArray(j) ? j : null; } catch { return null; }
}
// one item of a model's answer -> null when valid, else a reason
export function itemFault(o) {
  if (!o || typeof o !== 'object' || !Number.isInteger(o.line)) return 'no-line';
  if (!CHECKS.has(o.check)) return o.check === 'none' ? null : 'bad-check';
  if (!Array.isArray(o.expected) || (o.forbidden != null && !Array.isArray(o.forbidden))) return 'bad-shape';
  const items = [...o.expected, ...(o.forbidden || [])];
  if (!items.length) return 'empty';
  for (const it of items) {
    if (!it || !KINDS.has(it.kind)) return 'bad-kind';
    if (it.kind === 'cost') { if (!Number.isFinite(it.limit)) return 'bad-shape'; }
    else if (typeof it.pattern !== 'string' || !compile(it.pattern)) return 'bad-pattern';
  }
  return null;
}
export const hasShape = o => o && o.check !== 'none' && !itemFault(o);

// equivalence with a hand shape: the same evidence kinds; every witness matched by a pattern, no decoy matched (kind-wise for ledger kinds: same predicate or id pattern behaviour)
// m: a model's item {expected, forbidden}; h: a hand row {shape: {expected, forbidden}, witnesses, decoys}
export function equivalent(m, h) {
  const items = x => [...(x.expected || []), ...(x.forbidden || [])];
  const ks = x => [...new Set(items(x).map(i => i.kind))].sort().join();
  if (ks(m) !== ks(h.shape)) return { ok: false, why: 'kinds' };
  const pats = items(m);
  for (const w of h.witnesses || []) { const hit = pats.some(i => i.kind === w.kind && (i.kind === 'cache' ? predicate(i.pattern) && JSON.stringify(predicate(i.pattern)) === JSON.stringify(predicate(w.text)) : i.kind === 'field' ? i.pattern === w.text : compile(i.pattern)?.test(w.text))); if (!hit) return { ok: false, why: 'witness:' + w.text }; }
  for (const d of h.decoys || []) { const hit = pats.some(i => i.kind === d.kind && i.kind !== 'cache' && i.kind !== 'field' && compile(i.pattern)?.test(d.text)); if (hit) return { ok: false, why: 'decoy:' + d.text }; }
  return { ok: true };
}
