// What a model is sent under each strategy registered before the query strategy: the tool definitions of two
// tool groups and one fixed request. Shared by scripts/test-query-integration.mjs (the guard checks) and by
// the generator below. The fixture holds hashes of these views as dev 135f592 sent them
// (scripts/fixtures/model-view-pre-query.json); the generator is run once, never to make a check pass.
// Run to regenerate (at 135f592 only): node scripts/fixtures/query-guard.mjs --write
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defsFor, defsAs } from '../../app/tools.js';
import { buildRequest, flatten } from '../../app/context.js';
import * as strategies from '../../app/strategies.js';

export const PRE = ['strat-serial-1.0', 'strat-checkpoint-1.0', 'strat-stem-1.0', 'strat-stem-2.0', 'strat-serial-2.0', 'strat-serial-3.0'];
export const GROUPS = { base: { tools: [] }, all: { tools: ['ask', 'values', 'repo', 'vm', 'files', 'local'] } };
export const SESSION = {
  id: 'guard1', core: 3, system: 'You help with files.',
  messages: [
    { role: 'user', content: 'read a.txt' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'repo_read', arguments: '{"repo":"o/r","op":"file","path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'hello world' },
    { role: 'assistant', content: 'It says hello world.' },
  ],
};
export const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
export const specOf = id => sha(JSON.stringify(strategies.spec(id)));
export function viewOf(id, group) {
  const sp = strategies.spec(id), defs = defsAs(defsFor(GROUPS[group]), sp.reads, sp.wording, sp.query);
  return { defs: sha(JSON.stringify(defs)), body: sha(flatten(buildRequest(SESSION, 'mock-1', defs))), n: defs.length };
}
export const snapshot = () => ({
  from: '135f592 (dev tip, 0.57.0)',
  note: 'Hashes (sha256, 16 hex) of what each strategy registered before strat-query-1.0 sent: its spec, its tool definitions for two tool groups, one fixed request. A strategy registered on 135f592 sends the same bytes after the query strategy lands (a query strategy is a new id, never an edit). Generated once; do not edit.',
  spec: Object.fromEntries(PRE.map(id => [id, specOf(id)])),
  view: Object.fromEntries(PRE.map(id => [id, Object.fromEntries(Object.keys(GROUPS).map(g => [g, viewOf(id, g)]))])),
});

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const out = fileURLToPath(new URL('./model-view-pre-query.json', import.meta.url));
  fs.writeFileSync(out, JSON.stringify(snapshot(), null, 1) + '\n');
  console.log('wrote', out);
}
