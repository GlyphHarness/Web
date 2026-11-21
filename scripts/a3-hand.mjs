// A3.1 hand extraction: the 24 list bullets of .claude/skills/context-experiments/SKILL.md (at 3add2df), read and shaped by the operator
// (one extractor, no second rater), before any cheap model was run and before anything was resolved against the corpus.
// Rules that were fixed first (protocol note, "Hand extraction rules"):
//  - a bullet yields a shape only when the bullet's own text names the evidence; evidence another bullet names does not count
//  - strength: strong = a pass entails the act the bullet asks for; weak = a pass shows only a named thing touched, or a state that fits the act
//  - a bullet with no shape gets one reason: judgement | turn-text | cross-session | bytes | not-built
//  - witnesses are strings of the shape's evidence kind that a faithful pattern must match; decoys are near misses it must not match
const P = (kind, text, pattern) => ({ kind, text, pattern });
const W = (kind, text) => ({ kind, text });
export const HAND = {
  10: { shape: { check: 'presence', strength: 'strong', expected: [P('path', 'catalog/inbox/context-<shortid>.jsonl', 'catalog/inbox/context-[A-Za-z0-9]+\\.jsonl')], forbidden: [], result: 'a tool call writes or names the concept record file in the inbox' },
    gaps: 'status hypothesis, claim and metric (content); "first" (order against the first run)',
    witnesses: [W('path', 'catalog/inbox/context-abcdef.jsonl'), W('path', 'C:/wh/x/catalog/inbox/context-hxdvpy.jsonl')], decoys: [W('path', 'catalog/concepts.jsonl'), W('path', 'catalog/inbox/seams-abcdef.jsonl')] },
  11: { shape: { check: 'presence', strength: 'strong', expected: [P('strategy', 'strat-<name>-<major>.<minor>', '^strat-[a-z0-9]+(-[a-z0-9]+)*-[0-9]+\\.[0-9]+$')], forbidden: [], result: 'every ledger row of the session carries a strategy id of that form' },
    gaps: '"blue runs under strat-serial-1.0" (which arm is blue is not recorded); one variable per id',
    witnesses: [W('strategy', 'strat-serial-1.0'), W('strategy', 'strat-stem-2.0')], decoys: [W('strategy', 'strat-stem'), W('strategy', 'serial-1.0')] },
  12: { shape: { check: 'order', strength: 'strong', expected: [P('command', 'node scripts/casestudy.mjs (no --live)', 'node scripts/casestudy\\.mjs(?!.*--live)'), P('command', 'node scripts/casestudy.mjs --live', 'node scripts/casestudy\\.mjs.*--live')], forbidden: [], result: 'the mock case study is run, then the live one' },
    gaps: '"spec the checks" and "fix until green" (no command names them)',
    witnesses: [W('command', 'node scripts/casestudy.mjs'), W('command', 'node scripts/casestudy.mjs --live --repeat 3')], decoys: [W('command', 'node scripts/smoke.mjs'), W('command', 'node scripts/wh.mjs step')] },
  13: { shape: { check: 'presence', strength: 'weak', expected: [P('path', 'docs/concepts/PROGRAMME.md', 'docs/concepts/PROGRAMME\\.md')], forbidden: [], result: 'the programme file is named by a tool call' },
    gaps: 'choosing pertinent work, no toy tasks (judgement); a read shows the file was looked at, not that it was followed',
    witnesses: [W('path', 'docs/concepts/PROGRAMME.md')], decoys: [W('path', 'docs/concepts/HYPOTHESES.md'), W('path', 'docs/case-studies/side-goal-2026-11-19-live.md')] },
  14: { shape: { check: 'presence', strength: 'strong', expected: [P('command', 'node scripts/casestudy.mjs --live --repeat <N>', 'node scripts/casestudy\\.mjs --live --repeat [0-9]+'), P('command', 'node scripts/wh.mjs', 'node scripts/wh\\.mjs')], forbidden: [], result: 'a live run is started with the case study driver or the operator CLI' },
    gaps: 'silo, canary then full stages, run count (PROGRAMME.md numbers, not in the bullet)',
    witnesses: [W('command', 'node scripts/casestudy.mjs --live --repeat 3'), W('command', 'node scripts/wh.mjs step --dir x')], decoys: [W('command', 'node scripts/casestudy.mjs'), W('command', 'node scripts/smoke.mjs')] },
  17: { shape: { check: 'presence', strength: 'strong', expected: [P('path', 'catalog/inbox/<file>.jsonl', 'catalog/inbox/[A-Za-z0-9-]+\\.jsonl')], forbidden: [], result: 'a tool call writes or names a file in the catalog inbox' },
    gaps: 'faults and negative results kept with why and the model (content)',
    witnesses: [W('path', 'catalog/inbox/context-abcdef.jsonl')], decoys: [W('path', 'catalog/concepts.jsonl'), W('path', 'docs/case-studies/x.md')] },
  24: { shape: { check: 'presence', strength: 'weak', expected: [P('cache', 'a row with cache write, then a row with cache read', 'write>0,cached>0')], forbidden: [], result: 'a ledger row with cache write is followed by a row with cache read' },
    gaps: 'that the first row is a probe turn with a discarded reply and generic refs (turn text); H2, H9 as a strategy variant; the pair fits any cached run',
    witnesses: [W('cache', 'write>0,cached>0')], decoys: [] },
  25: { shape: { check: 'presence', strength: 'strong', expected: [P('field', 'resolved', 'resolved')], forbidden: [], result: 'the session record holds a resolved field (content hash per turn)' },
    gaps: 'one hash per turn (only presence of the field is checked); the model not being told of the change (turn text)',
    witnesses: [W('field', 'resolved')], decoys: [] },
  28: { shape: { check: 'presence', strength: 'strong', expected: [], forbidden: [P('content', '"status":"promoted"', '"status": ?"promoted"')], result: 'no tool call argument sets a catalog status to promoted' },
    gaps: 'only a record written in a tool call argument is seen; thresholds of PROGRAMME.md',
    witnesses: [W('content', '{"status":"promoted"}'), W('content', '"status": "promoted"')], decoys: [W('content', '"status":"measured"')] },
  30: { shape: { check: 'presence', strength: 'strong', expected: [], forbidden: [P('content', 'an API key (sk-...)', 'sk-[A-Za-z0-9_-]{16,}')], result: 'no tool call argument holds an API-key-shaped string' },
    gaps: '"tests never call real models" (provider and model of ledger rows are not a rule here); key in message text or tool results (arguments only)',
    witnesses: [W('content', 'sk-or-v1-abcdef0123456789abcd')], decoys: [W('content', 'sk-short'), W('content', 'task-list-of-things')] },
  31: { shape: { check: 'presence', strength: 'strong', expected: [P('content', '"class":"common|uncommon|provider"', '"class": ?"(common|uncommon|provider)"')], forbidden: [], result: 'a fault record written in a tool call carries one of the three classes' },
    gaps: 'per model; a fault record is only one of the things a write can hold',
    witnesses: [W('content', '{"class":"common"}'), W('content', '"class": "provider"')], decoys: [W('content', '"class":"rare"')] },
  35: { shape: { check: 'presence', strength: 'strong', expected: [P('content', '"to":"concepts"', '"to": ?"concepts"')], forbidden: [], result: 'a concept line is written in a tool call argument' },
    gaps: 'full record, new status, supersedes the earlier id; the path (covered by the bullets at 10 and 17)',
    witnesses: [W('content', '{"to":"concepts","id":"abcdef"}'), W('content', '"to": "concepts"')], decoys: [W('content', '"to":"faults"')] },
  36: { shape: { check: 'presence', strength: 'strong', expected: [P('content', '"to":"faults"', '"to": ?"faults"')], forbidden: [], result: 'a fault line is written in a tool call argument' },
    gaps: 'the seven fields',
    witnesses: [W('content', '{"to":"faults","id":"abcdef"}'), W('content', '"to": "faults"')], decoys: [W('content', '"to":"concepts"')] },
  37: { shape: { check: 'presence', strength: 'strong', expected: [P('path', 'docs/case-studies/<name>-<date>.md', 'docs/case-studies/[^/\\s]+-[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md')], forbidden: [P('path', 'catalog/*.jsonl', '(^|/)catalog/[^/\\s]*\\.jsonl$')], result: 'the case-study table file is written and no catalog index file is' },
    gaps: 'the steward merges (another agent); a read of catalog/*.jsonl is also seen by an argument pattern (shape cannot tell a read from a write)',
    witnesses: [W('path', 'docs/case-studies/a1-baseline-2026-11-21.md'), W('path', 'catalog/concepts.jsonl')], decoys: [W('path', 'catalog/inbox/context-abcdef.jsonl'), W('path', 'docs/concepts/x.md')] },
};
// bullets with no shape: line -> [reason, why]
export const NONE = {
  15: ['judgement', 'the verdict is the operator reading the diff and the ledger; no record says it was read'],
  16: ['cross-session', 'the table is over runs per strategy; its location is named by another bullet'],
  20: ['turn-text', 'whether a prompt is a challenge, graft or puzzle is its content, judged by reading'],
  21: ['cross-session', 'natural steering before structure is an order of arms across sessions'],
  22: ['cross-session', 'a comparison of arms; one variable per strategy id compares strategy specs, not one session'],
  23: ['turn-text', 'whether a steering point is generic and steps are in plain words is wording, judged by reading'],
  26: ['not-built', 'a hypothesis not built: no record exists that it could leave'],
  27: ['cross-session', 'the condition and the comparison with blue span sessions; the condition (a long core) is not a recorded flag'],
  29: ['bytes', 'cached bytes edited mid-run: prefix bytes are not in a profile or ledger row'],
  32: ['cross-session', 'spread over the runs PROGRAMME.md requires: a count over sessions and a number the bullet does not hold'],
};

// the hand extraction as data: node scripts/a3-hand.mjs [out.json]
import { bullets, read, SKILL } from './a3-lib.mjs';
import * as V from '../app/validators.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export function handRows() {
  const text = read(SKILL);
  return bullets().map(b => {
    const base = { line: b.line_start, section: b.section, text_hash: V.hashLines(text, [b.line_start, b.line_end]), text: b.text.slice(0, 100) };
    const h = HAND[b.line_start], n = NONE[b.line_start];
    if (h) return { ...base, shape: h.shape, gaps: h.gaps, witnesses: h.witnesses, decoys: h.decoys };
    if (n) return { ...base, shape: null, none_reason: n[0], none_why: n[1] };
    return { ...base, shape: null, none_reason: 'unhandled', none_why: 'bullet not covered by the hand extraction' };
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = handRows(), out = process.argv[2];
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
  console.log(`${rows.length} bullets, ${rows.filter(r => r.shape).length} shaped, ${rows.filter(r => r.none_reason === 'unhandled').length} unhandled`);
}
